// Local, origin-scoped erasure only. No transport, server revoke, sync commit,
// record tombstones, or storage.clear(). Other sites and downloads are untouched.
import {createProductWalTabCoordinator} from './private-wal-tab-fence.mjs';
import {readOwnerCloseIntent} from './owner-group-close.mjs';
import {readOwnerAuthorityMarker} from './owner-authority.mjs';
export const LOCAL_RESET_KEY='anilog-local-data-reset-v1';
export const LOCAL_GENERATION_KEY='anilog-local-data-generation-v1';
const fail=code=>{throw Error('LOCAL_RESET_STOP:'+code)};
const profile='(?:-p[1-9][0-9]?)?';
const databases=[
 new RegExp('^anilog-FORMAL-PRODUCTION-ENCRYPTED-PRIMARY'+profile+'(?:-RECOVERY-ANCHORS-v1|-PHASE4I-RECOVERY-PRIVATE-ONLY|-VERIFIED-2A-CACHE-POC-v1)?$'),
 new RegExp('^anilog-FORMAL-PRODUCTION-SEALED-CREDENTIALS'+profile+'$'),
 new RegExp('^formal-production:(?:receiver:)?anilog-FORMAL-REGISTRATION-INTENT'+profile+'$'),
 new RegExp('^formal-production:anilog-FORMAL-OWNER-AUTHORITY-INTENT'+profile+'$'),
 /^formal-production:anilog-FORMAL-AUTOMATIC-DEVICE-KEY$/
];
export const isLocalDeviceDatabase=name=>typeof name==='string'&&databases.some(re=>re.test(name));
const exactKeys=new Set(['anilog-v1','anilog-weekly-options-v1','anilog-weekly-api-cache-v1','anilog-weekly-episodes-cache-v1',
 'anilog-search-sort-v1','anilog-last-backup-v1','anilog-backup-notified-v1','anilog-collapsed-periods-v1','anilog-titles-cache-v1',
 'anilog-wikipedia-alias-v1','anilog-wikimedia-advanced-v174','anilog-ranking-cache-v1','anilog-mal-metrics-v1',
 'anilog-series-relations-v1','anilog-series-ja-titles-v1','anilog-sync-connection-profile-v1','anilog-sync-setup-receipt-v1']);
export const isLocalDeviceKey=key=>exactKeys.has(key)||
 /^anilog-sync-local-mode-v1(?:-p[1-9][0-9]?)?$/.test(key)||
 /^anilog-sync-manual-pause-v1(?:-p[1-9][0-9]?)?$/.test(key)||
 /^anilog-(?:wal-first-upgrade|local-device-names|self-revoke-intent|owner-close-intent|owner-authority)-v1:(?:legacy|p[1-9][0-9]?)$/.test(key);

