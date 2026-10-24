/* ANI:LOG v4.08: origin-scoped HTTPS staging synthetic-only browser credential escrow.
 * Persists an already-authorized device's credentials encrypted with a
 * user-supplied passphrase, separate from the encrypted ANI WAL. No raw
 * masterKey, deviceToken, or passphrase is stored in IndexedDB/localStorage.
 * Enrollment is only permitted AFTER an authenticated WAL checkpoint exists.
 * Restart requires independently unlocking the WAL before decryption.
 * This is not XSS-proof and is NOT production-ready. No network calls here.
 */
import {restoreTransportFromEncryptedVault} from './v403-restored-transport-from-vault.mjs';
import {decryptSnapshot} from '../sync-core.mjs';
export const V408_CREDENTIAL_DB='anilog-v408-HTTPS-STAGING-SEALED-CREDENTIALS-ONLY';
const STORE='sealed', KEY='device', ITERATIONS=310000;
const PURPOSE='ANI:LOG/v408/staging-sealed-device-v1';
const e=new TextEncoder(),d=new TextDecoder('utf-8',{fatal:true});
const ID=/^[A-Za-z0-9_-]{22,43}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':isObject(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const keys=(x,expected)=>isObject(x)&&Object.keys(x).sort().join('|')===expected.slice().sort().join('|');
const fail=why=>{throw Error('V404_CREDENTIAL_STOP:'+why)};
const base64=bytes=>{let s='';for(const n of bytes)s+=String.fromCharCode(n);return btoa(s)};
const from64=(value,length,maxChars=4000)=>{if(typeof value!=='string'||value.length>maxChars||! /^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('BAD_BASE64');
 let a;try{a=Uint8Array.from(atob(value),c=>c.charCodeAt(0))}catch{fail('BAD_BASE64')}
 if(base64(a)!==value||(length!==undefined&&a.length!==length))fail('BAD_BASE64');return a};
function checkPassphrase(pass){if(typeof pass!=='string'||pass.length<16||pass.length>256||e.encode(pass).length>1024)fail('BAD_TEST_PASSPHRASE')}
function checkRoot(s){try{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'&&u.pathname!=='')fail('BAD_API_ROOT');return u.origin}catch{fail('BAD_API_ROOT')}}
function checkOrigin(s){try{const u=new URL(s);if(u.protocol!=='https:'||u.href!==u.origin+'/'||u.username||u.password)fail('BAD_ORIGIN');return u.origin}catch{fail('BAD_ORIGIN')}}
function requireCheckpoint(vault){
 if(!vault?.readSyncCheckpoint||!vault?.readCurrent||!vault?.readRevision)fail('UNLOCKED_CHECKPOINT_REQUIRED');
 let cp;try{cp=vault.readSyncCheckpoint();vault.readCurrent();vault.readRevision()}catch{fail('UNLOCKED_CHECKPOINT_REQUIRED')}
 if(!cp||!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1||!isObject(cp.snapshot))fail('CONFIRMED_CHECKPOINT_REQUIRED');
 return cp;
}
function checkCredentials(x){
 if(!isObject(x)||!keys(x,['apiRoot','origin','boxId','device','masterKey'])||!isObject(x.device)||!keys(x.device,['deviceId','deviceToken']))fail('INVALID_DEVICE_CREDENTIALS');
 const apiRoot=checkRoot(x.apiRoot),origin=checkOrigin(x.origin);
 if(!ID.test(x.boxId)||!ID.test(x.device.deviceId)||!TOKEN.test(x.device.deviceToken)||!(x.masterKey instanceof Uint8Array)||x.masterKey.length!==32)fail('INVALID_DEVICE_CREDENTIALS');
 return {apiRoot,origin,boxId:x.boxId,device:{deviceId:x.device.deviceId,deviceToken:x.device.deviceToken},masterKey:base64(x.masterKey)};
}
function checkEnvelope(env){
 if(!keys(env,['v','purpose','salt','iv','ciphertext'])||env.v!==1||env.purpose!==PURPOSE)fail('BAD_CREDENTIAL_ENVELOPE');
 from64(env.salt,16);from64(env.iv,12);
 if(from64(env.ciphertext).length<32||from64(env.ciphertext).length>4096)fail('BAD_CREDENTIAL_ENVELOPE');
}
function openDB(idb){return new Promise((ok,no)=>{const q=idb.open(V408_CREDENTIAL_DB,1);
 q.onupgradeneeded=()=>q.result.createObjectStore(STORE);
 q.onerror=()=>no(q.error??Error('CREDENTIAL_IDB_OPEN_ERROR'));
 q.onblocked=()=>no(Error('CREDENTIAL_IDB_BLOCKED'));
 q.onsuccess=()=>ok(q.result)
})}
async function transact(idb,mode,write=null){const db=await openDB(idb);
 try{return await new Promise((ok,no)=>{const tx=db.transaction(STORE,mode),s=tx.objectStore(STORE);
  let result,good=false;const keyRequest=s.getAllKeys(),record=s.get(KEY);
  keyRequest.onerror=()=>no(keyRequest.error||Error('CREDENTIAL_KEYS_ERROR'));
  record.onerror=()=>no(record.error||Error('CREDENTIAL_READ_ERROR'));
  let steps=0;const both=()=>{if(++steps!==2)return;
   const entries=keyRequest.result;
   if(!Array.isArray(entries)||entries.some(k=>k!==KEY)||entries.length>1){result={invalid:true};return}
   if(write!==null){if(entries.length||record.result!==undefined){result={exists:true};return}
    s.put(structuredClone(write),KEY);good=true;
   }else result={envelope:record.result??null};
  };
  keyRequest.onsuccess=both;record.onsuccess=both;
  tx.oncomplete=()=>ok(write!==null?{written:good,...result}:result);
  tx.onerror=()=>no(tx.error??Error('CREDENTIAL_IDB_ERROR'));
  tx.onabort=()=>no(tx.error??Error('CREDENTIAL_IDB_ABORT'));
 })}finally{db.close()}
}
async function derive(cryptoProvider,pass,salt){const raw=await cryptoProvider.subtle.importKey('raw',e.encode(pass),'PBKDF2',false,['deriveKey']);
 return cryptoProvider.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:ITERATIONS,salt},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
// Reuse the existing PBKDF2/AES-GCM implementation for a separate, origin-bound
// pre-network registration receipt. Never included in portable record backups.
const INTENT_PURPOSE='ANI:LOG/formal-registration-intent-v1';
// The initial paired-device intent can hold three distinct, *already validated*
// snapshots (local baseline, remote before, and merged result). Each snapshot
// may be as large as MAX_SYNC_BYTES (3 MB). The previous 300 KB plain-JSON
// ceiling incorrectly prevented normal QR enrollment with substantial records.
// Keep the legacy v1 envelope unchanged for small intents / pending older QR
// flows. Large intents use an authenticated, bounded gzip v2 envelope.
const INTENT_V1_LIMIT=300_000;
const INTENT_JSON_LIMIT=10_000_000; // Three 3 MB snapshots + bounded metadata.
const INTENT_GZIP_LIMIT=1_000_000; // More than three max-size wire snapshots.
const INTENT_V2_CIPHER_CHARS=Math.ceil((INTENT_GZIP_LIMIT+16)/3)*4;
const INTENT_V2_AAD=INTENT_PURPOSE+':gzip-v2';
async function compressRegistrationIntent(raw){
 if(typeof CompressionStream!=='function')fail('REGISTRATION_COMPRESSION_UNAVAILABLE');
 const bytes=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 if(bytes.length>INTENT_GZIP_LIMIT){bytes.fill(0);fail('REGISTRATION_INTENT_TOO_LARGE')}
 return bytes;
}
async function expandRegistrationIntent(bytes){
 if(typeof DecompressionStream!=='function')fail('REGISTRATION_DECOMPRESSION_UNAVAILABLE');
 const chunks=[];let size=0,reader;
 try{
  reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  while(true){const {value,done}=await reader.read();if(done)break;
   size+=value.length;if(size>INTENT_JSON_LIMIT)fail('REGISTRATION_INTENT_TOO_LARGE');
   chunks.push(value);
  }
  const result=new Uint8Array(size);let position=0;
  for(const chunk of chunks){result.set(chunk,position);position+=chunk.length;chunk.fill(0)}
  return result;
 }catch(error){
  if(String(error?.message).includes('REGISTRATION_INTENT_TOO_LARGE'))throw error;
  fail('REGISTRATION_INTENT_COMPRESSION_INVALID');
 }finally{if(reader)await reader.cancel().catch(()=>{});for(const chunk of chunks)chunk.fill(0)}
}
export async function sealRegistrationData(data,passphrase,origin,cryptoProvider=globalThis.crypto){
 checkPassphrase(passphrase);const salt=cryptoProvider.getRandomValues(new Uint8Array(16)),iv=cryptoProvider.getRandomValues(new Uint8Array(12));
 const raw=e.encode(JSON.stringify(data));
 if(raw.length>INTENT_JSON_LIMIT){raw.fill(0);fail('REGISTRATION_INTENT_TOO_LARGE')}
 const large=raw.length>INTENT_V1_LIMIT;
 let encoded=raw;
 try{
  if(large)encoded=await compressRegistrationIntent(raw);
  const k=await derive(cryptoProvider,passphrase,salt);
  const purpose=large?INTENT_V2_AAD:INTENT_PURPOSE;
  const ciphertext=await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv,additionalData:e.encode(purpose+':'+origin)},k,encoded);
  return {v:large?2:1,purpose:INTENT_PURPOSE,salt:base64(salt),iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};
 }finally{encoded.fill(0);raw.fill(0)}
}
export async function unsealRegistrationData(env,passphrase,origin,cryptoProvider=globalThis.crypto){
 checkPassphrase(passphrase);
 if(!keys(env,['v','purpose','salt','iv','ciphertext'])||![1,2].includes(env.v)||env.purpose!==INTENT_PURPOSE)fail('BAD_REGISTRATION_ENVELOPE');
 const k=await derive(cryptoProvider,passphrase,from64(env.salt,16));
 const purpose=env.v===2?INTENT_V2_AAD:INTENT_PURPOSE;
 const maxChars=env.v===2?INTENT_V2_CIPHER_CHARS:401000;
 let encrypted,raw;
 try{
  encrypted=new Uint8Array(await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv:from64(env.iv,12),additionalData:e.encode(purpose+':'+origin)},k,from64(env.ciphertext,undefined,maxChars)));
  raw=env.v===2?await expandRegistrationIntent(encrypted):encrypted;
  if(raw.length>INTENT_JSON_LIMIT)fail('REGISTRATION_INTENT_TOO_LARGE');
  return JSON.parse(d.decode(raw));
 }finally{if(raw)raw.fill(0);if(encrypted)encrypted.fill(0)}
}
export function createV408StagingSealedDeviceCredentials({idb=globalThis.indexedDB,cryptoProvider=globalThis.crypto,locks=globalThis.navigator?.locks}={}){
 if(!idb?.open||!cryptoProvider?.subtle||!cryptoProvider?.getRandomValues||!locks?.request)fail('BROWSER_CRYPTO_IDB_LOCK_REQUIRED');
 const exclusive=fn=>locks.request(V408_CREDENTIAL_DB+'-exclusive',{mode:'exclusive'},fn);
 return Object.freeze({
  async inspect(){const x=await transact(idb,'readonly');if(x.invalid)fail('UNEXPECTED_STORED_KEYS');
   if(x.envelope!==null)checkEnvelope(x.envelope);return {phase:x.envelope?'PRESENT_LOCKED':'EMPTY_LOCKED',encrypted:true,productionReady:false}},
  async enroll({vault,credentials,passphrase,fetcher}={}){
   const checkpoint=requireCheckpoint(vault);checkPassphrase(passphrase);const data=checkCredentials(credentials);
   if(typeof fetcher!=='function')fail('AUTHENTICATED_READBACK_REQUIRED');
   return exclusive(async()=>{
    const before=await transact(idb,'readonly');if(before.invalid)fail('UNEXPECTED_STORED_KEYS');if(before.envelope!==null)fail('ALREADY_ENROLLED');
    // Confirm this specific device is actually authorized and owns the key
    // for the already-durable server checkpoint, BEFORE saving credentials.
    const transport=restoreTransportFromEncryptedVault({vault,fetcher,apiRoot:data.apiRoot,origin:data.origin,
     boxId:data.boxId,device:data.device,masterKey:credentials.masterKey});
    let answer;try{answer=await transport.request('GET')}catch{fail('DEVICE_AUTHENTICATION_NOT_CONFIRMED')}
    if(answer.status!==200||answer.data?.revision!==checkpoint.serverRevision||!answer.data.payload)fail('REMOTE_CHECKPOINT_NOT_CONFIRMED');
    let remote;try{remote=await decryptSnapshot(answer.data.payload,{masterKey:credentials.masterKey,boxId:data.boxId,revision:answer.data.revision})}
    catch{fail('ENROLLED_MASTER_KEY_NOT_VERIFIED')}
    if(canon(remote)!==canon(checkpoint.snapshot))fail('REMOTE_CHECKPOINT_MISMATCH');
    const salt=cryptoProvider.getRandomValues(new Uint8Array(16)),iv=cryptoProvider.getRandomValues(new Uint8Array(12));
    const key=await derive(cryptoProvider,passphrase,salt);
    const raw=new Uint8Array(e.encode(JSON.stringify(data)));
    let ciphertext;try{ciphertext=new Uint8Array(await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv,additionalData:e.encode(PURPOSE),tagLength:128},key,raw))}finally{raw.fill(0)}
    const envelope={v:1,purpose:PURPOSE,salt:base64(salt),iv:base64(iv),ciphertext:base64(ciphertext)};
    const done=await transact(idb,'readwrite',envelope);
    if(done.invalid||!done.written)fail('CREDENTIAL_ENROLL_CAS_REJECTED');
    const verify=await transact(idb,'readonly');
    if(verify.invalid||JSON.stringify(verify.envelope)!==JSON.stringify(envelope))fail('CREDENTIAL_READBACK_FAILED');
    return {phase:'SEALED_CREDENTIALS_PERSISTED',encrypted:true,productionReady:false};
   });
  },
  async resume({vault,passphrase,fetcher,expectedApiRoot,expectedOrigin,expectedBoxId}={}){
   requireCheckpoint(vault);checkPassphrase(passphrase);
   const expectedApi=checkRoot(expectedApiRoot),expectedSite=checkOrigin(expectedOrigin);
   if((expectedBoxId!==undefined&&!ID.test(expectedBoxId))||typeof fetcher!=='function')fail('EXPECTED_CONNECTION_REQUIRED');
   const rows=await transact(idb,'readonly');if(rows.invalid||rows.envelope===null)fail('CREDENTIALS_MISSING_OR_INVALID');
   const env=rows.envelope;checkEnvelope(env);
   const key=await derive(cryptoProvider,passphrase,from64(env.salt,16));
   let raw;try{raw=await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv:from64(env.iv,12),additionalData:e.encode(PURPOSE),tagLength:128},key,from64(env.ciphertext))}
   catch{fail('BAD_PASSPHRASE_OR_TAMPERED_CREDENTIALS')}
   let plain;try{plain=JSON.parse(d.decode(raw))}catch{fail('BAD_CREDENTIAL_CONTENT')}finally{new Uint8Array(raw).fill(0)}
   if(!keys(plain,['apiRoot','origin','boxId','device','masterKey'])||!isObject(plain.device)||
      !keys(plain.device,['deviceId','deviceToken'])||plain.apiRoot!==expectedApi||plain.origin!==expectedSite||!ID.test(plain.boxId)||(expectedBoxId!==undefined&&plain.boxId!==expectedBoxId)||
      !ID.test(plain.device.deviceId)||!TOKEN.test(plain.device.deviceToken))fail('SCOPE_OR_CREDENTIAL_MISMATCH');
   const masterKey=from64(plain.masterKey,32);
   try{return restoreTransportFromEncryptedVault({vault,fetcher,apiRoot:expectedApi,origin:expectedSite,
    boxId:plain.boxId,device:plain.device,masterKey})}
   finally{masterKey.fill(0)}
  }
 });
}
