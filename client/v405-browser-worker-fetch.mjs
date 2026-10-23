/* ANI:LOG v4.05 - browser fetch compatibility for the existing encrypted Worker.
 * No authentication storage, no background sends, no relaxed Worker origin policy.
 * V30/pairing clients pass a Node-only Origin header; browsers MUST create Origin.
 * Only intended for explicitly configured separate HTTPS staging origins.
 */
const fail=(reason)=>{throw Error('V405_BROWSER_TRANSPORT_STOP:'+reason)};
function originOnly(s){
 let u;try{u=new URL(s)}catch{fail('INVALID_HTTPS_ORIGIN')}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==s)fail('INVALID_HTTPS_ORIGIN');
 return u.origin;
}
export function createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin=globalThis.location?.origin,browserFetch=globalThis.fetch}={}){
 const api=originOnly(apiOrigin),site=originOnly(siteOrigin);
 if(pageOrigin!==site||typeof browserFetch!=='function')fail('BROWSER_ORIGIN_MISMATCH');
 return async(url,options={})=>{
  let target;try{target=new URL(url)}catch{fail('INVALID_API_URL')}
  if(target.origin!==api||target.username||target.password||target.hash||target.search||!target.pathname.startsWith('/v1/'))fail('OUTSIDE_STAGING_API');
  if(!['GET','POST','PUT'].includes(options.method))fail('UNSUPPORTED_METHOD');
  const headers=new Headers(options.headers||{});
  if(headers.has('Origin')&&headers.get('Origin')!==site)fail('CLAIMED_ORIGIN_MISMATCH');
  // `Origin` is browser-owned. Browsers cannot set it through JS fetch headers.
  headers.delete('Origin');
  if(headers.has('X-Test-Bootstrap')||headers.has('X-Recovery-Token'))fail('PRIVILEGED_ENDPOINT_NOT_FOR_BROWSER');
  if(options.method==='GET'&&options.body!==undefined)fail('GET_HAS_BODY');
  return browserFetch(target.href,{method:options.method,headers,body:options.body,
   mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
 };
}
