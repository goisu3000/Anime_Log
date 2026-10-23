/* v2.2: strict multi-work ranking proposal for the isolated v1.0 WAL gate.
 * Does not edit the actual ANI:LOG UI/HTML. A real UI must await a durable
 * commit before replacing its committed in-memory records.
 */
import {ReviewedBatchGate} from './reviewed-batch-gate.mjs';
import {RecoveryBlocked} from './durable-journal.mjs';
const cp=structuredClone;
const fail=s=>{throw new RecoveryBlocked('v2.2 ranking: '+s)};
const season=Object.freeze({winter:1,spring:2,summer:3,fall:4});
const rankOf=r=>Number.isInteger(r?.myRankOrder)&&r.myRankOrder>=0?r.myRankOrder:999999;
const groupMembers=(records,rating)=>Object.values(records).filter(r=>r?.status==='watched'&&r.review?.overall===rating&&Number.isInteger(r.review?.overall)&&r.review.overall>=1&&r.review.overall<=5).sort((a,b)=>rankOf(a)-rankOf(b)||((b.year??-1)-(a.year??-1))||(season[b.season]||0)-(season[a.season]||0)||String(a.title).localeCompare(String(b.title),'ja'));
export class V22RankedBatch{
 constructor({boundary,app}={}){this.app=app;this.gate=new ReviewedBatchGate({boundary,app});}
 async previewMove({id,toIndex,at}={}){
  if(typeof id!=='string'||!Number.isInteger(toIndex)||typeof at!=='string'||!Number.isFinite(Date.parse(at)))fail('invalid move parameters');
  const before=cp((await this.app.readAll()).records);
  const item=before[id],rating=item?.review?.overall;
  if(item?.status!=='watched'||!Number.isInteger(rating)||rating<1||rating>5)fail('work must be personally rated and watched');
  const group=groupMembers(before,rating);
  const from=group.findIndex(r=>r.id===id);
  if(group.length<2||from<0||toIndex<0||toIndex>=group.length||toIndex===from)fail('move must change position within rating group');
  const ordered=group.map(r=>r.id);
  ordered.splice(from,1);ordered.splice(toIndex,0,id);
  const after=cp(before);
  for(const [i,recordId] of ordered.entries()){
   after[recordId].myRankOrder=i;
   after[recordId].rankUpdatedAt=at;
  }
  return this.gate.preview({kind:'rank-reorder',before,draft:after,sourceIds:group.map(r=>r.id),groupRating:rating});
 }
 commit(ticket,{confirmed=false}={}){return this.gate.commit(ticket,{confirmed})}
}
