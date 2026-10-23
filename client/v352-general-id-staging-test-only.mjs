/* ANI:LOG v3.52 | Synthetic-only mixed general-ID staging to EXISTING v0.8 WAL.
 * NO browser/production storage auto-discovery, no sync, no real data migration.
 * A caller must supply an already INITIALIZED, EMPTY, TEST-v08 boundary.
 * Does not relax the fixed-ID v2.6 test adapter or touch its existing code.
 */
import {inspectV351MigrationInput,classifyV351Id} from './v351-readonly-general-id-preflight.mjs';
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {equalState,MemoryAppParts,LocalStorageAppParts,RecoveryBlocked} from './durable-journal.mjs';
import {markDeleted,reAdd} from '../sync-core.mjs';

const cp=structuredClone,has=(o,k)=>Object.hasOwn(o,k);
const deny=x=>{throw new RecoveryBlocked('V352_SYNTHETIC_ONLY_BLOCKED:'+x)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const iso=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x)&&Number.isFinite(Date.parse(x));
const validId=id=>['jikan','legacyCustom'].includes(classifyV351Id(id));
const EQUAL=(a,b)=>equalState(a,b);
const differs=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!EQUAL(a[k],b[k]));
const canStage=source=>{
 const audit=inspectV351MigrationInput(source);
 if(!audit.eligibleForSeparateStagingReview||!audit.roundtripVerified)deny('SOURCE_PREFLIGHT_REJECTED');
 if(audit.recordCount+audit.tombstoneCount===0)deny('EMPTY_SOURCE_UNNECESSARY');
 // The preflight parser has already rejected duplicate JSON properties; parse
 // only after this check and validate every subsequent state separately.
 const records=JSON.parse(source.recordsRaw),tombstones=JSON.parse(source.tombstonesRaw),weeklyOptions=JSON.parse(source.weeklyRaw);
 if(Object.keys(weeklyOptions).sort().join(',')!=='open,statuses')deny('UNSUPPORTED_DEVICE_WEEKLY_METADATA');
 return {records,tombstones,weeklyOptions};
};
function checkParts(parts){
 const check=inspectV351MigrationInput({recordsRaw:JSON.stringify(parts.records),tombstonesRaw:JSON.stringify(parts.tombstones),weeklyRaw:JSON.stringify(parts.weeklyOptions)});
 if(!check.eligibleForSeparateStagingReview)deny('STATE_INVALID');
 return check;
}
function verifyBoundary(boundary,app){
 if(boundary?.namespace!=='TEST-v08'||!boundary.journal||boundary.app!==app||typeof boundary._mutate!=='function')deny('TEST_BOUNDARY_REQUIRED');
 if(app instanceof MemoryAppParts)return;
 if(!(app instanceof LocalStorageAppParts)||!app.keys||
    Object.keys(app.keys).sort().join(',')!=='records,tombstones,weeklyOptions'||
    Object.values(app.keys).some(k=>typeof k!=='string'||!k.startsWith('__anilog_v352_SYNTHETIC_ONLY__:')))
   deny('DEDICATED_TEST_STORAGE_REQUIRED');
}
function assertPristine(snapshot,state,weekly){
 if(Object.keys(snapshot.records).length||Object.keys(snapshot.tombstones).length)deny('DESTINATION_NOT_EMPTY');
 if(!EQUAL(state.baseline,state.desired)||state.revision!==0)deny('DESTINATION_NOT_PRISTINE');
 // Device-local open flag must never be silently changed from local preference.
 if(!plain(weekly)||typeof weekly.open!=='boolean')deny('DESTINATION_WEEKLY_INVALID');
}
const readonlyReceipt=(kind,additional={})=>Object.freeze({kind,mode:'SYNC_OFF',scope:'SYNTHETIC_ONLY',canDeploy:false,canImportRealRecords:false,canEnableSync:false,...additional});

