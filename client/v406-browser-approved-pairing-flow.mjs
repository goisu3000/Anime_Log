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
 const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin,browserFetch});
 const siteUrl=siteOrigin+'/';let pending=null,claimed=false,halted=false;
 const stop=why=>{halted=true;fail(why)};
 const guard=()=>{if(halted)fail('STOPPED_AFTER_ERROR')};
 const currentClaim=async()=>{
  if(claimStore&&JSON.stringify(await claimStore.read())!==JSON.stringify(pending?.claimAttempt))fail('CLAIM_CHANGED');
 };
 return Object.freeze({
  get pendingClaim(){return claimed},
  // Owner has been provisioned by the trusted staging system; never accepts
  // bootstrapping or recovery secrets in browser code.
  async inviteOwner({vault,owner,boxId,masterKey}={}){
   guard();confirmedOwner(vault);
   if(!ID.test(boxId)||!(masterKey instanceof Uint8Array)||masterKey.length!==32)fail('OWNER_CONTEXT_REQUIRED');
   try{return await createOwnerInvitation({fetcher,apiRoot:apiOrigin,siteUrl,origin:siteOrigin,
     owner,boxId,masterKey})}catch(e){stop('INVITATION_FAILED')}
  },
  async inspectOwner({owner,boxId,invitationId}={}){
   guard();try{
    const info=await getOwnerInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,owner,boxId,invitationId});
    return {state:info.state,expiresAt:info.expiresAt,confirmationCode:info.state==='claimed'?info.confirmationCode:null};
   }catch{stop('INVITATION_READ_FAILED')}
  },
  async approveOwner({owner,boxId,invitationId,codeSeenOnOtherDevice,confirmedByUser=false}={}){
   guard();if(confirmedByUser!==true||!/^\d{6}$/.test(codeSeenOnOtherDevice))fail('OWNER_VISUAL_CODE_CONFIRMATION_REQUIRED');
   try{
    const info=await getOwnerInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,owner,boxId,invitationId});
    if(info.state!=='claimed'||info.confirmationCode!==codeSeenOnOtherDevice)fail('CODE_NOT_MATCHED');
    const approved=await approveOwnerInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
     owner,boxId,invitationId,confirmationCode:codeSeenOnOtherDevice,confirmedByUser:true});
    if(approved.approved!==true)fail('NO_APPROVAL_ACK');return {state:'approved'};
   }catch{stop('APPROVAL_NOT_CONFIRMED')}
  },
  // Parse exact location with URL fragment containing key material, then strip
  // the fragment synchronously BEFORE any await/network/browser UI update.
  async claimFromLocation({location,history}={}){
   guard();if(claimed||pending)fail('ALREADY_CLAIMED');
   if(!location?.href||!history?.replaceState)fail('BROWSER_LOCATION_REQUIRED');
   let pairing;
   try{pairing=parsePairingUrl(location.href,{allowedOrigin:siteOrigin})}
   finally{clearPairingFragment({location,history})}
   try{
    let claim,sealedAttempt;
    if(!claimStore){
     claim=await claimInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,pairing});
     if(claim.state!=='pending'||!/^\d{6}$/.test(claim.confirmationCode))fail('CLAIM_NOT_PENDING');
    }else{
     // Reuse the encrypted invitation envelope. A reload must not generate a
     // second candidate for an already claimed invitation.
     if(typeof claimStore.read!=='function'||typeof claimStore.write!=='function')fail('CLAIM_STORE_REQUIRED');
     let attempt=await claimStore.read();const fresh=!attempt;
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
     const status=()=>checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
      invitationId:pairing.invitationId,claimSecret:attempt.credentials.claimSecret});
     let remote;
     if(!fresh){try{remote=await status()}catch(error){if(error?.status!==401)throw error}}
     if(!remote){
      let ack;
      try{
       ack=await claimInvitation({fetcher,apiRoot:apiOrigin,origin:siteOrigin,pairing,credentials:attempt.credentials});
      }catch(error){
       // Never rotate credentials after an ambiguous POST. Status cannot
       // reconstruct lost six digits, so a pending claim without its ACK stops.
       remote=await status();
      }
      if(ack){
       if(ack.state!=='pending'||!/^\d{6}$/.test(ack.confirmationCode))fail('CLAIM_NOT_PENDING');
       const next={...attempt,confirmationCode:ack.confirmationCode};
       await claimStore.write(attempt,next);attempt=next;
       remote={state:'pending'};
      }
     }
     if(!['pending','approved'].includes(remote.state)||
        (remote.state==='pending'&&!/^\d{6}$/.test(attempt.confirmationCode??'')))fail('CLAIM_NOT_RESUMABLE');
     if(JSON.stringify(await claimStore.read())!==JSON.stringify(attempt))fail('CLAIM_CHANGED');
     sealedAttempt=attempt;
     claim={state:remote.state,confirmationCode:attempt.confirmationCode,credentials:attempt.credentials};
    }
    pending={invitationId:pairing.invitationId,boxId:pairing.boxId,masterKey:pairing.masterKey,
      credentials:claim.credentials,claimAttempt:sealedAttempt};claimed=true;
    return {state:claim.state,confirmationCode:claim.state==='pending'?claim.confirmationCode:null,requiresOwnerApproval:claim.state!=='approved'};
   }catch{stop('CLAIM_FAILED')}
  },
  async inspectReceiver(){
   guard();if(!pending)fail('NO_PENDING_CLAIM');
   try{await currentClaim();const out=await checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
     invitationId:pending.invitationId,claimSecret:pending.credentials.claimSecret});
    await currentClaim();
    return {state:out.state};}catch{stop('RECEIVER_STATUS_FAILED')}
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
   const claim=pending;halted=true; // permanent single attempt, even on failure
   await currentClaim();
   if(!receiveIntoLocal&&((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED'||uiBridge.ready))
    fail('RECEIVER_MUST_BE_EMPTY');
   const status=await checkNewDeviceStatus({fetcher,apiRoot:apiOrigin,origin:siteOrigin,
    invitationId:claim.invitationId,claimSecret:claim.credentials.claimSecret});
   if(status.state!=='approved')fail('OWNER_NOT_APPROVED');
   await currentClaim();
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
