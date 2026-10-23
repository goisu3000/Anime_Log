import {ticketIdentity,digestText,selfRegistrationIdentity} from '../shared/registration-ticket.mjs';
import {appToSnapshot} from './app-bridge.mjs';
import {canonical} from './formal-storage.mjs';
import {freshId,freshSecret,secretToUrl,shaHex} from './pairing-client.mjs';
import {createOwnerRecoveryKit} from './recovery-kit.mjs';
import {encryptSnapshot,decryptSnapshot} from '../sync-core.mjs';
import {assessEncryptedPut} from '../shared/wire-limits.mjs';
import {V30EncryptedClient} from './v30-encrypted-sync-client.mjs';
import {confirmTransportAndCommitVault} from './v401-confirmed-worker-vault-commit.mjs';
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {createV405BrowserExplicitSyncSession} from './v405-browser-explicit-sync-session.mjs';
import {planInitialRecordMerge} from './initial-record-merge.mjs';
const fail=x=>{throw Error('FORMAL_REGISTRATION_STOP:'+x)};
const keyBytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='),c=>c.charCodeAt(0));
// Already owner-approved member credentials. Persist before any merge/upload;
// never create a box or infer approval from the invitation alone.
export async function preparePairedFormalRegistration({apiOrigin,siteOrigin,storage,vault,intentStore,passphrase,transport,device,masterKey,independentVault}={}){
 if(!storage.ready||vault.readSyncCheckpoint())fail('UNCONNECTED_UNLOCKED_VAULT_REQUIRED');
 const existing=await intentStore.read(passphrase);if(existing)fail('EXISTING_INTENT_SCOPE');
 const check=independentVault();await check.unlock(passphrase);
 if(canonical(check.readCurrent())!==canonical(storage.read())||check.readRevision()!==vault.readRevision())fail('INDEPENDENT_LOCAL_READBACK_REQUIRED');
 const remote=await transport.request('GET');if(remote.data.revision<1||!remote.data.payload)fail('INITIAL_REMOTE_REQUIRED');
 const snapshot=await decryptSnapshot(remote.data.payload,{masterKey,boxId:transport.boxId,revision:remote.data.revision});
 const current=storage.read(),merge=planInitialRecordMerge({localApp:current,remoteSnapshot:snapshot,apiOrigin,boxId:transport.boxId});
 if(!merge.ok)fail('INITIAL_RECORD_CONFLICT_KEEP_BOTH_COPIES');
 const lineage=merge.snapshot.settings.syncLineage,local=structuredClone(current);local.weeklyOptions.__syncLineage=lineage;
 return intentStore.create({v:1,registrationMode:'paired-device',api:apiOrigin,origin:siteOrigin,boxId:transport.boxId,device:{...device},
  masterKey:secretToUrl(masterKey),lineage,sourceAppDigest:await digestText(canonical(current)),pairingLocalBaseline:appToSnapshot(local),
  initialSnapshot:merge.snapshot,uploadPreviousSnapshot:snapshot,uploadBaseRevision:remote.data.revision},passphrase);
}
// No network. The encrypted intent and recovery kit exist BEFORE a box can exist.
export async function prepareFormalRegistration({ticket,registrationMode='operator-ticket',apiOrigin,siteOrigin,storage,vault,intentStore,passphrase,independentVault}={}){
 if(!storage.ready||vault.readSyncCheckpoint())fail('UNCONNECTED_UNLOCKED_VAULT_REQUIRED');
 const check=independentVault();await check.unlock(passphrase);
 if(canonical(check.readCurrent())!==canonical(storage.read())||check.readRevision()!==vault.readRevision())fail('INDEPENDENT_LOCAL_READBACK_REQUIRED');
 const existing=await intentStore.read(passphrase);if(existing){if(existing.api!==apiOrigin||existing.origin!==siteOrigin||existing.registrationMode!==registrationMode||
  (registrationMode!=='self-service'&&existing.ticket!==ticket))fail('EXISTING_INTENT_SCOPE');return existing}
 if(!['operator-ticket','self-service'].includes(registrationMode))fail('REGISTRATION_MODE_REQUIRED');
 const device={deviceId:freshId(),deviceToken:secretToUrl(freshSecret())},recoveryToken=secretToUrl(freshSecret());
 const registrationId=registrationMode==='self-service'?await shaHex(secretToUrl(freshSecret())):null;
 const t=registrationMode==='self-service'?await selfRegistrationIdentity({registrationId,deviceId:device.deviceId,tokenHash:await shaHex(device.deviceToken),recoveryHash:await shaHex(recoveryToken)}):await ticketIdentity(ticket);
 if(registrationMode!=='self-service'&&(t.api!==apiOrigin||t.exp<=Date.now()))fail('TICKET_SCOPE_OR_EXPIRY');
 const current=storage.read(),history=current.weeklyOptions.__migration?.history??'provided';
 const evidence=current.weeklyOptions.__migration?.evidence;
 if(history==='unknown'&&(!evidence?.independentBackupConfirmed||!evidence.oldClientsClosedConfirmed||evidence.targetOrigin!==siteOrigin))fail('UNKNOWN_HISTORY_CUTOVER_EVIDENCE_REQUIRED');
 const lineage={v:1,api:apiOrigin,boxId:t.boxId,history,sourceDigest:evidence?.sourceDigest??await digestText(canonical(current))};
 const proposed=structuredClone(current);proposed.weeklyOptions.__syncLineage=lineage;
 const snapshot=appToSnapshot(proposed),masterKey=freshSecret();
 try{
  const payload=await encryptSnapshot(snapshot,{masterKey,boxId:t.boxId,revision:1});
  if(!assessEncryptedPut({baseRevision:0,payload}).ok)fail('INITIAL_DATA_EXCEEDS_WIRE_LIMIT');
  const intent={v:1,registrationMode,registrationId,api:apiOrigin,origin:siteOrigin,ticket:ticket??null,boxId:t.boxId,device,masterKey:secretToUrl(masterKey),recoveryToken,
   lineage,initialSnapshot:snapshot,sourceAppDigest:await digestText(canonical(current)),
   ...(registrationMode==='operator-ticket'?{recoveryKit:await createOwnerRecoveryKit({boxId:t.boxId,recoveryToken,masterKey})}:{})};
  return await intentStore.create(intent,passphrase);
 }finally{masterKey.fill(0)}
}
export async function completeFormalRegistration(options={}){
 if(options.networkApproved!==true)fail('EXPLICIT_SYNC_AND_RECOVERY_BACKUP_REQUIRED');
 const locks=options.locks??globalThis.navigator?.locks;
 if(!locks?.request)fail('REGISTRATION_LOCK_REQUIRED');
 return locks.request('anilog-formal-registration-finalization',{mode:'exclusive'},()=>finishRegistration(options));
}
async function finishRegistration({networkApproved=false,recoveryKitSaved=false,getChallenge,independentVault,apiOrigin,siteOrigin,pageOrigin=globalThis.location?.origin,
 storage,vault,intentStore,passphrase,sealedCredentials,ui,uiBridge,browserFetch=globalThis.fetch}={}){
 if(networkApproved!==true)fail('EXPLICIT_SYNC_AND_RECOVERY_BACKUP_REQUIRED');
 const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
 if(storage.ready)await storage.refresh();
 let intent=await intentStore.read(passphrase);
 if(!intent||intent.v!==1||intent.api!==apiOrigin||intent.origin!==siteOrigin)fail('DURABLE_INTENT_SCOPE');
 const self=intent.registrationMode==='self-service',paired=intent.registrationMode==='paired-device';
 if(!self&&!paired&&recoveryKitSaved!==true)fail('EXPLICIT_SYNC_AND_RECOVERY_BACKUP_REQUIRED');
 const identity=paired?{boxId:intent.boxId}:self?await selfRegistrationIdentity({registrationId:intent.registrationId,deviceId:intent.device.deviceId,
  tokenHash:await shaHex(intent.device.deviceToken),recoveryHash:await shaHex(intent.recoveryToken)}):await ticketIdentity(intent.ticket);
 if(identity.boxId!==intent.boxId||(!self&&!paired&&identity.api!==apiOrigin))fail('INTENT_TICKET_MISMATCH');
 const key=keyBytes(intent.masterKey);
 try{
  const cp=vault.readSyncCheckpoint();
  const auth={Origin:siteOrigin,Authorization:'Bearer '+intent.device.deviceToken,'X-Device-Id':intent.device.deviceId};
  let role=await fetcher(apiOrigin+'/v1/boxes/'+intent.boxId+'/me',{method:'GET',headers:auth});
  if(role.status===401&&!cp&&!paired){
   const body={deviceId:intent.device.deviceId,tokenHash:await shaHex(intent.device.deviceToken),recoveryHash:await shaHex(intent.recoveryToken)};
   if(self){if(typeof getChallenge!=='function')fail('CHALLENGE_REQUIRED');body.registrationId=intent.registrationId;body.challengeToken=await getChallenge({binding:identity.binding})}
   const created=await fetcher(apiOrigin+'/v1/boxes',{method:'POST',headers:{Origin:siteOrigin,'Content-Type':'application/json',...(!self?{'X-Registration-Ticket':intent.ticket}:{})},body:JSON.stringify(body)});
   if(!created.ok)fail('REGISTRATION_NOT_CONFIRMED_KEEP_INTENT');const ack=await created.json();if(ack.boxId!==intent.boxId||ack.deviceId!==intent.device.deviceId)fail('REGISTERED_SCOPE_MISMATCH');
   role=await fetcher(apiOrigin+'/v1/boxes/'+intent.boxId+'/me',{method:'GET',headers:auth});
  }
  if(!role.ok||(await role.json()).role!==(paired?'member':'owner'))fail('OWNER_AUTHENTICATION_REQUIRED');
  const transport=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,boxId:intent.boxId,device:intent.device,masterKey:key});
  if(!cp){
   let remote=await transport.request('GET');if(remote.status!==200)fail('REGISTERED_BOX_UNAVAILABLE');
   if(!storage.read().weeklyOptions.__registrationPending){
    if(!paired&&remote.data.revision!==0)fail('INITIAL_REGISTRATION_STATE_NEEDS_REVIEW');
    if(typeof independentVault!=='function')fail('INDEPENDENT_LOCAL_READBACK_REQUIRED');
    const check=independentVault();await check.unlock(passphrase);const current=storage.read();
    if(canonical(check.readCurrent())!==canonical(current)||check.readRevision()!==vault.readRevision())fail('LOCAL_CHANGED_BEFORE_REGISTRATION');
    const proposed=structuredClone(current);proposed.weeklyOptions.__syncLineage=intent.lineage;
    const next=paired?{...intent,sourceAppDigest:await digestText(canonical(current))}:{...intent,initialSnapshot:appToSnapshot(proposed),sourceAppDigest:await digestText(canonical(current))};
    const payload=await encryptSnapshot(next.initialSnapshot,{masterKey:key,boxId:intent.boxId,revision:1});
    if(!assessEncryptedPut({baseRevision:0,payload}).ok)fail('INITIAL_DATA_EXCEEDS_WIRE_LIMIT');
    if(canonical(next)!==canonical(intent))intent=await intentStore.replace(intent,next,passphrase);
    await storage.beginRegistration(intent.lineage,{expectedSourceDigest:intent.sourceAppDigest});
   }
   if(paired)await storage.adoptInitialPairingMerge({baseline:intent.pairingLocalBaseline,target:intent.initialSnapshot,boxId:intent.boxId,api:apiOrigin});
   // The approved device can finish setup after authenticated readback.
   // Exact prior uploads are recognized; divergent remote edits on a newly
   // paired member must be rebased without inventing a successful PUT ACK.
   const base=intent.uploadBaseRevision??0;
   let plain=null;
   if(remote.data.revision<base)fail('INITIAL_REMOTE_ROLLBACK');
   if(remote.data.revision>0){
    plain=await decryptSnapshot(remote.data.payload,{masterKey:key,boxId:intent.boxId,revision:remote.data.revision});
    const ownAck=remote.data.revision===base+1&&canonical(plain)===canonical(intent.initialSnapshot);
    const prior=base>0&&remote.data.revision===base&&canonical(plain)===canonical(intent.uploadPreviousSnapshot);
    if(!ownAck&&!prior){
     // Unknown PUT ACK is not proof the last candidate was accepted. The only
     // safe common ancestor is the PREVIOUS authenticated remote snapshot.
     // A concurrent owner update can be merged if fields are independent;
     // overlaps must stop without changing either original copy.
     if(!paired||remote.data.revision<=base||!intent.uploadPreviousSnapshot)fail('INITIAL_REMOTE_DIFFERS');
     await storage.reconcileInitialPairingRemote({baseline:intent.uploadPreviousSnapshot,remote:plain,boxId:intent.boxId,api:apiOrigin,
      ...(remote.data.revision>base+1?{possibleAcceptedSnapshot:intent.initialSnapshot}:{})});
    }
   }else if(base!==0||remote.data.payload!==null)fail('INITIAL_REMOTE_DIFFERS');
   await storage.refresh();
   const current=appToSnapshot(storage.read());
   if(!plain||canonical(current)!==canonical(plain)){
    // Persist the exact candidate and the previous server revision before PUT.
    // Local edits may continue while the request is in flight.
    const next={...intent,uploadBaseRevision:remote.data.revision,uploadPreviousSnapshot:plain,initialSnapshot:current};
    intent=await intentStore.replace(intent,next,passphrase);
    const payload=await encryptSnapshot(current,{masterKey:key,boxId:intent.boxId,revision:remote.data.revision+1});
    if(!assessEncryptedPut({baseRevision:remote.data.revision,payload}).ok)fail('INITIAL_DATA_EXCEEDS_WIRE_LIMIT');
    const put=await transport.request('PUT',{baseRevision:remote.data.revision,payload});
    if(put.status!==200)fail('INITIAL_UPLOAD_UNCONFIRMED_KEEP_INTENT');
    remote=await transport.request('GET');
    if(remote.data.revision!==intent.uploadBaseRevision+1)fail('NONEMPTY_OR_CHANGED_INITIAL_BOX');
    plain=await decryptSnapshot(remote.data.payload,{masterKey:key,boxId:intent.boxId,revision:remote.data.revision});
    if(canonical(plain)!==canonical(intent.initialSnapshot))fail('INITIAL_REMOTE_DIFFERS');
   }
   // Authenticate the last network read BEFORE entering the WAL commit. A
   // connection loss must not put the local vault into STOP_NO_RETRY.
   await storage.refresh();
   if(canonical(appToSnapshot(storage.read()))!==canonical(plain))fail('LOCAL_CHANGED_RETRY_SETUP');
   const revision=vault.readRevision(),verifiedRemote=structuredClone(remote);
   const confirmed=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,boxId:intent.boxId,device:intent.device,masterKey:key,
    local:plain,baseline:plain,revision:remote.data.revision});
   confirmed.request=async method=>{if(method!=='GET')fail('READBACK_ONLY');return structuredClone(verifiedRemote)};
   await confirmTransportAndCommitVault({vault,transport:confirmed,syncResult:{status:'synced',revision:remote.data.revision},expectedVaultRevision:revision});
  }
  storage.attachVerified();
  if((await sealedCredentials.inspect()).phase==='EMPTY_LOCKED')await sealedCredentials.enroll({vault,passphrase,fetcher,credentials:{apiRoot:apiOrigin,origin:siteOrigin,boxId:intent.boxId,device:intent.device,masterKey:key}});
  else{const saved=await sealedCredentials.resume({vault,passphrase,fetcher,expectedApiRoot:apiOrigin,expectedOrigin:siteOrigin,expectedBoxId:intent.boxId});
   if(canonical(saved.device)!==canonical(intent.device)||canonical([...saved.masterKey])!==canonical([...key]))fail('STORED_CREDENTIALS_DIFFER')}
  await storage.completeRegistration({boxId:intent.boxId,api:apiOrigin});
  storage.assertSyncHistory({boxId:intent.boxId,api:apiOrigin});const state=storage.read();ui.commitSaved(state.records,state.weeklyOptions);
  const session=await createV405BrowserExplicitSyncSession({vault,uiBridge,sealedCredentials,passphrase,apiOrigin,siteOrigin,pageOrigin,boxId:intent.boxId,browserFetch});
  return {phase:'FORMAL_REGISTRATION_VERIFIED',boxId:intent.boxId,ownerDevice:{...intent.device},masterKey:new Uint8Array(key),session};
 }finally{key.fill(0)}
}
