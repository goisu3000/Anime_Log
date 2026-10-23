import {sealRegistrationData,unsealRegistrationData} from './v408-https-staging-sealed-credentials.mjs';
const NAME='anilog-FORMAL-REGISTRATION-INTENT',STORE='sealed';
function open(idb){return new Promise((ok,no)=>{const q=idb.open(NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE);q.onerror=()=>no(q.error);q.onblocked=()=>no(Error('INTENT_BLOCKED'));q.onsuccess=()=>ok(q.result)})}
async function transact(idb,expected,next){const db=await open(idb);try{return await new Promise((ok,no)=>{
 const tx=db.transaction(STORE,next?'readwrite':'readonly'),s=tx.objectStore(STORE),q=s.get('intent');let result;
 q.onsuccess=()=>{result=q.result??null;if(next){if(JSON.stringify(result)!==JSON.stringify(expected)){tx.abort();return}s.put(next,'intent')}};
 tx.oncomplete=()=>ok(result);tx.onabort=tx.onerror=()=>no(Error('INTENT_WRITE_OR_CAS_FAILED'));q.onerror=()=>no(q.error);
})}finally{db.close()}}
export function createRegistrationIntentStore({idb=globalThis.indexedDB,locks=globalThis.navigator?.locks,origin=globalThis.location?.origin}={}){
 return Object.freeze({
  async read(passphrase){const row=await transact(idb);return row?unsealRegistrationData(row,passphrase,origin):null},
  async replace(expected,data,passphrase){return locks.request(NAME,{mode:'exclusive'},async()=>{
   const before=await transact(idb);if(!before)throw Error('INTENT_MISSING');
   const current=await unsealRegistrationData(before,passphrase,origin);
   if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('INTENT_CHANGED');
   const sealed=await sealRegistrationData(data,passphrase,origin);await transact(idb,before,sealed);
   const after=await unsealRegistrationData(await transact(idb),passphrase,origin);
   if(JSON.stringify(after)!==JSON.stringify(data))throw Error('INTENT_READBACK_FAILED');return after;
  })},
  async create(data,passphrase){return locks.request(NAME,{mode:'exclusive'},async()=>{
   const before=await transact(idb);if(before)throw Error('INTENT_ALREADY_EXISTS');
   const sealed=await sealRegistrationData(data,passphrase,origin);await transact(idb,null,sealed);
   const after=await transact(idb);if(JSON.stringify(after)!==JSON.stringify(sealed))throw Error('INTENT_READBACK_FAILED');
   // Independent transaction plus authenticated decryption before ANY network.
   const verified=await unsealRegistrationData(after,passphrase,origin);
   if(JSON.stringify(verified)!==JSON.stringify(data))throw Error('INTENT_READBACK_FAILED');return verified;
  })}
 });
}
