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
// Phase 4N, private opt-in: a single-realm foreground/maintenance gate.
// A reservation is synchronous (no await between checking and reserving).
// This is NOT a cross-tab lock, and must not be used alone as proof of
// remote-sync safety or as production authorization.
export function createPrivateQuiescentOperationGate(){
 let foreground=0,waiting=0,maintenance=null;
 function tryReserveMaintenance(){
  if(maintenance||foreground||waiting)return null;
  let releaseSignal;
  const done=new Promise(resolve=>{releaseSignal=resolve});
  const ticket={done};maintenance=ticket;
  let released=false;
  return Object.freeze({
   hasForegroundWaiters:()=>waiting>0,
   release(){if(released)return;released=true;if(maintenance===ticket)maintenance=null;releaseSignal()}
  });
 }
 async function withForeground(fn){
  if(typeof fn!=='function')throw Error('OPERATION_REQUIRED');
  // Include arrivals during the anchor staging window in the waiters count.
  waiting++;
  let reserved=false;
  try{
   while(maintenance)await maintenance.done;
   waiting--;reserved=true;foreground++;
   try{return await fn()}finally{foreground--}
  }finally{if(!reserved)waiting--}
 }
 return Object.freeze({tryReserveMaintenance,withForeground,
  inspect:()=>Object.freeze({foreground,waiting,maintenance:!!maintenance})});
}
export function createFormalStorage({vault,independentVault,now=()=>new Date().toISOString(),onCommitted=()=>{},
 testOnlyMaintenanceGate=false,uiIsIdle=()=>false,syncIsIdle=()=>false,operationGate=null,privateMaintenanceAuthorization=null,productMaintenanceEnabled=false,productMaintenanceAuthorization=null,undoIsIdle=()=>false}={}){
 let active=false,busy=false,undo=null,refreshPending=null,privateMaintenanceSnapshot=null;
 const guard=()=>{if(!active||vault.getState()!=='ACTIVE')stop('UNLOCK_REQUIRED')};
 const transaction=async fn=>{guard();if(busy)stop('BUSY');busy=true;try{return await fn()}finally{busy=false}};
 // A pending network acknowledgement is not a reason to disable local saves.
 // The immutable lineage still prevents connecting these edits to another box.
 const editable=()=>guard();
 const read=()=>{
  // Only the private same-realm maintenance reservation may expose a frozen
  // memory snapshot while the engine marks its cutover internally STOP.
  // It is never used as authority for writes; those wait for the gate.
  if(privateMaintenanceSnapshot!==null&&active&&operationGate)return cp(privateMaintenanceSnapshot);
  guard();return cp(vault.readCurrent())
 };
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
 // An Undo remains tied to one exact post-edit app and WAL generation.
 // Only a single authenticated checkpoint-only append may advance its head.
 const undoContext=app=>({tombstones:cp(app.tombstones),weeklyOptions:cp(app.weeklyOptions)});
 const headIdentity=()=>typeof vault.readHeadIdentity==='function'?vault.readHeadIdentity():null;
 const stampUndo=(receipt,app)=>({...receipt,revision:vault.readRevision(),head:cp(headIdentity()),
  checkpoint:cp(vault.readSyncCheckpoint()),context:undoContext(app)});
 function reconcileUndo(app){
  if(!undo)return;
  if(!same(undo.after,app.records)||!same(undo.context,undoContext(app))){undo=null;return}
  const head=headIdentity();
  if(undo.revision===vault.readRevision()){
   if(undo.head&&(!head||!same(undo.head,head)))undo=null;
   return;
  }
  const checkpoint=vault.readSyncCheckpoint();
  const checkpointOnly=undo.head&&head&&head.revision===undo.revision+1&&
   head.salt===undo.head.salt&&head.escrowDigest===undo.head.escrowDigest&&
   checkpoint&&Number.isSafeInteger(checkpoint.serverRevision)&&
   checkpoint.serverRevision>(undo.checkpoint?.serverRevision??0)&&
   same(checkpoint.snapshot,appToSnapshot(app));
  undo=checkpointOnly?stampUndo(undo,app):null;
 }
 async function maintainIfQuiescent({threshold=64,injectAbort=false,onAfterAnchorStageForTest=null,onBeforePrimaryCASForTest=null}={},product=false){
   if(product?(productMaintenanceEnabled!==true||typeof vault.maintainProductWal!=='function'):(!testOnlyMaintenanceGate||typeof vault.testOnlyCompactSameSalt!=='function'))return Object.freeze({rebased:false,reason:'OFF'});
   // Private product-entry authorization is an additional gate, not a proof
   // that non-cooperative old tabs are absent. Check at entry and before CAS.
   const permitted=()=>{
    if(product){try{return typeof productMaintenanceAuthorization==='function'&&productMaintenanceAuthorization()===true}catch{return false}}
    if(privateMaintenanceAuthorization===null)return true; // legacy test fixtures only
    try{return privateMaintenanceAuthorization()===true}catch{return false}
   };
   if(!permitted())return Object.freeze({rebased:false,reason:'UPGRADE_CONFIRMATION_REQUIRED'});
   if(product&&(!operationGate||typeof operationGate.tryReserveMaintenance!=='function'||typeof operationGate.withForeground!=='function'))return Object.freeze({rebased:false,reason:'OPERATION_GATE_REQUIRED'});
   // A missing, malformed or throwing signal is never proof of quietness.
   const safelyIdle=read=>{try{return read()===true}catch{return false}};
   if(product&&undo&&active&&vault.getState()==='ACTIVE')reconcileUndo(read());
   if(product&&undo&&safelyIdle(uiIsIdle)&&safelyIdle(undoIsIdle)&&undo.revision===vault.readRevision())undo=null;
   if(!active||vault.getState()!=='ACTIVE'||busy||undo||!safelyIdle(uiIsIdle)||!safelyIdle(syncIsIdle))return Object.freeze({rebased:false,reason:'NOT_QUIESCENT'});
   const reservation=operationGate?.tryReserveMaintenance?.()??(operationGate?null:{release(){},hasForegroundWaiters:()=>false});
   if(!reservation)return Object.freeze({rebased:false,reason:'FOREGROUND_RESERVED'});
   busy=true;
   try{
    // Recheck after the busy fence is acquired; external tab writes are still
    // protected by the WAL CAS. External sync must expose its own in-flight gate.
    if(!permitted())return Object.freeze({rebased:false,reason:'UPGRADE_CONFIRMATION_REQUIRED'});
   if(product&&(!operationGate||typeof operationGate.tryReserveMaintenance!=='function'||typeof operationGate.withForeground!=='function'))return Object.freeze({rebased:false,reason:'OPERATION_GATE_REQUIRED'});
    if(undo||!safelyIdle(uiIsIdle)||!safelyIdle(syncIsIdle))return Object.freeze({rebased:false,reason:'NOT_QUIESCENT'});
    const before=read();const beforeCheckpoint=vault.readSyncCheckpoint();
    privateMaintenanceSnapshot=cp(before);
    // The anchor is staged asynchronously. Foreground activity, a new draft,
    // or a sync can begin while it is being sealed or saved. Recheck ALL idle
    // signals at the final pre-cutover yield boundary, never just waiters.
    // Unknown/throwing observers fail closed. This is PRIVATE-ONLY and is NOT
    // a cross-tab membership proof or production auto-prune authorization.
    const shouldYieldBeforeCutover=()=>!permitted()||reservation.hasForegroundWaiters()||
      !!undo||!safelyIdle(uiIsIdle)||!safelyIdle(syncIsIdle);
    const result=product?await vault.maintainProductWal({shouldYieldBeforeCutover}):await vault.testOnlyCompactSameSalt({threshold,injectAbort,onAfterAnchorStageForTest,shouldYieldBeforeCutover,onBeforePrimaryCASForTest});
    if(vault.getState()!=='ACTIVE')stop('MAINTENANCE_ENGINE_STOPPED');
    if(!same(read(),before)||!same(vault.readSyncCheckpoint(),beforeCheckpoint))stop('MAINTENANCE_PARITY');
    if(result.phase==='REBASE_BELOW_THRESHOLD')return Object.freeze({rebased:false,reason:'BELOW_THRESHOLD'});
    if(result.phase==='REBASE_YIELDED_FOREGROUND')return Object.freeze({rebased:false,reason:'YIELDED_TO_FOREGROUND'});
    if(result.phase==='REBASE_PRECOMMIT_UNVERIFIED')return Object.freeze({rebased:false,reason:'CAS_GUARD_UNVERIFIED'});
    if(result.phase!==(product?'PRODUCT_WAL_REBASE_READBACK':'TEST_ONLY_SAME_SALT_REBASE_READBACK'))stop('MAINTENANCE_UNVERIFIED_RESULT');
    return Object.freeze({rebased:true,revision:vault.readRevision()});
   }catch(err){
    // NEVER swallow a sticky STOP_NO_RETRY as a harmless skipped optimization.
    if(vault.getState()!=='ACTIVE')active=false;
    throw err;
   }finally{privateMaintenanceSnapshot=null;busy=false;reservation.release()}
 }
 return Object.freeze({
  get ready(){return active&&(vault.getState()==='ACTIVE'||privateMaintenanceSnapshot!==null&&!!operationGate)},read,
  // PRIVATE opt-in contract probe only. No timer, product hook or automatic
  // pruning. Caller must prove *both* UI and sync are quiescent independently.
  testOnlyUndoReceiptRevision(){if(!testOnlyMaintenanceGate)return null;return undo?.revision??null},
  testOnlyExpireUndo(expectedRevision){
   if(!testOnlyMaintenanceGate||!active||busy||vault.getState()!=='ACTIVE'||!Number.isSafeInteger(expectedRevision))return false;
   if(!undo||undo.revision!==expectedRevision)return false;
   undo=null;return true;
  },
  testOnlyMaintainIfQuiescent:args=>maintainIfQuiescent(args,false),
  // No threshold, abort flag or test callback is accepted by the product facade.
  maintainProductWal:()=>maintainIfQuiescent({},true),
  // Browsers can emit visibilitychange and focus for the same foreground
  // transition. Share that read instead of reporting our own read as BUSY.
  // Writes still use the existing exclusive transaction and failure guard.
  refresh(){
   if(refreshPending)return refreshPending;
   refreshPending=transaction(async()=>{const result=await vault.refresh();reconcileUndo(result);return result})
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
   reconcileUndo(current);
   const isUndo=kind==='undo'&&undo&&undo.revision===vault.readRevision()&&same(undo.after,current.records)&&same(undo.before,draft);
   if(kind==='undo'&&!isUndo)stop('STALE_UNDO');
   for(const id of Object.keys(current.records))if(!draft[id])candidate.tombstones[id]={id,deletedAt:now()};
   for(const id of Object.keys(draft))if(current.tombstones[id]){
    if(!isUndo)stop('TOMBSTONE_RESURRECTION');delete candidate.tombstones[id];
   }
   const result=await commit(candidate);
   undo=isUndo?null:stampUndo({before:cp(current.records),after:cp(result.records)},result);
   return result;
  })},
  saveWeekly(next){return transaction(async()=>{
   editable();
   const current=read(),candidate=cp(current);candidate.weeklyOptions={...candidate.weeklyOptions,...cp(next)};
   if(same(candidate,current))return current;
   reconcileUndo(current);
   const receipt=undo;
   const result=await commit(candidate);
   const securitySettings=weekly=>Object.fromEntries(Object.entries(weekly).filter(([key])=>!['open','statuses'].includes(key)));
   undo=receipt&&same(result.records,current.records)&&same(result.tombstones,current.tombstones)&&
    same(securitySettings(result.weeklyOptions),securitySettings(current.weeklyOptions))?stampUndo(receipt,result):null;
   return result;
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
