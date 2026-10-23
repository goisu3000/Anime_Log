/* ANI:LOG v4.09 - ONE-SHOT synthetic staging owner handoff.
 * The owner capability is SECRET, remains URL-FRAGMENT ONLY, and is immediately
 * removed by the document's first synchronous inline script. No persistence.
 * This is not a public user enrollment method. */
const stop=reason=>{throw Error('V409_OWNER_HANDOFF_STOP:'+reason)};
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const OWNER_PAGE='/development/v409-FORMAL_DEV_HTTPS_PAIRING_SYNTHETIC_ONLY';
const OKEYS=['apiOrigin','boxId','deviceId','deviceToken','masterKey','siteOrigin','v'];
function checkOrigin(input){let u;try{u=new URL(input)}catch{stop('BAD_ORIGIN')}
 if(u.protocol!=='https:'||u.href!==u.origin+'/'||u.username||u.password||u.hash||u.search||u.hostname==='anime-log-rouge.vercel.app')stop('BAD_ORIGIN');
 return u.origin;}
export function createV409OwnerHandoff({siteOrigin,apiOrigin,boxId,deviceId,deviceToken,masterKey,page='/development/v409-FORMAL_DEV_HTTPS_PAIRING_SYNTHETIC_ONLY.html'}={}){
 const site=checkOrigin(siteOrigin),api=checkOrigin(apiOrigin);
 if(site===api||!ID.test(boxId)||!ID.test(deviceId)||!TOKEN.test(deviceToken)||!(masterKey instanceof Uint8Array)||masterKey.length!==32||page!=='/development/v409-FORMAL_DEV_HTTPS_PAIRING_SYNTHETIC_ONLY.html')stop('BAD_CAPABILITY');
 // Encode a JSON fragment as percent-escaped text to prevent accidental queries.
 const key=Array.from(masterKey,byte=>String.fromCharCode(byte)).join('');
 const encodedKey=btoa(key).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const record={v:1,siteOrigin:site,apiOrigin:api,boxId,deviceId,deviceToken,masterKey:encodedKey};
 return site+page+'#anilog-owner='+encodeURIComponent(JSON.stringify(record));
}
export function parseV409OwnerHandoff(href,{expectedSite,expectedApi,expectedPage=OWNER_PAGE}={}){
 const site=checkOrigin(expectedSite),api=checkOrigin(expectedApi);
 if(site===api||typeof href!=='string'||href.length>2048)stop('INVALID_SOURCE');
 let u;try{u=new URL(href)}catch{stop('INVALID_SOURCE')}
 // Pages redirects the exact .html asset to its extensionless canonical path.
 if(![OWNER_PAGE,OWNER_PAGE+'.html','/','/development/ANI-LOG_FORMAL_SYNC_DEV.html','/development/ANI-LOG_FORMAL_SYNC_DEV'].includes(expectedPage))stop('INVALID_EXPECTED_PAGE');
 const basePage=expectedPage.endsWith('.html')?expectedPage.slice(0,-5):expectedPage;
 const paths=basePage==='/'?['/']:[basePage,basePage+'.html'];
 if(u.origin!==site||!paths.includes(u.pathname)||u.search||!u.hash.startsWith('#anilog-owner='))stop('INVALID_SOURCE');
 let x;try{x=JSON.parse(decodeURIComponent(u.hash.slice('#anilog-owner='.length)))}catch{stop('INVALID_CAPABILITY')}
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==OKEYS.slice().sort().join('|')||x.v!==1||x.siteOrigin!==site||x.apiOrigin!==api||!ID.test(x.boxId)||!ID.test(x.deviceId)||!TOKEN.test(x.deviceToken)||typeof x.masterKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(x.masterKey))stop('INVALID_CAPABILITY');
 const raw=x.masterKey.replace(/-/g,'+').replace(/_/g,'/');let key;
 try{key=Uint8Array.from(atob(raw+'='),(c)=>c.charCodeAt(0))}catch{stop('INVALID_KEY')}
 if(key.length!==32||btoa(Array.from(key,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==x.masterKey)stop('INVALID_KEY');
 return {siteOrigin:site,apiOrigin:api,boxId:x.boxId,device:{deviceId:x.deviceId,deviceToken:x.deviceToken},masterKey:key};
}
