/* ANI:LOG v4.08: HTTPS staging origin-bound synthetic test-ID encrypted append-only WAL + encrypted original.
 * Real WebCrypto and IndexedDB APIs. New v392 isolated namespace. NO legacy keys, production data, network or SYNC_ON.
 * This intentionally DOES NOT replace v3.88's plaintext WAL. Never use for real records.
 */
import {inspectV351MigrationInput,classifyV351Id} from './v351-readonly-general-id-preflight.mjs';
import {V365_RANK_A,V365_RANK_B,V365_RANK_FIXTURES} from './v365-reviewed-rank-test-only.mjs';
import {V366_CREATE_ID,V366_CREATE_TITLE} from './v366-reviewed-create-test-only.mjs';
import {assertMixedMap,assertMixedTombstones} from './v29-mixed-record-gate.mjs';
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {validateSnapshot,mergeSnapshots} from '../sync-core.mjs';
import {createVerifiedWalCache,PERSISTENT_VALIDATOR_VERSION} from './verified-wal-cache-poc.mjs';
export const V408_DB='anilog-v408-HTTPS-STAGING-SYNTHETIC-ENCRYPTED-PRIMARY';
export const V408_ORIGIN=globalThis.location?.origin??null;
const allowedStagingOrigin=()=>{try{const u=new URL(V408_ORIGIN);return u.protocol==='https:'&&u.href===u.origin+'/'&&u.hostname!=='anime-log-rouge.vercel.app'&&u.hostname!=='www.anime-log-rouge.vercel.app'&&u.hostname!=='anime-log-rouge.vercel.app'}catch{return false}};
export const V408_ITERATIONS=310000;
// The formal-development profile shares the exact WAL/AEAD/CAS implementation.
// It is isolated from both the tested staging database and production origins.
export function createV408HTTPSStagingANIPrimary(options={}){return createProfiledPrimary(false,options)}
export function createFormalDevelopmentANIPrimary(options={}){return createProfiledPrimary(true,options)}
export function createFormalProductionANIPrimary(options={}){
 if(globalThis.document?.querySelector?.('meta[name="ani-log-formal-production-approval"]')?.content!=='approved-private-production')throw Error('FORMAL_PRODUCTION_APPROVAL_REQUIRED');
 return createProfiledPrimary(true,options,true);
}
function createProfiledPrimary(formal,options,production=false){
// Explicit disposable-localhost integration probe. Never turn this on from
// metadata, URL search/hash, localStorage, or ordinary product auto-mount.
// In particular, production origins cannot access the destructive test API.
// Gate C is a separate, explicitly mounted QA build. No query/storage toggle.
const gateCHttps=options.enableGateCPrivateMaintenance===true&&
 V408_ORIGIN==='https://anilog-qa-gateb-20261031-site.pages.dev'&&
 globalThis.location?.origin===V408_ORIGIN&&
 globalThis.document?.querySelector?.('meta[name="ani-log-gate-c-approval"]')?.content==='approved-isolated-gate-c';
const privateProdRebase=production&&options.enableTestOnlyProductMaintenance===true&&
 (/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(V408_ORIGIN??'')||gateCHttps)&&
 options.enableTestOnlySameSaltRebase===true&&options.enableTestOnlyAnchorRing===true&&
 options.enableTestOnlyAnchorRefresh===true;
const privateSameSaltAllowed=privateProdRebase||(!production&&formal&&
 (V408_ORIGIN==='https://formal-development.example.invalid'||/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(V408_ORIGIN??''))&&
 options.enableTestOnlySameSaltRebase===true);
const productMaintenance=production&&options.enableProductWalMaintenance===true;
const productAuthorization=()=>{try{return productMaintenance&&typeof options.productMaintenanceAuthorization==='function'&&options.productMaintenanceAuthorization()===true}catch{return false}};
const anchorRefreshAllowed=productMaintenance||(privateSameSaltAllowed&&options.enableTestOnlyAnchorRing===true&&options.enableTestOnlyAnchorRefresh===true);
const profileId=options.profileId??'legacy';
if(production&&!/^(?:legacy|p[1-9][0-9]?)$/.test(profileId))throw Error('FORMAL_PROFILE_INVALID');
const databaseName=production?'anilog-FORMAL-PRODUCTION-ENCRYPTED-PRIMARY'+(profileId==='legacy'?'':'-'+profileId):formal?'anilog-FORMAL-DEVELOPMENT-ENCRYPTED-PRIMARY':V408_DB;
const maxRevision=formal?10000:256;
const VERSION=production?'formal-production-encrypted-wal-v1':formal?'formal-development-encrypted-wal-v1':'v408-synthetic-general-encrypted-wal-v1';
const PURPOSE=production?'ANI:LOG/formal-production/encrypted-WAL':formal?'ANI:LOG/formal-development/encrypted-WAL':'ANI:LOG/v408/general-shaped-synthetic-encrypted-WAL';
const e=new TextEncoder(),d=new TextDecoder('utf-8',{fatal:true});
const fail=x=>{throw Error('V408_STOP_NO_RETRY:'+x)};
// AES snapshot serialization canonicalizes object keys. Object insertion order
// is not a record change; array order and every value remain significant.
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const eq=(a,b)=>canonical(a)===canonical(b);
const clone=x=>structuredClone(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const shape=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
// Native byte codecs avoid per-byte JS callbacks/strings on current browsers.
// Older browsers retain the same canonical round-trip check via bounded chunks.
const base64=b=>{
 if(typeof b.toBase64==='function')return b.toBase64();
 const chunks=[];
 for(let i=0;i<b.length;i+=32768)chunks.push(String.fromCharCode(...b.subarray(i,i+32768)));
 return btoa(chunks.join(''));
};
function from64(s,n){
 if(typeof s!=='string'||s.length>(n===undefined?6500000:131072)||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))fail('INVALID_BASE64');
 let bytes;
 try{
  if(typeof Uint8Array.fromBase64==='function')bytes=Uint8Array.fromBase64(s,{alphabet:'base64',lastChunkHandling:'strict'});
  else{
   const binary=atob(s);bytes=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  }
 }catch{fail('INVALID_BASE64')}
 // Preserve byte-for-byte canonicality, fixed-length bounds and the error code.
 if(base64(bytes)!==s||(n!==undefined&&bytes.length!==n))fail('INVALID_BASE64');
 return bytes;
}
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function digest(c,x){return hex(await c.subtle.digest('SHA-256',e.encode(JSON.stringify(x))))}
function passCheck(pass){if(typeof pass!=='string'||pass.length<16||pass.length>256||e.encode(pass).length>1024)fail('INVALID_TEST_PASSPHRASE')}
async function derive(c,pass,salt){const raw=await c.subtle.importKey('raw',e.encode(pass),'PBKDF2',false,['deriveKey']);return c.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:V408_ITERATIONS,salt},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
function aad(kind,revision,prev){return e.encode([PURPOSE,V408_ORIGIN,kind,revision,prev].join('|'))}
async function seal(c,key,kind,revision,prev,plain){
 const iv=c.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await c.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(kind,revision,prev),tagLength:128},key,e.encode(JSON.stringify(plain))));
 return {kind,revision,previousDigest:prev,iv:base64(iv),ciphertext:base64(ciphertext)};
}
async function open(c,key,env,kind,revision,prev){
 if(!shape(env,['kind','revision','previousDigest','iv','ciphertext'])||env.kind!==kind||env.revision!==revision||env.previousDigest!==prev)fail('BAD_ENCRYPTED_ENTRY_HEADER');
 const iv=from64(env.iv,12),cipher=from64(env.ciphertext);if(cipher.length<28||cipher.length>4500000)fail('BAD_ENCRYPTED_ENTRY_SIZE');
 let decrypted;try{decrypted=await c.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(kind,revision,prev),tagLength:128},key,cipher)}catch{fail('WAL_AUTHENTICATION_FAILED')}
 try{return JSON.parse(d.decode(decrypted))}catch{fail('INVALID_DECRYPTED_WAL')}
}
function openDB(idb){return new Promise((ok,no)=>{
 const q=idb.open(databaseName,1);q.onupgradeneeded=()=>q.result.createObjectStore('vault');
 q.onerror=()=>no(q.error??Error('IDB_OPEN_ERROR'));q.onblocked=()=>no(Error('IDB_BLOCKED'));q.onsuccess=()=>ok(q.result);
})}
async function readRecords(idb){
 const db=await openDB(idb);
 try{return await new Promise((ok,no)=>{
  const tx=db.transaction('vault','readonly'),s=tx.objectStore('vault'),result={};let q=s.get('meta');
  const keys=s.getAllKeys();keys.onsuccess=()=>result.keys=keys.result;keys.onerror=()=>no(keys.error??Error('IDB_KEY_SCAN_ERROR'));
  q.onsuccess=()=>{result.meta=q.result??null;
   if(!result.meta){let a=s.get('escrow'),b=s.get('entry:0');a.onsuccess=()=>result.escrow=a.result??null;b.onsuccess=()=>result.first=b.result??null;return}
   const rev=result.meta.revision;
   if(!Number.isSafeInteger(rev)||rev<0||rev>maxRevision){result.invalid=true;return}
   let a=s.get('escrow');a.onsuccess=()=>result.escrow=a.result??null;
   result.entries=[];for(let i=0;i<=rev+1;i++){const j=i,r=s.get('entry:'+j);r.onsuccess=()=>result.entries[j]=r.result??null}
  };
  q.onerror=()=>no(q.error??Error('IDB_READ_ERROR'));tx.onerror=()=>no(tx.error??Error('IDB_TX_ERROR'));
  tx.onabort=()=>no(Error('IDB_ABORT'));tx.oncomplete=()=>ok(result);
 })}finally{db.close()}
}
/* One-store IDB transactions atomically commit escrow, first encrypted WAL entry and metadata,
 * or append a new encrypted entry plus head revision. NO awaits within transactions. */
