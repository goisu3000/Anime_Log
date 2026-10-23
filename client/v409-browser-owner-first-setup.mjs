/* One explicit, owner-approved initial browser activation. Administration and
 * initial server seeding occur OUTSIDE the browser. Never use admin bootstrap
 * token in this module. Empty isolated WAL only; authenticated GET/AEAD readback.
 */
import {parseV409OwnerHandoff} from './v409-owner-handoff.mjs';
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {V30EncryptedClient} from './v30-encrypted-sync-client.mjs';
import {createV405BrowserExplicitSyncSession} from './v405-browser-explicit-sync-session.mjs';
const fail=s=>{throw Error('V409_OWNER_FIRST_SETUP_STOP:'+s)};
export async function provisionV409BrowserOwner({capturedUrl,siteOrigin,apiOrigin,expectedOwnerPage,passphrase,vault,uiBridge,sealedCredentials,
 browserFetch=globalThis.fetch,pageOrigin=globalThis.location?.origin}={}){
 if(typeof passphrase!=='string'||passphrase.length<16||passphrase.length>256)fail('TEST_PASSPHRASE_16_TO_256_REQUIRED');
 if(typeof vault?.inspectReadOnly!=='function')fail('VAULT_CONTEXT_REQUIRED');
 if(typeof uiBridge?.firstReceive!=='function')fail('UI_BRIDGE_CONTEXT_REQUIRED');
 if(typeof sealedCredentials?.inspect!=='function')fail('CREDENTIAL_CONTEXT_REQUIRED');
 // Single-purpose, sensitive capability parsed only from a captured, already-stripped fragment.
 const handoff=parseV409OwnerHandoff(capturedUrl,{expectedSite:siteOrigin,expectedApi:apiOrigin,expectedPage:expectedOwnerPage});
 try{
  if(pageOrigin!==siteOrigin||uiBridge.ready)fail('NONEMPTY_OWNER_DESTINATION');
  const vaultPhase=(await vault.inspectReadOnly()).phase;
  if(!['EMPTY_LOCKED','PRESENT_LOCKED'].includes(vaultPhase)||
    (await sealedCredentials.inspect()).phase!=='EMPTY_LOCKED')fail('NONEMPTY_OWNER_DESTINATION');
  const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
  const transport=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,boxId:handoff.boxId,
   device:handoff.device,masterKey:handoff.masterKey});
  // Server must already contain the exact synthetic snapshot seeded by the privileged CLI.
  // Empty local client downloads it; no initial owner upload is performed in browser.
  const ack=await transport.sync({maxRetries:1});
  if(ack.status!=='synced'||ack.revision<1||ack.uploaded!==false)fail('REMOTE_NOT_PROVISIONED');
  const receive=vaultPhase==='EMPTY_LOCKED'?uiBridge.firstReceive:uiBridge.recoverFirstReceive;
  if(typeof receive!=='function')fail('RECOVERY_CONTEXT_REQUIRED');
  const r=await receive({transport,syncResult:ack,passphrase});
  if(r.uiHydrated!==true||!vault.readSyncCheckpoint())fail('FIRST_RECEIVE_FAILED');
  const sealed=await sealedCredentials.enroll({vault,credentials:{apiRoot:apiOrigin,origin:siteOrigin,
   boxId:handoff.boxId,device:handoff.device,masterKey:handoff.masterKey},passphrase,fetcher});
  if(sealed.phase!=='SEALED_CREDENTIALS_PERSISTED')fail('CREDENTIALS_NOT_SAVED');
  const session=await createV405BrowserExplicitSyncSession({vault,uiBridge,sealedCredentials,passphrase,
   apiOrigin,siteOrigin,pageOrigin,boxId:handoff.boxId,browserFetch});
  return {phase:'OWNER_FIRST_RECEIVE_AND_ENROLL_VERIFIED',boxId:handoff.boxId,ownerDevice:{...handoff.device},
   // Caller uses this in-memory key for owner invitations; it is never stored outside AES vault.
   masterKey:new Uint8Array(handoff.masterKey),session,records:r.realAppRecords,serverRevision:ack.revision};
 }finally{
  handoff.masterKey.fill(0);
  // Never erase or retry if a first receive was committed before a later failure.
 }
}
