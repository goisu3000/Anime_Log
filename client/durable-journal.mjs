/* ANI:LOG sync POC v0.6: fail-closed, crash-recoverable MULTI-KEY local write plan.
 * This module is NOT attached to the ANI:LOG production app. No production I/O
 * takes place unless an external caller explicitly constructs adapters.
 *
 * Protocol: atomic durable intent (IndexedDB) -> app localStorage keys ->
 * atomic durable completion (IndexedDB). Recovery rolls forward ONLY if all
 * observed key values match the expected before/after variants. Any unknown
 * change blocks instead of overwriting user data.
 *
 * Caller MUST serialize all app modifications under an origin-wide lock and
 * route every app edit through the journal. Other tabs/legacy versions writing
 * directly to app keys are NOT safe for transparent automatic integration.
 */
import {blankSnapshot, validateSnapshot, mergeSnapshots} from '../sync-core.mjs';
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';

const PARTS=['records','tombstones','weeklyOptions'];
const clone=x=>structuredClone(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function stable(v){
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
export const equalState=(a,b)=>stable(a)===stable(b);
const assertRev=r=>{if(!Number.isSafeInteger(r)||r<0)throw Error('invalid revision')};
function makeSnapshot(app){return appToSnapshot({records:app.records,tombstones:app.tombstones,weeklyOptions:app.weeklyOptions})}
function validateCheckpoint(doc){
 if(!object(doc)||doc.format!==1||!Number.isSafeInteger(doc.generation)||doc.generation<0)throw Error('invalid durable checkpoint');
 const c=doc.committed;
 if(!object(c))throw Error('missing durable committed state');
 assertRev(c.revision);validateSnapshot(c.baseline);validateSnapshot(c.desired);
 if(doc.intent!==null){
  const i=doc.intent;
  if(!object(i)||!object(i.before)||!object(i.after)||!object(i.next))throw Error('bad durable intent');
  for(const p of PARTS){if(!(p in i.before)||!(p in i.after))throw Error('missing journal part')}
  assertRev(i.next.revision);validateSnapshot(i.next.baseline);validateSnapshot(i.next.desired);
 }
 return doc;
}
export class RecoveryBlocked extends Error{
 constructor(reason){super(reason);this.name='RecoveryBlocked';this.code='RECOVERY_BLOCKED'}
}
export class MemoryJournalStore{
 constructor(){this.data=null;this.failBeforeWrite=false;this.failAfterWrite=false}
 async load(){return clone(this.data)}
 async compareAndSet(expectedGeneration,next){
  const gen=this.data?.generation??null;
  if(gen!==expectedGeneration)return false;
  if(this.failBeforeWrite){this.failBeforeWrite=false;throw Error('simulated-journal-before-write')}
  this.data=clone(next);
  if(this.failAfterWrite){this.failAfterWrite=false;throw Error('simulated-journal-after-write')}
  return true;
 }
}
/* IndexedDB adapter: one full checkpoint is committed in one readwrite tx.
 * Tested structurally only; real browser IndexedDB behavior remains unverified.
 */
export class IndexedDBJournalStore{
 constructor({indexedDB,dbName='anilog-sync-journal-TEST-v06'}={}){
  if(!indexedDB)throw Error('IndexedDB unavailable');this.indexedDB=indexedDB;this.dbName=dbName;
 }
 async _open(){
  return new Promise((resolve,reject)=>{
   const request=this.indexedDB.open(this.dbName,1);
   request.onupgradeneeded=()=>{request.result.createObjectStore('checkpoints')};
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>resolve(request.result);
   request.onblocked=()=>reject(Error('IndexedDB upgrade blocked'));
  });
 }
 async load(){
  const db=await this._open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('checkpoints','readonly'),req=tx.objectStore('checkpoints').get('main');
   let value;
   req.onsuccess=()=>{value=req.result??null};req.onerror=()=>reject(req.error);
   tx.oncomplete=()=>resolve(value??null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('IDB transaction aborted'));
  })}finally{db.close()}
 }
 async compareAndSet(expectedGeneration,next){
  const db=await this._open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('checkpoints','readwrite'),store=tx.objectStore('checkpoints');
   let outcome=false,settled=false;
   const fail=err=>{if(!settled){settled=true;reject(err)}};
   const req=store.get('main');
   req.onsuccess=()=>{
    const actual=req.result?.generation??null;
    if(actual!==expectedGeneration)return;
    outcome=true;
    store.put(clone(next),'main');
   };
   req.onerror=()=>fail(req.error);
   tx.oncomplete=()=>{if(!settled){settled=true;resolve(outcome)}};
   tx.onabort=()=>fail(tx.error??Error('IDB transaction aborted'));
   tx.onerror=()=>fail(tx.error??Error('IDB transaction failed'));
  })}finally{db.close()}
 }
}

/* Injectable app-store for tests; a browser adapter must expose exactly these
 * three parts and must persist them, not merely mutate an in-memory object.
 */
