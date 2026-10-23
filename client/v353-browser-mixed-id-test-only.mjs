/* ANI:LOG v3.53. TEST-ONLY real IndexedDB/localStorage adapter for the reviewed
 * v3.52 synthetic mixed-ID stage. This module performs NO IO on import.
 * No real ANI data, network API, production DB, backup or sync is accepted.
 */
import {IndexedDBJournalStore,LocalStorageAppParts,DurableSyncJournal,equalState,RecoveryBlocked} from './durable-journal.mjs';
import {IsolatedWriteBoundary} from './isolated-write-boundary.mjs';
import {V352GeneralIdSyntheticStage} from './v352-general-id-staging-test-only.mjs';
import {appToSnapshot} from './app-bridge.mjs';
import {inspectV351MigrationInput} from './v351-readonly-general-id-preflight.mjs';

const cp=structuredClone;
const block=reason=>{throw new RecoveryBlocked('V353_SYNTHETIC_ONLY_BLOCKED:'+reason)};
const PREFIX='__anilog_v352_SYNTHETIC_ONLY__:v353_ISOLATED_ONLY:';
export const V353_STORAGE_KEYS=Object.freeze({records:PREFIX+'records',tombstones:PREFIX+'tombstones',weeklyOptions:PREFIX+'weeklyOptions'});
export const V353_DB='anilog-v353-ISOLATED-ONLY-checkpoint';
export const V353_LOCK='anilog-v353-ISOLATED-ONLY-write-lock';
export const V353_BOX='anilog-v353-ISOLATED-ONLY-box';
export const V353_CUSTOM_ID='custom:1729544400000:a12bcd';
export const V353_DELETED_ID='custom:1729544400001:b23cde';
const JSON_KEYS=Object.keys(V353_STORAGE_KEYS);
const INITIAL=Object.freeze({records:{},tombstones:{},weeklyOptions:{open:true,statuses:['watching']}});
const SRC=Object.freeze({
 records:{
  'jikan:1':{id:'jikan:1',title:'架空作品A',status:'watching',watchedEpisodes:3,episodes:12,year:2025,updatedAt:'2026-10-21T00:00:00.000Z',foreign:{retained:['alpha',{value:7}]}},
  [V353_CUSTOM_ID]:{id:V353_CUSTOM_ID,title:'架空の手動作品',status:'planned',watchedEpisodes:0,episodes:8,year:2023,customUntouched:{xyz:true}}
 },
 tombstones:{[V353_DELETED_ID]:{id:V353_DELETED_ID,deletedAt:'2026-10-20T09:00:00.000Z',unknownDeleted:{tag:1}}},
 weeklyOptions:{open:true,statuses:['watching']}
});
export const getV353SyntheticFixture=()=>cp(SRC);
export const v353Summary=()=>Object.freeze({mode:'SYNC_OFF',testOnly:true,canDeploy:false,canImportRealRecords:false,canEnableSync:false});
const sourceOf=parts=>({recordsRaw:JSON.stringify(parts.records),tombstonesRaw:JSON.stringify(parts.tombstones),weeklyRaw:JSON.stringify(parts.weeklyOptions)});
function sourceChecked(parts){
 const audit=inspectV351MigrationInput(sourceOf(parts));
 if(!audit.eligibleForSeparateStagingReview||!audit.roundtripVerified)block('INVALID_SNAPSHOT');
 return true;
}
function required({storage,indexedDB,locks}){
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')block('STORAGE_REQUIRED');
 if(!indexedDB||typeof indexedDB.open!=='function')block('INDEXEDDB_REQUIRED');
 if(!locks||typeof locks.request!=='function')block('WEB_LOCKS_REQUIRED');
}
function expectedEdited(){
 const e=cp(SRC);
 e.records['jikan:1'].watchedEpisodes=4;
 e.records['jikan:1'].updatedAt='2026-10-21T01:00:00.000Z';
 e.records[V353_CUSTOM_ID].note={text:'架空メモ353',updatedAt:'2026-10-21T02:00:00.000Z'};
 return e;
}
export function createV353BrowserMixedIdLab({storage,indexedDB,locks}={}){
 required({storage,indexedDB,locks});
 const store=new IndexedDBJournalStore({indexedDB,dbName:V353_DB});
 const app=new LocalStorageAppParts(storage,V353_STORAGE_KEYS);
 const journal=new DurableSyncJournal({store,app});
 const withLock=action=>locks.request(V353_LOCK,{mode:'exclusive'},action);
 const boundary=new IsolatedWriteBoundary({journal,app,withLock});
 let opened=false,usedStage=false,usedEdit=false,inspectedRecovery=false;
 const ensure=()=>{if(!opened)block('OPEN_REQUIRED')};
 const exact=async expected=>{
  ensure();const parts=await app.readAll();const snap=await boundary.getSnapshot();
  if(!equalState(parts,expected)||!equalState(snap,appToSnapshot(expected)))block('READBACK_MISMATCH');
  sourceChecked(parts);
  const status=await boundary.status();
  if(status.revision!==0||status.dirty!==true)block('DIRTY_REVISION_MISMATCH');
  return {result:'READBACK_VERIFIED',records:Object.keys(parts.records).length,tombstones:Object.keys(parts.tombstones).length,
   watchedEpisodes:parts.records['jikan:1'].watchedEpisodes,unknownFieldsKept:true,
   ...v353Summary()};
 };
 return Object.freeze({
  async open(){return withLock(async()=>{
   const exists=JSON_KEYS.map(k=>storage.getItem(V353_STORAGE_KEYS[k])!==null);
   let doc=await store.load();
   if(!doc&&exists.every(x=>!x)){
    // Dedicated first-use only. Any torn initialization MUST NOT be repaired silently.
    for(const key of JSON_KEYS)await app.writePart(key,INITIAL[key]);
    await journal.initialize({boxId:V353_BOX,baseline:appToSnapshot(INITIAL)});
    doc=await store.load();
   }else if(!doc||exists.some(x=>!x))block('INCOMPLETE_STORAGE_NO_AUTO_RESET');
   if(doc.boxId!==V353_BOX)block('WRONG_TEST_BOX');
   // Never automatically recover an ambiguous/incomplete journal on page load.
   const status=await journal.status();
   opened=true;return {result:'OPEN_CLEAN',...status,...v353Summary()};
  })},
  async stageFixture(){
   ensure();if(usedStage)block('STAGE_ALREADY_ATTEMPTED');usedStage=true;
   const gate=new V352GeneralIdSyntheticStage({boundary,app});
   const preview=await gate.prepare(sourceOf(SRC));
   const receipt=await gate.commit(preview,{confirmed:true,confirmationText:'架空データ専用の空WALに保存'});
   await exact(SRC);
   return {receipt:receipt.kind,result:'STAGED_READBACK_VERIFIED',...v353Summary()};
  },
  async verifyStage(){return exact(SRC)},
  async editAfterReload(){
   ensure();if(usedEdit)block('EDIT_ALREADY_ATTEMPTED');usedEdit=true;
   await exact(SRC);
   await boundary.changeRecord('jikan:1',r=>({...r,watchedEpisodes:4,updatedAt:'2026-10-21T01:00:00.000Z'}));
   await boundary.changeRecord(V353_CUSTOM_ID,r=>({...r,note:{text:'架空メモ353',updatedAt:'2026-10-21T02:00:00.000Z'}}));
   const reviewed=expectedEdited();await exact(reviewed);
   const deletion=await boundary.deleteRecord(V353_CUSTOM_ID,'2026-10-21T03:00:00.000Z');
   if(!equalState(deletion.previous,reviewed.records[V353_CUSTOM_ID]))block('DELETE_RECEIPT_MISMATCH');
   const deleted=cp(reviewed);delete deleted.records[V353_CUSTOM_ID];deleted.tombstones[V353_CUSTOM_ID]=cp(deletion.tombstone);
   await exact(deleted);
   await boundary.undoDelete({id:V353_CUSTOM_ID,previous:deletion.previous,expectedTombstone:deletion.tombstone});
   return {...await exact(reviewed),result:'EDIT_DELETE_UNDO_VERIFIED'};
  },
  async verifyAfterEdits(){return exact(expectedEdited())},
  async inspect(){
   ensure();const parts=await app.readAll(),snap=await boundary.getSnapshot(),status=await boundary.status();
   if(!equalState(snap,appToSnapshot(parts)))block('INCONSISTENT_STORES');
   return {result:'CLEAN_CHECKPOINT',...status,records:Object.keys(parts.records).length,
    tombstones:Object.keys(parts.tombstones).length,...v353Summary()};
  },
  async inspectInterruptedCheckpoint(){
   return withLock(async()=>{
    const doc=await store.load();
    const keysPresent=JSON_KEYS.every(k=>storage.getItem(V353_STORAGE_KEYS[k])!==null);
    if(!doc||doc.boxId!==V353_BOX||!doc.intent||!keysPresent)block('NO_REVIEWABLE_INTENT');
    inspectedRecovery=true;
    return {result:'INTERRUPTED_INTENT_PRESENT',generation:doc.generation,kind:doc.intent.kind,
     requiresExplicitRecovery:true,...v353Summary()};
   });
  },
  async recoverOnlyAfterExplicitInspection(){
   if(!inspectedRecovery)block('INSPECT_BEFORE_RECOVERY');
   inspectedRecovery=false;
   // WAL will only roll forward if each observed part matches its recorded
   // before/after values. Foreign changes must block and remain untouched.
   const value=await boundary.recover();
   opened=true;
   return {result:'EXPLICIT_RECOVERY_DONE',...value,...v353Summary()};
  }
 });
}
