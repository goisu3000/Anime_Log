/* ANI:LOG v4.00: READ-ONLY bridge between verified local encrypted WAL and
 * the existing sync-core v1 wire format. Never persists, posts, or applies merges.
 * No old anilog-v1 access; synthetic fixtures only at the current integration stage.
 */
import {appToSnapshot,previewAppSync,snapshotToApp} from './app-bridge.mjs';
import {validateSnapshot} from '../sync-core.mjs';
const clone=structuredClone;
const safe=x=>x&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':
 safe(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
function checkedVault(vault){
 if(!vault||typeof vault.readCurrent!=='function')throw Error('V400_READ_ONLY_VAULT_REQUIRED');
 const raw=vault.readCurrent();
 if(!safe(raw)||!safe(raw.records)||!safe(raw.tombstones)||!safe(raw.weeklyOptions))throw Error('V400_BAD_VAULT_SNAPSHOT');
 const projected=appToSnapshot(raw);
 const reversed=snapshotToApp(projected,{weeklyOptions:raw.weeklyOptions});
 if(!equal(raw,reversed))throw Error('V400_LOSSLESS_ROUNDTRIP_FAILED');
 return {raw:clone(raw),snapshot:projected};
}
export function readEncryptedVaultForSync(vault){
 const {snapshot}=checkedVault(vault);
 return clone(snapshot);
}
export function previewEncryptedVaultMerge(vault,{baseline,remote}={}){
 validateSnapshot(baseline);validateSnapshot(remote);
 const {raw,snapshot}=checkedVault(vault);
 const result=previewAppSync({baseline,remote,localRecords:raw.records,
  localTombstones:raw.tombstones,localWeeklyOptions:raw.weeklyOptions});
 // The preview MUST refer to the same independently read source. This is not
 // permission to apply it or mark a remote ACK as confirmed.
 if(!equal(result.local,snapshot))throw Error('V400_LOCAL_CHANGED_DURING_PREVIEW');
 if(result.ok){
  const next=appToSnapshot(result.candidate);
  if(!equal(next,result.merged))throw Error('V400_LOSSLESS_MERGE_PREVIEW_FAILED');
 }
 return {kind:'read-only-preview',ok:result.ok,
  conflicts:clone(result.conflicts),local:snapshot,
  ...(result.ok?{candidate:clone(result.candidate),merged:clone(result.merged),changes:clone(result.changes)}:{})};
}
