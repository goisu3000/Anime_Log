// Schedule the existing durable sync session. No polling, no network while OFF.
export function createAutomaticSync({syncOnce,onState=()=>{},events=globalThis,document=globalThis.document,
 online=()=>globalThis.navigator?.onLine!==false,setTimer=setTimeout,clearTimer=clearTimeout,debounceMs=800,focusCooldownMs=15000,now=Date.now}={}){
 if(typeof syncOnce!=='function')throw Error('SYNC_SESSION_REQUIRED');
 let stopped=false,timer=null,running=false,dirty=false,followUp=false,lastCheck=-Infinity,blocked=false,lastConflicts=[];
 const state=(phase,extra={})=>onState({phase,...extra});
 const clear=()=>{if(timer!==null){clearTimer(timer);timer=null}};
 const schedule=(recheck=false)=>{if(stopped||blocked&&!recheck)return;clear();timer=setTimer(()=>{timer=null;void flush(recheck)},debounceMs)};
 async function flush(recheck=false){
  if(stopped||blocked&&!recheck||running)return;
  if(!online()){state('offline',{pending:dirty});return}
  running=true;followUp=false;const captured=dirty;dirty=false;lastCheck=now();state('syncing');
  try{const result=await syncOnce();
   if(!result?.durable){dirty=dirty||captured;blocked=blocked||result?.status==='conflict';if(result?.status==='conflict')lastConflicts=result.conflicts??[];state(blocked?'conflict':'pending',{pending:dirty,status:result?.status,...(blocked?{conflicts:lastConflicts}: {})})}
   else {blocked=false;lastConflicts=[];state(dirty?'pending':'synced',{pending:dirty});}
  }catch{
   // An authenticated request can fail while navigator.onLine is true.
   // Do not tell users that they are offline when sync itself failed.
   // The durable local journal is untouched, and no automatic retry loop runs.
   dirty=dirty||captured;state(online()?'unavailable':'offline',{pending:dirty});
  }
  finally{running=false;if(followUp&&!blocked&&online())schedule()}
 }
 const changed=()=>{if(stopped)return;dirty=true;if(running)followUp=true;state(blocked?'conflict':'pending',{pending:true,...(blocked?{conflicts:lastConflicts}:{})});schedule()};
 const wake=()=>{if(stopped||!online()||document?.visibilityState==='hidden')return;
  // A peer may have resolved the overlap. Re-evaluate the NORMAL conservative
  // merge on a cooled-down foreground event; never force a merge or poll.
  if(blocked&&now()-lastCheck<focusCooldownMs)return;
  if(dirty||now()-lastCheck>=focusCooldownMs){
   // A suspended mobile tab can resume while its previous request is still
   // in flight. Keep one wake request for after that request settles.
   if(running)followUp=true;else schedule(blocked);
  }};
 const visible=()=>{if(document?.visibilityState==='visible')wake()};
 const recovered=()=>{if(!stopped&&online()&&document?.visibilityState!=='hidden'){if(blocked)wake();else schedule()}};
 events?.addEventListener?.('online',recovered);events?.addEventListener?.('focus',wake);document?.addEventListener?.('visibilitychange',visible);
 return Object.freeze({changed,start:wake,
  // Only an explicit conflict resolution may release this pause.
  resumeAfterConflict(){if(stopped)return;blocked=false;dirty=true;schedule()},
  stop(){stopped=true;clear();events?.removeEventListener?.('online',recovered);events?.removeEventListener?.('focus',wake);document?.removeEventListener?.('visibilitychange',visible)},
  get pending(){return dirty},get conflict(){return blocked}});
}
