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
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';
import {appToSnapshot} from './app-bridge.mjs';
import {parsePairingUrl} from './pairing-client.mjs';
import {canonical} from './formal-storage.mjs';
/* Per-device local connection profiles. The old encrypted original/credential
 * stores are NEVER deleted. A new box is joined in a separate encrypted WAL;
 * the active pointer changes only after an independently verified pairing.
 * This module stores no records, QR secrets, box IDs, tokens, or keys. */
// Read-only diagnostics: never read or serialize conflict values. Unknown
// property names are masked because custom JSON keys may contain private text.
export function summarizeSyncConflictPaths(conflicts){
 const fields=new Set(['id','title','status','watchedEpisodes','episodes','year','season','type','score','members','scoredBy','english','synonyms','image','updatedAt','myRankOrder','rankUpdatedAt','review','overall','aspects','story','visual','characters','music','note','text','noteDeletedAt','reviewDeletedAt','completedOn','nextWatchPinnedAt','streamPreference','service','url','weeklySchedule','mode','day','time','weeklyOptions','statuses','syncLineage','analysisMeta','studios','genres','themes','fetchedAt','deletedAt']);
 const reasons=new Set(['concurrent-edit','missing-without-tombstone',...['live','deleted','absent'].flatMap(a=>['live','deleted','absent'].map(b=>a+'-versus-'+b))]);
 if(!Array.isArray(conflicts))return [];
 return conflicts.map(c=>{
  const parts=typeof c?.path==='string'?c.path.split('/'):[];
  const root=parts[0];let path='[unknown-path]';
  if(['records','tombstones','works','settings'].includes(root)){
   path=parts.map((p,i)=>i===0?p:i===1&&root!=='settings'?(/^(?:jikan:[1-9][0-9]*|custom:[0-9]+:[A-Za-z0-9_-]+)$/.test(p)?p:'[record-id]'):fields.has(p)||/^[0-9]{1,4}$/.test(p)?p:'[unknown-field]').join('/');
  }
  return Object.freeze({path,reason:reasons.has(c?.reason)?c.reason:'unknown-conflict'});
 });
}
export const CONNECTION_PROFILE_KEY='anilog-sync-connection-profile-v1';
const VALID=/^(?:legacy|p[1-9][0-9]?)$/;
const profileFail=x=>{throw Error('CONNECTION_PROFILE_STOP:'+x)};
// Only an ACTIVE connection may retry its existing session. A scanned QR on an
// already-linked device is NOT permission to silently switch destinations.
// Disconnected / staged switches follow their separate, guarded QR workflow.
export function classifyExistingSyncRetry({mode,profilePhase,scannedQrIgnored=false}={}){
 if(mode!=='sync-enabled')return 'NOT_APPLICABLE';
 if(profilePhase!=='connected')return 'PROFILE_SWITCH_IN_PROGRESS';
 if(scannedQrIgnored)return 'QR_REQUIRES_EXPLICIT_SWITCH';
 return 'EXISTING_CONNECTION_ONLY';
}
// A staged phone without a registration intent is still in the QR claim
// phase, not the formal registration phase. Re-mounting recovers the encrypted
// claim journal and never blindly repeats an uncertain network POST.
export function classifyStagedSyncRetry({staging=false,targetEnabled=false,pendingIntent=false,hasSavedInvitation=false}={}){
 if(!staging)return 'NOT_STAGED';
 if(targetEnabled||pendingIntent)return 'RESUME_REGISTRATION';
 return hasSavedInvitation?'RELOAD_SAVED_QR':'MISSING_SAVED_QR';
}
function readRaw(local){let raw;try{raw=local.getItem(CONNECTION_PROFILE_KEY)}catch{profileFail('POINTER_UNREADABLE')}
 if(raw===null)return {v:1,active:'legacy',phase:'connected',nextId:1};
 let x;try{x=JSON.parse(raw)}catch{profileFail('POINTER_CORRUPT')}
 if(!x||x.v!==1||!Number.isSafeInteger(x.nextId)||x.nextId<1||x.nextId>100||!VALID.test(x.active)||!['connected','disconnected','preparing','ready'].includes(x.phase)||
  (['preparing','ready'].includes(x.phase)&&(!VALID.test(x.staging)||x.staging===x.active||!Number.isSafeInteger(x.sourceRevision)||x.sourceRevision<0))||
  (x.phase==='disconnected'&&x.staging!==undefined)||
  (x.phase==='connected'&&x.staging!==undefined))profileFail('POINTER_CORRUPT');
 return x;
}
export function createConnectionProfiles({local}={}){
 if(!local?.getItem||!local?.setItem)profileFail('DURABLE_STORAGE_REQUIRED');
 const read=()=>structuredClone(readRaw(local));
 const write=(expected,next)=>{
  if(JSON.stringify(readRaw(local))!==JSON.stringify(expected))profileFail('CONCURRENT_POINTER_CHANGE');
  const s=JSON.stringify(next);
  try{local.setItem(CONNECTION_PROFILE_KEY,s)}catch{profileFail('POINTER_WRITE_FAILED')}
  if(local.getItem(CONNECTION_PROFILE_KEY)!==s)profileFail('POINTER_READBACK_FAILED');return read();
 };
 return Object.freeze({read,
  disconnect(){const x=read();if(x.phase!=='connected')profileFail('NOT_CONNECTED');return write(x,{v:1,active:x.active,phase:'disconnected',nextId:x.nextId})},
  reconnectSame(){const x=read();if(x.phase!=='disconnected')profileFail('NOT_DISCONNECTED');return write(x,{v:1,active:x.active,phase:'connected',nextId:x.nextId})},
  begin({sourceRevision,oldTabsClosed=false,backupSaved=false}={}){
   const x=read();if(x.phase!=='disconnected'||oldTabsClosed!==true||backupSaved!==true)profileFail('BACKUP_AND_DISCONNECT_REQUIRED');
   if(!Number.isSafeInteger(sourceRevision)||sourceRevision<0)profileFail('SOURCE_REVISION_REQUIRED');
   const n=x.nextId;if(n>99)profileFail('PROFILE_LIMIT_REACHED');
   return write(x,{v:1,active:x.active,phase:'preparing',staging:'p'+n,sourceRevision,nextId:n+1});
  },
  prepared(){const x=read();if(x.phase!=='preparing')profileFail('NOT_PREPARING');return write(x,{...x,phase:'ready'})},
  cancel(){const x=read();if(!['preparing','ready'].includes(x.phase))profileFail('NOT_PENDING');return write(x,{v:1,active:x.active,phase:'disconnected',nextId:x.nextId})},
  complete({sourceRevision,targetReady=false}={}){
   const x=read();if(x.phase!=='ready'||sourceRevision!==x.sourceRevision||targetReady!==true)profileFail('VERIFIED_CUTOVER_REQUIRED');
   return write(x,{v:1,active:x.staging,phase:'connected',nextId:x.nextId});
  }
 });
}
// An uncommitted target gets a dedicated durable mode marker, not the origin's
// legacy receipt/LOCAL_MODE. A verified marker survives a crash between the
// remote ACK and the atomic active-profile pointer update.
export function createStagedSetupLocal({local,profileId}={}){
 if(!local?.getItem||!local?.setItem||!local?.removeItem||!/^p[1-9][0-9]?$/.test(profileId))profileFail('STAGING_MODE_STORAGE_REQUIRED');
 const key=LOCAL_MODE+'-'+profileId;
 const read=()=>{const value=local.getItem(key);if(value!==null&&value!=='sync-enabled')profileFail('STAGING_MODE_CORRUPT');return value??'encrypted-local'};
 return Object.freeze({
  getItem(k){return k===LOCAL_MODE?read():local.getItem(k)},
  setItem(k,v){if(k!==LOCAL_MODE){local.setItem(k,v);return}
   if(v!=='sync-enabled')profileFail('STAGING_MODE_DENIED');
   if(read()==='sync-enabled')return;
   try{local.setItem(key,v)}catch{profileFail('STAGING_MODE_WRITE_FAILED')}
   if(local.getItem(key)!==v)profileFail('STAGING_MODE_READBACK_FAILED');
  },
  removeItem(k){if(k===LOCAL_MODE)profileFail('STAGING_MODE_DENIED');local.removeItem(k)}
 });
}
// Final pointer commit (or restart after an already verified remote ACK).
// This helper performs NO registration and NO PUT: only local authenticated
// readbacks followed by a single guarded pointer CAS.
export async function completeVerifiedStagedProfile({setup,setupLocal,profiles,selectedProfile,sourceProfile,
 sourceRevision,storage,vault,sealedCredentials,oldVault,passphrase,apiOrigin,siteOrigin,fetcher,exclusive}={}){
 if(!selectedProfile||selectedProfile===sourceProfile||setupLocal?.getItem(LOCAL_MODE)!=='sync-enabled')throw Error('STAGED_SETUP_NOT_DURABLE');
 const trusted=vault.readSyncCheckpoint();
 if(!trusted||trusted.serverRevision<1)throw Error('NEW_PROFILE_CHECKPOINT_REQUIRED');
 const lineage=trusted.snapshot?.settings?.syncLineage;
 await setup.confirmEnabled({apiOrigin,boxId:lineage?.boxId,credentialsVerified:true});
 if((await sealedCredentials.inspect()).phase!=='PRESENT_LOCKED')throw Error('NEW_PROFILE_CREDENTIALS_REQUIRED');
 // Decrypt scope-bound credentials against the unlocked target WAL; no network.
 await sealedCredentials.resume({vault,passphrase,fetcher,expectedApiRoot:apiOrigin,expectedOrigin:siteOrigin,expectedBoxId:lineage.boxId});
 return exclusive(async()=>{
  const before=profiles.read();
  if(before.phase!=='ready'||before.staging!==selectedProfile||before.active!==sourceProfile||before.sourceRevision!==sourceRevision)
   throw Error('PROFILE_CHANGED_BEFORE_COMMIT');
  await oldVault.unlock(passphrase);
  if(oldVault.readRevision()!==before.sourceRevision||!oldVault.readSyncCheckpoint())throw Error('OLD_PROFILE_CHANGED_KEEP_BOTH');
  if(canonical(vault.readSyncCheckpoint()?.snapshot?.settings?.syncLineage)!==canonical(storage.read().weeklyOptions.__syncLineage))throw Error('NEW_PROFILE_CHECKPOINT_REQUIRED');
  return profiles.complete({sourceRevision:before.sourceRevision,targetReady:true});
 });
}
export function profileSuffix(id){if(!VALID.test(id))profileFail('INVALID_ID');return id==='legacy'?'':'-'+id}
export function getSelectedProfile(x){return x.phase==='ready'?x.staging:x.active}
export function assertConnectionActive(x){if(x.phase!=='connected')profileFail('CONNECTION_NOT_ACTIVE')}
export function prepareIndependentLocalCopy(source){
 if(!source||typeof source!=='object'||!source.records||!source.tombstones||!source.weeklyOptions?.__syncLineage)profileFail('CONNECTED_SOURCE_REQUIRED');
 const next=structuredClone(source);
 for(const k of ['__syncLineage','__registrationPending','__pairingMergeApplied'])delete next.weeklyOptions[k];
 return next;
}