async function transactionCheckAndPut(idb,mode,expectedHead,values){
 const db=await openDB(idb);
 try{return await new Promise((ok,no)=>{
  const tx=db.transaction('vault','readwrite'),store=tx.objectStore('vault');let permitted=false;
  const q=store.get('meta');q.onerror=()=>no(q.error??Error('META_READ_FAILED'));
  q.onsuccess=()=>{
   const meta=q.result;
   if(mode==='initialize'){
    if(meta!==undefined)return;
    const a=store.get('escrow'),b=store.get('entry:0');let count=0,exists=false;
    const done=()=>{if(++count!==2)return;if(!exists){for(const [k,v] of Object.entries(values))store.put(clone(v),k);permitted=true}};
    a.onsuccess=()=>{exists ||=a.result!==undefined;done()};b.onsuccess=()=>{exists ||=b.result!==undefined;done()};
   }else if(eq(meta,expectedHead)){
    const r=store.get('entry:'+(meta.revision+1));r.onsuccess=()=>{if(r.result===undefined){for(const [k,v] of Object.entries(values))store.put(clone(v),k);permitted=true}};
   }
  };
  tx.onerror=()=>no(tx.error??Error('IDB_WRITE_ERROR'));tx.onabort=()=>no(Error('IDB_WRITE_ABORT'));
  tx.oncomplete=()=>ok(permitted);
 })}finally{db.close()}
}


// Shared atomic replacement core. Only the separately authorized product
// entry or the isolated test entry may call this function. Test hooks are never
// forwarded by the product entry. A single existing vault transaction compares every source key and value
// before writing a fully authenticated same-salt replacement. No crypto awaits
// are performed within an IndexedDB transaction.
async function replaceSameSaltCAS(idb, expected, replacement, injectAbort=false, {precommitYield=null,onBeforePrecommitForTest=null}={}){
 const db=await openDB(idb);
 try{return await new Promise((ok,no)=>{
  const tx=db.transaction('vault','readwrite'),s=tx.objectStore('vault');
  let outcome='CAS_REJECTED';
  const sourceKeys=expected.keys.slice().sort();
  const targetKeys=replacement.keys.slice().sort();
  const q=s.getAllKeys();
  q.onsuccess=()=>{
   if(!eq(q.result.slice().sort(),sourceKeys))return;
   let pending=sourceKeys.length,matched=true;
   for(const k of sourceKeys){
    const r=s.get(k);
    r.onsuccess=()=>{
     if(!eq(r.result,k==='meta'?expected.meta:k==='escrow'?expected.escrow:expected.entries[Number(k.slice(6))]))matched=false;
     if(--pending!==0)return;
     if(!matched)return;
     // PRIVATE ONLY: re-evaluate live same-realm UI/sync signals in the
     // *same IDB success callback* immediately before the first write. There
     // are no awaits or event-loop turns between this guard and the puts.
     // Unknown values and throwing observers fail closed, preserving the WAL.
     // Other tabs' unsaved DOM state is NOT covered by this local guard.
     try{
      if(typeof onBeforePrecommitForTest==='function')onBeforePrecommitForTest();
      if(precommitYield!==null&&precommitYield()!==false){outcome='CAS_PREFLIGHT_YIELDED';return}
     }catch{outcome='CAS_PREFLIGHT_UNVERIFIED';return}
     for(const oldKey of sourceKeys)if(!targetKeys.includes(oldKey))s.delete(oldKey);
     for(const k of targetKeys){
      s.put(clone(k==='meta'?replacement.meta:k==='escrow'?replacement.escrow:replacement.entries[Number(k.slice(6))]),k);
      if(injectAbort){outcome='INJECTED_ABORT';tx.abort();return}
     }
     outcome='COMMITTED';
    };
    r.onerror=()=>{matched=false};
   }
  };
  q.onerror=()=>no(q.error??Error('TEST_REBASE_SCAN_FAILED'));
  tx.onerror=()=>{};
  tx.onabort=()=>outcome==='INJECTED_ABORT'?ok('INJECTED_ABORT'):no(tx.error??Error('TEST_REBASE_TX_ABORT'));
  tx.oncomplete=()=>ok(outcome);
 })}finally{db.close()}
}

