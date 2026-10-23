/* ANI:LOG v4.11: synthetic staging-only HTTPS UI + owner enrollment bridge. The browser's actual origin
 * (not a URL or text field) determines local AES-GCM AAD and IndexedDB scope.
 * Never enables production SYNC_ON, never calls privileged bootstrap endpoints.
 * Only attaches UI after explicit static staging API configuration.
 */
import {mountV407PairingPanel} from './v407-browser-pairing-panel.mjs';
import {restoreV411ApprovedDevice} from './v411-approved-device-resume.mjs';
import {provisionV409BrowserOwner} from './v409-browser-owner-first-setup.mjs';
import {parsePairingUrl} from './pairing-client.mjs';
import {createV408HTTPSStagingANIPrimary} from './v408-https-staging-encrypted-primary.mjs';
import {createV408StagingSealedDeviceCredentials} from './v408-https-staging-sealed-credentials.mjs';
import {createV408FirstReceiverANIUIBridge} from './v408-first-receiver-ani-ui-bridge.mjs';
import {createV406BrowserApprovedPairingFlow} from './v406-browser-approved-pairing-flow.mjs';
import {createV405BrowserWorkerFetch} from './v405-browser-worker-fetch.mjs';
import {createV405BrowserExplicitSyncSession} from './v405-browser-explicit-sync-session.mjs';
const fail=why=>{throw Error('V411_STAGING_BOOT_STOP:'+why)};
export function validateV411StagingContext({siteOrigin,apiOrigin,pageOrigin=globalThis.location?.origin,formalProduction=false}={}){
 let site,api;
 try{site=new URL(siteOrigin);api=new URL(apiOrigin)}catch{fail('EXPLICIT_STAGING_HTTPS_REQUIRED')}
 for(const u of [site,api])if(u.protocol!=='https:'||u.href!==u.origin+'/'||u.username||u.password||u.hash||u.search)fail('EXPLICIT_STAGING_HTTPS_REQUIRED');
 const approved=formalProduction===true&&globalThis.document?.querySelector?.('meta[name="ani-log-formal-production-approval"]')?.content==='approved-private-production';
 if(site.origin!==pageOrigin||site.origin===api.origin||(!approved&&(site.hostname==='anime-log-rouge.vercel.app'||site.hostname==='www.anime-log-rouge.vercel.app'))||api.hostname==='anime-log-rouge.vercel.app')fail('PRODUCTION_OR_WRONG_ORIGIN');
 return {siteOrigin:site.origin,apiOrigin:api.origin};
}
export function prepareV411StagingPanel({root,ui,siteOrigin,apiOrigin,location=globalThis.location,history=globalThis.history,
 idb=globalThis.indexedDB,cryptoProvider=globalThis.crypto,locks=globalThis.navigator?.locks,browserFetch=globalThis.fetch,
 createVault=createV408HTTPSStagingANIPrimary,createCredentials=createV408StagingSealedDeviceCredentials,beforeSync,
 provisionOwner=provisionV409BrowserOwner,onSession,getPassphrase,getInitialLocalApp,formalProduction=false,autoClaimReceiver=false,receiveIntoLocal,claimStore}={}){
 validateV411StagingContext({siteOrigin,apiOrigin,pageOrigin:globalThis.location?.origin,formalProduction});
 if(!root?.querySelector||!ui?.commitSaved||!ui?.readSaved||!history?.replaceState)fail('VALID_BROWSER_UI_REQUIRED');
 const vault=createVault({idb,cryptoProvider,locks,origin:siteOrigin});
 const sealedCredentials=createCredentials({idb,cryptoProvider,locks});
 const bridge=createV408FirstReceiverANIUIBridge({vault,ui});
 const flow=createV406BrowserApprovedPairingFlow({apiOrigin,siteOrigin,pageOrigin:siteOrigin,browserFetch,claimStore});
 const pairing=location.hash?.startsWith('#anilog-pair=')?parsePairingUrl(location.href,{allowedOrigin:siteOrigin}):null;
 let ownerHandoff=location.hash?.startsWith('#anilog-owner=')?location.href:null;
 const wrap=session=>beforeSync?Object.freeze({get stopped(){return session.stopped},async syncOnce(){await beforeSync();return session.syncOnce()}}):session;
 const fresh=async({boxId,passphrase})=>wrap(await createV405BrowserExplicitSyncSession({vault,uiBridge:bridge,sealedCredentials,passphrase,
   apiOrigin,siteOrigin,pageOrigin:siteOrigin,boxId,browserFetch}));
 const guardedSession=(session,scope)=>{const guarded=wrap(session);
  onSession?.(guarded,()=>fresh(scope));return guarded};
 const synced=async scope=>guardedSession(await createV405BrowserExplicitSyncSession({vault,uiBridge:bridge,sealedCredentials,passphrase:scope.passphrase,
   apiOrigin,siteOrigin,pageOrigin:siteOrigin,boxId:scope.boxId,browserFetch}),scope);
 const ownerUnlock=root.querySelector('[data-v408="unlock-owner"]'),ownerBox=root.querySelector('[data-v408="box-id"]');
 const ownerFirst=root.querySelector('[data-v409="first-owner"]');
 if(!ownerFirst)fail('OWNER_FIRST_SETUP_BUTTON_REQUIRED');
 if(!ownerUnlock||!ownerBox)fail('OWNER_RESTORE_FORM_REQUIRED');
 // The early fragment capture deliberately omits origin. Use the validated
 // actual page origin, rather than expecting that partial object to have it.
 const panelLocation={href:location.href,hash:location.hash,pathname:location.pathname,search:location.search,origin:siteOrigin};
 const panel=mountV407PairingPanel({root,location:panelLocation,history,getPassphrase,automaticMode:formalProduction,autoClaimReceiver,syncFactory:async({passphrase})=>{
   if(!pairing)fail('RECEIVER_PAIRING_CONTEXT_REQUIRED');
   return synced({boxId:pairing.boxId,passphrase});
 }});
 const receiverFlow=Object.freeze({
  get pendingClaim(){return flow.pendingClaim},
  claimFromLocation:x=>flow.claimFromLocation(x),
  inspectReceiver:()=>flow.inspectReceiver(),
  receiveApproved:async x=>{const initialLocalApp=await getInitialLocalApp?.();const result=await flow.receiveApproved({...x,initialLocalApp,receiveIntoLocal});if(result.phase==='FIRST_RECEIVER_AND_SEALED_DEVICE_VERIFIED'&&typeof window!=='undefined')window.__v399DemoActivate?.();return result},
  rePairExistingVault:x=>flow.rePairExistingVault(x)
 });
 if(pairing)panel.attachReceiver({flow:receiverFlow,vault,uiBridge:bridge,sealedCredentials});
 ownerUnlock.disabled=!!ownerHandoff;
 ownerFirst.disabled=!ownerHandoff;
 ownerFirst.addEventListener('click',async()=>{
  if(!ownerHandoff)return;
  const pass=root.querySelector('[data-v407="passphrase"]');const password=pass?.value;
  if(typeof password!=='string'||password.length<16||password.length>256){
   const status=root.querySelector('[data-v407="status"]');
   if(status)status.textContent='下段の試験パスフレーズに16〜256文字を入力してください。初回設定はまだ実行していません。';
   return;
  }
  ownerFirst.disabled=true;ownerUnlock.disabled=true;
  const oneShot=ownerHandoff;ownerHandoff=null;
  if(pass)pass.value='';
  try{
   const result=await provisionOwner({capturedUrl:oneShot,siteOrigin,apiOrigin,
    passphrase:password,vault,uiBridge:bridge,sealedCredentials,browserFetch,pageOrigin:siteOrigin});
   panel.attachOwner({flow,owner:result.ownerDevice,vault,boxId:result.boxId,masterKey:result.masterKey});
   await panel.setRestoredSession(guardedSession(result.session,{boxId:result.boxId,passphrase:password}));
   if(typeof window!=='undefined')window.__v399DemoActivate?.();
  }catch(error){const status=root.querySelector('[data-v407="status"]');
   if(status)status.textContent='初回所有者の設定を停止しました。保存領域は初期化・消去しないでください。 '+String(error?.message??'UNKNOWN').replace(/https?:\/\/\S+/g,'[URL省略]');
  }
 });
 let attempted=false;
 let automaticRoleRefresh=null;
 async function confirmAutomaticRole(){return automaticRoleRefresh?automaticRoleRefresh():null}
 // Restore local records and a scoped device session while offline. Owner QR
 // privileges still require a successful authenticated server role lookup.
 async function resumeAutomatic({passphrase}={}){
  if(vault.getState()!=='ACTIVE'){
   if((await vault.inspectReadOnly()).phase!=='PRESENT_LOCKED')fail('DURABLE_LOCKED_VAULT_REQUIRED');
   await bridge.unlock(passphrase);
  }else if(!vault.readSyncCheckpoint())fail('DURABLE_LOCKED_VAULT_REQUIRED');
  const fetcher=createV405BrowserWorkerFetch({apiOrigin,siteOrigin,pageOrigin:siteOrigin,browserFetch});
  const trusted=await sealedCredentials.resume({vault,passphrase,fetcher,expectedApiRoot:apiOrigin,expectedOrigin:siteOrigin});
  let known=false,checking=false;
  automaticRoleRefresh=async()=>{
   if(known||checking)return null;checking=true;
   try{
    const r=await fetcher(apiOrigin+'/v1/boxes/'+trusted.boxId+'/me',{method:'GET',headers:{Authorization:'Bearer '+trusted.device.deviceToken,'X-Device-Id':trusted.device.deviceId}});
    if(!r.ok)return null;const role=(await r.json()).role;if(!['owner','member'].includes(role))return null;
    if(role==='owner')panel.attachOwner({flow,owner:{...trusted.device},vault,boxId:trusted.boxId,masterKey:new Uint8Array(trusted.masterKey)});
    known=true;return role;
   }catch{return null}finally{checking=false}
  };
  await panel.setRestoredSession(await synced({boxId:trusted.boxId,passphrase}));
  await confirmAutomaticRole();
  return {phase:'LOCAL_DEVICE_SESSION_RESTORED',ownerRoleAuthenticated:known};
 }
 async function resumeApproved({passphrase:password,boxId}={}){
   const restored=await restoreV411ApprovedDevice({vault,uiBridge:bridge,sealedCredentials,
    passphrase:password,boxId:boxId||undefined,apiOrigin,siteOrigin,pageOrigin:siteOrigin,browserFetch});
   if(restored.role==='owner')panel.attachOwner({flow,owner:restored.ownerDevice,vault,
     boxId:restored.boxId,masterKey:restored.masterKey});
   await panel.setRestoredSession(guardedSession(restored.session,{boxId:restored.boxId,passphrase:password}));
   if(typeof window!=='undefined')window.__v399DemoActivate?.();
   return restored.role;
 }
 ownerUnlock.addEventListener('click',async()=>{
  if(attempted)return;
  attempted=true;ownerUnlock.disabled=true;
  const pass=root.querySelector('[data-v407="passphrase"]');const password=pass?.value; if(pass)pass.value='';
  const boxId=ownerBox.value.trim();ownerBox.value='';
  try{
   if(typeof password!=='string'||password.length<16||(boxId&&!/^[A-Za-z0-9_-]{22,43}$/.test(boxId)))fail('RESTORE_INPUT_REQUIRED');
   await resumeApproved({passphrase:password,boxId});
  }catch(error){const s=root.querySelector('[data-v407="status"]');if(s)s.textContent='端末の解錠を停止しました。保存データは変更していません。 '+String(error?.message??'UNKNOWN').replace(/https?:\/\/\S+/g,'[URL省略]')}
 });
 return Object.freeze({panel,vault,bridge,sealedCredentials,flow,resumeApproved,resumeAutomatic,confirmAutomaticRole});
}
// On the actual staging page, configuration is written into a static meta
// during trusted deployment, not read from a URL parameter or QR fragment.
if(typeof document!=='undefined'&&document.querySelector('meta[name="ani-log-sync-integration"]')?.content==='v4.09;off;https-staging-synthetic-only'){
 const root=document.querySelector('#v407-pairing');
 if(root){
  const captured=window.__v407TakePairingURL?.();
  const status=root.querySelector('[data-v407="status"]');
  const apiOrigin=document.querySelector('meta[name="ani-log-stage-api-origin"]')?.content??'';
  if(location.protocol!=='https:'||!apiOrigin){if(status)status.textContent='未接続：非本番HTTPSサイトと同期APIの設定が必要です。実通信は無効です。'}
  else{
   try{
    const running=prepareV411StagingPanel({root,ui:window.__v381UI,siteOrigin:location.origin,apiOrigin,
      location:captured??location,history});
    Object.defineProperty(window,'__v411StagingPanel',{value:running,writable:false,configurable:false});
    window.__v381Bridge=running.bridge;
   }catch(err){if(status)status.textContent='安全のため端末連携を開始できません: '+String(err.message).replace(/https?:\/\/\S+/g,'[URL省略]')}
  }
 }
}
