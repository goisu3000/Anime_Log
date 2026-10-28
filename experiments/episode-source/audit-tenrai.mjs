#!/usr/bin/env node
/** ANI:LOG experiment only: Tenrai episodes source audit. Never modifies ANI:LOG data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessEpisodes,malId,verifyAnimeIdentity} from './episode-audit-core.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SAMPLE=path.join(here,'samples/tenrai-mal-ids.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(args,name,def=null)=>{const i=args.indexOf(name);return i<0?def:args[i+1]??null;};
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
const MIN_START_GAP_MS=1500;

export function parseArgs(args) {
  if(args.includes('--help'))return {help:true};
  const sample=arg(args,'--sample',DEFAULT_SAMPLE),out=arg(args,'--out',path.join(here,'results'));
  const fixture=arg(args,'--fixture');
  const pages=Number(arg(args,'--max-pages','2'));
  const requestBudget=Number(arg(args,'--max-requests','8'));
  if(!sample||!out||!Number.isInteger(pages)||pages<1||pages>4)throw Error('INVALID_SAMPLE_OUTPUT_OR_PAGES');
  if(!Number.isInteger(requestBudget)||requestBudget<1||requestBudget>60)throw Error('MAX_REQUESTS_OUT_OF_RANGE_1_TO_60');
  return {sample:path.resolve(sample),out:path.resolve(out),fixture:fixture?path.resolve(fixture):null,pages,requestBudget};
}

/** Parse numeric seconds or RFC HTTP-date exactly, without truncating server-requested waits. */
export function retryAfterMs(header, now=Date.now()) {
  if(header===null||header===undefined||String(header).trim()==='')return null;
  const text=String(header).trim();
  if(/^\d+(?:\.\d+)?$/.test(text)){
    const seconds=Number(text);
    return Number.isFinite(seconds)&&seconds>=0?Math.ceil(seconds*1000):null;
  }
  const date=Date.parse(text);
  return Number.isFinite(date)?Math.max(0,date-now):null;
}

/** Exactly one HTTP attempt. On 429 return an error; do NOT auto retry. */
export async function fetchTenrai({malId:id,page=1,kind='episodes',fetchFn=fetch}) {
  const url=kind==='metadata'?`https://api.tenrai.org/v1/anime/${id}`:`https://api.tenrai.org/v1/anime/${id}/episodes?page=${page}`;
  let response;
  try {response=await fetchFn(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});}
  catch(err){return {error:'NETWORK:'+String(err?.message||err).slice(0,140),httpAttempts:1,url};}
  if(response.status===429){
    const retryAfterHeader=response.headers?.get?.('Retry-After')??null;
    return {error:'RATE_LIMIT_429',retryAfterMs:retryAfterMs(retryAfterHeader),retryAfterHeader,status:429,httpAttempts:1,url};
  }
  if(!response.ok)return {error:`HTTP_${response.status}`,status:response.status,httpAttempts:1,url};
  try{return {data:await response.json(),status:response.status,httpAttempts:1,url};}
  catch{return {error:'INVALID_JSON',status:response.status,httpAttempts:1,url};}
}

