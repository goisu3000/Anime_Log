/* ANI:LOG sync core POC v0.1 (offline only; not wired into ANI:LOG or Cloudflare).
 * This is a reviewable, conservative prototype, NOT production authorization code.
 */

export const SYNC_SCHEMA = 1;
export const MAX_SYNC_BYTES = 3_000_000;
export const MAX_WORKS = 1_500;
export const MAX_TOMBSTONES = 10_000;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ABSENT = Symbol('absent');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const own = (obj,key) => Object.hasOwn(obj,key);

function inspectJSON(value,depth=0){
  if(depth>35) throw new Error('JSON too deeply nested');
  if(value === null || typeof value==='string' || typeof value==='boolean') return;
  if(typeof value === 'number' && Number.isFinite(value)) return;
  if(Array.isArray(value)){for(const v of value) inspectJSON(v,depth+1);return}
  if(plain(value)){
    for(const [k,v] of Object.entries(value)){
      if(DANGEROUS_KEYS.has(k))throw new Error('unsafe JSON key');
      inspectJSON(v,depth+1);
    }
    return;
  }
  throw new Error('not a JSON value');
}
function canonical(value){
  if(Array.isArray(value))return `[${value.map(v=>canonical(v)).join(',')}]`;
  if(plain(value))return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
const eq = (a,b) => a===ABSENT ? b===ABSENT : b!==ABSENT && canonical(a)===canonical(b);
const clone = value => value===ABSENT ? ABSENT : structuredClone(value);
const isObject = x => plain(x);
const cloneMap = source => Object.assign(Object.create(null),structuredClone(source));

export function blankSnapshot(){return {schema:SYNC_SCHEMA,records:Object.create(null),tombstones:Object.create(null),settings:Object.create(null)};}
export function validateSnapshot(s){
  inspectJSON(s);
  if(!plain(s) || s.schema!==SYNC_SCHEMA || !plain(s.records) || !plain(s.tombstones) || !plain(s.settings))throw new Error('bad snapshot envelope');
  if(Object.keys(s.records).length>MAX_WORKS || Object.keys(s.tombstones).length>MAX_TOMBSTONES)throw new Error('too many works/tombstones');
  for(const [id,record] of Object.entries(s.records)){
    if(!id || id.length>150 || !plain(record) || record.id!==id || typeof record.title!=='string' || record.title.length>200 ||
      !['watched','watching','planned','paused','dropped'].includes(record.status))throw new Error('invalid record');
    if(own(s.tombstones,id))throw new Error('record and tombstone coexist');
  }
  for(const [id,tombstone] of Object.entries(s.tombstones)){
    if(!id || id.length>150 || !plain(tombstone) || tombstone.id!==id || !/^\d{4}-\d{2}-\d{2}T/.test(tombstone.deletedAt||'') || !Number.isFinite(Date.parse(tombstone.deletedAt)))throw new Error('invalid tombstone');
  }
  const bytes=encoder.encode(JSON.stringify(s)).length;
  if(bytes>MAX_SYNC_BYTES)throw new Error('snapshot too large');
  return s;
}

function stateFor(snapshot,id){
  if(own(snapshot.records,id))return {kind:'live',value:snapshot.records[id]};
  if(own(snapshot.tombstones,id))return {kind:'deleted',value:snapshot.tombstones[id]};
  return {kind:'absent',value:null};
}
const stateEq=(a,b)=>a.kind===b.kind&&(a.kind==='absent'||eq(a.value,b.value));
const stateCopy=s=>s.kind==='absent'?{kind:'absent',value:null}:{kind:s.kind,value:clone(s.value)};
function place(snapshot,id,state){
  if(state.kind==='live')snapshot.records[id]=state.value;
  if(state.kind==='deleted')snapshot.tombstones[id]=state.value;
}
function pathJoin(parts){return parts.map(s=>String(s).replaceAll('~','~0').replaceAll('/','~1')).join('/')}
function conflict(conflicts,parts,base,local,remote,reason){
  const format=v=>v===ABSENT?{missing:true}:{value:clone(v)};
  conflicts.push({path:pathJoin(parts),reason,base:format(base),local:format(local),remote:format(remote)});
}

// Three-way recursive merge: only change fields if one side changed or both agree.
// On conflicting edits, keep the local value in PREVIEW only; callers MUST NOT commit it.
function mergeValue(base,local,remote,parts,conflicts){
  if(eq(local,remote))return clone(local);
  if(eq(base,local))return clone(remote);
  if(eq(base,remote))return clone(local);
  if(isObject(local)&&isObject(remote)&&(base===ABSENT||isObject(base))){
    const result=Object.create(null);
    for(const field of new Set([...Object.keys(base===ABSENT?{}:base),...Object.keys(local),...Object.keys(remote)])){
      const bv=base===ABSENT||!own(base,field)?ABSENT:base[field];
      const lv=own(local,field)?local[field]:ABSENT;
      const rv=own(remote,field)?remote[field]:ABSENT;
      // updatedAt is purely display metadata; NEVER use it to select content.
      if(field==='updatedAt'&&[lv,rv].every(v=>v===ABSENT||typeof v==='string')){
        const dates=[lv,rv].filter(v=>v!==ABSENT&&Number.isFinite(Date.parse(v)));
        const value=dates.sort().at(-1)??(lv!==ABSENT?lv:rv);
        if(value!==ABSENT)result[field]=value;
        continue;
      }
      const merged=mergeValue(bv,lv,rv,[...parts,field],conflicts);
      if(merged!==ABSENT)result[field]=merged;
    }
    return result;
  }
  conflict(conflicts,parts,base,local,remote,'concurrent-edit');
  return clone(local);
}
function mergeWork(base,local,remote,id,conflicts){
  // A previously known work must not disappear without a durable tombstone.
  // Catch both accidental array filtering and old clients still using delete saved[id].
  if(base.kind!=='absent'&&(local.kind==='absent'||remote.kind==='absent')){
    conflict(conflicts,['works',id],base.value,local.value??ABSENT,remote.value??ABSENT,'missing-without-tombstone');
    return stateCopy(local);
  }
  if(stateEq(local,remote))return stateCopy(local);
  if(stateEq(base,local))return stateCopy(remote);
  if(stateEq(base,remote))return stateCopy(local);
  if(local.kind==='live'&&remote.kind==='live'&&(base.kind==='live'||base.kind==='absent')){
    return {kind:'live',value:mergeValue(base.kind==='live'?base.value:ABSENT,local.value,remote.value,['records',id],conflicts)};
  }
  // A deletion versus an edit, or a concurrent re-add, is never silently resolved.
  if(local.kind==='deleted'&&remote.kind==='deleted'){
    return {kind:'deleted',value:mergeValue(base.kind==='deleted'?base.value:ABSENT,local.value,remote.value,['tombstones',id],conflicts)};
  }
  conflict(conflicts,['works',id],base.value??ABSENT,local.value??ABSENT,remote.value??ABSENT,
    `${local.kind}-versus-${remote.kind}`);
  return stateCopy(local);
}

export function mergeSnapshots(base,local,remote){
  validateSnapshot(base);validateSnapshot(local);validateSnapshot(remote);
  const merged=blankSnapshot(),conflicts=[];
  const ids=new Set([...Object.keys(base.records),...Object.keys(base.tombstones),...Object.keys(local.records),
    ...Object.keys(local.tombstones),...Object.keys(remote.records),...Object.keys(remote.tombstones)]);
  for(const id of ids)place(merged,id,mergeWork(stateFor(base,id),stateFor(local,id),stateFor(remote,id),id,conflicts));
  merged.settings=mergeValue(base.settings,local.settings,remote.settings,['settings'],conflicts);
  if(!conflicts.length)validateSnapshot(merged);
  return {merged,conflicts,ok:conflicts.length===0};
}

export function toSnapshot(records,settings={}){
  if(!plain(records)||!plain(settings))throw new Error('invalid local input');
  const s=blankSnapshot();s.records=cloneMap(records);s.settings=cloneMap(settings);return validateSnapshot(s);
}
export function markDeleted(snapshot,id,deletedAt){
  validateSnapshot(snapshot);
  if(!own(snapshot.records,id))throw new Error('cannot delete absent record');
  if(!Number.isFinite(Date.parse(deletedAt)))throw new Error('invalid deletion time');
  const changed=clone(snapshot);delete changed.records[id];changed.tombstones[id]={id,deletedAt};validateSnapshot(changed);
  return changed;
}
export function reAdd(snapshot,record){
  validateSnapshot(snapshot);
  if(!record || typeof record.id!=='string')throw new Error('invalid record');
  const changed=clone(snapshot);delete changed.tombstones[record.id];changed.records[record.id]=clone(record);validateSnapshot(changed);
  return changed;
}

function b64url(bytes){return BufferLikeToBase64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
function BufferLikeToBase64(bytes){
  if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
  let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
}
function fromB64url(s){
  if(typeof s!=='string'||! /^[A-Za-z0-9_-]+$/.test(s))throw new Error('bad base64url');
  const padded=s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4);
  if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(padded,'base64'));
  return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
async function gzip(bytes){
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipLimited(bytes,limit=MAX_SYNC_BYTES){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;
      if(size>limit)throw new Error('decompressed content too large');chunks.push(value)}
  }finally{await reader.cancel().catch(()=>{})}
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result;
}
export function makeTestMasterKey(){const seed=new Uint8Array(32);crypto.getRandomValues(seed);return seed;}
async function aesKey(seed,boxId){
  if(!(seed instanceof Uint8Array)||seed.length!==32||! /^[A-Za-z0-9_-]{8,90}$/.test(boxId))throw new Error('invalid encryption params');
  const key=await crypto.subtle.importKey('raw',seed,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(boxId),info:encoder.encode('ANI:LOG sync snapshot v1')},
    key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function aad(boxId,revision){return encoder.encode(JSON.stringify({protocol:'anilog-sync-v1',boxId,revision}))}
export async function encryptSnapshot(snapshot,{masterKey,boxId,revision}){
  validateSnapshot(snapshot);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('bad revision');
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const key=await aesKey(masterKey,boxId);
  const compressed=await gzip(encoder.encode(JSON.stringify(snapshot)));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(boxId,revision)},key,compressed));
  return {v:1,revision,iv:b64url(iv),data:b64url(data)};
}
export async function decryptSnapshot(envelope,{masterKey,boxId,revision}){
  if(!plain(envelope)||envelope.v!==1||revision!==envelope.revision)throw new Error('bad envelope/revision');
  if(typeof envelope.data!=='string'||envelope.data.length>2_000_000)throw new Error('oversized encrypted data');
  const iv=fromB64url(envelope.iv);if(iv.length!==12)throw new Error('bad IV');
  const ciphertext=fromB64url(envelope.data),key=await aesKey(masterKey,boxId);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(boxId,revision)},key,ciphertext);
  const raw=await gunzipLimited(new Uint8Array(plaintext));
  return validateSnapshot(JSON.parse(decoder.decode(raw)));
}

