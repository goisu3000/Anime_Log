/* ANI:LOG v0.3 LOCAL PROTOTYPE: URL-based pairing claim, no cloud deployment.
 * All URLs include secrets in the #fragment, which must be cleared immediately
 * after parsing. Any same-origin XSS can still steal the master secret.
 */
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const SECRET=/^[A-Za-z0-9_-]{43}$/;
function encoded(bytes){let raw='';for(const x of bytes)raw+=String.fromCharCode(x);return btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
function decoded(encodedValue){if(!SECRET.test(encodedValue))throw new Error('malformed 256-bit secret');
 const raw=atob(encodedValue.replaceAll('-','+').replaceAll('_','/')+'=');if(raw.length!==32)throw new Error('wrong secret length');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(encoded(bytes)!==encodedValue)throw new Error('noncanonical secret');return bytes}
export function freshSecret(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return bytes}
export function freshId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return encoded(bytes)}
export function secretToUrl(bytes){if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw new Error('expected 32-byte secret');return encoded(bytes)}
export async function shaHex(secret){const bytes=secret instanceof Uint8Array?secret:new TextEncoder().encode(secret);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('')}
export function makePairingUrl({siteUrl,boxId,invitationId,invitationSecret,masterKey}){
 if(!ID.test(boxId)||!ID.test(invitationId))throw new Error('invalid box or invitation');
 const url=new URL(siteUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error('HTTPS site required');
 // Remove incidental query tokens. QR must not place secrets in URL path/query.
 url.search='';url.hash=`anilog-pair=v1.${boxId}.${invitationId}.${secretToUrl(invitationSecret)}.${secretToUrl(masterKey)}`;
 return url.toString();
}
export function parsePairingUrl(input,{allowedOrigin}={}){
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search)throw new Error('invalid pairing URL');
 if(typeof allowedOrigin!=='string'||!allowedOrigin.startsWith('https://')||url.origin!==allowedOrigin)throw new Error('wrong pairing origin');
 const m=/^#anilog-pair=v1\.([A-Za-z0-9_-]{22,43})\.([A-Za-z0-9_-]{22,43})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(url.hash);
 if(!m)throw new Error('invalid pairing fragment');
 return {boxId:m[1],invitationId:m[2],invitationSecret:decoded(m[3]),masterKey:decoded(m[4])};
}
export function clearPairingFragment({location,history}){
 if(location.hash.startsWith('#anilog-pair='))history.replaceState(history.state,'',location.pathname+location.search);
}
export function createDeviceSecrets(){return {deviceId:freshId(),deviceToken:secretToUrl(freshSecret()),claimSecret:secretToUrl(freshSecret())}}
async function req(fetcher,method,path,{origin,body,device,secretHeader,secret}={}){
 const headers={'Content-Type':'application/json','Origin':origin};
 if(device){headers.Authorization=`Bearer ${device.deviceToken}`;headers['X-Device-Id']=device.deviceId}
 if(secretHeader)headers[secretHeader]=secret;
 const res=await fetcher(path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||'request_failed'),{status:res.status});return data;
}
export async function createOwnerInvitation({fetcher,apiRoot,siteUrl,origin,owner,boxId,masterKey}){
 const invitationSecret=freshSecret();const invitationHash=await shaHex(secretToUrl(invitationSecret));
 const r=await req(fetcher,'POST',`${apiRoot}/v1/boxes/${boxId}/invitations`,{origin,device:owner,body:{invitationHash}});
 const url=makePairingUrl({siteUrl,boxId,invitationId:r.invitationId,invitationSecret,masterKey});
 return {url,invitationId:r.invitationId,expiresAt:r.expiresAt};
}
export async function claimInvitation({fetcher,apiRoot,origin,pairing,credentials=createDeviceSecrets()}){
 const claimed=await req(fetcher,'POST',`${apiRoot}/v1/pairings/${pairing.invitationId}/claim`,{
  origin,secretHeader:'X-Pair-Secret',secret:secretToUrl(pairing.invitationSecret),body:{
   deviceId:credentials.deviceId,tokenHash:await shaHex(credentials.deviceToken),claimSecretHash:await shaHex(credentials.claimSecret)
  }});
 return {...claimed,credentials,boxId:pairing.boxId,masterKey:pairing.masterKey,invitationId:pairing.invitationId};
}
export async function getOwnerInvitation({fetcher,apiRoot,origin,owner,boxId,invitationId}){
 return req(fetcher,'GET',`${apiRoot}/v1/boxes/${boxId}/invitations/${invitationId}`,{origin,device:owner});
}
export async function approveOwnerInvitation({fetcher,apiRoot,origin,owner,boxId,invitationId,confirmationCode,confirmedByUser}){
 if(confirmedByUser!==true)throw new Error('approval requires explicit user confirmation of matching codes');
 return req(fetcher,'POST',`${apiRoot}/v1/boxes/${boxId}/invitations/${invitationId}/approve`,{origin,device:owner,body:{confirmationCode}});
}
export async function checkNewDeviceStatus({fetcher,apiRoot,origin,invitationId,claimSecret}){
 return req(fetcher,'GET',`${apiRoot}/v1/pairings/${invitationId}/status`,{origin,secretHeader:'X-Claim-Secret',secret:claimSecret});
}