const candidateKeys=['records','tombstones','weeklyOptions'];
const REVIEW_ASPECTS=new Set(['story','visual','character','music']);
const STATUSES=new Set(['planned','watching','watched','paused','dropped']);
const validISO=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const validReview=x=>object(x)&&Object.keys(x).sort().join('|')==='aspects|overall|updatedAt'&&Number.isInteger(x.overall)&&x.overall>=1&&x.overall<=5&&validISO(x.updatedAt)&&object(x.aspects)&&Object.entries(x.aspects).every(([k,v])=>REVIEW_ASPECTS.has(k)&&Number.isInteger(v)&&v>=1&&v<=4);
const KINDS=new Set(['note','progress','status','review','review-delete','stream','weekly','pin','watched-status','completion','analysis','rank-stage','rank-direction','rank-drop','manual-create','record-delete','undo-delete']);
function jsonSafe(x,depth=0){
 if(depth>22)fail('INPUT_DEPTH_TOO_LARGE');
 if(x===null||typeof x==='string'||typeof x==='boolean')return;
 if(typeof x==='number'&&Number.isFinite(x))return;
 if(Array.isArray(x)){for(let i=0;i<x.length;i++){if(!Object.hasOwn(x,i))fail('JSON_ARRAY_HOLE');jsonSafe(x[i],depth+1)}return}
 if(!object(x)||![Object.prototype,null].includes(Object.getPrototypeOf(x)))fail('NON_JSON_INPUT');
 for(const [k,v] of Object.entries(x)){
  if(['__proto__','constructor','prototype'].includes(k))fail('DANGEROUS_PROPERTY');
  jsonSafe(v,depth+1);
 }
}
function reviewedSnapshot(s){
 if(!shape(s,candidateKeys)||!object(s.records)||!object(s.tombstones)||!object(s.weeklyOptions))fail('BAD_SNAPSHOT');
 jsonSafe(s);
 if(formal){
  assertMixedMap(s.records);assertMixedTombstones(s.tombstones,s.records);
  const projected=appToSnapshot(s),roundtrip=snapshotToApp(projected,{weeklyOptions:s.weeklyOptions});
  if(!eq(roundtrip,s)||e.encode(JSON.stringify(s)).length>3000000)fail('FORMAL_ROUNDTRIP_OR_SIZE');
  return true;
 }
 // Test ONLY: arbitrary valid Jikan/legacy-custom IDs, but never arbitrary user titles.
 if(Object.keys(s.records).length>50||Object.keys(s.tombstones).length>50||
    Object.values(s.records).some(r=>!r||typeof r.title!=='string'||!(r.title.startsWith('架空')||(r.id===V366_CREATE_ID&&r.title===V366_CREATE_TITLE))))fail('SYNTHETIC_RECORDS_ONLY');
 const check=inspectV351MigrationInput({recordsRaw:JSON.stringify(s.records),tombstonesRaw:JSON.stringify(s.tombstones),weeklyRaw:JSON.stringify(s.weeklyOptions)});
 if(!check.eligibleForSeparateStagingReview||!check.roundtripVerified)fail('PREFLIGHT_REJECTED:'+check.issues.join(','));
 if(e.encode(JSON.stringify(s)).length>1600000)fail('SYNTHETIC_DATA_TOO_LARGE');
 return true;
}
function validateMeta(m){
 if(!shape(m,['version','purpose','kdf','iterations','salt','revision','headDigest','escrowDigest'])||m.version!==VERSION||m.purpose!==PURPOSE||m.kdf!=='PBKDF2-SHA256'||m.iterations!==V408_ITERATIONS||!Number.isSafeInteger(m.revision)||m.revision<0||m.revision>maxRevision||!/^[a-f0-9]{64}$/.test(m.headDigest)||!/^[a-f0-9]{64}$/.test(m.escrowDigest))fail('INVALID_META');
 from64(m.salt,16);
}
function expectedKeys(rev){return ['meta','escrow',...Array.from({length:rev+1},(_,i)=>'entry:'+i)].sort().join('|')}
function verifyInventory(rows){
 if(!Array.isArray(rows.keys)||rows.keys.some(k=>typeof k!=='string'))fail('UNREADABLE_KEYS');
 if(!rows.meta){if(rows.keys.length)fail('PARTIAL_VAULT');return 'EMPTY'}
 validateMeta(rows.meta);
 if(rows.keys.slice().sort().join('|')!==expectedKeys(rows.meta.revision))fail('MISSING_OR_EXTRA_VAULT_KEY');
 if(!rows.escrow||!Array.isArray(rows.entries)||rows.entries.length!==rows.meta.revision+2||rows.entries[rows.meta.revision+1]!==null)fail('INVALID_ENVELOPE_COUNT');
 return 'PRESENT';
}
const RANK_IDS=[V365_RANK_A,V365_RANK_B];
function checkedManual(r){
 if(!r||classifyV351Id(r.id)!=='legacyCustom'||typeof r.title!=='string'||
    !(r.title.startsWith('架空')||(r.id===V366_CREATE_ID&&r.title===V366_CREATE_TITLE)))fail('UNREVIEWED_SYNTHETIC_CREATE');
 // Allow different legitimate field combinations; the snapshot preflight separately validates record schema.
 jsonSafe(r);
}
function rankPeers(s,id){
 const r=s.records[id];if(!r||r.status!=='watched'||!validReview(r.review)||!Number.isInteger(r.myRankOrder)||r.myRankOrder<0)fail('RANK_TARGET_INVALID');
 const peers=Object.entries(s.records).filter(([,v])=>v.status==='watched'&&v.review?.overall===r.review.overall).sort((a,b)=>a[1].myRankOrder-b[1].myRankOrder);
 if(peers.length<2||peers.some(([k,v],i)=>!validReview(v.review)||v.myRankOrder!==i))fail('RANK_PEERS_INVALID');
 return peers.map(([k])=>k);
}
function checkRankChange(before,after,kind,id){
 const peers=rankPeers(before,id),previous=before.records[id].myRankOrder;
 const targetOrder=after.records[id]?.myRankOrder;
 if(!Number.isInteger(targetOrder)||targetOrder<0||targetOrder>=peers.length||Math.abs(targetOrder-previous)!==1)fail('RANK_NOT_ADJACENT');
 const neighbor=peers[targetOrder];const ts=after.records[id].rankUpdatedAt;
 if(!validISO(ts)||after.records[neighbor]?.rankUpdatedAt!==ts)fail('RANK_TIMESTAMP_INVALID');
 const expected=clone(before);
 for(const k of [id,neighbor]){expected.records[k].myRankOrder=k===id?targetOrder:previous;expected.records[k].rankUpdatedAt=ts}
 if(!eq(expected,after))fail('RANK_UNRELATED_CHANGE');
}
function verifyStructural(before,after,kind,id,prior){
 if(!eq(before.weeklyOptions,after.weeklyOptions))fail('STRUCTURAL_WEEKLY_CHANGED');
 if(kind==='rank-direction'||kind==='rank-drop'){
  if(!eq(before.tombstones,after.tombstones))fail('RANK_TOMBSTONE_CHANGED');
  checkRankChange(before,after,kind,id);
 }else{
  const expected=clone(before);
  if(kind==='rank-stage'){
   if(id!=='synthetic'||RANK_IDS.some(x=>expected.records[x]||expected.tombstones[x])||expected.records['jikan:1']?.status!=='watched')fail('INVALID_RANK_STAGE');
   for(const k of RANK_IDS)expected.records[k]=clone(V365_RANK_FIXTURES[k]);
  }else if(kind==='manual-create'){
   if(expected.records[id]||expected.tombstones[id]||!after.records[id])fail('MANUAL_ID_COLLISION');
   checkedManual(after.records[id]);expected.records[id]=clone(after.records[id]);
  }else if(kind==='record-delete'){
   if(!expected.records[id]||expected.tombstones[id])fail('INVALID_DELETE_TARGET');
   const stone=after.tombstones[id];if(!shape(stone,['id','deletedAt'])||stone.id!==id||!validISO(stone.deletedAt))fail('INVALID_DELETION_TOMBSTONE');
   delete expected.records[id];expected.tombstones[id]=clone(stone);
  }else if(kind==='undo-delete'){
   if(!prior?.records[id]||before.records[id]||!before.tombstones[id])fail('INVALID_UNDO_HISTORY');
   const priorWithout=clone(prior);delete priorWithout.records[id];priorWithout.tombstones[id]=clone(before.tombstones[id]);
   if(!eq(priorWithout,before))fail('UNDO_NOT_IMMEDIATELY_PREVIOUS');
   delete expected.tombstones[id];expected.records[id]=clone(prior.records[id]);
  }else fail('UNTYPED_STRUCTURAL_KIND');
  if(!eq(expected,after))fail('UNRELATED_STRUCTURAL_CHANGE');
 }
 reviewedSnapshot(after);
}
function validCompletion(v){
 if(typeof v!=='string'||!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(v))return false;
 if(v.length===10){const d=new Date(v+'T00:00:00.000Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}
 return true;
}
function verifyTypedChange(before,after,kind,id,prior=null){
 if(['rank-stage','rank-direction','rank-drop','manual-create','record-delete','undo-delete'].includes(kind))return verifyStructural(before,after,kind,id,prior);
 reviewedSnapshot(after);
 if(!KINDS.has(kind)||typeof id!=='string')fail('UNTYPED_ROUTE');
 if(!eq(before.tombstones,after.tombstones)||!eq(before.weeklyOptions,after.weeklyOptions)||!eq(Object.keys(before.records).sort(),Object.keys(after.records).sort()))fail('UNRELATED_MAP_CHANGE');
 if(!before.records[id]||!after.records[id])fail('ID_NOT_PRESENT');
 for(const key of Object.keys(before.records))if(key!==id&&!eq(before.records[key],after.records[key]))fail('UNRELATED_RECORD_CHANGE');
 const old=before.records[id],now=after.records[id];
 const changes=[...new Set([...Object.keys(old),...Object.keys(now)])].filter(k=>!eq(old[k],now[k]));
 const permitted={note:['note','noteDeletedAt'],progress:['watchedEpisodes','updatedAt'],status:['status','updatedAt'],review:['review','reviewDeletedAt'],'review-delete':['review','reviewDeletedAt'],stream:['streamPreference'],weekly:['weeklySchedule'],pin:['nextWatchPinnedAt','nextWatchUpdatedAt'],'watched-status':['status','updatedAt'],completion:['completedOn','updatedAt'],analysis:['analysisMeta']};
 if(!changes.length||!permitted[kind]||changes.some(k=>!permitted[kind].includes(k)))fail('UNREVIEWED_RECORD_FIELD');
 if(kind==='note'){
  if(now.note===undefined){if(old.note===undefined||!validISO(now.noteDeletedAt))fail('INVALID_NOTE_DELETE')}
  else if(!object(now.note)||typeof now.note.text!=='string'||!now.note.text||now.note.text.length>500||!validISO(now.note.updatedAt)||now.noteDeletedAt!==undefined)fail('INVALID_NOTE');
 }else if(kind==='progress'){
  if(!Number.isInteger(now.watchedEpisodes)||now.watchedEpisodes<0||now.watchedEpisodes>9999||!validISO(now.updatedAt)||!['watching','paused','dropped'].includes(old.status)||old.watchedEpisodes===now.watchedEpisodes)fail('INVALID_PROGRESS');
 }else if(kind==='status'||kind==='watched-status'){
  if(!STATUSES.has(old.status)||!STATUSES.has(now.status)||old.status===now.status||!validISO(now.updatedAt))fail('INVALID_STATUS_TRANSITION');
  if(kind==='watched-status'&&now.status!=='watched')fail('INVALID_WATCHED_STATUS');
 }else if(kind==='review'){
  if(!['watched','watching','paused','dropped'].includes(old.status)||!validReview(now.review)||now.reviewDeletedAt!==undefined||old.review?.comment||eq(old.review,now.review))fail('INVALID_REVIEW');
 }else if(kind==='review-delete'){
  if(!validReview(old.review)||now.review!==undefined||!validISO(now.reviewDeletedAt)||old.reviewDeletedAt===now.reviewDeletedAt)fail('INVALID_REVIEW_DELETE');
 }else if(kind==='stream'){
  if(!object(now.streamPreference)||!shape(now.streamPreference,['service','url','updatedAt'])||typeof now.streamPreference.service!=='string'||!['Netflix','Amazon Prime Video','Disney Plus','Hulu','U-NEXT','FOD'].includes(now.streamPreference.service)||typeof now.streamPreference.url!=='string'||now.streamPreference.url.length>1500||!validISO(now.streamPreference.updatedAt))fail('INVALID_STREAM');
 }else if(kind==='pin'){
  if(!validISO(now.nextWatchUpdatedAt)||(old.nextWatchPinnedAt===undefined?!validISO(now.nextWatchPinnedAt):now.nextWatchPinnedAt!==undefined))fail('INVALID_PIN');
 }else if(kind==='completion'){
  if(old.status!=='watched'||!validISO(now.updatedAt)||!validCompletion(now.completedOn)||eq(old.completedOn,now.completedOn))fail('INVALID_COMPLETION');
 }else if(kind==='analysis'){
  const m=now.analysisMeta;
  if(!object(m)||!shape(m,['fetchedAt','studios','genres','themes'])||!validISO(m.fetchedAt)||!Array.isArray(m.studios)||!Array.isArray(m.genres)||!Array.isArray(m.themes)||eq(old.analysisMeta,m))fail('INVALID_ANALYSIS');
 }else if(kind==='weekly'){
  if(!object(now.weeklySchedule)||!shape(now.weeklySchedule,['mode','day','time','updatedAt'])||now.weeklySchedule.mode!=='manual'||!Number.isInteger(now.weeklySchedule.day)||now.weeklySchedule.day<0||now.weeklySchedule.day>6||typeof now.weeklySchedule.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(now.weeklySchedule.time)||!validISO(now.weeklySchedule.updatedAt))fail('INVALID_WEEKLY');
 }
}
const VALIDATOR_CACHE_VERSION = `2a-v1:${VERSION}:${PURPOSE}:${V408_ORIGIN}`;

async function validateAllFull(c, key, rows) {
 if(verifyInventory(rows)!=='PRESENT')fail('NO_VALID_VAULT');
 const {meta,escrow,entries}=rows;
 const escrowDigest=await digest(c,escrow);
 if(escrowDigest!==meta.escrowDigest)fail('ESCROW_HASH_MISMATCH');
 const original=await open(c,key,escrow,'original',-1,'genesis');reviewedSnapshot(original);
 let prev='genesis',last=null,beforeLast=null,checkpoint=null;
 const entryDigests=[];
 for(let r=0;r<=meta.revision;r++){
  const env=entries[r];if(!env)fail('WAL_ENTRY_MISSING');
  const payload=await open(c,key,env,'wal',r,prev);
  if(!object(payload)||!object(payload.snapshot)||typeof payload.kind!=='string'||typeof payload.id!=='string')fail('INVALID_WAL_PAYLOAD');
  if(r===0){
   const initialOnly=shape(payload,['kind','id','snapshot']);
   const remoteGenesis=shape(payload,['kind','id','snapshot','checkpoint']);
   if(payload.kind!=='initial'||payload.id!=='synthetic'||!eq(payload.snapshot,original)||(!initialOnly&&!remoteGenesis))fail('BAD_GENESIS');
   if(remoteGenesis){
    const cp=payload.checkpoint;
    if(!object(cp)||!shape(cp,['serverRevision','snapshot'])||!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1)fail('BAD_REMOTE_GENESIS_CHECKPOINT');
    validateSnapshot(cp.snapshot);
    if(!eq(appToSnapshot(payload.snapshot),cp.snapshot))fail('REMOTE_GENESIS_NOT_LOSSLESS');
    checkpoint=clone(cp);
   }
  }
  else if(payload.kind==='sync-commit'){
   if(!shape(payload,['kind','id','snapshot','checkpoint'])||payload.id!=='sync'||!object(payload.checkpoint)||!shape(payload.checkpoint,['serverRevision','snapshot']))fail('BAD_SYNC_COMMIT');
   const cp=payload.checkpoint;
   if(!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1||(checkpoint&&cp.serverRevision<=checkpoint.serverRevision))fail('BAD_SYNC_REVISION');
   validateSnapshot(cp.snapshot);reviewedSnapshot(payload.snapshot);
   if(!eq(appToSnapshot(payload.snapshot),cp.snapshot))fail('BAD_SYNC_CHECKPOINT');
   if(checkpoint){const trial=mergeSnapshots(checkpoint.snapshot,appToSnapshot(last),cp.snapshot);
    if(!trial.ok||!eq(trial.merged,cp.snapshot))fail('UNSAFE_SYNC_COMMIT');
   }else if(!eq(appToSnapshot(last),cp.snapshot))fail('UNSAFE_INITIAL_SYNC_COMMIT');
   checkpoint=clone(cp);
  }else if(formal&&payload.kind==='formal-commit'){
   if(!shape(payload,['kind','id','snapshot'])||payload.id!=='app')fail('BAD_FORMAL_COMMIT');
   reviewedSnapshot(payload.snapshot);
   for(const id of Object.keys(last.records))if(!payload.snapshot.records[id]&&!payload.snapshot.tombstones[id])fail('MISSING_DELETION_HISTORY');
   for(const id of Object.keys(last.tombstones))if(!payload.snapshot.records[id]&&!eq(last.tombstones[id],payload.snapshot.tombstones[id]))fail('DROPPED_DELETION_HISTORY');
  }else{
   if(!shape(payload,['kind','id','snapshot']))fail('BAD_TYPED_PAYLOAD');
   verifyTypedChange(last,payload.snapshot,payload.kind,payload.id,beforeLast);
  }
  beforeLast=last;last=payload.snapshot;prev=await digest(c,env);
  entryDigests.push(prev);
 }
 if(prev!==meta.headDigest)fail('WAL_HEAD_MISMATCH');
 const nextCache=Object.freeze({
  validatorVersion:VALIDATOR_CACHE_VERSION,
  keyRef:key,
  escrowDigest,
  revision:meta.revision,
  entryDigests:Object.freeze(entryDigests),
  last:clone(last),
  beforeLast:beforeLast?clone(beforeLast):null,
  checkpoint:checkpoint?clone(checkpoint):null,
  headDigest:prev
 });
 return {out:{snapshot:last,revision:meta.revision,checkpoint},nextCache};
}

async function validateAll(c, key, rows, cacheBox = null, onStats = null) {
 try {
  if(verifyInventory(rows)!=='PRESENT')fail('NO_VALID_VAULT');
  const {meta,escrow,entries}=rows;
  const escrowDigest=await digest(c,escrow);
  if(escrowDigest!==meta.escrowDigest)fail('ESCROW_HASH_MISMATCH');

  const cached=cacheBox?.current??null;
  const canUseCache=
   cached!==null&&
   cached.validatorVersion===VALIDATOR_CACHE_VERSION&&
   cached.keyRef===key&&
   cached.escrowDigest===escrowDigest&&
   Number.isSafeInteger(cached.revision)&&
   cached.revision>=0&&
   cached.revision<=meta.revision&&
   Array.isArray(cached.entryDigests)&&
   cached.entryDigests.length===cached.revision+1&&
   cached.headDigest===cached.entryDigests[cached.revision]&&
   object(cached.last);

  if(canUseCache){
   let prev='genesis',chainMatch=true;
   for(let r=0;r<=cached.revision;r++){
    const env=entries[r];
    if(!env||!shape(env,['kind','revision','previousDigest','iv','ciphertext'])||
       env.kind!=='wal'||env.revision!==r||env.previousDigest!==prev){
     chainMatch=false;break;
    }
    const dHex=await digest(c,env);
    if(dHex!==cached.entryDigests[r]){
     chainMatch=false;break;
    }
    prev=dHex;
   }
   if(chainMatch){
    let last=clone(cached.last);
    let beforeLast=cached.beforeLast?clone(cached.beforeLast):null;
    let checkpoint=cached.checkpoint?clone(cached.checkpoint):null;
    const entryDigests=cached.entryDigests.slice();

    for(let r=cached.revision+1;r<=meta.revision;r++){
     const env=entries[r];if(!env)fail('WAL_ENTRY_MISSING');
     const payload=await open(c,key,env,'wal',r,prev);
     if(!object(payload)||!object(payload.snapshot)||typeof payload.kind!=='string'||typeof payload.id!=='string')fail('INVALID_WAL_PAYLOAD');
     if(payload.kind==='sync-commit'){
      if(!shape(payload,['kind','id','snapshot','checkpoint'])||payload.id!=='sync'||!object(payload.checkpoint)||!shape(payload.checkpoint,['serverRevision','snapshot']))fail('BAD_SYNC_COMMIT');
      const cp=payload.checkpoint;
      if(!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1||(checkpoint&&cp.serverRevision<=checkpoint.serverRevision))fail('BAD_SYNC_REVISION');
      validateSnapshot(cp.snapshot);reviewedSnapshot(payload.snapshot);
      if(!eq(appToSnapshot(payload.snapshot),cp.snapshot))fail('BAD_SYNC_CHECKPOINT');
      if(checkpoint){const trial=mergeSnapshots(checkpoint.snapshot,appToSnapshot(last),cp.snapshot);
       if(!trial.ok||!eq(trial.merged,cp.snapshot))fail('UNSAFE_SYNC_COMMIT');
      }else if(!eq(appToSnapshot(last),cp.snapshot))fail('UNSAFE_INITIAL_SYNC_COMMIT');
      checkpoint=clone(cp);
     }else if(formal&&payload.kind==='formal-commit'){
      if(!shape(payload,['kind','id','snapshot'])||payload.id!=='app')fail('BAD_FORMAL_COMMIT');
      reviewedSnapshot(payload.snapshot);
      for(const id of Object.keys(last.records))if(!payload.snapshot.records[id]&&!payload.snapshot.tombstones[id])fail('MISSING_DELETION_HISTORY');
      for(const id of Object.keys(last.tombstones))if(!payload.snapshot.records[id]&&!eq(last.tombstones[id],payload.snapshot.tombstones[id]))fail('DROPPED_DELETION_HISTORY');
     }else{
      if(!shape(payload,['kind','id','snapshot']))fail('BAD_TYPED_PAYLOAD');
      verifyTypedChange(last,payload.snapshot,payload.kind,payload.id,beforeLast);
     }
     beforeLast=last;last=payload.snapshot;prev=await digest(c,env);
     entryDigests.push(prev);
    }
    if(prev!==meta.headDigest)fail('WAL_HEAD_MISMATCH');
    cacheBox.current=Object.freeze({
     validatorVersion:VALIDATOR_CACHE_VERSION,
     keyRef:key,
     escrowDigest,
     revision:meta.revision,
     entryDigests:Object.freeze(entryDigests),
     last:clone(last),
     beforeLast:beforeLast?clone(beforeLast):null,
     checkpoint:checkpoint?clone(checkpoint):null,
     headDigest:prev
    });
    if(typeof onStats==='function')onStats({mode:'cache-hit',reusedThrough:cached.revision,newlyValidated:meta.revision-cached.revision});
    return {snapshot:last,revision:meta.revision,checkpoint};
   }
   cacheBox.current=null;
   if(typeof onStats==='function')onStats({mode:'fallback-full-on-mismatch',targetRevision:meta.revision});
  } else {
   if(cacheBox)cacheBox.current=null;
   if(typeof onStats==='function')onStats({mode:'full-validation',targetRevision:meta.revision});
  }

  const {out,nextCache}=await validateAllFull(c,key,rows);
  if(cacheBox)cacheBox.current=nextCache;
  return out;
 } catch (err) {
  if(cacheBox)cacheBox.current=null;
  throw err;
 }
}
/* === [2-A DIFF END] === */

function instantiate({idb=globalThis.indexedDB,cryptoProvider=globalThis.crypto,locks=globalThis.navigator?.locks,origin=V408_ORIGIN,onValidationStats=null,onPersistentCacheStats=null}={}){
 const loopback=formal&&/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
 const approvedProduction=production&&new URL(origin).protocol==='https:';
 if((!approvedProduction&&!allowedStagingOrigin()&&!loopback)||origin!==V408_ORIGIN||globalThis.location?.origin!==V408_ORIGIN||!idb?.databases||!cryptoProvider?.subtle||!cryptoProvider?.getRandomValues||!locks?.request)fail('ISOLATED_CONTEXT_ONLY');
 let state='LOCKED',key=null,current=null,head=null,attempted=false,undoReceipt=null,checkpoint=null;
 /* === [2-A DIFF START: Instance-scoped Cache Container & Safe Operation Guard] === */
 const cacheBox={current:null};
 // PRIVATE Stage 3: only validated durable states can issue auxiliary receipts.
 let validationMode=null,persistedStamp=null;
 const pendingReceipts=new Set();
 const validationStats=x=>{validationMode=x.mode;if(typeof onValidationStats==='function')onValidationStats(x)};
 const persistent=formal?createVerifiedWalCache({idb,cryptoProvider,databaseName,onStats:onPersistentCacheStats}):null;
 // A same-salt rebase creates a NEW WAL chain at revision zero. The
 // authenticated genesis entry digest, not salt/revision alone, identifies
 // which disposable receipt belongs to the current chain. The primary WAL
 // remains authoritative and its schema/key material are unchanged.
 const persistentIdentity=(meta,genesisDigest)=>({origin:V408_ORIGIN,profileId,databaseName,walVersion:VERSION,walPurpose:PURPOSE,kdf:meta.kdf,iterations:meta.iterations,salt:meta.salt,genesisDigest,validationRules:PERSISTENT_VALIDATOR_VERSION});
 const stamp=cache=>cache.revision+':'+cache.headDigest;
 function checkedReceipt(x){
  if(!shape(x,['validatorVersion','escrowDigest','revision','entryDigests','last','beforeLast','checkpoint','headDigest'])||x.validatorVersion!==VALIDATOR_CACHE_VERSION||!Number.isSafeInteger(x.revision)||x.revision<0||x.revision>maxRevision||!/^[a-f0-9]{64}$/.test(x.escrowDigest)||!/^[a-f0-9]{64}$/.test(x.headDigest)||!Array.isArray(x.entryDigests)||x.entryDigests.length!==x.revision+1||x.entryDigests.some(d=>typeof d!=='string'||!/^[a-f0-9]{64}$/.test(d))||x.entryDigests[x.revision]!==x.headDigest||(x.revision===0?x.beforeLast!==null:!object(x.beforeLast)))throw Error('INVALID_AUXILIARY_RECEIPT');
  reviewedSnapshot(x.last);if(x.beforeLast!==null)reviewedSnapshot(x.beforeLast);
  if(x.checkpoint!==null){
   if(!shape(x.checkpoint,['serverRevision','snapshot'])||!Number.isSafeInteger(x.checkpoint.serverRevision)||x.checkpoint.serverRevision<1)throw Error('INVALID_AUXILIARY_CHECKPOINT');
   jsonSafe(x.checkpoint);validateSnapshot(x.checkpoint.snapshot);
  }
  return x;
 }
 async function persistVerified(k,meta){
  if(!persistent||state!=='ACTIVE'||!cacheBox.current||cacheBox.current.keyRef!==k||cacheBox.current.revision!==meta.revision||cacheBox.current.headDigest!==meta.headDigest||cacheBox.current.escrowDigest!==meta.escrowDigest)return;
  const c=cacheBox.current,token=stamp(c);if(token===persistedStamp||pendingReceipts.has(token))return;
  pendingReceipts.add(token);
  try{
   const receipt={};for(const name of ['validatorVersion','escrowDigest','revision','entryDigests','last','beforeLast','checkpoint','headDigest'])receipt[name]=c[name];
   if(await persistent.save(k,persistentIdentity(meta,c.entryDigests[0]),receipt)&&cacheBox.current&&stamp(cacheBox.current)===token)persistedStamp=token;
  }catch{}finally{pendingReceipts.delete(token)} // Optional cache failure never changes a successful vault result.
 }

 const runGuarded=async fn=>{
  try{return await fn()}
  catch(err){cacheBox.current=null;throw err}
 };
 /* === [2-A DIFF END] === */
 const exclusive=fn=>locks.request(databaseName+'-exclusive',{mode:'exclusive'},fn);
 const status=(phase,details={})=>Object.freeze({phase,...details,encryptedOriginal:true,walEncrypted:true,plaintextAppPartsWritten:false,mode:'SYNC_OFF',syntheticOnly:!formal,productionReady:false,syncAllowed:false});
// Phase 4I: isolated two-slot read-only recovery evidence. Not in product.
// The anchor is NEVER restored automatically, and has no delete/prune authority.
const testOnlyAnchorDatabase=databaseName+(productMaintenance?'-RECOVERY-ANCHORS-v1':'-PHASE4I-RECOVERY-PRIVATE-ONLY');
async function openRecoveryAnchorDB(){return new Promise((ok,no)=>{
 const q=idb.open(testOnlyAnchorDatabase,1);
 q.onupgradeneeded=()=>q.result.createObjectStore('anchors');
 q.onerror=()=>no(q.error??Error('ANCHOR_DB_ERROR'));
 q.onblocked=()=>no(Error('ANCHOR_DB_BLOCKED'));
 q.onsuccess=()=>ok(q.result);
})}
async function readRecoveryAnchors(){
 const db=await openRecoveryAnchorDB();
 try{return await new Promise((ok,no)=>{
  const tx=db.transaction('anchors','readonly'),store=tx.objectStore('anchors'),result={};
  const q=store.getAllKeys();let error=null;
  q.onsuccess=()=>{
   const keys=q.result;
   if(!Array.isArray(keys)||keys.some(k=>!['slot:0','slot:1'].includes(k))){error=Error('ANCHOR_UNKNOWN_KEY');tx.abort();return}
   for(const k of keys){const r=store.get(k);r.onsuccess=()=>result[k]=r.result;r.onerror=()=>{error=r.error??Error('ANCHOR_GET_FAILED');tx.abort()}}
  };
  q.onerror=()=>{error=q.error??Error('ANCHOR_KEYS_FAILED');tx.abort()};
  tx.oncomplete=()=>ok(result);tx.onabort=()=>no(error??tx.error??Error('ANCHOR_READ_ABORT'));
 })}finally{db.close()}
}
async function validateRecoveryAnchorRecord(record){
 if(!shape(record,['version','sourceRevision','sourceHeadDigest','targetEntry0Digest','ciphertext'])||
   record.version!==1||!Number.isSafeInteger(record.sourceRevision)||record.sourceRevision<0||
   !/^[0-9a-f]{64}$/.test(record.sourceHeadDigest)||!/^[0-9a-f]{64}$/.test(record.targetEntry0Digest))fail('ANCHOR_INVALID_HEADER');
 const body=await open(cryptoProvider,key,record.ciphertext,'recovery-anchor',record.sourceRevision,record.sourceHeadDigest);
 if(!shape(body,['sourceMeta','targetMeta','sourceEntry0Digest','targetEntry0Digest','current','checkpoint'])||
   !eq(body.sourceMeta.revision,record.sourceRevision)||
   body.sourceMeta.headDigest!==record.sourceHeadDigest||
   body.targetEntry0Digest!==record.targetEntry0Digest||
   !/^[0-9a-f]{64}$/.test(body.sourceEntry0Digest))fail('ANCHOR_SOURCE_TARGET_MISMATCH');
 validateMeta(body.sourceMeta);validateMeta(body.targetMeta);reviewedSnapshot(body.current);
 if(body.sourceMeta.salt!==body.targetMeta.salt||body.sourceMeta.salt!==head.salt)fail('ANCHOR_DIFFERENT_SALT');
 if(body.checkpoint!==null){
  if(!shape(body.checkpoint,['serverRevision','snapshot'])||!Number.isSafeInteger(body.checkpoint.serverRevision)||body.checkpoint.serverRevision<1)fail('ANCHOR_INVALID_CHECKPOINT');
  validateSnapshot(body.checkpoint.snapshot);
 }
 return body;
}
async function stageRecoveryAnchor(source,candidate,{injectAnchorAbort=false}={}){
 // Authenticated source and candidate must already have been validated by caller.
 const prior=await readRecoveryAnchors(),valid={};
 for(const [slot,record] of Object.entries(prior))valid[slot]=await validateRecoveryAnchorRecord(record);
 const primaryEntry0=await digest(cryptoProvider,source.entries[0]);
 let target;
 if(!Object.keys(prior).length)target='slot:0';
 else{
  const confirmed=Object.keys(prior).filter(s=>prior[s].targetEntry0Digest===primaryEntry0);
  // An orphan record is not proof of a committed cutover. Never overwrite the
  // only possible last-good anchor unless an active source-prefix proves it.
  if(confirmed.length===1){
   target=confirmed[0]==='slot:0'?'slot:1':'slot:0';
  }else if(confirmed.length===0&&Object.keys(prior).length===1){
   // A first-ever staged cutover may have failed before primary CAS. It is
   // safe to replace that orphan ONLY if the FULLY VALIDATED live primary
   // still contains the authenticated old source head as an append-only
   // prefix. This establishes a failed cutover, not epoch freshness.
   const staleSlot=Object.keys(prior)[0],old=valid[staleSlot];
   const sourceRev=old.sourceMeta.revision;
   const sameSourceIdentity=eq({...source.meta,revision:sourceRev,headDigest:old.sourceMeta.headDigest},old.sourceMeta);
   const firstDigest=await digest(cryptoProvider,source.entries[0]);
   const oldHeadEnvelope=sourceRev<=source.meta.revision?source.entries[sourceRev]:null;
   const oldHeadDigest=oldHeadEnvelope?await digest(cryptoProvider,oldHeadEnvelope):null;
   if(!sameSourceIdentity||firstDigest!==old.sourceEntry0Digest||
      oldHeadDigest!==old.sourceMeta.headDigest)fail('ANCHOR_PREDECESSOR_UNCONFIRMED');
   // The active vault is authoritative, including every edit appended after
   // the orphan. No anchor content is restored into it.
   target=staleSlot;
  }else fail('ANCHOR_PREDECESSOR_UNCONFIRMED');
 }
 const candidateEntry0=await digest(cryptoProvider,candidate.entries[0]);
 const payload={sourceMeta:clone(source.meta),targetMeta:clone(candidate.meta),
  sourceEntry0Digest:primaryEntry0,targetEntry0Digest:candidateEntry0,
  current:clone(current),checkpoint:checkpoint?clone(checkpoint):null};
 const ciphertext=await seal(cryptoProvider,key,'recovery-anchor',source.meta.revision,source.meta.headDigest,payload);
 const record={version:1,sourceRevision:source.meta.revision,sourceHeadDigest:source.meta.headDigest,targetEntry0Digest:candidateEntry0,ciphertext};
 await validateRecoveryAnchorRecord(record);
 const db=await openRecoveryAnchorDB();
 try{return await new Promise((ok,no)=>{
  const tx=db.transaction('anchors','readwrite'),store=tx.objectStore('anchors');let outcome='ANCHOR_STAGE_RACE';let error=null;
  const q=store.getAllKeys();
  q.onsuccess=()=>{
   if(!eq(q.result.slice().sort(),Object.keys(prior).sort()))return;
   const seen={};let pending=q.result.length;
   const finish=()=>{
    if(!eq(seen,prior))return;
    store.put(clone(record),target);
    outcome=injectAnchorAbort?'ANCHOR_INJECTED_ABORT':'ANCHOR_STAGED';
    if(injectAnchorAbort)tx.abort();
   };
   if(pending===0){finish();return}
   for(const k of q.result){const r=store.get(k);r.onsuccess=()=>{seen[k]=r.result;if(--pending===0)finish()};r.onerror=()=>{error=r.error??Error('ANCHOR_SLOT_GET_FAILED');tx.abort()}}
  };
  q.onerror=()=>{error=q.error??Error('ANCHOR_STAGE_KEYS_FAILED');tx.abort()};
  tx.oncomplete=()=>ok(outcome);
  tx.onabort=()=>outcome==='ANCHOR_INJECTED_ABORT'?ok(outcome):no(error??tx.error??Error('ANCHOR_STAGE_ABORT'));
 })}finally{db.close()}
}
async function testOnlyInspectAnchors(){
 if(!privateSameSaltAllowed||!options.enableTestOnlyAnchorRing||state!=='ACTIVE')fail('ANCHOR_TEST_ONLY_FORBIDDEN');
 return runGuarded(()=>exclusive(async()=>{
  const slots=await readRecoveryAnchors(),verified={};
  for(const [slot,record] of Object.entries(slots)){await validateRecoveryAnchorRecord(record);verified[slot]={sourceRevision:record.sourceRevision,targetEntry0Digest:record.targetEntry0Digest}}
  return Object.freeze({slotCount:Object.keys(slots).length,slots:verified,restoreAuthorized:false,autoPruneAuthorized:false,rollbackFreshnessProven:false});
 }));
}

 async function inspectReadOnly(){
  if(state!=='LOCKED'||attempted)fail('INSPECT_NOT_ALLOWED');
  const rows=await readRecords(idb);
  return status(verifyInventory(rows)==='EMPTY'?'EMPTY_LOCKED':'PRESENT_LOCKED',{requiresPassphrase:!!rows.meta});
 }
 async function initialize(snapshot,passphrase){
  if(attempted||state!=='LOCKED')fail('INIT_ONCE');attempted=true;state='STOP_NO_RETRY';passCheck(passphrase);reviewedSnapshot(snapshot);
  return runGuarded(()=>exclusive(async()=>{
   const before=await readRecords(idb);if(verifyInventory(before)!=='EMPTY')fail('TARGET_NOT_EMPTY');
   const salt=cryptoProvider.getRandomValues(new Uint8Array(16)),k=await derive(cryptoProvider,passphrase,salt);
   const escrow=await seal(cryptoProvider,k,'original',-1,'genesis',snapshot);
   const entry=await seal(cryptoProvider,k,'wal',0,'genesis',{kind:'initial',id:'synthetic',snapshot});
   const meta={version:VERSION,purpose:PURPOSE,kdf:'PBKDF2-SHA256',iterations:V408_ITERATIONS,salt:base64(salt),revision:0,headDigest:await digest(cryptoProvider,entry),escrowDigest:await digest(cryptoProvider,escrow)};
   if(!await transactionCheckAndPut(idb,'initialize',null,{meta,escrow,'entry:0':entry}))fail('INIT_CAS_REJECTED');
   const rows=await readRecords(idb),result=await validateAll(cryptoProvider,k,rows,cacheBox,validationStats);
   if(result.revision!==0||!eq(result.snapshot,snapshot))fail('INITIAL_READBACK_MISMATCH');
   key=k;head=rows.meta;current=result.snapshot;checkpoint=result.checkpoint;state='ACTIVE';void persistVerified(k,head);return status('INIT_ENCRYPTED_READBACK_VERIFIED',{revision:0});
  }));
 }
 /** First receipt by an EMPTY, separately isolated device. The authenticated
  * transport MUST supply a freshly read and decrypted server snapshot; no
  * local edit or backup is merged or overwritten. Genesis+original+checkpoint
  * share one IDB transaction. Fail closed on unknown ACK/stale remote.
  */
 async function initializeConfirmedReceive({passphrase,expectedRevision,expectedSnapshot,deviceWeeklyOpen=true,deviceWeeklyOptions,readBack}={}){
  if(attempted||state!=='LOCKED')fail('INIT_ONCE');attempted=true;state='STOP_NO_RETRY';
  passCheck(passphrase);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||typeof readBack!=='function'||typeof deviceWeeklyOpen!=='boolean')fail('REMOTE_CONFIRMATION_REQUIRED');
  if(deviceWeeklyOptions!==undefined&&(!formal||!object(deviceWeeklyOptions)))fail('FORMAL_LOCAL_WEEKLY_OPTIONS_REQUIRED');
  validateSnapshot(expectedSnapshot);
  return runGuarded(()=>exclusive(async()=>{
   const before=await readRecords(idb);
   if(verifyInventory(before)!=='EMPTY')fail('TARGET_NOT_EMPTY');
   const remote=await readBack();
   if(!object(remote)||remote.revision!==expectedRevision||!eq(remote.snapshot,expectedSnapshot))fail('REMOTE_READBACK_MISMATCH');
   validateSnapshot(remote.snapshot);
   const snapshot=snapshotToApp(remote.snapshot,{weeklyOptions:{...(deviceWeeklyOptions??{}),open:deviceWeeklyOpen,statuses:deviceWeeklyOptions?.statuses??['watching']}});
   reviewedSnapshot(snapshot);
   if(!eq(appToSnapshot(snapshot),expectedSnapshot))fail('RECEIVER_LOSSLESS_CONVERSION_FAILED');
   const cp={serverRevision:expectedRevision,snapshot:clone(expectedSnapshot)};
   const salt=cryptoProvider.getRandomValues(new Uint8Array(16)),k=await derive(cryptoProvider,passphrase,salt);
   const escrow=await seal(cryptoProvider,k,'original',-1,'genesis',snapshot);
   const entry=await seal(cryptoProvider,k,'wal',0,'genesis',{kind:'initial',id:'synthetic',snapshot,checkpoint:cp});
   const meta={version:VERSION,purpose:PURPOSE,kdf:'PBKDF2-SHA256',iterations:V408_ITERATIONS,salt:base64(salt),revision:0,headDigest:await digest(cryptoProvider,entry),escrowDigest:await digest(cryptoProvider,escrow)};
   if(!await transactionCheckAndPut(idb,'initialize',null,{meta,escrow,'entry:0':entry}))fail('INIT_CAS_REJECTED');
   const rows=await readRecords(idb),result=await validateAll(cryptoProvider,k,rows,cacheBox,validationStats);
   if(result.revision!==0||!eq(result.snapshot,snapshot)||!eq(result.checkpoint,cp))fail('INITIAL_RECEIVE_READBACK_FAILED');
   key=k;head=rows.meta;current=result.snapshot;checkpoint=result.checkpoint;state='ACTIVE';
   void persistVerified(k,head);
   return status('CONFIRMED_FIRST_RECEIVE_ATOMIC_GENESIS_VERIFIED',{revision:0,serverRevision:expectedRevision,records:Object.keys(snapshot.records).length,tombstones:Object.keys(snapshot.tombstones).length});
  }));
 }
 async function unlock(passphrase){
  if(attempted||state!=='LOCKED')fail('UNLOCK_ONCE');attempted=true;state='STOP_NO_RETRY';passCheck(passphrase);
  return runGuarded(async()=>{
   const rows=await readRecords(idb);if(verifyInventory(rows)!=='PRESENT')fail('NOT_INITIALIZED');
   const k=await derive(cryptoProvider,passphrase,from64(rows.meta.salt,16));
   let loaded=null,legacyReceipt=false;
   if(persistent){
    try{
     const genesisDigest=await digest(cryptoProvider,rows.entries[0]);
     let receipt=await persistent.load(k,persistentIdentity(rows.meta,genesisDigest));
     if(receipt===null){
      // One-time migration: accept the pre-generation Stage 3 receipt ONLY
      // after the normal authenticated WAL prefix comparison. A legacy
      // receipt never blocks a verified new-generation rewrite.
      receipt=await persistent.load(k,persistentIdentity(rows.meta,undefined));
      legacyReceipt=receipt!==null;
     }
     loaded=checkedReceipt(receipt);cacheBox.current=Object.freeze({...loaded,keyRef:k});
    }catch{cacheBox.current=null;loaded=null}
   }
   const result=await validateAll(cryptoProvider,k,rows,cacheBox,validationStats);
   // Keep latest-state format/round-trip validation before making it readable.
   if(persistent)reviewedSnapshot(result.snapshot);
   if(loaded&&validationMode==='cache-hit'&&!legacyReceipt)persistedStamp=stamp(loaded);
   key=k;head=rows.meta;current=result.snapshot;checkpoint=result.checkpoint;state='ACTIVE';
   void persistVerified(k,rows.meta);
   return status('F5_ENCRYPTED_READBACK_VERIFIED',{revision:result.revision});
  });
 }
 function readCurrent(){if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}return clone(current)}
 function readSyncCheckpoint(){if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}return checkpoint?clone(checkpoint):null}
 function readRevision(){if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}return head.revision}
 // Read-only identity. Digest changes even when a maintenance cutover lowers
 // the numeric revision, or a fresh series later reaches that same number.
 function readHeadIdentity(){if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}return Object.freeze({revision:head.revision,headDigest:head.headDigest,salt:head.salt,escrowDigest:head.escrowDigest})}
 /** One atomic encrypted WAL entry for both the full merged app snapshot and its
  * verified server baseline. Caller MUST provide a trusted authenticated server
  * read-after-ACK callback. Uncertain ACKs / stale heads MUST NOT commit.
  * Bootstrap only if remote precisely matches current local snapshot.
  * This cannot publish data; network transport belongs to the existing client.
  */
 async function commitConfirmedSync({expectedVaultRevision,ackRevision,expectedSyncedSnapshot,readBack}={}){
  if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}state='STOP_NO_RETRY';
  return runGuarded(()=>exclusive(async()=>{
   if(!Number.isSafeInteger(expectedVaultRevision)||expectedVaultRevision<0||
      !Number.isSafeInteger(ackRevision)||ackRevision<1||typeof readBack!=='function')fail('CONFIRMATION_REQUIRED');
   validateSnapshot(expectedSyncedSnapshot);
   const rows=await readRecords(idb);
   if(!eq(rows.meta,head)||head.revision!==expectedVaultRevision)fail('STALE_LOCAL_HEAD');
   const verified=await validateAll(cryptoProvider,key,rows,cacheBox,validationStats);
   if(!eq(verified.snapshot,current)||!eq(verified.checkpoint,checkpoint))fail('LOCAL_CHANGED');
   if(checkpoint&&ackRevision<=checkpoint.serverRevision)fail('STALE_SERVER_REVISION');
   const remote=await readBack();
   if(!object(remote)||!Number.isSafeInteger(remote.revision)||remote.revision!==ackRevision||
      !object(remote.snapshot))fail('UNKNOWN_OR_CHANGED_REMOTE_ACK');
   validateSnapshot(remote.snapshot);
   if(!eq(remote.snapshot,expectedSyncedSnapshot))fail('REMOTE_READBACK_MISMATCH');
   const local=appToSnapshot(current);
   if(checkpoint){
    const preview=mergeSnapshots(checkpoint.snapshot,local,remote.snapshot);
    if(!preview.ok)fail('CONCURRENT_SYNC_CONFLICT');
    if(!eq(preview.merged,remote.snapshot))fail('REMOTE_MISSING_LOCAL_UPDATES');
   }else if(!eq(local,remote.snapshot))fail('BOOTSTRAP_NOT_EQUAL_TO_LOCAL');
   const next=snapshotToApp(remote.snapshot,{weeklyOptions:current.weeklyOptions});
   reviewedSnapshot(next);
   if(!eq(appToSnapshot(next),remote.snapshot))fail('SYNC_SETTINGS_NOT_LOSSLESS');
   const revision=head.revision+1;
   if(revision>maxRevision)fail('TEST_REVISION_LIMIT');
   const nextCp={serverRevision:ackRevision,snapshot:clone(remote.snapshot)};
   const env=await seal(cryptoProvider,key,'wal',revision,head.headDigest,{kind:'sync-commit',id:'sync',snapshot:next,checkpoint:nextCp});
   const nextMeta={...head,revision,headDigest:await digest(cryptoProvider,env)};
   if(!await transactionCheckAndPut(idb,'append',head,{['entry:'+revision]:env,meta:nextMeta}))fail('ATOMIC_CAS_REJECTED');
   const fresh=await readRecords(idb),result=await validateAll(cryptoProvider,key,fresh,cacheBox,validationStats);
   if(!eq(result.snapshot,next)||!eq(result.checkpoint,nextCp)||result.revision!==revision)fail('SYNC_COMMIT_READBACK_FAILED');
   current=next;head=nextMeta;checkpoint=nextCp;undoReceipt=null;state='ACTIVE';
   return status('CONFIRMED_SYNC_ATOMIC_WAL_READBACK_VERIFIED',{revision,serverRevision:ackRevision});
  }));
 }
 async function append(kind,{id,text,requested,status:requestedStatus,options,overall,aspects,service,url,mode,day,time,wasPinned,value,meta,record,direction,draggedId,targetId,previous}={}){
  if(state!=='ACTIVE'){cacheBox.current=null;fail('LOCKED')}state='STOP_NO_RETRY';
  return runGuarded(()=>exclusive(async()=>{
   const rows=await readRecords(idb);if(!eq(rows.meta,head))fail('STALE_HEAD');
   const verified=await validateAll(cryptoProvider,key,rows,cacheBox,validationStats);if(!eq(verified.snapshot,current))fail('STALE_STATE');
   const next=clone(current),special=['rank-stage','rank-direction','rank-drop','manual-create','record-delete','undo-delete'].includes(kind);
   const r=next.records[id];if(!KINDS.has(kind)||(!special&&(!r||r.id!==id||current.tombstones[id])))fail('INVALID_HANDLER_TARGET');
   const ts=new Date().toISOString();
   if(kind==='rank-stage'){
    // Retained strictly for the older v3.95 UI harness; not a user-facing operation.
   if(id!=='synthetic'||RANK_IDS.some(x=>next.records[x]||next.tombstones[x])||next.records['jikan:1']?.status!=='watched')fail('INVALID_RANK_STAGE');
    for(const k of RANK_IDS)next.records[k]=clone(V365_RANK_FIXTURES[k]);
   }else if(kind==='rank-direction'||kind==='rank-drop'){
    const movingId=kind==='rank-drop'?draggedId:id;
    if(movingId!==id||typeof movingId!=='string')fail('INVALID_RANK_ID');
    const peers=rankPeers(next,movingId),from=next.records[movingId].myRankOrder;
    const to=kind==='rank-direction'?from+direction:next.records[targetId]?.myRankOrder;
    if(!Number.isInteger(to)||to<0||to>=peers.length||Math.abs(to-from)!==1||
       (kind==='rank-drop'&&(targetId===movingId||!peers.includes(targetId))))fail('INVALID_RANK_MOVE');
    const neighbor=peers[to];for(const k of [movingId,neighbor]){next.records[k].myRankOrder=k===movingId?to:from;next.records[k].rankUpdatedAt=ts}
   }else if(kind==='manual-create'){
    if(id!==record?.id||next.records[id]||next.tombstones[id])fail('MANUAL_ID_COLLISION');checkedManual(record);next.records[id]=clone(record);
   }else if(kind==='record-delete'){
    if(!r||next.tombstones[id])fail('INVALID_DELETE_TARGET');delete next.records[id];next.tombstones[id]={id,deletedAt:ts};
   }else if(kind==='undo-delete'){
    if(!undoReceipt||undoReceipt.id!==id||head.revision!==undoReceipt.revision||!eq(previous,undoReceipt.previous)||!eq(next.tombstones[id],undoReceipt.tombstone)||next.records[id])fail('INVALID_UNDO_RECEIPT');
    delete next.tombstones[id];next.records[id]=clone(undoReceipt.previous);
   }else if(kind==='note'){
    if(typeof text!=='string'||text.trim().length>500)fail('INVALID_NOTE');
    if(!text.trim()){if(!r.note)fail('NO_NOTE_TO_DELETE');delete r.note;r.noteDeletedAt=ts}
    else{r.note={text:text.trim(),updatedAt:ts};delete r.noteDeletedAt}
   }else if(kind==='progress'){
    if(!Number.isInteger(requested)||requested<0||requested>9999||!['watching','paused','dropped'].includes(r.status)||r.watchedEpisodes===requested)fail('INVALID_EPISODE');
    r.watchedEpisodes=requested;r.updatedAt=ts;
   }else if(kind==='status'||kind==='watched-status'){
    if(!STATUSES.has(requestedStatus)||requestedStatus===r.status||!object(options)||Object.keys(options).length||
       (kind==='watched-status'&&requestedStatus!=='watched'))fail('INVALID_STATUS_ARGS');
    r.status=requestedStatus;r.updatedAt=ts;
   }else if(kind==='review'){
    if(!['watched','watching','paused','dropped'].includes(r.status)||r.review?.comment||!Number.isInteger(overall)||overall<1||overall>5||!object(aspects)||Object.keys(aspects).some(k=>!REVIEW_ASPECTS.has(k)||!Number.isInteger(aspects[k])||aspects[k]<1||aspects[k]>4))fail('INVALID_REVIEW_ARGS');
    r.review={overall,aspects:clone(aspects),updatedAt:ts};delete r.reviewDeletedAt;
   }else if(kind==='review-delete'){
    if(!validReview(r.review))fail('NO_VALID_REVIEW_TO_DELETE');delete r.review;r.reviewDeletedAt=ts;
   }else if(kind==='stream'){
    if(typeof service!=='string'||typeof url!=='string'||!['Netflix','Amazon Prime Video','Disney Plus','Hulu','U-NEXT','FOD'].includes(service)||url.length>1500)fail('INVALID_STREAM_ARGS');
    r.streamPreference={service,url,updatedAt:ts};
   }else if(kind==='pin'){
    if(typeof wasPinned!=='boolean'||(typeof r.nextWatchPinnedAt==='string')!==wasPinned)fail('INVALID_PIN_ARGS');
    if(wasPinned)delete r.nextWatchPinnedAt;else r.nextWatchPinnedAt=ts;r.nextWatchUpdatedAt=ts;
   }else if(kind==='completion'){
    if(r.status!=='watched'||!validCompletion(value)||eq(r.completedOn,value))fail('INVALID_COMPLETION_ARGS');r.completedOn=value;r.updatedAt=ts;
   }else if(kind==='analysis'){
    if(!object(meta)||!shape(meta,['fetchedAt','studios','genres','themes'])||!validISO(meta.fetchedAt)||!Array.isArray(meta.studios)||!Array.isArray(meta.genres)||!Array.isArray(meta.themes)||eq(r.analysisMeta,meta))fail('INVALID_ANALYSIS_ARGS');
    r.analysisMeta=clone(meta);
   }else if(kind==='weekly'){
    if(mode!=='manual'||!Number.isInteger(day)||day<0||day>6||typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail('INVALID_WEEKLY_ARGS');
    r.weeklySchedule={mode,day,time,updatedAt:ts};
   }
   verifyTypedChange(current,next,kind,id,kind==='undo-delete'?undoReceipt?.snapshotBefore:null);
   const revision=head.revision+1;if(revision>maxRevision)fail('TEST_REVISION_LIMIT');
   const env=await seal(cryptoProvider,key,'wal',revision,head.headDigest,{kind,id,snapshot:next});
   const nextMeta={...head,revision,headDigest:await digest(cryptoProvider,env)};
   if(!await transactionCheckAndPut(idb,'append',head,{['entry:'+revision]:env,meta:nextMeta}))fail('ATOMIC_CAS_REJECTED');
   const fresh=await readRecords(idb),checked=await validateAll(cryptoProvider,key,fresh,cacheBox,validationStats);
   if(!eq(checked.snapshot,next)||checked.revision!==revision)fail('AFTER_WRITE_READBACK_FAILED');
   if(kind==='record-delete')undoReceipt={id,previous:clone(r),tombstone:clone(next.tombstones[id]),revision,snapshotBefore:clone(current)};
   else undoReceipt=null;
   current=next;head=nextMeta;state='ACTIVE';void persistVerified(key,head);return status('TYPED_ENCRYPTED_WAL_VERIFIED',{revision,kind});
  }));
 }
 async function commitApp({candidate,expectedRevision}={}){
  if(!formal||state!=='ACTIVE'){cacheBox.current=null;fail('FORMAL_UNLOCKED_REQUIRED')}
  return runGuarded(async()=>{
   candidate=clone(candidate);
   reviewedSnapshot(candidate);
   // Durable history is mandatory even for replace-import and explicit Undo.
   for(const id of Object.keys(current.records))if(!candidate.records[id]&&!candidate.tombstones[id])fail('MISSING_DELETION_HISTORY');
   for(const id of Object.keys(current.tombstones))if(!candidate.records[id]&&!eq(current.tombstones[id],candidate.tombstones[id]))fail('DROPPED_DELETION_HISTORY');
   state='STOP_NO_RETRY';
   return exclusive(async()=>{
    const rows=await readRecords(idb);
    if(expectedRevision!==head.revision||!eq(rows.meta,head))fail('STALE_FORMAL_HEAD');
    const verified=await validateAll(cryptoProvider,key,rows,cacheBox,validationStats);
    if(!eq(verified.snapshot,current)||!eq(verified.checkpoint,checkpoint))fail('LOCAL_CHANGED');
    const revision=head.revision+1;if(revision>maxRevision)fail('REVISION_LIMIT');
    const env=await seal(cryptoProvider,key,'wal',revision,head.headDigest,{kind:'formal-commit',id:'app',snapshot:clone(candidate)});
    const meta={...head,revision,headDigest:await digest(cryptoProvider,env)};
    if(!await transactionCheckAndPut(idb,'append',head,{['entry:'+revision]:env,meta}))fail('ATOMIC_CAS_REJECTED');
    const fresh=await readRecords(idb),result=await validateAll(cryptoProvider,key,fresh,cacheBox,validationStats);
    if(result.revision!==revision||!eq(result.snapshot,candidate)||!eq(result.checkpoint,checkpoint))fail('FORMAL_READBACK_FAILED');
    current=clone(candidate);head=meta;state='ACTIVE';void persistVerified(key,head);return status('FORMAL_COMMIT_READBACK_VERIFIED',{revision});
   });
  });
 }

 // Shared generation-cutover core, with independent product/test authority.
 // The product entry always stages and authenticates a durable recovery anchor.
 // No new primary meta fields or schema changes; same PBKDF2 salt and key.
 async function rebaseSameSalt({threshold=64,injectAbort=false,injectAnchorAbort=false,onAfterAnchorStageForTest=null,shouldYieldBeforeCutover=null,onBeforePrimaryCASForTest=null}={},product=false){
  if((product?!productAuthorization():!privateSameSaltAllowed)||state!=='ACTIVE')fail('TEST_ONLY_REBASE_FORBIDDEN');
  if(!Number.isSafeInteger(threshold)||threshold<2||threshold>maxRevision)fail('INVALID_TEST_REBASE_THRESHOLD');
  if(undoReceipt)fail('REBASE_PENDING_UNDO');
  state='STOP_NO_RETRY';
  return runGuarded(()=>exclusive(async()=>{
   const source=await readRecords(idb);
   if(!eq(source.meta,head))fail('STALE_FORMAL_HEAD');
   const verified=await validateAllFull(cryptoProvider,key,source);
   if(!eq(verified.out.snapshot,current)||!eq(verified.out.checkpoint,checkpoint))fail('REBASE_SOURCE_CHANGED');
   if(source.meta.revision<threshold){state='ACTIVE';return status('REBASE_BELOW_THRESHOLD',{revision:head.revision})}
   const baseline=checkpoint?snapshotToApp(checkpoint.snapshot,{weeklyOptions:current.weeklyOptions}):clone(current);
   reviewedSnapshot(baseline);
   if(checkpoint&&!eq(appToSnapshot(baseline),checkpoint.snapshot))fail('REBASE_CHECKPOINT_NOT_LOSSLESS');
   const newEscrow=await seal(cryptoProvider,key,'original',-1,'genesis',baseline);
   const initial={kind:'initial',id:'synthetic',snapshot:baseline,...(checkpoint?{checkpoint:clone(checkpoint)}:{})};
   const first=await seal(cryptoProvider,key,'wal',0,'genesis',initial);
   const entries=[first];
   let prev=await digest(cryptoProvider,first);
   if(!eq(baseline,current)){
    const last=await seal(cryptoProvider,key,'wal',1,prev,{kind:'formal-commit',id:'app',snapshot:clone(current)});
    entries.push(last);prev=await digest(cryptoProvider,last);
   }
   const meta={...head,revision:entries.length-1,headDigest:prev,escrowDigest:await digest(cryptoProvider,newEscrow)};
   if(meta.salt!==source.meta.salt||eq(meta,source.meta))fail('REBASE_SALT_OR_HEAD_UNSAFE');
   const candidate={meta,escrow:newEscrow,entries:[...entries,null],keys:['meta','escrow',...entries.map((_,i)=>'entry:'+i)]};
   const checked=await validateAllFull(cryptoProvider,key,candidate);
   if(!eq(checked.out.snapshot,current)||!eq(checked.out.checkpoint,checkpoint))fail('REBASE_CANDIDATE_PARITY');
   if(product||options.enableTestOnlyAnchorRing){
    const stage=await stageRecoveryAnchor(source,candidate,{injectAnchorAbort});
    if(stage==='ANCHOR_INJECTED_ABORT')return status('ANCHOR_STAGE_INJECTED_ABORT',{revision:head.revision,autoPruneAuthorized:false});
    if(stage!=='ANCHOR_STAGED')fail('ANCHOR_STAGE_CAS_REJECTED');
    if(product){
     // A successful transaction is not sufficient: authenticate the durable
     // exact source/target binding again before changing the authoritative WAL.
     const staged=await readRecoveryAnchors();let matched=0;
     for(const record of Object.values(staged)){
      const body=await validateRecoveryAnchorRecord(record);
      if(eq(body.sourceMeta,source.meta)&&eq(body.targetMeta,meta)&&eq(body.current,current)&&eq(body.checkpoint,checkpoint))matched++;
     }
     if(matched!==1)fail('ANCHOR_DURABLE_READBACK_REQUIRED');
    }
   }
   if(typeof onAfterAnchorStageForTest==='function')await onAfterAnchorStageForTest();
   // Yield to user saves/sync if they arrived during the independently committed anchor.
   // The primary remains unchanged; the candidate anchor is passive evidence.
   if(typeof shouldYieldBeforeCutover==='function'&&shouldYieldBeforeCutover()){
    state='ACTIVE';return status('REBASE_YIELDED_FOREGROUND',{revision:head.revision,autoPruneAuthorized:false});
   }
   const outcome=await replaceSameSaltCAS(idb,source,candidate,injectAbort,{
    precommitYield:typeof shouldYieldBeforeCutover==='function'?shouldYieldBeforeCutover:null,
    onBeforePrecommitForTest:onBeforePrimaryCASForTest
   });
   if(outcome==='CAS_PREFLIGHT_YIELDED'){
    state='ACTIVE';return status('REBASE_YIELDED_FOREGROUND',{revision:head.revision,autoPruneAuthorized:false});
   }
   if(outcome==='CAS_PREFLIGHT_UNVERIFIED'){
    state='ACTIVE';return status('REBASE_PRECOMMIT_UNVERIFIED',{revision:head.revision,autoPruneAuthorized:false});
   }
   if(outcome==='INJECTED_ABORT')return status('REBASE_INJECTED_ABORT',{revision:head.revision});
   if(outcome!=='COMMITTED')fail('REBASE_SOURCE_CAS_REJECTED');
   const after=await readRecords(idb);
   const checkAfter=await validateAllFull(cryptoProvider,key,after);
   if(!eq(checkAfter.out.snapshot,current)||!eq(checkAfter.out.checkpoint,checkpoint)||!eq(after.meta,meta))fail('REBASE_READBACK_MISMATCH');
   cacheBox.current=checkAfter.nextCache;
   head=after.meta;undoReceipt=null;state='ACTIVE';
   // Only a fully verified cutover may refresh the disposable receipt.
   // Cache receipts never grant maintenance authority. Ordinary startup is OFF.
   void persistVerified(key,head);
   return status(product?'PRODUCT_WAL_REBASE_READBACK':'TEST_ONLY_SAME_SALT_REBASE_READBACK',{revision:head.revision,previousRevision:source.meta.revision,entries:entries.length,saltUnchanged:true,autoPruneAuthorized:product});
  }));
 }


 // Product entry accepts only its foreground-yield observer. Authorization
 // is constructor-bound, threshold is fixed, and test hooks cannot be forwarded.
 async function maintainProductWal(args={}){
  if(!productAuthorization())return Object.freeze({phase:'PRODUCT_WAL_MAINTENANCE_OFF'});
  if(!shape(args,['shouldYieldBeforeCutover'])||typeof args.shouldYieldBeforeCutover!=='function')fail('PRODUCT_MAINTENANCE_OBSERVERS_REQUIRED');
  const yieldNow=()=>{try{return !productAuthorization()||args.shouldYieldBeforeCutover()!==false}catch{return true}};
  if(yieldNow())return status('REBASE_YIELDED_FOREGROUND',{revision:head?.revision});
  return rebaseSameSalt({threshold:64,shouldYieldBeforeCutover:yieldNow},true);
 }
 const testOnlyCompactSameSalt=args=>rebaseSameSalt(args,false);
 // Phase 4K: OFF-BY-DEFAULT / development-only. The exact old in-memory
 // source head must be authenticated by a sealed anchor and its target must
 // remain an authenticated prefix of the live vault. Never infer freshness
 // from a lowered revision alone; never restore anything from the anchor.
 async function isAnchoredForwardRefresh(rows){
  if(!anchorRefreshAllowed)return false;
  const slots=await readRecoveryAnchors();
  let matches=0;
  const entryZero=await digest(cryptoProvider,rows.entries[0]);
  for(const record of Object.values(slots)){
   const body=await validateRecoveryAnchorRecord(record);
   if(!eq(body.sourceMeta,head))continue;
   if(!eq(body.current,current)||!eq(body.checkpoint,checkpoint))continue;
   if(record.targetEntry0Digest!==entryZero)continue;
   const target=body.targetMeta,live=rows.meta;
   if(target.revision>live.revision)continue;
   if(target.version!==live.version||target.purpose!==live.purpose||
      target.kdf!==live.kdf||target.iterations!==live.iterations||
      target.salt!==live.salt||target.escrowDigest!==live.escrowDigest)continue;
   const targetHead=rows.entries[target.revision];
   if(!targetHead||await digest(cryptoProvider,targetHead)!==target.headDigest)continue;
   matches++;
  }
  return matches===1;
 }
 async function refresh(){
  if(!formal||state!=='ACTIVE'){cacheBox.current=null;fail('FORMAL_UNLOCKED_REQUIRED')}
  return runGuarded(()=>exclusive(async()=>{
   const rows=await readRecords(idb),result=await validateAll(cryptoProvider,key,rows,cacheBox,validationStats);
   const guarded=anchorRefreshAllowed;
   // Revision numbers may be reused after a rebaseline. All tabs, including
   // standard production tabs without maintenance opt-in, must prove their
   // authenticated old head remains an append-only prefix of this vault.
   const sameHistory=result.revision>=head.revision&&
     rows.meta.salt===head.salt&&rows.meta.escrowDigest===head.escrowDigest&&
     rows.entries[head.revision]&&
     await digest(cryptoProvider,rows.entries[head.revision])===head.headDigest;
   // Only the explicit PRIVATE maintenance mode may follow a rebaseline,
   // and only with separately authenticated anchor evidence. Never infer
   // lineage from a higher revision number or the same encryption salt.
   if(!sameHistory&&(!guarded||!(await isAnchoredForwardRefresh(rows))))fail('HEAD_ROLLBACK');
   current=result.snapshot;checkpoint=result.checkpoint;head=rows.meta;
   void persistVerified(key,head);
   return readCurrent();
  }));
 }
 return Object.freeze({inspectReadOnly,initialize,initializeConfirmedReceive,unlock,readCurrent,readRevision,readHeadIdentity,readSyncCheckpoint,append,commitConfirmedSync,...(formal?{commitApp,refresh}:{}),...(productMaintenance?{maintainProductWal}:{}),...(privateSameSaltAllowed?{testOnlyCompactSameSalt,...(options.enableTestOnlyAnchorRing?{testOnlyInspectAnchors}:{} )}:{}),getState:()=>state});
}

return instantiate(options);
}