// ANI:LOG connection safety controls. No remote requests and no mutation of
// encrypted records, WAL, sync lineage, sealed credentials or checkpoints.

export const SYNC_PAUSE_KEY='anilog-sync-manual-pause-v1';
const PAUSED='paused-v1';
const fail=code=>{throw Error('SYNC_CONNECTION_GUARD:'+code)};

export function createSyncPauseGuard({local,key=SYNC_PAUSE_KEY}={}){
 if(!local?.getItem||!local?.setItem||!local?.removeItem)fail('DURABLE_STORAGE_REQUIRED');
 const read=()=>{
  let value;try{value=local.getItem(key)}catch{fail('PAUSE_STATE_UNREADABLE')}
  // Treat unexpected/corrupt values as paused, never silently resume network.
  return value===null?'active':value===PAUSED?'paused':'invalid';
 };
 return Object.freeze({
  read,
  get paused(){return read()!=='active'},
  assertAllowed(){if(read()!=='active')fail('MANUALLY_PAUSED')},
  pause(){
   // If storage write/readback fails, fail closed to the caller. Never claim
   // that an in-flight request already completed or was cancelled.
   try{local.setItem(key,PAUSED)}catch{fail('PAUSE_NOT_DURABLE')}
   if(read()!=='paused')fail('PAUSE_READBACK_FAILED');return 'paused';
  },
  resume({verified=false}={}){
   // Only explicit user interaction following local checkpoint/lineage review.
   if(verified!==true||read()==='invalid')fail('EXPLICIT_VERIFIED_RESUME_REQUIRED');
   if(read()==='active')return 'active';
   try{local.removeItem(key)}catch{fail('RESUME_NOT_DURABLE')}
   if(read()!=='active')fail('RESUME_READBACK_FAILED');return 'active';
  }
 });
}

