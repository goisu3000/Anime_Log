/* ANI:LOG v3.66: strictly fixed synthetic manual record through the actual form path.
 * Reuses the existing v3.53 WAL. No IO on import. No arbitrary user-input writes.
 */
import {V354ReviewedGeneralOps} from './v354-reviewed-general-ops-test-only.mjs';
import {V353_DB,V353_BOX,V353_STORAGE_KEYS} from './v353-browser-mixed-id-test-only.mjs';
import {LocalStorageAppParts,equalState,RecoveryBlocked} from './durable-journal.mjs';
import {inspectV351MigrationInput} from './v351-readonly-general-id-preflight.mjs';
const stop=x=>{throw new RecoveryBlocked('V366_CREATE_STOP:'+x)};
export const V366_CREATE_ID='custom:1761060000000:ab12cd';
export const V366_CREATE_TITLE='テスト用・手動登録366';
const stamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const clone=structuredClone;
const audit=x=>{const p=inspectV351MigrationInput({recordsRaw:JSON.stringify(x.records),tombstonesRaw:JSON.stringify(x.tombstones),weeklyRaw:JSON.stringify(x.weeklyOptions)});if(!p.eligibleForSeparateStagingReview||!p.roundtripVerified)stop('MIGRATION_AUDIT_REJECTED')};
export class V366ReviewedCreateBoundary{
 #pending=false;#uncertain=false;
 constructor({ops,app,readSaved,commitSaved}={}){
  if(!(ops instanceof V354ReviewedGeneralOps)||!(app instanceof LocalStorageAppParts)||ops.app!==app||ops.boundary?.journal?.store?.dbName!==V353_DB||!equalState(app.keys,V353_STORAGE_KEYS)||typeof readSaved!=='function'||typeof commitSaved!=='function')stop('FOREIGN_WAL_CONTEXT');
  this.ops=ops;this.app=app;this.readSaved=readSaved;this.commitSaved=commitSaved;
 }
 async create({record}={}){
  if(this.#pending||this.#uncertain)stop('IN_FLIGHT_OR_UNCERTAIN');
  if(!record||record.id!==V366_CREATE_ID||record.title!==V366_CREATE_TITLE||record.status!=='planned'||!stamp(record.updatedAt))stop('NOT_FIXED_SYNTHETIC_RECORD');
  const exact={id:V366_CREATE_ID,title:V366_CREATE_TITLE,english:'',image:'',year:null,season:null,type:'登録作品',episodes:null,score:null,status:'planned',updatedAt:record.updatedAt};
  if(!equalState(record,exact))stop('UNKNOWN_OR_REMOVED_FIELD');
  this.#pending=true;this.#uncertain=true;
  try{
   const before=await this.app.readAll(),snap=await this.ops.boundary.getSnapshot();
   if(!equalState(before.records,this.readSaved())||!equalState(before.records,snap.records)||!equalState(before.tombstones,snap.tombstones))stop('UI_WAL_DIVERGENCE');
   if(Object.hasOwn(before.records,V366_CREATE_ID)||Object.hasOwn(before.tombstones,V366_CREATE_ID))stop('ID_OR_TOMBSTONE_COLLISION');
   audit(before);
   const saved=await this.ops.boundary._mutate(async(current,parts)=>{
    const doc=await this.ops.boundary.journal.store.load();if(doc?.boxId!==V353_BOX)stop('FOREIGN_WAL_BOX');
    if(!equalState(parts,before)||!equalState(current.records,before.records)||!equalState(current.tombstones,before.tombstones))stop('STALE_WRITE');
    const updated=clone(current);updated.records[V366_CREATE_ID]=clone(exact);
    audit({records:updated.records,tombstones:updated.tombstones,weeklyOptions:parts.weeklyOptions});
    return {snapshot:updated,result:{operation:'synthetic-manual-create',id:V366_CREATE_ID}};
   });
   const after=await this.app.readAll(),readback=await this.ops.boundary.getSnapshot();
   if(!equalState(after.records,readback.records)||!equalState(after.tombstones,readback.tombstones))stop('ACK_READBACK_DIVERGED');
   if(!equalState(after.tombstones,before.tombstones)||!equalState(after.weeklyOptions,before.weeklyOptions)||!equalState(after.records[V366_CREATE_ID],exact))stop('UNREVIEWED_RESULT');
   const rest=clone(after);delete rest.records[V366_CREATE_ID];if(!equalState(rest,before))stop('UNRELATED_FIELD_CHANGED');
   audit(after);this.commitSaved(clone(after.records));this.#uncertain=false;
   return {result:'WAL_READBACK_VERIFIED',id:V366_CREATE_ID,saved};
  }finally{this.#pending=false}
 }
}
