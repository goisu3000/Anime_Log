import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assessEpisodes,deriveNotice,acknowledgeNotice,safeEpisodeDate,verifyAnimeIdentity} from '../experiments/episode-source/episode-audit-core.mjs';
import {runAudit,fetchTenrai,parseArgs,retryAfterMs} from '../experiments/episode-source/audit-tenrai.mjs';

const regular={data:[{mal_id:2,aired:'2023-01-08T12:00:00+09:00'},{mal_id:1,aired:'2023-01-01T12:00:00+09:00'}]};
assert.equal(assessEpisodes([regular],{now:Date.parse('2025-01-01')}).suitability,'SCHEDULE_ONLY');
assert.equal(assessEpisodes([regular]).publishedThrough,null);
assert.equal(assessEpisodes([regular],{complete:false}).suitability,'PAGINATION_INCOMPLETE');
assert.equal(assessEpisodes([{data:[{mal_id:2,aired:null}]}]).suitability,'NONCONSECUTIVE_EPISODES');
assert.equal(assessEpisodes([{data:[{mal_id:1,aired:null}]}]).suitability,'INCOMPLETE_DATES');
const repeated=assessEpisodes([{data:[{mal_id:1,aired:'2023-01-01'},{mal_id:1,aired:'2023-01-02'}]}]);
assert.equal(repeated.duplicates,1);assert.equal(repeated.suitability,'INVALID_EPISODE_DATA');
const malformed=assessEpisodes([{data:[{mal_id:1,aired:'2023-01-01'},{mal_id:null,aired:'2023-01-02'}]}]);
assert.equal(malformed.missingNumber,1);assert.equal(malformed.suitability,'INVALID_EPISODE_DATA');
assert.equal(assessEpisodes([{data:[]}],{metadataType:'Movie'}).suitability,'MOVIE_WITH_NO_EPISODE_ROWS');
assert.equal(assessEpisodes([{data:[]}],{metadataType:'TV'}).suitability,'EMPTY_EPISODE_LIST');
assert.equal(safeEpisodeDate('not-date'),null);assert.equal(safeEpisodeDate('2024-02-30'),null);
const identity=verifyAnimeIdentity({malId:5114,title:'鋼の錬金術師 FULLMETAL ALCHEMIST'},
 {data:{mal_id:5114,title:'Fullmetal Alchemist: Brotherhood',title_japanese:'鋼の錬金術師 FULLMETAL ALCHEMIST',type:'TV'}});
