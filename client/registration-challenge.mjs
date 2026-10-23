export function requestRegistrationChallenge({apiOrigin,binding,container,events=globalThis,document=globalThis.document,timeoutMs=300000}={}){
 const api=new URL(apiOrigin);
 if(api.protocol!=='https:'||api.origin!==apiOrigin||api.origin===globalThis.location?.origin||!/^[a-f0-9]{64}$/.test(binding))throw Error('CHALLENGE_SCOPE');
 return new Promise((resolve,reject)=>{
  const frame=document.createElement('iframe');frame.title='同期開始の不正利用防止確認';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='no-referrer';
  frame.src=apiOrigin+'/registration-challenge#'+binding;
  let timer;const cleanup=()=>{clearTimeout(timer);events.removeEventListener('message',receive);frame.remove()};
  const receive=event=>{if(event.origin!==apiOrigin||event.source!==frame.contentWindow||event.data?.binding!==binding)return;
   if(event.data.type==='ani-challenge'&&typeof event.data.token==='string'&&event.data.token.length>0&&event.data.token.length<=2048){cleanup();resolve(event.data.token)}
   else if(event.data.type==='ani-challenge-error'){cleanup();reject(Error('CHALLENGE_UNAVAILABLE'))}};
  events.addEventListener('message',receive);timer=setTimeout(()=>{cleanup();reject(Error('CHALLENGE_TIMEOUT_KEEP_LOCAL_RECORDS'))},timeoutMs);
  container.replaceChildren(frame);
 });
}
