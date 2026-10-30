/* PRIVATE Stage 3 PoC. Auxiliary, authenticated cache only; never writes vault.
 * Trusted-writer model: AEAD is not proof that semantic validation ran.
 * Revert the application to ignore this DB; no cleanup/migration is required.
 */
export const PERSISTENT_VALIDATOR_VERSION='stage3-B-poc-v2:7777566c523d067ee17a6a734bf2f81c6f4ecfb8';
export const CACHE_DB_SUFFIX='-VERIFIED-2A-CACHE-POC-v1';
const PURPOSE='ANI:LOG/verified-2a-auxiliary-cache/v1';
// Cache reads are optional. Never hold the first visible list for two seconds
// merely because a separate, disposable cache database is unresponsive.
// Writes remain best effort and run outside the foreground completion path.
const MAX_BYTES=12500000,READ_TIMEOUT_MS=750,WRITE_TIMEOUT_MS=2000;
const fields=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function createVerifiedWalCache({idb,cryptoProvider,databaseName,onStats=null}){
 const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 const stats=x=>{try{onStats?.(x)}catch{}};
 const context=identity=>JSON.stringify({purpose:PURPOSE,validatorVersion:PERSISTENT_VALIDATOR_VERSION,...identity});
 const aad=env=>encoder.encode(JSON.stringify({v:env.v,context:env.context,revision:env.revision,headDigest:env.headDigest}));
 async function request(mode,operation){
  return new Promise((resolve,reject)=>{
   let db=null,tx=null,done=false;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);try{db?.close()}catch{};error?reject(error):resolve(value)};
   const timer=setTimeout(()=>{try{tx?.abort()}catch{};finish(Error('CACHE_TIMEOUT'))},mode==='readonly'?READ_TIMEOUT_MS:WRITE_TIMEOUT_MS);
   let q;try{q=idb.open(databaseName+CACHE_DB_SUFFIX,1)}catch(error){finish(error);return}
   q.onblocked=()=>finish(Error('CACHE_BLOCKED'));
   q.onerror=()=>finish(q.error??Error('CACHE_OPEN_FAILED'));
   q.onupgradeneeded=()=>{q.result.createObjectStore('cache')};
   q.onsuccess=()=>{
    if(done){q.result.close();return}db=q.result;
    try{
     tx=db.transaction('cache',mode);let result;
     tx.onabort=()=>finish(tx.error??Error('CACHE_ABORT'));
     tx.onerror=()=>finish(tx.error??Error('CACHE_TRANSACTION_FAILED'));
     tx.oncomplete=()=>finish(null,result);
     operation(tx.objectStore('cache'),value=>{result=value});
    }catch(error){finish(error)}
   };
  });
 }
 return Object.freeze({
  async load(key,identity){
   const start=performance.now();
   try{
    const env=await request('readonly',(store,result)=>{const q=store.get('current');q.onsuccess=()=>result(q.result??null)});
    if(env===null){stats({operation:'load',result:'miss',ms:performance.now()-start});return null}
    if(!fields(env,['v','context','revision','headDigest','iv','ciphertext'])||env.v!==1||env.context!==context(identity)||!Number.isSafeInteger(env.revision)||env.revision<0||!hex(env.headDigest)||!(env.iv instanceof Uint8Array)||env.iv.length!==12||!(env.ciphertext instanceof ArrayBuffer)||env.ciphertext.byteLength<16||env.ciphertext.byteLength>MAX_BYTES)throw Error('CACHE_ENVELOPE_OR_CONTEXT');
    const bytes=await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv:env.iv,additionalData:aad(env),tagLength:128},key,env.ciphertext);
    const plain=JSON.parse(decoder.decode(bytes));
    if(plain?.revision!==env.revision||plain?.headDigest!==env.headDigest)throw Error('CACHE_INNER_HEADER_MISMATCH');
    stats({operation:'load',result:'authenticated',ms:performance.now()-start,bytes:env.ciphertext.byteLength});return plain;
   }catch{
    stats({operation:'load',result:'unavailable-or-invalid',ms:performance.now()-start});return null;
   }
  },
  async save(key,identity,plain){
   const start=performance.now();
   try{
    const bytes=encoder.encode(JSON.stringify(plain));if(bytes.length>MAX_BYTES-16)throw Error('CACHE_TOO_LARGE');
    const env={v:1,context:context(identity),revision:plain.revision,headDigest:plain.headDigest,iv:cryptoProvider.getRandomValues(new Uint8Array(12)),ciphertext:null};
    env.ciphertext=await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv:env.iv,additionalData:aad(env),tagLength:128},key,bytes);
    const written=await request('readwrite',(store,result)=>{
     const q=store.get('current');
     q.onsuccess=()=>{
      const previous=q.result;
      // An older tab cannot evict a newer receipt. This outer hint is not
      // trusted for validation; tampering with it can only prevent caching.
      if(previous?.context===env.context&&Number.isSafeInteger(previous.revision)&&previous.revision>env.revision){result(false);return}
      store.put(env,'current');result(true);
     };
    });
    stats({operation:'save',result:written?'written':'newer-receipt-preserved',ms:performance.now()-start,bytes:env.ciphertext.byteLength});return written;
   }catch{
    stats({operation:'save',result:'unavailable',ms:performance.now()-start});return false;
   }
  }
 });
}
