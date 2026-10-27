import {createConflictResolution} from './conflict-resolution.mjs';
import {mountConflictResolutionView} from './conflict-resolution-view.mjs';
// Existing dialog and existing connection only. No credentials leave this closure.
export function installConflictRecovery({root,locks,scope,begin,end,complete,assertContext,getTransport,vault,isPaused,isQuiescent,isEligible=()=>true}={}){
 const doc=root.ownerDocument,dialog=root.closest('dialog'),entry=doc.createElement('button'),panel=doc.createElement('section');
 entry.type='button';entry.textContent='変更内容を選んで解決する';entry.dataset.simple='resolve-conflict';entry.hidden=!isPaused()||!isEligible();panel.hidden=true;
 root.querySelector('[data-simple="retry"]').after(entry,panel);
 let view,release,original=[],active=false,starting=false,held=false;
 const restore=()=>{for(const [element,disabled] of original)element.disabled=disabled;original=[];delete dialog.dataset.conflictBusy;const close=doc.getElementById('anilogSyncDialogClose');if(close)close.disabled=false};
 const finish=()=>{restore();active=false;panel.hidden=true;release?.();release=null};
 const busy=value=>{dialog.dataset.conflictBusy=value?'true':'false';const close=doc.getElementById('anilogSyncDialogClose');if(close)close.disabled=value};
 entry.addEventListener('click',async()=>{
  if(active||starting||!isEligible())return;starting=true;
  try{
   let yes,no;const ready=new Promise((resolve,reject)=>{yes=resolve;no=reject});
   void locks.request('anilog-conflict-resolution-page'+scope,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){no(Error('OTHER_REVIEW_OPEN'));return}held=true;const wait=new Promise(resolve=>{release=resolve});yes();await wait;held=false}).catch(()=>no(Error('LOCK_REQUIRED')));
   await ready;active=true;await begin();assertContext();
   original=[...root.querySelectorAll('button,input,select')].map(element=>[element,element.disabled]);for(const [element] of original)element.disabled=true;
   panel.hidden=false;
   view=mountConflictResolutionView({root:panel,onBusy:busy,onReload:()=>doc.defaultView.location.reload(),openFlow:async saveAndReadBackBackup=>{
    if(vault.getState()!=='ACTIVE')throw Error('RELOAD_REQUIRED');assertContext();const transport=await getTransport();assertContext();
    const flow=createConflictResolution({vault,transport,isPaused,isQuiescent,saveAndReadBackBackup,withQuiesced:fn=>locks.request('anilog-conflict-resolution-operation'+scope,{mode:'exclusive'},async()=>{if(!held)throw Error('REVIEW_CLOSED');assertContext();return fn()})});
    return {flow,dispose(){transport.masterKey.fill(0)}};
   },onComplete:async result=>{if(!result.durable)throw Error('UNCONFIRMED');finish();await complete(result)},onExit:()=>{finish();end()}});
  }catch{finish();end();const status=root.querySelector('[data-simple="status"]');if(status)status.textContent='記録を保持して一時停止しています。ほかのタブを閉じ、同期画面からもう一度確認してください。';}
  finally{starting=false}
 });
 dialog.addEventListener('cancel',event=>{if(dialog.dataset.conflictBusy==='true')event.preventDefault()});
 dialog.addEventListener('close',()=>{if(active)view?.close()});
 return Object.freeze({get active(){return active}});
}
