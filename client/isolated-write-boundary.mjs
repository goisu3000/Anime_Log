/* ANI:LOG sync POC v0.8 - ISOLATED / TEST-ONLY write gateway.
 * Does not import, patch or write the production ANI:LOG v2.4.59 HTML.
 * All mutations require a caller-supplied exclusive lock, and pass through
 * the v0.6 WAL + strict snapshot validation. NEVER treat this as a production
 * drop-in: every actual ANI:LOG mutation path must be explicitly integrated.
 */
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {markDeleted,reAdd} from '../sync-core.mjs';
import {equalState,RecoveryBlocked} from './durable-journal.mjs';
const own=(o,k)=>Object.hasOwn(o,k);
const cp=x=>structuredClone(x);
const okayDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(x)&&Number.isFinite(Date.parse(x));
const inputError=what=>new RecoveryBlocked('isolated boundary: '+what);

// Test-only process mutex. A future production adapter MUST use a browser
// origin-wide navigator.locks lock (same lock for every mutation entry point).
export function makeInProcessExclusiveLock(){
 let tail=Promise.resolve();
 return fn=>{
  const task=tail.then(fn);
  tail=task.catch(()=>{});
  return task;
 };
}

export class IsolatedWriteBoundary {
 constructor({journal,app,withLock,namespace='TEST-v08'}={}){
  if(namespace!=='TEST-v08'||!journal||!app||typeof withLock!=='function')throw Error('isolated test boundary requires explicit TEST-v08 namespace and exclusive lock');
  this.journal=journal;this.app=app;this.withLock=withLock;this.namespace=namespace;
 }
 async _mutate(build){
  return this.withLock(async()=>{
   // Refuse edits if journal has unfinished intent, stale state or alien edits.
   await this.journal.current();
   const initial=await this.app.readAll();
   const original=appToSnapshot(initial);
   const modified=await build(cp(original),cp(initial));
   if(!modified||typeof modified!=='object'||!modified.snapshot)throw inputError('missing write proposal');
   // No direct changes to live records or app parts. Prepare all parts before WAL.
   const desiredApp=snapshotToApp(modified.snapshot,{weeklyOptions:initial.weeklyOptions});
   await this.journal.applyLocal(desiredApp);
   return modified.result??{status:'stored'};
  });
 }
 async createRecord(record){
  return this._mutate(async snapshot=>{
   const id=record?.id;
   if(typeof id!=='string'||!id||own(snapshot.records,id)||own(snapshot.tombstones,id))throw inputError('record already exists or has a tombstone');
   snapshot.records[id]=cp(record);
   return {snapshot,result:{status:'created',id}};
  });
 }
 async changeRecord(id,transform){
  if(typeof transform!=='function')throw inputError('synchronous record transform required');
  return this._mutate(async snapshot=>{
   if(!own(snapshot.records,id))throw inputError('cannot edit absent/deleted record');
   const original=cp(snapshot.records[id]);
   const candidate=transform(cp(original));
   if(candidate instanceof Promise)throw inputError('async transforms are forbidden');
   if(!candidate||candidate.id!==id)throw inputError('record identity may not change');
   if(!equalState(candidate,original))snapshot.records[id]=cp(candidate);
   return {snapshot,result:{status:'edited',id,changed:!equalState(candidate,original)}};
  });
 }
 async deleteRecord(id,deletedAt){
  return this._mutate(async snapshot=>{
   if(!okayDate(deletedAt))throw inputError('valid deletedAt required');
   if(!own(snapshot.records,id))throw inputError('cannot delete absent record');
   const previous=cp(snapshot.records[id]);
   const next=markDeleted(snapshot,id,deletedAt);
   return {snapshot:next,result:{status:'deleted',id,previous,tombstone:cp(next.tombstones[id])}};
  });
 }
 async undoDelete({id,previous,expectedTombstone}){
  return this._mutate(async snapshot=>{
   if(!own(snapshot.tombstones,id)||!equalState(snapshot.tombstones[id],expectedTombstone))throw inputError('deletion no longer matches original undo');
   if(previous?.id!==id||own(snapshot.records,id))throw inputError('invalid undo source');
   return {snapshot:reAdd(snapshot,cp(previous)),result:{status:'restored',id}};
  });
 }
 async undoEdit({id,expectedCurrent,previous}){
  return this._mutate(async snapshot=>{
   if(!own(snapshot.records,id)||!equalState(snapshot.records[id],expectedCurrent))throw inputError('record changed since undo offer');
   if(previous?.id!==id)throw inputError('invalid undo record');
   snapshot.records[id]=cp(previous);
   return {snapshot,result:{status:'reverted',id}};
  });
 }
 async setWeeklyStatuses(statuses){
  return this._mutate(async snapshot=>{
   snapshot.settings.weeklyOptions={statuses:cp(statuses)};
   return {snapshot,result:{status:'weekly-saved'}};
  });
 }
 async setDeviceOnlyWeeklyOpen(open){
  if(typeof open!=='boolean')throw inputError('weekly open must be boolean');
  return this.withLock(async()=>{
   // Device-only preference, no cloud effect; still read under the lock, and
   // refuse if any app record has been modified behind the journal's back.
   await this.journal.current();
   const week=await this.app.readPart('weeklyOptions');
   await this.app.writePart('weeklyOptions',{...week,open});
   return {status:'device-only',open};
  });
 }
 async receiveRemote(revision,snapshot){return this.withLock(()=>this.journal.receiveRemote(revision,snapshot))}
 async acknowledgePush(details){return this.withLock(()=>this.journal.acknowledgePush(details))}
 async recover(){return this.withLock(()=>this.journal.recover())}
 async status(){return this.withLock(()=>this.journal.status())}
 async getSnapshot(){return this.withLock(async()=>{
  await this.journal.current();return appToSnapshot(await this.app.readAll());
 })}
 // Refuse bulk replacement until deletion semantics and first-use confirmation
 // have a separate, reviewed implementation.
 async replaceFromBackup(){throw inputError('backup replacement must use a separately reviewed, explicit destructive flow')}
}
