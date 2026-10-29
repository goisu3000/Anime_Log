/* ANI:LOG device registration management. Explicit user actions only.
 * Never sends viewing records, AES keys, backup data, or arbitrary target IDs
 * to the self-revoke endpoint. Production Worker authenticates every request.
 */
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const ACTIVE_MAX=4;
const fail=reason=>{throw Error('DEVICE_REGISTRATION:'+reason)};
const asInteger=n=>Number.isSafeInteger(n)&&n>=0&&n<=ACTIVE_MAX;
const prefix='/v1/boxes/';
function verifyTransport(t){
 if(!t||typeof t.fetcher!=='function'||!ID.test(t.boxId)||!ID.test(t.device?.deviceId)||
    !/^[A-Za-z0-9_-]{43}$/.test(t.device?.deviceToken)||!/^https:\/\//.test(t.apiRoot)||!/^https:\/\//.test(t.origin))fail('INVALID_TRANSPORT');
 return t;
}
async function request(t,method,path){
 verifyTransport(t);
 const url=t.apiRoot+prefix+t.boxId+path;
 const options={method,headers:{Origin:t.origin,Authorization:'Bearer '+t.device.deviceToken,'X-Device-Id':t.device.deviceId}};
 const response=await t.fetcher(url,options);
 if(!response||typeof response.status!=='number')fail('INVALID_RESPONSE');
 let body;try{body=await response.json()}catch{fail('INVALID_RESPONSE')}
 if(!response.ok)fail(response.status===401?'UNAUTHORIZED':response.status===429?'RATE_LIMITED':body?.error==='owner_self_revoke_denied'?'OWNER_CANNOT_SELF_REVOKE':'SERVER_REJECTED');
 return body;
}
function validateCount(x){if(!asInteger(x?.activeDevices)||x?.maxDevices!==ACTIVE_MAX)fail('INVALID_COUNT');return x.activeDevices}
export async function getOwnRole(transport){
 const result=await request(transport,'GET','/me');
 if(!['owner','member'].includes(result?.role))fail('INVALID_ROLE');
 return result.role;
}
export async function listOwnerDevices(transport){
 const body=await request(transport,'GET','/devices');
 const count=validateCount(body);
 if(!Array.isArray(body.devices)||body.devices.length!==count)fail('INVALID_LIST');
 const ids=new Set();let ownerCount=0;
 const devices=body.devices.map(d=>{
  if(!ID.test(d?.deviceId)||ids.has(d.deviceId)||!['owner','member'].includes(d.role)||!Number.isSafeInteger(d.createdAt)||d.createdAt<0||typeof d.isThisDevice!=='boolean')fail('INVALID_DEVICE_ROW');
  ids.add(d.deviceId);if(d.role==='owner')ownerCount++;
  return Object.freeze({deviceId:d.deviceId,role:d.role,createdAt:d.createdAt,isThisDevice:d.isThisDevice});
 });
 if(ownerCount<1||devices.filter(d=>d.isThisDevice).length!==1||devices.find(d=>d.isThisDevice)?.role!=='owner'||
    devices.find(d=>d.isThisDevice)?.deviceId!==transport.device.deviceId)fail('OWNER_SCOPE_MISMATCH');
 return Object.freeze({activeDevices:count,maxDevices:ACTIVE_MAX,devices});
}
export async function revokeSelectedMember(transport,targetId){
 if(!ID.test(targetId)||targetId===transport.device.deviceId)fail('TARGET_DENIED');
 const body=await request(transport,'POST','/devices/'+targetId+'/revoke');
 validateCount(body);if(body.revoked!==true)fail('REVOKE_NOT_CONFIRMED');
 return {activeDevices:body.activeDevices,maxDevices:ACTIVE_MAX};
}
export async function revokeThisMember(transport){
 const body=await request(transport,'POST','/devices/self-revoke');
 validateCount(body);if(body.revoked!==true)fail('REVOKE_NOT_CONFIRMED');
 return {activeDevices:body.activeDevices,maxDevices:ACTIVE_MAX};
}
// Durable, profile-scoped intent marker. No tokens, IDs, box IDs or records.
// If the network ACK is lost, `pending` MUST fence sync until an authenticated
// retry resolves the server outcome. A confirmed marker forbids old recovery.
export function createSelfRevokeJournal(local,profileId){
 if(!local?.getItem||!local?.setItem||!['legacy',...Array.from({length:99},(_,i)=>'p'+(i+1))].includes(profileId))fail('INVALID_JOURNAL_SCOPE');
 const key='anilog-self-revoke-intent-v1:'+profileId;
 const read=()=>{const value=local.getItem(key);if(value!==null&&!['pending','confirmed'].includes(value))fail('JOURNAL_CORRUPT');return value};
 const save=value=>{const before=read();if(value==='pending'&&before==='confirmed')fail('REVOKE_ALREADY_CONFIRMED');if(value==='confirmed'&&before!=='pending')fail('REVOKE_NOT_PENDING');
  local.setItem(key,value);if(read()!==value)fail('JOURNAL_NOT_DURABLE');return value};
 return Object.freeze({read,pending:()=>save('pending'),confirmed:()=>save('confirmed')});
}
export function shortDeviceId(id){if(!ID.test(id))fail('INVALID_DEVICE_ID');return id.slice(0,4)+'…'+id.slice(-6)}
