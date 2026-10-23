/* ANI:LOG v4.11. Restore an approved OWNER or MEMBER after browser restart.
 * Read-only authenticated server role is required before enabling owner actions.
 * No automatic sync, no new credential storage, no fallback to an empty WAL.
 */
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {createV405BrowserExplicitSyncSession} from './v405-browser-explicit-sync-session.mjs';
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const stop=why=>{throw Error('V411_RESUME_STOP:'+why)};
export async function restoreV411ApprovedDevice({vault,uiBridge,sealedCredentials,passphrase,boxId,
  apiOrigin,siteOrigin,pageOrigin=globalThis.location?.origin,browserFetch=globalThis.fetch}={}){
 if(!vault?.inspectReadOnly||!uiBridge?.unlock||!sealedCredentials?.resume||(boxId!==undefined&&!ID.test(boxId))||
    typeof passphrase!=='string'||passphrase.length<16||passphrase.length>256)stop('VERIFIED_CONTEXT_REQUIRED');
 const state=await vault.inspectReadOnly();
 if(state.phase!=='PRESENT_LOCKED')stop('DURABLE_LOCKED_VAULT_REQUIRED');
 // Fail closed: wrong password or a corrupt WAL must never become empty data.
 await uiBridge.unlock(passphrase);
 const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
 const transport=await sealedCredentials.resume({vault,passphrase,fetcher,
  expectedApiRoot:apiOrigin,expectedOrigin:siteOrigin,expectedBoxId:boxId});
 // This read-only role query still requires the restored authorized device token.
 const trustedBoxId=transport.boxId;
 if(!ID.test(trustedBoxId)||(boxId!==undefined&&trustedBoxId!==boxId))stop('VERIFIED_BOX_ID_REQUIRED');
 const result=await fetcher(apiOrigin+'/v1/boxes/'+trustedBoxId+'/me',{
  method:'GET',headers:{Origin:siteOrigin,Authorization:'Bearer '+transport.device.deviceToken,
   'X-Device-Id':transport.device.deviceId}
 });
 if(!result?.ok)stop('ROLE_NOT_AUTHENTICATED');
 let role;try{const data=await result.json();role=data?.role}catch{stop('BAD_ROLE_RESPONSE')}
 if(role!=='owner'&&role!=='member')stop('BAD_ROLE_RESPONSE');
 const session=await createV405BrowserExplicitSyncSession({vault,uiBridge,sealedCredentials,passphrase,
  apiOrigin,siteOrigin,pageOrigin,boxId:trustedBoxId,browserFetch});
 return Object.freeze({role,boxId:trustedBoxId,session,
   ...(role==='owner'?{ownerDevice:{...transport.device},masterKey:new Uint8Array(transport.masterKey)}:{})
 });
}
