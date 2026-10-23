// Same-origin transition only. Explicit adapter; never fetch another origin.
// The caller must retain the frozen original and independent JSON backup.
import {captureLegacyCopy,decodeFormalBackup,canonical} from './formal-storage.mjs';
import {digestText} from '../shared/registration-ticket.mjs';
const MODE='anilog-sync-local-mode-v1';
export function createLegacyCutover({storage,locks,captureOptions}={}){
 if(!storage?.getItem||!storage?.setItem||!storage?.removeItem||!locks?.request)throw Error('EXPLICIT_LEGACY_STORAGE_AND_LOCK_REQUIRED');
 const exclusive=fn=>locks.request('anilog-v1-write',{mode:'exclusive'},fn);
 const capture=()=>captureLegacyCopy(storage,captureOptions);
 return Object.freeze({
  prepare({independentBackupRaw,backupSaved=false,oldClientsClosed=false}={}){return exclusive(async()=>{
   if(!backupSaved||!oldClientsClosed)throw Error('BACKUP_AND_OLD_CLIENT_RETIREMENT_REQUIRED');
   if(storage.getItem(MODE)!==null)throw Error('CUTOVER_ALREADY_STARTED');
   const frozen=capture();
   if(independentBackupRaw!==frozen)throw Error('INDEPENDENT_FROZEN_BACKUP_REQUIRED');
   // Old guarded writers stop before any encrypted genesis or network request.
   storage.setItem(MODE,'preparing');
   if(capture()!==frozen)throw Error('SOURCE_CHANGED_KEEP_FENCE');
   return {frozen,sourceDigest:await digestText(frozen)};
  })},
  commit({receipt,readEncryptedIndependent}={}){return exclusive(async()=>{
   if(storage.getItem(MODE)!=='preparing'||capture()!==receipt?.frozen||await digestText(receipt.frozen)!==receipt.sourceDigest)
    throw Error('CUTOVER_SOURCE_CHANGED_KEEP_FENCE');
   const expected=decodeFormalBackup(receipt.frozen),actual=await readEncryptedIndependent();
   if(canonical(actual)!==canonical(expected))throw Error('CUTOVER_READBACK_DIFFERS');
   storage.setItem(MODE,'encrypted-local');
   if(storage.getItem(MODE)!=='encrypted-local')throw Error('CUTOVER_MODE_UNCONFIRMED');
   // Original keys are deliberately retained. SYNC ON is a separate action.
   return {phase:'LOCAL_ENCRYPTED_CUTOVER_VERIFIED',syncEnabled:false};
  })},
  // Only before encrypted activation, with the exact original still present.
  abortBeforeCommit(receipt){return exclusive(async()=>{
   if(storage.getItem(MODE)!=='preparing'||capture()!==receipt?.frozen||await digestText(receipt.frozen)!==receipt.sourceDigest)
    throw Error('CUTOVER_ABORT_NEEDS_SOURCE_REVIEW');
   storage.removeItem(MODE);return {phase:'LEGACY_OFF_RETAINED'};
  })}
 });
}
