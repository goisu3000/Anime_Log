// Product candidate. Credentials stay in the browser's existing encrypted stores.
import {freshSecret,secretToUrl,shaHex} from './pairing-client.mjs';
import {createOwnerRecoveryKit,decodeOwnerRecoveryKit} from './recovery-kit.mjs';
const TOKEN=/^[A-Za-z0-9_-]{43}$/,ID=/^[A-Za-z0-9_-]{22,43}$/,HASH=/^[a-f0-9]{64}$/;
const fail=x=>{throw Error('OWNER_AUTHORITY_UI:'+x)};
export function authorityFailureLabel(error){
 const code=String(error?.message??'');
 if(/^(?:OWNER_AUTHORITY_UI:(?:EXCLUSIVE_LEASE_REQUIRED|EXCLUSIVE_NOT_GRANTED)|AUTHORITY_IDLE_REQUIRED|WAL_TAB_PRESENCE_NOT_READY)$/.test(code))return '端末の排他・待機状態を確認できません。他のQAタブや編集中の画面を確認してください。';
 if(/^OWNER_AUTHORITY_UI:(?:CLEAN_VERIFIED_CHECKPOINT_REQUIRED|SOURCE_CHANGED_KEEP_RECORDS)$/.test(code))return '未送信変更または保存内容の一致を確認できません。記録を保持して停止しています。';
 if(code==='OWNER_AUTHORITY_UI:AUTHENTICATION_UNCONFIRMED')return 'この端末の認証結果を確認できません。';
 if(code==='OWNER_AUTHORITY_UI:SERVER_RESULT_UNCONFIRMED')return 'サーバーの完了確認を取得できません。';
 if(code==='OWNER_AUTHORITY_UI:RATE_LIMITED')return '通信回数の制限により確認を停止しました。';
 if(/^OWNER_AUTHORITY_UI:(?:JOURNAL_INVALID|JOURNAL_MISSING|JOURNAL_NOT_DURABLE)$/.test(code))return '端末内の操作記録を認証・確認できません。';
 return '操作結果を確認できません。';
}
const markerKey=id=>{if(!/^(legacy|p[1-9][0-9]?)$/.test(id))fail('PROFILE_REQUIRED');return 'anilog-owner-authority-v1:'+id};
export function readOwnerAuthorityMarker(local,id){const raw=local.getItem(markerKey(id));if(raw===null)return null;let x;try{x=JSON.parse(raw)}catch{fail('JOURNAL_INVALID')}
 if(!x||Object.keys(x).sort().join('|')!=='phase|role|v'||x.v!==1||!['pending','completed','cancelled'].includes(x.phase)||(x.phase==='completed'?!['owner','released'].includes(x.role):x.role!==null))fail('JOURNAL_INVALID');return x;
}
export function ownerAuthorityWriteBlocked(local,id,profilePhase){const x=readOwnerAuthorityMarker(local,id);return x?.phase==='pending'||x?.phase==='completed'&&x.role==='released'&&profilePhase!=='disconnected';}
function scope(t){if(!t||typeof t.fetcher!=='function'||!ID.test(t.boxId)||!ID.test(t.device?.deviceId)||!TOKEN.test(t.device.deviceToken)||!(t.masterKey instanceof Uint8Array)||t.masterKey.length!==32)fail('TRANSPORT_REQUIRED');for(const origin of [t.apiRoot,t.origin]){let u;try{u=new URL(origin)}catch{fail('SCOPE_REQUIRED')}if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password)fail('SCOPE_REQUIRED')}if(t.apiRoot===t.origin)fail('SCOPE_REQUIRED');return t;}
export function createOwnerAuthorityFlow({local,profileId,store,inspect,transport,exclusive,fenceWrites,onReleased,getInitialRecoveryToken,recoveryFetch=globalThis.fetch}={}){
 markerKey(profileId);if(!store?.read||!store?.create||!store?.replace||![inspect,transport,exclusive,fenceWrites,onReleased,getInitialRecoveryToken].every(x=>typeof x==='function'))fail('INTEGRATION_REQUIRED');
 let busy=false;
 const check=(x,retainDirty=false)=>{if(x?.ready!==true||(!retainDirty&&x.clean!==true)||typeof x.clean!=='boolean'||x.profileId!==profileId||!HASH.test(x.scopeDigest)||!HASH.test(x.snapshotDigest)||!Number.isSafeInteger(x.checkpointRevision)||x.checkpointRevision<1)fail('CLEAN_VERIFIED_CHECKPOINT_REQUIRED');return x;};
 const validate=j=>{if(j!==null&&(!j||j.v!==1||!['offer','accept','recover','release'].includes(j.kind)||!['pending','completed','cancelled'].includes(j.phase)||!TOKEN.test(j.operationId)||!HASH.test(j.scopeDigest)||!HASH.test(j.snapshotDigest)||!Number.isSafeInteger(j.checkpointRevision)||j.checkpointRevision<1||!ID.test(j.targetDeviceId)||['accept','recover'].includes(j.kind)&&!TOKEN.test(j.nextRecoveryToken)||j.kind==='recover'&&!TOKEN.test(j.oldRecoveryToken)))fail('JOURNAL_INVALID');return j;};
 const read=async()=>validate(await store.read());
 function mark(j){const x={v:1,phase:j.phase,role:j.phase==='completed'?(['offer','release'].includes(j.kind)?'released':'owner'):null};local.setItem(markerKey(profileId),JSON.stringify(x));if(JSON.stringify(readOwnerAuthorityMarker(local,profileId))!==JSON.stringify(x))fail('JOURNAL_NOT_DURABLE');}
 async function save(previous,next){const written=previous?await store.replace(previous,next):await store.create(next);if(JSON.stringify(written)!==JSON.stringify(next)||JSON.stringify(await read())!==JSON.stringify(next))fail('JOURNAL_NOT_DURABLE');mark(next);return next;}
 async function same(j){const p=check(await inspect(),j.kind==='release');if(p.scopeDigest!==j.scopeDigest||p.snapshotDigest!==j.snapshotDigest||p.checkpointRevision!==j.checkpointRevision)fail('SOURCE_CHANGED_KEEP_RECORDS');return p;}
 async function send(action,body={},recoveryToken){const t=scope(await transport());try{
  const p=check(await inspect(),action==='release'),digest=await shaHex(JSON.stringify([t.apiRoot,t.origin,t.boxId,t.device.deviceId]));if(p.scopeDigest!==digest)fail('TRANSPORT_SCOPE_MISMATCH');
  const url=t.apiRoot+'/v1/boxes/'+t.boxId+'/owner-authority/'+action,headers={Origin:t.origin,Authorization:'Bearer '+t.device.deviceToken,'X-Device-Id':t.device.deviceId,...(action!=='pending'?{'Content-Type':'application/json'}:{})};
  let r;
  if(action==='recover'){
   // A separate exact-route recovery adapter; the ordinary browser transport's
   // privileged-header prohibition remains unchanged. Never follows redirects.
   if(!TOKEN.test(recoveryToken)||typeof recoveryFetch!=='function')fail('RECOVERY_CREDENTIAL_REQUIRED');
   delete headers.Origin;headers['X-Recovery-Token']=recoveryToken;
   r=await recoveryFetch(url,{method:'POST',headers,body:JSON.stringify(body),mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
  }else r=await t.fetcher(url,{method:['pending','release'].includes(action)?'GET':'POST',headers,...(['pending','release'].includes(action)?{}:{body:JSON.stringify(body)})});
  let data;try{data=await r.json()}catch{fail('SERVER_RESPONSE_INVALID')}
  if(r.status!==200)fail(r.status===401?'AUTHENTICATION_UNCONFIRMED':r.status===429?'RATE_LIMITED':'SERVER_RESULT_UNCONFIRMED');return data;
 }finally{t.masterKey.fill(0)}}
 async function run(fn){if(busy)fail('ALREADY_RUNNING');busy=true;try{let entered=false;const answer=await exclusive(async lease=>{if(lease?.exclusive!==true)fail('EXCLUSIVE_LEASE_REQUIRED');entered=true;return fn()});if(!entered)fail('EXCLUSIVE_NOT_GRANTED');return answer;}finally{busy=false}}
 async function prepare(kind,targetDeviceId,operationId,kit){const p=check(await inspect(),kind==='release'),previous=await read();if(p.phase!=='connected')fail('CONNECTED_PROFILE_REQUIRED');if(previous?.phase==='pending')fail('RESUME_PENDING_OPERATION');
  const t=scope(await transport());let nextRecoveryToken=null,oldRecoveryToken=null,ownerRecoveryToken=previous?.nextRecoveryToken??previous?.ownerRecoveryToken??null;
  try{
   if(!ID.test(targetDeviceId))targetDeviceId=t.device.deviceId;
   if(kind==='recover'){
    const decoded=await decodeOwnerRecoveryKit(kit);try{if(decoded.boxId!==t.boxId||decoded.masterKey.length!==t.masterKey.length||decoded.masterKey.some((v,i)=>v!==t.masterKey[i]))fail('RECOVERY_KEY_SCOPE_MISMATCH');oldRecoveryToken=decoded.recoveryToken}finally{decoded.masterKey.fill(0)}
   }
   if(kind==='offer'&&!ownerRecoveryToken)ownerRecoveryToken=await getInitialRecoveryToken();
   if(['accept','recover'].includes(kind))nextRecoveryToken=secretToUrl(freshSecret());
   const j={v:1,kind,phase:'pending',operationId:operationId??secretToUrl(freshSecret()),targetDeviceId,scopeDigest:p.scopeDigest,snapshotDigest:p.snapshotDigest,checkpointRevision:p.checkpointRevision,nextRecoveryToken,oldRecoveryToken,ownerRecoveryToken};
   validate(j);await save(previous,j);fenceWrites(true);return j;
  }finally{t.masterKey.fill(0)}
 }
 async function finish(j,answer){await same(j);
  if(answer.operationId!==j.operationId||answer.targetDeviceId!==j.targetDeviceId||!['pending','completed','cancelled','expired'].includes(answer.state))fail('SERVER_SCOPE_MISMATCH');
  if(answer.state==='pending'||answer.state==='expired')return {phase:answer.state==='pending'?'AWAITING_TARGET':'EXPIRED_KEEP_FENCED'};
  if(answer.state==='cancelled'){await save(j,{...j,phase:'cancelled'});fenceWrites(false);return {phase:'CANCELLED_RECORDS_RETAINED'};}
  if(answer.role!==(j.kind==='offer'?'released':'owner'))fail('SERVER_ROLE_UNCONFIRMED');
  await save(j,{...j,phase:'completed'});if(j.kind==='offer')await onReleased();fenceWrites(false);return {phase:j.kind==='offer'?'OLD_OWNER_RELEASED_RECORDS_RETAINED':'NEW_OWNER_AUTHENTICATED'};
 }
 function releaseProof(answer){if(answer?.revoked!==true||answer.role!=='released'||Object.keys(answer).sort().join('|')!=='revoked|role')fail('SERVER_ROLE_UNCONFIRMED');return answer;}
 async function finishRelease(j){releaseProof(await send('release'));await same(j);await save(j,{...j,phase:'completed'});await onReleased();fenceWrites(false);return {phase:'FORMER_OWNER_RELEASED_RECORDS_RETAINED'};}
 async function resume(){const j=await read();if(!j||j.phase==='cancelled')fail('PENDING_OPERATION_REQUIRED');fenceWrites(true);await same(j);
  if(j.kind==='release')return finishRelease(j);
  const body={operationId:j.operationId,...(j.kind!=='offer'?{nextRecoveryHash:await shaHex(j.nextRecoveryToken)}:{})};
  return finish(j,await send(j.kind==='offer'?'status':j.kind,body,j.oldRecoveryToken));
 }
 return Object.freeze({read,async recoverPendingFence(){const j=await read(),m=readOwnerAuthorityMarker(local,profileId);if(!j&&m)fail('JOURNAL_MISSING');if(j){mark(j);if(j.phase==='pending')fenceWrites(true);}return j;},
  async releasedStatus(){return releaseProof(await send('release'));},
  async releaseFormerOwner({confirmed=false}={}){if(confirmed!==true)fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{releaseProof(await send('release'));const j=await prepare('release');return finishRelease(j);});},
  async offer({targetDeviceId,confirmed=false}={}){if(confirmed!==true||!ID.test(targetDeviceId))fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{const j=await prepare('offer',targetDeviceId);await same(j);return finish(j,await send('offer',{operationId:j.operationId,targetDeviceId}))})},
  async pending(){const x=await send('pending');if(!['none','pending'].includes(x.state)||!['owner','member'].includes(x.role)||x.state==='pending'&&(!TOKEN.test(x.operationId)||!ID.test(x.targetDeviceId)))fail('SERVER_RESPONSE_INVALID');return x;},
  async accept({operationId,confirmed=false}={}){if(confirmed!==true||!TOKEN.test(operationId))fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{const offered=await send('pending');if(offered.operationId!==operationId||offered.role!=='member')fail('OFFER_CHANGED');const j=await prepare('accept',offered.targetDeviceId,operationId);return finish(j,await send('accept',{operationId:j.operationId,nextRecoveryHash:await shaHex(j.nextRecoveryToken)}))})},
  async recover({kit,confirmed=false}={}){if(confirmed!==true)fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{const j=await prepare('recover',null,null,kit);await same(j);return finish(j,await send('recover',{operationId:j.operationId,nextRecoveryHash:await shaHex(j.nextRecoveryToken)},j.oldRecoveryToken))})},
  resume:()=>run(resume),
  async cancel({confirmed=false}={}){if(confirmed!==true)fail('FINAL_CONFIRMATION_REQUIRED');return run(async()=>{const j=await read();if(!j||j.kind!=='offer'||j.phase!=='pending')fail('OWNER_OFFER_REQUIRED');await same(j);return finish(j,await send('cancel',{operationId:j.operationId}))})},
  async recoveryKit(){const t=scope(await transport());try{const j=await read(),recoveryToken=j?.phase==='completed'&&j.kind!=='offer'?j.nextRecoveryToken:j?.ownerRecoveryToken??await getInitialRecoveryToken();if(!TOKEN.test(recoveryToken))fail('RECOVERY_KEY_UNAVAILABLE');const proof=await send('proof',{recoveryHash:await shaHex(recoveryToken)});if(proof.verified!==true||proof.role!=='owner')fail('RECOVERY_KEY_UNCONFIRMED');return await createOwnerRecoveryKit({boxId:t.boxId,recoveryToken,masterKey:t.masterKey});}finally{t.masterKey.fill(0)}}
 });
}