// Whole-browser erasure is broader than the selected connection. Every local
// profile must be either unregistered or durably self-revoked. No network and
// no role inferred from a setup receipt; an owner cannot obtain a revoke ACK.
export async function assertLocalResetRegistrationsReleased({local,idb,inspectUnregistered}={}){
 if(typeof idb?.databases!=='function'||typeof inspectUnregistered!=='function')fail('REGISTRATION_STATE_REQUIRED');
 const snapshot=()=>{
  const rows=[];for(let i=0;i<local.length;i++){const k=local.key(i);if(k==='anilog-sync-connection-profile-v1'||k==='anilog-sync-setup-receipt-v1'||/^anilog-sync-local-mode-v1(?:-p[1-9][0-9]?)?$/.test(k)||/^anilog-(self-revoke|owner-close)-intent-v1:/.test(k)||/^anilog-owner-authority-v1:/.test(k))rows.push([k,local.getItem(k)]);}
  return JSON.stringify(rows.sort(([a],[b])=>a.localeCompare(b)));
 };
 const before=snapshot(),rows=await idb.databases();
 if(!Array.isArray(rows)||rows.some(x=>typeof x?.name!=='string'))fail('REGISTRATION_STATE_REQUIRED');
 const names=rows.map(x=>x.name).filter(isLocalDeviceDatabase).sort(),ids=new Set(['legacy']);
 for(const name of names){const m=name.match(/-p([1-9][0-9]?)(?:$|-)/);if(m)ids.add('p'+m[1]);}
 for(let i=0;i<local.length;i++){const k=local.key(i),m=k?.match(/^anilog-sync-local-mode-v1-(p[1-9][0-9]?)$/)||k?.match(/^anilog-(?:self-revoke|owner-close)-intent-v1:(p[1-9][0-9]?)$/)||k?.match(/^anilog-owner-authority-v1:(p[1-9][0-9]?)$/);if(m)ids.add(m[1]);}
 for(const id of ids){
  const suffix=id==='legacy'?'':'-'+id,mode=local.getItem('anilog-sync-local-mode-v1'+suffix),journal=local.getItem('anilog-self-revoke-intent-v1:'+id);
  if(mode!==null&&!['encrypted-local','sync-enabled'].includes(mode))fail('REGISTRATION_STATE_REQUIRED');
  if(journal!==null&&!['pending','confirmed'].includes(journal))fail('REGISTRATION_STATE_REQUIRED');
  const closed=readOwnerCloseIntent(local,id);
  const authority=readOwnerAuthorityMarker(local,id);
  if(authority?.phase==='pending')fail('SERVER_RELEASE_REQUIRED');
  if(authority?.phase==='completed'&&authority.role==='owner'&&closed?.phase!=='confirmed')fail('SERVER_RELEASE_REQUIRED');
  if(journal==='pending'||closed?.phase==='pending')fail('SERVER_RELEASE_REQUIRED');
  if(journal==='confirmed'||closed?.phase==='confirmed')continue;
  if(journal==='pending'||mode==='sync-enabled')fail('SERVER_RELEASE_REQUIRED');
  const primary='anilog-FORMAL-PRODUCTION-ENCRYPTED-PRIMARY'+suffix;
  if(mode===null&&names.includes(primary))fail('REGISTRATION_STATE_REQUIRED');
  const proof=await inspectUnregistered(id,names);
  if(proof?.unregistered!==true)fail('SERVER_RELEASE_REQUIRED');
 }
 const after=await idb.databases();
 if(snapshot()!==before||JSON.stringify(after.map(x=>x.name).filter(isLocalDeviceDatabase).sort())!==JSON.stringify(names))fail('REGISTRATION_STATE_CHANGED');
 return {phase:'ALL_LOCAL_PROFILES_RELEASED'};
}

