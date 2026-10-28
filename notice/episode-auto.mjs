// Public metadata only. This module has no record/save/sync/credential interface.
// All derived releases are HEURISTICS, never independent publication proof.
export const HOUR=3600000;
export const POLICY=Object.freeze({poll:HOUR,unknown:24*HOUR,archive:30*24*HOUR,grace:24*HOUR,maxPages:3,interval:1700,window:15*60000,maxWindow:8,maxHour:32});
const cp=structuredClone,object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const idOf=x=>/^jikan:[1-9]\d{0,8}$/.test(x||'')?Number(x.slice(6)):null;
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=9999;
const stamp=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const day=x=>{if(stamp(x)===null)return null;const ms=Date.parse(x.slice(0,10)+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===x.slice(0,10)?ms:null;};
const fail=(code,until=0)=>Object.assign(Error(code),{code,until,...(/^HTTP_\d{3}$/.test(code)?{status:Number(code.slice(5))}:code==='API_COOLDOWN'?{status:429}:{})});
export function targetsFromRecords(records){return Object.values(records||{}).filter(r=>r&&r.status==='watching'&&idOf(r.id)).map(r=>({id:r.id,malId:idOf(r.id),priority:0})).sort((a,b)=>a.priority-b.priority||a.malId-b.malId);}
export function retryAt(value,now){const seconds=Number(value);const absolute=typeof value==='string'?Date.parse(value):NaN;return Math.max(now+60000,Number.isFinite(seconds)&&seconds>0?now+Math.min(seconds*1000,24*HOUR):Number.isFinite(absolute)?absolute:now+15*60000);}
export function inspectMetadata(meta,id,now){
 if(!object(meta)||meta.mal_id!==id)return {eligible:false,reason:'IDENTITY_MISMATCH',next:now+POLICY.unknown};
 if(meta.status==='Not yet aired'||stamp(meta.aired?.from)>now)return {eligible:false,reason:'PRE_AIRING',next:now+POLICY.unknown};
 const end=stamp(meta.aired?.to);
 if(meta.airing===false&&meta.status==='Finished Airing'&&end!==null&&now-end>=POLICY.archive)return {eligible:false,reason:'ARCHIVED',next:now+POLICY.archive};
 if(meta.type!=='TV')return {eligible:false,reason:'BULK_OR_UNSUPPORTED_MEDIA',next:now+POLICY.unknown};
 if(meta.airing===true&&meta.status==='Currently Airing'&&(stamp(meta.aired?.to)===null||stamp(meta.aired.to)>now))return {eligible:true,next:now+POLICY.poll};
 if(meta.airing===false&&meta.status==='Finished Airing'&&end!==null&&end<=now){
  if(now-end<30*24*HOUR)return {eligible:true,next:now+POLICY.poll};
  return {eligible:false,reason:'ARCHIVED',next:now+POLICY.archive};
 }
 return {eligible:false,reason:'UNKNOWN_OR_CONTRADICTORY_STATUS',next:now+POLICY.unknown};
}
export function summarizeEpisodes({meta,id,pages,now,schedule=null}){
 const eligibility=inspectMetadata(meta,id,now);if(!eligibility.eligible)return {ok:false,reason:eligibility.reason};
 if(!Array.isArray(pages)||!pages.length||pages.length>POLICY.maxPages)return {ok:false,reason:'PAGING_INCOMPLETE'};
 const rows=[];
 for(let i=0;i<pages.length;i++){
  const p=pages[i];if(!Array.isArray(p?.data)||!object(p.pagination)||p.pagination.has_next_page!==(i<pages.length-1)||p.pagination.current_page!=null&&p.pagination.current_page!==i+1)return {ok:false,reason:'PAGING_INCOMPLETE'};
  rows.push(...p.data);
 }
 if(!rows.length||rows.length>300)return {ok:false,reason:'EMPTY_OR_OVERSIZED'};
 const byNumber=new Map();
 for(const e of rows){if(!object(e)||!count(e.mal_id)||e.mal_id<1||byNumber.has(e.mal_id))return {ok:false,reason:'NUMBERING_AMBIGUOUS'};byNumber.set(e.mal_id,e);}
 const max=Math.max(...byNumber.keys());
 if(max>rows.length||count(meta.episodes)&&meta.episodes>0&&max>meta.episodes)return {ok:false,reason:'GAPS_OR_SERIES_OFFSET'};
 const dates=[];for(let n=1;n<=max;n++){const e=byNumber.get(n);const d=e&&day(e.aired);if(d===null)return {ok:false,reason:'MISSING_OR_INVALID_DATE'};dates.push(d);}
 const startDay=day(meta.aired?.from);
 if(startDay===null||Math.abs(dates[0]-startDay)>2*24*HOUR)return {ok:false,reason:'SERIES_START_MISMATCH_OR_UNKNOWN'};
 if(meta.status==='Finished Airing'&&(!count(meta.episodes)||meta.episodes<1||max!==meta.episodes))return {ok:false,reason:'FINISHED_EPISODES_INCOMPLETE'};
 // No inference by adding seven days to a series start. Use each observed date.
 // Multiple episodes on one date / irregular spacing may be batch releases,
 // holidays or numbering mismatches: leave them for independent review.
 for(let n=1;n<dates.length;n++)if(dates[n]-dates[n-1]<5*24*HOUR||dates[n]-dates[n-1]>10*24*HOUR)return {ok:false,reason:'IRREGULAR_OR_BATCH_SCHEDULE'};
 let through=0;const matureAfter=[];
 for(let n=1;n<=max;n++){
  const e=byNumber.get(n),d=dates[n-1];
  let safeAfter=d+POLICY.grace;
  if(schedule?.episode===n&&Number.isSafeInteger(schedule.airingAt)){
   const at=schedule.airingAt*1000;
   if(at<d-24*HOUR||at>d+2*24*HOUR)break; // known schedule/date mismatch, never ignore a possible delay
   safeAfter=Math.max(d,at+HOUR);
  }
  if(safeAfter>now)break;
  // Episode ID/date continuity and the elapsed broadcast time are sufficient.
  // Scores and forum URLs often appear late and are not publication prerequisites.
  // Keep future timestamps excluded; the output is informational, not a guarantee.
  if(!object(e)||e.mal_id!==n)break;
  through=n;matureAfter.push(safeAfter);
 }
 if(!through)return {ok:false,reason:'NO_MATURE_SUPPORTED_EPISODE'};
 // Keep a compact public signature, not titles, notes, scores, API tokens or keys.
 const signature=JSON.stringify(Array.from({length:through},(_,i)=>[i+1,dates[i],null,matureAfter[i]]));
 return {ok:true,id,startDay,through,signature,at:now,confidence:'estimated_schedule_tenrai_v1',actualReleaseProven:false};
}
// Read-only possibility from individually recorded calendar slots. Never N-1 from a future slot.
export function calendarEpisodePossibility(first,schedule,now){
 if(!first?.ok||!Number.isSafeInteger(first.startDay)||(!Number.isSafeInteger(first.id)||first.id<1)||schedule?.malId!==first.id||!Number.isFinite(schedule.observedAt)||schedule.observedAt>now||now-schedule.observedAt>=6*HOUR||!Array.isArray(schedule.history)||!schedule.history.length||schedule.history.length>25)return null;
 const rows=[...schedule.history].sort((a,b)=>a.episode-b.episode);let through=0,previous=null;
 for(const row of rows){
  if(!object(row)||row.episode!==through+1||!Number.isSafeInteger(row.airingAt))return null;
  const at=row.airingAt*1000;
  if(through===0?Math.abs(at-first.startDay)>2*24*HOUR:at-previous<5*24*HOUR||at-previous>10*24*HOUR)return null;
  if(at+24*HOUR>now)break;
  through=row.episode;previous=at;
 }
 if(!through||!count(schedule.episode)||schedule.episode!==through+1||!Number.isSafeInteger(schedule.airingAt)||schedule.airingAt*1000<=now||schedule.airingAt*1000-previous<5*24*HOUR||schedule.airingAt*1000-previous>10*24*HOUR)return null;
 return through;
}
export function evaluateObservation(_previous,current,now){
 if(!current?.ok)return {estimate:null,first:null,reason:current?.reason||'INVALID'};
 // Every observed episode is dated, numbered and eligible; never wait six hours.
 const estimate={through:current.through,at:now,expiresAt:now+2*POLICY.poll,confidence:current.confidence};
 return {estimate,first:cp(current),reason:'OBSERVED'};
}

// One shared request lane for background checks and existing detail/full calls.
// Optional Web Locks + short-lived public cache also deduplicate sibling tabs.
export function createPublicAnimeRequests({fetcher=globalThis.fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),storage=null,locks=null,base='https://api.tenrai.org/v1',interval=POLICY.interval,timeoutMs=12000}={}){
 const inflight=new Map(),cache=new Map();let tail=Promise.resolve(),last=0,cooldown=0,history=[];
 const networkKey='anilog-notice-http-public-v1',budgetKey='anilog-notice-budget-v1';
 function load(key){try{const s=storage?.getItem(key);return s&&s.length<700000?JSON.parse(s):null}catch{return null}}
 function save(key,value){try{storage?.setItem(key,JSON.stringify(value))}catch{/* optional cache; never block ordinary saves */}}
 function normalize(p){const m=/^\/anime\/([1-9]\d{0,8})\/(full|episodes)(?:\?page=([1-9]\d{0,4}))?$/.exec(p);if(!m||m[2]==='full'&&m[3])throw fail('UNSUPPORTED_PUBLIC_PATH');return '/anime/'+m[1]+'/'+m[2]+(m[2]==='episodes'?'?page='+(m[3]||1):'');}
 function peek(path,maxAge=5*60000){const p=normalize(path),row=cache.get(p);return row&&row.at<=now()&&now()-row.at<maxAge?cp(row):null;}
 async function perform(path,{background=false,maxAge=5*60000}={}){
  const time=now();if(time<cooldown)throw fail('API_COOLDOWN',cooldown);
  const own=peek(path,maxAge);if(own)return own;
  const disk=load(networkKey);const shared=disk?.[path];
  if(shared&&object(shared.body)&&Number.isFinite(shared.at)&&shared.at<=time&&time-shared.at<Math.min(maxAge,60000)){cache.set(path,shared);while(cache.size>32)cache.delete(cache.keys().next().value);return cp(shared);}
  const budget=load(budgetKey);if(object(budget)){if(Number.isFinite(budget.cooldown))cooldown=Math.max(cooldown,budget.cooldown);if(Array.isArray(budget.history))history=budget.history.filter(t=>Number.isFinite(t)&&t<=time&&time-t<HOUR);}
  history=history.filter(t=>time-t<HOUR);
  if(time<cooldown)throw fail('API_COOLDOWN',cooldown);
  if(background&&(history.length>=POLICY.maxHour||history.filter(t=>time-t<POLICY.window).length>=POLICY.maxWindow))throw fail('BACKGROUND_BUDGET',time+POLICY.window);
  const lastShared=history.at(-1)||0;await sleep(Math.max(0,interval-(now()-Math.max(last,lastShared))));
  last=now();history.push(last);save(budgetKey,{history,cooldown});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(base+path,{method:'GET',headers:{Accept:'application/json'},signal:controller.signal,redirect:'error'});
   if(!response.ok){if(response.status===429||response.status===403){cooldown=response.status===403?now()+24*HOUR:retryAt(response.headers?.get?.('Retry-After'),now());save(budgetKey,{history,cooldown});}throw fail('HTTP_'+response.status,cooldown);}
   let body;if(response.text){const raw=await response.text();if(raw.length>2000000)throw fail('PUBLIC_RESPONSE_TOO_LARGE');body=JSON.parse(raw);}else body=await response.json();
   if(!object(body))throw fail('INVALID_PUBLIC_RESPONSE');
   const row={body,at:now()};cache.set(path,row);while(cache.size>32)cache.delete(cache.keys().next().value);
   // Bounded cache contains public HTTP bodies only. Never app records or auth.
   const next=object(disk)?disk:{};next[path]=row;
   const entries=Object.entries(next).filter(([,v])=>v&&v.at<=now()&&now()-v.at<60000).sort((a,b)=>b[1].at-a[1].at).slice(0,8);
   const bounded={};for(const [key,value] of entries){if(JSON.stringify({...bounded,[key]:value}).length<600000)bounded[key]=value;}save(networkKey,bounded);
   return cp(row);
  }finally{clearTimeout(timer);}
 }
 function request(path,options={}){
  const p=normalize(path),existing=inflight.get(p);
  if(existing){
   if(!options.background){existing.options.background=false;existing.options.maxAge=Math.min(existing.options.maxAge??5*60000,options.maxAge??5*60000);}
   return !options.background?existing.job.catch(e=>{if(e.code==='BACKGROUND_BUDGET')return request(p,{...options,background:false});throw e}):existing.job;
  }
  const config={...options},run=()=>locks?.request?locks.request('anilog-notice-public-network',{mode:'exclusive'},()=>perform(p,config)):perform(p,config);
  const job=tail.then(run);tail=job.catch(()=>{});inflight.set(p,{job,options:config});job.finally(()=>inflight.delete(p)).catch(()=>{});return job;
 }
 return Object.freeze({peek,request,get retryAfter(){return cooldown},get requestCount(){return history.length}});
}

