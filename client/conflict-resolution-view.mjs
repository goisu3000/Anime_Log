import {bulkConflictChoices,manualConflictKind} from './conflict-resolution-plan.mjs';
const categories={progress:'視聴話数',status:'視聴状況',note:'メモ',review:'評価',ranking:'ランキング',deletion:'削除・復元',settings:'設定',other:'その他の変更'};
const statuses={watching:'見てる',watched:'見た',planned:'見たい',paused:'一時中断',dropped:'視聴中止'};
function display(option){
 if(option.missing)return '未設定';if(option.kind==='deleted')return '削除済み';if(option.kind==='unknown')return '削除履歴が確認できません';if(option.kind==='live')return '作品を残す';
 const value=option.value;if(typeof value==='string')return statuses[value]??value;
 if(value===null||value===undefined)return '未設定';if(typeof value!=='object')return String(value);
 if(value.text!==undefined)return String(value.text);if(value.overall!==undefined)return '総合評価 '+value.overall+' / '+Object.entries(value.aspects??{}).map(([k,v])=>({story:'ストーリー',visual:'映像',characters:'キャラクター',music:'音楽'}[k]??'詳細評価')+' '+v).join('、');
 return Object.values(value).filter(v=>['string','number','boolean'].includes(typeof v)).join(' / ')||'保存内容が異なります';
}
// Backup stays in the owner's device. File contents never enter logs or URLs.
export function createConflictBackupSink({root,onOpen=()=>{}}){
 let cancel,pending=false;
 return {cancel:()=>cancel?.(),save:({bytes})=>new Promise((resolve,reject)=>{
  const doc=root.ownerDocument,node=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e};root.replaceChildren();root.hidden=false;pending=true;
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),link=node('a','バックアップを保存');link.href=url;link.download='anime-log-before-conflict-resolution.json';
  const check=node('input');check.type='checkbox';check.disabled=true;const label=node('label');label.append(check,doc.createTextNode('この端末にファイルを保存しました'));
  const file=node('input');file.type='file';file.accept='.json,application/json';file.disabled=true;file.tabIndex=-1;file.className='anilog-sync-backup-file-input';file.setAttribute('aria-label','保存したバックアップを選び直す');
  const verify=node('button','保存したファイルを選んで照合する');verify.type='button';verify.disabled=true;verify.className='anilog-sync-backup-verify';
  const instruction=node('p','①「バックアップを保存」を押して、ファイルをこの端末に保存してください。');
  const explanation=node('p','② 保存したファイルを選び直して、中身が正しいことを照合します。データの消失を防ぐために必要な確認です。ファイルは外部に送信されません。');
  const feedback=node('p','先にバックアップを保存してください。');feedback.setAttribute('role','status');feedback.className='anilog-sync-backup-feedback';
  let downloaded=false;
  link.addEventListener('click',()=>{downloaded=true;check.disabled=false;feedback.textContent='ファイルが保存できたら、下の確認欄にチェックを入れてください。'});
  check.addEventListener('change',()=>{file.disabled=verify.disabled=!downloaded||!check.checked;feedback.textContent=check.checked?'保存したファイルを選んで照合してください。':'ファイルが保存できたことを確認してください。'});
  verify.addEventListener('click',()=>{if(!verify.disabled)file.click()});
  const finish=()=>{URL.revokeObjectURL(url);root.hidden=true;root.replaceChildren();cancel=null;pending=false};
  cancel=()=>{finish();reject(Error('BACKUP_CANCELLED'))};
  file.addEventListener('change',async()=>{try{if(!downloaded||!check.checked||file.files?.length!==1||file.files[0].size>12000000)throw Error('BACKUP_REQUIRED');const readBack=new Uint8Array(await file.files[0].arrayBuffer());finish();resolve({savedConfirmed:true,readBack})}catch{finish();reject(Error('BACKUP_NOT_VERIFIED'))}});
  root.append(instruction,link,label,explanation,verify,file,feedback);
  onOpen();
 }),get pending(){return pending}};
}
export function mountConflictResolutionView({root,openFlow,onComplete=()=>{},onBusy=()=>{},onExit=()=>{},onReload=()=>{}}){
 const doc=root.ownerDocument,make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e};
 let session,review,choices={},controls=new Map(),backed=false,busy=false,closed=false,reloadRequired=false;
 const status=make('p','変更内容を確認しています。'),guide=make('p'),toolbar=make('div'),groups=make('div'),bulkDetails=make('details'),backupArea=make('div'),footer=make('div');backupArea.hidden=true;
 root.classList.add('anilog-sync-review');groups.className='anilog-sync-review-groups';footer.className='anilog-sync-review-footer';backupArea.className='anilog-sync-backup-review';
 bulkDetails.className='anilog-sync-help anilog-sync-review-bulk';toolbar.className='anilog-sync-bulk-actions';
 const bulkSummary=make('summary','まとめて選ぶ'),bulkHint=make('p','削除・復元を含まない、重複した変更だけをまとめて選びます。選んだ後で項目ごとに変更できます。');
 bulkDetails.append(bulkSummary,bulkHint,toolbar);
 root.replaceChildren(make('h3','同期する内容を確認'),status,guide,bulkDetails,groups,backupArea,footer);
 const backup=make('button','バックアップを保存・確認'),approve=make('input'),approveLabel=make('label'),danger=make('input'),dangerLabel=make('label'),choose=make('button','選択内容を確認'),commit=make('button','同期を実行する'),again=make('button','最新の変更を確認し直す');
 backup.dataset.syncStep='backup';choose.dataset.syncStep='choose';commit.dataset.syncStep='commit';
 const backupSink=createConflictBackupSink({root:backupArea,onOpen:()=>{backup.hidden=true;guide.textContent='手順2/4：バックアップを保存し、保存したファイルを選んで照合してください。';onBusy('backup-prompt')}});
 approve.type=danger.type='checkbox';approve.setAttribute('aria-label','バックアップと選択内容を確認');danger.setAttribute('aria-label','削除・復元を含む変更を確認');approveLabel.append(approve,doc.createTextNode('バックアップと選択内容を確認し、ほかのANIタブを閉じました'));dangerLabel.append(danger,doc.createTextNode('削除・復元を含む選択の影響を確認しました'));
 footer.append(backup,approveLabel,dangerLabel,choose,commit,again);choose.disabled=commit.disabled=true;choose.hidden=commit.hidden=again.hidden=approveLabel.hidden=dangerLabel.hidden=true;
 const syncControls=()=>{for(const [id,c] of controls){const value=choices[id];c.select.value=value?.source??'';c.select.classList.toggle('is-selected',!!value?.source);c.details.classList.toggle('is-selected',!!value?.source);c.picked.textContent=value?.source==='local'?'✓ この端末の内容を残す':value?.source==='remote'?'✓ 同期先の内容を残す':value?.source==='manual'?'✓ 自分で入力した内容を残す':'';c.picked.hidden=!value?.source;if(value?.source==='manual')c.input.hidden=false;else c.input.hidden=true}
  for(const button of toolbar.querySelectorAll('button[data-source]')){const valid=review.units.filter(u=>!u.dangerous&&u.options[button.dataset.source]);button.setAttribute('aria-pressed',String(valid.length>0&&valid.every(u=>choices[u.id]?.source===button.dataset.source)))}
  const missing=review.units.filter(u=>!choices[u.id]||u.kind==='ranking'&&choices[u.id]?.source==='manual'&&!choices[u.id].orders).length;
  choose.disabled=busy||!backed||!approve.checked||missing>0||review.units.some(u=>u.dangerous&&!danger.checked);
  if(backed)guide.textContent=missing?`手順3/4：残す内容が未選択の項目は${missing}件です。選択してから確認に進んでください。`:!approve.checked||review.units.some(u=>u.dangerous&&!danger.checked)?'手順3/4：残す内容を選択できました。確認欄にチェックして「選択内容を確認」を押してください。':'手順3/4：選択できました。「選択内容を確認」を押すと、最後の実行ボタンに進みます。';
 };
 const run=fn=>async()=>{if(busy||closed)return;busy=true;onBusy(true);choose.disabled=commit.disabled=backup.disabled=true;try{await fn()}catch(error){if(closed)return;reloadRequired=/RELOAD_REQUIRED$/.test(error?.message??'');status.textContent=reloadRequired?'記録を保護して停止しています。画面を開き直して、保存された状態から確認してください。':'変更が増えたか、保存・通信を確認できませんでした。記録とバックアップを保持しています。最新の変更を確認し直してください。';guide.textContent='同期は完了していません。記録は保持されています。下のボタンから安全に確認し直してください。';again.textContent=reloadRequired?'記録を保持して画面を開き直す':'最新の変更を確認し直す';again.hidden=false;backup.hidden=choose.hidden=commit.hidden=approveLabel.hidden=dangerLabel.hidden=true;toolbar.querySelectorAll('button').forEach(b=>b.disabled=true);approve.disabled=danger.disabled=true;backup.disabled=choose.disabled=commit.disabled=true;for(const c of controls.values())c.select.disabled=c.input.disabled=true;}finally{busy=false;onBusy(false);}};
 function render(){
  toolbar.replaceChildren();groups.replaceChildren();controls.clear();choices={};backed=false;approve.checked=danger.checked=false;
  backup.hidden=false;backup.disabled=false;choose.hidden=commit.hidden=again.hidden=approveLabel.hidden=dangerLabel.hidden=true;
  const ordinary=review.units.filter(u=>!u.dangerous).length,dangerous=review.units.length-ordinary;
  status.textContent=`確認が必要な項目は${review.units.length}件です。削除・復元を含まない変更${ordinary}件、削除・復元に関わる変更${dangerous}件。重なっていない変更はそのまま残ります。`;
  guide.textContent='手順1/4：残す内容を選んでください。続けてバックアップを確認し、最後に「同期を実行する」を押すと完了します。';
  bulkDetails.hidden=ordinary===0;
  const bulk=(text,source)=>{const button=make('button',text);button.type='button';button.dataset.source=source;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{if(busy||closed)return;const selected=bulkConflictChoices(review,source);Object.assign(choices,selected);const affected=review.units.filter(u=>selected[u.id]);status.textContent=`削除・復元を含まない変更${affected.length}件を選びました。必要な項目は個別に変更できます。`;syncControls()});toolbar.append(button)};
  bulk('この端末の変更を残す','local');bulk('同期先の変更を残す','remote');
  // Deletion/restoration conflicts always require each item to be chosen
  // explicitly. Keep the dangerous checks in the flow, never in bulk UI.
  for(const [category,title] of Object.entries(categories)){
   const rows=review.units.filter(u=>u.category===category);if(!rows.length)continue;groups.append(make('h4',title+'（'+rows.length+'組）'));
   for(const u of rows){
    const details=make('details');details.className='anilog-sync-help';details.append(make('summary',(u.title?u.title+'：':'')+u.label));
    const body=make('div');body.className='conflict-choice-content';
    if(u.kind==='ranking')for(const [source,title] of [['local','この端末'],['remote','同期先']]){body.append(make('p',title));if(!u.options[source].valid)body.append(make('p','順位情報が不完全なため、この側はそのまま採用できません。'));for(const g of u.options[source].groups){body.append(make('p','総合評価 '+g.rating));const list=make('ol');g.rows.forEach(row=>list.append(make('li',row.title)));body.append(list)}}
    else for(const [source,title] of [['local','この端末'],['remote','同期先']]){body.append(make('p',title+'：'+display(u.options[source])));if(u.kind==='record'&&u.options[source].kind==='live'){const r=u.options[source].record;body.append(make('p',r.title+' / '+(statuses[r.status]??'')+' / '+(r.watchedEpisodes??0)+'話'));if(r.note?.text)body.append(make('p','メモ：'+r.note.text))}}
    const select=make('select');select.setAttribute('aria-label',(u.title?u.title+' ':'')+u.label+'の選択');const empty=make('option','残す内容を選んでください');empty.value='';select.append(empty);
    for(const [source,title] of [['local','この端末の内容を残す'],['remote','同期先の内容を残す']]){const option=make('option',title);option.value=source;option.disabled=u.kind==='record'&&u.options[source].kind==='unknown'||u.kind==='ranking'&&!u.options[source].valid;select.append(option)}
    const kind=u.kind==='ranking'?'ranking':manualConflictKind(u),input=make(kind==='ranking'?'fieldset':kind==='note'?'textarea':kind==='status'?'select':'input');input.hidden=true;input.setAttribute('aria-label','自分で入力する '+u.label);
    if(kind){const option=make('option',kind==='ranking'?'統合後の作品で順位を調整する':'自分で正しい内容を入力する');option.value='manual';select.append(option);if(kind==='status')for(const [v,label] of Object.entries(statuses)){const option=make('option',label);option.value=v;input.append(option)}else if(!['note','ranking'].includes(kind)){input.type='number';input.min=kind==='episodes'?'0':'1';input.max=kind==='episodes'?'9999':kind==='rating'?'5':'4';input.step='1'}}
    if(kind==='ranking'){
     const membership=make('select');membership.setAttribute('aria-label','評価・視聴状況が重複した場合の採用元');
     for(const [v,text] of [['','所属の重複をどう扱うか選んでください'],['local','重複する評価・視聴状況はこの端末を採用'],['remote','重複する評価・視聴状況は同期先を採用']]){const o=make('option',text);o.value=v;membership.append(o)}
     const edit=make('button','この所属で順位一覧を更新'),lists=make('div');edit.type='button';input.append(make('p','先にバックアップを保存してください。重複していない変更を保持した一覧で、必要な順位だけ調整できます。'),membership,edit,lists);
     membership.addEventListener('change',()=>{choices[u.id]={source:'manual'};lists.replaceChildren();syncControls()});
     edit.addEventListener('click',run(async()=>{
      if(!backed||!membership.value){status.textContent='先にバックアップと所属の採用元を確認してください。';backup.disabled=backed;return}
      const data=await session.flow.previewRanking({reviewToken:review.reviewToken,choices,unitId:u.id,membershipSource:membership.value});
      const save=()=>{choices[u.id]={source:'manual',membershipSource:membership.value,orders:Object.fromEntries(data.map(g=>[g.rating,g.rows.map(r=>r.id)])),...(u.dangerous?{dangerousConfirmed:danger.checked}:{})};busy=false;syncControls()};
      const draw=()=>{lists.replaceChildren();for(const g of data){lists.append(make('p','総合評価 '+g.rating));const list=make('ol');g.rows.forEach((row,i)=>{const li=make('li',row.title+' ');for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const button=make('button',text);button.type='button';button.setAttribute('aria-label',row.title+(delta<0?'を上へ':'を下へ'));button.disabled=i+delta<0||i+delta>=g.rows.length;button.addEventListener('click',()=>{if(busy||closed)return;[g.rows[i],g.rows[i+delta]]=[g.rows[i+delta],g.rows[i]];draw();save()});li.append(button)}list.append(li)});lists.append(list)}};
      draw();save();backup.disabled=true;
     }));
    }
    const update=()=>{if(busy||closed)return;choices[u.id]={source:select.value,...(select.value==='manual'&&kind!=='ranking'?{value:kind==='note'||kind==='status'?input.value:input.value===''?null:Number(input.value)}:{}),...(u.dangerous?{dangerousConfirmed:danger.checked}:{})};if(!select.value)delete choices[u.id];syncControls()};select.addEventListener('change',update);if(kind!=='ranking')input.addEventListener('input',update);
    const picked=make('p');picked.className='anilog-sync-picked';picked.hidden=true;
    body.append(select,picked,input);details.append(body);groups.append(details);controls.set(u.id,{select,input,details,picked});
   }
  }
  choose.disabled=commit.disabled=true;
 }
 async function load(){session?.dispose?.();session=await openFlow(backupSink.save);review=await session.flow.review();if(!review.needsSelection){
   status.textContent='変更内容を安全に照合できました。この端末の同期を再確認しています。';const result=await session.flow.recheckNormally();if(!result.durable)throw Error('UNCONFIRMED');await onComplete(result);closed=true;session?.dispose?.();return;
  }render();}
 backup.addEventListener('click',run(async()=>{await session.flow.saveBackup({reviewToken:review.reviewToken});backed=true;backup.hidden=true;choose.hidden=approveLabel.hidden=false;dangerLabel.hidden=!review.units.some(u=>u.dangerous);status.textContent='バックアップの保存と照合が完了しました。残す内容を選択し、確認へ進んでください。';busy=false;syncControls()}));
 approve.addEventListener('change',syncControls);danger.addEventListener('change',()=>{for(const u of review?.units??[])if(u.dangerous&&choices[u.id])choices[u.id].dangerousConfirmed=danger.checked;syncControls()});
 choose.addEventListener('click',run(async()=>{await session.flow.choose({reviewToken:review.reviewToken,choices,approved:true});for(const c of controls.values())c.select.disabled=c.input.disabled=true;toolbar.querySelectorAll('button').forEach(b=>b.disabled=true);approve.disabled=danger.disabled=true;const deletions=review.units.filter(u=>['record','lifecycle'].includes(u.kind)&&u.options[choices[u.id].source]?.kind==='deleted').length;status.textContent=`選んだ${review.units.length}組をこの内容で同期します。削除を採用する変更は${deletions}件です。元の記録はバックアップに保持しています。`;guide.textContent='手順4/4：まだ同期は実行されていません。内容を確認して「同期を実行する」を押してください。';choose.hidden=approveLabel.hidden=dangerLabel.hidden=true;commit.hidden=false;commit.disabled=false;}));
 commit.addEventListener('click',run(async()=>{const result=await session.flow.commit({reviewToken:review.reviewToken,approved:true});await onComplete(result);status.textContent='この端末の保存と同期を確認しました。ほかの端末への反映は、その端末の受信後に確認してください。';closed=true;session?.dispose?.();}));
 again.addEventListener('click',run(async()=>{if(reloadRequired){onReload();return}approve.disabled=danger.disabled=false;await load()}));
 void run(load)();
 return {close(){if(busy&&!backupSink.pending)return false;closed=true;backupSink.cancel();session?.dispose?.();root.replaceChildren();onExit();return true}};
}
