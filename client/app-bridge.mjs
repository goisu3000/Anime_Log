/* ANI:LOG v2.4.59 local state <-> sync snapshot preflight bridge (offline only).
 * Does NOT access the browser, localStorage, Cloudflare or any production data.
 * Any caller MUST keep local app writes atomic/locked and separately verified.
 */
import {validateSnapshot,toSnapshot,mergeSnapshots,markDeleted,reAdd} from '../sync-core.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';
const ALLOWED_WEEKLY=new Set(['watching','planned','paused']);
const STATUSES=new Set(['watched','watching','planned','paused','dropped']);
const denyKeys=new Set(['__proto__','constructor','prototype']);
const has=(o,k)=>Object.hasOwn(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const copy=x=>structuredClone(x);
const ids=x=>Object.keys(x);

/** Strictly transform persisted app records; do not silently filter or drop items. */
export function appToSnapshot({records,weeklyOptions=null,tombstones={}}){
 if(!object(records)||!object(tombstones))throw Error('app records/tombstones must be dictionaries');
 const rows=Object.create(null),dead=Object.create(null);
 for(const [id,r] of Object.entries(records)){
  if(denyKeys.has(id)||!object(r)||r.id!==id||!STATUSES.has(r.status))throw Error(`invalid local work: ${id}`);
  rows[id]=copy(r); // Preserve the EXACT saved record, including custom fields/metadata.
 }
 for(const [id,t] of Object.entries(tombstones)){
  if(denyKeys.has(id)||has(rows,id))throw Error(`inconsistent tombstone: ${id}`);
  dead[id]=copy(t);
 }
 const settings=Object.create(null);
 if(weeklyOptions===null)throw Error('weekly settings not loaded; cannot sync safely');
 {
  if(!object(weeklyOptions)||!Array.isArray(weeklyOptions.statuses)||weeklyOptions.statuses.length<1||
     new Set(weeklyOptions.statuses).size!==weeklyOptions.statuses.length||
     weeklyOptions.statuses.some(s=>!ALLOWED_WEEKLY.has(s)))throw Error('invalid weekly status settings');
  settings.weeklyOptions={statuses:copy(weeklyOptions.statuses)};
  if(weeklyOptions.__syncLineage)settings.syncLineage=checkLineage(weeklyOptions.__syncLineage);
 }
 const s=toSnapshot(rows,settings);s.tombstones=dead;
 return validateSnapshot(s);
}
/** Reconstruct an app-side candidate; device-only weeklyOptions.open MUST stay local. */
export function snapshotToApp(snapshot,{weeklyOptions=null}={}){
 validateSnapshot(snapshot);
 if(weeklyOptions===null)throw Error('weekly settings not loaded; cannot apply safely');
 const appWeekly=copy(weeklyOptions);
 if(snapshot.settings.syncLineage){
  const incoming=checkLineage(snapshot.settings.syncLineage);
  if(appWeekly.__syncLineage&&JSON.stringify(checkLineage(appWeekly.__syncLineage))!==JSON.stringify(incoming))throw Error('SYNC_LINEAGE_CHANGED');
  appWeekly.__syncLineage=incoming;
 }else if(appWeekly.__syncLineage)throw Error('SYNC_LINEAGE_MISSING');
 if(!object(appWeekly))throw Error('invalid local weekly settings');
 if(has(snapshot.settings,'weeklyOptions')){
  const incoming=snapshot.settings.weeklyOptions;
  if(!object(incoming)||!Array.isArray(incoming.statuses)||!incoming.statuses.length||
    new Set(incoming.statuses).size!==incoming.statuses.length||incoming.statuses.some(v=>!ALLOWED_WEEKLY.has(v)))
   throw Error('invalid incoming weekly status settings');
  appWeekly.statuses=copy(incoming.statuses);
 }
 return {records:copy(snapshot.records),tombstones:copy(snapshot.tombstones),weeklyOptions:appWeekly};
}
/** Prepare app changes WITHOUT writing. Return conflicts and candidate for explicit verification. */
export function previewAppSync({baseline,remote,localRecords,localTombstones={},localWeeklyOptions=null}){
 validateSnapshot(baseline);validateSnapshot(remote);
 const local=appToSnapshot({records:localRecords,tombstones:localTombstones,weeklyOptions:localWeeklyOptions});
 const {merged,conflicts,ok}=mergeSnapshots(baseline,local,remote);
 if(!ok)return {ok:false,kind:'blocked',conflicts,local,baseline:copy(baseline),remote:copy(remote)};
 const candidate=snapshotToApp(merged,{weeklyOptions:localWeeklyOptions});
 const changes={added:[],removed:[],modified:[]};
 for(const id of new Set([...ids(localRecords),...ids(candidate.records)])){
  if(!has(localRecords,id))changes.added.push(id);
  else if(!has(candidate.records,id))changes.removed.push(id);
  else if(JSON.stringify(localRecords[id])!==JSON.stringify(candidate.records[id]))changes.modified.push(id);
 }
 return {ok:true,kind:'preview-only',candidate,merged,changes,local,baseline:copy(baseline),remote:copy(remote)};
}
/** Only explicit app UI removal is permitted to create a durable tombstone. */
export function planUserDelete(snapshot,id,at){return markDeleted(snapshot,id,at)}
/** Explicit app UI Undo/re-add: preserve original full record, including notes and rating. */
export function planUserRestore(snapshot,record){return reAdd(snapshot,record)}

/** Preflight guard for stale app state before any browser write (no I/O here).
 * The production adapter must re-read localStorage INSIDE navigator.locks and
 * re-check this guard after any async operation; cross-key journaling remains TODO.
 */
export function assertLocalStateUnchanged(preview,latest){
 if(!preview.ok)throw Error('cannot commit a conflicted preview');
 const now=appToSnapshot(latest);
 const a=JSON.stringify(preview.local);
 const b=JSON.stringify(now);
 if(a!==b)throw Error('local records changed since preflight');
 return true;
}
