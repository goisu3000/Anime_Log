/* ANI:LOG v3.54: type-scoped GENERAL-SHAPED ID operations on the EXISTING
 * v3.53 ISOLATED synthetic WAL. Not a production adapter. No IO on import.
 * Does not change the v2.4.61 candidate, its 15 legacy writes or real data.
 */
import {classifyV351Id,inspectV351MigrationInput} from './v351-readonly-general-id-preflight.mjs';
import {V353_STORAGE_KEYS,V353_DB,V353_BOX} from './v353-browser-mixed-id-test-only.mjs';
import {LocalStorageAppParts,equalState,RecoveryBlocked} from './durable-journal.mjs';
import {IsolatedWriteBoundary} from './isolated-write-boundary.mjs';
import {markDeleted,reAdd} from '../sync-core.mjs';

const copy=structuredClone;
const own=(o,k)=>Object.hasOwn(o,k);
const fail=why=>{throw new RecoveryBlocked('V354_TEST_ONLY_BLOCKED:'+why)};
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
// Date.parse accepts invalid days on some engines; require canonical ISO date.
const timestamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;
const kindOf=id=>classifyV351Id(id);
const reviewed=id=>typeof id==='string'&&['jikan','legacyCustom'].includes(kindOf(id));
const readonly=extra=>Object.freeze({mode:'SYNC_OFF',testOnly:true,canDeploy:false,canEnableSync:false,canImportRealRecords:false,...extra});
function preflight(parts){
 const report=inspectV351MigrationInput({recordsRaw:JSON.stringify(parts.records),tombstonesRaw:JSON.stringify(parts.tombstones),weeklyRaw:JSON.stringify(parts.weeklyOptions)});
 if(!report.eligibleForSeparateStagingReview||!report.roundtripVerified)fail('PREFLIGHT_REJECTED');
}
function verifyContext(boundary,app){
 if(!(boundary instanceof IsolatedWriteBoundary)||boundary.namespace!=='TEST-v08'||boundary.app!==app)fail('TEST_WAL_REQUIRED');
 if(!(app instanceof LocalStorageAppParts)||!Object.keys(V353_STORAGE_KEYS).every(k=>app.keys[k]===V353_STORAGE_KEYS[k])||Object.keys(app.keys).length!==3)fail('V353_DEDICATED_KEYS_REQUIRED');
 if(boundary.journal?.store?.dbName!==V353_DB)fail('V353_DEDICATED_INDEXEDDB_REQUIRED');
}
export class V354ReviewedGeneralOps{
 #receipts=new Map();
 constructor({boundary,app}={}){verifyContext(boundary,app);this.boundary=boundary;this.app=app;this.uncertain=false;this.pending=false}
 _prepare(){if(this.uncertain||this.pending)fail('UNCERTAIN_OR_IN_FLIGHT');this.pending=true;this.uncertain=true}
 async _perform({id,expected,action,updatedAt,watchedEpisodes,text,status,deletedAt,receipt}){
  if(!reviewed(id))fail('UNREVIEWED_ID');
  if(!['progress','note','status','delete','undo-delete'].includes(action))fail('UNREVIEWED_ACTION');
  if(action!=='undo-delete'&&(!plain(expected)||expected.id!==id))fail('EXPECTED_RECORD_REQUIRED');
  if(action==='progress'&&(!Number.isInteger(watchedEpisodes)||watchedEpisodes<0||watchedEpisodes>9999||!timestamp(updatedAt)))fail('INVALID_PROGRESS');
  if(action==='note'&&(typeof text!=='string'||text.length>500||!timestamp(updatedAt)))fail('INVALID_NOTE');
  if(action==='status'&&(!['planned','watching','watched','paused','dropped'].includes(status)||!timestamp(updatedAt)))fail('INVALID_STATUS');
  if(action==='delete'&&!timestamp(deletedAt))fail('INVALID_DELETION_DATE');
  if(action==='undo-delete'&&(!plain(receipt)||receipt.id!==id||!plain(receipt.previous)||receipt.previous.id!==id||!plain(receipt.tombstone)||receipt.tombstone.id!==id||!timestamp(receipt.tombstone.deletedAt)||!Number.isSafeInteger(receipt.generation)))fail('INVALID_UNDO_RECEIPT');
  // A tombstone alone cannot prove the deleted record's prior content.
  // Undo evidence remains private to the instance that issued the delete.
  if(action==='undo-delete'&&!equalState(this.#receipts.get(id),receipt))fail('UNDO_NOT_ISSUED_IN_THIS_SESSION');
  const reviewedExpected=expected===undefined?undefined:copy(expected);
  const reviewedReceipt=receipt===undefined?undefined:copy(receipt);
  this._prepare();
  try{
   const result=await this.boundary._mutate(async(snapshot,parts)=>{
    const currentDoc=await this.boundary.journal.store.load();
    if(currentDoc?.boxId!==V353_BOX)fail('FOREIGN_WAL_BOX');
    preflight(parts);
    if(!equalState(snapshot.records,parts.records)||!equalState(snapshot.tombstones,parts.tombstones))fail('SNAPSHOT_MISMATCH');
    const existing=parts.records[id],stone=parts.tombstones[id];
    if(action==='undo-delete'){
     if(existing||!stone||!equalState(stone,reviewedReceipt.tombstone))fail('STALE_DELETE_RECEIPT');
     const state=await this.boundary.journal.status();
     if(state.generation!==reviewedReceipt.generation)fail('STALE_UNDO_GENERATION');
     const next=reAdd(snapshot,copy(reviewedReceipt.previous));
     preflight({records:next.records,tombstones:next.tombstones,weeklyOptions:parts.weeklyOptions});
     return {snapshot:next,result:{action,status:'restored'}};
    }
    if(!existing||stone||!equalState(existing,reviewedExpected))fail('STALE_OR_DELETED_RECORD');
    if(action==='delete'){
     const next=markDeleted(snapshot,id,deletedAt);
     preflight({records:next.records,tombstones:next.tombstones,weeklyOptions:parts.weeklyOptions});
     return {snapshot:next,result:{action,status:'deleted',previous:copy(existing),tombstone:copy(next.tombstones[id])}};
    }
    const next=copy(snapshot),r=copy(existing);
    if(action==='progress'){
     if(r.watchedEpisodes===watchedEpisodes)fail('UNCHANGED_PROGRESS');
     // The real ANI UI permits progress beyond a possibly stale episode total.
     r.watchedEpisodes=watchedEpisodes;r.updatedAt=updatedAt;
    }else if(action==='note'){
     const cleanText=text.trim();
     if(cleanText){
      if(r.note?.text===cleanText&&!r.noteDeletedAt)fail('UNCHANGED_NOTE');
      r.note={text:cleanText,updatedAt};delete r.noteDeletedAt;
     }else{
      delete r.note;r.noteDeletedAt=updatedAt;
     }
    }else{
     if(r.status===status)fail('UNCHANGED_STATUS');
     r.status=status;r.updatedAt=updatedAt;
     if(status!=='planned'&&own(r,'nextWatchPinnedAt')){delete r.nextWatchPinnedAt;r.nextWatchUpdatedAt=updatedAt;}
    }
    next.records[id]=r;
    preflight({records:next.records,tombstones:next.tombstones,weeklyOptions:parts.weeklyOptions});
    return {snapshot:next,result:{action,status:'edited',expectedNext:copy(r)}};
   });
   // Verify after WAL ACK/readback. Another writer racing between operations
   // can only result in STOP, never a blind retry or silent overwrite.
   const after=await this.boundary.getSnapshot();const parts=await this.app.readAll();
   if(!equalState(after.records,parts.records)||!equalState(after.tombstones,parts.tombstones))fail('READBACK_MISMATCH');
   preflight(parts);
   if(action==='delete'){
    if(own(after.records,id)||!equalState(after.tombstones[id],result.tombstone))fail('DELETE_READBACK_MISMATCH');
    const state=await this.boundary.status();
    const freshReceipt=copy({id,previous:result.previous,tombstone:result.tombstone,generation:state.generation});
    this.#receipts.set(id,copy(freshReceipt));this.uncertain=false;
    return readonly({action,receipt:freshReceipt});
   }
   if(action==='undo-delete'){
    if(!equalState(after.records[id],reviewedReceipt.previous)||own(after.tombstones,id))fail('UNDO_READBACK_MISMATCH');
   }else if(!equalState(after.records[id],result.expectedNext))fail('EDIT_READBACK_MISMATCH');
   if(action==='undo-delete')this.#receipts.delete(id);
   this.uncertain=false;return readonly({action,result:'WAL_READBACK_VERIFIED'});
  }finally{this.pending=false}
 }
 setProgress({id,expected,watchedEpisodes,updatedAt}){return this._perform({action:'progress',id,expected,watchedEpisodes,updatedAt})}
 saveNote({id,expected,text,updatedAt}){return this._perform({action:'note',id,expected,text,updatedAt})}
 changeStatus({id,expected,status,updatedAt}){return this._perform({action:'status',id,expected,status,updatedAt})}
 deleteRecord({id,expected,deletedAt}){return this._perform({action:'delete',id,expected,deletedAt})}
 undoDelete({id,receipt}){return this._perform({action:'undo-delete',id,receipt})}
 status(){return readonly({uncertain:this.uncertain,pending:this.pending})}
}
