// Private deployment operator issues these capabilities offline. No embedded key.
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const un64=s=>{if(!/^[\w-]+$/.test(s))throw Error('INVALID_TICKET');const a=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));if(b64(a)!==s)throw Error('INVALID_TICKET');return a};
export async function digestText(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function selfRegistrationIdentity({registrationId,deviceId,tokenHash,recoveryHash}){
 const hash=await digestText(JSON.stringify([registrationId,deviceId,tokenHash,recoveryHash]));
 return {binding:hash,boxId:b64(Uint8Array.from(hash.slice(0,32).match(/../g),x=>parseInt(x,16)))};
}
function claims(ticket){
 if(typeof ticket!=='string'||ticket.length>700)throw Error('INVALID_TICKET');
 const parts=ticket.split('.');if(parts.length!==3||parts[0]!=='ANI1')throw Error('INVALID_TICKET');
 const x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(un64(parts[1])));
 if(Object.keys(x).sort().join(',')!=='api,exp,nonce,slot,v'||x.v!==1||!Number.isInteger(x.slot)||x.slot<1||x.slot>100||
  !Number.isSafeInteger(x.exp)||! /^[\w-]{43}$/.test(x.nonce)||new URL(x.api).origin!==x.api||!x.api.startsWith('https://'))throw Error('INVALID_TICKET');
 if(un64(parts[2]).length!==32)throw Error('INVALID_TICKET');return {x,parts};
}
export async function ticketIdentity(ticket){const {x}=claims(ticket),hash=await digestText(ticket);
 return {...x,ticketHash:hash,boxId:b64(Uint8Array.from(hash.slice(0,32).match(/../g),x=>parseInt(x,16)))} }
async function key(secret,usage){if(typeof secret!=='string'||secret.length<43)throw Error('SERVER_KEY_REQUIRED');return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage])}
export async function issueRegistrationTicket({secret,api,slot,expiresAt,now=Date.now()}){
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt-now>7*86400000)throw Error('TICKET_EXPIRY_REQUIRED');
 const x={v:1,api,slot,exp:expiresAt,nonce:b64(crypto.getRandomValues(new Uint8Array(32)))};
 const body='ANI1.'+b64(enc.encode(JSON.stringify(x))),sig=await crypto.subtle.sign('HMAC',await key(secret,'sign'),enc.encode(body));
 const ticket=body+'.'+b64(new Uint8Array(sig));claims(ticket);return ticket;
}
export async function verifyRegistrationTicket(ticket,{secret,api,now=Date.now()}){
 const {x,parts}=claims(ticket);if(x.api!==api||x.exp<=now||x.exp-now>7*86400000)throw Error('INVALID_TICKET');
 if(!await crypto.subtle.verify('HMAC',await key(secret,'verify'),un64(parts[2]),enc.encode(parts[0]+'.'+parts[1])))throw Error('INVALID_TICKET');
 return ticketIdentity(ticket);
}
