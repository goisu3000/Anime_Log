/* Explicit, non-default owner adoption for an existing formal local vault.
 * READ-ONLY transport: server must already contain the EXACT local projection.
 * Reuses the existing confirmed WAL append, credential escrow and session.
 * No upload, server seed, baseline invention, overwrite or SYNC_ON on import. */
import {appToSnapshot} from './app-bridge.mjs';
import {canonical} from './formal-storage.mjs';
import {parseV409OwnerHandoff} from './v409-owner-handoff.mjs';
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {V30EncryptedClient} from './v30-encrypted-sync-client.mjs';
import {confirmTransportAndCommitVault} from './v401-confirmed-worker-vault-commit.mjs';
import {createV405BrowserExplicitSyncSession} from './v405-browser-explicit-sync-session.mjs';
const fail=why=>{throw Error('FORMAL_OWNER_BASELINE_STOP:'+why)};
export async function adoptFormalOwnerBaseline({networkApproved=false,initialOwnerApproved=false,
 capturedUrl,siteOrigin,apiOrigin,expectedOwnerPage,passphrase,vault,storage,ui,uiBridge,sealedCredentials,independentVault,
 browserFetch=globalThis.fetch,pageOrigin=globalThis.location?.origin}={}){
 if(networkApproved!==true||initialOwnerApproved!==true)fail('EXPLICIT_APPROVAL_REQUIRED');
 if(pageOrigin!==siteOrigin||!storage?.ready||vault?.getState()!=='ACTIVE'||!uiBridge?.ready)fail('UNLOCKED_LOCAL_CONTEXT_REQUIRED');
 storage.assertSyncHistory();
 if(typeof independentVault!=='function'||typeof passphrase!=='string'||passphrase.length<16||passphrase.length>256)fail('INDEPENDENT_UNLOCK_REQUIRED');
 const verified=independentVault();await verified.unlock(passphrase);
 if(verified.readRevision()!==vault.readRevision()||canonical(verified.readCurrent())!==canonical(vault.readCurrent()))fail('STALE_LOCAL_VAULT');
 if((await sealedCredentials.inspect()).phase!=='EMPTY_LOCKED')fail('USE_APPROVED_DEVICE_RESTORE');
 const revision=vault.readRevision(),before=canonical(vault.readCurrent()),local=appToSnapshot(vault.readCurrent());
 const cp=vault.readSyncCheckpoint(),expectedRemote=cp?cp.snapshot:local;
 if(canonical(ui.readSaved())!==canonical(vault.readCurrent().records)||canonical(ui.readWeeklyOptions())!==canonical(vault.readCurrent().weeklyOptions))fail('STALE_UI');
 const handoff=parseV409OwnerHandoff(capturedUrl,{expectedSite:siteOrigin,expectedApi:apiOrigin,expectedPage:expectedOwnerPage});
 try{
  const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
  const roleReply=await fetcher(apiOrigin+'/v1/boxes/'+handoff.boxId+'/me',{method:'GET',headers:{Origin:siteOrigin,
   Authorization:'Bearer '+handoff.device.deviceToken,'X-Device-Id':handoff.device.deviceId}});
  if(!roleReply?.ok||(await roleReply.json())?.role!=='owner')fail('OWNER_ROLE_REQUIRED');
  const transport=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,boxId:handoff.boxId,device:handoff.device,masterKey:handoff.masterKey});
  const ack=await transport.sync({maxRetries:1});
  if(ack.status!=='synced'||ack.uploaded!==false||ack.revision<1)fail('REMOTE_NOT_PRESEEDED');
  if(canonical(transport.snapshot())!==canonical(expectedRemote))fail('REMOTE_DIFFERS_FROM_LOCAL');
  storage.assertSyncHistory();
  if(vault.readRevision()!==revision||canonical(vault.readCurrent())!==before)fail('LOCAL_CHANGED');
  // A previous attempt may have appended the equal checkpoint but failed to
  // enroll credentials. Retry must match that checkpoint; later local edits
  // remain pending and are never replaced by the checkpoint snapshot.
  if(cp){
   if(cp.serverRevision!==ack.revision)fail('EXISTING_BASELINE_MISMATCH');
  }else{
   await confirmTransportAndCommitVault({vault,transport,syncResult:ack,expectedVaultRevision:revision});
  }
  storage.attachVerified();
  const current=vault.readCurrent();ui.commitSaved(current.records,current.weeklyOptions);
  const sealed=await sealedCredentials.enroll({vault,credentials:{apiRoot:apiOrigin,origin:siteOrigin,boxId:handoff.boxId,
   device:handoff.device,masterKey:handoff.masterKey},passphrase,fetcher});
  if(sealed.phase!=='SEALED_CREDENTIALS_PERSISTED')fail('CREDENTIALS_NOT_SAVED');
  const session=await createV405BrowserExplicitSyncSession({vault,uiBridge,sealedCredentials,passphrase,
   apiOrigin,siteOrigin,pageOrigin,boxId:handoff.boxId,browserFetch});
  return {phase:'FORMAL_EQUAL_BASELINE_AND_ENROLL_VERIFIED',boxId:handoff.boxId,ownerDevice:{...handoff.device},
   masterKey:new Uint8Array(handoff.masterKey),session,serverRevision:ack.revision};
 }finally{handoff.masterKey.fill(0)}
}