export function createAutomaticEpisodeNotices({requests,getTargets,getCachedFull=()=>null,getCachedEpisodes=()=>null,getSchedule=()=>null,onChange=()=>{},onStatus=()=>{},storage=null,now=Date.now,visible=()=>true,online=()=>true}={}){
 if(!requests||typeof getTargets!=='function')throw Error('NOTICE_AUTO_ARGUMENTS');
 const key='anilog-notice-observations-public-v1';let states=new Map(),estimates=new Map(),busy=null,enabled=true;
 function validCachedEstimate(id,s){
  try{const f=s.first,e=s.estimate;if(f?.ok!==true||f.id!==idOf(id)||!Number.isSafeInteger(f.startDay)||!count(f.through)||f.through<1||f.through>300||e?.confidence!=='estimated_schedule_tenrai_v1'||e.through!==f.through||!Number.isFinite(f.at)||!Number.isFinite(e.at)||e.at<f.at||e.at-f.at>14*24*HOUR||e.at>s.observedAt||e.expiresAt!==e.at+2*POLICY.poll||e.expiresAt<=now()||typeof f.signature!=='string'||f.signature.length>64000)return false;
   const rows=JSON.parse(f.signature);return Array.isArray(rows)&&rows.length===f.through&&rows.every((r,i)=>Array.isArray(r)&&r.length===4&&r[0]===i+1&&Number.isSafeInteger(r[1])&&r[1]%86400000===0&&Number.isSafeInteger(r[3])&&r[3]>=r[1]&&r[3]<=r[1]+4*24*HOUR&&r[3]<=f.at&&(r[2]===null||/^https:\/\/myanimelist\.net\/forum\/\?topicid=[1-9]\d*$/.test(r[2]))&&(i===0?Math.abs(r[1]-f.startDay)<=2*24*HOUR:r[1]-rows[i-1][1]>=5*24*HOUR&&r[1]-rows[i-1][1]<=10*24*HOUR));
  }catch{return false}
 }
 try{const raw=storage?.getItem(key);const data=raw&&raw.length<600000?JSON.parse(raw):null;if([1,2].includes(data?.version)&&Array.isArray(data.entries))for(const [id,s] of data.entries.slice(0,500)){if(idOf(id)&&object(s)&&Number.isFinite(s.observedAt)&&s.observedAt<=now()&&now()-s.observedAt<POLICY.archive&&Number.isFinite(s.next)&&s.next<=now()+POLICY.archive){
   // Old v1 cache scheduled six-hour checks and may contain stale observations.
   // Force a fresh v2 check without changing any user record or encrypted store.
   if(data.version===1){states.set(id,{observedAt:s.observedAt,next:now(),first:null,estimate:null,reason:'BACKGROUND_BUDGET'});continue;}
   states.set(id,s);if(s.estimate){if(validCachedEstimate(id,s))estimates.set(id,s.estimate);else states.set(id,{...s,first:null,estimate:null,next:now()});}
  }}}catch{/* untrusted/blocked public cache: use fresh observations */}
 function visibleStatuses(){
  if(!enabled)return Object.freeze({});
  const result={};
  for(const t of getTargets()){
   const s=states.get(t.id),e=estimates.get(t.id);
   // Retain the most recent validated count in public cache while refreshing.
   // This status path never writes synced records or a new ACK.
   const f=s?.first;
   let validFirst=false;
   try{
    const rows=JSON.parse(f?.signature);
    validFirst=f?.ok===true&&f.id===t.malId&&count(f.through)&&f.through>=1&&f.through<=300&&Number.isSafeInteger(f.startDay)&&
     Number.isFinite(f.at)&&f.at<=now()&&(now()-f.at<=2*POLICY.poll||e&&e.expiresAt>now())&&typeof f.signature==='string'&&f.signature.length<64000&&
     Array.isArray(rows)&&rows.length===f.through&&rows.every((r,i)=>Array.isArray(r)&&r.length===4&&r[0]===i+1&&Number.isSafeInteger(r[1])&&r[1]%86400000===0&&Number.isSafeInteger(r[3])&&r[3]>=r[1]&&r[3]<=r[1]+4*24*HOUR&&r[3]<=f.at&&(r[2]===null||/^https:\/\/myanimelist\.net\/forum\/\?topicid=[1-9]\d*$/.test(r[2]))&&(i===0?Math.abs(r[1]-f.startDay)<=2*24*HOUR:r[1]-rows[i-1][1]>=5*24*HOUR&&r[1]-rows[i-1][1]<=10*24*HOUR));
   }catch{/* Invalid optional public cache cannot supply an episode number. */}
   const calendar=validFirst?calendarEpisodePossibility(f,getSchedule(t.id),now()):null;
   if(calendar!==null&&calendar>Math.max(f.through,e?.through||0)){result[t.id]={kind:'possible',through:calendar};continue;}
   if(e&&e.expiresAt>now()){result[t.id]={kind:'estimated',through:e.through};continue;}
   if(validFirst){result[t.id]={kind:'possible',through:f.through};continue;}
   if(s?.reason==='ARCHIVED'&&count(s.completeThrough)&&s.completeThrough>=1&&s.completeThrough<=300){
    result[t.id]={kind:'finished',through:s.completeThrough};continue;
   }
   if(!s||['BACKGROUND_BUDGET','API_COOLDOWN'].includes(s.reason)){result[t.id]={kind:'loading'};continue;}
   result[t.id]={kind:s.reason==='PRE_AIRING'?'upcoming':'unavailable'};
  }
  return Object.freeze(result);
 }
 function publish(){
  if(!enabled)estimates.clear();const active=new Set(getTargets().map(t=>t.id));
  for(const [id,e] of estimates)if(!active.has(id)||e.expiresAt<=now())estimates.delete(id);
  try{onChange(Object.freeze(Object.fromEntries([...estimates].map(([id,e])=>[id,e.through]))))}catch{}
  try{onStatus(visibleStatuses())}catch{}
 }
 function persist(){try{const entries=[...states].sort((a,b)=>b[1].observedAt-a[1].observedAt).slice(0,500);const raw=JSON.stringify({version:2,entries});if(raw.length<600000)storage?.setItem(key,raw)}catch{}}
 async function one(t){
  const previous=states.get(t.id),time=now();
  let full=getCachedFull(t.id);if(full?.then)full=await full;
  if(!enabled||!visible()||!online()||!getTargets().some(x=>x.id===t.id))return;
  const meta=full&&now()-full.at<POLICY.poll&&full.at<=now()?full.body:(await requests.request('/anime/'+t.malId+'/full',{background:true,maxAge:POLICY.poll})).body.data;
  if(!enabled||!visible()||!online()||!getTargets().some(x=>x.id===t.id))return;
  const eligible=inspectMetadata(meta,t.malId,time);
  if(!eligible.eligible){
   // Finished shows may be displayed as metadata, not as a new-release alert.
   const end=stamp(meta?.aired?.to);
   const completeThrough=eligible.reason==='ARCHIVED'&&meta?.status==='Finished Airing'&&meta?.airing===false&&
     meta?.type==='TV'&&end!==null&&end<=time-POLICY.archive&&
     count(meta?.episodes)&&meta.episodes>=1&&meta.episodes<=300?meta.episodes:null;
   states.set(t.id,{observedAt:time,next:eligible.next,reason:eligible.reason,completeThrough});
   estimates.delete(t.id);return;
  }
  const pages=[];let cached=getCachedEpisodes(t.id);if(cached?.then)cached=await cached;
  if(cached&&cached.at<=now()&&now()-cached.at<60000&&cached.body?.pagination?.current_page===1)pages.push(cached.body);
  if(!pages.length||pages[0].pagination.has_next_page===true)for(let page=pages.length+1;page<=POLICY.maxPages;page++){if(!enabled||!visible()||!online()||!getTargets().some(x=>x.id===t.id))return;const r=await requests.request('/anime/'+t.malId+'/episodes?page='+page,{background:true,maxAge:60000});pages.push(r.body);if(r.body.pagination?.has_next_page===false)break;if(r.body.pagination?.has_next_page!==true||!r.body.data?.length)break;}
  if(!enabled||!visible()||!online()||!getTargets().some(x=>x.id===t.id))return;
  const current=summarizeEpisodes({meta,id:t.malId,pages,now:time,schedule:getSchedule(t.id)});
  // First observation emits the release count. The host safely baselines new
  // registrations using its existing encrypted ACK write, never a new schema.
  const result=evaluateObservation(previous?.first,current,time);
  states.set(t.id,{observedAt:time,next:time+POLICY.poll,first:result.first,estimate:result.estimate,reason:result.reason});
  if(result.estimate)estimates.set(t.id,result.estimate);else estimates.delete(t.id);
 }
 return Object.freeze({tick(){publish();if(!enabled||!visible()||!online())return Promise.resolve();if(busy)return busy;
  busy=(async()=>{const all=getTargets();const active=new Set(all.map(t=>t.id));for(const id of states.keys())if(!active.has(id))states.delete(id);
   // Fair within each lane: never let a low-ID repeating work starve new IDs.
   // Prefer up to three watching works, then one watched work if both are due.
   const due=all.filter(t=>!(states.get(t.id)?.next>now()));
   const oldest=(a,b)=>(states.get(a.id)?.observedAt??0)-(states.get(b.id)?.observedAt??0)||a.malId-b.malId;
   const watching=due.filter(t=>t.priority===0).sort(oldest),other=due.filter(t=>t.priority!==0).sort(oldest),targets=[];
   let w=0,o=0;while(w<watching.length||o<other.length){for(let n=0;n<3&&w<watching.length;n++)targets.push(watching[w++]);if(o<other.length)targets.push(other[o++]);}
   for(const t of targets){if(!enabled||!visible()||!online())break;const old=states.get(t.id);if(old?.next>now())continue;
    try{await one(t);}catch(e){const noAttempt=e.code==='BACKGROUND_BUDGET'||e.code==='API_COOLDOWN',until=Math.max(now()+30*60000,e.until||0);states.set(t.id,{...(old||{}),observedAt:noAttempt?(old?.observedAt??0):now(),next:until,reason:e.code||'FETCH_FAILED'});if(e.code==='BACKGROUND_BUDGET'||e.code==='API_COOLDOWN'||e.code==='HTTP_429'||e.code==='HTTP_403')break;}
    // The user may have deleted/changed this work during the awaited request.
    publish();persist();
   }publish();persist();})().catch(()=>{}).finally(()=>{busy=null});return busy;
 },disable(){enabled=false;estimates.clear();publish();},getState(){return cp(Object.fromEntries(states))},get displayStatuses(){return visibleStatuses()},get estimates(){return Object.freeze(Object.fromEntries([...estimates].map(([id,e])=>[id,e.through])));}});
}
