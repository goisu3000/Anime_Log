import {createConflictResolution} from './conflict-resolution.mjs';
import {mountConflictResolutionView} from './conflict-resolution-view.mjs';
// Existing dialog and existing connection only. No credentials leave this closure.
export function installConflictRecovery({root,locks,scope,begin,end,complete,assertContext,getTransport,vault,isPaused,isQuiescent,isEligible=()=>true}={}){
 const doc=root.ownerDocument,dialog=root.closest('dialog'),entry=doc.createElement('button'),panel=doc.createElement('section');
 entry.type='button';entry.textContent='不一致を確認';entry.dataset.simple='resolve-conflict';entry.hidden=true;panel.hidden=true;
 // The retry button may have been moved into the primary-action row.
 // Keep the trigger beside it, but mount the review as a DIRECT child of the
 // sync dialog body. Otherwise hiding the ordinary action row also hides the
 // review itself, leaving only the "checking" notice on screen.
 root.querySelector('[data-simple="retry"]').after(entry);
 root.append(panel);
 let view,release,original=[],visibility=[],active=false,starting=false,held=false;
 const restore=()=>{for(const [element,disabled] of original)element.disabled=disabled;original=[];for(const [element,hidden] of visibility)element.hidden=hidden;visibility=[];delete dialog.dataset.conflictBusy;const close=doc.getElementById('anilogSyncDialogClose');if(close)close.disabled=false};
 const finish=()=>{restore();active=false;panel.hidden=true;release?.();release=null};
 // A backup download/readback is cancelable without changing the WAL.
 // Reuse the dialog's existing Close button rather than adding a second
 // "cancel backup" control. Commit/selection remain non-interruptible.
 const busy=value=>{const locked=value===true;dialog.dataset.conflictBusy=locked?'true':'false';const close=doc.getElementById('anilogSyncDialogClose');if(close)close.disabled=locked};
 entry.addEventListener('click',async()=>{
  if(active||starting||!isEligible())return;starting=true;
  try{
   let yes,no;const ready=new Promise((resolve,reject)=>{yes=resolve;no=reject});
   void locks.request('anilog-conflict-resolution-page'+scope,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){no(Error('OTHER_REVIEW_OPEN'));return}held=true;const wait=new Promise(resolve=>{release=resolve});yes();await wait;held=false}).catch(()=>no(Error('LOCK_REQUIRED')));
   await ready;active=true;await begin();assertContext();
   original=[...root.querySelectorAll('button,input,select')].map(element=>[element,element.disabled]);for(const [element] of original)element.disabled=true;
   // Keep the current safety notice, but show only the active review's
   // controls. Restore the exact normal visibility on completion/cancel.
   visibility=[...root.children].filter(element=>element!==panel&&element.tagName!=='SUMMARY'&&element!==root.querySelector('[data-simple="status"]')).map(element=>[element,element.hidden]);
   for(const [element] of visibility)element.hidden=true;
   panel.hidden=false;
   view=mountConflictResolutionView({root:panel,onBusy:busy,onReload:()=>doc.defaultView.location.reload(),openFlow:async saveAndReadBackBackup=>{
    if(vault.getState()!=='ACTIVE')throw Error('RELOAD_REQUIRED');assertContext();const transport=await getTransport();assertContext();
    const flow=createConflictResolution({vault,transport,isPaused,isQuiescent,saveAndReadBackBackup,withQuiesced:fn=>locks.request('anilog-conflict-resolution-operation'+scope,{mode:'exclusive'},async()=>{if(!held)throw Error('REVIEW_CLOSED');assertContext();return fn()})});
    return {flow,dispose(){transport.masterKey.fill(0)}};
   },onComplete:async result=>{
    if(!result.durable)throw Error('UNCONFIRMED');
    const status=root.querySelector('[data-simple="status"]');
    try{
     const resumed=await complete(result);
     finish();
     if(status)status.textContent=resumed?.automaticRestored===false
      ?'今回の変更はこの端末と同期先に保存しました。ただし自動同期の再開に失敗しています。記録を消さずに「再同期」で接続を確認してください。'
      :'競合を解決し、この端末と同期先への保存を確認しました。ほかの端末には受信後に反映されます。';
    }catch{
     // The commit already passed local and remote readback. Do not offer a
     // second commit of the same choice or describe it as an unsaved change.
     finish();
     if(status)status.textContent='今回の変更はこの端末と同期先に保存しました。画面の更新・自動同期の復帰を確認できなかったため、記録を消さずにページを再読み込みしてください。';
    }
   },onExit:()=>{finish();end()}});
   // The opening phase has finished. Do not leave the top-level notice
   // claiming an endless background check while the review is on screen.
   const notice=root.querySelector('[data-simple="status"]');
   if(notice)notice.textContent='不一致のある記録の確認画面を開きました。下の案内に従って内容を確認してください。記録はまだ変更していません。';
  }catch{finish();end();const status=root.querySelector('[data-simple="status"]');if(status)status.textContent='記録を保持して一時停止しています。ほかのタブを閉じ、同期画面からもう一度確認してください。';}
  finally{starting=false}
 });
 dialog.addEventListener('cancel',event=>{if(dialog.dataset.conflictBusy==='true')event.preventDefault()});
 dialog.addEventListener('close',()=>{if(active)view?.close()});
 return Object.freeze({get active(){return active}});
}