export class MemoryAppParts{
 constructor({records={},tombstones={},weeklyOptions={open:false,statuses:['watching']}}={}){
  this.parts=clone({records,tombstones,weeklyOptions});this.writes=0;
  this.throwBeforeWriteAt=0;this.throwAfterWriteAt=0;
 }
 async readPart(part){if(!PARTS.includes(part))throw Error('unknown part');return clone(this.parts[part])}
 async writePart(part,value){
  if(!PARTS.includes(part))throw Error('unknown part');
  this.writes++;
  if(this.writes===this.throwBeforeWriteAt)throw Error('simulated-power-loss-before-key-write');
  this.parts[part]=clone(value);
  if(this.writes===this.throwAfterWriteAt)throw Error('simulated-power-loss-after-key-write');
 }
 async readAll(){return {records:await this.readPart('records'),tombstones:await this.readPart('tombstones'),weeklyOptions:await this.readPart('weeklyOptions')}}
}

/* Strict test-only localStorage adapter. Installed app may default weeklyOptions
 * when missing; that legacy fallback MUST be reviewed before integration.
 * Does not create or touch any real localStorage on import.
 */
export class LocalStorageAppParts{
 constructor(storage,keys){
  if(!storage||!keys||PARTS.some(p=>typeof keys[p]!=='string'))throw Error('explicit storage keys required');
  this.storage=storage;this.keys=keys;
 }
 async readPart(part){
  if(!PARTS.includes(part))throw Error('unknown part');
  const raw=this.storage.getItem(this.keys[part]);
  if(raw===null)throw new RecoveryBlocked('missing app storage part: '+part);
  try{return JSON.parse(raw)}catch{throw new RecoveryBlocked('corrupt app storage part: '+part)}
 }
 async writePart(part,value){
  if(!PARTS.includes(part))throw Error('unknown part');
  this.storage.setItem(this.keys[part],JSON.stringify(value));
 }
 async readAll(){return {records:await this.readPart('records'),tombstones:await this.readPart('tombstones'),weeklyOptions:await this.readPart('weeklyOptions')}}
}

/* Do not compare weekly UI's open/closed value: it is device-local and may
 * change while sync is idle. Preserve all other weekly properties at commit.
 */