// Offline simulation of a D1 UPDATE ... WHERE revision = baseRevision.
// Production requires an actual D1-backed Worker and independent authentication.
export class RevisionStoreSimulator{
  constructor(snapshot=blankSnapshot()){
    this.snapshot=clone(validateSnapshot(snapshot));this.revision=0;this.writes=0;
  }
  async read(){return {revision:this.revision,snapshot:clone(this.snapshot)}}
  async cas(baseRevision,snapshot){
    validateSnapshot(snapshot);
    if(baseRevision!==this.revision)return {status:409,revision:this.revision,snapshot:clone(this.snapshot)};
    this.snapshot=clone(snapshot);this.revision++;this.writes++;
    return {status:200,revision:this.revision};
  }
}

// This prototype simulates HTTP + D1 in memory and tests integration decisions.
// No source app data and no real network/API are used.
export async function syncOnce(store,{baseline,local,revision,maxAttempts=3,onBeforeCAS}={}){
  validateSnapshot(baseline);validateSnapshot(local);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('bad base revision');
  for(let n=0;n<maxAttempts;n++){
    const remote=await store.read();
    if(remote.revision<revision)throw new Error('server revision rolled back');
    const proposed=mergeSnapshots(baseline,local,remote.snapshot);
    if(!proposed.ok)return {status:'conflict',conflicts:proposed.conflicts,local:clone(local),remote,attempts:n+1};
    if(eq(proposed.merged,remote.snapshot))return {status:'synced',snapshot:proposed.merged,baseline:clone(proposed.merged),revision:remote.revision,attempts:n+1,uploaded:false};
    if(onBeforeCAS)await onBeforeCAS({attempt:n,remote,proposed});
    const response=await store.cas(remote.revision,proposed.merged);
    if(response.status===200)return {status:'synced',snapshot:proposed.merged,baseline:clone(proposed.merged),revision:response.revision,attempts:n+1,uploaded:true};
    if(response.status!==409)throw new Error('unexpected CAS result');
  }
  return {status:'retry-later',local:clone(local),revision};
}
