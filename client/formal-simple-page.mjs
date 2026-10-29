import {installConflictRecovery} from './conflict-resolution-integration.mjs';
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
import {createSelfRevokeJournal,getOwnRole,listOwnerDevices,revokeSelectedMember,revokeThisMember,shortDeviceId} from './device-registration-management.mjs';
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
// Optional names are labels on THIS browser only, never device identities.
// The server's authenticated registration ID remains the sole revoke target.
export function createLocalDeviceNames(local,profileId){
 if(!/^(?:legacy|p[1-9][0-9]?)$/.test(profileId)||!local?.getItem||!local?.setItem)throw Error('DEVICE_NAME_SCOPE_INVALID');
 const key='anilog-local-device-names-v1:'+profileId;
 const validId=id=>/^[A-Za-z0-9_-]{22,43}$/.test(id);
 const read=()=>{let raw;try{raw=local.getItem(key)}catch{return {}};
  if(raw===null)return {};let obj;try{obj=JSON.parse(raw)}catch{return {}};
  if(!obj||Array.isArray(obj)||typeof obj!=='object')return {};
  return Object.fromEntries(Object.entries(obj).filter(([id,name])=>validId(id)&&typeof name==='string'&&name.length<=24));
 };
 return Object.freeze({get:id=>validId(id)?read()[id]??'':'',save:(id,value)=>{
  if(!validId(id)||typeof value!=='string')throw Error('DEVICE_NAME_INVALID');
  const name=value.trim();if(name.length>24||/[\x00-\x1F\x7F]/.test(name))throw Error('DEVICE_NAME_INVALID');
  const current=read();if(name)current[id]=name;else delete current[id];
  // Preserve only the current handful of names; labels never authorize removal.
  const raw=JSON.stringify(current);local.setItem(key,raw);
  if(local.getItem(key)!==raw)throw Error('DEVICE_NAME_SAVE_NOT_CONFIRMED');return name;
 }});
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
// Reconnect to an established owner without importing records, deletions, or
// settings from an incorrectly linked device. The ORIGINAL encrypted vault,
// WAL, tombstones and credentials remain untouched as a recovery source.
// The marker lives only in the new device-local encrypted weekly options.
export function prepareExistingGroupOnlyCopy(source){
 const next=prepareIndependentLocalCopy(source);
 next.records={};next.tombstones={};
 next.weeklyOptions.__syncJoinDestinationOnly=true;
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
export function createGuardedFormalUIStorage({storage,profiles,selectedProfile,staging=false,canWrite=()=>true}={}){
 const beforeWrite=()=>{
  if(!canWrite())throw Error('CONFLICT_REVIEW_WRITE_FENCE');
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
 const profiles=createConnectionProfiles({local});
 const initialProfile=profiles.read();
 const revokeJournal=createSelfRevokeJournal(local,initialProfile.active);
 // A verified remote revoke must never reopen the old credentials after a crash.
 if(revokeJournal.read()==='confirmed'&&initialProfile.phase==='connected')profiles.disconnect();
 const profileState=profiles.read();
 const profileExclusive=fn=>locks.request('anilog-formal-connection-profile-cutover',{mode:'exclusive'},fn);
 const staging=profileState.phase==='ready',selectedProfile=getSelectedProfile(profileState);
 const factory=()=>createFormalProductionANIPrimary({idb,locks,profileId:selectedProfile}),vault=factory();
 let automatic=null,running=null,busy=false,downloaded=null,recoveryActive=false,activeSyncs=0,repairRequested=false;
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
 const qrNext=el('qr-next'),qrTitle=el('qr-step-title'),qrMessage=el('qr-step-message'),qrStepCount=el('qr-step-count'),qrStepDevice=el('qr-step-device'),qrBars=[...(root.querySelectorAll?.('[data-simple="qr-step-bar"]')??[])];
 const qrFlow=Boolean(receiving||window.__anilogSyncQrResume);
 let ownerJourneyActive=false;
 const receiverJourneyActive=Boolean(qrFlow||staging||profileState.phase==='preparing'||local.getItem(LOCAL_MODE)==='encrypted-local');
 // A resume bit is UI intent, never a replacement for a consumed QR.
 const qrNeedsFreshScan=()=>qrFlow&&!captured&&window.__anilogSyncQrResume===true&&local.getItem(LOCAL_MODE)===null;
 // Presentation only: never derive approval, registration or sync success
 // from a button click. Those remain exclusively in the existing engine.
 function nextQrStep(title,detail,{step=1,device='この端末で操作',force=false,state='active'}={}){
  if((!qrFlow&&!force)||!qrNext)return;
  qrNext.hidden=false;
  qrNext.dataset.journeyState=state;
  if(qrTitle)qrTitle.textContent=title;
  if(qrMessage)qrMessage.textContent=detail;
  if(qrStepCount)qrStepCount.textContent=state==='done'?'完了':'手順 '+step+' / 3';
  if(qrStepDevice)qrStepDevice.textContent=device;
  qrBars.forEach((bar,i)=>bar.classList.toggle('is-complete',i<step));
 }
 if(qrFlow)nextQrStep('QRを読み取りました','接続先を確認し、画面の案内に沿って進めてください。',{device:'この端末：接続準備'});
 // The pairing panel emits only nonsecret UI phase labels. It NEVER supplies
 // an approval result or changes durable state through this presentation.
 root.addEventListener?.('anilog-pairing-visual-state',event=>{
  const {phase,role,stopped,issue,hasQr}=event.detail??{};
  if(!role)return;
  const owner=role==='owner',failed=stopped||!!issue;
  // A stale expired QR must not cover an already connected owner's dashboard.
  if(owner){
   if((phase==='OWNER_INVITED'&&hasQr)||phase==='OWNER_CLAIMED')ownerJourneyActive=true;
   const messageNode=root.querySelector('[data-v407="status"]');
   if(messageNode)messageNode.hidden=!ownerJourneyActive;
   if(!ownerJourneyActive)return;
  }else if(!receiverJourneyActive){
   const messageNode=root.querySelector('[data-v407="status"]');
   if(messageNode)messageNode.hidden=true;
   return;
  }
  if(failed){nextQrStep('接続状態を確認してください','記録はそのままです。下の案内に沿って進めてください。',{force:true,step:owner?2:2,device:owner?'PC側：確認・復旧':'新しい端末：確認・復旧',state:'needs-attention'});return;}
  if(owner){
   if(phase==='OWNER_OPEN'&&!hasQr)nextQrStep('新しいQRを発行してください','以前のQR画像は再読み込み後に復元できません。接続申請がまだ届いていないことを確認し、下の「新しい端末を追加する」から発行してください。',{force:true,step:1,device:'この端末で操作'});
   else if(phase==='OWNER_INVITED'||phase==='OWNER_OPEN'||phase==='OWNER_CLAIMED')nextQrStep(phase==='OWNER_CLAIMED'?'新しい端末の6桁コードを入力':'新しい端末でQRを読み取ってください',phase==='OWNER_CLAIMED'?'新しい端末の6桁コードを入力して承認します。':'新しい端末でQRを読み取ってください。6桁コードが表示されたら、この端末で承認します。',{force:true,step:phase==='OWNER_CLAIMED'?2:1,device:phase==='OWNER_CLAIMED'?'この端末で操作':'新しい端末で操作'});
   else if(phase==='OWNER_APPROVED')nextQrStep('この端末での承認が完了しました','新しい端末で承認を確認し、「接続を完了」を押してください。',{force:true,step:3,device:'新しい端末で操作'});
   else if(['OWNER_EXPIRED','OWNER_DENIED','OWNER_USED','OWNER_UNAVAILABLE'].includes(phase))nextQrStep('このQRは使えません','この端末で新しいQRを発行してください。記録はそのままです。',{force:true,step:1,device:'この端末で操作',state:'needs-attention'});
  }else{
   if(phase==='RECEIVER_PENDING'||phase==='RECEIVER_CLAIMED')nextQrStep('QRを表示した端末で承認してください','表示された6桁コードをQR発行側に入力してください。その後、この端末で承認を確認します。',{force:true,step:2,device:'QRを表示した端末で操作'});
   else if(phase==='RECEIVER_APPROVED')nextQrStep('QR発行側の承認を確認できました','この端末で「接続を完了」を押してください。',{force:true,step:3,device:'この端末で操作'});
   else if(phase==='RECEIVER_ACTIVE')nextQrStep('接続情報の保存が完了しました','最初の同期を確認中です。',{force:true,step:3,device:'この端末で確認'});
   else if(['RECEIVER_EXPIRED','RECEIVER_DENIED','RECEIVER_USED','RECEIVER_UNAVAILABLE'].includes(phase))nextQrStep('新しいQRが必要です','QR発行側で新しいQRを作成し、読み直してください。記録はそのままです。',{force:true,step:1,device:'QRを表示した端末で操作',state:'needs-attention'});
  }
 });
 function message(error){attention(true);status.textContent='接続を確認できません。記録はそのままです。';el('retry').hidden=false;
  if(qrFlow)nextQrStep('接続を停止しました','以前の記録は残しています。下の状態表示と案内を確認し、必要ならPC側で新しいQRを作成してください。初期化や削除はしないでください。');
  // No exception object, credentials, QR URL or source records enter logs/DOM.
  if(String(error?.message).includes('SELF_REVOKE')||revokeJournal.read()==='pending')status.textContent='端末の登録解除を確認できません。同期は保護のため停止中です。バックアップを保持し、「同期設定を最初からやり直す」から再確認してください。';
  if(String(error?.message).includes('CONFLICT')||String(error?.message).includes('DIFFERS'))status.textContent='異なる記録があるため設定を停止しました。原本とバックアップを保持し、上書きはしていません。';}
 async function action(fn){if(busy)return;busy=true;el('begin').disabled=true;el('retry').disabled=true;
  try{await fn()}catch(error){message(error)}finally{busy=false;el('retry').disabled=recoveryActive}}
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
 el('confirmed').addEventListener('change',()=>{el('begin').disabled=!downloaded||!el('confirmed').checked||busy||qrNeedsFreshScan()});
 async function beginOrResume(){
  const currentMode=local.getItem(LOCAL_MODE);
  if(qrNeedsFreshScan())throw Error('QR_RESCAN_REQUIRED_KEEP_RECORDS');
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
 const ignoredExistingQR=Boolean(receiving&&mode==='sync-enabled'&&profileState.phase==='connected');
 const pauseGuard=createSyncPauseGuard({local,key:SYNC_PAUSE_KEY+profileSuffix(selectedProfile)});
 // A lost revoke response must fence automatic sync until a user-triggered readback.
 if(revokeJournal.read()==='pending')pauseGuard.pause();
 // An already linked device cannot accept a second QR in this release.
 // Show the limitation; do not overwrite credentials, vault or sync lineage.
 if(ignoredExistingQR){
  const notice=el('pairing-notice');
  if(notice){notice.hidden=false;notice.textContent='この端末はすでに同期中です。別の同期先に変えるには、バックアップを保存し「同期設定を最初からやり直す」を選んでください。記録は消えません。';}
  attention(true);
 }
 if(!mode){
  if(qrNeedsFreshScan()){nextQrStep('QRをもう一度読み取ってください','更新前のQR情報はURLから取り除いているため、この画面では接続を開始しません。PC・スマホ側のQRをもう一度読み取ってください。この端末の記録は変更していません。');el('begin').disabled=true;}
  else if(qrFlow)nextQrStep('手順1：この端末の記録を保護','下の「バックアップを保存する」を押し、保存を確認してチェックを入れ、「端末間同期を始める」へ進んでください。PC側の6桁承認は後で行います。');
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
 if(qrFlow){
  if(profileState.phase==='disconnected'&&!receiving)nextQrStep('QRをもう一度読み取ってください','更新前のQR情報はURLから取り除いているため、接続先IDは表示できません。接続したいPC・スマホのQRをもう一度読み取り、ID照合から進めてください。以前の記録は保持しています。');
  else if(profileState.phase==='disconnected')nextQrStep('手順1：同期先IDを確認','下にQRで読み取った同期先IDが表示されます。PC・スマホ側のIDと一致するか確認し、バックアップを保存して接続を進めてください。');
  else if(staging)nextQrStep('PCで6桁コードを承認してください','新しい端末の6桁をPCで入力して承認し、次にこの端末で状態を確認してください。',{step:2,device:'QRを表示した端末で操作'});
  else if(ignoredExistingQR)nextQrStep('接続先を確認してください','この端末は既に別の同期設定を使用しています。QRだけでは切り替えません。「同期設定を最初からやり直す」で解除してから新しいQRを読み取ってください。');
  else if(mode==='encrypted-local')nextQrStep('PCで6桁コードを承認してください','この端末に表示された6桁をPCで入力して承認し、次にこの端末で状態を確認してください。',{step:2,device:'QRを表示した端末で操作'});
  else nextQrStep('同期の状態を確認','下の「同期済み」表示と同期先IDを確認してください。まだ承認中の場合は画面の案内に従ってください。');
 }
 // Old browser tabs must not keep editing an obsolete profile. A pending
 // switch freezes UI writes; its internal authenticated registration may still
 // commit exclusively to the staging vault, never to the original WAL.
 const uiStorage=createGuardedFormalUIStorage({storage,profiles,selectedProfile,staging,canWrite:()=>!recoveryActive});
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
   const disconnected=profiles.read().phase!=='connected';
   output.textContent=(disconnected?'以前の同期先ID：':'同期先ID：')+code+'（QRの6桁番号とは別です。接続先と照合してください）';
   output.hidden=false;
  }catch{output.textContent='同期先IDを確認できません。記録はそのままです。';output.hidden=false;}
 }
 await showDestination();
 if(ignoredExistingQR){
  const notice=el('pairing-notice');
  try{
   const x=await compareScannedQrDestination({qrUrl:captured.href,siteOrigin:location.origin,apiOrigin:api.origin,
    lineage:storage.read().weeklyOptions.__syncLineage});
   notice.textContent=x.sameDestination?
    '読み取ったQRとこの端末は同じ同期先ID（'+x.currentID+'）です。新しい端末の承認は行っていません。この端末の元の同期を続けるには再読み込みしてください。':
    '読み取ったQRの同期先ID（'+x.scannedID+'）と、この端末の同期先ID（'+x.currentID+'）が異なります。新しいQRはまだ適用していません。切り替えるには「詳細設定・復旧」から「この端末の同期を解除」を選び、バックアップを保存して安全に再接続してください。視聴記録は消えません。';
  }catch{notice.textContent='QRの接続先を安全に照合できません。接続先は変更していません。記録を初期化・削除しないでください。';}
 }
 // The old profile's WAL/credentials remain independent from every new profile.
 // Device unlink never deletes or revokes cloud data or secrets.
 const connectionActions=el('connection-actions');
 const pauseButton=el('pause-sync'),resumeButton=el('resume-sync'),switchCheck=el('switch-check'),switchResult=el('switch-result');
 const unlink=el('unlink-sync'),relink=el('relink-sync'),relinkActions=el('relink-qr-actions');
 const restart=el('restart-sync'),restartConfirm=el('restart-confirm'),restartAccept=el('restart-accept'),restartDismiss=el('restart-dismiss'),restartGuide=el('restart-guide'),targetLabel=el('relink-target');
 const revokeBackup=el('revoke-backup'),revokeBackupConfirmed=el('revoke-backup-confirmed'),revokeWarning=el('revoke-warning');
 const manageDevices=el('manage-devices'),deviceManagement=el('device-management'),deviceList=el('device-list'),deviceCount=el('device-count'),deviceManagementStatus=el('device-management-status');
 let savedRevokeBackup=false,backupFingerprint=null;
 const backupButton=el('relink-backup'),confirmReconnection=el('relink-confirm'),startReconnection=el('relink-start'),cancelReconnection=el('relink-cancel');
 let restartGuideOpen=revokeJournal.read()==='confirmed';
 let newBackupDownloaded=false,backupRevision=null,qrTargetAllowed=!receiving;
 const oldConnectionKey=SYNC_PAUSE_KEY+profileSuffix(profileState.active);
 const oldPause=createSyncPauseGuard({local,key:oldConnectionKey});
 function showConnectionActions(){
  const state=profiles.read();connectionActions.hidden=false;connectionActions.dataset.syncPhase=state.phase;
  if(state.phase==='disconnected'||state.phase==='preparing'){
   const existingPanel=document.getElementById('formal-sync-controls');if(existingPanel)existingPanel.hidden=true;
  }
  unlink.hidden=true; // local-only unlink leaked a cloud slot; replaced by verified self-revoke
  // The recovery escape hatch stays available, but is no longer the main CTA.
  relink.hidden=state.phase!=='disconnected'||revokeJournal.read()==='confirmed';
  restart.hidden=staging||revokeJournal.read()==='confirmed'||!['connected','disconnected'].includes(state.phase)||!restartConfirm.hidden;
  if(state.phase!=='connected')restartConfirm.hidden=true;
  restartGuide.hidden=state.phase!=='disconnected'||!restartGuideOpen||(qrFlow&&receiving);
  relinkActions.hidden=state.phase!=='disconnected'||!receiving;
  targetLabel.hidden=state.phase!=='disconnected'||!receiving;
  cancelReconnection.hidden=!['preparing','ready'].includes(state.phase);
  if(revokeJournal.read()==='pending'){
   attention(true);status.textContent='サーバー側の登録解除が完了したか確認できません。同期は安全のため停止中です。「同期設定を最初からやり直す」から解除結果を再確認してください。記録は保存されています。';
  }
  if(state.phase==='disconnected'){
   pauseButton.hidden=true;resumeButton.hidden=true;
   attention(true);status.textContent=restartGuideOpen?'この端末の同期を解除しました。下の手順で再接続できます。':'この端末の同期を解除しました。記録はそのままです。下から再接続できます。';
   restart.hidden=restartGuideOpen||revokeJournal.read()==='confirmed';
   if(revokeJournal.read()==='confirmed')status.textContent='この端末のサーバー登録を解除しました。記録は保持しています。再接続するには、管理端末で新しいQRを発行して読み取ってください。以前の同期先に直接戻すことはできません。';
  }else if(['preparing','ready'].includes(state.phase)){
   pauseButton.hidden=true;resumeButton.hidden=true;unlink.hidden=true;relink.hidden=true;
   attention(true);status.textContent=state.phase==='ready'?'新しい接続先へ接続準備中です。6桁コードを元の端末で承認し、この端末で「接続を完了」を押してください。':'再接続の準備が完了していません。元の暗号化記録は保持されています。中止して復元できます。';
  }
 }
 // Restart is an explicit local-profile transition, not deletion of sync data.
 // For an already-disconnected device it only reveals the new-QR workflow.
 revokeBackup.addEventListener('click',()=>{
  savedRevokeBackup=false;backupFingerprint=null;revokeBackupConfirmed.checked=false;restartAccept.disabled=true;
  try{
   const snapshot=canonical(appToSnapshot(storage.read()));
   const raw=storage.exportBackup(),url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='anime-log-before-device-revoke.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   backupFingerprint=snapshot;savedRevokeBackup=true;
  }catch(e){message(e)}
 });
 revokeBackupConfirmed.addEventListener('change',()=>{restartAccept.disabled=!(savedRevokeBackup&&revokeBackupConfirmed.checked)});
 restart.addEventListener('click',()=>{
  const state=profiles.read();
  if(staging||!['connected','disconnected'].includes(state.phase))return;
  if(state.phase==='disconnected'){
   restartGuideOpen=true;showConnectionActions();return;
  }
  savedRevokeBackup=false;backupFingerprint=null;revokeBackupConfirmed.checked=false;restartAccept.disabled=true;
  try{
   const x=inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
   revokeWarning.textContent=x.localDiffersFromCheckpoint?'未送信の変更がある可能性があります。先に再同期するか、バックアップを保存してください。解除後は他端末に自動反映されません。':'バックアップを保存してから解除してください。';
  }catch{revokeWarning.textContent='同期の確認状態が不明です。記録を消さず、独立バックアップを保存してから進んでください。';}
  restartConfirm.hidden=false;restart.hidden=true;
 });
 restartDismiss.addEventListener('click',()=>{
  restartConfirm.hidden=true;showConnectionActions();
 });
 async function getRegisteredTransport(){
  const passphrase=await keys.read();if(!passphrase)throw Error('DEVICE_KEY_REQUIRED');
  const scope=checkLineage(storage.read().weeklyOptions?.__syncLineage);
  if(scope.api!==api.origin)throw Error('DEVICE_SCOPE_MISMATCH');
  const fetcher=createV405BrowserWorkerFetch({apiOrigin:api.origin,siteOrigin:location.origin,pageOrigin:location.origin,browserFetch});
  return running.sealedCredentials.resume({vault,passphrase,fetcher,expectedApiRoot:api.origin,expectedOrigin:location.origin,expectedBoxId:scope.boxId});
 }
 restartAccept.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(staging||profiles.read().phase!=='connected'||!savedRevokeBackup||!revokeBackupConfirmed.checked)throw Error('REVOKE_BACKUP_OR_CONNECTION_REQUIRED');
  // Do not interrupt an owner connection or silently revoke its authority.
  // Role is checked first; after a lost response the journal permits self-retry
  // even though the old member no longer authenticates for GET /me.
  const transport=await getRegisteredTransport();
  if(revokeJournal.read()!=='pending'){
   let role;
   try{role=await getOwnRole(transport)}
   catch(e){
    // A remote owner may already have revoked this member. In that one case,
    // self-revoke with the old token can authenticate a prior revocation and
    // prove that the slot is free. Any other failure remains blocked.
    if(String(e?.message)!=='DEVICE_REGISTRATION:UNAUTHORIZED')throw e;
    role='previously-revoked-member-or-invalid';
   }
   if(role==='owner'){
    switchResult.hidden=false;switchResult.textContent='この端末は管理端末です。現在の登録を解除すると他端末が管理不能になるため、この操作はできません。';
    restartConfirm.hidden=true;showConnectionActions();return;
   }
  }
  oldPause.pause();automatic?.stop();automatic=null;
  await ui.whenWritesIdle();if(activeSyncs!==0)throw Error('SYNC_IN_FLIGHT_RETRY_AFTER_COMPLETION');
  if(backupFingerprint!==canonical(appToSnapshot(storage.read())))throw Error('BACKUP_STALE_SAVE_NEW_BACKUP');
  if(revokeJournal.read()!=='pending')revokeJournal.pending();
  const result=await revokeThisMember(transport);
  revokeJournal.confirmed(); // durable before local pointer move
  profiles.disconnect();restartConfirm.hidden=true;restartGuideOpen=true;
  showPauseState();showConnectionActions();void showDestination();
  switchResult.hidden=false;switchResult.textContent='この端末の登録解除をサーバーで確認しました。登録数：'+result.activeDevices+' / 4台。記録は保持しています。再接続する場合は管理端末で新しいQRを表示してください。';
 }))); 
 unlink.addEventListener('click',()=>{switchResult.hidden=false;switchResult.textContent='登録枠を残す旧解除方法は廃止しました。「同期設定を最初からやり直す」を使ってください。';});
 relink.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(revokeJournal.read()==='confirmed')throw Error('REVOKED_CONNECTION_CANNOT_RESUME');
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
   if(receiving&&qrTargetAllowed)nextQrStep('バックアップを保存したか確認してください','ダウンロードしたファイルが保存されたこと、同期先IDが正しいこと、ほかのタブを閉じたことを確認し、チェックを入れてください。',{step:1,device:'この端末で操作'});
  }catch(e){message(e)}
 });
 confirmReconnection.addEventListener('change',()=>{startReconnection.disabled=!(newBackupDownloaded&&confirmReconnection.checked&&qrTargetAllowed);if(receiving&&qrTargetAllowed&&newBackupDownloaded&&confirmReconnection.checked)nextQrStep('この端末で接続を開始してください','下の「この端末を接続する」を押してください。続いてPCで6桁コードを承認します。',{step:1,device:'この端末で操作'});});
 startReconnection.addEventListener('click',()=>action(()=>profileExclusive(async()=>{
  if(!receiving||!captured?.href||!qrTargetAllowed||!newBackupDownloaded||!confirmReconnection.checked||profiles.read().phase!=='disconnected'||!oldPause.paused)throw Error('CONFIRMED_BACKUP_AND_QR_REQUIRED');
  const source=storage.read(),lineage=source.weeklyOptions.__syncLineage;
  const comparison=await compareScannedQrDestination({qrUrl:captured.href,siteOrigin:location.origin,apiOrigin:api.origin,lineage});
  if(comparison.sameDestination&&revokeJournal.read()!=='confirmed')throw Error('SAME_DESTINATION_USE_RECONNECT');
  inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  await storage.refresh();const original=storage.read(),sourceRevision=vault.readRevision();
  if(sourceRevision!==backupRevision)throw Error('BACKUP_STALE_DOWNLOAD_NEW_COPY');
  // Keep the full current WAL/checkpoint in the original database. A separate
  // encrypted genesis is an independent, durable copy, not an in-place rebind.
  const password=await keys.read();if(!password)throw Error('SOURCE_KEY_REQUIRED');
  const progress=profiles.begin({sourceRevision,oldTabsClosed:true,backupSaved:true});
  const stageFactory=()=>createFormalProductionANIPrimary({idb,locks,profileId:progress.staging});
  const stageVault=stageFactory();const stageStorage=createFormalStorage({vault:stageVault,independentVault:stageFactory});
  // In this restart workflow, adopt the established group's records without
  // uploading this device's possibly wrong-box records/tombstones to it.
  const copy=prepareExistingGroupOnlyCopy(original);
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
  // The pause guard and connection inspection remain available internally.
  // They are not independent user decisions in the ordinary sync dialog.
  pauseButton.hidden=true;resumeButton.hidden=true;switchCheck.hidden=true;
  // One primary recovery action for a connected device. The former Resume
  // and conditional Retry buttons must not compete in the ordinary UI.
  const canRepair=!staging&&!ignoredExistingQR&&!revokeJournal.read()&&profiles.read().phase==='connected'&&profiles.read().active===selectedProfile;
  el('retry').hidden=!canRepair;
  if(canRepair){el('retry').textContent='再同期';el('retry').disabled=busy||recoveryActive;}
  showConnectionActions();
  if(paused&&profiles.read().phase==='connected'){attention(true);status.textContent=revokeJournal.read()==='pending'?'サーバー登録解除の結果が未確認です。自動同期を安全停止しています。解除前のバックアップを保持し、「同期設定を最初からやり直す」から解除結果を確認してください。':'同期は一時停止中です。記録と接続情報はそのままです。';}
 }
 showPauseState();
 if(profiles.read().phase==='disconnected'&&receiving){
  restartGuideOpen=true;showConnectionActions();
  // The QR has already been scanned. Do not tell the user to scan it again.
  restartGuide.hidden=true;
  nextQrStep('手順1：同期先IDを照合','下の「読み取ったQRの同期先ID」とPC側のIDを比較します。一致したら「バックアップを保存する」→確認チェック→「この端末を接続する」の順に進みます。続いてPCで6桁のコードを承認してください。');
  try{
   const comparison=await compareScannedQrDestination({qrUrl:captured.href,siteOrigin:location.origin,apiOrigin:api.origin,
    lineage:storage.read().weeklyOptions.__syncLineage});
   targetLabel.textContent='読み取ったQRの同期先ID：'+comparison.scannedID+'。接続したいPCまたはスマホ側の「同期先ID」と必ず比較してください。'+(comparison.sameDestination?(revokeJournal.read()==='confirmed'?' この端末の旧登録は失効済みです。新しいQRで改めて登録できます。':' このQRは以前の同期先です。別の同期先に変更する場合は、新しいQRを読み取ってください。'):'');
   targetLabel.hidden=false;
   qrTargetAllowed=!comparison.sameDestination||revokeJournal.read()==='confirmed';startReconnection.disabled=!(qrTargetAllowed&&newBackupDownloaded&&confirmReconnection.checked);
   if(comparison.sameDestination&&revokeJournal.read()!=='confirmed')nextQrStep('以前の同期先と同じQRです','元の同期先に戻したい場合は「詳細設定・復旧」の「以前の同期先に戻す」を使います。別の同期先に変更したい場合はPCから新しいQRを作成し、もう一度読み取ってください。');
  }catch{
   nextQrStep('QRの同期先を確認できません','この接続は進めず、元のPCで新しいQRを作成して読み取ってください。視聴記録は保護されています。');
   targetLabel.textContent='読み取ったQRの同期先IDを照合できません。接続を中止し、元の端末の新しいQRを読み取ってください。';
   targetLabel.hidden=false;
  }
 }
 pauseButton.addEventListener('click',()=>action(async()=>{
  if(local.getItem(LOCAL_MODE)!=='sync-enabled'||profiles.read().phase!=='connected')throw Error('CONNECTED_DEVICE_REQUIRED');
  pauseGuard.pause();automatic?.stop();automatic=null;
  showPauseState();
  switchResult.hidden=false;
  switchResult.textContent='新しい同期通信を停止しました。開始済みの通信は完了する場合があります。他の古いタブも閉じてください。記録と未送信変更は保持しています。';
 }));
 resumeButton.addEventListener('click',()=>action(async()=>{
  if(revokeJournal.read())throw Error('SELF_REVOKE_NOT_RESUMABLE');
  if(local.getItem(LOCAL_MODE)!=='sync-enabled'||profiles.read().phase!=='connected')throw Error('CONNECTED_DEVICE_REQUIRED');
  // Never resume another lineage, an empty checkpoint or a corrupt pause flag.
  inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
  pauseGuard.resume({verified:true});
  try{await running.resumeAutomatic({passphrase:await keys.read()})}
  catch(e){pauseGuard.pause();automatic?.stop();automatic=null;showPauseState();throw e}
  showPauseState();
  switchResult.hidden=false;
  switchResult.textContent='同期を再開しました。結果は同期状態で確認してください。';
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
   resumeButton.hidden=true;pauseButton.hidden=true;switchCheck.hidden=true;}
 });
 const panelRoot=document.getElementById('formal-sync-controls');
 // Reuse the existing QR panel, hide developer-only bootstrap/unlock controls.
 for(const n of panelRoot.children)if(n.id!=='v407-pairing')n.hidden=true;
 const panelUI=panelRoot.querySelector('#v407-pairing');root.append(panelRoot);
 // A restored member has no pending pairing role event. Hide old guidance
 // up front; an explicit QR journey reveals it through the existing handler.
 panelUI.querySelector('[data-v407="status"]').hidden=!receiverJourneyActive;
 panelRoot.hidden=profileState.phase==='disconnected'||profileState.phase==='preparing';
 for(const selector of ['[data-v408="box-id"]','[data-v408="unlock-owner"]','[data-v409="first-owner"]','[data-v407="repair"]','[data-v407="sync"]'])panelUI.querySelector(selector).hidden=true;
 panelUI.querySelector('[data-v407="invite"]').textContent='新しい端末を追加する';
  const inviteButton=panelUI.querySelector('[data-v407="invite"]');
  // Only the owner sees the management entry beside the add-device action.
  if(!staging&&profiles.read().phase==='connected'&&selectedProfile){
   inviteButton.after(el('manage-devices'));
   panelRoot.after(el('device-management'));
   inviteButton.addEventListener('click',()=>{ownerJourneyActive=true;const v=panelUI.querySelector('[data-v407="status"]');if(v)v.hidden=false;nextQrStep('QRを準備しています','QRが表示されたら、新しい端末で読み取ってください。',{force:true,step:1,device:'新しい端末で操作'});});
  }
 // A QR scan plus a confirmed local cutover is sufficient to submit the
 // receiver claim. The owner still approves the exact six digits explicitly.
 // Keep only the actions relevant to this device; staging diagnostics remain
 // untouched and this does not alter any security checks.
 const receiver=staging||selectedProfile!=='legacy'||setup.readReceipt().role==='receiver';
  root.closest('dialog')?.addEventListener('close',()=>{
   if(!receiver){ownerJourneyActive=false;if(qrNext)qrNext.hidden=true;const v=panelUI.querySelector('[data-v407="status"]');if(v)v.hidden=true;}
   deviceManagement.hidden=true;el('device-confirm').hidden=true;selectedRemoval=null;
  });
  const ownDeviceButton=el('own-device-button'),ownDeviceInfo=el('own-device-info');
  ownDeviceButton.hidden=staging||profiles.read().phase!=='connected';
  ownDeviceButton.addEventListener('click',()=>action(async()=>{
   const t=await getRegisteredTransport();
   ownDeviceInfo.hidden=false;
   ownDeviceInfo.textContent='この端末の登録ID：'+shortDeviceId(t.device.deviceId)+'（管理画面のIDと照合してください）';
  }));
  manageDevices.hidden=receiver||staging||profiles.read().phase!=='connected';
  const localNames=createLocalDeviceNames(local,selectedProfile);
  let selectedRemoval=null;
  async function updateDeviceList(){
   deviceManagementStatus.textContent='登録端末を確認中…';
   const t=await getRegisteredTransport();
   const list=await listOwnerDevices(t);
   deviceCount.textContent='登録数：'+list.activeDevices+' / '+list.maxDevices+'台';
   deviceList.replaceChildren();selectedRemoval=null;
   for(const item of list.devices){
    const row=document.createElement('div');row.className='anilog-device-row';
    const identity=document.createElement('div');identity.className='anilog-device-identity';
    const heading=document.createElement('strong');
    const registered=document.createElement('small');
    const date=new Date(item.createdAt).toLocaleDateString('ja-JP');
    const name=localNames.get(item.deviceId);
    const standard=item.isThisDevice?'この端末（管理者）':item.role==='owner'?'管理端末':'追加端末';
    heading.textContent=name?name+' ・ '+standard:standard;
    registered.textContent='ID: '+shortDeviceId(item.deviceId)+' ・ 登録 '+date;
    identity.append(heading,registered);row.append(identity);
    if(item.role==='member'&&!item.isThisDevice){
     const choose=document.createElement('button');choose.type='button';choose.textContent='解除する';
     choose.addEventListener('click',()=>{
      selectedRemoval=item;
      deviceManagementStatus.textContent=(localNames.get(item.deviceId)||'追加端末')+'（'+shortDeviceId(item.deviceId)+'）を解除します。IDを確認してください。';
      el('device-confirm').hidden=false;el('device-confirm-check').checked=false;el('device-revoke').disabled=true;
     });row.append(choose);
    }
    // Aliases are optional, local-only and never used to identify a revoke target.
    if(!item.isThisDevice){
     const edit=document.createElement('button');edit.type='button';
     edit.textContent=name?'名前を変更':'名前を付ける';
     edit.addEventListener('click',()=>{
      if(row.querySelector('.anilog-device-name-edit'))return;
      const form=document.createElement('div');form.className='anilog-device-name-edit';
      const input=document.createElement('input');input.type='text';input.maxLength=24;
      input.placeholder='例：iPad';input.setAttribute('aria-label','この端末の名前');input.value=localNames.get(item.deviceId);
      const save=document.createElement('button');save.type='button';save.textContent='保存';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='やめる';
      const close=()=>{form.remove();edit.hidden=false};
      cancel.addEventListener('click',close);
      save.addEventListener('click',()=>{
       try{
        const saved=localNames.save(item.deviceId,input.value);
        heading.textContent=saved?saved+' ・ '+standard:standard;
        edit.textContent=saved?'名前を変更':'名前を付ける';
        deviceManagementStatus.textContent='端末名を保存しました（このブラウザのみ）。';
        close();
       }catch{deviceManagementStatus.textContent='端末名を保存できませんでした。ブラウザの保存設定を確認してください。';}
      });
      form.append(input,save,cancel);row.append(form);edit.hidden=true;input.focus();
     });
     row.append(edit);
    }
    deviceList.append(row);
   }
   el('device-confirm').hidden=true;
   deviceManagementStatus.textContent='端末名が分からない場合は、各端末でIDを確認してください。';
  }
  manageDevices.addEventListener('click',()=>action(async()=>{
   if(staging||profiles.read().phase!=='connected')throw Error('MANAGEMENT_NOT_CONNECTED');
   deviceManagement.hidden=false;await updateDeviceList();
  }));
  el('device-confirm-check').addEventListener('change',()=>{el('device-revoke').disabled=!el('device-confirm-check').checked});
  el('device-cancel').addEventListener('click',()=>{selectedRemoval=null;el('device-confirm').hidden=true});
  el('device-revoke').addEventListener('click',()=>action(async()=>{
   if(!selectedRemoval||!el('device-confirm-check').checked||selectedRemoval.role!=='member'||selectedRemoval.isThisDevice)throw Error('REVOKE_TARGET_NOT_CONFIRMED');
   // Bind this explicit confirmation before any asynchronous operation.
   const selection=selectedRemoval,target=selection.deviceId;
   const unchanged=()=>selectedRemoval===selection&&el('device-confirm-check').checked&&
    !staging&&profiles.read().phase==='connected'&&profiles.read().active===selectedProfile&&!revokeJournal.read();
   if(!unchanged())throw Error('REVOKE_CONTEXT_CHANGED');
   const t=await getRegisteredTransport();
   const before=await listOwnerDevices(t);
   if(!unchanged()||!before.devices.some(d=>d.deviceId===target&&d.role==='member'&&!d.isThisDevice))throw Error('REVOKE_TARGET_CHANGED');
   deviceManagementStatus.textContent='解除結果を確認中です。結果が分からない場合は、一覧を更新してください。';
   let postError=null;
   try{await revokeSelectedMember(t,target)}catch(error){postError=error}
   // The POST may have committed even if its response was lost. Reconcile
   // the same captured target using an authenticated read, never another POST.
   const after=await listOwnerDevices(t);
   if(after.devices.some(d=>d.deviceId===target))throw postError??Error('REVOKE_READBACK_MISMATCH');
   await updateDeviceList();
   deviceManagementStatus.textContent='端末 '+shortDeviceId(target)+' の解除を確認しました。現在の登録数：'+after.activeDevices+' / 4台。ほかの端末と記録はそのままです。';
  }));

 const hide=selector=>{const node=panelUI.querySelector('[data-v407="'+selector+'"]');if(node)node.hidden=true};
 hide('claim');hide('sync');
 panelUI.querySelector('[data-v407="refresh"]').textContent='承認状態を確認';
 panelUI.querySelector('[data-v407="approve"]').textContent='承認する';
 if(receiver){
  for(const id of ['invite','copy','qr','code','approve','receive','repair','refresh'])hide(id);
  panelUI.querySelector('[data-v407="check"]').textContent='承認状態を確認';
  panelUI.querySelector('[data-v407="receive"]').textContent='接続を完了';
 }else{for(const id of ['receiver-code','check','receive','repair'])hide(id)}
 function schedule(_session,fresh){
  automatic?.stop();automatic=null;
  if(pauseGuard.paused||profiles.read().phase!=='connected'||profiles.read().active!==selectedProfile){showPauseState();return;}
  automatic=createAutomaticSync({syncOnce:async()=>{activeSyncs++;try{pauseGuard.assertAllowed();const s=await fresh();pauseGuard.assertAllowed();return await s.syncOnce()}finally{activeSyncs--}},onState:s=>{
   if(pauseGuard.paused)return;
   const labels={syncing:'同期中',synced:'同期済み（この端末）',pending:'この端末に保存済み（未同期）',offline:'オフラインです。記録はこの端末に保存しています。',
    unavailable:'同期できませんでした。記録は保存済みです。',
    conflict:'記録に競合があります。自動同期を停止しました。両端末の記録はそのままです。'};
   status.textContent=labels[s.phase]??'端末に保存済み';
   // A closed settings panel must not hide unresolved sync errors. Keep the
   // notice until a later *confirmed* success instead of blinking on edits.
   if(s.phase==='synced'&&!(receiving&&mode==='sync-enabled'))attention(false);
   else if(s.phase==='conflict'||s.phase==='unavailable'||['blocked','too-large','unconfirmed'].includes(s.status))attention(true);
   // Do not expose raw record paths / JSON by default. Keep all diagnostic
   // values available behind a user-opened details element; sync is unchanged.
   const recoveryEntry=el('resolve-conflict');if(recoveryEntry)recoveryEntry.hidden=true;
   const conflictDetails=el('conflict-details');
   if(conflictDetails){
    conflictDetails.hidden=s.phase!=='conflict';
    if(s.phase!=='conflict')conflictDetails.open=false;
   }
   el('conflicts').hidden=s.phase!=='conflict';
   el('conflicts').textContent=s.phase==='conflict'?summarizeSyncConflictPaths(s.conflicts).map(c=>c.path+' / '+c.reason).join('\n'):'';
   el('retry').hidden=false;el('retry').textContent='再同期';
   el('retry').disabled=busy||recoveryActive||s.phase==='syncing';
   // A single tap first tries the normal conservative merge. Only when it
   // still conflicts do we open the existing protected choice flow.
   if(s.phase==='conflict'&&repairRequested){
    repairRequested=false;
    const dialog=root.closest('dialog');
    if(recoveryEntry&&dialog?.open)queueMicrotask(()=>{
     if(dialog.open&&!recoveryActive&&!pauseGuard.paused)recoveryEntry.click();
    });
   }else if(['synced','unavailable','offline'].includes(s.phase)||(s.phase==='pending'&&s.status!==undefined))repairRequested=false;
   // A completed presentation must not outlive the actual sync state.
   // This only changes guidance; retry, authorization and durability stay unchanged.
   if(receiver&&qrNext&&!qrNext.hidden&&s.phase!=='synced'){
    const waiting=s.phase==='syncing'||(s.phase==='pending'&&s.status===undefined);
    nextQrStep(waiting?'この端末の同期結果を確認しています':'この端末の同期はまだ確認できません',waiting?'同期結果が確認できるまでお待ちください。保存した記録は保持しています。':'下の同期状態を確認してください。記録は端末に保持しています。通信が戻ってから「再同期」で結果を確認できます。',{force:true,step:3,device:'この端末で確認',state:waiting?'active':'needs-attention'});
   }
   if(s.phase==='synced'&&receiver&&(qrFlow||!qrNext.hidden))nextQrStep('この端末の同期が完了しました','接続できました。この画面を閉じて使えます。',{force:qrFlow||!qrNext.hidden,step:3,device:'この端末：同期済み',state:'done'});
   if(s.phase==='synced')void running?.confirmAutomaticRole();
  }});automatic.start();
  // A registered receiver has no further pairing actions. Avoid leaving a
  // disabled "complete connection" button beside normal watchlist usage.
  if(receiver){hide('check');hide('receive');hide('receiver-code')}
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
  },beforeSync:()=>{if(!staging&&revokeJournal.read())throw Error('SELF_REVOKE_NOT_RESUMABLE');pauseGuard.assertAllowed();if(profiles.read().phase!=='connected'||profiles.read().active!==selectedProfile)throw Error('PROFILE_NOT_ACTIVE');const line=storage.read().weeklyOptions.__syncLineage;storage.assertSyncHistory({api:api.origin,boxId:line?.boxId})}});
 if(!staging&&profiles.read().phase==='connected')installConflictRecovery({root,locks,scope:suffix,vault,isEligible:()=>local.getItem(LOCAL_MODE)==='sync-enabled',
  isPaused:()=>pauseGuard.paused,isQuiescent:()=>activeSyncs===0,
  assertContext:()=>{if(!recoveryActive||!pauseGuard.paused||activeSyncs||profiles.read().phase!=='connected'||profiles.read().active!==selectedProfile||local.getItem(LOCAL_MODE)!=='sync-enabled')throw Error('REVIEW_CONTEXT_CHANGED');const line=vault.readCurrent().weeklyOptions.__syncLineage;storage.assertSyncHistory({api:api.origin,boxId:line?.boxId})},
  begin:async()=>{recoveryActive=true;pauseGuard.pause();automatic?.stop();automatic=null;await ui.whenWritesIdle();if(activeSyncs)throw Error('WAIT_FOR_SYNC_COMPLETION');await vault.refresh();ui.hydrate(vault.readCurrent());},
  end:()=>{recoveryActive=false;showPauseState();},
  getTransport:async()=>running.sealedCredentials.resume({vault,passphrase:await keys.read(),fetcher:createV405BrowserWorkerFetch({apiOrigin:api.origin,siteOrigin:location.origin,pageOrigin:location.origin,browserFetch}),expectedApiRoot:api.origin,expectedOrigin:location.origin,expectedBoxId:vault.readCurrent().weeklyOptions.__syncLineage.boxId}),
  complete:async()=>{await storage.refresh();ui.hydrate(storage.read());recoveryActive=false;pauseGuard.resume({verified:true});showPauseState();try{await running.resumeAutomatic({passphrase:await keys.read()});return {automaticRestored:true}}catch{pauseGuard.pause();automatic?.stop();automatic=null;showPauseState();return {automaticRestored:false}} }
 });
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
  if(revokeJournal.read()==='pending')throw Error('SELF_REVOKE_PENDING_USE_RESTART');
  const retryKind=classifyExistingSyncRetry({mode:currentMode,profilePhase:profiles.read().phase,scannedQrIgnored:ignoredExistingQR});
  if(retryKind!=='NOT_APPLICABLE'&&retryKind!=='EXISTING_CONNECTION_ONLY'){
   automatic?.stop();automatic=null;el('retry').hidden=true;attention(true);showConnectionActions();
   status.textContent=retryKind==='QR_REQUIRES_EXPLICIT_SWITCH'
    ?'新しいQRはまだ適用していません。元の同期先を続けるにはページを再読み込みしてください。別の同期先へ変更するには「詳細設定・復旧」の「この端末の同期を解除」から進み、バックアップを保存してください。視聴記録は消えません。'
    :'この端末は接続解除または再接続準備中です。通常の「接続を再試行」では古い同期先へ通信しません。画面に表示されたバックアップ・QR接続手順を進めてください。記録は保持されています。';
   return;
  }
  if(currentMode==='sync-enabled'&&profiles.read().phase==='connected'&&pauseGuard.paused){
   // Explicitly resume the SAME verified lineage; never silently re-pair or
   // clear the vault, pending WAL or old credentials.
   if(revokeJournal.read())throw Error('SELF_REVOKE_NOT_RESUMABLE');
   inspectConnectionSwitch({storage,vault,apiOrigin:api.origin});
   pauseGuard.resume({verified:true});repairRequested=true;
   try{await running.resumeAutomatic({passphrase:await keys.read()})}
   catch(e){repairRequested=false;pauseGuard.pause();automatic?.stop();automatic=null;showPauseState();throw e}
   showPauseState();return;
  }
  if(automatic){repairRequested=true;automatic.resumeAfterConflict();return}
  if(currentMode==='sync-enabled'){
   // Restart only the established, unchanged connection.
   repairRequested=true;
   try{await running.resumeAutomatic({passphrase:await keys.read()})}catch(e){repairRequested=false;throw e}return;
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