function comparable(part,value){
 if(part!=='weeklyOptions')return value;
 return {statuses:value?.statuses};
}
function writeValue(part,expected,actual){
 if(part!=='weeklyOptions')return clone(expected);
 return {...clone(actual),statuses:clone(expected.statuses)};
}
export class DurableSyncJournal{
 constructor({store,app}){if(!store||!app)throw Error('stores required');this.store=store;this.app=app}
 async initialize({boxId,baseline=blankSnapshot(),revision=0}={}){
  if(typeof boxId!=='string'||boxId.length<8)throw Error('box ID required');
  assertRev(revision);validateSnapshot(baseline);
  const desired=makeSnapshot(await this.app.readAll());
  const first={format:1,generation:0,boxId,committed:{revision,baseline:clone(baseline),desired},intent:null};
  if(!await this.store.compareAndSet(null,first))throw Error('checkpoint already exists');
  return this.status();
 }
 async _loadClean(){
  const doc=await this.store.load();
  if(!doc)throw Error('journal not initialized');
  validateCheckpoint(doc);
  if(doc.intent)throw new RecoveryBlocked('unfinished intent: recover before edits or sync');
  const current=makeSnapshot(await this.app.readAll());
  if(!equalState(current,doc.committed.desired))throw new RecoveryBlocked('unsupervised app changes; refuse to overwrite');
  return {doc,current};
 }
 async status(){
  const {doc}=await this._loadClean();
  return {revision:doc.committed.revision,dirty:!equalState(doc.committed.desired,doc.committed.baseline),generation:doc.generation};
 }
 async recover(){
  const doc=await this.store.load();
  if(!doc)throw Error('journal not initialized');
  validateCheckpoint(doc);
  if(!doc.intent)return this.status();
  // Read ALL parts first. On any unexpected value, do not overwrite even one.
  const actual=await this.app.readAll(),intent=doc.intent;
  for(const part of PARTS){
   const before=comparable(part,intent.before[part]),after=comparable(part,intent.after[part]);
   const observed=comparable(part,actual[part]);
   if(!equalState(observed,before)&&!equalState(observed,after))
    throw new RecoveryBlocked('foreign app edit during unfinished transaction: '+part);
  }
  for(const part of PARTS){
   const observed=comparable(part,actual[part]),expected=comparable(part,intent.after[part]);
   if(!equalState(observed,expected))await this.app.writePart(part,writeValue(part,intent.after[part],actual[part]));
  }
  const next={...doc,generation:doc.generation+1,committed:clone(intent.next),intent:null};
  if(!await this.store.compareAndSet(doc.generation,next))throw new RecoveryBlocked('journal changed during recovery');
  return this.status();
 }
 async _transact(nextParts,nextCommitted,kind){
  const {doc}=await this._loadClean();
  const before=await this.app.readAll();
  const after=clone(nextParts);
  makeSnapshot(after);validateSnapshot(nextCommitted.baseline);validateSnapshot(nextCommitted.desired);assertRev(nextCommitted.revision);
  if(!equalState(makeSnapshot(after),nextCommitted.desired))throw Error('inconsistent prepared desired snapshot');
  const prepared={...doc,generation:doc.generation+1,intent:{kind,before,after,next:clone(nextCommitted)}};
  if(!await this.store.compareAndSet(doc.generation,prepared))throw new RecoveryBlocked('concurrent journal writer');
  // Crash after this point leaves a durable intent. Restart must call recover.
  return this.recover();
 }
 async applyLocal(nextParts){
  const {doc}=await this._loadClean(),desired=makeSnapshot(nextParts);
  // Legacy physical deletes / backup replacement are NOT valid sync deletes.
  // Require a durable tombstone for every previously known work, or stop.
  const previous=doc.committed.desired;
  const known=new Set([...Object.keys(previous.records),...Object.keys(previous.tombstones)]);
  for(const id of known){
   if(!Object.hasOwn(desired.records,id)&&!Object.hasOwn(desired.tombstones,id))
    throw new RecoveryBlocked('missing work without tombstone: '+id);
  }
  if(equalState(desired,previous))return this.status();
  return this._transact(nextParts,{...clone(doc.committed),desired},'local-edit');
 }
 async receiveRemote(remoteRevision,remoteSnapshot){
  assertRev(remoteRevision);validateSnapshot(remoteSnapshot);
  const {doc}=await this._loadClean(),c=doc.committed;
  if(remoteRevision<c.revision)throw new RecoveryBlocked('server revision rollback');
  if(remoteRevision===c.revision){
   if(!equalState(c.baseline,remoteSnapshot))throw new RecoveryBlocked('server payload changed without revision');
   return {status:'same',...await this.status()};
  }
  const merged=mergeSnapshots(c.baseline,c.desired,remoteSnapshot);
  if(!merged.ok)return {status:'conflict',conflicts:merged.conflicts};
  const current=await this.app.readAll();
  const candidate=snapshotToApp(merged.merged,{weeklyOptions:current.weeklyOptions});
  await this._transact(candidate,{revision:remoteRevision,baseline:clone(remoteSnapshot),desired:clone(merged.merged)},'remote-merge');
  return {status:'merged',...await this.status()};
 }
 async acknowledgePush({baseRevision,sentSnapshot,serverRevision}){
  assertRev(baseRevision);assertRev(serverRevision);validateSnapshot(sentSnapshot);
  if(serverRevision<=baseRevision)throw Error('non-monotonic server ACK');
  const {doc}=await this._loadClean(),c=doc.committed;
  if(c.revision!==baseRevision)throw new RecoveryBlocked('stale ACK base revision');
  // The server must have received a snapshot representing the local desired at
  // the moment the request was sent. Later local edits remain in desired.
  const next={...doc,generation:doc.generation+1,committed:{revision:serverRevision,baseline:clone(sentSnapshot),desired:clone(c.desired)}};
  if(!await this.store.compareAndSet(doc.generation,next))throw new RecoveryBlocked('concurrent journal ACK');
  return this.status();
 }
 async current(){const {doc}=await this._loadClean();return clone(doc.committed)}
}

/* A single attempt to reconcile one journal with an injectable remote server.
 * Network errors are retry-later, NEVER acknowledge an unconfirmed write.
 * All server responses are plaintext simulation in v0.6; production must use
 * the authenticated ciphertext Worker path, including strict rev validation.
 */
export async function syncJournalOnce(journal,server,{maxAttempts=3}={}){
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const c=await journal.current();let remote;
  try{remote=await server.read()}catch{return {status:'offline',attempts:attempt+1}}
  if(!remote||!Number.isSafeInteger(remote.revision))return {status:'invalid-server-response'};
  const merge=await journal.receiveRemote(remote.revision,remote.snapshot);
  if(merge.status==='conflict')return {status:'conflict',conflicts:merge.conflicts,attempts:attempt+1};
  const updated=await journal.current();
  if(equalState(updated.desired,updated.baseline))return {status:'synced',attempts:attempt+1,uploaded:false};
  let answer;
  try{answer=await server.cas(updated.revision,updated.desired)}catch{return {status:'retry-later',reason:'ambiguous-ack',attempts:attempt+1}}
  if(answer.status===409)continue;
  if(answer.status!==200||!Number.isSafeInteger(answer.revision)||answer.revision<=updated.revision)
   return {status:'invalid-server-response',attempts:attempt+1};
  await journal.acknowledgePush({baseRevision:updated.revision,sentSnapshot:updated.desired,serverRevision:answer.revision});
  return {status:'synced',attempts:attempt+1,uploaded:true};
 }
 return {status:'retry-later',reason:'revision-contention',attempts:maxAttempts};
}
