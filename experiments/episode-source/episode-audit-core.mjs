/** ANI:LOG experimental EPISODE SOURCE AUDIT, 2026-10-28.
 * No writes to app records, no AniList, no claim that an aired date proves public availability.
 */
export function malId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0&&id<=99999999?id:null;}
export function safeEpisodeDate(raw){
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?$/.test(raw))return null;
 const datePart=raw.slice(0,10);const [y,m,d]=datePart.split('-').map(Number);
 const calendar=new Date(Date.UTC(y,m-1,d));
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==datePart)return null;
 const ms=Date.parse(raw);return Number.isFinite(ms)&&ms>0?ms:null;
}
export function assessEpisodes(pages,{now=Date.now(),complete=true}={}){
 const episodes=[],errors=[],numbers=new Set();let missingDate=0,future=0,duplicates=0,missingNumber=0;
 for(const page of pages){
  if(!page||!Array.isArray(page.data)){errors.push('INVALID_PAGE_DATA');continue;}
  for(const raw of page.data){
   const n=malId(raw?.mal_id);if(!n||n>50000){missingNumber++;continue;}
   if(numbers.has(n)){duplicates++;continue;}
   numbers.add(n);
   const timestamp=safeEpisodeDate(raw?.aired);
   if(timestamp==null)missingDate++;
   else if(timestamp>now)future++;
   episodes.push({episode:n,aired:typeof raw?.aired==='string'?raw.aired:null,dateParsed:timestamp!=null,hasPastDate:timestamp!=null&&timestamp<=now});
  }
 }
 episodes.sort((a,b)=>a.episode-b.episode);
 const consecutive=episodes.length>0&&episodes[0].episode===1&&episodes.every((r,i)=>r.episode===i+1);
 const withPastDate=episodes.filter(e=>e.hasPastDate);
 return {
  count:episodes.length,firstEpisode:episodes.at(0)?.episode??null,lastIndexedEpisode:episodes.at(-1)?.episode??null,
  pastDatedMaximum:withPastDate.length?Math.max(...withPastDate.map(x=>x.episode)):null,
  missingDate,future,duplicates,missingNumber,consecutive,complete,errors,
  // This is NOT a verified public release number even if every date has passed.
  publishedThrough:null,publishVerification:'NOT_VERIFIED',
  suitability:!complete?'PAGINATION_INCOMPLETE':errors.length?'INVALID_DATA':!consecutive?'NONCONSECUTIVE_EPISODES':missingDate?'INCOMPLETE_DATES':'SCHEDULE_ONLY',
  episodes
 };
}
/** Only third-party-verified release evidence may power a "公開" claim.
 * Supports a later production implementation, but this module does not integrate with ANI:LOG records.
 */
export function deriveNotice({publishedThrough,verification,seenThrough,watched,initialized}){
 const total=malId(publishedThrough),seen=Number.isSafeInteger(seenThrough)&&seenThrough>=0?seenThrough:0;
 const seenWatched=Number.isSafeInteger(watched)&&watched>=0?watched:0;
 if(verification!=='confirmed-publication'||total==null||!initialized)return {state:'none',text:''};
 const acknowledged=Math.max(seen,seenWatched);
 if(total>acknowledged)return {state:'new',from:acknowledged+1,to:total,text:acknowledged+1===total?`新着 第${total}話`:`新着 第${acknowledged+1}〜${total}話`};
 return {state:'seen',from:null,to:total,text:`第${total}話まで公開`};
}
export function acknowledgeNotice({publishedThrough,seenThrough}){
 return Math.max(Number.isSafeInteger(seenThrough)?seenThrough:0,malId(publishedThrough)??0);
}