// A durable fence survives partial deletion and a reload. The generation stays
// after a successful reset so a BFCache tab cannot write its old in-memory WAL
// into the new installation. Uninstrumented older tabs are NOT detectable.
export function createLocalDeviceReset({idb,local,session,locks,events,beforeErase=async()=>{},onFenced=()=>{},timeoutMs=10000}={}){
 const phase=()=>{const v=local.getItem(LOCAL_RESET_KEY);if(v!==null&&!['pending','complete'].includes(v))fail('INVALID_RESET_STATE');return v};
 const generation=()=>{const raw=local.getItem(LOCAL_GENERATION_KEY);if(raw===null)return 0;if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('INVALID_GENERATION');return Number(raw)};
 let epoch=generation(),stopped=false,executing=false;
 const write=(key,value)=>{local.setItem(key,value);if(local.getItem(key)!==value)fail('FENCE_NOT_DURABLE')};
 const presence=createProductWalTabCoordinator({locks,events,lockName:'anilog-private-wal-maintenance:device-data-reset',localIdle:()=>!executing});
 const assertUsable=()=>{if(stopped||phase()!==null||generation()!==epoch)fail('LOCAL_DATA_RESET_RELOAD_REQUIRED')};
 const changed=()=>{try{assertUsable()}catch{stopped=true;onFenced()}};
 events?.addEventListener?.('storage',changed);
 events?.addEventListener?.('pageshow',changed);
 const listDatabases=async()=>{
  if(typeof idb?.databases!=='function'||typeof idb?.deleteDatabase!=='function')fail('DATABASE_ENUMERATION_UNAVAILABLE');
  const rows=await idb.databases();if(!Array.isArray(rows)||rows.some(x=>typeof x?.name!=='string'))fail('DATABASE_ENUMERATION_INVALID');
  return rows.map(x=>x.name).filter(isLocalDeviceDatabase);
 };
 const keys=()=>{if(!Number.isSafeInteger(local.length)||typeof local.key!=='function')fail('STORAGE_ENUMERATION_UNAVAILABLE');return Array.from({length:local.length},(_,i)=>local.key(i)).filter(isLocalDeviceKey)};
 const removeDatabase=name=>new Promise((resolve,reject)=>{
  // A blocked request cannot be cancelled. Keep the durable fence even if it
  // finishes after the timeout. Never resume ordinary saving after this error.
  const timer=setTimeout(()=>reject(Error('LOCAL_RESET_STOP:DATABASE_DELETE_TIMEOUT')),timeoutMs);
  let request;try{request=idb.deleteDatabase(name)}catch{clearTimeout(timer);reject(Error('LOCAL_RESET_STOP:DATABASE_DELETE_FAILED'));return}
  request.onsuccess=()=>{clearTimeout(timer);resolve()};
  request.onerror=()=>{clearTimeout(timer);reject(Error('LOCAL_RESET_STOP:DATABASE_DELETE_FAILED'))};
  request.onblocked=()=>{clearTimeout(timer);reject(Error('LOCAL_RESET_STOP:OTHER_DATABASE_CONNECTION_OPEN'))};
 });
 const exclusively=async fn=>{
  if(executing)fail('ALREADY_RUNNING');
  const result=await presence.withExclusiveIfNoPeers(async()=>{if(executing)fail('ALREADY_RUNNING');executing=true;try{return await fn()}finally{executing=false}});
  if(result?.rebased===false)fail(result.reason==='PEER_TAB_PRESENT'?'CLOSE_OTHER_TABS':'TAB_LOCK_UNAVAILABLE');return result;
 };
 return Object.freeze({phase,assertUsable,
  async join(){await presence.withForeground(()=>{});return phase()},
  async erase({confirmed=false,otherTabsClosed=false}={}){
   if(confirmed!==true||otherTabsClosed!==true)fail('FINAL_CONFIRMATION_REQUIRED');
   return exclusively(async()=>{
    if(generation()!==epoch)fail('GENERATION_CHANGED');
    if(phase()==='complete')fail('ALREADY_DELETED');
    // Enumeration and an idle check happen before the first destructive write.
    const targets=await listDatabases();keys();
    if(phase()===null){assertUsable();await beforeErase();if(epoch===Number.MAX_SAFE_INTEGER)fail('GENERATION_EXHAUSTED');
     write(LOCAL_RESET_KEY,'pending');stopped=true;write(LOCAL_GENERATION_KEY,String(epoch+1));epoch++;}
    else stopped=true;
    onFenced();
    // Keep the automatic key until all record/credential/anchor DB deletions
    // have completed. Failure never reports success or recreates an empty WAL.
    targets.sort((a,b)=>Number(a==='formal-production:anilog-FORMAL-AUTOMATIC-DEVICE-KEY')-Number(b==='formal-production:anilog-FORMAL-AUTOMATIC-DEVICE-KEY'));
    for(const name of targets)await removeDatabase(name);
    if((await listDatabases()).length)fail('DATABASE_DELETE_NOT_CONFIRMED');
    for(const key of keys()){local.removeItem(key);if(local.getItem(key)!==null)fail('STORAGE_DELETE_NOT_CONFIRMED')}
    if(session){session.removeItem('anilog-sync-qr-dialog-open-v1');if(session.getItem('anilog-sync-qr-dialog-open-v1')!==null)fail('SESSION_DELETE_NOT_CONFIRMED')}
    if(keys().length)fail('STORAGE_DELETE_NOT_CONFIRMED');
    write(LOCAL_RESET_KEY,'complete');return {phase:'LOCAL_DATA_DELETED',deletedDatabases:targets.length};
   });
  },
  async startFresh(){return exclusively(async()=>{
   if(phase()!=='complete'||generation()!==epoch)fail('DELETE_NOT_COMPLETE');
   if((await listDatabases()).length||keys().length)fail('UNEXPECTED_LOCAL_DATA');
   local.removeItem(LOCAL_RESET_KEY);if(phase()!==null)fail('FENCE_CLEAR_FAILED');
   // This old realm stays stopped. Only a fresh document may initialize.
   return {phase:'FRESH_DOCUMENT_REQUIRED'};
  })},
  close:()=>presence.close()
 });
}

