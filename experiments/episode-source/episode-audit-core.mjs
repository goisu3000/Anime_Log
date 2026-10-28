/** ANI:LOG episode audit, offline/read-only. Dates never prove publication. */
export function malId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 99999999 ? n : null;
}

export function safeEpisodeDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?$/.test(raw)) return null;
  const part = raw.slice(0, 10);
  const [y, m, d] = part.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== part) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function verifyAnimeIdentity(item, response) {
  const data = response?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {status:'INVALID_METADATA',returnedMalId:null,type:null,title:null};
  const id = malId(data.mal_id);
  const titles = [data.title,data.title_japanese,data.title_english,...(Array.isArray(data.titles)?data.titles.map(t=>t?.title):[])];
  if(id===null || !titles.some(t=>typeof t==='string' && t.trim()))
    return {status:'INVALID_METADATA',returnedMalId:id,type:null,title:null};
  const type = typeof data.type === 'string' ? data.type : null;
  const title = typeof data.title === 'string' ? data.title : null;
  if (id !== item.malId) return {status:'MAL_ID_MISMATCH',returnedMalId:id,type,title};
  if (item.expectedType && String(item.expectedType).toLowerCase() !== String(type??'').toLowerCase())
    return {status:'TYPE_MISMATCH',returnedMalId:id,type,title};
  const normalize = value => String(value??'').normalize('NFKC').toLowerCase().replace(/[\s\u3000\p{P}\p{S}]/gu,'');
  const matchingTitle = titles.some(t=>typeof t==='string' && normalize(t)===normalize(item.title));
  return {status:matchingTitle?'ID_TITLE_MATCH':'TITLE_REVIEW_REQUIRED',returnedMalId:id,type,title,
    matchedTitle:matchingTitle,seasonChecked:false};
}

export function assessEpisodes(pages, {now=Date.now(), complete=true, metadataType=null}={}) {
  const episodes=[],errors=[],numbers=new Set();
  let missingDate=0,future=0,duplicates=0,missingNumber=0;
  for (const page of pages) {
    if (!page || !Array.isArray(page.data)) {errors.push('INVALID_PAGE_DATA');continue;}
    for (const raw of page.data) {
      const n=malId(raw?.mal_id);
      if (!n || n>50000) {missingNumber++;continue;}
      if (numbers.has(n)) {duplicates++;continue;}
      numbers.add(n);
      const ms=safeEpisodeDate(raw?.aired);
      if (ms===null) missingDate++;
      else if (ms>now) future++;
      episodes.push({episode:n,aired:typeof raw?.aired==='string'?raw.aired:null,dateParsed:ms!==null,hasPastDate:ms!==null&&ms<=now});
    }
  }
  episodes.sort((a,b)=>a.episode-b.episode);
  const consecutive=episodes.length>0&&episodes[0].episode===1&&episodes.every((r,i)=>r.episode===i+1);
  const past=episodes.filter(e=>e.hasPastDate);
  let suitability;
  if (errors.length || duplicates || missingNumber) suitability='INVALID_EPISODE_DATA';
  else if (!complete) suitability='PAGINATION_INCOMPLETE';
  else if (episodes.length===0) suitability=String(metadataType).toLowerCase()==='movie'?'MOVIE_WITH_NO_EPISODE_ROWS':'EMPTY_EPISODE_LIST';
  else if (!consecutive) suitability='NONCONSECUTIVE_EPISODES';
  else if (missingDate) suitability='INCOMPLETE_DATES';
  else suitability='SCHEDULE_ONLY';
  return {count:episodes.length,firstEpisode:episodes[0]?.episode??null,lastIndexedEpisode:episodes.at(-1)?.episode??null,
    pastDatedMaximum:past.length?Math.max(...past.map(x=>x.episode)):null,
    missingDate,future,duplicates,missingNumber,consecutive,complete,errors,
    publishedThrough:null,publishVerification:'NOT_VERIFIED',suitability,episodes};
}

/** Requires externally confirmed PUBLICATION, NOT an elapsed air date. */
export function deriveNotice({publishedThrough,verification,seenThrough,watched,initialized}) {
  const total=malId(publishedThrough),seen=Number.isSafeInteger(seenThrough)&&seenThrough>=0?seenThrough:0;
  const viewed=Number.isSafeInteger(watched)&&watched>=0?watched:0;
  if (verification!=='confirmed-publication'||total===null||!initialized) return {state:'none',text:''};
  const acknowledged=Math.max(seen,viewed);
  if (total>acknowledged) return {state:'new',from:acknowledged+1,to:total,text:acknowledged+1===total?`新着 第${total}話`:`新着 第${acknowledged+1}〜${total}話`};
  return {state:'seen',from:null,to:total,text:`第${total}話まで公開`};
}
export function acknowledgeNotice({publishedThrough,seenThrough}) {
  return Math.max(Number.isSafeInteger(seenThrough)?seenThrough:0,malId(publishedThrough)??0);
}
