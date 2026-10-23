/* ANI:LOG v0.4 recovery POC (not a deployable UX).
 * Recovery token and master seed in this OFFLINE kit are bearer secrets.
 * Never upload the kit, put it in a URL, log it, or store it as a public share.
 * Recovery rotates the one-use token and allocates a NEW owner identity.
 */
import {secretToUrl,createDeviceSecrets,freshSecret,shaHex} from './pairing-client.mjs';
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const KIT=/^ANILOG-RECOVERY-V1\.([A-Za-z0-9_-]{100,1200})\.([A-Za-z0-9_-]{16})$/;
const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const enc=bytes=>{let raw='';for(const x of bytes)raw+=String.fromCharCode(x);return btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
const dec=s=>{
 if(!/^[A-Za-z0-9_-]+$/.test(s))throw new Error('invalid recovery alphabet');
 const raw=atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4));
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(enc(bytes)!==s)throw new Error('noncanonical recovery encoding');
 return bytes;
};
async function checksum(bytes){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return enc(digest.subarray(0,12))}
function validate(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='boxId,key,recoveryToken,v'
  ||data.v!==1||!ID.test(data.boxId)||!TOKEN.test(data.recoveryToken)||!TOKEN.test(data.key))
  throw new Error('invalid recovery fields');
 const bytes=dec(data.key);if(bytes.length!==32)throw new Error('bad master key');return {...data,masterKey:bytes};
}
export async function createOwnerRecoveryKit({boxId,recoveryToken,masterKey}){
 if(!(masterKey instanceof Uint8Array)||masterKey.length!==32)throw new Error('need a 256-bit master seed');
 const data={v:1,boxId,recoveryToken,key:secretToUrl(masterKey)};
 validate(data);const bytes=utf8.encode(JSON.stringify(data));
 return `ANILOG-RECOVERY-V1.${enc(bytes)}.${await checksum(bytes)}`;
}
export async function decodeOwnerRecoveryKit(kit){
 if(typeof kit!=='string'||kit.length>2000)throw new Error('invalid recovery kit');
 const match=KIT.exec(kit.trim());if(!match)throw new Error('invalid recovery format');
 const bytes=dec(match[1]);if(await checksum(bytes)!==match[2])throw new Error('recovery kit checksum mismatch');
 let parsed;try{parsed=JSON.parse(decoder.decode(bytes))}catch{throw new Error('invalid recovery payload')}
 return validate(parsed);
}
// Pure preparation only. The caller MUST ensure that the nextRecoveryKit is
// safely preserved BEFORE triggering the one-way API mutation. This prevents a
// lost server ACK or local vault failure from permanently orphaning the user.
// Actual multi-step browser UX is intentionally not implemented yet.
export async function prepareOwnerRecovery(kit){
 const old=await decodeOwnerRecoveryKit(kit);
 const credential=createDeviceSecrets();
 const nextRecoveryToken=secretToUrl(freshSecret());
 const nextRecoveryKit=await createOwnerRecoveryKit({boxId:old.boxId,recoveryToken:nextRecoveryToken,masterKey:old.masterKey});
 return {
  boxId:old.boxId,masterKey:old.masterKey,credential,nextRecoveryKit,
  // Never send the master seed or new raw device/recovery tokens to Worker.
  request:{method:'POST',path:`/v1/boxes/${old.boxId}/recover`,
   headers:{'Content-Type':'application/json','X-Recovery-Token':old.recoveryToken},
   body:{deviceId:credential.deviceId,tokenHash:await shaHex(credential.deviceToken),nextRecoveryHash:await shaHex(nextRecoveryToken)}}
 };
}