export function installLocalDeviceResetUI({document,reset,openButton,onBackup,onFresh,siteOrigin=globalThis.location?.origin}={}){
 const dialog=document.createElement('dialog');dialog.id='anilog-local-reset-dialog';dialog.className='anilog-first-wal-upgrade anilog-local-reset';
 dialog.setAttribute('aria-labelledby','anilog-local-reset-title');
 const title=document.createElement('h2');title.id='anilog-local-reset-title';title.textContent='この端末の記録を削除';
 const description=document.createElement('p');description.textContent='このブラウザ・このサイトの視聴記録、未送信の変更、すべての接続プロフィール、暗号化WAL・鍵・接続情報を削除します。元に戻せません。他端末と同期先の記録・登録は削除しません。';
 const site=document.createElement('p');site.textContent='対象サイト：'+new URL(siteOrigin).host;
 const ownerWarning=document.createElement('p');ownerWarning.textContent='同期登録が残るプロフィールがある場合は削除できません。管理端末の引き継ぎ・同期グループ全体の終了は現在未対応です。';
 const caveat=document.createElement('p');caveat.textContent='バックアップは任意です。必要な場合だけ保存してください。このサイトの他のタブを閉じてください。古い版のタブの有無は自動確認できません。';
 const label=document.createElement('label'),check=document.createElement('input'),ack=document.createElement('span');check.type='checkbox';check.dataset.localReset='confirm';ack.textContent='他のタブを閉じ、この端末の記録を削除することを確認しました';label.append(check,ack);
 const actions=document.createElement('div');actions.className='anilog-first-wal-upgrade-actions';
 const backup=document.createElement('button'),accept=document.createElement('button'),cancel=document.createElement('button'),fresh=document.createElement('button');
 for(const b of [backup,accept,cancel,fresh])b.type='button';
 backup.textContent='バックアップを書き出す（任意）';accept.textContent='この端末の記録を削除する';cancel.textContent='キャンセル';fresh.textContent='空の状態で使い始める';fresh.hidden=true;accept.disabled=true;
 actions.append(backup,accept,cancel,fresh);const status=document.createElement('p');status.setAttribute('role','status');status.dataset.localReset='status';
 dialog.append(title,site,description,ownerWarning,caveat,label,actions,status);document.body.append(dialog);let running=false;
 const show=()=>{check.checked=false;accept.disabled=true;const p=reset.phase();fresh.hidden=p!=='complete';accept.hidden=p==='complete';label.hidden=p==='complete';backup.hidden=p!==null;cancel.hidden=p!==null;status.textContent=p==='complete'?'この端末の記録を削除しました。':p==='pending'?'前回の削除が完了していません。通常の保存・同期は停止しています。確認して削除を再開してください。':'';if(!dialog.open)dialog.showModal()};
 openButton?.addEventListener('click',show);
 check.addEventListener('change',()=>{accept.disabled=!check.checked||running});
 cancel.addEventListener('click',()=>{if(!running)dialog.close()});
 dialog.addEventListener('cancel',e=>{if(running||reset.phase()!==null)e.preventDefault()});
 backup.addEventListener('click',()=>{try{onBackup()}catch{status.textContent='バックアップを書き出せませんでした。削除はまだ実行していません。'}});
 accept.addEventListener('click',async()=>{
  if(running||!check.checked)return;running=true;accept.disabled=true;backup.disabled=true;cancel.disabled=true;
  try{await reset.erase({confirmed:check.checked,otherTabsClosed:check.checked});show()}
  catch(error){const code=String(error?.message??'');status.textContent=reset.phase()===null?
   code.endsWith(':CLOSE_OTHER_TABS')?'他のANI:LOGタブを閉じてから、もう一度確認してください。データは削除していません。':
   /:(?:SERVER_RELEASE_REQUIRED|REGISTRATION_STATE_REQUIRED|REGISTRATION_STATE_CHANGED)$/.test(code)?'同期登録の解除完了を、すべてのプロフィールで確認する必要があります。管理端末は現在解除できません。データは削除していません。':'保存・同期・編集中の操作を終えてから、もう一度確認してください。データは削除していません。':
   '削除を完了できませんでした。一部のデータが削除されている可能性があります。他のタブを閉じ、確認して削除を再開してください。';cancel.hidden=reset.phase()!==null;backup.hidden=reset.phase()!==null;check.checked=false;}
  finally{running=false;backup.disabled=false;cancel.disabled=false;accept.disabled=!check.checked;}
 });
 fresh.addEventListener('click',async()=>{if(running)return;running=true;fresh.disabled=true;try{await reset.startFresh();onFresh()}catch{status.textContent='新しく開始できません。他のタブを閉じ、ページを再読み込みして状態を確認してください。';running=false;fresh.disabled=false;}});
 return Object.freeze({show});
}
