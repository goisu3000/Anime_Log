#!/usr/bin/env node
/** ANI:LOG read-only API quality sampler. NO access to records, storage, secrets or user APIs.
 * Usage: node experiments/episode-source/audit-tenrai.mjs [--fixture file] [--out directory] [--sample file]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessEpisodes,malId} from './episode-audit-core.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SAMPLE=path.join(here,'samples/tenrai-mal-ids.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const arg=(args,name,defaultVal=null)=>{const i=args.indexOf(name);return i<0?defaultVal:args[i+1]??null;};
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
export function parseArgs(args){
 const sample=arg(args,'--sample',DEFAULT_SAMPLE),out=arg(args,'--out',path.join(here,'results'));
 const fixture=arg(args,'--fixture');
 const pages=Math.min(4,Math.max(1,Number.parseInt(arg(args,'--max-pages','2'),10)||2));
 if(args.includes('--help'))return {help:true};
 if(!sample||!out)throw Error('MISSING_SAMPLE_OR_OUTPUT');
 return {sample:path.resolve(sample),out:path.resolve(out),fixture:fixture?path.resolve(fixture):null,pages};
}
const retryAfterMs=header=>{const n=Number(header);return Number.isFinite(n)&&n>=0?Math.min(60000,n*1000):5000;};
export async function fetchTenrai({malId:id,page,fetchFn=fetch,pace=pause}){
 const url=`https://api.tenrai.org/v1/anime/${id}/episodes?page=${page}`;
 for(let attempt=0;attempt<2;attempt++){
  let res;
  try{res=await fetchFn(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});}catch(err){return {error:'NETWORK:'+String(err?.message||err).slice(0,140)};}
  if(res.status===429){const wait=retryAfterMs(res.headers?.get?.('Retry-After'));
   if(attempt===0){await pace(wait);continue;}
   return {error:'RATE_LIMIT_429',retryAfterMs:wait};
  }
  if(!res.ok)return {error:`HTTP_${res.status}`};
  try{return {data:await res.json()};}catch{return {error:'INVALID_JSON'};}
 }
 return {error:'RETRY_EXHAUSTED'};
}
export async function runAudit({sample,out,fixture=null,pages=2},{fetchFn=fetch,pace=pause}={}){
 const records=JSON.parse(await fs.readFile(sample,'utf8'));
 if(!Array.isArray(records)||records.length<1||records.length>30)throw Error('SAMPLE_COUNT_MUST_BE_1_TO_30');
 const seen=new Set();for(const r of records){if(malId(r?.malId)!==r.malId||seen.has(r.malId))throw Error('INVALID_OR_DUPLICATE_MAL_ID');seen.add(r.malId);}
 const fixtures=fixture?JSON.parse(await fs.readFile(fixture,'utf8')):null;
 const entries=[];const now=Date.now();let calls=0;
 for(const item of records){
  const fetched=[];let complete=false,error=null;
  for(let page=1;page<=pages;page++){
   if(!fixtures){if(calls>0)await pace(1250);calls++;}
   const response=fixtures?{data:fixtures[String(item.malId)]?.[page-1]}:await fetchTenrai({malId:item.malId,page,fetchFn,pace});
   if(response.error){error=response.error;break;}
   const body=response.data;
   if(!body||!Array.isArray(body.data)||!body.pagination||typeof body.pagination.has_next_page!=='boolean'){error='UNEXPECTED_API_SCHEMA';break;}
   fetched.push({data:body.data});
   if(!body.pagination.has_next_page){complete=true;break;}
  }
  const assessed=assessEpisodes(fetched,{now,complete});
  entries.push({malId:item.malId,title:item.title,case:item.case??'',requestedPages:fetched.length,complete,error,...assessed});
  process.stdout.write(`${item.malId} ${error?'ERROR '+error:assessed.suitability} (${assessed.count} rows)\n`);
 }
 const report={name:'ANI:LOG episode source quality audit',source:'Tenrai public episodes endpoint',runAt:new Date(now).toISOString(),requestCount:calls,live:!fixture,
  productionChange:false,publishedClaimsVerified:false,summary:'EPISODE AIR_DATE IS NOT PROOF OF PUBLIC AVAILABILITY. Verification requires external official sources.',entries};
 await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'RESULTS.json'),JSON.stringify(report,null,2)+'\n');
 const header=['malId','title','case','requestedPages','complete','error','count','lastIndexedEpisode','pastDatedMaximum','missingDate','future','consecutive','suitability','publishVerification'];
 const csv=[header.join(','),...entries.map(e=>header.map(key=>csvCell(e[key])).join(','))].join('\n')+'\n';
 await fs.writeFile(path.join(out,'RESULTS.csv'),csv);
 const rows=entries.map(e=>`| ${e.malId} | ${String(e.title).replaceAll('|','/')} | ${e.lastIndexedEpisode??'—'} | ${e.pastDatedMaximum??'—'} | ${e.complete?'全ページ':'途中'} | ${e.suitability} | ${e.error??'—'} |`).join('\n');
 const md=`# ANI:LOG Tenrai話数・日付 読み取り監査\n\n- 実行日時: ${report.runAt}\n- モード: ${fixture?'オフライン固定fixture':'Tenrai実API（少数逐次アクセス）'}\n- APIへの実通信: ${calls}件\n- **公開済みの検証結果: 0件**。`+'`aired`'+`は予定・放送日の記録で、公開確認ではない。\n- サイト、同期、暗号化、個人記録、本番データの変更: **なし**\n\n| MAL ID | 作品 | 最大登録話数 | 日付が過去の最大話数（公開の証明ではない） | ページ完走 | 判定 | 失敗 |\n|---|---|---:|---:|---|---|---|\n${rows}\n\n## 未実施の必須工程\n\n1. 個別作品の公式放送・配信発表と日付・話数・シーズンを照合する。\n2. 今期放送中、Web限定、分割クール、延期作、長期シリーズを含めて20〜30件へ拡充する。\n3. 既存週間カレンダー（AniList）との差を同じ週で比較する。\n4. 予定日が過ぎただけで「第〇話まで公開」と表示しない。\n5. 欠測・部分ページング・誤ID・誤シーズンを誤表示として扱わず、必ず非表示にする。\n\n**判定: 新着通知公開は未承認。**\n`;
 await fs.writeFile(path.join(out,'REVIEW.md'),md);
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const conf=parseArgs(process.argv.slice(2));if(conf.help){console.log('node experiments/episode-source/audit-tenrai.mjs [--sample PATH] [--fixture PATH] [--max-pages 1..4] [--out DIR]\nRead-only, <=30 titles, serial 1250ms between requests. Writes RESULTS.* and REVIEW.md under out.');}
 else{const result=await runAudit(conf);console.log(`OUTPUT: ${conf.out} / entries=${result.entries.length} requests=${result.requestCount}`);}}
 catch(err){console.error('AUDIT_ERROR',err.message);process.exitCode=1;}
}
