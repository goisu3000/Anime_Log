/* ANI:LOG v4.03: FIRST RECEIVER on a separate EMPTY synthetic-only vault.
 * Existing V30EncryptedClient supplies real Worker-authenticated GET and
 * AES-GCM decryption. No invented ACK, server upload or production records.
 */
import {decryptSnapshot,validateSnapshot} from '../sync-core.mjs';
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':
 x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b);
export async function firstReceiveFromConfirmedTransport({vault,transport,syncResult,passphrase,deviceWeeklyOpen=true,deviceWeeklyOptions}={}){
 if(!vault?.initializeConfirmedReceive||!vault?.inspectReadOnly||!transport?.request||!transport?.checkpoint||!transport?.snapshot)
  throw Error('V403_CONFIRMED_RECEIVER_REQUIRED');
 // A vault already containing records MUST NOT become an initial receiver.
 if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('V403_RECEIVER_NOT_EMPTY');
 if(syncResult?.status!=='synced'||!Number.isSafeInteger(syncResult.revision)||syncResult.revision<1)
  throw Error('V403_NO_CONFIRMED_REMOTE_TO_RECEIVE');
 const point=transport.checkpoint(),expected=transport.snapshot();
 if(point.revision!==syncResult.revision||!same(point.baseline,expected)||!same(point.local,expected))
  throw Error('V403_TRANSPORT_STATE_NOT_CONFIRMED');
 validateSnapshot(expected);
 return vault.initializeConfirmedReceive({passphrase,expectedRevision:point.revision,expectedSnapshot:expected,
  deviceWeeklyOpen,deviceWeeklyOptions,readBack:async()=>{
   const response=await transport.request('GET');
   const {revision,payload}=response.data||{};
   if(!Number.isSafeInteger(revision)||revision!==point.revision||!payload)throw Error('V403_REMOTE_CHANGED_DURING_RECEIVE');
   const snapshot=await decryptSnapshot(payload,{masterKey:transport.masterKey,boxId:transport.boxId,revision});
   if(!same(snapshot,expected))throw Error('V403_REMOTE_SNAPSHOT_MISMATCH');
   return {revision,snapshot};
  }});
}
