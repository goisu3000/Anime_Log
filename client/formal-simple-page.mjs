import {createFormalProductionANIPrimary} from './v408-https-staging-encrypted-primary.mjs';
import {createFormalStorage,decodeFormalBackup} from './formal-storage.mjs';
import {createAutomaticDeviceKey} from './automatic-device-key.mjs';
import {createFormalSetup,LOCAL_MODE} from './formal-setup.mjs';
import {createRegistrationIntentStore} from './registration-intent.mjs';
import {prepareFormalRegistration,preparePairedFormalRegistration,completeFormalRegistration} from './formal-registration.mjs';
import {requestRegistrationChallenge} from './registration-challenge.mjs';
import {prepareV411StagingPanel} from './v411-https-staging-page-entry.mjs';
import {createV408StagingSealedDeviceCredentials,V408_CREDENTIAL_DB} from './v408-https-staging-sealed-credentials.mjs';
import {createAutomaticSync} from './automatic-sync.mjs';

// The existing encrypted invitation envelope also owns the candidate identity.
// Bind every read/CAS to the exact selected invitation, including across tabs.
export function createEncryptedReceiverClaimStore({invitations,invitation,getPassphrase}){
 return {
  async read(){
   const saved=await invitations.read(await getPassphrase());
   if(saved?.href!==invitation.href||saved?.hash!==invitation.hash)throw Error('INVITATION_CHANGED_KEEP_RECORDS');
   return saved.claimAttempt??null;
  },
  async write(expected,next){
   const password=await getPassphrase(),saved=await invitations.read(password);
   if(saved?.href!==invitation.href||saved?.hash!==invitation.hash||
      JSON.stringify(saved.claimAttempt??null)!==JSON.stringify(expected))throw Error('INVITATION_CHANGED_KEEP_RECORDS');
   await invitations.replace(saved,{...saved,claimAttempt:next},password);
  }
 };
}

