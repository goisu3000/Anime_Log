/* ANI:LOG sync v2.8: READ-ONLY legacy identity + no-loss migration audit.
 * Does not access browser storage, disk, network, or any production API.
 * No data may be silently removed or normalized as a side-effect of this audit.
 * This is a diagnostic bridge, NOT permission to enable synchronization.
 */
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {canonicalJikanId,assertRealShapedRecord} from './v27-real-record-gate.mjs';
import {equalState} from './durable-journal.mjs';

const own=(o,k)=>Object.hasOwn(o,k);
const cp=x=>structuredClone(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const forbidden=new Set(['__proto__','constructor','prototype']);
const statuses=new Set(['watched','watching','planned','paused','dropped']);
const encoder=new TextEncoder();
const deny=message=>{throw new Error('v2.8 migration blocked: '+message)};

// Matches the live v2.4.61 generator `custom:`+Date.now()+':'+Math.random().toString(36).slice(2,8).
// Older arbitrary `custom:` forms are NEVER deleted; flagged for supervised mapping.
export const canonicalCustomId=id=>typeof id==='string'&&/^custom:[1-9]\d{9,14}:[a-z0-9]{1,8}$/.test(id)&&id.length<=150;
export const classifyWorkId=id=>canonicalJikanId(id)?'jikan':canonicalCustomId(id)?'custom':'unsupported';

function strictJSON(value,{maxDepth=20,maxFields=120}={}){
 const visited=new Set();
 const go=(x,depth)=>{
  if(depth>maxDepth)deny('deeply nested JSON cannot be losslessly validated');
  if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return;
  if(Array.isArray(x)){
   if(x.length>2000||visited.has(x))deny('invalid array/cycle');
   if(Object.keys(x).some(k=>!/(?:0|[1-9]\d*)/.test(k)||Number(k)>=x.length))deny('non-index array properties cannot be preserved');
   visited.add(x);for(let i=0;i<x.length;i++){if(!own(x,i))deny('sparse array');go(x[i],depth+1)}visited.delete(x);return;
  }
  if(!object(x)||visited.has(x))deny('non-JSON object or cycle');
  if(Reflect.ownKeys(x).length!==Object.keys(x).length)deny('hidden or symbol fields cannot be preserved');
  visited.add(x);const entries=Object.entries(x);if(entries.length>maxFields)deny('too many fields');
  for(const [key,child] of entries){if(!key||key.length>120||forbidden.has(key))deny('dangerous field name');go(child,depth+1)}
  visited.delete(x);
 };
 go(value,0);
 const text=JSON.stringify(value);
 if(text===undefined)deny('JSON serialization would discard information');
 return text;
}
function customRecord(r){
 if(!object(r)||!canonicalCustomId(r.id))deny('noncanonical custom work');
 const json=strictJSON(r);if(encoder.encode(json).length>100_000)deny('oversized custom work');
 if(typeof r.title!=='string'||!r.title.trim()||r.title.length>240)deny('invalid custom work title');
 if(!statuses.has(r.status))deny('invalid custom status');
 if(own(r,'watchedEpisodes')&&(!Number.isInteger(r.watchedEpisodes)||r.watchedEpisodes<0||r.watchedEpisodes>9999))deny('invalid custom watch progress');
 if(own(r,'updatedAt')&&r.updatedAt!==''&&(typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt))))deny('invalid custom updatedAt');
 return true;
}
export function inspectMixedRecords(records,{maxWorks=1500,maxBytes=3_000_000}={}){
 if(!object(records))deny('record dictionary required');
 const keys=Object.keys(records);if(keys.length>maxWorks)deny('too many records');
 const counts={jikan:0,custom:0,unsupported:0};
 const issues=[];let bytes=0;
 for(const [id,record] of Object.entries(records)){
  const kind=classifyWorkId(id);counts[kind]++;
  if(!object(record)||record.id!==id)deny('record ID disagrees with map key');
  bytes+=encoder.encode(strictJSON(record)).length;if(bytes>maxBytes)deny('snapshot records exceed size limit');
  if(kind==='unsupported'){
   issues.push({code:'UNSUPPORTED_ID',id});continue;
  }
  try{if(kind==='jikan')assertRealShapedRecord(record);else customRecord(record)}
  catch(e){issues.push({code:'INVALID_RECORD',id,reason:e.message})}
 }
 return {counts,issues,recordCount:keys.length,totalRecordBytes:bytes};
}
function inspectTombstones(tombstones,records){
 if(!object(tombstones))deny('tombstones dictionary required');
 if(Object.keys(tombstones).length>10_000)deny('too many deletion markers');
 const issues=[];
 for(const [id,entry] of Object.entries(tombstones)){
  if(own(records,id))deny('live work overlaps deletion marker');
  if(!object(entry)||entry.id!==id||typeof entry.deletedAt!=='string'||!Number.isFinite(Date.parse(entry.deletedAt)))deny('invalid tombstone');
  strictJSON(entry);
  if(classifyWorkId(id)==='unsupported')issues.push({code:'UNSUPPORTED_DELETED_ID',id});
 }
 return issues;
}
function parsePart(raw,label,{optional=false}={}){
 if(raw===null&&optional)return null;
 if(typeof raw!=='string')deny('raw '+label+' must be a string');
 let value;try{value=JSON.parse(raw)}catch{deny('corrupt '+label+' JSON')}
 if(!object(value))deny('bad '+label+' JSON shape');
 strictJSON(value);return value;
}
export function auditMigrationFixture({recordsRaw,weeklyRaw=null,tombstonesRaw=null}={}){
 // Accepts only caller-supplied JSON text. Never reads real ANI:LOG localStorage.
 const records=parsePart(recordsRaw,'records');
 const weekly=weeklyRaw===null?{open:false,statuses:['watching']}:parsePart(weeklyRaw,'weekly settings');
 if(typeof weekly.open!=='boolean')deny('weekly local open state must be boolean');
 const tombstones=tombstonesRaw===null?{}:parsePart(tombstonesRaw,'tombstones');
 const summary=inspectMixedRecords(records);
 const issues=[...summary.issues,...inspectTombstones(tombstones,records)];
 if(tombstonesRaw===null)issues.push({code:'LEGACY_DELETION_HISTORY_MISSING'});
 if(weeklyRaw===null)issues.push({code:'DEFAULT_WEEKLY_SETTING_ASSUMED'});
 let snapshot=null;
 try{
  snapshot=appToSnapshot({records,tombstones,weeklyOptions:weekly});
  const roundtrip=snapshotToApp(snapshot,{weeklyOptions:weekly});
  if(!equalState(roundtrip,{records,tombstones,weeklyOptions:weekly}))deny('lossless roundtrip not possible');
 }catch(e){issues.push({code:'SNAPSHOT_NOT_READY',reason:e.message})}
 // The source records are intentionally not included in the returned report.
 // A separate explicitly approved staging module handles any future copy.
 return Object.freeze({
  kind:'read-only',counts:summary.counts,recordCount:summary.recordCount,tombstoneCount:Object.keys(tombstones).length,
  issues,canStageInIsolatedTest:!!snapshot&&issues.every(x=>['LEGACY_DELETION_HISTORY_MISSING','DEFAULT_WEEKLY_SETTING_ASSUMED'].includes(x.code)),
  canEnableAutomaticSync:false,canOverwriteOldStorage:false,
  requirements:['freeze old-origin writes','independently verify full source export','empty destination','approve missing legacy tombstone history explicitly','compare snapshot after staging','test browser and Cloudflare real behavior']
 });
}
