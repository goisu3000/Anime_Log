import {buildConflictReview,applyConflictChoices,rankEditorRows} from './conflict-resolution-plan.mjs';
import {appToSnapshot,snapshotToApp} from './app-bridge.mjs';
import {canonical,decodeFormalBackup,validateFormalApp} from './formal-storage.mjs';
import {encryptSnapshot,decryptSnapshot} from '../sync-core.mjs';
import {assessEncryptedPut} from '../shared/wire-limits.mjs';
import {confirmTransportAndCommitVault} from './v401-confirmed-worker-vault-commit.mjs';
const cp=structuredClone,same=(a,b)=>canonical(a)===canonical(b),stop=x=>{throw Error('CONFLICT_RESOLUTION_STOP:'+x)};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),x=>x.toString(16).padStart(2,'0')).join('');
// A local device only, with its existing authorized transport. Never peer keys.
export function createConflictResolution({vault,transport,isPaused,isQuiescent,withQuiesced,saveAndReadBackBackup}={}){
 if(!vault?.refresh||!transport?.request||typeof isPaused!=='function'||typeof isQuiescent!=='function'||typeof withQuiesced!=='function'||typeof saveAndReadBackBackup!=='function')stop('VERIFIED_LOCAL_DEVICE_REQUIRED');
 const identity=()=>({api:transport.apiRoot,origin:transport.origin,box:transport.boxId,device:transport.device,key:[...transport.masterKey]}),pinned=cp(identity());
 let phase='new',busy=false,capture,remote,plan,token,final;
 const context=()=>{if(!same(identity(),pinned)||!isPaused()||!isQuiescent())stop('DEVICE_CONTEXT_CHANGED')};
 async function act(fn){if(busy)stop('BUSY');busy=true;try{return await withQuiesced(async()=>{try{context();return await fn()}catch(error){phase='stopped';if(vault.getState()!=='ACTIVE')stop('RELOAD_REQUIRED');if(/^(CONFLICT_RESOLUTION_STOP|CONFLICT_REVIEW_STOP):[A-Z_]+$/.test(error?.message??''))throw error;stop('KEEP_RECORDS_AND_REVIEW_AGAIN')}})}finally{busy=false}}
 async function local(){context();await vault.refresh();context();const raw=vault.readCurrent(),checkpoint=vault.readSyncCheckpoint(),revision=vault.readRevision();if(!checkpoint||checkpoint.serverRevision<1||vault.getState()!=='ACTIVE')stop('CONFIRMED_LOCAL_HISTORY_REQUIRED');return {raw,snapshot:appToSnapshot(raw),checkpoint,revision}}
 async function getRemote(min){context();const response=await transport.request('GET');context();const {revision,payload}=response.data??{};
  if(response.status!==200||!Number.isSafeInteger(revision)||revision<min||!payload)stop('REMOTE_REVISION_OR_AUTH');
  return {revision,snapshot:await decryptSnapshot(payload,{masterKey:transport.masterKey,boxId:transport.boxId,revision})};
 }
 async function unchanged(expected=capture){const now=await local();if(!same(now,expected))stop('LOCAL_CHANGED');return now}
 async function remoteUnchanged(){const now=await getRemote(capture.checkpoint.serverRevision);if(!same(now,remote))stop('SERVER_CHANGED')}
 function verifiedTransport(snapshot,revision){return {boxId:transport.boxId,masterKey:transport.masterKey,request:(...args)=>transport.request(...args),snapshot:()=>cp(snapshot),checkpoint:()=>({local:cp(snapshot),baseline:cp(snapshot),revision})}}
 return Object.freeze({get phase(){return phase},
  async review(){return act(async()=>{
   if(phase!=='new')stop('NEW_REVIEW_REQUIRED');capture=await local();remote=await getRemote(capture.checkpoint.serverRevision);await unchanged();
   plan=buildConflictReview(capture.checkpoint.snapshot,capture.snapshot,remote.snapshot);token=await digest({capture,remote});phase='reviewed';
   return {reviewToken:token,units:cp(plan.units),automaticResolutions:cp(plan.automaticResolutions),conflictCount:plan.conflictCount,needsSelection:plan.units.length>0};
  })},
  async saveBackup({reviewToken}={}){return act(async()=>{
   if(phase!=='reviewed'||reviewToken!==token)stop('REVIEW_REQUIRED');await unchanged();await remoteUnchanged();
   const raw=capture.raw,backup={app:'ANI:LOG',version:4,format:'encrypted-primary-portable',exportedAt:new Date().toISOString(),state:raw,items:Object.values(raw.records),weeklyOptions:raw.weeklyOptions,
    conflictRecovery:{reviewToken:token,revision:capture.revision,checkpoint:capture.checkpoint,remote}};
   const bytes=new TextEncoder().encode(JSON.stringify(backup));if(bytes.length>12000000)stop('BACKUP_CAPACITY');
   const result=await saveAndReadBackBackup({bytes:new Uint8Array(bytes)});
   if(result?.savedConfirmed!==true||!(result.readBack instanceof Uint8Array)||result.readBack.length!==bytes.length||result.readBack.some((x,i)=>x!==bytes[i]))stop('BACKUP_NOT_VERIFIED');
   if(!same(decodeFormalBackup(new TextDecoder('utf-8',{fatal:true}).decode(result.readBack)),raw))stop('BACKUP_NOT_RESTORABLE');
   await unchanged();await remoteUnchanged();phase='backed-up';return {verified:true};
  })},
  async previewRanking({reviewToken,choices,unitId,membershipSource}={}){return act(async()=>{
   if(phase!=='backed-up'||reviewToken!==token)stop('BACKUP_REQUIRED');await unchanged();await remoteUnchanged();return rankEditorRows({review:plan,base:capture.checkpoint.snapshot,local:capture.snapshot,remote:remote.snapshot,choices,unitId,membershipSource});
  })},
  async choose({reviewToken,choices,approved=false}={}){return act(async()=>{
   if(phase!=='backed-up'||reviewToken!==token||approved!==true)stop('BACKUP_AND_EXPLICIT_CHOICES_REQUIRED');await unchanged();await remoteUnchanged();
   final=applyConflictChoices({review:plan,base:capture.checkpoint.snapshot,local:capture.snapshot,remote:remote.snapshot,choices});
   validateFormalApp(snapshotToApp(final,{weeklyOptions:capture.raw.weeklyOptions}));phase='chosen';return {ready:true,choices:plan.units.length};
  })},
  async commit({reviewToken,approved=false}={}){return act(async()=>{
   if(phase!=='chosen'||reviewToken!==token||approved!==true)stop('FINAL_CONFIRMATION_REQUIRED');await unchanged();await remoteUnchanged();
   const saved=await vault.commitApp({candidate:snapshotToApp(final,{weeklyOptions:capture.raw.weeklyOptions}),expectedRevision:capture.revision});
   if(saved.phase!=='FORMAL_COMMIT_READBACK_VERIFIED')stop('LOCAL_SAVE_NOT_VERIFIED');const expected=await local();
   if(!same(expected.snapshot,final)||!same(expected.checkpoint,capture.checkpoint))stop('LOCAL_SAVE_MISMATCH');await remoteUnchanged();
   const revision=remote.revision+1,payload=await encryptSnapshot(final,{masterKey:transport.masterKey,boxId:transport.boxId,revision});
   if(!assessEncryptedPut({baseRevision:remote.revision,payload}).ok)stop('PAYLOAD_CAPACITY');await unchanged(expected);
   phase='committing';const answer=await transport.request('PUT',{baseRevision:remote.revision,payload});
   if(answer.status===409||answer.data?.ok!==true||answer.data.revision!==revision)stop('ACK_UNCONFIRMED');await unchanged(expected);
   const after=await getRemote(revision);if(after.revision!==revision||!same(after.snapshot,final))stop('REMOTE_READBACK_CHANGED');
   const result=await confirmTransportAndCommitVault({vault,transport:verifiedTransport(final,revision),syncResult:{status:'synced',revision},expectedVaultRevision:expected.revision});
   if(result.phase!=='CONFIRMED_SYNC_ATOMIC_WAL_READBACK_VERIFIED')stop('LOCAL_CONFIRMATION_NOT_VERIFIED');
   const current=await local(),latest=await getRemote(revision);
   if(current.checkpoint.serverRevision!==revision||!same(current.snapshot,final)||!same(current.checkpoint.snapshot,final)||latest.revision!==revision||!same(latest.snapshot,final))stop('FINAL_CONFIRMATION_CHANGED');
   await unchanged(current);phase='complete';return {durable:true,serverRevision:revision,peerConfirmed:false};
  })},
  async recheckNormally(){return act(async()=>{
   if(phase!=='reviewed'||plan.units.length)stop('UNRESOLVED_CHOICES');await unchanged();
   const point=transport.checkpoint();if(point.revision!==capture.checkpoint.serverRevision||!same(point.baseline,capture.checkpoint.snapshot))stop('FRESH_TRANSPORT_REQUIRED');
   transport.stage(capture.snapshot);const ack=await transport.sync({maxRetries:1});
   if(ack.status!=='synced'){phase='stopped';return {durable:false,status:ack.status}}await unchanged();
   if(ack.revision>capture.checkpoint.serverRevision)await confirmTransportAndCommitVault({vault,transport,syncResult:ack,expectedVaultRevision:capture.revision});
   else if(!same(transport.snapshot(),capture.snapshot))stop('NOOP_MISMATCH');
   phase='complete';return {durable:true,peerConfirmed:false,serverRevision:ack.revision};
  })}
 });
}