export class V352GeneralIdSyntheticStage {
 constructor({boundary,app}={}){
  verifyBoundary(boundary,app);this.boundary=boundary;this.app=app;this.pending=null;this.used=false;this.committed=false;this.uncertain=false;this.lastDelete=null;
 }
 async prepare(source){
  if(this.used||this.uncertain||this.pending)deny('ALREADY_PREPARED_OR_USED');
  const original=canStage(source);
  const snap=await this.boundary.getSnapshot();const status=await this.boundary.status(),parts=await this.app.readAll();
  assertPristine(snap,status,parts.weeklyOptions);
  if(!EQUAL(original.weeklyOptions.open,parts.weeklyOptions.open))deny('LOCAL_WEEKLY_OPEN_MISMATCH');
  const desired=appToSnapshot(original);
  const rebuilt=snapshotToApp(desired,{weeklyOptions:original.weeklyOptions});
  if(!EQUAL(rebuilt,original))deny('LOSSLESS_ROUNDTRIP_FAILED');
  const ticket=Object.freeze({summary:readonlyReceipt('SYNTHETIC_STAGE_PREVIEW',{
   records:Object.keys(original.records).length,tombstones:Object.keys(original.tombstones).length,
   needsConfirmation:true,stageAllowedOnlyIntoEmptyTestWAL:true})});
  this.pending={ticket,original:cp(original),desired:cp(desired),initial:cp(snap),initialWeekly:cp(parts.weeklyOptions)};
  return ticket;
 }
 async commit(ticket,{confirmed=false,confirmationText=''}={}){
  const pending=this.pending;this.pending=null;this.used=true;
  if(!pending||ticket!==pending.ticket||confirmed!==true||confirmationText!=='架空データ専用の空WALに保存')deny('CONFIRMATION_REQUIRED');
  this.uncertain=true; // Any failure (including unknown ACK) forbids retry.
  const result=await this.boundary._mutate(async(current,parts)=>{
   const c=await this.boundary.journal.current();
   assertPristine(current,c,parts.weeklyOptions);
   if(!EQUAL(current,pending.initial)||!EQUAL(parts.weeklyOptions,pending.initialWeekly))deny('DESTINATION_CHANGED_SINCE_PREVIEW');
   return {snapshot:cp(pending.desired),result:{status:'STAGED_AWAITING_READBACK'}};
  });
  if(result.status!=='STAGED_AWAITING_READBACK')deny('UNEXPECTED_WAL_RESULT');
  const after=await this.boundary.getSnapshot(),parts=await this.app.readAll();
  if(!EQUAL(after,pending.desired)||!EQUAL(parts,pending.original))deny('INCOMPLETE_READBACK');
  const status=await this.boundary.status();
  if(status.revision!==0||status.dirty!==true)deny('UNEXPECTED_WAL_STATUS');
  this.uncertain=false;this.committed=true;
  return readonlyReceipt('SYNTHETIC_STAGE_COMMITTED_READBACK_VERIFIED',{
   records:Object.keys(parts.records).length,tombstones:Object.keys(parts.tombstones).length,dirty:true});
 }
 async edit({before,draft,intent}={}){
  if(!this.committed||this.uncertain||this.pending)deny('NOT_READY');
  if(!plain(before)||!plain(draft)||!plain(intent)||!validId(intent.id))deny('INVALID_EDIT_INPUT');
  const {id,kind}=intent;
  if(!['progress','note','status','delete','undo-delete'].includes(kind))deny('UNREVIEWED_OPERATION');
  const changed=differs(before,draft);
  if(changed.length!==1||changed[0]!==id)deny('UNDECLARED_RECORD_CHANGE');
  const old=before[id],next=draft[id];
  if(kind==='delete'){
   if(!plain(old)||next!==undefined||!iso(intent.deletedAt)||this.lastDelete)deny('DELETE_INVALID');
  }else if(kind==='undo-delete'){
   if(old!==undefined||!plain(next)||!this.lastDelete||id!==this.lastDelete.id||!EQUAL(intent.expectedTombstone,this.lastDelete.tombstone)||!EQUAL(next,this.lastDelete.previous))deny('UNDO_RECEIPT_INVALID');
  }else{
   if(!plain(old)||!plain(next)||next.id!==id)deny('EDIT_RECORD_INVALID');
   const fields=differs(old,next),expected=kind==='progress'?['watchedEpisodes','updatedAt']:kind==='note'?['note','noteDeletedAt']:['status','updatedAt'];
   if(fields.length<1||fields.some(x=>!expected.includes(x)))deny('EDIT_FIELD_SCOPE');
   if(kind==='progress'&&(!fields.includes('watchedEpisodes')||!fields.includes('updatedAt')||!iso(next.updatedAt)))deny('PROGRESS_INVALID');
   if(kind==='note'){
    if(next.note===undefined){if(!iso(next.noteDeletedAt)||old.note===undefined)deny('NOTE_DELETE_INVALID')}
    else if(!plain(next.note)||typeof next.note.text!=='string'||next.note.text.length>500||!iso(next.note.updatedAt)||next.noteDeletedAt!==undefined)deny('NOTE_INVALID');
   }
   if(kind==='status'&&(!fields.includes('status')||!fields.includes('updatedAt')||!iso(next.updatedAt)||old.status===next.status))deny('STATUS_INVALID');
  }
  // In-memory check is NOT sufficient for commit; _mutate rechecks the entire
  // persisted map/tombstone inside the same exclusive lock.
  this.uncertain=true;
  const receipt=await this.boundary._mutate(async(snapshot,parts)=>{
   const existing=parts.records;
   if(!EQUAL(existing,before))deny('STALE_RECORD_MAP');
   if(!EQUAL(snapshot.records,before))deny('STALE_SNAPSHOT');
   const target=cp(snapshot);
   if(kind==='delete'){
    if(has(target.tombstones,id))deny('EXISTING_TOMBSTONE');
    const changed=markDeleted(target,id,intent.deletedAt);
    checkParts(snapshotToApp(changed,{weeklyOptions:parts.weeklyOptions}));
    return {snapshot:changed,result:{status:'deleted',previous:cp(old),tombstone:cp(changed.tombstones[id])}};
   }
   if(kind==='undo-delete'){
    if(!EQUAL(target.tombstones[id],this.lastDelete.tombstone)||has(target.records,id))deny('STALE_TOMBSTONE');
    const changed=reAdd(target,cp(next));
    checkParts(snapshotToApp(changed,{weeklyOptions:parts.weeklyOptions}));
    return {snapshot:changed,result:{status:'restored'}};
   }
   target.records[id]=cp(next);
   checkParts(snapshotToApp(target,{weeklyOptions:parts.weeklyOptions}));
   return {snapshot:target,result:{status:'edited'}};
  });
  const snapshot=await this.boundary.getSnapshot();const parts=await this.app.readAll();
  if(!EQUAL(snapshot.records,draft)||!EQUAL(parts.records,draft))deny('EDIT_READBACK_MISMATCH');
  checkParts(parts);
  if(kind==='delete'){
   if(!EQUAL(parts.tombstones[id],receipt.tombstone))deny('TOMBSTONE_READBACK_MISMATCH');
   this.lastDelete=Object.freeze({id,previous:cp(receipt.previous),tombstone:cp(receipt.tombstone)});
  }else if(kind==='undo-delete'){
   if(has(parts.tombstones,id))deny('UNDO_TOMBSTONE_STILL_PRESENT');
   this.lastDelete=null;
  }
  this.uncertain=false;
  return readonlyReceipt('SYNTHETIC_EDIT_READBACK_VERIFIED',{operation:kind});
 }
 getBlockedStatus(){return readonlyReceipt('TEST_ONLY_GATE_STATUS',{uncertain:this.uncertain,staged:this.committed&&!this.uncertain})}
 getUndoReceipt(){return this.lastDelete?cp(this.lastDelete):null}
}