export function installOwnerAuthorityUI({document,flow,openButton,getRole,listMembers,prepareUI=async()=>false,onComplete=()=>{},reload=()=>{}}={}){
 const dialog=document.createElement('dialog');dialog.className='anilog-first-wal-upgrade';dialog.id='anilog-owner-authority-dialog';dialog.setAttribute('aria-label','管理端末の変更・復旧');
 const title=document.createElement('h2');title.textContent='管理端末の変更・復旧';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');status.tabIndex=-1;
 Object.assign(status.style,{padding:'12px 16px',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',background:'var(--surface2)'});
 function feedback(message,state,announce=true){
  status.textContent=message;status.setAttribute('data-state',state);status.setAttribute('aria-busy',String(state==='busy'));
  const color=state==='error'?'var(--danger)':state==='success'?'var(--accent)':'var(--border)';status.style.borderColor=color;status.style.color=state==='error'||state==='success'?color:'var(--ink)';
  if(announce){try{status.focus?.({preventScroll:true});status.scrollIntoView?.({block:'nearest',behavior:'auto'});}catch{ /* Display support must never change an authority operation result. */ }}
 }
 const choices=document.createElement('div');choices.className='anilog-first-wal-upgrade-actions';choices.setAttribute('role','group');choices.setAttribute('aria-label','管理端末の操作を選択');
 const changeView=document.createElement('button'),recoveryView=document.createElement('button');changeView.type=recoveryView.type='button';changeView.textContent='管理端末を変更する';recoveryView.textContent='故障・紛失から復旧する';choices.append(changeView,recoveryView);
 let currentRole=null,hasMembers=false,currentView=null;
 const target=document.createElement('select');target.id='anilog-authority-target';target.setAttribute('aria-label','引き継ぎ先の端末');
 const targetField=document.createElement('div');targetField.className='anilog-authority-target-field';const targetLabel=document.createElement('label');targetLabel.htmlFor=target.id;targetLabel.textContent='引き継ぎ先の端末';targetField.append(targetLabel,target);
 const keyInput=document.createElement('textarea');keyInput.setAttribute('aria-label','保存してある管理端末の復旧キー');keyInput.autocomplete='off';keyInput.spellcheck=false;
 const keyOutput=document.createElement('textarea');keyOutput.setAttribute('aria-label','管理端末の復旧キー');keyOutput.readOnly=true;keyOutput.autocomplete='off';keyOutput.spellcheck=false;
 const warning=document.createElement('p');warning.textContent='引き継ぎ完了後、この端末の同期登録は解除されます。\n※記録は消えません。';
 const keyHelp=document.createElement('p');keyHelp.textContent='管理端末が故障・紛失した場合、接続済みの別端末と、復旧キーで管理権限を復旧できます。\n※復旧キーは事前に控えておく必要があります。';
 const recoveryHelp=document.createElement('p');recoveryHelp.textContent='復旧には、この同期先に接続済みの端末と、事前に控えた復旧キーが必要です。復旧すると旧管理端末の同期登録は解除されます。旧端末内の記録は削除されません。';
 status.style.whiteSpace=warning.style.whiteSpace=keyHelp.style.whiteSpace='pre-line';
 const label=document.createElement('label'),confirmed=document.createElement('input');confirmed.type='checkbox';label.append(confirmed,document.createTextNode('操作対象と管理権限の変更を確認しました'));
 const actions=document.createElement('div');actions.className='anilog-first-wal-upgrade-actions';
 const button=text=>{const b=document.createElement('button');b.type='button';b.textContent=text;actions.append(b);return b;};
 const offer=button('引き継ぎを依頼する'),refresh=button('引き継ぎ依頼を確認'),accept=button('この端末を管理端末にする'),recover=button('復旧キーで管理端末を復旧'),release=button('解除済みの登録を確認して記録を残す'),resume=button('前回の結果を確認する'),cancel=button('引き継ぎを中止する'),showKey=button('復旧キーを控える（任意）'),update=button('画面を更新'),close=button('閉じる');
 const mutation=[offer,accept,recover,release,resume,cancel],all=[...mutation,refresh,showKey,update,close];let running=false,opening=false,pendingOperation=null;
 dialog.append(title,choices,status,warning,targetField,keyHelp,recoveryHelp,keyInput,keyOutput,label,actions);document.body.append(dialog);
 function disabled(){changeView.disabled=recoveryView.disabled=running;for(const b of mutation)b.disabled=running||!confirmed.checked;for(const b of [refresh,showKey,update,close])b.disabled=running;}
 function hide(){choices.hidden=true;currentRole=null;hasMembers=false;currentView=null;warning.hidden=false;for(const e of [targetField,target,keyHelp,recoveryHelp,keyInput,keyOutput,...all])e.hidden=true;close.hidden=false;pendingOperation=null;confirmed.checked=false;label.hidden=false;disabled();}
 function selectView(recovery){
  if(running||!currentRole||choices.hidden||currentView===recovery)return;
  currentView=recovery;
  for(const e of [targetField,target,warning,keyHelp,recoveryHelp,keyInput,keyOutput,offer,refresh,accept,recover,showKey])e.hidden=true;
  confirmed.checked=false;pendingOperation=null;keyInput.value=keyOutput.value='';label.hidden=recovery&&currentRole==='owner';
  for(const [b,selected] of [[changeView,!recovery],[recoveryView,recovery]]){b.setAttribute('aria-pressed',String(selected));b.style.borderColor=selected?'var(--accent-border)':'var(--border-ctrl)';b.style.background=selected?'var(--accent-soft)':'var(--surface2)';b.style.color=selected?'var(--accent)':'var(--ink)';}
  if(recovery){
   if(currentRole==='owner'){keyHelp.hidden=showKey.hidden=false;feedback('管理端末が使えなくなる前に、復旧キーを控えられます。保管は任意です。','neutral',false);}
   else{recoveryHelp.hidden=keyInput.hidden=recover.hidden=false;feedback('管理端末が故障・紛失して使えない場合に、事前に控えた復旧キーで復旧します。','neutral',false);}
  }else if(currentRole==='owner'){warning.hidden=false;target.hidden=offer.hidden=!hasMembers;feedback(hasMembers?'引き継ぎ先の端末本人の承認後に、管理権限を移します。':'引き継ぎ先の登録端末がありません。','neutral',false);}
  else{refresh.hidden=false;feedback('現在の管理端末から依頼された引き継ぎを確認します。復旧キーは不要です。','neutral',false);}
  targetField.hidden=target.hidden;disabled();
 }
 changeView.addEventListener('click',()=>selectView(false));recoveryView.addEventListener('click',()=>selectView(true));
 function result(x){const messages={AWAITING_TARGET:'引き継ぎ先の端末で「引き継ぎ依頼を確認」から承認してください。',EXPIRED_KEEP_FENCED:'依頼の期限が切れました。「引き継ぎを中止する」で記録を保持したまま終了してください。',OLD_OWNER_RELEASED_RECORDS_RETAINED:'管理端末を引き継ぎ、この端末の同期登録を解除しました。記録は残っています。',FORMER_OWNER_RELEASED_RECORDS_RETAINED:'この端末の登録解除をサーバーで確認しました。未送信の変更を含め、記録はこの端末に残っています。',CANCELLED_RECORDS_RETAINED:'引き継ぎを中止しました。記録は残っています。',NEW_OWNER_AUTHENTICATED:'この端末の管理者権限を確認しました。画面を更新してください。'};
  if(!Object.hasOwn(messages,x?.phase))fail('RESULT_INVALID');choices.hidden=true;status.textContent=messages[x.phase];if(['OLD_OWNER_RELEASED_RECORDS_RETAINED','FORMER_OWNER_RELEASED_RECORDS_RETAINED','NEW_OWNER_AUTHENTICATED','CANCELLED_RECORDS_RETAINED'].includes(x.phase)){for(const b of mutation)b.hidden=true;update.hidden=false;onComplete(x);}}
 async function action(fn,trigger=null,announce=true){if(running)return;running=true;const original=trigger?.textContent;feedback('確認中… 画面を閉じずにお待ちください。','busy',false);if(trigger)trigger.textContent='確認中…';disabled();try{await fn();feedback((announce?'✓ 確認が終わりました。\n':'')+status.textContent,'success',announce)}catch(error){feedback('⚠ '+authorityFailureLabel(error)+' 記録・接続情報は保持しています。再登録や削除はしないでください。','error',announce);const j=await flow.read().catch(()=>null);if(j)choices.hidden=true;resume.hidden=!j;cancel.hidden=j?.kind!=='offer'||j?.phase!=='pending';}finally{if(trigger)trigger.textContent=original;running=false;disabled()}}
 async function show(){if(opening||running||dialog.open)return;opening=true;try{hide();keyInput.value=keyOutput.value='';status.textContent='管理権限を確認中…';let prepared=false;try{prepared=await prepareUI()===true}catch{}dialog.showModal();if(!prepared){status.textContent='画面更新・保存・入力の待機状態を確認できません。入力は保持しています。ほかの編集を終了してから、この画面を開き直してください。';label.hidden=true;return;}await action(async()=>{
  const j=await flow.read();if(j?.phase==='pending'||j?.phase==='completed'&&['offer','release'].includes(j.kind)){resume.hidden=false;cancel.hidden=j.phase!=='pending'||j.kind!=='offer';status.textContent='前回の操作結果を確認してください。記録は保持しています。';return;}
  let role;try{role=await getRole()}catch{await flow.releasedStatus();release.hidden=false;warning.textContent='この端末の管理権限は既に失効しています。登録解除の確認後も、未送信の変更を含む記録は残します。';status.textContent='サーバーでこの端末の登録解除を確認しました。記録を残して同期OFFにできます。';return;}
  if(role==='owner'){
   const members=await listMembers();target.replaceChildren();for(const m of members){const o=document.createElement('option');o.value=m.deviceId;o.textContent=m.label;target.append(o);}hasMembers=members.length>0;
  }else if(role!=='member')throw Error('ROLE_REQUIRED');
  currentRole=role;choices.hidden=false;
 },null,false);
 if(currentRole&&!choices.hidden)selectView(false);}finally{opening=false}}
 confirmed.addEventListener('change',disabled);
 offer.addEventListener('click',()=>{if(!confirmed.checked)return;void action(async()=>{result(await flow.offer({targetDeviceId:target.value,confirmed:true}));offer.hidden=true;resume.hidden=cancel.hidden=false;})});
 refresh.addEventListener('click',()=>void action(async()=>{const x=await flow.pending();pendingOperation=x.state==='pending'?x.operationId:null;accept.hidden=!pendingOperation;status.textContent=pendingOperation?'この端末への引き継ぎ依頼があります。承認すると管理端末になります。':'この端末への引き継ぎ依頼はありません。';confirmed.checked=false;},refresh));
 accept.addEventListener('click',()=>{if(!confirmed.checked||!pendingOperation)return;void action(async()=>result(await flow.accept({operationId:pendingOperation,confirmed:true}))) });
 recover.addEventListener('click',()=>{if(!confirmed.checked)return;if(running)return;const kit=keyInput.value.trim();if(!kit){feedback('⚠ 復旧キーが入力されていません。事前に控えた復旧キーを入力してください。','error');return;}keyInput.value='';void action(async()=>result(await flow.recover({kit,confirmed:true})),recover) });
 release.addEventListener('click',()=>{if(confirmed.checked)void action(async()=>result(await flow.releaseFormerOwner({confirmed:true}))) });
 resume.addEventListener('click',()=>{if(confirmed.checked)void action(async()=>result(await flow.resume()))});
 cancel.addEventListener('click',()=>{if(confirmed.checked)void action(async()=>result(await flow.cancel({confirmed:true})))});
 showKey.addEventListener('click',()=>void action(async()=>{keyOutput.value=await flow.recoveryKit();keyOutput.hidden=false;status.textContent='この同期先に接続済みの端末と、このキーの両方で管理端末を復旧できます。保管は任意です。ダウンロードは不要で、他人には渡さないでください。';}));
 update.addEventListener('click',()=>{if(!running)reload()});close.addEventListener('click',()=>{if(!running)dialog.close()});
 dialog.addEventListener('cancel',e=>{if(running)e.preventDefault()});dialog.addEventListener('close',()=>{keyInput.value=keyOutput.value='';confirmed.checked=false;});
 openButton.addEventListener('click',()=>void show());return {dialog,show};
}
