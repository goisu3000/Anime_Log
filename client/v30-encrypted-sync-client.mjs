/* ANI:LOG Sync v3.0: actual Worker HTTP contract + encrypted 3-way merge, LOCAL E2E prototype.
 * This is an in-memory client. DO NOT connect to real user records or deploy as a production app.
 * Checkpoints, crash-safe UI commits, auth vault, CORS/CSRF hardening need separate production integration.
 */
import {blankSnapshot,validateSnapshot,mergeSnapshots,encryptSnapshot,decryptSnapshot} from '../sync-core.mjs';
import {assertMixedMap,assertMixedTombstones} from './v29-mixed-record-gate.mjs';
import {assessEncryptedPut} from '../shared/wire-limits.mjs';
const clone=x=>structuredClone(x);
// Treat JSON object-key order as irrelevant: avoid wasted encrypted uploads/revisions.
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':
  x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const same=(a,b)=>canonical(a)===canonical(b);
const checked=s=>{validateSnapshot(s);assertMixedMap(s.records);assertMixedTombstones(s.tombstones,s.records);return s};
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const fakeHttps=u=>{const url=new URL(u);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS API endpoint required');return url.href.replace(/\/$/,'')};
export class SyncHttpFailure extends Error{constructor(status,code){super(code);this.name='SyncHttpFailure';this.status=status;this.code=code}}

export class V30EncryptedClient{
 constructor({fetcher,apiRoot,origin,boxId,device,masterKey,local=blankSnapshot(),baseline=blankSnapshot(),revision=0}={}){
  if(typeof fetcher!=='function'||typeof origin!=='string'||!/^https:\/\//.test(origin)||!ID.test(boxId)||
     !ID.test(device?.deviceId)||!TOKEN.test(device?.deviceToken)||!(masterKey instanceof Uint8Array)||masterKey.length!==32||
     !Number.isSafeInteger(revision)||revision<0)throw Error('invalid test sync credentials');
  checked(local);checked(baseline);
  this.fetcher=fetcher;this.apiRoot=fakeHttps(apiRoot);this.origin=origin;this.boxId=boxId;
  this.device={deviceId:device.deviceId,deviceToken:device.deviceToken};this.masterKey=new Uint8Array(masterKey);
  this.local=clone(local);this.baseline=clone(baseline);this.revision=revision;
  this.generation=0;this.busy=false;
 }
 snapshot(){return clone(this.local)}
 checkpoint(){return {local:clone(this.local),baseline:clone(this.baseline),revision:this.revision}}
 stage(next){checked(next);this.local=clone(next);this.generation++;return this.snapshot()}
 async request(method,body){
  const headers={Origin:this.origin,Authorization:`Bearer ${this.device.deviceToken}`,'X-Device-Id':this.device.deviceId};
  if(body!==undefined)headers['Content-Type']='application/json';
  const result=await this.fetcher(`${this.apiRoot}/v1/boxes/${this.boxId}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!result||typeof result.status!=='number')throw Error('invalid worker response');
  const data=await result.json();
  if(result.status===409)return {status:409,data};
  if(!result.ok)throw new SyncHttpFailure(result.status,data.error||'worker_error');
  return {status:result.status,data};
 }
 async #getRemote(){
  const answer=await this.request('GET');
  const {revision,payload}=answer.data;
  if(!Number.isSafeInteger(revision)||revision<0||revision<this.revision)throw Error('server revision rollback or malformed response');
  const snapshot=revision===0?(()=>{if(payload!==null)throw Error('invalid empty server state');return blankSnapshot()})():
    await decryptSnapshot(payload,{masterKey:this.masterKey,boxId:this.boxId,revision});
  return {revision,snapshot:checked(snapshot)};
 }
 // If a mutation occurs during await, NEVER replace it with a stale result.
 // Failed/uncertain PUT deliberately keeps local/baseline/revision unchanged.
 async sync({maxRetries=3}={}){
  if(this.busy)throw Error('sync already in progress');
  if(!Number.isInteger(maxRetries)||maxRetries<1||maxRetries>5)throw Error('invalid retry count');
  this.busy=true;
  const generation=this.generation,local=clone(this.local),baseline=clone(this.baseline),known=this.revision;
  try{
   for(let attempt=1;attempt<=maxRetries;attempt++){
    let remote;
    try{remote=await this.#getRemote()}catch(err){return {status:'unavailable',cause:err,attempts:attempt}}
    if(this.generation!==generation)return {status:'local-changed',attempts:attempt};
    const merged=mergeSnapshots(baseline,local,remote.snapshot);
    if(!merged.ok)return {status:'conflict',conflicts:merged.conflicts,attempts:attempt};
    try{checked(merged.merged)}catch(err){return {status:'blocked',cause:err,attempts:attempt}}
    if(same(merged.merged,remote.snapshot)){
     this.local=clone(merged.merged);this.baseline=clone(merged.merged);this.revision=remote.revision;
     return {status:'synced',revision:this.revision,uploaded:false,attempts:attempt};
    }
    let payload;
    try{payload=await encryptSnapshot(merged.merged,{masterKey:this.masterKey,boxId:this.boxId,revision:remote.revision+1})}
    catch(err){return {status:'unavailable',cause:err,attempts:attempt}}
    if(this.generation!==generation)return {status:'local-changed',attempts:attempt};
    // Fail before the network request so a large encrypted payload never consumes
    // Worker/D1 quota. Keep the local queue, baseline and last confirmed revision.
    const capacity=assessEncryptedPut({baseRevision:remote.revision,payload});
    if(!capacity.ok)return {status:'too-large',reason:capacity.reason,bytes:capacity.bytes,maxBytes:capacity.maxBytes,attempts:attempt};
    let answer;
    try{answer=await this.request('PUT',{baseRevision:remote.revision,payload})}
    catch(err){return {status:err instanceof SyncHttpFailure?'blocked':'unconfirmed',cause:err,attempts:attempt}}
    if(this.generation!==generation)return {status:'local-changed',attempts:attempt};
    if(answer.status===409)continue;
    if(answer.data.revision!==remote.revision+1||answer.data.ok!==true)return {status:'unconfirmed',attempts:attempt};
    this.local=clone(merged.merged);this.baseline=clone(merged.merged);this.revision=answer.data.revision;
    return {status:'synced',revision:this.revision,uploaded:true,attempts:attempt};
   }
   return {status:'retry-later',revision:known,attempts:maxRetries};
  }finally{this.busy=false}
 }
}
