/* ANI:LOG PRIVATE development / QA experiment only.
 * An origin-wide Web Locks presence protocol for cooperating NEW tab instances.
 * NOT a proof about older/uninstrumented tabs or an authorization to prune WAL.
 * No IDB, credentials, localStorage, network or original user records touched.
 */
const skipped=reason=>Object.freeze({rebased:false,reason});
const makeDeferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
export function createPrivateCrossTabMaintenanceFence({locks,lockName,localIdle=()=>false}={}){
 if(!/^anilog-private-wal-maintenance:[a-z0-9-]{1,48}$/.test(lockName??''))throw Error('PRIVATE_FENCE_SCOPE_REQUIRED');
 const supported=typeof locks?.request==='function';
 let closed=false,holding=false,transitioning=false,lease=null;
 const status=()=>Object.freeze({supported,closed,holding,transitioning});
 async function begin(){
  if(closed)return false;
  if(!supported)return false; // Fail closed, without a fallback lock.
  if(lease)return lease.entered.promise;
  const entered=makeDeferred(),release=makeDeferred();
  const next={entered,release,task:null};lease=next;
  // Keep the shared lock for the entire lifetime of an enrolled tab.
  // The callback is invoked only once the browser actually grants the lock.
  next.task=Promise.resolve().then(()=>locks.request(lockName,{mode:'shared'},async lock=>{
   if(!lock){entered.resolve(false);return}
   holding=true;entered.resolve(true);
   try{await release.promise}finally{holding=false}
  })).catch(()=>{entered.resolve(false);holding=false});
  return entered.promise;
 }
 async function relinquish(){
  const own=lease;if(!own)return;
  own.release.resolve();await own.task;
  if(lease===own)lease=null;
 }
 async function withExclusiveIfNoPeers(fn){
  if(typeof fn!=='function')throw Error('PRIVATE_FENCE_CALLBACK_REQUIRED');
  if(!supported)return skipped('WEB_LOCKS_UNAVAILABLE');
  if(closed||transitioning||!holding||!lease)return skipped('TAB_NOT_ENROLLED');
  // Do not give up our reader presence while local UI edits or sync are open.
  if(!localIdle())return skipped('LOCAL_INPUT_OR_SYNC_PENDING');
  transitioning=true;
  try{
   await relinquish();
   // ifAvailable never waits for a peer and never evicts its shared lease.
   const outcome=await locks.request(lockName,{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)return skipped('PEER_TAB_PRESENT');
    if(closed||!localIdle())return skipped('LOCAL_STATE_CHANGED');
    return fn();
   });
   return outcome;
  }finally{
   // Before accepting a new operation, restore our reader lease. An arriving
   // peer may get its shared lease first; that prevents a later exclusive cutover.
   if(!closed)await begin();
   transitioning=false;
  }
 }
 async function close(){closed=true;await relinquish()}
 return Object.freeze({begin,withExclusiveIfNoPeers,close,status});
}

// Product lifecycle adapter for the same cooperating-tab presence protocol.
// Every new product tab enrolls, including tabs with automatic maintenance OFF.
// Old/uninstrumented tabs remain invisible; this does not replace migration consent.
export function createProductWalTabCoordinator({locks,events,lockName,localIdle=()=>false}={}){
 const supported=typeof locks?.request==='function'&&typeof events?.addEventListener==='function';
 let active=true,exclusive=false,fence=null,ready=Promise.resolve(false),closing=Promise.resolve();
 const idle=()=>{try{return active&&localIdle()===true}catch{return false}};
 function resume(){
  active=true;
  ready=closing.then(()=>{
   if(!active||!supported)return false;
   if(!fence)fence=createPrivateCrossTabMaintenanceFence({locks,lockName,localIdle:idle});
   return fence.begin();
  });
  return ready;
 }
 function suspend(){
  active=false;exclusive=false;
  const old=fence;fence=null;
  closing=closing.then(()=>old?.close()).catch(()=>{});
  ready=Promise.resolve(false);
 }
 const hide=()=>suspend(),show=()=>{void resume()};
 events?.addEventListener?.('pagehide',hide);
 events?.addEventListener?.('pageshow',show);
 void resume();
 return Object.freeze({
  async withForeground(fn){
   // Unsupported Web Locks disables maintenance, not ordinary saving.
   if(supported&&(!await ready||!active||!fence?.status().holding))throw Error('WAL_TAB_PRESENCE_NOT_READY');
   return fn();
  },
  async withExclusiveIfNoPeers(fn){
   if(!supported||!active||!await ready||!fence)return skipped('TAB_NOT_ENROLLED');
   const own=fence;
   return own.withExclusiveIfNoPeers(async()=>{
    if(!active||own!==fence)return skipped('TAB_NOT_ENROLLED');
    exclusive=true;
    try{return await fn()}finally{exclusive=false}
   });
  },
  isExclusive:()=>supported&&active&&exclusive,
  status:()=>Object.freeze({supported,active,exclusive,holding:fence?.status().holding===true}),
  async close(){events?.removeEventListener?.('pagehide',hide);events?.removeEventListener?.('pageshow',show);suspend();await closing}
 });
}
