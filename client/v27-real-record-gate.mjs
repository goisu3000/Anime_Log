/* ANI:LOG sync v2.7: REAL-SHAPED RECORD CONTRACT, TEST-ONLY.
 * Pure validation and an opt-in adapter to the isolated WAL. Does not open
 * production storage. Does not prove origin of remote API metadata.
 * v2.4.61 model(a) produces canonical jikan:<positive MAL ID> records.
 */
import {equalState,RecoveryBlocked,MemoryAppParts} from './durable-journal.mjs';
import {LegacyOperationGate} from './legacy-operation-gate.mjs';

const own=(o,k)=>Object.hasOwn(o,k);
const cp=x=>structuredClone(x);
const deny=new Set(['__proto__','prototype','constructor']);
const statuses=new Set(['planned','watching','watched','paused','dropped']);
const permitted={
 progress:new Set(['watchedEpisodes','updatedAt']),
 status:new Set(['status','updatedAt','completedOn','nextWatchPinnedAt','nextWatchUpdatedAt']),
 note:new Set(['note','noteDeletedAt']),
 review:new Set(['review','reviewDeletedAt','note']),
 completion:new Set(['completedOn','updatedAt']),
 pin:new Set(['nextWatchPinnedAt','nextWatchUpdatedAt']),
 'weekly-schedule':new Set(['weeklySchedule']),
 stream:new Set(['streamPreference']),
 // API metadata refresh is deliberately NOT enabled. Its provenance must be
 // checked by an independent trusted-fetch path before allowing any update.
 ranking:new Set(['myRankOrder','rankUpdatedAt'])
};
const fail=msg=>{throw new RecoveryBlocked('v2.7 real-shape TEST gate: '+msg)};
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const iso=x=>typeof x==='string'&& /^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x));
export function canonicalJikanId(id){
 if(typeof id!=='string'|| !/^jikan:[1-9]\d{0,14}$/.test(id))return false;
 const value=Number(id.slice(6));return Number.isSafeInteger(value)&&value>0;
}
function validateJSON(x,depth=0){
 if(depth>18)fail('metadata is nested too deeply');
 if(x===null||typeof x==='string'||typeof x==='boolean')return;
 if(typeof x==='number'){if(!Number.isFinite(x))fail('nonfinite numeric metadata');return;}
 if(Array.isArray(x)){
  if(x.length>2000)fail('array too large');for(const v of x)validateJSON(v,depth+1);return;
 }
 if(!plain(x))fail('record contains non-JSON object');
 if(Object.keys(x).length>120)fail('object has too many fields');
 for(const [k,v] of Object.entries(x)){
  if(deny.has(k)||!k||k.length>120)fail('dangerous field name');
  validateJSON(v,depth+1);
 }
}
export function assertRealShapedRecord(r,{maxBytes=100000}={}){
 if(!plain(r)||!canonicalJikanId(r.id))fail('noncanonical jikan ID');
 validateJSON(r);
 let raw;try{raw=JSON.stringify(r)}catch{fail('nonserializable record')}
 if(BufferLikeByteLength(raw)>maxBytes)fail('oversized record');
 if(typeof r.title!=='string'||!r.title.trim()||r.title.length>240)fail('invalid work title');
 if(!statuses.has(r.status))fail('invalid watch status');
 if(own(r,'updatedAt')&&r.updatedAt!==''&&!iso(r.updatedAt))fail('invalid updatedAt');
 if(own(r,'watchedEpisodes')&&(!Number.isInteger(r.watchedEpisodes)||r.watchedEpisodes<0||r.watchedEpisodes>9999))fail('invalid watched count');
 if(own(r,'episodes')&&r.episodes!==null&&(!Number.isInteger(r.episodes)||r.episodes<1||r.episodes>9999))fail('invalid episode count');
 if(own(r,'year')&&r.year!==null&&(!Number.isInteger(r.year)||r.year<1900||r.year>3000))fail('invalid year');
 // For legacy data, optional fields may be absent. Existing unknown JSON
 // fields survive unchanged; write operations may NOT silently rewrite them.
 return true;
}
function BufferLikeByteLength(x){return new TextEncoder().encode(x).length}
export function assertRealShapedMap(records,{maxRecords=1500,maxBytes=3_000_000}={}){
 if(!plain(records))fail('invalid records map');
 const ids=Object.keys(records);if(ids.length>maxRecords)fail('too many works');
 let size=0;
 for(const id of ids){
  if(!canonicalJikanId(id)||records[id]?.id!==id)fail('map and work IDs differ');
  assertRealShapedRecord(records[id]);
  size+=BufferLikeByteLength(JSON.stringify(records[id]));
  if(size>maxBytes)fail('record map exceeds staging limit');
 }
 return true;
}
export function assertRealTombstones(tombstones,records){
 if(!plain(tombstones))fail('invalid tombstones');
 if(Object.keys(tombstones).length>10000)fail('too many tombstones');
 for(const [id,t] of Object.entries(tombstones)){
  if(!canonicalJikanId(id)||own(records,id)||!plain(t)||t.id!==id||!iso(t.deletedAt))fail('invalid/dead-live tombstone');
  validateJSON(t);
 }
 return true;
}
export function reviewRealRecordTransition({before,draft,intent,admittedIds,sourceRecord=null}={}){
 assertRealShapedMap(before);assertRealShapedMap(draft);
 if(!(admittedIds instanceof Set)||!intent||!canonicalJikanId(intent.id)||!admittedIds.has(intent.id))fail('unadmitted or invalid work');
 const changed=[...new Set([...Object.keys(before),...Object.keys(draft)])].filter(id=>!equalState(before[id],draft[id]));
 if(changed.some(id=>id!==intent.id))fail('undeclared work changed');
 const {kind,id}=intent,prev=before[id],next=draft[id];
 if(kind==='create'){
  if(prev||!next||!sourceRecord)fail('create requires a new admitted record and explicit source');
  assertRealShapedRecord(sourceRecord);
  if(sourceRecord.id!==id)fail('source identity mismatch');
  // The user-facing action may append only the status/timestamp fields to
  // trusted source-shaped model metadata. Never infer trust from ID alone.
  const expected={...cp(sourceRecord),status:next.status,updatedAt:next.updatedAt};
  // A newly registered work can start explicitly at episode 0; the Jikan
  // model itself does not include the user's watchedEpisodes field.
  if(!own(sourceRecord,'watchedEpisodes')&&next.watchedEpisodes===0)expected.watchedEpisodes=0;
  if(next.status!=='planned'&&next.status!=='watching'&&next.status!=='watched'&&next.status!=='paused'&&next.status!=='dropped')fail('bad initial status');
  if(!iso(next.updatedAt)||!equalState(expected,next))fail('create altered source metadata');
 }else if(kind==='delete'){
  if(!prev||next||!iso(intent.deletedAt))fail('invalid explicit delete');
 }else if(kind==='undo-delete'){
  if(prev||!next||!intent.expectedTombstone)fail('delete undo requires receipt');
 }else if(kind==='undo-edit'){
  if(!prev||!next||!intent.expectedCurrent||!equalState(prev,intent.expectedCurrent))fail('stale edit undo');
 }else{
  if(!prev||!next||!permitted[kind])fail('unrecognized/absent edit target');
  const fields=[...new Set([...Object.keys(prev),...Object.keys(next)])].filter(k=>!equalState(prev[k],next[k]));
  if(fields.some(k=>!permitted[kind].has(k)))fail('metadata or undeclared field edited');
  if(kind==='progress'&&(!fields.includes('watchedEpisodes')||!iso(next.updatedAt)))fail('invalid progress edit');
  if(kind==='status'&&prev.status==='watching'&&next.status==='watched'&& !prev.completedOn&&next.completedOn&&!intent.fromFinalPlusOne)fail('unproved completion date');
  if(kind==='note'&&fields.includes('review'))fail('note mutated review');
  if(kind==='review'&&fields.includes('note')){
   if(prev.note||prev.noteDeletedAt||!prev.review?.comment||next.note?.text!==prev.review.comment||next.note?.updatedAt!==prev.review.updatedAt)fail('not proven legacy comment carryover');
  }
 }
 return {kind,id,changed:changed.length===1,changedIds:changed};
}

