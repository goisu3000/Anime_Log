/* ANI:LOG sync v1.0: non-production, reviewed multi-record write gate.
 * Uses v0.8's isolated boundary and WAL, not ANI:LOG localStorage.
 * No implicit backup replacement, tombstone restoration, or cloud connection.
 * Preview and commit are separate operations. Explicit approval MUST come from
 * a user-facing confirmation flow when the real app is eventually integrated.
 */
import {appToSnapshot} from './app-bridge.mjs';
import {equalState,RecoveryBlocked} from './durable-journal.mjs';
const copy=structuredClone;
const own=(o,k)=>Object.hasOwn(o,k);
const fail=reason=>new RecoveryBlocked('reviewed batch: '+reason);
const bad=new Set(['__proto__','constructor','prototype']);
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=150&&!bad.has(id);
const changed=(before,after)=>[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!equalState(before[k],after[k]));
const fields=(before,after)=>[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!equalState(before[k],after[k]));
const sort=x=>x.slice().sort();
const sameIds=(a,b)=>equalState(sort(a),sort(b));
const rated=r=>r?.status==='watched'&&Number.isInteger(r?.review?.overall)&&r.review.overall>=1&&r.review.overall<=5;
const weeklyAllowed=new Set(['watching','planned','paused']);
function validWeekly(statuses){return Array.isArray(statuses)&&statuses.length>0&&statuses.length<=3&&new Set(statuses).size===statuses.length&&statuses.every(s=>weeklyAllowed.has(s))}
function validIds(ids){return Array.isArray(ids)&&ids.length>0&&ids.length<=1500&&ids.every(validId)&&new Set(ids).size===ids.length}
function buildProposal(kind,before,draft,sourceIds,weeklyStatuses,groupRating){
 if(!['backup-merge','rank-reorder'].includes(kind))throw fail('unreviewed or destructive batch type');
 if(!validIds(sourceIds))throw fail('invalid affected source IDs');
 if(!draft||typeof draft!=='object'||Array.isArray(draft))throw fail('draft must be a record map');
 if(weeklyStatuses!==undefined&&(kind!=='backup-merge'||!validWeekly(weeklyStatuses)))throw fail('invalid weekly change');
 const after=copy(before);
 // No deletion is permitted for these two operations. Tombstone restoration is
 // a separate destructive operation, intentionally not available here.
 for(const [id,r] of Object.entries(draft)){
  if(!validId(id)||!r||r.id!==id)throw fail('invalid record identity');
 }
 const changedIds=changed(before.records,draft);
 if(changedIds.some(id=>!sourceIds.includes(id)))throw fail('undeclared work changed');
 if(changedIds.some(id=>!own(draft,id)))throw fail('physical deletion requires a dedicated tombstone flow');
 if(sourceIds.some(id=>own(before.tombstones,id)))throw fail('backup cannot silently resurrect deleted work');
 if(kind==='backup-merge'){
  if(sourceIds.some(id=>!own(draft,id)))throw fail('source work missing from merge proposal');
 }
 if(kind==='rank-reorder'){
  if(weeklyStatuses!==undefined)throw fail('ranking cannot change weekly settings');
  if(!Number.isInteger(groupRating)||groupRating<1||groupRating>5)throw fail('rating group required');
  const completeGroup=Object.entries(before.records).filter(([,r])=>rated(r)&&r.review.overall===groupRating).map(([id])=>id);
  if(completeGroup.length<2||!sameIds(sourceIds,completeGroup))throw fail('rank batch must cover the whole rated group');
  if(changedIds.some(id=>!own(before.records,id)))throw fail('rank batch cannot create a work');
  if(changedIds.some(id=>fields(before.records[id],draft[id]).some(f=>!['myRankOrder','rankUpdatedAt'].includes(f))))throw fail('rank batch touched unrelated fields');
  const ranks=sourceIds.map(id=>draft[id].myRankOrder);
  if(!equalState(ranks.slice().sort((a,b)=>a-b),sourceIds.map((_,i)=>i)))throw fail('rank batch must assign a unique contiguous order');
  if(sourceIds.some(id=>typeof draft[id].rankUpdatedAt!=='string'||!Number.isFinite(Date.parse(draft[id].rankUpdatedAt))))throw fail('rank timestamp required');
 }
 after.records=copy(draft);
 if(weeklyStatuses!==undefined)after.settings.weeklyOptions={statuses:copy(weeklyStatuses)};
 // Whole proposal must remain valid, bounded, and unable to drop unrelated metadata.
 return {after:appToSnapshot({records:after.records,tombstones:after.tombstones,weeklyOptions:{open:false,statuses:after.settings.weeklyOptions.statuses}}),changedIds};
}

