// Local integration candidate only. No automatic mount, backup download,
// credential export, local record deletion or product-source mutation.
const HASH=/^[a-f0-9]{64}$/,NONCE=/^[A-Za-z0-9_-]{43}$/;
const fail=code=>{throw Error('OWNER_CLOSE_UI:'+code)};
const fields=['v','phase','operationId','scopeDigest','snapshotDigest','revision','checkpointRevision'];
export function readOwnerCloseIntent(local,profileId){
 if(!/^(legacy|p[1-9][0-9]?)$/.test(profileId))fail('PROFILE_REQUIRED');
 const raw=local.getItem('anilog-owner-close-intent-v1:'+profileId);if(raw===null)return null;let x;try{x=JSON.parse(raw)}catch{fail('JOURNAL_INVALID')}
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==fields.slice().sort().join('|')||x.v!==1||!['pending','confirmed'].includes(x.phase)||!NONCE.test(x.operationId)||!HASH.test(x.scopeDigest)||!HASH.test(x.snapshotDigest)||!Number.isSafeInteger(x.revision)||x.revision<0||!Number.isSafeInteger(x.checkpointRevision)||x.checkpointRevision<1)fail('JOURNAL_INVALID');return x;
}
export function createOwnerCloseFlow({local,profileId,inspect,transport,exclusive,fenceWrites,detachLocal,crypto=globalThis.crypto}={}){
 if(!/^(legacy|p[1-9][0-9]?)$/.test(profileId)||![inspect,transport,exclusive,fenceWrites,detachLocal].every(f=>typeof f==='function'))fail('INTEGRATION_REQUIRED');
 const key='anilog-owner-close-intent-v1:'+profileId;
 const read=()=>readOwnerCloseIntent(local,profileId);
 function write(x){local.setItem(key,JSON.stringify(x));if(JSON.stringify(read())!==JSON.stringify(x))fail('JOURNAL_NOT_DURABLE')}
 function check(p){if(p?.ready!==true||p.profileId!==profileId||!['connected','disconnected'].includes(p.phase)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isSafeInteger(p.checkpointRevision)||p.checkpointRevision<1||p.clean!==true||!HASH.test(p.scopeDigest)||!HASH.test(p.snapshotDigest))fail('LOCAL_PROOF_REQUIRED');return p}
 function same(p,j){check(p);if(!j||p.scopeDigest!==j.scopeDigest||p.snapshotDigest!==j.snapshotDigest||p.revision!==j.revision||p.checkpointRevision!==j.checkpointRevision)fail('SOURCE_CHANGED_KEEP_RECORDS')}
 let busy=false;
 async function run(fn){if(busy)fail('ALREADY_RUNNING');busy=true;try{return await exclusive(async lease=>{if(lease?.exclusive!==true)fail('EXCLUSIVE_LEASE_REQUIRED');return fn()})}finally{busy=false}}
 async function finish(j){same(await inspect({remotePreflight:false}),j);await detachLocal({profileId,scopeDigest:j.scopeDigest});const p=check(await inspect({remotePreflight:false}));same(p,j);if(p.phase!=='disconnected')fail('LOCAL_DETACH_UNCONFIRMED');fenceWrites(false);return {phase:'GROUP_CLOSED_RECORDS_RETAINED'};}
 async function send(j){
  same(await inspect({remotePreflight:false}),j);
  const t=await transport();if(!t||typeof t.fetcher!=='function'||!/^https:\/\//.test(t.apiRoot)||!/^https:\/\//.test(t.origin)||!/^[A-Za-z0-9_-]{22,43}$/.test(t.boxId)||!/^[A-Za-z0-9_-]{22,43}$/.test(t.device?.deviceId)||!NONCE.test(t.device?.deviceToken))fail('TRANSPORT_REQUIRED');
  if(new URL(t.apiRoot).origin!==t.apiRoot||new URL(t.origin).origin!==t.origin||t.apiRoot===t.origin)fail('TRANSPORT_REQUIRED');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([t.apiRoot,t.origin,t.boxId,t.device.deviceId])));
  if([...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')!==j.scopeDigest)fail('TRANSPORT_SCOPE_MISMATCH');
  same(await inspect({remotePreflight:false}),j);
  // transport must be resumed from the existing scope-bound sealed credentials.
  // No QR, master key, passphrase, ciphertext or record enters this request.
  const r=await t.fetcher(t.apiRoot+'/v1/boxes/'+t.boxId+'/close',{method:'POST',headers:{Origin:t.origin,'Content-Type':'application/json',Authorization:'Bearer '+t.device.deviceToken,'X-Device-Id':t.device.deviceId},body:JSON.stringify({operationId:j.operationId,expectedRevision:j.checkpointRevision})});
  const b=await r.json();if(r.status!==200||b?.closed!==true||b.activeDevices!==0)fail('SERVER_CLOSURE_UNCONFIRMED');
  const done={...j,phase:'confirmed'};write(done);return finish(done);
 }
 return Object.freeze({read,
  async prepare(){if(read())fail('RESUME_EXISTING_OPERATION');const p=check(await inspect({remotePreflight:true}));if(p.phase!=='connected'||p.role!=='owner'||p.activeDevices!==1||p.noPendingInvitations!==true)fail('SOLE_OWNER_REQUIRED');if(p.serverRevision!==p.checkpointRevision)fail('REMOTE_REVISION_CHANGED');return {scopeDigest:p.scopeDigest,snapshotDigest:p.snapshotDigest,revision:p.revision,checkpointRevision:p.checkpointRevision}},
  async close({confirmed=false,prepared}={}){if(confirmed!==true)fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{if(read())fail('RESUME_EXISTING_OPERATION');const p=check(await inspect({remotePreflight:true}));same(p,prepared);if(p.phase!=='connected'||p.role!=='owner'||p.activeDevices!==1||p.noPendingInvitations!==true)fail('SOLE_OWNER_REQUIRED');if(p.serverRevision!==p.checkpointRevision)fail('REMOTE_REVISION_CHANGED');
   const bytes=crypto.getRandomValues(new Uint8Array(32));const operationId=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');bytes.fill(0);
   const j={v:1,phase:'pending',operationId,scopeDigest:prepared.scopeDigest,snapshotDigest:prepared.snapshotDigest,revision:prepared.revision,checkpointRevision:prepared.checkpointRevision};fenceWrites(true);write(j);return send(j);
  })},
  async resume({confirmed=false}={}){if(confirmed!==true)fail('EXPLICIT_RESUME_REQUIRED');return run(async()=>{const j=read();if(!j)fail('JOURNAL_REQUIRED');fenceWrites(true);return j.phase==='confirmed'?finish(j):send(j)})}
 });
}