// All storage is supplied by a TEST caller. The adapter will never open localStorage,
// IndexedDB, or network itself. The legacy gateway enforces lock+WAL details.
export class V27RealShapeTestGateway{
 constructor({boundary,app,admittedIds}={}){
  if(!boundary||boundary.namespace!=='TEST-v08'||!app||!(admittedIds instanceof Set)||admittedIds.size===0||[...admittedIds].some(id=>!canonicalJikanId(id)))fail('explicit TEST-only WAL boundary and allowlist required');
  // Never accept the ANI:LOG production storage keys, even if passed through
  // a boundary carrying the TEST-v08 marker. A new browser must use v27-only
  // names for all three localStorage parts.
  if(!(app instanceof MemoryAppParts)&&
     (!app.keys||Object.values(app.keys).length!==3||Object.values(app.keys).some(k=>typeof k!=='string'||!k.startsWith('__anilog_v27_BROWSER_TEST_ONLY__:'))))
   fail('production or foreign localStorage keys forbidden');
  this.boundary=boundary;this.app=app;this.ids=new Set(admittedIds);this.legacy=new LegacyOperationGate({boundary,app});
 }
 async commit({before,draft,intent,sourceRecord=null}={}){
  reviewRealRecordTransition({before,draft,intent,admittedIds:this.ids,sourceRecord});
  const snapshot=await this.boundary.getSnapshot();
  assertRealShapedMap(snapshot.records);assertRealTombstones(snapshot.tombstones,snapshot.records);
  if(!equalState(snapshot.records,before))fail('stale before-state: no overwrite');
  if(intent.kind==='create'&&own(snapshot.tombstones,intent.id))fail('cannot recreate deleted work');
  return this.legacy.commit({before:cp(before),draft:cp(draft),intent:cp(intent)});
 }
}