export function inspectConnectionSwitch({storage,vault,apiOrigin}={}){
 // Inspect ONLY the unlocked durable local app and last authenticated local
 // checkpoint. This is not a live remote check, merge, disconnect, or rebind.
 if(!storage?.ready||!vault?.readSyncCheckpoint||!vault?.readRevision)fail('ENCRYPTED_VAULT_REQUIRED');
 const state=storage.read(),lineage=checkLineage(state.weeklyOptions?.__syncLineage);
 if(lineage.api!==apiOrigin)fail('ORIGIN_MISMATCH_KEEP_ORIGINAL');
 const cp=vault.readSyncCheckpoint();
 if(!cp||!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1)fail('CONFIRMED_CHECKPOINT_REQUIRED');
 if(canonical(cp.snapshot?.settings?.syncLineage)!==canonical(lineage))fail('CHECKPOINT_SCOPE_MISMATCH');
 const localSnapshot=appToSnapshot(state);
 const localDiffers=canonical(localSnapshot)!==canonical(cp.snapshot);
 return Object.freeze({
  state:'READ_ONLY_DIAGNOSIS',
  serverRevision:cp.serverRevision,
  localRevision:vault.readRevision(),
  localDiffersFromCheckpoint:localDiffers,
  switchPermitted:false,
  // Even equal snapshots cannot prove the remote has not advanced.
  remoteState:'NOT_CHECKED',
  recordCount:Object.keys(state.records).length,
  // No boxId, raw records, remote URL with secrets, or credential in result.
 });
}


