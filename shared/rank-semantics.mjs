// Pure, conservative ranking semantics. No clocks, storage, transport or IDs.
const stable=x=>JSON.stringify(x),eq=(a,b)=>stable(a)===stable(b);
const rating=r=>r?.status==='watched'&&Number.isInteger(r.review?.overall)&&r.review.overall>=1&&r.review.overall<=5?r.review.overall:null;
export function rankedGroup(snapshot,score){
 const rows=Object.values(snapshot.records).filter(r=>rating(r)===score);
 if(!rows.length)return {valid:true,ids:[],order:[]};
 if(rows.some(r=>!Number.isInteger(r.myRankOrder)||r.myRankOrder<0||r.myRankOrder>9999)||new Set(rows.map(r=>r.myRankOrder)).size!==rows.length)return {valid:false,ids:rows.map(r=>r.id).sort(),order:[]};
 return {valid:true,ids:rows.map(r=>r.id).sort(),order:rows.sort((a,b)=>a.myRankOrder-b.myRankOrder).map(r=>r.id)};
}
export {rating as rankRating};
const stamp=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x));
export function normalizeEquivalentRankMetadata(base,local,remote){
 let normalized=local,normalizedRemote=remote;const resolved=[];
 for(let score=1;score<=5;score++){
  const b=rankedGroup(base,score),l=rankedGroup(local,score),r=rankedGroup(remote,score);
  if(!b.valid||!l.valid||!r.valid||!l.ids.length||!eq(b.ids,l.ids)||!eq(l.ids,r.ids))continue;
  // Compare complete numeric rank coordinates, not timestamps or a partial list.
  // If both sides changed these differently, retain ordinary conflict detection.
  if(l.ids.some(id=>[base,local,remote].some(s=>Object.hasOwn(s.tombstones,id)||(s.records[id].rankUpdatedAt!==undefined&&!stamp(s.records[id].rankUpdatedAt)))))continue;
  const coordinatesEqual=(a,b)=>l.ids.every(id=>a.records[id].myRankOrder===b.records[id].myRankOrder);
  const equalResult=coordinatesEqual(local,remote),localUnchanged=coordinatesEqual(base,local),remoteUnchanged=coordinatesEqual(base,remote);
  if(!equalResult&&!localUnchanged&&!remoteUnchanged)continue;
  const conflicts=l.ids.filter(id=>{
   const b=base.records[id].rankUpdatedAt,l=local.records[id].rankUpdatedAt,r=remote.records[id].rankUpdatedAt;
   return (b===undefined||stamp(b))&&stamp(l)&&stamp(r)&&l!==r&&l!==b&&r!==b;
  });
  if(!conflicts.length)continue;
  // Do not manufacture a new group timestamp or use a device clock as authority.
  // Identical results reuse the server-observed metadata. A proven one-sided
  // reorder keeps the changing side, even if its clock is older. Original local
  // timestamps remain in the WAL; divergent reorders, changed membership,
  // deletion, unknown coordinates and other fields are never normalized here.
  if(!equalResult&&remoteUnchanged){
   if(normalizedRemote===remote)normalizedRemote=structuredClone(remote);
   for(const id of conflicts)normalizedRemote.records[id].rankUpdatedAt=local.records[id].rankUpdatedAt;
  }else{
   if(normalized===local)normalized=structuredClone(local);
   for(const id of conflicts)normalized.records[id].rankUpdatedAt=remote.records[id].rankUpdatedAt;
  }
  resolved.push({kind:equalResult?'equivalent-ranking-already-on-server':'one-sided-ranking-with-redundant-metadata',rating:score,count:conflicts.length});
 }
 return {local:normalized,remote:normalizedRemote,resolved};
}
