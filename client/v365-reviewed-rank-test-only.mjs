/* ANI:LOG v3.65. Synthetic-only rank fixture and strict atomic up/down/drag
 * admission over the existing v3.53 isolated WAL. No user data, no IO on import.
 * The ranking fixture is a separate explicitly labelled synthetic preparation,
 * not a general create/restore operation. No implicit consent for production.
 */
import {V354ReviewedGeneralOps} from './v354-reviewed-general-ops-test-only.mjs';
import {V22RankedBatch} from './v22-ranked-batch.mjs';
import {V353_DB,V353_BOX,V353_STORAGE_KEYS} from './v353-browser-mixed-id-test-only.mjs';
import {LocalStorageAppParts,equalState,RecoveryBlocked} from './durable-journal.mjs';
import {inspectV351MigrationInput} from './v351-readonly-general-id-preflight.mjs';
const cp=structuredClone;
const stop=x=>{throw new RecoveryBlocked('V365_RANK_STOP:'+x)};
export const V365_RANK_A='jikan:36501',V365_RANK_B='jikan:36502';
const ids=[V365_RANK_A,V365_RANK_B];
export const V365_RANK_FIXTURES=Object.freeze({
 [V365_RANK_A]:Object.freeze({id:V365_RANK_A,title:'架空順位アニメA',year:2024,season:'spring',status:'watched',watchedEpisodes:12,episodes:12,review:{overall:4,aspects:{},updatedAt:'2026-10-21T10:00:00.000Z'},myRankOrder:0,rankUpdatedAt:'2026-10-21T10:00:00.000Z',foreignRankKeep:{one:true}}),
 [V365_RANK_B]:Object.freeze({id:V365_RANK_B,title:'架空順位アニメB',year:2023,season:'winter',status:'watched',watchedEpisodes:10,episodes:10,review:{overall:4,aspects:{},updatedAt:'2026-10-21T10:00:00.000Z'},myRankOrder:1,rankUpdatedAt:'2026-10-21T10:00:00.000Z',foreignRankKeep:{two:true}})
});
const audit=parts=>{const x=inspectV351MigrationInput({recordsRaw:JSON.stringify(parts.records),tombstonesRaw:JSON.stringify(parts.tombstones),weeklyRaw:JSON.stringify(parts.weeklyOptions)});if(!x.eligibleForSeparateStagingReview||!x.roundtripVerified)stop('AUDIT_REFUSED')};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const baseAfter= (before,after,orders)=>{
 if(!equalState(before.tombstones,after.tombstones)||!equalState(before.weeklyOptions,after.weeklyOptions))stop('SETTINGS_OR_TOMBSTONES_CHANGED');
 const expect=cp(before.records);
 for(const id of ids){
  if(!expect[id]||!after.records[id]||!iso(after.records[id].rankUpdatedAt))stop('RANKED_ITEM_MISSING');
  expect[id].myRankOrder=orders[id];expect[id].rankUpdatedAt=after.records[id].rankUpdatedAt;
 }
 if(!equalState(expect,after.records))stop('UNRELATED_FIELD_CHANGED');
};
export class V365ReviewedRankBoundary{
 #pending=false;#uncertain=false;#staged=false;
 constructor({ops,app,readSaved,commitSaved,clock=()=>new Date().toISOString()}={}){
  if(!(ops instanceof V354ReviewedGeneralOps)||!(app instanceof LocalStorageAppParts)||ops.app!==app||ops.boundary?.journal?.store?.dbName!==V353_DB||!equalState(app.keys,V353_STORAGE_KEYS)||typeof readSaved!=='function'||typeof commitSaved!=='function')stop('FOREIGN_WAL_CONTEXT');
  this.ops=ops;this.app=app;this.readSaved=readSaved;this.commitSaved=commitSaved;this.clock=clock;
  this.rank=new V22RankedBatch({boundary:ops.boundary,app});
 }
 get uncertain(){return this.#uncertain}
 async stage({validateBase}={}){
  if(this.#pending||this.#uncertain||this.#staged)stop('STAGE_ALREADY_ATTEMPTED');
  if(typeof validateBase!=='function')stop('VALIDATE_BASE_REQUIRED');
  this.#staged=true;this.#pending=true;this.#uncertain=true;
  try{
   const before=await this.app.readAll(),snap=await this.ops.boundary.getSnapshot();
   if(!equalState(before.records,this.readSaved())||!equalState(before.records,snap.records)||!equalState(before.tombstones,snap.tombstones)||!validateBase(before))stop('BASE_NOT_REVIEWED');
   for(const id of ids)if(before.records[id]||before.tombstones[id])stop('RANK_FIXTURE_COLLISION');
   const response=await this.ops.boundary._mutate(async(current,parts)=>{
    const doc=await this.ops.boundary.journal.store.load();if(doc?.boxId!==V353_BOX)stop('FOREIGN_BOX');
    if(!equalState(parts,before)||!equalState(current.records,before.records)||!equalState(current.tombstones,before.tombstones))stop('STALE_STAGE');
    const updated=cp(current);for(const id of ids)updated.records[id]=cp(V365_RANK_FIXTURES[id]);
    audit({records:updated.records,tombstones:updated.tombstones,weeklyOptions:before.weeklyOptions});
    return {snapshot:updated,result:{kind:'synthetic-rank-fixture',allowedIds:[...ids]}};
   });
   const after=await this.app.readAll(),readback=await this.ops.boundary.getSnapshot();
   if(!equalState(readback.records,after.records)||!equalState(readback.tombstones,after.tombstones))stop('STAGE_READBACK_DIVERGED');
   const stripped=cp(after);for(const id of ids){if(!equalState(after.records[id],V365_RANK_FIXTURES[id]))stop('UNEXPECTED_RANK_FIXTURE');delete stripped.records[id]}
   if(!equalState(stripped,before))stop('STAGE_MUTATED_OTHER_FIELDS');
   this.commitSaved(cp(after.records));this.#uncertain=false;
   return response;
  }finally{this.#pending=false}
 }
 async #move(kind,{id,direction,draggedId,targetId}={}){
  if(this.#pending||this.#uncertain)stop('IN_FLIGHT_OR_UNCERTAIN');
  const before=await this.app.readAll(),current=await this.ops.boundary.getSnapshot();
  if(!equalState(before.records,this.readSaved())||!equalState(before.records,current.records)||!equalState(before.tombstones,current.tombstones))stop('UI_WAL_DIVERGENCE');
  for(const k of ids)if(!before.records[k]||before.tombstones[k]||before.records[k].status!=='watched'||before.records[k].review?.overall!==4||!Number.isInteger(before.records[k].myRankOrder))stop('NO_RANK_GROUP');
  if(Object.values(before.records).some(r=>r?.status==='watched'&&r.review?.overall===4&&!ids.includes(r.id)))stop('OUTSIDE_RATED_GROUP');
  const sorted=ids.slice().sort((a,b)=>before.records[a].myRankOrder-before.records[b].myRankOrder);
  if(!equalState(sorted.map(x=>before.records[x].myRankOrder),[0,1]))stop('NONCONTIGUOUS_ORDER');
  let source,toIndex;
  if(kind==='direction'){
   if(!ids.includes(id)||![-1,1].includes(direction))stop('UNREVIEWED_DIRECTION');
   source=id;toIndex=sorted.indexOf(id)+direction;
  }else{
   if(!ids.includes(draggedId)||!ids.includes(targetId)||draggedId===targetId)stop('UNREVIEWED_DROP');
   source=draggedId;toIndex=sorted.indexOf(targetId);
  }
  if(toIndex<0||toIndex>=sorted.length||toIndex===sorted.indexOf(source))stop('NOOP_OR_GROUP_ESCAPE');
  const at=this.clock();if(!iso(at))stop('INVALID_CLOCK');
  this.#pending=true;this.#uncertain=true;
  try{
   const ticket=await this.rank.previewMove({id:source,toIndex,at});
   await this.rank.commit(ticket,{confirmed:true}); // fixed synthetic test action ONLY
   const after=await this.app.readAll(),readback=await this.ops.boundary.getSnapshot();
   if(!equalState(after.records,readback.records)||!equalState(after.tombstones,readback.tombstones))stop('RANK_ACK_NOT_VERIFIED');
   const expected=sorted.slice();expected.splice(sorted.indexOf(source),1);expected.splice(toIndex,0,source);
   const orders=Object.fromEntries(expected.map((k,i)=>[k,i]));
   baseAfter(before,after,orders);
   for(const id of ids)if(after.records[id].rankUpdatedAt!==at)stop('RANK_TIMESTAMP_MISMATCH');
   audit(after);
   this.commitSaved(cp(after.records));this.#uncertain=false;
   return {result:'RANK_WAL_READBACK_VERIFIED',kind,rankPair:ids.map(id=>({id,rank:after.records[id].myRankOrder}))};
  }finally{this.#pending=false}
 }
 async direction(args){return this.#move('direction',args)}
 async drop(args){return this.#move('drop',args)}
}
