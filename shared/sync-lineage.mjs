export function checkLineage(x){
 if(!x||Object.keys(x).sort().join(',')!=='api,boxId,history,sourceDigest,v'||x.v!==1||!['unknown','provided'].includes(x.history)||
  !/^[\w-]{22,43}$/.test(x.boxId)||! /^[a-f0-9]{64}$/.test(x.sourceDigest)||new URL(x.api).origin!==x.api||!x.api.startsWith('https://'))throw Error('INVALID_SYNC_LINEAGE');
 return {v:x.v,api:x.api,boxId:x.boxId,history:x.history,sourceDigest:x.sourceDigest};
}
