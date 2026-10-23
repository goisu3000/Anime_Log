/* ANI:LOG v4.02 | Real v2.4.61 HTML handlers, synthetic-only encrypted PRIMARY.
 * 11 reviewed operation types are enabled. No localStorage, user archive,
 * API calls, Cloudflare, SYNC_ON or production keys. Errors permanently stop this session.
 */
import {readEncryptedVaultForSync} from './v400-encrypted-vault-sync-readonly-bridge.mjs';
import {confirmTransportAndCommitVault} from './v401-confirmed-worker-vault-commit.mjs';
import {getV353SyntheticFixture,V353_CUSTOM_ID} from './v353-browser-mixed-id-test-only.mjs';
import {getV396SyntheticFixture} from './v396-mixed-synthetic-fixture.mjs';
const cp=structuredClone;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=x=>{throw Error('V399_FULL_ANI_STOP_NO_RETRY:'+x)};
export function createV408ANIHandlerBridge({vault,ui}={}){
 if(!vault||!ui||typeof ui.readSaved!=='function'||typeof ui.commitSaved!=='function')fail('MISSING_BACKEND_OR_REAL_UI');
 let stopped=false;
 const guard=()=>{if(stopped)fail('PREVIOUS_ERROR')};
 const hydrate=()=>{
  const s=vault.readCurrent();ui.commitSaved(cp(s.records),cp(s.weeklyOptions));
  if(!eq(ui.readSaved(),s.records)||!eq(ui.readWeeklyOptions(),s.weeklyOptions))fail('UI_HYDRATION_MISMATCH');
  return s;
 };
 return Object.freeze({
  get ready(){return !stopped&&vault.getState()==='ACTIVE'},
  async restore(kind,{replace,candidate,passphrase}={}){guard();try{
   if(kind!=='backup-import'||replace!==true||Object.keys(ui.readSaved()).length)fail('SYNTHETIC_EMPTY_ONLY_IMPORT');
   const known=[getV353SyntheticFixture(),getV396SyntheticFixture()].find(s=>eq(candidate,s.records));
   if(!known)fail('SYNTHETIC_EMPTY_ONLY_IMPORT');
   const receipt=await vault.initialize(known,passphrase);hydrate();
   if(receipt.revision!==0||!eq(ui.readSaved(),candidate))fail('IMPORT_ACK_NOT_VERIFIED');
   return {stage:'REAL_COMMIT_IMPORT_HANDLER_AND_ENCRYPTED_WAL_BOOT_VERIFIED',importGatePhase:'verified',records:Object.keys(known.records).length,tombstones:Object.keys(known.tombstones).length,mode:'SYNC_OFF',syntheticOnly:true};
  }catch(e){stopped=true;throw e}},
  async initialize(snapshot,passphrase){guard();try{
   const receipt=await vault.initialize(snapshot,passphrase);hydrate();return receipt;
  }catch(e){stopped=true;throw e}},
  async unlock(passphrase){guard();try{
   const receipt=await vault.unlock(passphrase);hydrate();return receipt;
  }catch(e){stopped=true;throw e}},
  async apply(kind,args){guard();try{
   if(!['note','progress','status','review','review-delete','stream','weekly','pin','watched-status','completion','analysis','rank-stage','rank-direction','rank-drop','manual-create','record-delete','undo-delete'].includes(kind))fail('ROUTE_NOT_YET_CONNECTED');
   if(!this.ready)fail('NOT_UNLOCKED');
   const before=vault.readCurrent();if(!eq(before.records,ui.readSaved()))fail('STALE_UI');
   const normalizedArgs=kind==='manual-create'?{...args,id:args?.record?.id}:kind==='rank-drop'?{...args,id:args?.draggedId}:args;
   const receipt=await vault.append(kind,normalizedArgs);
   if(receipt.phase!=='TYPED_ENCRYPTED_WAL_VERIFIED')fail('ACK_NOT_VERIFIED');
   const after=hydrate();
   if(kind==='note'&&(args.text.trim()?after.records[args.id]?.note?.text!==args.text.trim():!!after.records[args.id]?.note||!after.records[args.id]?.noteDeletedAt))fail('NOTE_NOT_REFLECTED');
   if(kind==='progress'&&after.records[args.id]?.watchedEpisodes!==args.requested)fail('PROGRESS_NOT_REFLECTED');
   if(kind==='status'&&after.records[args.id]?.status!==args.status)fail('STATUS_NOT_REFLECTED');
   if(kind==='review'&&(after.records[args.id]?.review?.overall!==args.overall||!eq(after.records[args.id]?.review?.aspects,args.aspects)))fail('REVIEW_NOT_REFLECTED');
   if(kind==='review-delete'&&(after.records[args.id]?.review!==undefined||!after.records[args.id]?.reviewDeletedAt))fail('REVIEW_DELETE_NOT_REFLECTED');
   if(kind==='stream'&&(after.records[args.id]?.streamPreference?.service!==args.service||after.records[args.id]?.streamPreference?.url!==args.url))fail('STREAM_NOT_REFLECTED');
   if(kind==='pin'&&((typeof after.records[args.id]?.nextWatchPinnedAt==='string')===args.wasPinned||!after.records[args.id]?.nextWatchUpdatedAt))fail('PIN_NOT_REFLECTED');
   if(kind==='watched-status'&&after.records[args.id]?.status!=='watched')fail('WATCHED_STATUS_NOT_REFLECTED');
   if(kind==='completion'&&after.records[args.id]?.completedOn!==args.value)fail('COMPLETION_NOT_REFLECTED');
   if(kind==='analysis'&&!eq(after.records[args.id]?.analysisMeta,args.meta))fail('ANALYSIS_NOT_REFLECTED');
   if(kind==='rank-stage'&&(!after.records['jikan:36501']||!after.records['jikan:36502']))fail('RANK_STAGE_NOT_REFLECTED');
   if(kind==='manual-create'&&!eq(after.records[normalizedArgs.id],args.record))fail('MANUAL_NOT_REFLECTED');
   if(kind==='record-delete'&&(after.records[args.id]||!after.tombstones[args.id]))fail('DELETE_NOT_REFLECTED');
   if(kind==='undo-delete'&&(!after.records[args.id]||after.tombstones[args.id]))fail('UNDO_NOT_REFLECTED');
   if(kind==='rank-direction'||kind==='rank-drop'){const ids=Object.keys(before.records).filter(x=>before.records[x]?.myRankOrder!==after.records[x]?.myRankOrder);if(ids.length!==2||!ids.includes(normalizedArgs.id)||ids.some(x=>!Number.isInteger(after.records[x]?.myRankOrder)))fail('RANK_NOT_REFLECTED')}
   if(kind==='weekly'&&(after.records[args.id]?.weeklySchedule?.mode!==args.mode||after.records[args.id]?.weeklySchedule?.day!==args.day||after.records[args.id]?.weeklySchedule?.time!==args.time))fail('WEEKLY_NOT_REFLECTED');
   if(typeof window!=='undefined'&&!window.__v399HarnessRun&&window.__v399DemoActive===true){window.__v399ManualChanges=true;window.__v399RefreshButtons?.()}
   return true;
  }catch(e){stopped=true;throw e}},
  // Read-only current UI -> encrypted vault -> sync-core projection. Never transmits data.
  syncPreview(){guard();if(!this.ready)fail('NOT_UNLOCKED');
   const s=vault.readCurrent();
   if(!eq(ui.readSaved(),s.records)||!eq(ui.readWeeklyOptions(),s.weeklyOptions))fail('STALE_UI');
   return Object.freeze({snapshot:readEncryptedVaultForSync(vault),checkpoint:vault.readSyncCheckpoint(),vaultRevision:vault.readRevision()});
  },
  // This callable is for a verified existing transport, NOT a simulated ACK button.
  // Existing V30 transport GET must authenticate/decrypt a matching confirmed CAS revision.
  async confirmTransport({transport,syncResult}={}){guard();try{
   if(!this.ready)fail('NOT_UNLOCKED');
   const s=vault.readCurrent();
   if(!eq(ui.readSaved(),s.records)||!eq(ui.readWeeklyOptions(),s.weeklyOptions))fail('STALE_UI');
   const before=vault.readRevision();
   const result=await confirmTransportAndCommitVault({vault,transport,syncResult,expectedVaultRevision:before});
   if(result.phase!=='CONFIRMED_SYNC_ATOMIC_WAL_READBACK_VERIFIED')fail('UNCONFIRMED_SYNC_WRITE');
   const after=hydrate();
   if(vault.readRevision()!==before+1||!vault.readSyncCheckpoint())fail('SYNC_HYDRATION_MISMATCH');
   return Object.freeze({...result,realAppRecords:Object.keys(after.records).length});
  }catch(err){if(vault.getState()!=='ACTIVE')stopped=true;throw err}},
  inspect:()=>{guard();return vault.inspectReadOnly()},
  readBack:()=>{guard();if(stopped||vault.getState()!=='ACTIVE')fail('LOCKED');return vault.readCurrent()}
 });
}
