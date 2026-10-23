/* ANI:LOG sync v2.9, MIXED ID WAL contract, TEST-ONLY.
 * This adapter never opens production storage or fetches actual API data.
 * Creation uses a caller-supplied source and an explicit identity-specific
 * provenance label; the label is a test gate, NOT server authentication.
 */
import {equalState,RecoveryBlocked,MemoryAppParts} from './durable-journal.mjs';
import {LegacyOperationGate} from './legacy-operation-gate.mjs';
import {canonicalJikanId} from './v27-real-record-gate.mjs';
import {canonicalCustomId,inspectMixedRecords} from './v28-mixed-identity-preflight.mjs';

const own=(x,k)=>Object.hasOwn(x,k);
const clone=x=>structuredClone(x);
const fail=m=>{throw new RecoveryBlocked('v2.9 mixed TEST gate: '+m)};
const validId=id=>canonicalJikanId(id)||canonicalCustomId(id);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const iso=x=>typeof x==='string'&& /^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x));
const statuses=new Set(['planned','watching','watched','paused','dropped']);
const allowed={
 progress:new Set(['watchedEpisodes','updatedAt']),
 status:new Set(['status','updatedAt','completedOn','nextWatchPinnedAt','nextWatchUpdatedAt']),
 note:new Set(['note','noteDeletedAt']),
 review:new Set(['review','reviewDeletedAt','note','updatedAt']),
 completion:new Set(['completedOn','updatedAt']),
 pin:new Set(['nextWatchPinnedAt','nextWatchUpdatedAt']),
 'weekly-schedule':new Set(['weeklySchedule']),
 stream:new Set(['streamPreference']),
 ranking:new Set(['myRankOrder','rankUpdatedAt'])
};
export function assertMixedMap(map,{maxWorks=1500,maxBytes=3_000_000}={}){
 if(!plain(map))fail('record map is not a plain object');
 let report;try{report=inspectMixedRecords(map,{maxWorks,maxBytes})}catch(e){fail('invalid JSON or record: '+e.message)}
 if(report.issues.length)fail('unsupported ID or malformed work: '+report.issues[0].id);
 return report;
}
export function assertMixedTombstones(tombs,records){
 if(!plain(tombs)||Object.keys(tombs).length>10_000)fail('tombstones shape or count invalid');
 for(const [id,t] of Object.entries(tombs)){
  if(!validId(id)||own(records,id)||!plain(t)||t.id!==id||!iso(t.deletedAt))fail('invalid/dead-live tombstone');
  // Reject hidden fields and dangerous nested JSON structures using existing
  // mixed inspector without destroying unknown tombstone metadata.
  const probe={id,title:'tombstone-validation',status:'planned',unknown:t};
  try{assertMixedMap({[id]:probe},{maxWorks:1,maxBytes:150_000})}catch(e){fail('invalid tombstone metadata: '+e.message)}
 }
 return true;
}
export function reviewMixedTransition({before,draft,intent,admittedIds,sourceRecord=null}={}){
 assertMixedMap(before);assertMixedMap(draft);
 if(!(admittedIds instanceof Set)||!intent||!validId(intent.id)||!admittedIds.has(intent.id))fail('unadmitted target');
 const changed=[...new Set([...Object.keys(before),...Object.keys(draft)])].filter(id=>!equalState(before[id],draft[id]));
 if(changed.some(id=>id!==intent.id))fail('undeclared work changed');
 const {kind,id}=intent,prev=before[id],next=draft[id];
 if(kind==='create'){
  if(prev||!next||!sourceRecord)fail('creation requires absent work and source record');
  assertMixedMap({[id]:sourceRecord},{maxWorks:1,maxBytes:100_000});
  if(!equalState(sourceRecord.id,id))fail('source ID mismatch');
  // Local custom registration must be explicit; an API-shaped fixture does not
  // authorize treating a custom ID as remote metadata (or the reverse).
  const expectedProvenance=canonicalCustomId(id)?'test-user-entered':'test-api-fixture';
  if(intent.provenance!==expectedProvenance)fail('unproved creation provenance');
  if(!statuses.has(next.status)||!iso(next.updatedAt))fail('invalid initial status/timestamp');
  const expected={...clone(sourceRecord),status:next.status,updatedAt:next.updatedAt};
  if(!own(sourceRecord,'watchedEpisodes')&&next.watchedEpisodes===0)expected.watchedEpisodes=0;
  if(!equalState(expected,next))fail('creation changed source metadata or inserted extra fields');
 }else if(kind==='delete'){
  if(!prev||next||!iso(intent.deletedAt))fail('invalid explicit delete');
 }else if(kind==='undo-delete'){
  if(prev||!next||!intent.expectedTombstone)fail('restore requires explicit deletion receipt');
 }else if(kind==='undo-edit'){
  if(!prev||!next||!intent.expectedCurrent||!equalState(prev,intent.expectedCurrent))fail('stale edit undo');
 }else{
  if(!prev||!next||!allowed[kind])fail('unrecognized kind or absent work');
  const keys=[...new Set([...Object.keys(prev),...Object.keys(next)])].filter(k=>!equalState(prev[k],next[k]));
  if(keys.some(k=>!allowed[kind].has(k)))fail('operation modified immutable/undeclared field');
  if(kind==='progress'&&(!keys.includes('watchedEpisodes')||!iso(next.updatedAt)))fail('invalid progress');
  if(kind==='status'&&prev.status==='watching'&&next.status==='watched'&&!prev.completedOn&&next.completedOn&&!intent.fromFinalPlusOne)fail('completion date lacks finale proof');
  if(kind==='review'&&keys.includes('note')){
   if(prev.note||prev.noteDeletedAt||!prev.review?.comment||next.note?.text!==prev.review.comment||next.note?.updatedAt!==prev.review.updatedAt)fail('unproved legacy comment carry-over');
  }
 }
 return {kind,id,changed:changed.length===1,changedIds:changed};
}
export class V29MixedTestGateway{
 constructor({boundary,app,admittedIds}={}){
  if(!boundary||boundary.namespace!=='TEST-v08'||!app||!(admittedIds instanceof Set)||!admittedIds.size||[...admittedIds].some(id=>!validId(id)))fail('explicit test-only WAL and ID allowlist required');
  if(!(app instanceof MemoryAppParts)&&(!app.keys||Object.values(app.keys).length!==3||Object.values(app.keys).some(k=>typeof k!=='string'||!k.startsWith('__anilog_v29_BROWSER_TEST_ONLY__:'))))fail('non-test localStorage keys forbidden');
  this.boundary=boundary;this.app=app;this.ids=new Set(admittedIds);this.legacy=new LegacyOperationGate({boundary,app});
 }
 async commit({before,draft,intent,sourceRecord=null}={}){
  reviewMixedTransition({before,draft,intent,sourceRecord,admittedIds:this.ids});
  const snapshot=await this.boundary.getSnapshot();
  assertMixedMap(snapshot.records);assertMixedTombstones(snapshot.tombstones,snapshot.records);
  if(!equalState(snapshot.records,before))fail('stale before-state');
  if(intent.kind==='create'&&own(snapshot.tombstones,intent.id))fail('deleted work cannot silently reappear');
  if(intent.kind==='undo-delete'){
   if(!equalState(snapshot.tombstones[intent.id],intent.expectedTombstone))fail('stale tombstone receipt');
  }
  return this.legacy.commit({before:clone(before),draft:clone(draft),intent:clone(intent)});
 }
}
