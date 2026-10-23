// Internal high-entropy passphrase for the EXISTING encrypted WAL/credentials.
// The local wrapping CryptoKey is non-extractable; no PIN-derived encryption.
// This enables automatic local use, NOT protection against same-origin XSS or
// an attacker using an unlocked browser profile. Never export in record backups.
const DB='anilog-FORMAL-AUTOMATIC-DEVICE-KEY',STORE='device';
const bytes=new TextEncoder();
const aad=origin=>bytes.encode('ANI:LOG/automatic-device-key/v1|'+origin);
async function open(idb){return new Promise((yes,no)=>{const r=idb.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);r.onblocked=()=>no(Error('AUTO_KEY_BLOCKED'))})}
async function row(idb,next){const db=await open(idb);try{return await new Promise((yes,no)=>{
 const tx=db.transaction(STORE,next?'readwrite':'readonly'),s=tx.objectStore(STORE),q=s.get('key');let result;
 q.onsuccess=()=>{result=q.result??null;if(next){if(result){tx.abort();return}s.put(next,'key')}};
 tx.oncomplete=()=>yes(result);tx.onabort=tx.onerror=()=>no(Error('AUTO_KEY_WRITE_FAILED'));
 })}finally{db.close()}}
export function createAutomaticDeviceKey({idb=globalThis.indexedDB,locks=globalThis.navigator?.locks,crypto=globalThis.crypto,origin=globalThis.location?.origin}={}){
 async function decrypt(x){
  if(x.v!==1||x.origin!==origin||x.key?.extractable!==false||x.key?.algorithm?.name!=='AES-GCM')throw Error('AUTO_KEY_SCOPE');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:x.iv,additionalData:aad(origin)},x.key,x.ciphertext);
  const pass=new TextDecoder('utf-8',{fatal:true}).decode(plain);if(!/^[\w-]{43}$/.test(pass))throw Error('AUTO_KEY_FORMAT');return pass;
 }
 return Object.freeze({
  async read(){const x=await row(idb);return x?decrypt(x):null},
  async create({emptyVaultConfirmed=false}={}){
   if(emptyVaultConfirmed!==true)throw Error('EMPTY_VAULT_CONFIRMATION_REQUIRED');
   return locks.request(DB,{mode:'exclusive'},async()=>{
    if(await row(idb))throw Error('AUTO_KEY_ALREADY_EXISTS');
    const random=crypto.getRandomValues(new Uint8Array(32));
    const pass=btoa(String.fromCharCode(...random)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');random.fill(0);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(origin)},key,bytes.encode(pass));
    await row(idb,{v:1,origin,key,iv,ciphertext});
    const verified=await decrypt(await row(idb));if(verified!==pass)throw Error('AUTO_KEY_READBACK_FAILED');return verified;
   });
  }
 });
}
