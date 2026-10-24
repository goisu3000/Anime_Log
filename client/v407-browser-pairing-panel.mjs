/* ANI:LOG v4.07 | Minimal browser event/UI connector, staging-only.
 * The caller supplies already-authorized, isolated staging contexts.
 * There is no bootstrap key, unattended polling, silent sync, or fallback.
 * QR generation is in-browser, bundled locally, and never calls a QR API.
 */
import {makeV407QrSvg} from './v407-offline-qr.mjs';
const fail=reason=>{throw Error('V407_PAIRING_PANEL_STOP:'+reason)};
const by=(root,id)=>{const n=root.querySelector('[data-v407="'+id+'"]');if(!n)fail('MISSING_UI_'+id);return n};
export function mountV407PairingPanel({root,syncFactory,getPassphrase,automaticMode=false,autoClaimReceiver=false,location=globalThis.location,history=globalThis.history}={}){
 if(!root?.querySelector||typeof syncFactory!=='function')fail('CONTEXT_REQUIRED');
 const status=by(root,'status'),pass=by(root,'passphrase'),qr=by(root,'qr'),invite=by(root,'invite'),refresh=by(root,'refresh'),approve=by(root,'approve'),code=by(root,'code'),claim=by(root,'claim'),check=by(root,'check'),receive=by(root,'receive'),repair=by(root,'repair'),sync=by(root,'sync'),copy=by(root,'copy'),newCode=by(root,'receiver-code');
 const controls=[invite,refresh,approve,claim,check,receive,repair,sync,copy];
 let owner=null,receiver=null,invitation=null,inviteUrl=null,serverCode=null,receiverStatus=null,session=null,ready=false,busy=false,stopped=false,phase='IDLE';
 const clearQr=()=>{qr.replaceChildren();inviteUrl=null;copy.disabled=true};
 const show=(s)=>{status.textContent=s};
 const setPhase=s=>{phase=s;render()};
 function render(){
  controls.forEach(c=>c.disabled=true);
  if(busy||stopped)return;
  invite.disabled=owner===null;
  refresh.disabled=owner===null||invitation===null;
  copy.disabled=inviteUrl===null;
  approve.disabled=owner===null||invitation===null||(automaticMode?!/^[0-9]{6}$/.test(code.value):serverCode===null);
  claim.disabled=receiver===null||phase!=='IDLE';
  check.disabled=receiver===null||!receiver.flow.pendingClaim||ready;
  receive.disabled=receiver===null||receiverStatus!=='approved'||ready;
  repair.disabled=receiver===null||receiverStatus!=='approved'||ready;
  sync.disabled=!ready||session===null;
 }
 async function action(fn){
  if(busy||stopped)return;
  busy=true;render();
  try{await fn()}catch(err){
   const reason=String(err?.message??'UNKNOWN_ERROR');
   // A mistyped owner code is rejected locally BEFORE approveOwner/network.
   // In opt-in automatic mode it must not destroy the otherwise valid QR.
   // Staging/legacy fail-closed behavior stays unchanged.
   const localRetry=automaticMode===true&&[
    'V407_PAIRING_PANEL_STOP:VISIBLE_CODE_MISMATCH',
    'V407_PAIRING_PANEL_STOP:CLIPBOARD_UNAVAILABLE',
    'V407_PAIRING_PANEL_STOP:CLIPBOARD_WRITE_FAILED'
   ].includes(reason);
   if(localRetry){
    if(reason.endsWith('VISIBLE_CODE_MISMATCH'))code.value='';
    show(reason.endsWith('VISIBLE_CODE_MISMATCH')
     ?'6桁の番号が一致しません。新しい端末に表示された番号を確認して入力し直してください。'
     :'リンクをコピーできませんでした。QRコードを読み取るか、もう一度お試しください。');
   }else{
    stopped=true;clearQr();
    const claimReasons={EXPIRED:'招待の有効期限が切れています。',DENIED:'この招待は承認されていません。',UNAVAILABLE:'招待は期限切れ・使用済み、または利用できない状態です。',
     UNAUTHORIZED:'招待を認証できませんでした。',INVALID_QR:'招待QRを確認できませんでした。',SCOPE:'保存された招待と接続情報が一致しません。',
     STORAGE:'招待の接続情報を安全に保存・復元できませんでした。ブラウザの保存領域は消さないでください。',
     ACK_UNCONFIRMED:'接続申請は届いた可能性がありますが、6桁番号の受信を確認できません。別の資格で再申請していません。',
     NETWORK:'通信結果を確認できませんでした。保存済みの同じ接続情報を保持しています。',
     ACCESS_DENIED:'接続が拒否されました。',RATE_LIMITED:'接続が混み合っています。時間を置いてください。',SERVER:'接続先の応答を確認できませんでした。',STATE:'招待の状態を確認できませんでした。',INVALID_RESPONSE:'招待の応答を確認できませんでした。'};
    const kind=reason.startsWith('V406_PAIRING_STOP:CLAIM_FAILED:')?reason.slice('V406_PAIRING_STOP:CLAIM_FAILED:'.length):null;
    if(automaticMode&&Object.hasOwn(claimReasons,kind)){
     newCode.textContent='';
     show(claimReasons[kind]+' 端末内の記録・以前の接続情報は保持しています。通信が戻ったら同じタブを再読み込みして再開できます。期限切れ・使用済みや番号を復元できない場合は、元の端末で新しいQRを発行してください。再接続準備中は「再接続を中止して元の端末内記録へ戻る」で戻り、バックアップを保全して新しいQRを読み取ってください。\n'+reason);
    }else show('安全のため、この接続操作を停止しました。保存データは消さず、画面の状態を記録してください。\n'+reason.replace(/https?:\/\/\S+/g,'[URL省略]'));
   }
  }finally{busy=false;pass.value='';render()}
 }
 async function password(){const s=getPassphrase?await getPassphrase():pass.value;if(typeof s!=='string'||s.length<16||s.length>256)fail('TEST_PASSPHRASE_REQUIRED');return s}
 async function showInvitation(info){
  const u=new URL(info?.url);
  if(!/^https:$/.test(u.protocol)||!u.hash.startsWith('#anilog-pair=')||u.username||u.password||u.search||u.pathname!=='/'||u.origin!==location.origin)fail('UNTRUSTED_QR_URL');
  if(typeof info.invitationId!=='string')fail('INVITATION_ID_MISSING');
  clearQr();
  const img=root.ownerDocument.createElement('img');
  img.alt='別端末で読み取る招待QRコード';img.width=208;img.height=208;
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(makeV407QrSvg(info.url));
  qr.appendChild(img);
  invitation=info.invitationId;inviteUrl=info.url;serverCode=null;code.value='';
  show('招待を作成しました。別端末でQRを読み取り、表示された6桁コードを照合してください。');
 }
 invite.addEventListener('click',()=>action(async()=>{
  if(!owner)fail('OWNER_NOT_READY');
  const x=await owner.flow.inviteOwner({vault:owner.vault,owner:owner.owner,boxId:owner.boxId,masterKey:owner.masterKey});
  await showInvitation(x);setPhase('OWNER_INVITED');
 }));
 refresh.addEventListener('click',()=>action(async()=>{
  if(!owner||!invitation)fail('NO_INVITATION');
  const s=await owner.flow.inspectOwner({owner:owner.owner,boxId:owner.boxId,invitationId:invitation});
  serverCode=s.state==='claimed'?s.confirmationCode:null;
  show(s.state==='claimed'?'新端末の6桁コードを入力して、表示内容が一致するときだけ承認してください。':'招待の状態: '+s.state);
  setPhase('OWNER_'+s.state.toUpperCase());
 }));
 // For the opt-in UI, one explicit 6-digit confirmation performs the
 // authenticated status lookup AND approval. The staging flow keeps its
 // separate inspection step for its existing test contract.
 code.addEventListener('input',render);
 approve.addEventListener('click',()=>action(async()=>{
  if(!owner||!invitation||!/^[0-9]{6}$/.test(code.value))fail('VISIBLE_CODE_MISMATCH');
  if(automaticMode&&serverCode===null){
   const s=await owner.flow.inspectOwner({owner:owner.owner,boxId:owner.boxId,invitationId:invitation});
   if(s.state!=='claimed'){
    show('新しい端末の6桁コードがまだ届いていません。受信後に入力して承認してください。');
    return; // Keep the QR and owner state intact; no approval was attempted.
   }
   serverCode=s.confirmationCode;
  }
  if(!serverCode||code.value!==serverCode)fail('VISIBLE_CODE_MISMATCH');
  const ack=await owner.flow.approveOwner({owner:owner.owner,boxId:owner.boxId,invitationId:invitation,codeSeenOnOtherDevice:code.value,confirmedByUser:true});
  if(ack.state!=='approved')fail('NO_APPROVAL_ACK');
  code.value='';serverCode=null;clearQr();invitation=null;
  show('端末承認が完了しました。新端末で承認状態を確認し、初回受信してください。');setPhase('OWNER_APPROVED');
 }));
 const claimFromQr=async()=>{
  if(!receiver)fail('RECEIVER_NOT_READY');
  const r=await receiver.flow.claimFromLocation({location,history});
  if(automaticMode&&r.state==='approved'){
   newCode.textContent='';receiverStatus='approved';
   show('承認済みの接続を復元しました。「接続を完了」を押してください。');setPhase('RECEIVER_APPROVED');return;
  }
  if(r.state!=='pending'||!/^[0-9]{6}$/.test(r.confirmationCode))fail('CLAIM_INVALID');
  newCode.textContent=r.confirmationCode;receiverStatus='pending';
  show('この6桁コードを元の端末で入力し、承認してください。');setPhase('RECEIVER_PENDING');
 };
 claim.addEventListener('click',()=>action(claimFromQr));
 // The ordinary receiver has one explicit completion action after showing
 // the six-digit code on this device. It only receives records AFTER an
 // authenticated approved status; the unchanged staging flow stays two-step.
 async function finishReceiver(){
  if(!receiver||receiverStatus!=='approved')fail('NOT_APPROVED');
  const p=await password();const result=await receiver.flow.receiveApproved({vault:receiver.vault,uiBridge:receiver.uiBridge,sealedCredentials:receiver.sealedCredentials,passphrase:p});
  if(result.phase!=='FIRST_RECEIVER_AND_SEALED_DEVICE_VERIFIED')fail('FIRST_RECEIVE_NOT_PERSISTED');
  ready=true;session=await syncFactory({receiver,passphrase:p});
  if(!session?.syncOnce)fail('NO_SYNC_SESSION');
  newCode.textContent='';show(automaticMode?'記録を安全に取り込みました。これからは自動で同期します。':'架空データの初回受信と暗号化保管が完了しました。今後は「同期」を押したときだけ通信します。');setPhase('RECEIVER_ACTIVE');
 }
 check.addEventListener('click',()=>action(async()=>{
  if(!receiver?.flow.pendingClaim)fail('NOT_CLAIMED');
  const s=await receiver.flow.inspectReceiver();receiverStatus=s.state;
  if(automaticMode&&s.state==='approved'){
   await finishReceiver();return;
  }
  show(s.state==='approved'?'所有者の承認を確認できました。初回受信を明示的に実行できます。':automaticMode?'元の端末で6桁コードを承認したあと、「接続を完了」を押してください。':'承認状態: '+s.state);
  setPhase('RECEIVER_'+s.state.toUpperCase());
 }));
 receive.addEventListener('click',()=>action(finishReceiver));
 repair.addEventListener('click',()=>action(async()=>{
  if(!receiver||receiverStatus!=='approved')fail('NOT_APPROVED');
  const p=await password();const ack=await receiver.flow.rePairExistingVault({vault:receiver.vault,sealedCredentials:receiver.sealedCredentials,passphrase:p});
  if(ack.phase!=='APPROVED_DEVICE_REPAIRED_WITHOUT_WAL_REPLACEMENT')fail('REPAIR_NOT_PERSISTED');
  ready=true;session=await syncFactory({receiver,passphrase:p});
  if(!session?.syncOnce)fail('NO_SYNC_SESSION');
  newCode.textContent='';show('既存の暗号化WALを変更せず端末認証情報を復旧しました。');setPhase('RECEIVER_ACTIVE');
 }));
 sync.addEventListener('click',()=>action(async()=>{
  if(!ready||!session?.syncOnce)fail('SYNC_SESSION_NOT_READY');
  const r=await session.syncOnce();
  if(!r.durable){show('同期は確定していません。記録は端末に保持しています。状態: '+r.status);setPhase('SYNC_NOT_CONFIRMED');return}
  show(r.status==='up-to-date'?'新しい変更はありません。':'確認済みの同期結果を端末に保存しました。');setPhase('SYNC_CONFIRMED');
 }));
 copy.addEventListener('click',()=>action(async()=>{
  if(!inviteUrl||!globalThis.navigator?.clipboard?.writeText)fail('CLIPBOARD_UNAVAILABLE');
  try{await globalThis.navigator.clipboard.writeText(inviteUrl)}catch{fail('CLIPBOARD_WRITE_FAILED')}
  show('招待リンクをコピーしました。招待URLは第三者に共有しないでください。');
 }));
 render();show('接続待ち。招待は所有者の端末認証が確認された後にだけ作成できます。');
 return Object.freeze({
  get state(){return Object.freeze({phase,ready,stopped,busy})},
  // These functions are called only from an authenticated staging bootstrap.
  attachOwner(context){if(owner||busy||stopped||!context?.flow?.inviteOwner||!context?.flow?.inspectOwner||!context?.flow?.approveOwner)fail('OWNER_CONTEXT_INVALID');owner=context;render()},
  attachReceiver(context){if(receiver||busy||stopped||!context?.flow?.claimFromLocation||!context?.flow?.inspectReceiver||!context?.flow?.receiveApproved||!context?.flow?.rePairExistingVault)fail('RECEIVER_CONTEXT_INVALID');receiver=context;render();
   // Scanning the QR and explicitly enabling sync on this new device already
   // authorize claiming the short-lived invitation, NOT receiving any data.
   // No background polling; the owner's 6-digit approval remains mandatory.
   if(automaticMode&&autoClaimReceiver&&location?.hash?.startsWith('#anilog-pair='))void action(claimFromQr);},
  async setRestoredSession(s){if(!s?.syncOnce||busy||stopped)fail('INVALID_RESUME');session=s;ready=true;setPhase('RESTORED_ACTIVE');show(automaticMode?'端末の記録を復元しました。以後は自動で同期します。':'認証情報と同期基準点を復元しました。同期操作は手動です。')},
  destroy(){clearQr();owner=null;receiver=null;session=null;serverCode=null;newCode.textContent='';stopped=true;render()}
 });
}
