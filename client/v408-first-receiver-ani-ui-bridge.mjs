/* ANI:LOG v4.03. An EMPTY, isolated ANI UI is hydrated only after the new
 * receiver's remote AES-GCM snapshot + checkpoint were durably read back.
 * Reuses the existing v402 ANI handler bridge for subsequent edits/sync.
 * This does not expose production credentials, enable SYNC_ON, or attach a
 * network service to the browser test page.
 */
import {createV408ANIHandlerBridge} from './v408-ani-handler-bridge.mjs';
import {firstReceiveFromConfirmedTransport} from './v403-confirmed-first-receive.mjs';
import {appToSnapshot} from './app-bridge.mjs';
const cp=structuredClone;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createV408FirstReceiverANIUIBridge({vault,ui}={}){
 if(!ui?.readSaved||!ui?.readWeeklyOptions||!ui?.commitSaved||!vault?.initializeConfirmedReceive)
  throw Error('V403_REAL_ANI_RECEIVER_REQUIRED');
 const handler=createV408ANIHandlerBridge({vault,ui});
 let halted=false,receiving=false,hydrating=false;
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 const hydrate=()=>{
  const snapshot=vault.readCurrent();
  hydrating=true;
  try{ui.commitSaved(cp(snapshot.records),cp(snapshot.weeklyOptions))}finally{hydrating=false}
  if(!equal(ui.readSaved(),snapshot.records)||!equal(ui.readWeeklyOptions(),snapshot.weeklyOptions)||!vault.readSyncCheckpoint())
   throw Error('V403_RECEIVED_ANI_HYDRATION_FAILED');
  return Object.keys(snapshot.records).length;
 };
 return Object.freeze({
  get ready(){return !halted&&(!receiving||hydrating)&&handler.ready},
  async firstReceive({transport,syncResult,passphrase,deviceWeeklyOpen=true,deviceWeeklyOptions}={}){
   if(halted||receiving||handler.ready||Object.keys(ui.readSaved()).length)
    throw Error('V403_FIRST_RECEIVE_REQUIRES_EMPTY_LOCKED_ANI');
   receiving=true;
   try{
   const result=await firstReceiveFromConfirmedTransport({vault,transport,syncResult,passphrase,deviceWeeklyOpen,deviceWeeklyOptions});
   return Object.freeze({...result,realAppRecords:hydrate(),uiHydrated:true});
   }catch(error){halted=true;throw error}finally{receiving=false}
  },
  // Finish a failed first hydration after reload; never initialize or append WAL.
  async recoverFirstReceive({transport,syncResult,passphrase}={}){
   if(halted||receiving||handler.ready||Object.keys(ui.readSaved()).length)
    throw Error('V403_FIRST_RECEIVE_REQUIRES_EMPTY_LOCKED_ANI');
   receiving=true;
   try{
    if(syncResult?.status!=='synced'||syncResult.uploaded!==false||syncResult.revision<1)
     throw Error('V403_RECOVERY_REMOTE_NOT_CONFIRMED');
    const point=transport.checkpoint(),remote=transport.snapshot();
    if(point.revision!==syncResult.revision||canonical(point.baseline)!==canonical(remote)||canonical(point.local)!==canonical(remote))
     throw Error('V403_RECOVERY_REMOTE_NOT_CONFIRMED');
    await vault.unlock(passphrase);
    const checkpoint=vault.readSyncCheckpoint();
    if(vault.readRevision()!==0||checkpoint?.serverRevision!==point.revision||
     canonical(checkpoint?.snapshot)!==canonical(remote)||canonical(appToSnapshot(vault.readCurrent()))!==canonical(remote))
     throw Error('V403_RECOVERY_GENESIS_MISMATCH');
    return Object.freeze({realAppRecords:hydrate(),uiHydrated:true});
   }catch(error){halted=true;throw error}finally{receiving=false}
  },
  initialize:(...args)=>handler.initialize(...args),
  restore:(...args)=>handler.restore(...args),
  unlock:(...args)=>handler.unlock(...args),
  apply:(...args)=>handler.apply(...args),
  syncPreview:(...args)=>handler.syncPreview(...args),
  confirmTransport:(...args)=>handler.confirmTransport(...args),
  inspect:(...args)=>handler.inspect(...args),
  readBack:(...args)=>handler.readBack(...args)
 });
}
