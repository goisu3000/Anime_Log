/* ANI:LOG v0.9 POC. Strict, isolated adapter between legacy persisted-draft
 * operations and the v0.8 durable write gateway. No production I/O.
 * This DOES NOT patch ANI:LOG; callers must supply an explicit intent, exact
 * before/after record maps and a TEST-v08 IsolatedWriteBoundary instance.
 */
import {equalState,RecoveryBlocked} from './durable-journal.mjs';
const own=(x,k)=>Object.hasOwn(x,k);
const cp=structuredClone;
const BLOCK=x=>new RecoveryBlocked('legacy operation gate: '+x);
const fieldsByIntent={
 status:new Set(['status','updatedAt','completedOn','nextWatchPinnedAt','nextWatchUpdatedAt']),
 progress:new Set(['watchedEpisodes','updatedAt']),
 review:new Set(['review','reviewDeletedAt','note','updatedAt']),
 note:new Set(['note','noteDeletedAt']),
 completion:new Set(['completedOn','updatedAt']),
 pin:new Set(['nextWatchPinnedAt','nextWatchUpdatedAt']),
 'weekly-schedule':new Set(['weeklySchedule']),
 stream:new Set(['streamPreference']),
 ranking:new Set(['myRankOrder','rankUpdatedAt']),
 analysis:new Set(['analysisMeta'])
};
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=150&&!['__proto__','constructor','prototype'].includes(x);
function validMap(x){if(!x||typeof x!=='object'||Array.isArray(x))throw BLOCK('record map required');for(const [id,r] of Object.entries(x))if(!validId(id)||!r||r.id!==id)throw BLOCK('invalid record identity: '+id)}
function difference(a,b){return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!equalState(a[k]??null,b[k]??null))}
function changedFields(a,b){return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!equalState(a[k],b[k]))}
export class LegacyOperationGate{
 constructor({boundary,app}={}){if(!boundary||!app||typeof boundary.getSnapshot!=='function')throw Error('isolated boundary and app required');this.boundary=boundary;this.app=app}
 async commit({before,draft,intent}={}){
  validMap(before);validMap(draft);
  if(!intent||!validId(intent.id)||typeof intent.kind!=='string')throw BLOCK('explicit operation intent required');
  if(intent.kind==='backup-replace'||intent.kind==='backup-merge')throw BLOCK('bulk backup changes require separate atomic review');
  const changed=difference(before,draft);
  if(changed.length===0)return {status:'unchanged'};
  if(changed.length!==1||changed[0]!==intent.id)throw BLOCK('only one declared work may change');
  const id=intent.id,old=before[id],newer=draft[id];
  if(intent.kind==='create'){
   if(old||!newer)throw BLOCK('create must add exactly one new work');
   return this.boundary.createRecord(cp(newer));
  }
  if(intent.kind==='delete'){
   if(!old||newer||typeof intent.deletedAt!=='string')throw BLOCK('delete requires explicit timestamp and existing record');
   const current=(await this.app.readAll()).records[id];
   if(!equalState(current,old))throw BLOCK('stale delete; original changed');
   return this.boundary.deleteRecord(id,intent.deletedAt);
  }
  if(intent.kind==='undo-delete'){
   if(old||!newer||!intent.expectedTombstone)throw BLOCK('undo-delete must restore a tombstoned record');
   return this.boundary.undoDelete({id,previous:cp(newer),expectedTombstone:cp(intent.expectedTombstone)});
  }
  if(intent.kind==='undo-edit'){
   if(!old||!newer)throw BLOCK('undo-edit requires before and after record');
   return this.boundary.undoEdit({id,expectedCurrent:cp(old),previous:cp(newer)});
  }
  const allowed=fieldsByIntent[intent.kind];
  if(!allowed||!old||!newer)throw BLOCK('unsupported edit kind or invalid edit');
  const changedColumns=changedFields(old,newer);
  if(changedColumns.some(key=>!allowed.has(key)))throw BLOCK('edit altered unrelated fields: '+changedColumns.filter(k=>!allowed.has(k)).join(','));
  // Legacy review.save may carry an old review.comment into note on first
  // standalone review edit. This is allowed ONLY when provably derived from
  // the previously saved comment. Otherwise reject cross-field note edits.
  if(intent.kind==='review'&&changedColumns.includes('note')){
   const oldComment=old.review?.comment;
   const text=newer.note?.text;
   const timestamp=newer.note?.updatedAt;
   if(old.note||old.noteDeletedAt||typeof oldComment!=='string'||!oldComment||text!==oldComment||timestamp!==old.review?.updatedAt)
    throw BLOCK('review cannot create unrelated note');
  }
  // The completion date may be auto-filled only when the explicit +1-finale
  // UI path already proved its origin. Normal status changes cannot add it.
  if(intent.kind==='status'&&old.status==='watching'&&newer.status==='watched'&&
     !old.completedOn&&newer.completedOn&&intent.fromFinalPlusOne!==true)
   throw BLOCK('completion date lacks explicit plus-one provenance');
  return this.boundary.changeRecord(id,current=>{
   if(!equalState(current,old))throw BLOCK('stale edit: records changed since operation began');
   return cp(newer);
  });
 }
 async readRecords(){return cp((await this.app.readAll()).records)}
 async setWeeklyStatuses(statuses){return this.boundary.setWeeklyStatuses(statuses)}
 async setDeviceWeeklyOpen(open){return this.boundary.setDeviceOnlyWeeklyOpen(open)}
 async syncEnabled(){return false} // fail closed: no production HTML wiring or server connection.
}
