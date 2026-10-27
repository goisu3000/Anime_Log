// Pure generic review plan. Returned values are for the owner's local UI only.
// Never log, put in URLs, or send this review object to a diagnostics service.
import {mergeSnapshots,validateSnapshot} from '../sync-core.mjs';
import {rankedGroup,rankRating} from '../shared/rank-semantics.mjs';
const cp=structuredClone,own=(o,k)=>o!=null&&Object.hasOwn(o,k);
const stop=x=>{throw Error('CONFLICT_REVIEW_STOP:'+x)};
const parts=p=>p.split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
const stable=x=>JSON.stringify(x),same=(a,b)=>stable(a)===stable(b);
function at(s,path){let x=s;for(const k of parts(path)){if(!own(x,k))return {missing:true};x=x[k]}return {value:cp(x)}}
function put(s,path,source){const keys=parts(path);let parent=s;for(const k of keys.slice(0,-1)){if(['__proto__','constructor','prototype'].includes(k))stop('UNSAFE_PATH');if(!own(parent,k)||typeof parent[k]!=='object'||parent[k]===null)parent[k]={};parent=parent[k]}
 const key=keys.at(-1);if(['__proto__','constructor','prototype'].includes(key))stop('UNSAFE_PATH');if(source.missing)delete parent[key];else parent[key]=cp(source.value);
}
const category=p=>{const k=parts(p);return k[0]==='settings'?'settings':k[2]==='watchedEpisodes'?'progress':k[2]==='status'?'status':k[2]?.startsWith('note')?'note':k[2]?.startsWith('review')?'review':'other'};
const fields={watchedEpisodes:'視聴話数',status:'視聴状況',review:'評価',overall:'総合評価',aspects:'詳細評価',story:'ストーリー',visual:'映像',characters:'キャラクター',music:'音楽',note:'メモ',text:'メモ',noteDeletedAt:'メモの削除',reviewDeletedAt:'評価の削除',completedOn:'視聴完了日',streamPreference:'視聴サイト',weeklySchedule:'週間予定',weeklyOptions:'カレンダー設定',updatedAt:'更新情報',rankUpdatedAt:'順位情報'};
function label(path){const keys=parts(path);return fields[keys.at(-1)]??fields[keys[2]]??'保存内容'}
function state(s,id){return own(s.records,id)?{kind:'live',record:cp(s.records[id])}:own(s.tombstones,id)?{kind:'deleted',deletedAt:s.tombstones[id].deletedAt}:{kind:'unknown'}}
function rankComponents(snapshots,ids){
 const sets=ids.map(id=>new Set(snapshots.map(s=>rankRating(s.records[id])).filter(x=>x!==null)));
 for(const id of new Set(snapshots.flatMap(s=>Object.keys(s.records)))){
  const scores=new Set(snapshots.map(s=>rankRating(s.records[id])).filter(x=>x!==null));
  if(scores.size>1)sets.push(scores);
 }
 let changed=true;while(changed){changed=false;for(let i=0;i<sets.length;i++)for(let j=i+1;j<sets.length;j++)if([...sets[i]].some(x=>sets[j].has(x))){sets[i]=new Set([...sets[i],...sets[j]]);sets.splice(j--,1);changed=true}}
 return sets.filter(set=>ids.some(id=>snapshots.some(s=>set.has(rankRating(s.records[id]))))).map(set=>[...set].sort());
}
export function buildConflictReview(base,local,remote){
 const merge=mergeSnapshots(base,local,remote),snapshots=[base,local,remote],units=[],used=new Set();
 const works=merge.conflicts.filter(c=>parts(c.path)[0]==='works');
 for(const c of works){const id=parts(c.path)[1];units.push({kind:'record',category:'deletion',dangerous:true,recordId:id,title:local.records[id]?.title??remote.records[id]?.title??'作品',label:'削除・復元と編集',paths:[c.path],options:{local:state(local,id),remote:state(remote,id)}});used.add(c.path)}
 // Content and its deletion marker must be selected atomically: retaining a
 // note without clearing the remote marker could otherwise hide the chosen text.
 for(const property of ['note','review'])for(const id of new Set(merge.conflicts.filter(c=>parts(c.path)[0]==='records'&&[property,property+'DeletedAt'].includes(parts(c.path)[2])).map(c=>parts(c.path)[1]))){
  if(works.some(c=>parts(c.path)[1]===id)||!snapshots.some(s=>own(s.records[id],property+'DeletedAt')))continue;
  const conflicts=merge.conflicts.filter(c=>{const p=parts(c.path);return p[0]==='records'&&p[1]===id&&[property,property+'DeletedAt'].includes(p[2])});
  const option=s=>own(s.records[id],property)?{value:cp(s.records[id][property])}:{kind:'deleted'};
  units.push({kind:'lifecycle',category:property==='note'?'note':'review',dangerous:true,recordId:id,property,title:local.records[id]?.title??remote.records[id]?.title??'作品',label:(property==='note'?'メモ':'評価')+'の削除・編集',paths:conflicts.map(c=>c.path),options:{local:option(local),remote:option(remote)}});conflicts.forEach(c=>used.add(c.path));
 }
 const affectsRank=c=>{const p=parts(c.path);return ['myRankOrder','rankUpdatedAt','status','reviewDeletedAt'].includes(p[2])||p[2]==='review'&&(p.length===3||p[3]==='overall')};
 const rankConflicts=merge.conflicts.filter(c=>['myRankOrder','rankUpdatedAt'].includes(parts(c.path)[2])&&snapshots.some(s=>rankRating(s.records[parts(c.path)[1]])!==null)&&!works.some(w=>parts(w.path)[1]===parts(c.path)[1]));
 // A status/overall/deletion dispute may change group membership even when
 // rank coordinates themselves do not conflict. Offer a whole-group editor in
 // that case too; keep the membership field separately selectable.
 const memberConflicts=merge.conflicts.filter(c=>affectsRank(c)&&!['myRankOrder','rankUpdatedAt'].includes(parts(c.path)[2])&&snapshots.some(s=>rankRating(s.records[parts(c.path)[1]])!==null)&&!works.some(w=>parts(w.path)[1]===parts(c.path)[1]));
 const components=rankComponents(snapshots,[...rankConflicts,...memberConflicts].map(c=>parts(c.path)[1]));
 for(const ratings of components){
  const ids=[...new Set(snapshots.flatMap(s=>Object.values(s.records).filter(r=>ratings.includes(rankRating(r))).map(r=>r.id)))].sort();
  const related=merge.conflicts.filter(c=>{const p=parts(c.path);return p[0]==='records'&&ids.includes(p[1])&&affectsRank(c)});
  const conflicts=related.filter(c=>!used.has(c.path)&&['myRankOrder','rankUpdatedAt'].includes(parts(c.path)[2]));
  if(!conflicts.length&&!related.some(c=>memberConflicts.includes(c)))continue;
  // Many ordinary rated works have never been manually ranked at all. Their
  // absent rank coordinates are not a request to order the whole collection.
  if(!conflicts.length&&(!ratings.every(score=>rankedGroup(base,score).valid)||!ratings.some(score=>rankedGroup(base,score).ids.length)))continue;
  const option=s=>({valid:ratings.every(r=>rankedGroup(s,r).valid),groups:ratings.map(r=>({rating:r,rows:rankedGroup(s,r).order.map(id=>({id,title:s.records[id].title,position:s.records[id].myRankOrder}))}))});
  units.push({kind:'ranking',category:'ranking',dangerous:works.some(w=>ids.includes(parts(w.path)[1])),label:'順位・評価グループ全体',ratings,memberIds:ids,paths:conflicts.map(c=>c.path),options:{local:option(local),remote:option(remote)}});
  conflicts.forEach(c=>used.add(c.path));
 }
 for(const c of merge.conflicts){
  if(used.has(c.path))continue;const p=parts(c.path);
  if(works.some(w=>parts(w.path)[1]===p[1]))continue;
  // Ranking metadata outside a verifiable ranked group cannot be split per item.
  if(['myRankOrder','rankUpdatedAt'].includes(p[2]))stop('UNVERIFIABLE_RANK_GROUP');
  units.push({kind:'field',category:category(c.path),dangerous:false,title:local.records[p[1]]?.title??remote.records[p[1]]?.title??'',label:label(c.path),paths:[c.path],options:{local:at(local,c.path),remote:at(remote,c.path)}});
 }
 units.forEach((unit,i)=>{unit.id='choice-'+i});
 return {units,automaticResolutions:merge.automaticResolutions??[],conflictCount:merge.conflicts.length,merge};
}
export function bulkConflictChoices(review,source,{includeDangerous=false,dangerousConfirmed=false}={}){
 if(!['local','remote'].includes(source))stop('SOURCE_REQUIRED');if(includeDangerous&&!dangerousConfirmed)stop('DELETE_RESTORE_CONFIRMATION_REQUIRED');
 return Object.fromEntries(review.units.filter(u=>includeDangerous?u.dangerous:!u.dangerous).filter(u=>u.kind!=='record'||u.options[source].kind!=='unknown').filter(u=>u.kind!=='ranking'||u.options[source].valid).map(u=>[u.id,{source,...(u.dangerous?{dangerousConfirmed:true}:{})}]));
}
function manual(unit,value){
 const path=parts(unit.paths[0]),field=path.at(-1);
 if(field==='watchedEpisodes'&&Number.isInteger(value)&&value>=0&&value<=9999)return {value};
 if(field==='status'&&['watching','watched','planned','paused','dropped'].includes(value))return {value};
 if(field==='overall'&&Number.isInteger(value)&&value>=1&&value<=5)return {value};
 if(['story','visual','characters','music'].includes(field)&&path.includes('aspects')&&Number.isInteger(value)&&value>=1&&value<=4)return {value};
 if(path[2]==='note'&&field==='text'&&typeof value==='string'&&value.trim().length>0&&value.trim().length<=500)return {value:value.trim()};
 if(path[2]==='note'&&field==='note'&&typeof value==='string'&&value.trim().length>0&&value.trim().length<=500)return {value:{text:value.trim(),updatedAt:new Date().toISOString()}};
 stop('MANUAL_VALUE_NOT_SUPPORTED');
}
export function manualConflictKind(unit){
 if(unit.kind==='lifecycle'&&unit.property==='note')return 'note';
 if(unit.kind!=='field')return null;const p=parts(unit.paths[0]),f=p.at(-1);
 if(f==='status')return 'status';if(f==='watchedEpisodes')return 'episodes';if(f==='overall')return 'rating';
 if(['story','visual','characters','music'].includes(f)&&p.includes('aspects'))return 'aspect';if(p[2]==='note'&&['text','note'].includes(f))return 'note';return null;
}
export function applyConflictChoices({review,base,local,remote,choices}={}){
 const current=buildConflictReview(base,local,remote);if(!same(current.units.map(u=>[u.id,u.paths]),review.units.map(u=>[u.id,u.paths])))stop('PLAN_CHANGED');
 const next=cp(current.merge.merged),source=s=>s==='local'?local:remote,manualRanks=[];
 for(const u of current.units){
  const choice=choices?.[u.id];if(!choice||!['local','remote','manual'].includes(choice.source))stop('ALL_CHOICES_REQUIRED');
  if(u.dangerous&&choice.dangerousConfirmed!==true)stop('DELETE_RESTORE_CONFIRMATION_REQUIRED');
  if(u.kind==='lifecycle'){
   const record=next.records[u.recordId];if(!record)stop('RECORD_STATE_CHOICES_INCONSISTENT');
   if(choice.source==='manual'){
    if(u.property!=='note'||typeof choice.value!=='string'||!choice.value.trim()||choice.value.trim().length>500)stop('MANUAL_VALUE_NOT_SUPPORTED');record.note={text:choice.value.trim(),updatedAt:new Date().toISOString()};delete record.noteDeletedAt;
   }else for(const key of [u.property,u.property+'DeletedAt']){if(own(source(choice.source).records[u.recordId],key))record[key]=cp(source(choice.source).records[u.recordId][key]);else delete record[key]}
   continue;
  }
  if(u.kind==='field'){
   put(next,u.paths[0],choice.source==='manual'?manual(u,choice.value):at(source(choice.source),u.paths[0]));
   if(choice.source==='manual'){
    const p=parts(u.paths[0]),record=next.records[p[1]],stamp=new Date().toISOString();
    if(p[2]==='note'&&record?.note)record.note.updatedAt=stamp;
    else if(p[2]==='review'&&record?.review)record.review.updatedAt=stamp;
    else if(record&&['status','watchedEpisodes'].includes(p[2]))record.updatedAt=stamp;
   }
   continue;
  }
  if(choice.source==='manual'&&u.kind==='ranking'){
   if(!['local','remote'].includes(choice.membershipSource)||!choice.orders)stop('WHOLE_GROUP_ORDER_REQUIRED');
   for(const path of u.paths)if(!['myRankOrder','rankUpdatedAt'].includes(parts(path)[2]))put(next,path,at(source(choice.membershipSource),path));
   manualRanks.push([u,choice]);continue;
  }
  if(choice.source==='manual')stop('GROUP_SOURCE_REQUIRED');
  const selected=source(choice.source);
  if(u.kind==='record'){
   const selectedState=state(selected,u.recordId);if(selectedState.kind==='unknown')stop('MISSING_DELETION_HISTORY');
   delete next.records[u.recordId];delete next.tombstones[u.recordId];
   if(selectedState.kind==='live')next.records[u.recordId]=cp(selected.records[u.recordId]);else next.tombstones[u.recordId]=cp(selected.tombstones[u.recordId]);
  }else{
   if(!u.options[choice.source].valid)stop('AMBIGUOUS_RANK_ORDER');
   for(const id of u.memberIds)if(next.records[id])for(const key of ['myRankOrder','rankUpdatedAt']){
    if(own(selected.records[id],key))next.records[id][key]=selected.records[id][key];else delete next.records[id][key];
   }
   for(const path of u.paths)if(!['myRankOrder','rankUpdatedAt'].includes(parts(path)[2]))put(next,path,at(selected,path));
  }
 }
 for(const [u,choice] of manualRanks){
  const stamp=new Date().toISOString();if(Object.keys(choice.orders).sort().join(',')!==u.ratings.map(String).sort().join(','))stop('RANK_GROUP_SET_CHANGED');
  for(const score of u.ratings){
   const members=Object.values(next.records).filter(r=>rankRating(r)===score).map(r=>r.id).sort(),order=choice.orders[score];
   if(!Array.isArray(order)||new Set(order).size!==order.length||!same([...order].sort(),members))stop('RANK_MEMBERSHIP_CHOICES_INCONSISTENT');
   order.forEach((id,index)=>{next.records[id].myRankOrder=index;next.records[id].rankUpdatedAt=stamp});
  }
 }
 validateSnapshot(next);
 for(const u of current.units.filter(u=>u.kind==='ranking')){
  if(choices[u.id].source==='manual'){if(u.ratings.some(score=>!rankedGroup(next,score).valid))stop('AMBIGUOUS_RANK_ORDER');continue}
  const selected=source(choices[u.id].source);
  for(const score of u.ratings){const desired=rankedGroup(selected,score),actual=rankedGroup(next,score);if(!actual.valid||!same(actual.ids,desired.ids)||!same(actual.order,desired.order))stop('RANK_MEMBERSHIP_CHOICES_INCONSISTENT')}
 }
 return next;
}
// Read-only proposal after the other selections. Missing rank coordinates are
// only proposed in a visible list; they never become an automatic resolution.
export function rankEditorRows({review,base,local,remote,choices,unitId,membershipSource}){
 const u=review.units.find(u=>u.id===unitId&&u.kind==='ranking');if(!u||!['local','remote'].includes(membershipSource))stop('MEMBERSHIP_SOURCE_REQUIRED');
 const draft=cp(mergeSnapshots(base,local,remote).merged),source=s=>s==='local'?local:remote;
 for(const unit of review.units){const choice=choices?.[unit.id];if(!choice)continue;
  if(unit.kind==='field')put(draft,unit.paths[0],choice.source==='manual'?manual(unit,choice.value):at(source(choice.source),unit.paths[0]));
  else if(unit.kind==='record'&&['local','remote'].includes(choice.source)){
   const selected=source(choice.source),value=state(selected,unit.recordId);if(value.kind==='unknown')stop('MISSING_DELETION_HISTORY');delete draft.records[unit.recordId];delete draft.tombstones[unit.recordId];
   if(value.kind==='live')draft.records[unit.recordId]=cp(selected.records[unit.recordId]);else draft.tombstones[unit.recordId]=cp(selected.tombstones[unit.recordId]);
  }else if(unit.kind==='lifecycle'&&['local','remote'].includes(choice.source)){
   if(!draft.records[unit.recordId])stop('RECORD_STATE_CHOICES_INCONSISTENT');for(const key of [unit.property,unit.property+'DeletedAt']){if(own(source(choice.source).records[unit.recordId],key))draft.records[unit.recordId][key]=cp(source(choice.source).records[unit.recordId][key]);else delete draft.records[unit.recordId][key]}
  }
 }
 for(const path of u.paths)if(!['myRankOrder','rankUpdatedAt'].includes(parts(path)[2]))put(draft,path,at(source(membershipSource),path));
 return u.ratings.map(score=>({rating:score,rows:Object.values(draft.records).filter(r=>rankRating(r)===score).sort((a,b)=>(Number.isInteger(a.myRankOrder)?a.myRankOrder:99999)-(Number.isInteger(b.myRankOrder)?b.myRankOrder:99999)||a.id.localeCompare(b.id)).map(r=>({id:r.id,title:r.title}))}));
}
