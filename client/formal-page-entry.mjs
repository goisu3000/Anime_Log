/* Formal development HTML integration. Network stays OFF unless a caller has
 * explicit independent approval; no cloud configuration is embedded here. */
import {createFormalDevelopmentANIPrimary} from './v408-https-staging-encrypted-primary.mjs';
import {createFormalStorage,decodeFormalBackup,freezeLegacyCopy} from './formal-storage.mjs';
import {prepareV411StagingPanel} from './v411-https-staging-page-entry.mjs';
import {createV408StagingSealedDeviceCredentials,V408_CREDENTIAL_DB} from './v408-https-staging-sealed-credentials.mjs';
import {adoptFormalOwnerBaseline} from './formal-owner-baseline.mjs';
import {provisionV409BrowserOwner} from './v409-browser-owner-first-setup.mjs';
import {prepareFormalMigration} from './formal-migration.mjs';
import {createAutomaticSync} from './automatic-sync.mjs';
import {createAutomaticDeviceKey} from './automatic-device-key.mjs';
import './formal-simple-page.mjs';
export function attachFormalPairing({root,ui,vault,storage,siteOrigin,apiOrigin,networkApproved=false,initialOwnerApproved=false,
 expectedOwnerPage='/',independentVault,onSession,getPassphrase,getInitialLocalApp,
 idb=globalThis.indexedDB,locks=globalThis.navigator?.locks,browserFetch=globalThis.fetch,
 location=globalThis.location,history=globalThis.history}={}){
 if(networkApproved!==true)throw Error('FORMAL_NETWORK_APPROVAL_REQUIRED');
 // An unlocked migrated vault is not an empty first receiver. Establishing
 // its initial server baseline needs a separately reviewed owner bootstrap;
 // never reinterpret its local genesis as a confirmed remote checkpoint.
 if(vault?.getState?.()==='ACTIVE'){
  const line=vault.readCurrent().weeklyOptions.__syncLineage;
  storage?.assertSyncHistory(line?{api:apiOrigin,boxId:line.boxId}:undefined);
  if(!vault.readSyncCheckpoint()&&initialOwnerApproved!==true)throw Error('FORMAL_INITIAL_OWNER_BASELINE_REQUIRED');
 }
 const isolatedIDB={open:(name,...args)=>idb.open(name===V408_CREDENTIAL_DB?'anilog-FORMAL-DEVELOPMENT-SEALED-CREDENTIALS':name,...args)};
 const isolatedLocks={request:(name,...args)=>locks.request('formal-development:'+name,...args)};
 const connectedUI=storage?{...ui,commitSaved:(records,weekly)=>{
  storage.attachVerified();ui.commitSaved(records,weekly);
  const status=root.querySelector('[data-formal="status"]');
  if(status)status.textContent='解錠済み：暗号化保存を確認しました。非本番の手動同期試験。';
 }}:ui;
 const captured=typeof window!=='undefined'?window.__v407TakePairingURL?.():null;
 return prepareV411StagingPanel({root,ui:connectedUI,siteOrigin,apiOrigin,idb,locks,browserFetch,location:captured??location,history,onSession,getPassphrase,getInitialLocalApp,
  provisionOwner:async args=>{
   const phase=vault.getState()==='ACTIVE'?'ACTIVE':(await vault.inspectReadOnly()).phase;
   if(phase==='EMPTY_LOCKED')return provisionV409BrowserOwner({...args,expectedOwnerPage});
   if(initialOwnerApproved!==true)throw Error('FORMAL_INITIAL_OWNER_BASELINE_REQUIRED');
   if(!storage?.ready){const app=await storage.unlock(args.passphrase);ui.commitSaved(app.records,app.weeklyOptions)}
   return adoptFormalOwnerBaseline({...args,expectedOwnerPage,networkApproved,initialOwnerApproved,storage,ui:connectedUI,
    independentVault:independentVault??(()=>createFormalDevelopmentANIPrimary({idb,locks}))});
  },
  beforeSync:()=>{const line=vault.readCurrent().weeklyOptions.__syncLineage;
   storage.assertSyncHistory(line?{api:apiOrigin,boxId:line.boxId}:undefined)},
  createVault:()=>vault,createCredentials:()=>createV408StagingSealedDeviceCredentials({idb:isolatedIDB,locks:isolatedLocks})});
}
if(typeof document!=='undefined'&&document.querySelector('meta[name="ani-log-formal-production-approval"]')?.content!=='approved-private-production'&&document.querySelector('meta[name="ani-log-sync-integration"]')?.content==='formal-development;sync-off'&&
 window.__aniFormalEncrypted===true){
 const ui=window.__formalUI,root=document.getElementById('formal-sync-controls');
 root.hidden=false;
 const status=root.querySelector('[data-formal="status"]'),pass=root.querySelector('[data-v407="passphrase"]');
 const vault=createFormalDevelopmentANIPrimary();
 let automatic=null;
 const storage=createFormalStorage({vault,independentVault:()=>createFormalDevelopmentANIPrimary(),onCommitted:()=>automatic?.changed()});
 const automaticApproved=document.querySelector('meta[name="ani-log-automatic-sync-approval"]')?.content==='approved-private-automatic';
 const deviceKeys=automaticApproved?createAutomaticDeviceKey():null;
 Object.defineProperty(window,'__formalStorage',{value:storage});
 Object.defineProperty(window,'__formalDecodeBackup',{value:decodeFormalBackup});
 // Frozen migration files are user-supplied copies, not access to legacy origin.
 let frozen=null,sourceRaw=null,backupRaw=null;
 root.querySelector('[data-formal="independent-backup"]').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';backupRaw=null;
  if(file&&file.size<=12000000)backupRaw=await file.text();
 });
 root.querySelector('[data-formal="source"]').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{if(file.size>12000000)throw Error('SOURCE_TOO_LARGE');
   sourceRaw=await file.text();const app=decodeFormalBackup(sourceRaw);frozen=JSON.stringify(app);
   status.textContent='コピーを検証しました。元データは変更していません。取り込み開始で暗号化保存します。';
  }catch{frozen=null;sourceRaw=null;status.textContent='コピーの検証に失敗しました。元データと保存領域は変更していません。'}
 });
 const run=async action=>{
  let password=pass.value;pass.value='';
  for(const b of root.querySelectorAll('[data-formal-action]'))b.disabled=true;
  try{
   if(deviceKeys&&!password){password=await deviceKeys.read();
    if(!password){if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('AUTOMATIC_KEY_MISSING_KEEP_EXISTING_VAULT');
     password=await deviceKeys.create({emptyVaultConfirmed:true})}}
   const app=await action(password);ui.hydrate(app);
   status.textContent='解錠済み：暗号化保存を確認しました。同期OFF。';
  }catch(error){
   if(error.message==='FORMAL_STORAGE_STOP:DESTINATION_NOT_EMPTY'){
    status.textContent='既存の開発用保存領域があります。初期化は行っていません。最初に使った開発用パスフレーズを入力し「保存済みデータを解錠」を押してください。';
    root.querySelector('[data-formal="unlock"]').disabled=false;
   }else status.textContent='操作を停止しました。保存領域を消去しないでください。 '+String(error.message).replace(/https?:\/\/\S+/g,'[URL省略]');
  }
 };
 root.querySelector('[data-formal="initialize"]').addEventListener('click',()=>run(async password=>{
  let candidate=frozen;
  const from=root.querySelector('[data-formal="source-origin"]').value.trim();
  if(from||backupRaw!==null){const migration=await prepareFormalMigration({sourceRaw,backupRaw,sourceOrigin:from,targetOrigin:location.origin,
   independentBackupConfirmed:root.querySelector('[data-formal="backup-confirmed"]').checked,
   oldClientsClosedConfirmed:root.querySelector('[data-formal="cutover-confirmed"]').checked});candidate=JSON.stringify(migration.app)}
  return storage.initializeFrozen(candidate??freezeLegacyCopy({recordsRaw:'{}',weeklyRaw:'{"open":false,"statuses":["watching"]}',tombstonesRaw:'{}'}),password);
 }));
 root.querySelector('[data-formal="unlock"]').addEventListener('click',()=>run(password=>storage.unlock(password)));
 // Production/SYNC_ON approval is absent: do not attach network event handlers.
 status.textContent='未解錠：再読み込み後は解錠が必要です。一覧が空でも保存データを消去しないでください。同期OFF。';
 // Trusted build-time metadata only. Ordinary local artifacts contain "none"
 // and an empty API, so they never mount network handlers. No URL/query toggle.
 if(document.querySelector('meta[name="ani-log-formal-stage-approval"]')?.content==='approved-isolated-formal-stage'){
  root.querySelector('strong').textContent='正式本体・開発用コピー／非本番の手動同期試験';
  try{
   const running=attachFormalPairing({root,ui,vault,storage,siteOrigin:location.origin,
    apiOrigin:document.querySelector('meta[name="ani-log-stage-api-origin"]')?.content,networkApproved:true,
    initialOwnerApproved:document.querySelector('meta[name="ani-log-formal-initial-owner-approval"]')?.content==='approved-equal-baseline',
    expectedOwnerPage:document.querySelector('meta[name="ani-log-formal-owner-page"]')?.content,
    getInitialLocalApp:async()=>{
     if(!frozen||!Object.keys(JSON.parse(frozen).records).length)return undefined;
     const result=await prepareFormalMigration({sourceRaw,backupRaw,sourceOrigin:root.querySelector('[data-formal="source-origin"]').value.trim(),targetOrigin:location.origin,
      independentBackupConfirmed:root.querySelector('[data-formal="backup-confirmed"]').checked,oldClientsClosedConfirmed:root.querySelector('[data-formal="cutover-confirmed"]').checked});
     return result.app;
    },
    getPassphrase:deviceKeys?async()=>{
     const existing=await deviceKeys.read();if(existing)return existing;
     if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('AUTOMATIC_KEY_MISSING_KEEP_EXISTING_VAULT');
     return deviceKeys.create({emptyVaultConfirmed:true});
    }:undefined,
    onSession:(session,freshSession)=>{
     if(document.querySelector('meta[name="ani-log-automatic-sync-approval"]')?.content!=='approved-private-automatic')return;
     automatic?.stop();automatic=createAutomaticSync({syncOnce:async()=>{const next=await freshSession();return next.syncOnce()},onState:s=>{
      const labels={syncing:'同期中',pending:'端末に保存済み・未同期',synced:'同期済み',offline:'端末に保存済み・通信復旧時に同期します',conflict:'競合のため同期を一時停止しています。両方の記録を保持しています。'};
      status.textContent='解錠済み：'+labels[s.phase];
      if(s.phase==='synced')void running.confirmAutomaticRole();
      let conflicts=root.querySelector('[data-formal="conflicts"]');
      if(!conflicts){conflicts=document.createElement('pre');conflicts.dataset.formal='conflicts';root.append(conflicts)}
      conflicts.hidden=s.phase!=='conflict';
      conflicts.textContent=s.phase==='conflict'?'双方を確認し、通常の編集画面で残したい値を保存してから再同期してください。\n'+
       (s.conflicts??[]).map(c=>c.path+'\nこの端末: '+JSON.stringify(c.local)+'\n同期先: '+JSON.stringify(c.remote)).join('\n'):'';
      const retry=root.querySelector('[data-v407="sync"]');retry.hidden=s.phase!=='conflict';
      if(s.phase==='conflict'){retry.disabled=false;retry.textContent='競合を確認して再同期'}
     }});automatic.start();
    }});
   Object.defineProperty(window,'__formalPairing',{value:running,writable:false,configurable:false});
   if(automaticApproved){
    const retry=root.querySelector('[data-v407="sync"]');retry.hidden=true;
    retry.addEventListener('click',event=>{if(!automatic)return;event.stopImmediatePropagation();automatic.resumeAfterConflict()},{capture:true});
   }
   if(deviceKeys)void(async()=>{
    const password=await deviceKeys.read();if(!password)return;
    const check=createFormalDevelopmentANIPrimary();await check.unlock(password);
    if(check.readSyncCheckpoint())await running.resumeAutomatic({passphrase:password});
    else{const app=await storage.unlock(password);ui.hydrate(app)}
    status.textContent='端末内の暗号化記録を復元しました。';
   })().catch(()=>{status.textContent='自動復元を停止しました。保存データを消去せず、バックアップと端末の状態を確認してください。'});

  }catch(error){status.textContent='接続準備を停止しました。保存領域は消去しないでください。 '+String(error.message).replace(/https?:\/\/\S+/g,'[URL省略]')}
 }
}