export async function mountFormalSimpleSync({document=globalThis.document,window=globalThis.window,local=globalThis.localStorage,
 locks=globalThis.navigator?.locks,location=globalThis.location,idb=globalThis.indexedDB,browserFetch=globalThis.fetch}={}){
 const root=document.getElementById('formal-simple-sync');if(!root)return;
 const el=name=>root.querySelector('[data-simple="'+name+'"]'),status=el('status');
 const summary=root.querySelector('summary');
 const attention=required=>{if(summary)summary.textContent=required?'端末間同期（要確認）':'端末間同期'};
 const meta=name=>document.querySelector('meta[name="'+name+'"]')?.content;
 const approved=meta('ani-log-formal-production-approval')==='approved-private-production';
 let api;try{api=new URL(meta('ani-log-production-api-origin'));if(api.protocol!=='https:'||api.origin!==meta('ani-log-production-api-origin')||api.origin===location.origin)throw Error()}catch{api=null}
 if(!approved||!api){
  el('setup').hidden=true;
  // A previously encrypted device must NEVER be presented as an empty,
  // ordinary legacy OFF account when the approved sync configuration is absent.
  // Do not silently read or reset its old localStorage copy.
  if(local.getItem(LOCAL_MODE)!==null){
   attention(true);
   status.textContent='以前の同期記録は保護されたままです。現在の画面では読み込めません。保存データを消さずに接続設定を確認してください。';
  }else status.textContent='同期OFF：この端末に自動保存します。同期接続は現在無効です。';
  return;
 }
 const factory=()=>createFormalProductionANIPrimary({idb,locks}),vault=factory();
 let automatic=null,running=null,busy=false,downloaded=null;
 const storage=createFormalStorage({vault,independentVault:factory,onCommitted:()=>automatic?.changed()});
 const scopedIDB={open:(name,...args)=>idb.open(name===V408_CREDENTIAL_DB?'anilog-FORMAL-PRODUCTION-SEALED-CREDENTIALS':'formal-production:'+name,...args)};
 const scopedLocks={request:(name,...args)=>locks.request('formal-production:'+name,...args)};
 const keys=createAutomaticDeviceKey({idb:scopedIDB,locks:scopedLocks,origin:location.origin});
 const setup=createFormalSetup({local,locks,storage,vault,independentVault:factory,deviceKeys:keys,origin:location.origin});
 const intents=createRegistrationIntentStore({idb:scopedIDB,locks:scopedLocks,origin:location.origin});
 const invitations=createRegistrationIntentStore({idb:{open:(name,...args)=>scopedIDB.open('receiver:'+name,...args)},locks:scopedLocks,origin:location.origin});
 const captured=window.__v407TakePairingURL?.();
 const receiving=captured?.hash?.startsWith('#anilog-pair=');
 function message(error){attention(true);status.textContent='端末の記録と原本を保持しています。接続を再試行できます。';el('retry').hidden=false;
  // No exception object, credentials, QR URL or source records enter logs/DOM.
  if(String(error?.message).includes('CONFLICT')||String(error?.message).includes('DIFFERS'))status.textContent='異なる記録があるため設定を停止しました。原本とバックアップを保持し、上書きはしていません。';}
 async function action(fn){if(busy)return;busy=true;el('begin').disabled=true;el('retry').disabled=true;
  try{await fn()}catch(error){message(error)}finally{busy=false;el('retry').disabled=false}}
 el('backup').addEventListener('click',()=>{
  // A previous checkbox confirmation is not proof that a NEW backup was saved.
  downloaded=null;el('confirmed').checked=false;el('begin').disabled=true;
  try{
   const raw=setup.capture(),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='anime-log-before-sync.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   // The browser does not expose whether the file reached the user's disk.
   // The user must explicitly confirm it AFTER triggering the download.
   downloaded=raw;
  }catch(error){message(error)}
 });
 el('confirmed').addEventListener('change',()=>{el('begin').disabled=!downloaded||!el('confirmed').checked||busy});
 async function beginOrResume(){
  const currentMode=local.getItem(LOCAL_MODE);
  // A prior attempt can leave a safely fenced preparing state. Complete the
  // existing transition instead of trying registration with a locked vault.
  if(currentMode==='preparing'){await setup.resume();location.reload();return}
  if(currentMode==='encrypted-local'){location.reload();return}
  if(currentMode!==null||!downloaded||!el('confirmed').checked)throw Error('BACKUP_CONFIRMATION_REQUIRED');
  const result=await setup.begin({backupRaw:downloaded,backupSaved:true,oldClientsClosed:true,role:receiving?'receiver':'owner'});
  if(receiving)await invitations.create(captured,result.passphrase);
  location.reload();
 }
 el('begin').addEventListener('click',()=>action(beginOrResume));
 const mode=local.getItem(LOCAL_MODE);
 if(!mode){
  // This page is mounted before the first opt-in. A failure may occur after
  // the durable cutover fence is written, while the current JS mount still
  // follows the legacy branch. The visible retry must never be inert.
  el('retry').addEventListener('click',()=>action(async()=>{
   // A new mount re-reads the durable receipt/mode and resumes the exact
   // interrupted step. It cannot silently start a new registration.
   location.reload();
  }));
  return {phase:'LEGACY_OFF',storage,vault,setup};
 }
 el('setup').hidden=true;
 Object.defineProperty(window,'__formalStorage',{value:storage});
 Object.defineProperty(window,'__formalDecodeBackup',{value:decodeFormalBackup});
 const ui=window.__formalUI;if(!ui)throw Error('FORMAL_ENCRYPTED_UI_REQUIRED');
 let restored;
 try{restored=await setup.resume()}
 catch(error){
  // A power loss or temporary lock error can leave the cutover in the durable
  // 'preparing' state. The legacy app is already write-fenced. Do not leave a
  // dead settings panel: give a safe retry of the same protected transition.
  message(error);
  if(mode==='preparing'){
   el('retry').textContent='設定を再開';
   el('retry').addEventListener('click',()=>action(async()=>{
    await setup.resume();location.reload();
   }));
  }else{
   // Do not manufacture an empty vault or fall back to outdated localStorage.
   el('retry').hidden=true;
   status.textContent='端末内の暗号化記録を保護したまま停止しました。データを消さずに接続設定を確認してください。';
  }
  return {phase:'SAFE_SETUP_RECOVERY_REQUIRED',storage,vault,setup};
 }
 ui.hydrate(restored.app);
 status.textContent='端末内の記録を復元しました。';
 const panelRoot=document.getElementById('formal-sync-controls');
 // Reuse the existing QR panel, hide developer-only bootstrap/unlock controls.
 for(const n of panelRoot.children)if(n.id!=='v407-pairing')n.hidden=true;
 const panelUI=panelRoot.querySelector('#v407-pairing');root.append(panelRoot);panelRoot.hidden=false;
 for(const selector of ['[data-v408="box-id"]','[data-v408="unlock-owner"]','[data-v409="first-owner"]','[data-v407="repair"]','[data-v407="sync"]'])panelUI.querySelector(selector).hidden=true;
 panelUI.querySelector('[data-v407="invite"]').textContent='別の端末を追加（QR）';
 // A QR scan plus a confirmed local cutover is sufficient to submit the
 // receiver claim. The owner still approves the exact six digits explicitly.
 // Keep only the actions relevant to this device; staging diagnostics remain
 // untouched and this does not alter any security checks.
 const receiver=setup.readReceipt().role==='receiver';
 const hide=selector=>{const node=panelUI.querySelector('[data-v407="'+selector+'"]');if(node)node.hidden=true};
 hide('refresh');hide('claim');hide('sync');
 if(receiver){
  for(const id of ['invite','copy','qr','code','approve','receive','repair'])hide(id);
  panelUI.querySelector('[data-v407="check"]').textContent='接続を完了';
 }else{for(const id of ['receiver-code','check','receive','repair'])hide(id)}
 function schedule(_session,fresh){
  automatic?.stop();automatic=createAutomaticSync({syncOnce:async()=>{const s=await fresh();return s.syncOnce()},onState:s=>{
   const labels={syncing:'同期中',synced:'同期済み',pending:'端末に保存済み・未同期',offline:'端末に保存済み・オンライン復帰時に同期',
    unavailable:'同期できませんでした。記録は端末に保存済みです。接続を再試行できます。',
    conflict:'競合を確認してください。両方の記録を保持しています。'};
   status.textContent=labels[s.phase]??'端末に保存済み';
   // A closed settings panel must not hide unresolved sync errors. Keep the
   // notice until a later *confirmed* success instead of blinking on edits.
   if(s.phase==='synced')attention(false);
   else if(s.phase==='conflict'||s.phase==='unavailable'||['blocked','too-large','unconfirmed'].includes(s.status))attention(true);
   el('conflicts').hidden=s.phase!=='conflict';
   el('conflicts').textContent=s.phase==='conflict'?(s.conflicts??[]).map(c=>c.path+'\nこの端末: '+JSON.stringify(c.local)+'\n同期先: '+JSON.stringify(c.remote)).join('\n'):'';
   el('retry').hidden=!['conflict','offline','pending','unavailable'].includes(s.phase);
   el('retry').textContent=s.phase==='conflict'?'内容を確認して再同期':'接続を再試行';
   if(s.phase==='synced')void running?.confirmAutomaticRole();
  }});automatic.start();
  // A registered receiver has no further pairing actions. Avoid leaving a
  // disabled "complete connection" button beside normal watchlist usage.
  if(receiver){hide('check');hide('receiver-code')}
 }
 // A failed/expired QR must not permanently pin the new device to an
 // unusable invitation. An explicitly rescanned fresh QR replaces only this
 // encrypted invitation, never its local records or any already-authorized
 // registration intent. The latter must be resumed rather than overwritten.
 const pendingIntent=receiver?await intents.read(restored.passphrase):null;
 let invitation=receiver?await invitations.read(restored.passphrase):null;
 if(receiver&&mode==='encrypted-local'&&!pendingIntent&&receiving){
  if(!invitation)await invitations.create(captured,restored.passphrase);
  else if(invitation.href!==captured.href||invitation.hash!==captured.hash)
   await invitations.replace(invitation,captured,restored.passphrase);
  invitation=captured;
 }
 if(mode!=='encrypted-local'||pendingIntent)invitation=null;
 const claimStore=invitation?createEncryptedReceiverClaimStore({invitations,invitation,getPassphrase:()=>keys.read()}):undefined;
 running=prepareV411StagingPanel({root:panelRoot,ui:{...ui,commitSaved:(r,w)=>{storage.attachVerified();ui.commitSaved(r,w)}},
  siteOrigin:location.origin,apiOrigin:api.origin,formalProduction:true,autoClaimReceiver:receiver&&!!invitation?.hash?.startsWith('#anilog-pair='),idb,locks,browserFetch,location:invitation??location,history:window.history,
  createVault:()=>vault,createCredentials:()=>createV408StagingSealedDeviceCredentials({idb:scopedIDB,locks:scopedLocks}),claimStore,
  getPassphrase:()=>keys.read(),onSession:schedule,
  receiveIntoLocal:async({transport,device,masterKey,passphrase})=>{
   try{
    await preparePairedFormalRegistration({apiOrigin:api.origin,siteOrigin:location.origin,storage,vault,intentStore:intents,passphrase,transport,device,masterKey,independentVault:factory});
    await register({fromPairing:true});
    return {phase:'FIRST_RECEIVER_AND_SEALED_DEVICE_VERIFIED',serverRevision:vault.readSyncCheckpoint().serverRevision,records:Object.keys(storage.read().records).length};
   }finally{masterKey.fill(0)}
  },beforeSync:()=>{const line=storage.read().weeklyOptions.__syncLineage;storage.assertSyncHistory({api:api.origin,boxId:line?.boxId})}});
 async function register({fromPairing=false}={}){
  const password=await keys.read();if(!password)throw Error('SETUP_KEY_REQUIRED');
  const existing=await intents.read(password);
  if(!existing){if(receiver)throw Error('RECEIVER_APPROVAL_REQUIRED');
   await prepareFormalRegistration({registrationMode:'self-service',apiOrigin:api.origin,siteOrigin:location.origin,storage,vault,intentStore:intents,passphrase:password,independentVault:factory});}
  const result=await completeFormalRegistration({networkApproved:true,apiOrigin:api.origin,siteOrigin:location.origin,pageOrigin:location.origin,
   storage,vault,intentStore:intents,passphrase:password,independentVault:factory,sealedCredentials:running.sealedCredentials,ui,uiBridge:running.bridge,locks,browserFetch,
   getChallenge:({binding})=>requestRegistrationChallenge({apiOrigin:api.origin,binding,container:el('challenge'),document,events:window})});
  await setup.confirmEnabled({apiOrigin:api.origin,boxId:result.boxId,credentialsVerified:true});
  // Reload follows a durable ON marker; startup uses the same password-free
  // restore path as every later visit. No credentials are inserted into inputs.
  if(!receiver)location.reload();
  else if(!fromPairing)await running.resumeAutomatic({passphrase:password});
  return result;
 }
 el('retry').addEventListener('click',()=>action(async()=>{
  if(automatic){automatic.resumeAfterConflict();return}
  const currentMode=local.getItem(LOCAL_MODE);
  if(currentMode==='sync-enabled'){
   // Restarting a connected device is not another first registration.
   await running.resumeAutomatic({passphrase:await keys.read()});return;
  }
  if(currentMode==='preparing'||currentMode===null){await beginOrResume();return}
  if(currentMode==='encrypted-local'){await register();return}
  throw Error('UNKNOWN_SETUP_STATE_KEEP_ORIGINAL');
 }));
 if(mode==='sync-enabled'){
  await running.resumeAutomatic({passphrase:await keys.read()});
 }else if(!receiver||await intents.read(restored.passphrase))await action(register);
 else status.textContent=invitation?'この端末の記録を保持しています。招待を受け取り、6桁照合後に統合します。':'記録を保持しています。設定元の端末で新しい招待QRを作成し、もう一度読み取ってください。';
 return {phase:'FORMAL_OPT_IN_MOUNTED',storage,vault,setup};
}
if(typeof document!=='undefined')void mountFormalSimpleSync().catch(()=>{
 const status=document.querySelector('[data-simple="status"]');if(status)status.textContent='保存データを保持したまま設定を停止しました。初期化・消去はしないでください。';
 const summary=document.querySelector('#formal-simple-sync summary');if(summary)summary.textContent='端末間同期（要確認）';
});