/** Requires the deliberately isolated v0.8 TEST-v08 boundary. */
export class ReviewedBatchGate {
 constructor({boundary,app}={}){
  if(!boundary||!app||boundary.namespace!=='TEST-v08'||typeof boundary._mutate!=='function'||typeof app.readAll!=='function')throw Error('test-only isolated boundary required');
  this.boundary=boundary;this.app=app;this.pending=null;
 }
 async preview({kind,before,draft,sourceIds,weeklyStatuses,groupRating}={}){
  return this.boundary.withLock(async()=>{
   await this.boundary.journal.current();
   const live=await this.app.readAll();
   const baseline=appToSnapshot(live);
   if(!before||!equalState(baseline.records,before))throw fail('stale preview source; refresh before planning');
   const {after,changedIds}=buildProposal(kind,baseline,draft,sourceIds,weeklyStatuses,groupRating);
   const summary={kind,added:changedIds.filter(id=>!own(baseline.records,id)).length,
    updated:changedIds.filter(id=>own(baseline.records,id)).length,removed:0,
    weeklyChanged:!equalState(baseline.settings.weeklyOptions,after.settings.weeklyOptions),
    affected:sort(changedIds)};
   // This object is an ephemeral, in-memory approval ticket, NOT a user consent.
   // Use WeakMap-style identity via equality of the exact opaque ticket object.
   const ticket=Object.freeze({summary:Object.freeze(summary)});
   this.pending={ticket,baseline:copy(baseline),after:copy(after),kind};
   return ticket;
  });
 }
 async commit(ticket,{confirmed=false}={}){
  const plan=this.pending;
  if(!confirmed||!plan||ticket!==plan.ticket)throw fail('explicit approval of a fresh preview required');
  this.pending=null; // one-shot, including failed attempts; request a new preview
  return this.boundary._mutate(async current=>{
   if(!equalState(current,plan.baseline))throw fail('stale preview: app or journal changed');
   return {snapshot:copy(plan.after),result:{status:'batch-stored',kind:plan.kind,...copy(plan.ticket.summary)}};
  });
 }
 async previewBackupReplacement({before,replacement}={}){
  // Deliberately READ-ONLY. A bulk deletion and an ordinary app import must
  // not be confused with explicit, cloud-wide deletion approval.
  return this.boundary.withLock(async()=>{
   await this.boundary.journal.current();
   const current=appToSnapshot(await this.app.readAll());
   if(!before||!equalState(before,current.records))throw fail('stale replacement preview');
   if(!replacement||typeof replacement!=='object'||Array.isArray(replacement))throw fail('invalid replacement');
   const candidates=appToSnapshot({records:replacement,tombstones:{},weeklyOptions:{open:false,statuses:['watching']}});
   const removed=Object.keys(current.records).filter(id=>!own(candidates.records,id));
   const added=Object.keys(candidates.records).filter(id=>!own(current.records,id));
   const updated=Object.keys(current.records).filter(id=>own(candidates.records,id)&&!equalState(current.records[id],candidates.records[id]));
   return Object.freeze({kind:'backup-replace',allowed:false,requiresSeparateDeletionReview:true,
    counts:{removed:removed.length,added:added.length,updated:updated.length}});
  });
 }
}