export async function runAudit({sample,out,fixture=null,pages=2,requestBudget=8},{fetchFn=fetch,pace=pause}={}) {
  if(!Number.isInteger(requestBudget)||requestBudget<1||requestBudget>60)throw Error('REQUEST_BUDGET_INVALID');
  if(!Number.isInteger(pages)||pages<1||pages>4)throw Error('PAGES_INVALID');
  const records=JSON.parse(await fs.readFile(sample,'utf8'));
  if(!Array.isArray(records)||records.length<1||records.length>30)throw Error('SAMPLE_COUNT_MUST_BE_1_TO_30');
  const seen=new Set();
  for (const r of records) {
    if(!r||malId(r.malId)!==r.malId||seen.has(r.malId)||typeof r.title!=='string'||!r.title.trim())throw Error('INVALID_SAMPLE_OR_DUPLICATE_ID');
    seen.add(r.malId);
  }
  const fixtures=fixture?JSON.parse(await fs.readFile(fixture,'utf8')):null;
  const now=Date.now(),entries=[],trace=[];
  let httpAttempts=0,metadataRequests=0,episodeRequests=0,rateLimitResponses=0,failedRequests=0,lastStart=null,stoppedReason=null;
  async function request(id,kind,page) {
    if(httpAttempts>=requestBudget) {stoppedReason='REQUEST_BUDGET_EXHAUSTED';return {error:stoppedReason,budget:true};}
    if(lastStart!==null) {
      const wait=Math.max(0,MIN_START_GAP_MS-(Date.now()-lastStart));
      if(wait>0)await pace(wait);
    }
    lastStart=Date.now();
    httpAttempts++;
    if(kind==='metadata')metadataRequests++;else episodeRequests++;
    const res=await fetchTenrai({malId:id,kind,page,fetchFn});
    trace.push({attempt:httpAttempts,kind,malId:id,page:kind==='episodes'?page:null,status:res.status??null,error:res.error??null,
      retryAfterMs:res.retryAfterMs??null,retryAfterHeader:res.retryAfterHeader??null});
    if(res.error){failedRequests++;if(res.status===429)rateLimitResponses++;stoppedReason=res.error;}
    return res;
  }
  for(const item of records) {
    // The next work has not been attempted when the budget is already exhausted.
    // Keep it (and all later works) in notRequested; never create a synthetic entry.
    if(!fixtures && httpAttempts>=requestBudget){stoppedReason='REQUEST_BUDGET_EXHAUSTED';break;}
    const fetched=[];let complete=false,error=null,metadataType=null,errorRetryAfterMs=null,errorRetryAfterHeader=null;
    let identity={status:'NOT_VERIFIED',returnedMalId:null,type:null,title:null};
    if(fixtures){
      const fixtureMetadata=fixtures[String(item.malId)]?.metadata;
      if(fixtureMetadata){identity=verifyAnimeIdentity(item,fixtureMetadata);metadataType=identity.type;}
      else identity={status:'FIXTURE_NO_METADATA',returnedMalId:null,type:null,title:null};
    } else if(!stoppedReason){
      const res=await request(item.malId,'metadata',null);
      if(res.error){error=res.error;errorRetryAfterMs=res.retryAfterMs??null;errorRetryAfterHeader=res.retryAfterHeader??null;}
      else {identity=verifyAnimeIdentity(item,res.data);metadataType=identity.type;
        if(identity.status!=='ID_TITLE_MATCH'){
          error=`IDENTITY_${identity.status}`;
          // Malformed metadata is a source failure; a valid but mismatched identity
          // is only a per-work refusal (do not fetch its episodes).
          if(identity.status==='INVALID_METADATA'){stoppedReason=error;failedRequests++;}
        }
      }
    }else error=stoppedReason;
    if(!error){
      for(let page=1;page<=pages;page++){
        const res=fixtures?{data:fixtures[String(item.malId)]?.[page-1]}:await request(item.malId,'episodes',page);
        if(res.error){error=res.error;errorRetryAfterMs=res.retryAfterMs??null;errorRetryAfterHeader=res.retryAfterHeader??null;break;}
        const body=res.data;
        if(!body||!Array.isArray(body.data)||!body.pagination||typeof body.pagination.has_next_page!=='boolean'){
          error='UNEXPECTED_API_SCHEMA';if(!fixtures){stoppedReason='UNEXPECTED_API_SCHEMA';failedRequests++;}break;
        }
        fetched.push({data:body.data});
        if(!body.pagination.has_next_page){complete=true;break;}
      }
    }
    const assessed=assessEpisodes(fetched,{now,complete,metadataType});
    entries.push({malId:item.malId,title:item.title,case:item.case??'',identity,requestedPages:fetched.length,complete,error,
      retryAfterMs:errorRetryAfterMs,retryAfterHeader:errorRetryAfterHeader,...assessed});
    process.stdout.write(`${item.malId} ${error?'ERROR '+error:assessed.suitability} (${assessed.count} rows; identity ${identity.status})\n`);
    // Stop after a 429, network failure or budget exhaustion. Do not create fake entries for unrequested works.
    if(stoppedReason)break;
  }
  const report={name:'ANI:LOG Tenrai episode source quality audit',source:'Tenrai public episodes endpoint',runAt:new Date(now).toISOString(),
    requestCount:httpAttempts,metadataRequests,episodePageRequests:episodeRequests,rateLimitResponses,failedRequests,
    requestBudget,minimumRequestStartGapMs:MIN_START_GAP_MS,stoppedReason,trace,
    retryAfterMs:trace.find(t=>t.retryAfterMs!==null)?.retryAfterMs??null,
    retryAfterHeader:trace.find(t=>t.retryAfterHeader!==null)?.retryAfterHeader??null,
    live:!fixture,productionChange:false,
    publishedClaimsVerified:false,summary:'Episode aired dates are NOT proof of public availability.',entries,
    notRequested:records.slice(entries.length).map(r=>r.malId)};
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'RESULTS.json'),JSON.stringify(report,null,2)+'\n');
  const fields=['malId','title','case','requestedPages','complete','error','retryAfterMs','retryAfterHeader','count','lastIndexedEpisode','pastDatedMaximum','missingDate','duplicates','missingNumber','suitability','publishVerification'];
  await fs.writeFile(path.join(out,'RESULTS.csv'),[fields.join(','),...entries.map(e=>fields.map(k=>csvCell(e[k])).join(','))].join('\n')+'\n');
  const rows=entries.map(e=>`| ${e.malId} | ${String(e.title).replaceAll('|','/')} | ${e.identity.status} | ${e.lastIndexedEpisode??'—'} | ${e.complete?'全ページ':'途中'} | ${e.suitability} | ${e.error??'—'} |`).join('\n');
  const md=`# ANI:LOG Tenrai話数監査（新着機能では使用しない）\n\n- 実行日時: ${report.runAt}\n- モード: ${fixture?'オフラインfixture':'実Tenrai API'}\n- **実HTTP通信回数（メタデータ含む）: ${httpAttempts}件**（照合 ${metadataRequests}、話数 ${episodeRequests}）。429: ${rateLimitResponses}、失敗: ${failedRequests}。\n- 1回のHTTP試行ごとに計上。429後は自動再試行しない。最低開始間隔: ${MIN_START_GAP_MS}ms。\n- 停止理由: ${stoppedReason??'なし'} / 未リクエスト作品ID: ${report.notRequested.join(', ')||'なし'}\n- 429時のRetry-After: ${report.retryAfterMs===null?'指定なし':`${report.retryAfterMs}ms（${report.retryAfterMs/1000}秒）`} / 元ヘッダー: ${report.retryAfterHeader===null?'なし':JSON.stringify(report.retryAfterHeader)}。自動再試行は行わない。\n- **公式の公開実績照合: 0件**。「放送日が過去」だけでは「公開済み」と表示しない。\n- 本番・同期・個人視聴記録の変更: **なし**。\n\n| MAL ID | 作品 | ID/タイトル照合 | 取得最大話数 | ページ | 品質 | エラー |\n|---|---|---|---:|---|---|---|\n${rows}\n\n注意：IDとタイトルが一致しても、シーズン区分や放送・配信の完了が証明されたわけではありません。映画でエピソード配列が空でも通信失敗と断定しません。\n\n**結論：新着通知公開・AniList置換はいずれも未承認。**\n`;
  await fs.writeFile(path.join(out,'REVIEW.md'),md);
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const conf=parseArgs(process.argv.slice(2));
    if(conf.help)console.log('node experiments/episode-source/audit-tenrai.mjs [--sample PATH] [--fixture PATH] [--max-pages 1..4] [--max-requests 1..60] [--out DIR]\nDefaults: max-pages 2, max-requests 8. Single HTTP attempts, 1500ms min start gap, NO auto retries; read only.');
    else {const result=await runAudit(conf);console.log(`OUTPUT: ${conf.out} / samples=${result.entries.length}, httpRequests=${result.requestCount}, status=${result.stoppedReason??'OK'}`);}
  }catch(err){console.error('AUDIT_ERROR',err.message);process.exitCode=1;}
}
