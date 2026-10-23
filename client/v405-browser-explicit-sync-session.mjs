/* ANI:LOG v4.05: explicit browser-session bridge for previously approved
 * devices ONLY. Never initiates sync on unlock/restart, never stores secrets.
 * Reuses v404 sealed credentials, v403 baseline restoration, v402 ANI UI commit.
 * SYNTHETIC staging only, SYNC_OFF until separately approved.
 */
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':
 x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const fail=(reason)=>{throw Error('V405_EXPLICIT_SESSION_STOP:'+reason)};
export async function createV405BrowserExplicitSyncSession({vault,uiBridge,sealedCredentials,passphrase,
 apiOrigin,siteOrigin,pageOrigin=globalThis.location?.origin,boxId,browserFetch=globalThis.fetch}={}){
 if(!vault?.readRevision||!uiBridge?.syncPreview||!uiBridge?.confirmTransport||!sealedCredentials?.resume)fail('REQUIRED_VERIFIED_COMPONENTS');
 const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
 const transport=await sealedCredentials.resume({vault,passphrase,fetcher,expectedApiRoot:apiOrigin,
  expectedOrigin:siteOrigin,expectedBoxId:boxId});
 let running=false,halted=false;
 return Object.freeze({
  get stopped(){return halted},
  // Called ONLY after an explicit user action. No timer, polling, retries or auto-network.
  async syncOnce(){
   if(running||halted)fail('BUSY_OR_STOPPED');running=true;
   try{
    if(!uiBridge.ready)fail('ANI_UI_LOCKED');
    const preview=uiBridge.syncPreview();
    if(!preview.checkpoint||preview.checkpoint.serverRevision!==transport.checkpoint().revision)fail('BASELINE_DIVERGED');
    if(canonical(preview.checkpoint.snapshot)!==canonical(transport.checkpoint().baseline))fail('BASELINE_DIVERGED');
    const before=preview.vaultRevision;
    if(canonical(transport.snapshot())!==canonical(preview.snapshot))transport.stage(preview.snapshot);
    // A single attempt. Even a recoverable error requires a new explicit action.
    const ack=await transport.sync({maxRetries:1});
    if(ack.status!=='synced'){
     if(!['conflict','unavailable','blocked','too-large','retry-later','unconfirmed','local-changed'].includes(ack.status))fail('UNKNOWN_TRANSPORT_RESULT');
     return {status:ack.status,durable:false,manualReviewRequired:true,...(ack.status==='conflict'?{conflicts:structuredClone(ack.conflicts??[])}:{})};
    }
    if(vault.readRevision()!==before)fail('LOCAL_WAL_CHANGED_DURING_SYNC');
    // A read-only, already-current sync is a success WITHOUT a new WAL entry.
    // v401 commitConfirmedSync intentionally rejects non-advancing revisions.
    if(ack.revision===preview.checkpoint.serverRevision){
     if(canonical(transport.snapshot())!==canonical(preview.snapshot))fail('NOOP_REMOTE_MISMATCH');
     return {status:'up-to-date',durable:true,serverRevision:ack.revision,realAppRecords:Object.keys(vault.readCurrent().records).length};
    }
    const confirmed=await uiBridge.confirmTransport({transport,syncResult:ack});
    if(confirmed.phase!=='CONFIRMED_SYNC_ATOMIC_WAL_READBACK_VERIFIED')fail('CONFIRMATION_NOT_PERSISTED');
    return {status:'synced',durable:true,serverRevision:confirmed.serverRevision,
     realAppRecords:confirmed.realAppRecords};
   }catch(err){halted=true;throw err}
   finally{running=false}
  }
 });
}