// Read-only destination fingerprint. This is a comparison label, NOT a credential,
// proof of a healthy peer, or an authorization token. Never display raw box IDs.
export async function syncDestinationCode(lineage,{cryptoProvider=globalThis.crypto}={}){
 const scope=checkLineage(lineage);
 if(!cryptoProvider?.subtle)throw Error('CONNECTION_CODE_CRYPTO_UNAVAILABLE');
 const raw=new TextEncoder().encode('ANI_LOG_CONNECTION_CODE_V1\0'+scope.api+'\0'+scope.boxId);
 const digest=new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',raw));
 const label=Array.from(digest.subarray(0,6),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
 return label.slice(0,6)+'-'+label.slice(6);
}

// For an already connected device, compare a scanned QR's destination with
// the current durable lineage WITHOUT claiming, replacing or saving a secret.
// This does not authenticate the QR, approve a member, or rebind the device.
export async function compareScannedQrDestination({qrUrl,siteOrigin,apiOrigin,lineage,cryptoProvider=globalThis.crypto}={}){
 const current=checkLineage(lineage);
 if(current.api!==apiOrigin)throw Error('QR_COMPARISON_API_MISMATCH');
 const target=parsePairingUrl(qrUrl,{allowedOrigin:siteOrigin});
 try{
  const qrLineage={...current,boxId:target.boxId};
  const currentID=await syncDestinationCode(current,{cryptoProvider});
  const scannedID=await syncDestinationCode(qrLineage,{cryptoProvider});
  return Object.freeze({sameDestination:current.boxId===target.boxId,currentID,scannedID});
 }finally{target.invitationSecret.fill(0);target.masterKey.fill(0)}
}

// The formal storage implementation is Object.freeze()d. Proxying that
// frozen object and substituting save methods violates the JS Proxy invariant
// for its non-configurable, non-writable properties. Keep it untouched and
// expose only the methods the legacy ANI UI actually uses through an
// independent, frozen forwarding facade. Its ready getter remains live.
export function createGuardedFormalUIStorage({storage,profiles,selectedProfile,staging=false}={}){
 const beforeWrite=()=>{
  const now=profiles.read();
  if(staging||now.active!==selectedProfile||!['connected','disconnected'].includes(now.phase))
   throw Error('PROFILE_CHANGE_UI_EDIT_BLOCKED');
 };
 return Object.freeze({
  get ready(){return storage.ready},
  read:(...args)=>storage.read(...args),
  refresh:(...args)=>storage.refresh(...args),
  exportBackup:(...args)=>storage.exportBackup(...args),
  saveRecords:(...args)=>{beforeWrite();return storage.saveRecords(...args)},
  saveWeekly:(...args)=>{beforeWrite();return storage.saveWeekly(...args)},
  restoreBackup:(...args)=>{beforeWrite();return storage.restoreBackup(...args)}
 });
}

// The existing encrypted invitation envelope also owns the candidate identity.
// Bind every read/CAS to the exact selected invitation, including across tabs.
// Explicit fresh QR replaces only the selected invitation. Keep the prior
// sealed candidate as recovery evidence; never reuse it for the new invitation.
export function preserveReceiverInvitation(previous,next){
 const history=previous.previousClaims??[];
 if(!Array.isArray(history))throw Error('INVITATION_HISTORY_INVALID_KEEP_RECORDS');
 return {...next,previousClaims:previous.claimAttempt?[...history,{href:previous.href,hash:previous.hash,claimAttempt:previous.claimAttempt}]:[...history]};
}
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
 const profiles=createConnectionProfiles({local}),profileState=profiles.read();
 const profileExclusive=fn=>locks.request('anilog-formal-connection-profile-cutover',{mode:'exclusive'},fn);
 const staging=profileState.phase==='ready',selectedProfile=getSelectedProfile(profileState);
 const factory=()=>createFormalProductionANIPrimary({idb,locks,profileId:selectedProfile}),vault=factory();
 let automatic=null,running=null,busy=false,downloaded=null;
 const storage=createFormalStorage({vault,independentVault:factory,onCommitted:()=>automatic?.changed()});
 const suffix=profileSuffix(selectedProfile);
 const keyDB='anilog-FORMAL-AUTOMATIC-DEVICE-KEY';
 const scopedIDB={open:(name,...args)=>idb.open(name===V408_CREDENTIAL_DB?'anilog-FORMAL-PRODUCTION-SEALED-CREDENTIALS'+suffix:
  name===keyDB?'formal-production:'+name:'formal-production:'+name+suffix,...args)};
 const scopedLocks={request:(name,...args)=>locks.request('formal-production:'+name+(name===keyDB?'':suffix),...args)};
 const keys=createAutomaticDeviceKey({idb:scopedIDB,locks:scopedLocks,origin:location.origin});
 // Stage uses the existing encrypted-mode receipt, without modifying the
 // origin-wide legacy cutover marker until a verified profile-pointer commit.
 const setupLocal=staging?createStagedSetupLocal({local,profileId:selectedProfile}):local;
 const setup=createFormalSetup({local:setupLocal,locks,storage,vault,independentVault:factory,deviceKeys:keys,origin:location.origin});
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
 const mode=staging?'encrypted-local':local.getItem(LOCAL_MODE);
 const ignoredExistingQR=Boolean(receiving&&mode==='sync-enabled');
 const pauseGuard=createSyncPauseGuard({local,key:SYNC_PAUSE_KEY+profileSuffix(selectedProfile)});
 // An already linked device cannot accept a second QR in this release.
 // Show the limitation; do not overwrite credentials, vault or sync lineage.
 if(ignoredExistingQR){
  const notice=el('pairing-notice');
  if(notice){notice.hidden=false;notice.textContent='この端末にはすでに同期設定があるため、新しいQRはまだ適用していません。同期先を切り替える場合は、この画面の「この端末の同期を解除する（記録は残す）」を押し、続けてバックアップ・確認・安全な接続を行ってください。単に「接続を再試行」しても新しいQRには接続されません。記録は保持されています。';}
  attention(true);
 }
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
 // Old browser tabs must not keep editing an obsolete profile. A pending
 // switch freezes UI writes; its internal authenticated registration may still
 // commit exclusively to the staging vault, never to the original WAL.
 const uiStorage=createGuardedFormalUIStorage({storage,profiles,selectedProfile,staging});
 Object.defineProperty(window,'__formalStorage',{value:uiStorage});
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
 async function showDestination(){
  const output=el('connection-info');
  if(!output||staging||local.getItem(LOCAL_MODE)!=='sync-enabled')return;
  try{
   const lineage=storage.read().weeklyOptions?.__syncLineage;
   if(!lineage)throw Error('SYNC_DESTINATION_NOT_FOUND');
   const code=await syncDestinationCode(lineage);
   output.textContent='同期先ID：'+code+'（QR承認用の6桁番号とは別です。相手端末の同期先IDと比較してください。同じIDでも同期成功を保証しません）';
   output.hidden=false;
  }catch{output.textContent='同期先IDを表示できません。接続状態の確認が必要です。記録は変更していません。';output.hidden=false;}
 }
 await showDestination();
 if(ignoredExistingQR){
  const notice=el('pairing-notice');
  try{
   const x=await compareScannedQrDestination({qrUrl:captured.href,siteOrigin:location.origin,apiOrigin:api.origin,
    lineage:storage.read().weeklyOptions.__syncLineage});
   notice.textContent=x.sameDestination?
    '読み取ったQRとこの端末は同じ同期先ID（'+x.currentID+'）です。新しい端末の承認は行っていません。この端末の元の同期を続けるには再読み込みしてください。':
    '読み取ったQRの同期先ID（'+x.scannedID+'）と、この端末の同期先ID（'+x.currentID+'）が異なります。新しいQRはまだ適用していません。切り替えるには「この端末の同期を解除する（記録は残す）」を押し、続けてこの画面のバックアップ・安全な接続へ進んでください。古い記録・資格情報は保持しています。';
  }catch{notice.textContent='QRの接続先を安全に照合できません。接続先は変更していません。記録を初期化・削除しないでください。';}
 }
 // The old profile's WAL/credentials remain independent from every new profile.
 // Device unlink never deletes or revokes cloud data or secrets.
 const connectionActions=el('connection-actions');
 const pauseButton=el('pause-sync'),resumeButton=el('resume-sync'),switchCheck=el('switch-check'),switchResult=el('switch-result');
 const unlink=el('unlink-sync'),relink=el('relink-sync'),relinkActions=el('relink-qr-actions');
 const backupButton=el('relink-backup'),confirmReconnection=el('relink-confirm'),startReconnection=el('relink-start'),cancelReconnection=el('relink-cancel');
 let newBackupDownloaded=false,backupRevision=null;
 const oldConnectionKey=SYNC_PAUSE_KEY+profileSuffix(profileState.active);
 const oldPause=createSyncPauseGuard({local,key:oldConnectionKey});
 function showConnectionActions(){
  const state=profiles.read();connectionActions.hidden=false;
  if(state.phase==='disconnected'||state.phase==='preparing'){
   const existingPanel=document.getElementById('formal-sync-controls');if(existingPanel)existingPanel.hidden=true;
  }
  unlink.hidden=state.phase!=='connected'||staging;
  relink.hidden=state.phase!=='disconnected';
  relinkActions.hidden=state.phase!=='disconnected'||!receiving;
  cancelReconnection.hidden=!['preparing','ready'].includes(state.phase);
  if(state.phase==='disconnected'){
   pauseButton.hidden=true;resumeButton.hidden=true;
   attention(true);status.textContent='この端末の同期連携を解除しました。暗号化した記録は端末内に保存されます。サーバー上の端末認証と復旧情報は削除していません。';
  }else if(['preparing','ready'].includes(state.phase)){
   pauseButton.hidden=true;resumeButton.hidden=true;unlink.hidden=true;relink.hidden=true;
   attention(true);status.textContent=state.phase==='ready'?'新しい接続先へ接続準備中です。6桁コードを元の端末で承認し、この端末で「接続を完了」を押してください。':'再接続の準備が完了していません。元の暗号化記録は保持されています。中止して復元できます。';
  }
 }
 unlink.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(staging||profiles.read().phase!=='connected')throw Error('UNLINK_NOT_AVAILABLE');
  oldPause.pause();automatic?.stop();automatic=null;
  profiles.disconnect();showPauseState();showConnectionActions();
  switchResult.hidden=false;switchResult.textContent='接続を解除しました。通信は停止していますが、クラウド側の端末失効は実行していません。記録・未送信変更と復旧用認証情報は保持しています。';
 })));
 relink.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(staging||profiles.read().phase!=='disconnected')throw Error('RECONNECT_NOT_AVAILABLE');
  inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  oldPause.resume({verified:true});
  try{profiles.reconnectSame()}
  catch(e){oldPause.pause();throw e}
  // Restore session and owner/member role from their own encrypted vault on a
  // fresh page. If offline, startup keeps local data and retries normally.
  location.reload();
 })));
 backupButton.addEventListener('click',()=>{
  newBackupDownloaded=false;backupRevision=null;confirmReconnection.checked=false;startReconnection.disabled=true;
  try{
   const raw=storage.exportBackup();const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='anime-log-before-reconnect.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   backupRevision=vault.readRevision();newBackupDownloaded=true;
  }catch(e){message(e)}
 });
 confirmReconnection.addEventListener('change',()=>{startReconnection.disabled=!(newBackupDownloaded&&confirmReconnection.checked)});
 startReconnection.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(!receiving||!captured?.href||!newBackupDownloaded||!confirmReconnection.checked||profiles.read().phase!=='disconnected'||!oldPause.paused)throw Error('CONFIRMED_BACKUP_AND_QR_REQUIRED');
  const source=storage.read(),lineage=source.weeklyOptions.__syncLineage;
  const comparison=await compareScannedQrDestination({qrUrl:captured.href,siteOrigin:location.origin,apiOrigin:api.origin,lineage});
  if(comparison.sameDestination)throw Error('SAME_DESTINATION_USE_RECONNECT');
  inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  await storage.refresh();const original=storage.read(),sourceRevision=vault.readRevision();
  if(sourceRevision!==backupRevision)throw Error('BACKUP_STALE_DOWNLOAD_NEW_COPY');
  // Keep the full current WAL/checkpoint in the original database. A separate
  // encrypted genesis is an independent, durable copy, not an in-place rebind.
  const password=await keys.read();if(!password)throw Error('SOURCE_KEY_REQUIRED');
  const progress=profiles.begin({sourceRevision,oldTabsClosed:true,backupSaved:true});
  const stageFactory=()=>createFormalProductionANIPrimary({idb,locks,profileId:progress.staging});
  const stageVault=stageFactory();const stageStorage=createFormalStorage({vault:stageVault,independentVault:stageFactory});
  const copy=prepareIndependentLocalCopy(original);
  await stageStorage.initializeFrozen(JSON.stringify(copy),password);
  // Independent decrypt/readback before staging a QR secret into encrypted IDB.
  const readback=stageFactory();await readback.unlock(password);
  if(canonical(readback.readCurrent())!==canonical(copy)||readback.readRevision()!==0)throw Error('STAGE_INDEPENDENT_READBACK_FAILED');
  const sfx=profileSuffix(progress.staging);
  const stageIDB={open:(name,...args)=>idb.open('formal-production:receiver:'+name+sfx,...args)};
  const stageLocks={request:(name,...args)=>locks.request('formal-production:'+name+sfx,...args)};
  const stageInvitations=createRegistrationIntentStore({idb:stageIDB,locks:stageLocks,origin:location.origin});
  // The invitation is encrypted, never put in localStorage, logs or a URL after scan.
  await stageInvitations.create(captured,password);
  if(vault.readRevision()!==sourceRevision)throw Error('ORIGINAL_CHANGED_DURING_PREPARATION');
  profiles.prepared();location.reload();
 })));
 cancelReconnection.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(!['preparing','ready'].includes(profiles.read().phase))throw Error('NO_PENDING_SWITCH');
  // An accepted server PUT may be in flight after a durable paired intent.
  // Do not silently discard that recovery journal or strand accepted changes.
  if(staging&&(vault.readSyncCheckpoint()||await intents.read(await keys.read())))throw Error('PENDING_REMOTE_ACK_KEEP_STAGE_CONTACT_SUPPORT');
  profiles.cancel();location.reload();
 })));
 function showPauseState(){
  if(local.getItem(LOCAL_MODE)!=='sync-enabled')return;
  connectionActions.hidden=false;
  const paused=pauseGuard.paused;
  pauseButton.hidden=paused;resumeButton.hidden=!paused;switchCheck.hidden=false;
  showConnectionActions();
  if(paused&&profiles.read().phase==='connected'){attention(true);status.textContent='この端末の自動同期は一時停止中です。編集は暗号化して端末に保存します。同期先・認証情報・未送信変更は保持しています。';}
 }
 showPauseState();
 pauseButton.addEventListener('click',()=>action(async()=>{
  if(local.getItem(LOCAL_MODE)!=='sync-enabled'||profiles.read().phase!=='connected')throw Error('CONNECTED_DEVICE_REQUIRED');
  pauseGuard.pause();automatic?.stop();automatic=null;
  showPauseState();
  switchResult.hidden=false;
  switchResult.textContent='新しい同期通信を停止しました。開始済みの通信は完了する場合があります。他の古いタブも閉じてください。記録と未送信変更は保持しています。';
 }));
 resumeButton.addEventListener('click',()=>action(async()=>{
  if(local.getItem(LOCAL_MODE)!=='sync-enabled'||profiles.read().phase!=='connected')throw Error('CONNECTED_DEVICE_REQUIRED');
  // Never resume another lineage, an empty checkpoint or a corrupt pause flag.
  inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  pauseGuard.resume({verified:true});
  try{await running.resumeAutomatic({passphrase:await keys.read()})}
  catch(e){pauseGuard.pause();automatic?.stop();automatic=null;showPauseState();throw e}
  showPauseState();
  switchResult.hidden=false;
  switchResult.textContent='保存済みの同じ同期先へ再接続しました。新しい通信結果は同期状態の表示で確認してください。';
 }));
 switchCheck.addEventListener('click',()=>action(async()=>{
  // Never initiate a QR claim or change the server box in this operation.
  const x=inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  switchResult.hidden=false;
  switchResult.textContent='端末内の最終確認済み同期との差分：'+(x.localDiffersFromCheckpoint?'あり（未送信変更の可能性）':'なし（遠隔の最新状態は未確認）')+
   '。別の同期先へ切り替える処理は実行していません。端末内の記録・接続情報はすべて保持しています。';
 }));
 // When another tab pauses this origin, stop scheduling new requests here too.
 // Already in-flight operations and older, unguarded application tabs cannot
 // be cancelled this way: explicitly close all older tabs before transfer.
 window.addEventListener?.('storage',event=>{
  if(event.key===CONNECTION_PROFILE_KEY){
   // Other tabs must not continue scheduling against an obsolete profile.
   automatic?.stop();automatic=null;attention(true);status.textContent='別のタブで接続設定が変更されました。記録は保持しています。このタブは閉じ、最新の画面を開いてください。';return;
  }
  if(event.key!==SYNC_PAUSE_KEY+profileSuffix(selectedProfile))return;
  if(pauseGuard.paused){automatic?.stop();automatic=null;showPauseState()}
  else {attention(true);status.textContent='別のタブで同期が再開されました。このタブも再読み込みして接続状態を確認してください。';
   resumeButton.hidden=true;pauseButton.hidden=false;}
 });
 const panelRoot=document.getElementById('formal-sync-controls');
 // Reuse the existing QR panel, hide developer-only bootstrap/unlock controls.
 for(const n of panelRoot.children)if(n.id!=='v407-pairing')n.hidden=true;
 const panelUI=panelRoot.querySelector('#v407-pairing');root.append(panelRoot);
 panelRoot.hidden=profileState.phase==='disconnected'||profileState.phase==='preparing';
 for(const selector of ['[data-v408="box-id"]','[data-v408="unlock-owner"]','[data-v409="first-owner"]','[data-v407="repair"]','[data-v407="sync"]'])panelUI.querySelector(selector).hidden=true;
 panelUI.querySelector('[data-v407="invite"]').textContent='新しい端末を追加する';
 // A QR scan plus a confirmed local cutover is sufficient to submit the
 // receiver claim. The owner still approves the exact six digits explicitly.
 // Keep only the actions relevant to this device; staging diagnostics remain
 // untouched and this does not alter any security checks.
 const receiver=staging||selectedProfile!=='legacy'||setup.readReceipt().role==='receiver';
 const hide=selector=>{const node=panelUI.querySelector('[data-v407="'+selector+'"]');if(node)node.hidden=true};
 hide('refresh');hide('claim');hide('sync');
 if(receiver){
  for(const id of ['invite','copy','qr','code','approve','receive','repair'])hide(id);
  panelUI.querySelector('[data-v407="check"]').textContent='接続を完了';
 }else{for(const id of ['receiver-code','check','receive','repair'])hide(id)}
 function schedule(_session,fresh){
  automatic?.stop();automatic=null;
  if(pauseGuard.paused||profiles.read().phase!=='connected'||profiles.read().active!==selectedProfile){showPauseState();return;}
  automatic=createAutomaticSync({syncOnce:async()=>{pauseGuard.assertAllowed();const s=await fresh();pauseGuard.assertAllowed();return s.syncOnce()},onState:s=>{
   if(pauseGuard.paused)return;
   const labels={syncing:'同期中',synced:'同期済み（この端末）',pending:'端末に保存済み・未同期',offline:'端末に保存済み・オンライン復帰時に同期',
    unavailable:'同期できませんでした。記録は端末に保存済みです。接続を再試行できます。',
    conflict:'同期を一時停止しました。2台の端末で同じ項目が別々に変更されたため、自動でまとめられません。記録は上書きしていません。両端末のデータを消さずに、そのまま保持してください。'};
   status.textContent=labels[s.phase]??'端末に保存済み';
   // A closed settings panel must not hide unresolved sync errors. Keep the
   // notice until a later *confirmed* success instead of blinking on edits.
   if(s.phase==='synced'&&!(receiving&&mode==='sync-enabled'))attention(false);
   else if(s.phase==='conflict'||s.phase==='unavailable'||['blocked','too-large','unconfirmed'].includes(s.status))attention(true);
   // Do not expose raw record paths / JSON by default. Keep all diagnostic
   // values available behind a user-opened details element; sync is unchanged.
   const conflictDetails=el('conflict-details');
   if(conflictDetails){
    conflictDetails.hidden=s.phase!=='conflict';
    if(s.phase!=='conflict')conflictDetails.open=false;
   }
   el('conflicts').hidden=s.phase!=='conflict';
   el('conflicts').textContent=s.phase==='conflict'?summarizeSyncConflictPaths(s.conflicts).map(c=>c.path+' / '+c.reason).join('\n'):'';
   el('retry').hidden=!['conflict','offline','pending','unavailable'].includes(s.phase);
   el('retry').textContent=s.phase==='conflict'?'同期をもう一度試す':'接続を再試行する';
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
 if(staging){
  if(!invitation&&!pendingIntent)throw Error('STAGED_QR_MISSING_KEEP_ORIGINAL');
  if(receiving&&invitation&&(invitation.href!==captured.href||invitation.hash!==captured.hash))throw Error('STAGED_QR_REPLACEMENT_DENIED');
 }
 if(receiver&&mode==='encrypted-local'&&!pendingIntent&&receiving&&!staging){
  if(!invitation)await invitations.create(captured,restored.passphrase);
  else if(invitation.href!==captured.href||invitation.hash!==captured.hash)
   await invitations.replace(invitation,preserveReceiverInvitation(invitation,captured),restored.passphrase);
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
  },beforeSync:()=>{pauseGuard.assertAllowed();if(profiles.read().phase!=='connected'||profiles.read().active!==selectedProfile)throw Error('PROFILE_NOT_ACTIVE');const line=storage.read().weeklyOptions.__syncLineage;storage.assertSyncHistory({api:api.origin,boxId:line?.boxId})}});
 async function finishStagedCutover(password){
  const oldVault=createFormalProductionANIPrimary({idb,locks,profileId:profileState.active});
  const fetcher=createV405BrowserWorkerFetch({apiOrigin:api.origin,siteOrigin:location.origin,pageOrigin:location.origin,browserFetch});
  await completeVerifiedStagedProfile({setup,setupLocal,profiles,selectedProfile,sourceProfile:profileState.active,
   sourceRevision:profileState.sourceRevision,storage,vault,sealedCredentials:running.sealedCredentials,oldVault,
   passphrase:password,apiOrigin:api.origin,siteOrigin:location.origin,fetcher,exclusive:profileExclusive});
  location.reload();
 }
 async function register({fromPairing=false}={}){
  const password=await keys.read();if(!password)throw Error('SETUP_KEY_REQUIRED');
  if(staging&&setupLocal.getItem(LOCAL_MODE)==='sync-enabled')return finishStagedCutover(password);
  const existing=await intents.read(password);
  if(!existing){if(receiver)throw Error('RECEIVER_APPROVAL_REQUIRED');
   await prepareFormalRegistration({registrationMode:'self-service',apiOrigin:api.origin,siteOrigin:location.origin,storage,vault,intentStore:intents,passphrase:password,independentVault:factory});}
  if(staging){
   const oldBefore=createFormalProductionANIPrimary({idb,locks,profileId:profileState.active});
   await oldBefore.unlock(password);
   if(oldBefore.readRevision()!==profileState.sourceRevision||profiles.read().phase!=='ready')throw Error('SOURCE_CHANGED_STOP_BEFORE_REMOTE_WRITE');
  }
  const result=await completeFormalRegistration({networkApproved:true,apiOrigin:api.origin,siteOrigin:location.origin,pageOrigin:location.origin,
   storage,vault,intentStore:intents,passphrase:password,independentVault:factory,sealedCredentials:running.sealedCredentials,ui,uiBridge:running.bridge,locks,browserFetch,
   getChallenge:({binding})=>requestRegistrationChallenge({apiOrigin:api.origin,binding,container:el('challenge'),document,events:window})});
  await setup.confirmEnabled({apiOrigin:api.origin,boxId:result.boxId,credentialsVerified:true});
  if(staging){await finishStagedCutover(password);return result;}
  await showDestination();
  showPauseState();
  // Reload follows a durable ON marker; startup uses the same password-free
  // restore path as every later visit. No credentials are inserted into inputs.
  if(!receiver)location.reload();
  else if(!fromPairing)await running.resumeAutomatic({passphrase:password});
  return result;
 }
 el('retry').addEventListener('click',()=>action(async()=>{
  const currentMode=local.getItem(LOCAL_MODE);
  // A staged switch has its own durable registration/confirmation. Do not
  // mistake the old origin-wide sync-enabled marker for the stage's state.
  if(staging){
   const password=await keys.read();if(!password)throw Error('SETUP_KEY_REQUIRED');
   const pending=await intents.read(password);
   const targetEnabled=setupLocal.getItem(LOCAL_MODE)==='sync-enabled';
   const savedQr=!targetEnabled&&!pending?await invitations.read(password):null;
   const next=classifyStagedSyncRetry({staging:true,targetEnabled,pendingIntent:!!pending,hasSavedInvitation:!!savedQr});
   if(next==='RELOAD_SAVED_QR'){location.reload();return;}
   if(next==='MISSING_SAVED_QR')throw Error('STAGED_QR_MISSING_KEEP_ORIGINAL');
   await register();return;
  }
  const retryKind=classifyExistingSyncRetry({mode:currentMode,profilePhase:profiles.read().phase,scannedQrIgnored:ignoredExistingQR});
  if(retryKind!=='NOT_APPLICABLE'&&retryKind!=='EXISTING_CONNECTION_ONLY'){
   automatic?.stop();automatic=null;el('retry').hidden=true;attention(true);showConnectionActions();
   status.textContent=retryKind==='QR_REQUIRES_EXPLICIT_SWITCH'
    ?'新しいQRはまだ適用していません。元の同期先を続けるにはページを再読み込みしてください。別の同期先へ変更するには「この端末の同期を解除する（記録は残す）」を押し、バックアップを保存してから安全に接続してください。既存の記録は保持されています。'
    :'この端末は接続解除または再接続準備中です。通常の「接続を再試行」では古い同期先へ通信しません。画面に表示されたバックアップ・QR接続手順を進めてください。記録は保持されています。';
   return;
  }
  if(automatic){automatic.resumeAfterConflict();return}
  if(currentMode==='sync-enabled'){
   // Restart only the established, unchanged connection.
   await running.resumeAutomatic({passphrase:await keys.read()});return;
  }
  if(currentMode==='preparing'||currentMode===null){await beginOrResume();return}
  if(currentMode==='encrypted-local'){
   const password=await keys.read();
   if(receiver&&!await intents.read(password)){
    if(await invitations.read(password)){location.reload();return;}
    status.textContent='記録を保持しています。元の端末で新しい招待QRを発行して読み取ってください。';return;
   }
   await register();return;
  }
  throw Error('UNKNOWN_SETUP_STATE_KEEP_ORIGINAL');
 }));
 if(staging&&setupLocal.getItem(LOCAL_MODE)==='sync-enabled')await action(()=>finishStagedCutover(restored.passphrase));
 else if(mode==='sync-enabled'){
  if(['disconnected','preparing'].includes(profiles.read().phase)){showConnectionActions();}
  else if(ignoredExistingQR){attention(true);status.textContent='新しいQRは適用していません。このタブでの自動同期は開始していません。通常の同期を再開するにはページを再読み込みしてください。';}
  else if(!pauseGuard.paused){pauseGuard.assertAllowed();await running.resumeAutomatic({passphrase:await keys.read()});}
  else showPauseState();
 }else if(!receiver||await intents.read(restored.passphrase))await action(register);
 else status.textContent=invitation?'この端末の記録を保持しています。招待を受け取り、6桁照合後に統合します。':'記録を保持しています。設定元の端末で新しい招待QRを作成し、もう一度読み取ってください。';
 return {phase:'FORMAL_OPT_IN_MOUNTED',storage,vault,setup};
}
if(typeof document!=='undefined')void mountFormalSimpleSync().catch(()=>{
 const panel=document.getElementById?.('formal-sync-controls');
 // Prevent uninitialized developer placeholder controls from looking like a
 // meaningful network error or a working QR retry. No data is modified.
 if(panel)panel.hidden=true;
 const status=document.querySelector('[data-simple="status"]');if(status)status.textContent='端末間同期の画面を初期化できませんでした。記録と以前の接続情報は保持しています。初期化・消去はしないでください。新しいQRを使う場合は安全な再接続手順から開始してください。';
 const summary=document.querySelector('#formal-simple-sync summary');if(summary)summary.textContent='端末間同期（要確認）';
});
