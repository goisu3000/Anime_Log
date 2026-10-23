/* Formal ANI development copy only. No implicit legacy storage or network I/O.
 * Existing encrypted WAL is authoritative; cache/device preferences stay local.
 */
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {assertMixedMap,assertMixedTombstones} from './v29-mixed-record-gate.mjs';
import {parseLosslessObject} from './v351-readonly-general-id-preflight.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';
import {digestText} from '../shared/registration-ticket.mjs';
import {mergeSnapshots} from '../sync-core.mjs';
const cp=structuredClone;
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b);
const stop=why=>{throw Error('FORMAL_STORAGE_STOP:'+why)};
export function validateFormalApp(app){
 assertMixedMap(app.records);assertMixedTombstones(app.tombstones,app.records);
 if(typeof app.weeklyOptions?.open!=='boolean')stop('WEEKLY_REQUIRED');
 const roundtrip=snapshotToApp(appToSnapshot(app),{weeklyOptions:app.weeklyOptions});
 if(!same(app,roundtrip))stop('LOSSLESS_ROUNDTRIP_REQUIRED');
 return cp(app);
}
// Explicitly supplied frozen copy, never a read from the running user's origin.
export function freezeLegacyCopy({recordsRaw,weeklyRaw,tombstonesRaw=null,allowEmptySource=false}){
 // Missing legacy preference key means ANI's original default, not corrupt data.
 // Keep weeklyRaw:null in the preserved raw evidence; do not invent a source value.
 const records=recordsRaw===null&&allowEmptySource===true?{}:parseLosslessObject(recordsRaw),weeklyOptions=weeklyRaw===null?{open:false,statuses:['watching']}:parseLosslessObject(weeklyRaw);
 const tombstones=tombstonesRaw===null?{}:parseLosslessObject(tombstonesRaw);
 const app=validateFormalApp({records,tombstones,weeklyOptions});
 app.weeklyOptions.__migration={history:tombstonesRaw===null?'unknown':'provided',
  weeklySource:weeklyRaw===null?'missing-legacy-default':'provided',
  raw:{recordsRaw,weeklyRaw,tombstonesRaw}};
 return JSON.stringify(app);
}
export function captureLegacyCopy(storage,{recordsKey='anilog-v1',weeklyKey='anilog-weekly-options-v1',tombstonesKey=null,allowEmptySource=false}={}){
 if(typeof storage?.getItem!=='function')stop('EXPLICIT_SOURCE_REQUIRED');
 const sources={recordsRaw:storage.getItem(recordsKey),weeklyRaw:storage.getItem(weeklyKey),
  tombstonesRaw:tombstonesKey===null?null:storage.getItem(tombstonesKey)};
 if(sources.recordsRaw===null&&allowEmptySource===true)sources.allowEmptySource=true;
 if(sources.recordsRaw!==storage.getItem(recordsKey)||sources.weeklyRaw!==storage.getItem(weeklyKey)||
  (tombstonesKey!==null&&sources.tombstonesRaw!==storage.getItem(tombstonesKey)))stop('SOURCE_CHANGED_DURING_CAPTURE');
 freezeLegacyCopy(sources); // Strictly validate before producing a portable copy.
 return JSON.stringify({app:'ANI:LOG',format:'legacy-storage-frozen-copy',sources});
}
export function decodeFormalBackup(raw){
 const dump=typeof raw==='string'?parseLosslessObject(raw):parseLosslessObject(JSON.stringify(raw));
 if(dump.app!=='ANI:LOG')stop('BACKUP_APP');
 if(dump.format==='legacy-storage-frozen-copy')return parseLosslessObject(freezeLegacyCopy(dump.sources));
 if([4,5].includes(dump.version)&&dump.format==='encrypted-primary-portable'){
  const app=validateFormalApp(dump.state);
  if(dump.items!==undefined&&!same(dump.items,Object.values(app.records)))stop('BACKUP_ALIAS_MISMATCH');
  if(dump.weeklyOptions!==undefined&&!same(dump.weeklyOptions,app.weeklyOptions))stop('BACKUP_ALIAS_MISMATCH');
  return app;
 }
 if(dump.version!==4||!Array.isArray(dump.items))stop('BACKUP_FORMAT');
 const records=Object.create(null);
 for(const record of dump.items){
  if(!record||typeof record.id!=='string'||Object.hasOwn(records,record.id))stop('DUPLICATE_OR_INVALID_ID');
  records[record.id]=cp(record);
 }
 const app=validateFormalApp({records,tombstones:{},weeklyOptions:dump.weeklyOptions});
 // Absence of historical deletions is not evidence that there were none.
 app.weeklyOptions.__migration={history:'unknown',legacyBackup:cp(dump)};
 return app;
}
export function createFormalStorage({vault,independentVault,now=()=>new Date().toISOString(),onCommitted=()=>{}}={}){
 let active=false,busy=false,undo=null,refreshPending=null;
 const guard=()=>{if(!active||vault.getState()!=='ACTIVE')stop('UNLOCK_REQUIRED')};
 const transaction=async fn=>{guard();if(busy)stop('BUSY');busy=true;try{return await fn()}finally{busy=false}};
 // A pending network acknowledgement is not a reason to disable local saves.
 // The immutable lineage still prevents connecting these edits to another box.
 const editable=()=>guard();
 const read=()=>{guard();return cp(vault.readCurrent())};
 const commit=async candidate=>{
  validateFormalApp(candidate);const revision=vault.readRevision();
  try{
   await vault.commitApp({candidate,expectedRevision:revision});
   if(!same(vault.readCurrent(),candidate)||vault.readRevision()!==revision+1)stop('COMMIT_READBACK');
  }catch(error){active=false;throw error}
  const result=read();
  // Scheduling failure must never undo or report failure for a durable save.
  try{onCommitted()}catch{}
  return result;
 };
 return Object.freeze({
  get ready(){return active&&vault.getState()==='ACTIVE'},read,
  // Browsers can emit visibilitychange and focus for the same foreground
  // transition. Share that read instead of reporting our own read as BUSY.
  // Writes still use the existing exclusive transaction and failure guard.
  refresh(){
   if(refreshPending)return refreshPending;
   refreshPending=transaction(async()=>{const revision=vault.readRevision(),result=await vault.refresh();if(vault.readRevision()!==revision)undo=null;return result})
    .finally(()=>{refreshPending=null});
   return refreshPending;
  },
  async initializeFrozen(frozen,passphrase){
   if(active||busy)stop('ALREADY_ACTIVE');busy=true;
   try{
    if(typeof independentVault!=='function')stop('INDEPENDENT_READBACK_REQUIRED');
    const candidate=validateFormalApp(parseLosslessObject(frozen));
    if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')stop('DESTINATION_NOT_EMPTY');
    await vault.initialize(candidate,passphrase);
    const check=independentVault();await check.unlock(passphrase);
    if(!same(check.readCurrent(),candidate)||check.readRevision()!==0)stop('INDEPENDENT_READBACK_FAILED');
    active=true;return read();
   }finally{busy=false}
  },
  async unlock(passphrase){
   if(active||busy)stop('ALREADY_ACTIVE');busy=true;
   try{await vault.unlock(passphrase);validateFormalApp(vault.readCurrent());active=true;return read()}
   finally{busy=false}
  },
  // Pairing/first receive already performed the authenticated encrypted readback.
  attachVerified(){validateFormalApp(vault.readCurrent());if(!vault.readSyncCheckpoint())stop('CHECKPOINT_REQUIRED');active=true;return read()},
  saveRecords({base,draft,kind='edit'}={}){return transaction(async()=>{
   editable();
   const current=read();if(!same(base,current.records))stop('STALE_UI');assertMixedMap(draft);
   if(same(draft,current.records))return current;
   const candidate=cp(current);candidate.records=cp(draft);
   const isUndo=kind==='undo'&&undo&&undo.revision===vault.readRevision()&&same(undo.after,current.records)&&same(undo.before,draft);
   if(kind==='undo'&&!isUndo)stop('STALE_UNDO');
   for(const id of Object.keys(current.records))if(!draft[id])candidate.tombstones[id]={id,deletedAt:now()};
   for(const id of Object.keys(draft))if(current.tombstones[id]){
    if(!isUndo)stop('TOMBSTONE_RESURRECTION');delete candidate.tombstones[id];
   }
   const result=await commit(candidate);
   undo=isUndo?null:{before:cp(current.records),after:cp(result.records),revision:vault.readRevision()};
   return result;
  })},
  saveWeekly(next){return transaction(async()=>{
   editable();
   const current=read(),candidate=cp(current);candidate.weeklyOptions={...candidate.weeklyOptions,...cp(next)};
   if(same(candidate,current))return current;
   const result=await commit(candidate);undo=null;return result;
  })},
  exportBackup(){
   const state=read();
   // Keep the existing v4 items/weekly envelope; state adds the lossless ledger.
   const raw=JSON.stringify({app:'ANI:LOG',version:4,format:'encrypted-primary-portable',exportedAt:now(),
    items:Object.values(state.records),weeklyOptions:state.weeklyOptions,state},null,2);
   if(new TextEncoder().encode(raw).length>12000000)stop('BACKUP_TOO_LARGE');
   return raw;
  },
  restoreBackup(raw,{replace=false,restoreWeekly=true}={}){return transaction(async()=>{
   editable();
   const incoming=decodeFormalBackup(raw),current=read(),candidate=cp(current);
   if(incoming.weeklyOptions.__syncLineage&&canonical(incoming.weeklyOptions.__syncLineage)!==canonical(current.weeklyOptions.__syncLineage))stop('BACKUP_LINEAGE_MISMATCH');
   // A backup is not a concurrent replica. No field is chosen by timestamp.
   for(const [id,record] of Object.entries(incoming.records)){
    if(current.tombstones[id])stop('BACKUP_RESURRECTS_DELETION');
    if(!replace&&current.records[id]&&!same(current.records[id],record))stop('BACKUP_RECORD_CONFLICT');
   }
   if(replace){candidate.records=cp(incoming.records);for(const id of Object.keys(current.records))if(!candidate.records[id])candidate.tombstones[id]=cp(incoming.tombstones[id]??{id,deletedAt:now()});}
   else Object.assign(candidate.records,cp(incoming.records));
   for(const [id,stone] of Object.entries(incoming.tombstones)){
    if(candidate.records[id])stop('BACKUP_DELETION_CONFLICT');
    if(candidate.tombstones[id]&&!same(candidate.tombstones[id],stone))stop('BACKUP_TOMBSTONE_CONFLICT');
    candidate.tombstones[id]=cp(stone);
   }
   if(restoreWeekly)candidate.weeklyOptions={...current.weeklyOptions,...cp(incoming.weeklyOptions),open:current.weeklyOptions.open};
   // A legacy backup must not upgrade unknown deletion evidence to known empty.
   if(current.weeklyOptions.__migration)candidate.weeklyOptions.__migration=cp(current.weeklyOptions.__migration);
   if(current.weeklyOptions.__syncLineage)candidate.weeklyOptions.__syncLineage=cp(current.weeklyOptions.__syncLineage);
   if(current.weeklyOptions.__registrationPending)candidate.weeklyOptions.__registrationPending=true;
   if(current.weeklyOptions.__pairingMergeApplied)candidate.weeklyOptions.__pairingMergeApplied=true;else delete candidate.weeklyOptions.__pairingMergeApplied;
   if(incoming.weeklyOptions.__migration?.history==='unknown')candidate.weeklyOptions.__migration={...candidate.weeklyOptions.__migration,history:'unknown'};
   const result=await commit(candidate);undo=null;return result;
  })},
  beginRegistration(lineage,{expectedSourceDigest}={}){return transaction(async()=>{
   const current=read();checkLineage(lineage);if(vault.readSyncCheckpoint())stop('ALREADY_CONNECTED');
   if(expectedSourceDigest&&await digestText(canonical(current))!==expectedSourceDigest)stop('SOURCE_CHANGED_BEFORE_REGISTRATION');
   if(current.weeklyOptions.__syncLineage&&canonical(current.weeklyOptions.__syncLineage)!==canonical(lineage))stop('LINEAGE_REBIND_DENIED');
   const next=cp(current);next.weeklyOptions.__syncLineage=cp(lineage);next.weeklyOptions.__registrationPending=true;
   if(same(current,next))return current;return commit(next);
  })},
  adoptInitialPairingMerge({baseline,target,boxId,api}){return transaction(async()=>{
   const current=read(),lineage=checkLineage(current.weeklyOptions.__syncLineage);
   if(vault.readSyncCheckpoint()||!current.weeklyOptions.__registrationPending||lineage.boxId!==boxId||lineage.api!==api)stop('INITIAL_PAIRING_SCOPE');
   if(current.weeklyOptions.__pairingMergeApplied)return current;
   const merged=mergeSnapshots(baseline,appToSnapshot(current),target);
   if(!merged.ok)stop('INITIAL_RECORD_CONFLICT_KEEP_BOTH_COPIES');
   const candidate=snapshotToApp(merged.merged,{weeklyOptions:current.weeklyOptions});
   candidate.weeklyOptions.__pairingMergeApplied=true;
   return commit(candidate);
  })},
  // Pairing may take time: the owner can advance the remote before this member
  // finishes. Rebase only against the last authenticated remote baseline; the
  // entire merged candidate is durably stored BEFORE any subsequent upload.
  reconcileInitialPairingRemote({baseline,remote,boxId,api,possibleAcceptedSnapshot}){return transaction(async()=>{
   const current=read(),lineage=checkLineage(current.weeklyOptions.__syncLineage);
   if(vault.readSyncCheckpoint()||!current.weeklyOptions.__registrationPending||!current.weeklyOptions.__pairingMergeApplied||
      lineage.boxId!==boxId||lineage.api!==api)stop('INITIAL_PAIRING_SCOPE');
   const merged=mergeSnapshots(baseline,appToSnapshot(current),remote);
   if(!merged.ok)stop('INITIAL_RECORD_CONFLICT_KEEP_BOTH_COPIES');
   if(possibleAcceptedSnapshot){
    // The last PUT may have succeeded before another device advanced remote.
    // Both possible histories must produce the SAME result. Otherwise even
    // a value equal to the old baseline can be an intentional owner reversal.
    const accepted=mergeSnapshots(possibleAcceptedSnapshot,appToSnapshot(current),remote);
    if(!accepted.ok||!same(accepted.merged,merged.merged))stop('INITIAL_ACK_HISTORY_AMBIGUOUS_KEEP_BOTH_COPIES');
   }
   const candidate=snapshotToApp(merged.merged,{weeklyOptions:current.weeklyOptions});
   if(same(candidate,current))return current;
   return commit(candidate);
  })},
  completeRegistration({boxId,api}){return transaction(async()=>{
   const current=read(),lineage=checkLineage(current.weeklyOptions.__syncLineage);
   if(!vault.readSyncCheckpoint()||lineage.boxId!==boxId||lineage.api!==api)stop('CONFIRMED_LINEAGE_REQUIRED');
   const next=cp(current);delete next.weeklyOptions.__registrationPending;delete next.weeklyOptions.__pairingMergeApplied;if(same(current,next))return current;return commit(next);
  })},
  assertSyncHistory(connection){guard();const state=read();
   if(state.weeklyOptions.__registrationPending)stop('REGISTRATION_PENDING_KEEP_LOCAL_DATA');
   if(state.weeklyOptions.__syncLineage){const line=checkLineage(state.weeklyOptions.__syncLineage);
    if(!connection||connection.boxId!==line.boxId||connection.api!==line.api)stop('LINEAGE_CONNECTION_REQUIRED');return}
   if(state.weeklyOptions.__migration?.history==='unknown')stop('HISTORICAL_DELETIONS_UNCONFIRMED')}
 });
}
