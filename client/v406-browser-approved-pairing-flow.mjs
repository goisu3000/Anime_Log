/* ANI:LOG v4.06 / SYNTHETIC STAGING ONLY.
 * Browser-ready owner invitation -> fragment-safe receiver claim -> explicit
 * six-digit owner approval -> authenticated first receive -> sealed credentials.
 * No production records, no automatic polling/sync, no new persistence format.
 * The owner must ALREADY possess an authorized device and confirmed checkpoint.
 */
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {createOwnerInvitation,getOwnerInvitation,approveOwnerInvitation,
 parsePairingUrl,clearPairingFragment,claimInvitation,checkNewDeviceStatus,createDeviceSecrets} from './pairing-client.mjs';
import {V30EncryptedClient} from './v30-encrypted-sync-client.mjs';
import {blankSnapshot,decryptSnapshot} from '../sync-core.mjs';
import {planInitialRecordMerge} from './initial-record-merge.mjs';
const ID=/^[A-Za-z0-9_-]{22,43}$/;
const fail=why=>{throw Error('V406_PAIRING_STOP:'+why)};
function confirmedOwner(vault){
 try{const cp=vault?.readSyncCheckpoint?.();if(!cp||!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1)fail('OWNER_CHECKPOINT_REQUIRED');return cp}
 catch{fail('OWNER_CHECKPOINT_REQUIRED')}
}
export function createV406BrowserApprovedPairingFlow({apiOrigin,siteOrigin,pageOrigin=globalThis.location?.origin,browserFetch=globalThis.fetch,claimStore}={}){
 if(typeof browserFetch!=='function')fail('INVALID_CONTEXT');
 // Pairing-only bounded requests. Aborting a POST does NOT imply rejection;
 // approveOwner still reconciles it via authenticated readback before retry.
 const boundedFetch=async(url,options)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{return await browserFetch(url,{...options,signal:controller.signal})}finally{clearTimeout(timer)}
 };
 const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch:boundedFetch});
 const siteUrl=siteOrigin+'/';let pending=null,claimed=false,halted=false,ownerApproving=false;
 const stop=why=>{halted=true;fail(why)};
 const guard=()=>{if(halted)fail('STOPPED_AFTER_ERROR')};
 // Fixed classifications only: never expose server bodies or arbitrary errors.
 const classified=(error)=>{
  if(error instanceof SyntaxError)return 'INVALID_RESPONSE';
  if(String(error?.message).startsWith('V405_BROWSER_TRANSPORT_STOP:'))return 'INVALID_CONTEXT';
  if(error?.status===401)return 'UNAUTHORIZED';
  if(error?.status===403)return 'ACCESS_DENIED';
  if(error?.status===404)return 'UNAVAILABLE';
  if(error?.status===410)return 'EXPIRED';
  if(error?.status===429)return error?.message==='device_limit'?'DEVICE_LIMIT':'RATE_LIMITED';
  if(error?.status===409)return 'APPROVAL_UNAVAILABLE';
  if(error?.status>=400&&error?.status<500)return 'INVALID_RESPONSE';
  return 'NETWORK';
 };
 const problem=(kind)=>{
  if(['UNAUTHORIZED','ACCESS_DENIED','INVALID_CONTEXT','INVALID_RESPONSE','DEVICE_LIMIT'].includes(kind))halted=true;
  fail(kind);
 };
 const ownerState=info=>{
  if(!info||!['open','claimed','approved','expired','denied','used'].includes(info.state)||
    !Number.isSafeInteger(info.expiresAt)||info.expiresAt<=0||
    (info.state==='claimed'&&!/^\d{6}$/.test(info.confirmationCode??'')))problem('INVALID_RESPONSE');
  return {state:info.state,expiresAt:info.expiresAt,confirmationCode:info.state==='claimed'?info.confirmationCode:null};
 };
 const readOwner=async({owner,boxId,invitationId})=>{
  if(!ID.test(boxId)||!ID.test(invitationId)||!ID.test(owner?.deviceId)||!/^[-\w]{43}$/.test(owner?.deviceToken??''))problem('INVALID_CONTEXT');
  let info;try{info=await getOwnerInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,owner,boxId,invitationId})}
  catch(error){problem(classified(error))}
  return ownerState(info);
 };
 const currentClaim=async()=>{
  if(claimStore&&JSON.stringify(await claimStore.read())!==JSON.stringify(pending?.claimAttempt))fail('CLAIM_CHANGED');
 };
 return Object.freeze({
  get pendingClaim(){return claimed},
  // Owner has been provisioned by the trusted staging system; never accepts
  // bootstrapping or recovery secrets in browser code.
  async inviteOwner({vault,owner,boxId,masterKey,replaceInvitationId}={}){
   guard();confirmedOwner(vault);
   if(!ID.test(boxId)||!(masterKey instanceof Uint8Array)||masterKey.length!==32)fail('OWNER_CONTEXT_REQUIRED');
   if(replaceInvitationId!==undefined){
    // Explicit QR reissue after an owner reload. Only the existing owner-only
    // deny endpoint is used; no new API or stored QR secret is introduced.
    const scope={owner,boxId,invitationId:replaceInvitationId},before=await readOwner(scope);
    if(before.state==='claimed')fail('INVITATION_PENDING');
    if(before.state==='approved')fail('INVITATION_ALREADY_APPROVED');
    if(before.state==='open'){
     try{
      const r=await fetcher(apiOrigin+'/v1/boxes/'+boxId+'/invitations/'+replaceInvitationId+'/deny',{
       method:'POST',headers:{'Content-Type':'application/json',Origin:siteOrigin,Authorization:'Bearer '+owner.deviceToken,'X-Device-Id':owner.deviceId},body:'{}'});
      if(!r.ok)throw Object.assign(Error('DENY_FAILED'),{status:r.status});
     }catch(error){const kind=classified(error);if(['UNAUTHORIZED','ACCESS_DENIED','INVALID_CONTEXT','INVALID_RESPONSE'].includes(kind))problem(kind);}
     // Even a lost deny response must be authenticated/read back before reissue.
     const after=await readOwner(scope);
     if(after.state==='approved')fail('INVITATION_ALREADY_APPROVED');
     if(!['denied','expired'].includes(after.state))fail('NETWORK');
    }
   }
   try{return await createOwnerInvitation({fetcher,apiRoot:apiOrigin,siteUrl,origin:siteOrigin,
     owner,boxId,masterKey})}catch(e){problem(classified(e))}
  },
  async inspectOwner(scope={}){guard();return readOwner(scope)},
  async approveOwner({owner,boxId,invitationId,codeSeenOnOtherDevice,confirmedByUser=false}={}){
   guard();if(ownerApproving)fail('APPROVAL_IN_PROGRESS');ownerApproving=true;
   try{if(confirmedByUser!==true||!/^\d{6}$/.test(codeSeenOnOtherDevice))fail('OWNER_VISUAL_CODE_CONFIRMATION_REQUIRED');
   const scope={owner,boxId,invitationId},info=await readOwner(scope);
   if(info.state==='approved')return {state:'approved'}; // authenticated readback, no second POST
   if(info.state==='open')fail('NOT_CLAIMED');
   if(info.state!=='claimed')fail('INVITATION_'+info.state.toUpperCase());
   if(info.confirmationCode!==codeSeenOnOtherDevice)fail('CODE_NOT_MATCHED');
   let postError;
   try{
    const ack=await approveOwnerInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
     owner,boxId,invitationId,confirmationCode:codeSeenOnOtherDevice,confirmedByUser:true});
    if(ack.approved!==true)postError='INVALID_RESPONSE';
   }catch(error){postError=classified(error)}
   // A missing POST response is ambiguous. Always read this same authenticated
   // invitation; NEVER automatically repeat approval or create another claim.
   if(['UNAUTHORIZED','ACCESS_DENIED','INVALID_CONTEXT','INVALID_RESPONSE'].includes(postError))problem(postError);
   const after=await readOwner(scope);
   if(after.state==='approved')return {state:'approved'};
   if(after.state!=='claimed')fail(after.state==='open'?'NOT_CLAIMED':'INVITATION_'+after.state.toUpperCase());
   if(after.confirmationCode!==codeSeenOnOtherDevice)problem('INVALID_RESPONSE');
   problem(postError??'APPROVAL_UNAVAILABLE');
   }finally{ownerApproving=false}
  },
  // Parse exact location with URL fragment containing key material, then strip
  // the fragment synchronously BEFORE any await/network/browser UI update.
  async claimFromLocation({location,history}={}){
   guard();if(claimed||pending)fail('ALREADY_CLAIMED');
   if(!location?.href||!history?.replaceState)fail('BROWSER_LOCATION_REQUIRED');
   let pairing,step='INVALID_QR';
   try{
    try{pairing=parsePairingUrl(location.href,{allowedOrigin:siteOrigin})}
    finally{clearPairingFragment({location,history})}
    step='NETWORK';
    let claim,sealedAttempt;
    if(!claimStore){
     claim=await claimInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,pairing});
     if(claim.state!=='pending'||!/^\d{6}$/.test(claim.confirmationCode))fail('CLAIM_NOT_PENDING');
    }else{
     // Reuse the encrypted invitation envelope. A reload must not generate a
     // second candidate for an already claimed invitation.
     if(typeof claimStore.read!=='function'||typeof claimStore.write!=='function')fail('CLAIM_STORE_REQUIRED');
     step='STORAGE';let attempt=await claimStore.read();const fresh=!attempt;
     if(fresh){
      attempt={version:1,apiOrigin,siteOrigin,boxId:pairing.boxId,invitationId:pairing.invitationId,
       credentials:createDeviceSecrets(),confirmationCode:null};
      await claimStore.write(null,attempt); // CAS + decrypt/readback BEFORE POST.
     }
     if(attempt.version!==1||attempt.apiOrigin!==apiOrigin||attempt.siteOrigin!==siteOrigin||
        attempt.boxId!==pairing.boxId||attempt.invitationId!==pairing.invitationId||
        !ID.test(attempt.credentials?.deviceId)||!/^[-\w]{43}$/.test(attempt.credentials?.deviceToken??'')||
        !/^[-\w]{43}$/.test(attempt.credentials?.claimSecret??'')||
        !(attempt.confirmationCode===null||/^\d{6}$/.test(attempt.confirmationCode)))fail('CLAIM_SCOPE_INVALID');
     step='SCOPE';
     const status=()=>checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
      invitationId:pairing.invitationId,claimSecret:attempt.credentials.claimSecret});
     step='NETWORK';let remote;
     if(!fresh){try{remote=await status()}catch(error){if(error?.status!==401)throw error}}
     if(!remote){
      let ack;
      try{
       ack=await claimInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,pairing,credentials:attempt.credentials});
      }catch(error){
       if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&error.status!==409)throw error;
       // Never rotate credentials after an ambiguous POST. Status cannot
       // reconstruct lost six digits, so a pending claim without its ACK stops.
       try{remote=await status()}catch(statusError){
        // A definite POST rejection must not be hidden by its status 401.
        // Ambiguous transport failures preserve the original sealed identity.
        if(error?.status===409&&statusError?.status===401)throw error;
        throw statusError;
       }
      }
      if(ack){
       if(ack.state!=='pending'||!/^\d{6}$/.test(ack.confirmationCode))fail('CLAIM_NOT_PENDING');
       const next={...attempt,confirmationCode:ack.confirmationCode};
       step='STORAGE';await claimStore.write(attempt,next);attempt=next;
       remote={state:'pending'};
      }
     }
     step='STATE';
     if(remote.state==='expired')fail('CLAIM_EXPIRED');
     if(remote.state==='denied')fail('CLAIM_DENIED');
     if(remote.state==='pending'&&!/^\d{6}$/.test(attempt.confirmationCode??''))fail('CLAIM_ACK_UNCONFIRMED');
     if(!['pending','approved'].includes(remote.state))fail('CLAIM_NOT_RESUMABLE');
     step='STORAGE';if(JSON.stringify(await claimStore.read())!==JSON.stringify(attempt))fail('CLAIM_CHANGED');
     sealedAttempt=attempt;
     claim={state:remote.state,confirmationCode:attempt.confirmationCode,credentials:attempt.credentials};
    }
    pending={invitationId:pairing.invitationId,boxId:pairing.boxId,masterKey:pairing.masterKey,
      credentials:claim.credentials,claimAttempt:sealedAttempt};claimed=true;
    return {state:claim.state,confirmationCode:claim.state==='pending'?claim.confirmationCode:null,requiresOwnerApproval:claim.state!=='approved'};
   }catch(error){
    // Only fixed classifications leave this boundary. Never expose response
    // bodies, fragments, credentials, storage values or arbitrary exceptions.
    const known={'V406_PAIRING_STOP:CLAIM_EXPIRED':'EXPIRED','V406_PAIRING_STOP:CLAIM_DENIED':'DENIED',
     'V406_PAIRING_STOP:CLAIM_ACK_UNCONFIRMED':'ACK_UNCONFIRMED','V406_PAIRING_STOP:CLAIM_SCOPE_INVALID':'SCOPE',
     'V406_PAIRING_STOP:CLAIM_STORE_REQUIRED':'STORAGE','V406_PAIRING_STOP:CLAIM_NOT_PENDING':'INVALID_RESPONSE'};
    const http={400:'INVALID_QR',401:'UNAUTHORIZED',403:'ACCESS_DENIED',404:'UNAVAILABLE',409:'UNAVAILABLE',410:'EXPIRED',429:'RATE_LIMITED'};
    const reason=known[error?.message]??(Number.isInteger(error?.status)?(http[error.status]??'SERVER'):step);
    stop('CLAIM_FAILED:'+reason);
   }
  },
  async inspectReceiver(){
   guard();if(!pending)fail('NO_PENDING_CLAIM');
   try{await currentClaim()}catch{stop('CLAIM_CHANGED')}
   let out;try{out=await checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
    invitationId:pending.invitationId,claimSecret:pending.credentials.claimSecret})}
   catch(error){problem(classified(error))}
   try{await currentClaim()}catch{stop('CLAIM_CHANGED')}
   if(!['pending','approved','expired','denied','used'].includes(out?.state))problem('INVALID_RESPONSE');
   return {state:out.state};
  },
  // If an earlier first-receive committed its WAL but the separate credential
  // store failed/crashed, a FRESH owner-approved QR can re-enroll credentials
  // against the existing checkpoint. Never reset or replace the WAL.
  async rePairExistingVault({vault,sealedCredentials,passphrase}={}){
   guard();if(!pending||!vault?.readSyncCheckpoint||!sealedCredentials?.inspect||!sealedCredentials?.enroll)
    fail('REPAIR_COMPONENTS_REQUIRED');
   const claim=pending;halted=true; // one explicit attempt, no background retries
   await currentClaim();
   const cp=confirmedOwner(vault);
   const present=await sealedCredentials.inspect();
   if(present.phase!=='EMPTY_LOCKED')fail('CREDENTIALS_ALREADY_EXIST');
   const status=await checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
    invitationId:claim.invitationId,claimSecret:claim.credentials.claimSecret});
   if(status.state!=='approved')fail('REPAIR_NOT_APPROVED');
   await currentClaim();
   const sealed=await sealedCredentials.enroll({vault,credentials:{apiRoot:apiOrigin,origin:siteOrigin,
    boxId:claim.boxId,device:{deviceId:claim.credentials.deviceId,deviceToken:claim.credentials.deviceToken},
    masterKey:claim.masterKey},passphrase,fetcher});
   if(sealed.phase!=='SEALED_CREDENTIALS_PERSISTED'||vault.readSyncCheckpoint().serverRevision!==cp.serverRevision)
    fail('REPAIR_NOT_DURABLE');
   pending=null;claimed=false;
   return {phase:'APPROVED_DEVICE_REPAIRED_WITHOUT_WAL_REPLACEMENT',serverRevision:cp.serverRevision,
    requiresManualSync:true};
  },
  // ONE irreversible initial receive per EMPTY receiver. Never silently
  // initialize existing WAL. Save sealed credentials only after durability.
  async receiveApproved({vault,uiBridge,sealedCredentials,passphrase,initialLocalApp,receiveIntoLocal}={}){
   guard();if(!pending||!vault?.inspectReadOnly||!uiBridge?.firstReceive||!sealedCredentials?.enroll)
    fail('RECEIVER_COMPONENTS_REQUIRED');
   const claim=pending;
   await currentClaim();
   if(!receiveIntoLocal&&((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED'||uiBridge.ready))
    fail('RECEIVER_MUST_BE_EMPTY');
   const status=await this.inspectReceiver();
   if(status.state!=='approved')fail(status.state==='pending'?'OWNER_NOT_APPROVED':'INVITATION_'+status.state.toUpperCase());
   await currentClaim();guard();halted=true; // one irreversible attempt AFTER approved preflight
   const device={deviceId:claim.credentials.deviceId,deviceToken:claim.credentials.deviceToken};
   let transport=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
    boxId:claim.boxId,device,masterKey:claim.masterKey,local:blankSnapshot(),baseline:blankSnapshot(),revision:0});
   if(receiveIntoLocal){
    if(typeof receiveIntoLocal!=='function')fail('RECEIVER_COMPONENTS_REQUIRED');
    const result=await receiveIntoLocal({transport,device,masterKey:new Uint8Array(claim.masterKey),passphrase});
    if(result?.phase!=='FIRST_RECEIVER_AND_SEALED_DEVICE_VERIFIED')fail('RECEIVE_NOT_DURABLE');
    pending=null;claimed=false;return result;
   }
   if(initialLocalApp){
    const remote=await transport.request('GET');
    if(remote.data.revision<1||!remote.data.payload)fail('INITIAL_REMOTE_REQUIRED');
    const snapshot=await decryptSnapshot(remote.data.payload,{masterKey:claim.masterKey,boxId:claim.boxId,revision:remote.data.revision});
    const merge=planInitialRecordMerge({localApp:initialLocalApp,remoteSnapshot:snapshot,apiOrigin,boxId:claim.boxId});
    if(!merge.ok)fail('INITIAL_RECORD_CONFLICT_KEEP_BOTH_COPIES');
    transport=new V30EncryptedClient({fetcher,apiRoot:apiOrigin,origin:siteOrigin,boxId:claim.boxId,device,
     masterKey:claim.masterKey,local:merge.snapshot,baseline:snapshot,revision:remote.data.revision});
   }
   const ack=await transport.sync({maxRetries:1});
   if(ack.status!=='synced'||ack.revision<1)fail('INITIAL_RECEIVE_NOT_CONFIRMED');
   const result=await uiBridge.firstReceive({transport,syncResult:ack,passphrase,...(initialLocalApp?{
    deviceWeeklyOpen:initialLocalApp.weeklyOptions.open,deviceWeeklyOptions:initialLocalApp.weeklyOptions}:{})});
   if(result.uiHydrated!==true||!vault.readSyncCheckpoint())fail('RECEIVE_NOT_DURABLE');
   const sealed=await sealedCredentials.enroll({vault,credentials:{apiRoot:apiOrigin,origin:siteOrigin,
     boxId:claim.boxId,device,masterKey:claim.masterKey},passphrase,fetcher});
   if(sealed.phase!=='SEALED_CREDENTIALS_PERSISTED')fail('CREDENTIALS_NOT_DURABLE');
   pending=null;claimed=false;
   return {phase:'FIRST_RECEIVER_AND_SEALED_DEVICE_VERIFIED',records:result.realAppRecords,
    serverRevision:vault.readSyncCheckpoint().serverRevision,requiresManualSync:true};
  }
 });
}
