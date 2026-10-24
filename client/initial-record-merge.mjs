/* First connection ONLY: independently authored collections have no common
 * ancestor. Apply an explicit, deterministic *initial* import policy. Never
 * apply these choices to the ordinary ongoing three-way sync engine.
 * The caller must require an independent backup and explicit user consent.
 */
import {blankSnapshot,mergeSnapshots,validateSnapshot} from '../sync-core.mjs';
import {appToSnapshot} from './app-bridge.mjs';
import {validateFormalApp} from './formal-storage.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';

const has=(x,k)=>Object.hasOwn(x,k);
const copy=x=>structuredClone(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const LIMIT_FUTURE_MS=5*60*1000;
// The QR issuer is the already established destination, not 'PC by default'.
// A clock cannot be trusted if it is far ahead of this comparison's clock.
const timestamp=(v,now)=>{
 if(typeof v!=='string')return null;
 const t=Date.parse(v);
 return Number.isFinite(t)&&t>=946684800000&&t<=now+LIMIT_FUTURE_MS?t:null;
};
const winner=(l,r,lt,rt,now)=>{
 const a=timestamp(lt,now),b=timestamp(rt,now);
 if(a!==null&&b!==null&&a!==b)return a>b?'local':'remote';
 // No reliable *pair* of timestamps: established QR destination wins.
 return 'remote';
};
const property=(obj,k)=>has(obj,k)?copy(obj[k]):undefined;
function applyGroup(out,source,fields){
 for(const field of fields){delete out[field];if(has(source,field))out[field]=property(source,field)}
}
function eventTime(record,{valueKey,dateKey,deleteKey},now){
 const value=record[valueKey],date=value?.[dateKey];
 const a=timestamp(date,now),b=timestamp(record[deleteKey],now);
 return a===null?b:b===null?a:Math.max(a,b);
}
function groupSource(local,remote,group,now){
 const fields=group.fields;
 const lv=fields.some(k=>has(local,k)),rv=fields.some(k=>has(remote,k));
 // A missing property without an explicit deletion marker is not a deletion.
 if(lv&&!rv)return local;
 if(rv&&!lv)return remote;
 const ld=group.time(local,now),rd=group.time(remote,now);
 return winner(local,remote,ld===null?null:new Date(ld).toISOString(),rd===null?null:new Date(rd).toISOString(),now)==='local'?local:remote;
}
const GROUPS=[
 {fields:['note','noteDeletedAt'],time:(r,now)=>eventTime(r,{valueKey:'note',dateKey:'updatedAt',deleteKey:'noteDeletedAt'},now)},
 {fields:['review','reviewDeletedAt'],time:(r,now)=>eventTime(r,{valueKey:'review',dateKey:'updatedAt',deleteKey:'reviewDeletedAt'},now)},
 {fields:['myRankOrder','rankUpdatedAt'],time:(r,now)=>timestamp(r.rankUpdatedAt,now)},
 {fields:['nextWatchPinnedAt','nextWatchUpdatedAt'],time:(r,now)=>timestamp(r.nextWatchUpdatedAt??r.nextWatchPinnedAt,now)},
 {fields:['weeklySchedule'],time:(r,now)=>timestamp(r.weeklySchedule?.updatedAt,now)},
 {fields:['streamPreference'],time:(r,now)=>timestamp(r.streamPreference?.updatedAt,now)},
];
const groupFields=new Set(GROUPS.flatMap(g=>g.fields));
const progressFields=new Set(['status','watchedEpisodes','completedOn']);
const metadataFields=new Set(['updatedAt']);
function resolveRecord(local,remote,preview,now){
 const out=copy(preview),prefer=winner(local,remote,local.updatedAt,remote.updatedAt,now);
 const main=prefer==='local'?local:remote;
 // Status changes represent intent. Never combine a new 'dropped' status with
 // progress or completion date taken from an unrelated status on the other side.
 if(local.status!==remote.status){applyGroup(out,main,[...progressFields]);}
 else{
  out.status=local.status;
  const a=local.watchedEpisodes,b=remote.watchedEpisodes;
  if(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0)
   out.watchedEpisodes=Math.max(a,b);
  else if(has(local,'watchedEpisodes')&&has(remote,'watchedEpisodes')&&!equal(a,b))
   applyGroup(out,main,['watchedEpisodes']);
  // The completed date belongs to the chosen status and must not be invented.
  if(has(local,'completedOn')&&has(remote,'completedOn')&&!equal(local.completedOn,remote.completedOn))
   applyGroup(out,main,['completedOn']);
 }
 for(const group of GROUPS){
  // Entire review/note/rank/settings group wins atomically; never assemble
  // inconsistent parts or concatenate notes beyond the app's 500-char limit.
  const chosen=groupSource(local,remote,group,now);
  applyGroup(out,chosen,group.fields);
 }
 // Unknown/new fields retain the recursive union. Only actual overlaps are
 // resolved by a reliable record timestamp, else the QR destination's value.
 const conflicts=mergeSnapshots(blankSnapshot(),
  {schema:1,records:{[local.id]:local},tombstones:{},settings:{}},
  {schema:1,records:{[remote.id]:remote},tombstones:{},settings:{}}).conflicts;
 for(const conflict of conflicts){
  if(!conflict.path.startsWith('records/'))continue;
  const parts=conflict.path.split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
  if(parts.length<3)continue;
  if(progressFields.has(parts[2])||groupFields.has(parts[2])||metadataFields.has(parts[2]))continue;
  const source=prefer==='local'?local:remote;
  let node=out,from=source;
  for(let i=2;i<parts.length-1;i++){
   if(!node||typeof node!=='object'||!from||typeof from!=='object')break;
   node=node[parts[i]];from=from[parts[i]];
  }
  const key=parts.at(-1);
  if(node&&typeof node==='object'&&from&&typeof from==='object'){
   if(has(from,key))node[key]=copy(from[key]);else delete node[key];
  }
 }
 // updatedAt is metadata; make the newer *valid* clock value visible,
 // without making it a reason to override note/review subfield timestamps.
 const la=timestamp(local.updatedAt,now),ra=timestamp(remote.updatedAt,now);
 const clock=la!==null&&ra!==null?(la>=ra?local:remote):la!==null?local:ra!==null?remote:main;
 if(has(clock,'updatedAt'))out.updatedAt=copy(clock.updatedAt);
 return out;
}
function normaliseRankCollisions(records){
 // ANI's ranking is ordered WITHIN each rating tier. Only repair duplicate
 // positions, and never turn unrated entries into ranked entries.
 const groups=new Map();
 for(const r of Object.values(records)){
  if(!Number.isInteger(r.myRankOrder)||!Number.isInteger(r.review?.overall)||r.review.overall<1)continue;
  const key=r.review.overall,arr=groups.get(key)??[];arr.push(r);groups.set(key,arr);
 }
 let repaired=0;
 for(const arr of groups.values()){
  if(new Set(arr.map(x=>x.myRankOrder)).size===arr.length)continue;
  arr.sort((a,b)=>a.myRankOrder-b.myRankOrder||a.id.localeCompare(b.id));
  arr.forEach((r,i)=>{if(r.myRankOrder!==i){r.myRankOrder=i;repaired++}});
 }
 return repaired;
}

/** Pure plan: no network, localStorage, WAL, authentication or irreversible I/O.
 * `summary` is safe to display without showing records or secrets. Failure to
 * validate the resulting size/shape returns a blocking result, not a write.
 */
export function planInitialRecordMerge({localApp,remoteSnapshot,apiOrigin,boxId,now=Date.now()}={}){
 validateFormalApp(localApp);validateSnapshot(remoteSnapshot);
 if(!Number.isFinite(now))throw Error('INITIAL_MERGE_CLOCK_REQUIRED');
 if(localApp.weeklyOptions.__syncLineage||localApp.weeklyOptions.__registrationPending)throw Error('ALREADY_CONNECTED_LOCAL_RECORDS_NEED_REVIEW');
 const evidence=localApp.weeklyOptions.__migration?.evidence;
 if(localApp.weeklyOptions.__migration?.history==='unknown'&&(!evidence?.independentBackupConfirmed||!evidence.oldClientsClosedConfirmed))
  throw Error('LEGACY_CUTOVER_EVIDENCE_REQUIRED');
 if(remoteSnapshot.settings.syncLineage){const line=checkLineage(remoteSnapshot.settings.syncLineage);
  if(line.api!==apiOrigin||line.boxId!==boxId)throw Error('INITIAL_REMOTE_LINEAGE_MISMATCH')}
 const local=appToSnapshot(localApp);
 let preliminary;
 try{preliminary=mergeSnapshots(blankSnapshot(),local,remoteSnapshot)}
 catch(error){return {ok:false,kind:'unsafe-candidate',reason:String(error.message)}}
 const merged=preliminary.merged;
 const summary={addedWorks:0,overlappingWorks:0,automaticDecisions:0,deletedVersusExisting:0,rankRepairs:0};
 const ids=new Set([...Object.keys(local.records),...Object.keys(local.tombstones),...Object.keys(remoteSnapshot.records),...Object.keys(remoteSnapshot.tombstones)]);
 for(const id of ids){
  const a=local.records[id],b=remoteSnapshot.records[id],ad=local.tombstones[id],bd=remoteSnapshot.tombstones[id];
  if(ad||bd){
   // Explicit tombstones are never resurrected by a missing history/record.
   delete merged.records[id];
   if(ad&&bd)merged.tombstones[id]=copy(winner(ad,bd,ad.deletedAt,bd.deletedAt,now)==='local'?ad:bd);
   else merged.tombstones[id]=copy(ad??bd);
   if(a||b)summary.deletedVersusExisting++;
   continue;
  }
  if(a&&b){
   summary.overlappingWorks++;
   if(!equal(a,b))summary.automaticDecisions++;
   merged.records[id]=resolveRecord(a,b,merged.records[id],now);
  }else if(a||b)summary.addedWorks++;
 }
 summary.rankRepairs=normaliseRankCollisions(merged.records);
 // Both origins store a portable shared weekly-status preference. A mismatch
 // is not a reason to prevent pairing; prefer the established destination.
 if(has(remoteSnapshot.settings,'weeklyOptions'))merged.settings.weeklyOptions=copy(remoteSnapshot.settings.weeklyOptions);
 // Keep the destination's authenticated lineage intact.
 if(has(remoteSnapshot.settings,'syncLineage'))merged.settings.syncLineage=copy(remoteSnapshot.settings.syncLineage);
 try{validateSnapshot(merged)}catch(error){return {ok:false,kind:'unsafe-candidate',reason:String(error.message),summary}}
 return {ok:true,kind:'automatic-initial-merge-preview',snapshot:merged,summary,
  requiresExplicitBackup:true,requiresUserConfirmation:true};
}
