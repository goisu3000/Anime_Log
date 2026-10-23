/* ANI:LOG v3.51 | Pure migration source preflight, never writes.
 * No browser storage access, WAL handle, Cloudflare, network, or import.
 * An accepted shape is NOT approval to deploy or to stage user data.
 */
import {canonicalJikanId,assertRealShapedRecord} from './v27-real-record-gate.mjs';
import {canonicalCustomId} from './v28-mixed-identity-preflight.mjs';
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {equalState} from './durable-journal.mjs';

const forbidden=new Set(['__proto__','prototype','constructor']);
const statuses=new Set(['planned','watching','watched','paused','dropped']);
const weeklyStatuses=new Set(['watching','planned','paused']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const uuidCustom=id=>typeof id==='string'&&/^custom:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const bytes=s=>new TextEncoder().encode(s).length;
const deny=code=>{throw Error('V351_READ_ONLY_BLOCKED:'+code)};
export const classifyV351Id=id=>canonicalJikanId(id)?'jikan':(canonicalCustomId(id)&&id.split(':')[2].length<=6)?'legacyCustom':uuidCustom(id)?'uuidCustom':'unsupported';

// Duplicate object keys are dangerous: JSON.parse silently discards the earlier value.
// This strictly validates an entire caller-supplied JSON text before parsing it.
function strictParse(raw,label,maxBytes,maxRootFields,maxNestedFields=120){
 if(typeof raw!=='string')deny(label+'_MISSING_OR_NOT_TEXT');
 if(bytes(raw)>maxBytes)deny(label+'_TOO_LARGE');
 let i=0, seenNodes=0;
 const ws=()=>{while(i<raw.length&&/\s/.test(raw[i]))i++};
 function readString(){
  const start=i;
  if(raw[i++]!=='"')deny('JSON_STRING');
  while(i<raw.length){
   if(raw[i]==='"')return JSON.parse(raw.slice(start,++i));
   if(raw[i]==='\\'){i++;if(raw[i]==='u'){if(!/^[0-9a-fA-F]{4}$/.test(raw.slice(i+1,i+5)))deny('JSON_ESCAPE');i+=5;continue}if(!/^["\\/bfnrt]$/.test(raw[i]??''))deny('JSON_ESCAPE');i++;continue}
   if(raw.charCodeAt(i)<32)deny('JSON_CONTROL');
   i++;
  }
  deny('JSON_UNTERMINATED_STRING');
 }
 function value(depth=0,root=false){
  if(depth>22||++seenNodes>200000)deny('JSON_COMPLEXITY');
  ws();const c=raw[i];
  if(c==='"'){readString();return}
  if(c==='{'){
   i++;ws();const names=new Set();let fields=0;
   if(raw[i]==='}'){i++;return}
   for(;;){
    ws();if(raw[i]!=='"')deny('JSON_OBJECT_KEY');const key=readString();
    if(!key||key.length>120||forbidden.has(key))deny('JSON_DANGEROUS_KEY');
    if(names.has(key))deny('JSON_DUPLICATE_KEY');names.add(key);
    if(++fields>(root?maxRootFields:maxNestedFields))deny('JSON_TOO_MANY_FIELDS');
    ws();if(raw[i++]!==':')deny('JSON_COLON');value(depth+1);ws();
    if(raw[i]==='}'){i++;return}if(raw[i++]!==',')deny('JSON_OBJECT_SEPARATOR');
   }
  }
  if(c==='['){
   i++;ws();let count=0;if(raw[i]===']'){i++;return}
   for(;;){if(++count>2000)deny('JSON_ARRAY_TOO_LARGE');value(depth+1);ws();
    if(raw[i]===']'){i++;return}if(raw[i++]!==',')deny('JSON_ARRAY_SEPARATOR');}
  }
  for(const lit of ['true','false','null'])if(raw.startsWith(lit,i)){i+=lit.length;return}
  const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i));
  if(!match)deny('JSON_VALUE');
  const number=Number(match[0]);
  if(!Number.isFinite(number)||match[0]!==JSON.stringify(number))deny('JSON_NONCANONICAL_NUMBER');
  i+=match[0].length;
 }
 try{ws();value(0,true);ws();if(i!==raw.length)deny('JSON_TRAILING_BYTES');const parsed=JSON.parse(raw);if(!plain(parsed))deny(label+'_NOT_DICTIONARY');return parsed}
 catch(e){if(String(e.message).startsWith('V351_READ_ONLY_BLOCKED:'))throw e;deny(label+'_INVALID_JSON')}
}
const reasons=(issues,code)=>issues.push(code);
const iso=t=>typeof t==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(t)&&Number.isFinite(Date.parse(t));
function validateCustom(r){
 if(typeof r.title!=='string'||!r.title.trim()||r.title.length>240||!statuses.has(r.status))return false;
 if(Object.hasOwn(r,'watchedEpisodes')&&(!Number.isInteger(r.watchedEpisodes)||r.watchedEpisodes<0||r.watchedEpisodes>9999))return false;
 if(Object.hasOwn(r,'episodes')&&r.episodes!==null&&(!Number.isInteger(r.episodes)||r.episodes<1||r.episodes>9999))return false;
 if(Object.hasOwn(r,'updatedAt')&&r.updatedAt!==''&&!iso(r.updatedAt))return false;
 return true;
}
export function inspectV351MigrationInput({recordsRaw,weeklyRaw=null,tombstonesRaw=null}={}){
 const records=strictParse(recordsRaw,'RECORDS',3_000_000,1500);
 const weekly=weeklyRaw===null?{open:false,statuses:['watching']}:strictParse(weeklyRaw,'WEEKLY',50_000,120);
 const tombstones=tombstonesRaw===null?{}:strictParse(tombstonesRaw,'TOMBSTONES',3_000_000,10000);
 const counts={jikan:0,legacyCustom:0,uuidCustom:0,unsupported:0};const issues=[];
 if(weeklyRaw===null)reasons(issues,'WEEKLY_SOURCE_ABSENT');
 if(tombstonesRaw===null)reasons(issues,'TOMBSTONE_SOURCE_ABSENT');
 if(typeof weekly.open!=='boolean'||!Array.isArray(weekly.statuses)||weekly.statuses.length===0||weekly.statuses.length>3||new Set(weekly.statuses).size!==weekly.statuses.length||weekly.statuses.some(x=>!weeklyStatuses.has(x)))reasons(issues,'WEEKLY_SHAPE_INVALID');
 let checkedRecords=0;
 for(const [id,r] of Object.entries(records)){
  const kind=classifyV351Id(id);counts[kind]++;checkedRecords++;
  if(!plain(r)||r.id!==id){reasons(issues,'RECORD_ID_MISMATCH');continue}
  if(kind==='unsupported'){reasons(issues,'UNSUPPORTED_RECORD_ID');continue}
  try{if(kind==='jikan')assertRealShapedRecord(r);else if(!validateCustom(r))throw Error('bad custom record')}
  catch{reasons(issues,'INVALID_RECORD_SHAPE')}
  if(bytes(JSON.stringify(r))>100000)reasons(issues,'OVERSIZED_RECORD');
  if(kind==='uuidCustom')reasons(issues,'UUID_ORIGIN_NOT_PROVEN');
 }
 let tombstoneCount=0;
 for(const [id,t] of Object.entries(tombstones)){
  tombstoneCount++;
  if(!plain(t)||t.id!==id||!iso(t.deletedAt)){reasons(issues,'INVALID_TOMBSTONE');continue}
  if(Object.hasOwn(records,id))reasons(issues,'LIVE_TOMBSTONE_COLLISION');
  if(classifyV351Id(id)==='unsupported')reasons(issues,'UNSUPPORTED_TOMBSTONE_ID');
  if(classifyV351Id(id)==='uuidCustom')reasons(issues,'UUID_ORIGIN_NOT_PROVEN');
 }
 let roundtripVerified=false;
 if(!issues.includes('WEEKLY_SHAPE_INVALID')){
  try{const original={records,tombstones,weeklyOptions:weekly};const snapshot=appToSnapshot(original);
   const restored=snapshotToApp(snapshot,{weeklyOptions:weekly});
   roundtripVerified=equalState(original,restored);
  }catch{roundtripVerified=false}
 }
 if(!roundtripVerified)reasons(issues,'LOSSLESS_ROUNDTRIP_NOT_VERIFIED');
 const uniqueIssues=[...new Set(issues)];
 // Never emit record IDs or contents in this summary; no stage/commit handles.
 return Object.freeze({kind:'READ_ONLY_NO_STORAGE',recordCount:checkedRecords,tombstoneCount,
  identityCounts:Object.freeze(counts),issues:Object.freeze(uniqueIssues),roundtripVerified,
  eligibleForSeparateStagingReview:uniqueIssues.length===0,
  canImportRealRecords:false,canModifyOriginal:false,canEnableSync:false,canDeploy:false});
}

// Shared strict, duplicate-key rejecting decoder for frozen development backups.
export const parseLosslessObject=raw=>strictParse(raw,"BACKUP",12000000,1500,10000);