assert.equal(identity.status,'ID_TITLE_MATCH');assert.equal(identity.seasonChecked,false);
assert.equal(verifyAnimeIdentity({malId:5114,title:'鋼の錬金術師'}, {data:{mal_id:21,title:'鋼の錬金術師'}}).status,'MAL_ID_MISMATCH');
assert.equal(verifyAnimeIdentity({malId:21,title:'ONE PIECE'}, {data:{mal_id:21,title:'Other'}}).status,'TITLE_REVIEW_REQUIRED');
assert.equal(verifyAnimeIdentity({malId:21,title:'ONE PIECE',expectedType:'TV'}, {data:{mal_id:21,title:'ONE PIECE',type:'Movie'}}).status,'TYPE_MISMATCH');
assert.equal(deriveNotice({publishedThrough:4,verification:'schedule-only',seenThrough:2,watched:0,initialized:true}).state,'none');
assert.equal(deriveNotice({publishedThrough:4,verification:'confirmed-publication',seenThrough:0,watched:0,initialized:false}).state,'none');
assert.deepEqual(deriveNotice({publishedThrough:4,verification:'confirmed-publication',seenThrough:2,watched:1,initialized:true}),{state:'new',from:3,to:4,text:'新着 第3〜4話'});
assert.equal(deriveNotice({publishedThrough:4,verification:'confirmed-publication',seenThrough:2,watched:4,initialized:true}).state,'seen');
assert.equal(deriveNotice({publishedThrough:5,verification:'confirmed-publication',seenThrough:4,watched:0,initialized:true}).text,'新着 第5話');
assert.equal(acknowledgeNotice({publishedThrough:4,seenThrough:1}),4);
assert.equal(parseArgs(['--max-pages','4','--max-requests','9']).requestBudget,9);
assert.throws(()=>parseArgs(['--max-requests','61']),/MAX_REQUESTS/);
assert.throws(()=>parseArgs(['--max-pages','20']),/INVALID_SAMPLE/);
assert.equal(retryAfterMs('120'),120000);
assert.equal(retryAfterMs('0'),0);
assert.equal(retryAfterMs('Wed, 28 Oct 2026 04:02:00 GMT',Date.parse('2026-10-28T04:00:00Z')),120000);
assert.equal(retryAfterMs('garbage'),null);
let attempts=0;const x=await fetchTenrai({malId:5114,page:1,fetchFn:async()=>{attempts++;return {ok:true,status:200,json:async()=>({data:[]})};}});
assert.equal(attempts,1);assert.deepEqual(x.data,{data:[]});
let rateLimitCalls=0;const limited=await fetchTenrai({malId:21,page:1,fetchFn:async()=>{rateLimitCalls++;return {ok:false,status:429,headers:{get:()=> '120'}};}});
assert.equal(rateLimitCalls,1);assert.equal(limited.error,'RATE_LIMIT_429');assert.equal(limited.retryAfterMs,120000);

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ani-episode-audit-fixed-'));
try {
  const sample=path.join(dir,'sample.json');
  await fs.writeFile(sample,JSON.stringify([{malId:5114,title:'TEST'},{malId:21,title:'LONG'}]));
  const fixture=await runAudit({sample,out:path.join(dir,'fixture'),fixture:path.resolve('experiments/episode-source/fixtures/mock-tenrai.json'),pages:2});
  assert.equal(fixture.live,false);assert.equal(fixture.requestCount,0);
  assert.equal(fixture.entries[0].suitability,'SCHEDULE_ONLY');
  assert.equal(fixture.entries[1].suitability,'PAGINATION_INCOMPLETE');
  assert.equal(fixture.entries[0].identity.status,'FIXTURE_NO_METADATA');
  assert.ok((await fs.readFile(path.join(dir,'fixture','REVIEW.md'),'utf8')).includes('未承認'));
  assert.ok((await fs.readFile(path.join(dir,'fixture','RESULTS.csv'),'utf8')).includes('TEST'));
  assert.equal(fixture.publishedClaimsVerified,false);
  const one=path.join(dir,'one.json');await fs.writeFile(one,JSON.stringify([{malId:5114,title:'鋼の錬金術師 FULLMETAL ALCHEMIST'}]));
  const fakeResponse=(payload,status=200)=>({ok:status===200,status,headers:{get:()=>null},json:async()=>payload});
  let urls=[], waits=[];
  const normal=await runAudit({sample:one,out:path.join(dir,'normal'),pages:2,requestBudget:4},
    {fetchFn:async url=>{urls.push(url);return url.endsWith('/5114')?fakeResponse({data:{mal_id:5114,title_japanese:'鋼の錬金術師 FULLMETAL ALCHEMIST',type:'TV'}}):fakeResponse({data:[{mal_id:1,aired:'2009-04-05T17:00:00+09:00'}],pagination:{has_next_page:false}});},pace:async ms=>{waits.push(ms);}});
  assert.equal(normal.requestCount,2);assert.equal(normal.metadataRequests,1);assert.equal(normal.episodePageRequests,1);
  assert.equal(normal.entries[0].identity.status,'ID_TITLE_MATCH');assert.equal(normal.entries[0].suitability,'SCHEDULE_ONLY');
  assert.equal(urls.length,2);assert.ok(waits.length>=1);assert.ok(waits[0]>0);
  let limitedCalls=0;
  const halted=await runAudit({sample,out:path.join(dir,'halted'),pages:2,requestBudget:8},{
    fetchFn:async()=>{limitedCalls++;return fakeResponse({},429);},pace:async()=>{}});
  assert.equal(halted.requestCount,1);assert.equal(limitedCalls,1);assert.equal(halted.rateLimitResponses,1);
  assert.equal(halted.failedRequests,1);assert.equal(halted.stoppedReason,'RATE_LIMIT_429');assert.deepEqual(halted.notRequested,[21]);
  // Exact requested-attempt accounting, no hidden retry even when Retry-After: 0.
  let budgetCalls=0;
  const budget=await runAudit({sample:one,out:path.join(dir,'budget'),pages:2,requestBudget:1},{
    fetchFn:async()=>{budgetCalls++;return fakeResponse({data:{mal_id:5114,title_japanese:'鋼の錬金術師 FULLMETAL ALCHEMIST',type:'TV'}});},pace:async()=>{}});
  assert.equal(budgetCalls,1);assert.equal(budget.requestCount,1);assert.equal(budget.stoppedReason,'REQUEST_BUDGET_EXHAUSTED');
  assert.equal(budget.entries[0].suitability,'PAGINATION_INCOMPLETE');
  let badIdentityCalls=0;
  const mismatched=await runAudit({sample:one,out:path.join(dir,'mismatch'),pages:2,requestBudget:3},{
    fetchFn:async()=>{badIdentityCalls++;return fakeResponse({data:{mal_id:21,title_japanese:'鋼の錬金術師 FULLMETAL ALCHEMIST'}});},pace:async()=>{}});
  assert.equal(badIdentityCalls,1);assert.equal(mismatched.entries[0].error,'IDENTITY_MAL_ID_MISMATCH');
  assert.equal(mismatched.entries[0].requestedPages,0);

  // REVIEW ISSUE 1: Exact budget exhaustion after a fully completed work must NOT
  // fabricate an entry for the next untouched work; both untouched IDs remain.
  const three=path.join(dir,'three.json');
  await fs.writeFile(three,JSON.stringify([
    {malId:5114,title:'TEST'},{malId:21,title:'LONG'},{malId:199,title:'MOVIE'}]));
  let exactCalls=[];
  const exact=await runAudit({sample:three,out:path.join(dir,'exact'),pages:2,requestBudget:2},{
    fetchFn:async url=>{exactCalls.push(url);return url.endsWith('/5114')
      ?fakeResponse({data:{mal_id:5114,title:'TEST',type:'TV'}})
      :fakeResponse({data:[{mal_id:1,aired:'2023-01-01'}],pagination:{has_next_page:false}});},pace:async()=>{}});
  assert.equal(exact.requestCount,2);
  assert.equal(exact.stoppedReason,'REQUEST_BUDGET_EXHAUSTED');
  assert.deepEqual(exact.entries.map(e=>e.malId),[5114]);
  assert.deepEqual(exact.notRequested,[21,199]);
  assert.equal(exactCalls.filter(u=>u.includes('/21')||u.includes('/199')).length,0);
  const exactSingle=await runAudit({sample:one,out:path.join(dir,'exact-single'),pages:2,requestBudget:2},{
    fetchFn:async url=>url.endsWith('/5114')
      ?fakeResponse({data:{mal_id:5114,title_japanese:'鋼の錬金術師 FULLMETAL ALCHEMIST',type:'TV'}})
      :fakeResponse({data:[{mal_id:1,aired:'2009-04-05'}],pagination:{has_next_page:false}}),pace:async()=>{}});
  assert.equal(exactSingle.stoppedReason,null);
  assert.deepEqual(exactSingle.notRequested,[]);

  // REVIEW ISSUE 2: Broken metadata is a global source failure, unlike a valid
  // but mismatched MAL ID or title (which remains a per-work refusal).
  for(const [name,body] of [['array',{data:[]}],['missing-id',{data:{title:'TEST'}}],
    ['missing-title',{data:{mal_id:5114,type:'TV'}}],['empty-object',{data:{}}]]){
    let malformedCalls=0;
    const broken=await runAudit({sample:three,out:path.join(dir,'bad-'+name),pages:2,requestBudget:8},{
      fetchFn:async()=>{malformedCalls++;return fakeResponse(body);},pace:async()=>{}});
    assert.equal(malformedCalls,1,`malformed ${name}: one attempt only`);
    assert.equal(broken.requestCount,1);
    assert.equal(broken.failedRequests,1);
    assert.equal(broken.stoppedReason,'IDENTITY_INVALID_METADATA');
    assert.equal(broken.entries[0].error,'IDENTITY_INVALID_METADATA');
    assert.deepEqual(broken.notRequested,[21,199]);
  }
  let mismatchCalls=0;
  const mismatchContinues=await runAudit({sample:three,out:path.join(dir,'mismatch-continues'),pages:1,requestBudget:3},{
    fetchFn:async()=>{mismatchCalls++;return fakeResponse({data:{mal_id:999,title:'Other'}});},pace:async()=>{}});
  assert.equal(mismatchCalls,3);
  assert.equal(mismatchContinues.stoppedReason,null);
  assert.equal(mismatchContinues.entries.length,3);

  // REVIEW ISSUE 3: 429's Retry-After must survive through JSON, CSV, Markdown,
  // both for metadata and for an episode page, with zero auto-retries.
  for(const stage of ['metadata','episodes']){
    let calls=0;
    const out429=path.join(dir,'429-'+stage);
    const report429=await runAudit({sample:three,out:out429,pages:2,requestBudget:8},{
      fetchFn:async()=>{calls++;return stage==='episodes'&&calls===1
        ?fakeResponse({data:{mal_id:5114,title:'TEST',type:'TV'}})
        :{status:429,ok:false,headers:{get:name=>name==='Retry-After'?'120':null}};},pace:async()=>{}});
    assert.equal(calls,stage==='metadata'?1:2);
    assert.equal(report429.stoppedReason,'RATE_LIMIT_429');
    assert.equal(report429.retryAfterMs,120000);
    assert.equal(report429.retryAfterHeader,'120');
    assert.equal(report429.trace.at(-1).retryAfterMs,120000);
    assert.equal(report429.entries[0].retryAfterMs,120000);
    assert.deepEqual(report429.notRequested,[21,199]);
    const exported=JSON.parse(await fs.readFile(path.join(out429,'RESULTS.json'),'utf8'));
    assert.equal(exported.retryAfterMs,120000);
    assert.equal(exported.entries[0].retryAfterMs,120000);
    assert.equal(exported.trace.at(-1).retryAfterMs,120000);
    const csv=await fs.readFile(path.join(out429,'RESULTS.csv'),'utf8');
    assert.match(csv,/retryAfterMs/);
    assert.match(csv,/120000/);
    const md=await fs.readFile(path.join(out429,'REVIEW.md'),'utf8');
    assert.match(md,/Retry-After: 120000ms（120秒）/);
    assert.match(md,/元ヘッダー: "120"/);
  }
} finally {await fs.rm(dir,{force:true,recursive:true});}
console.log('PASS episode-source v3: 429 stop, requests budget, pacing, HTTP-date, metadata, quality, movie, fixtures, exports, notices (NO LIVE CALLS)');
