// Public timetable cache only. No record, credential, encrypted WAL or sync access.
const HOUR=3600000,TTL=6*HOUR,RETAIN=14*24*HOUR,KEY='anilog-broadcast-timetable-public-v1';
const QUERY=`query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){id idMal status duration past:airingSchedule(notYetAired:false,perPage:50){pageInfo{lastPage} nodes{episode airingAt}} future:airingSchedule(notYetAired:true,perPage:12){nodes{episode airingAt}}}}}`;
const validEpisode=n=>Number.isSafeInteger(n)&&n>0&&n<=9999;
const validTime=n=>Number.isSafeInteger(n)&&n>=946684800&&n<=4102444800;
export function normalizeTimetable(media,malId,at){
 if(!media||media.idMal!==malId||!Number.isSafeInteger(media.id)||media.id<1||!['RELEASING','FINISHED','NOT_YET_RELEASED','CANCELLED','HIATUS'].includes(media.status))return null;
 if(media.past?.nodes!==undefined&&!Array.isArray(media.past.nodes)||media.future?.nodes!==undefined&&!Array.isArray(media.future.nodes))return null;
 const byEpisode=new Map();
 for(const row of [...(media.past?.nodes||[]),...(media.future?.nodes||[])]){
  if(!validEpisode(row?.episode)||!validTime(row?.airingAt))return null;
  if(byEpisode.has(row.episode)&&byEpisode.get(row.episode)!==row.airingAt)return null;
  byEpisode.set(row.episode,row.airingAt);
 }
 if(!byEpisode.size||byEpisode.size>100)return null;
 return {malId,mediaId:media.id,status:media.status,duration:Number.isInteger(media.duration)&&media.duration>0&&media.duration<=360?media.duration:null,
  observedAt:at,events:[...byEpisode].sort((a,b)=>a[1]-b[1])};
}
export function broadcastStatus(table,malId,now){
 if(!table||table.malId!==malId||!Number.isFinite(table.observedAt)||table.observedAt>now||now-table.observedAt>RETAIN||!Array.isArray(table.events))return null;
 if(table.status==='CANCELLED'||table.status==='HIATUS')return null;
 const eligible=table.events.filter(([ep,at])=>validEpisode(ep)&&validTime(at)&&at*1000<=now);
 const latest=eligible.sort((a,b)=>b[0]-a[0])[0];
 if(!latest)return table.events.some(([,at])=>at*1000>now)?{kind:'upcoming',source:'broadcast'}:null;
 // Old, truncated episode lists cannot claim a current count for a long series.
 if(now-latest[1]*1000>30*24*HOUR&&table.status!=='FINISHED')return null;
 const ended=table.duration!==null&&now>=(latest[1]+table.duration*60)*1000;
 return {kind:ended?'aired':'started',through:latest[0],source:'broadcast'};
}
export function createBroadcastClock({fetcher=globalThis.fetch,storage=null,locks=null,getTargets,now=Date.now,onChange=()=>{},visible=()=>true,online=()=>true,
 setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof fetcher!=='function'||typeof getTargets!=='function')throw Error('BROADCAST_ARGUMENTS');
 const tables=new Map(),retry=new Map();let busy=null,timer=null,disabled=false,cooldown=0,last='';
 function hydrate(){try{
  const raw=storage?.getItem(KEY);if(!raw||raw.length>600000)return;
  const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.entries))return;
  for(const [id,t]of data.entries.slice(0,500)){
   if(!Number.isSafeInteger(id)||!Number.isFinite(t?.observedAt)||t.observedAt>now()||now()-t.observedAt>RETAIN||!Array.isArray(t.events))continue;
   const normalized=normalizeTimetable({id:t.mediaId,idMal:id,status:t.status,duration:t.duration,past:{nodes:t.events.map(([episode,airingAt])=>({episode,airingAt}))}},id,t.observedAt);
   if(normalized)tables.set(id,normalized);
  }
 }catch{/* Optional public cache is untrusted; user storage is never touched. */}}
 function save(){try{storage?.setItem(KEY,JSON.stringify({version:1,entries:[...tables].slice(-500)}))}catch{}}
 hydrate();
 function statuses(){return Object.freeze(Object.fromEntries(getTargets().flatMap(t=>{const s=broadcastStatus(tables.get(t.malId),t.malId,now());return s?[[t.id,s]]:[]})))}
 function publish(){
  if(timer!==null){clearTimer(timer);timer=null;}
  if(disabled)return;
  const next=statuses(),signature=JSON.stringify(next);if(signature!==last){last=signature;onChange(next)}
  if(!visible())return;
  let boundary=Infinity;const time=now();
  for(const t of getTargets()){
   const table=tables.get(t.malId);if(!table||time-table.observedAt>RETAIN||['CANCELLED','HIATUS'].includes(table.status))continue;
   for(const [,at]of table.events){if(at*1000>time)boundary=Math.min(boundary,at*1000);if(table.duration&& (at+table.duration*60)*1000>time)boundary=Math.min(boundary,(at+table.duration*60)*1000);}
  }
  if(Number.isFinite(boundary))timer=setTimer(publish,Math.min(2147483647,Math.max(1,boundary-time)));
 }
 async function request(query,variables){
  const response=await fetcher('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){if(response.status===429){const seconds=Number(response.headers?.get('Retry-After'));cooldown=now()+Math.max(60000,Math.min(Number.isFinite(seconds)&&seconds>0?seconds*1000:15*60000,HOUR));}throw Error('BROADCAST_HTTP_'+response.status)}
  const text=await response.text();if(text.length>2000000)throw Error('BROADCAST_RESPONSE_SIZE');const body=JSON.parse(text);if(body.errors?.length||!body.data)throw Error('BROADCAST_RESPONSE');return body.data;
 }
 async function refresh(){
  hydrate();
  const due=[...new Set(getTargets().map(t=>t.malId))].filter(id=>Number.isSafeInteger(id)&&id>0&&!(retry.get(id)>now())&&(!tables.has(id)||now()-tables.get(id).observedAt>=TTL));
  for(let i=0;i<due.length;i+=25){
   if(disabled||!visible()||!online()||now()<cooldown)break;
   const ids=due.slice(i,i+25);ids.forEach(id=>retry.set(id,now()+15*60000));
   try{
    const data=await request(QUERY,{ids});if(!Array.isArray(data.Page?.media))throw Error('BROADCAST_MEDIA');
    const grouped=new Map();for(const media of data.Page.media){if(!ids.includes(media?.idMal))continue;const list=grouped.get(media.idMal)||[];list.push(media);grouped.set(media.idMal,list)}
    for(const id of ids){
     const candidates=grouped.get(id)||[];
     if(candidates.length!==1){if(candidates.length>1)tables.delete(id);continue;} // Do not guess between split-cour identities.
     let media=candidates[0];const page=media.past?.pageInfo?.lastPage;
     if(Number.isInteger(page)&&page>1){
      const tail=await request('query($id:Int,$page:Int){Media(id:$id,type:ANIME){id idMal status duration past:airingSchedule(notYetAired:false,page:$page,perPage:50){nodes{episode airingAt}}}}',{id:media.id,page});
      if(tail.Media?.id!==media.id||tail.Media?.idMal!==id)throw Error('BROADCAST_IDENTITY');
      media={...tail.Media,future:media.future};
     }
     const table=normalizeTimetable(media,id,now());if(!table){tables.delete(id);continue;}
     tables.set(id,table);retry.delete(id);
    }
    save();publish();
   }catch{if(now()<cooldown)break;/* Retain the previous timetable on transport failure. */}
   if(i+25<due.length)await new Promise(resolve=>setTimer(resolve,2200));
  }
 }
 return Object.freeze({tick(){publish();if(disabled||!visible()||!online()||now()<cooldown)return Promise.resolve();if(busy)return busy;
  const run=()=>refresh();busy=Promise.resolve().then(()=>locks?.request?locks.request('anilog-broadcast-timetable-public-v1',{mode:'exclusive'},run):run()).catch(()=>{}).finally(()=>{busy=null;publish()});return busy;
 },disable(){disabled=true;if(timer!==null)clearTimer(timer);timer=null},get statuses(){return statuses()}});
}