export function installOwnerCloseDialog({document,flow,openButton,onEraseRequested}={}){
 const dialog=document.createElement('dialog'),title=document.createElement('h2'),warning=document.createElement('p'),label=document.createElement('label'),check=document.createElement('input'),accept=document.createElement('button'),cancel=document.createElement('button'),erase=document.createElement('button'),status=document.createElement('p');
 title.textContent='同期グループを終了';warning.textContent='同期先の暗号化データ・復旧情報・端末登録を失効させます。元の同期先には戻せません。この端末の記録は残します。バックアップは任意です。';
 check.type='checkbox';label.append(check,document.createTextNode('同期グループの終了と、同期先のデータ削除を確認しました'));accept.type=cancel.type=erase.type='button';accept.textContent='同期グループを終了する';cancel.textContent='キャンセル';erase.textContent='この端末の記録も削除する';erase.hidden=true;accept.disabled=true;status.setAttribute('role','status');dialog.append(title,warning,label,accept,cancel,erase,status);document.body.append(dialog);let prepared,running=false,ready=false;
 dialog.id='anilog-owner-close-dialog';dialog.className='anilog-first-wal-upgrade';dialog.setAttribute('aria-label','同期グループを終了');
 check.addEventListener('change',()=>{accept.disabled=running||!ready||!check.checked});cancel.addEventListener('click',()=>{if(!running)dialog.close()});dialog.addEventListener('cancel',e=>{if(running)e.preventDefault()});
 async function show(){check.checked=false;accept.disabled=true;erase.hidden=true;label.hidden=accept.hidden=false;prepared=null;ready=false;try{if(flow.read()){accept.textContent='終了結果を確認する';status.textContent='前回の終了結果を確認します。記録は削除しません。'}else{prepared=await flow.prepare();accept.textContent='同期グループを終了する';status.textContent='管理端末1台だけであることを確認しました。'}ready=true;}catch{status.textContent='終了条件を確認できません。記録は保持されています。';}if(!dialog.open)dialog.showModal()}
 openButton.addEventListener('click',show);
 accept.addEventListener('click',async()=>{if(running||!ready||!check.checked)return;running=true;accept.disabled=cancel.disabled=true;try{const r=flow.read()?await flow.resume({confirmed:true}):await flow.close({confirmed:true,prepared});if(r.phase!=='GROUP_CLOSED_RECORDS_RETAINED')fail('RESULT_REQUIRED');status.textContent='同期グループを終了しました。この端末の記録は残っています。';erase.hidden=typeof onEraseRequested!=='function';label.hidden=accept.hidden=true;}catch{status.textContent='終了を確認できません。記録・鍵は保持しています。初期化や削除はせず、終了結果を確認してください。';check.checked=false;}finally{running=false;cancel.disabled=false;accept.disabled=!ready||!check.checked}});
 erase.addEventListener('click',()=>{if(!running&&!erase.hidden&&flow.read()?.phase==='confirmed')onEraseRequested?.()});return {dialog,show};
}
