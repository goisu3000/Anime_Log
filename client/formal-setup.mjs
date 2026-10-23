// Opt-in transition only. Original legacy keys are retained, never deleted.
import {captureLegacyCopy,decodeFormalBackup,canonical} from './formal-storage.mjs';
import {createLegacyCutover} from './legacy-cutover.mjs';
import {digestText} from '../shared/registration-ticket.mjs';
export const SETUP_RECEIPT='anilog-sync-setup-receipt-v1';
export const LOCAL_MODE='anilog-sync-local-mode-v1';
export function createFormalSetup({local,locks,storage,vault,independentVault,deviceKeys,origin}={}){
 const captureOptions={allowEmptySource:true},cutover=createLegacyCutover({storage:local,locks,captureOptions});
 const write=(key,value)=>{local.setItem(key,value);if(local.getItem(key)!==value)throw Error('SETUP_STATE_NOT_DURABLE')};
 const capture=()=>captureLegacyCopy(local,captureOptions);
 const readReceipt=()=>{const raw=local.getItem(SETUP_RECEIPT);if(!raw)return null;const r=JSON.parse(raw);
  if(r.v!==1||r.origin!==origin||!['owner','receiver'].includes(r.role)||!/^[a-f0-9]{64}$/.test(r.sourceDigest)||r.backupSaved!==true||r.oldClientsClosed!==true)throw Error('SETUP_RECEIPT_INVALID');return r};
 async function password(){const saved=await deviceKeys.read();if(saved)return saved;
  if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('SETUP_KEY_MISSING_KEEP_VAULT');
  return deviceKeys.create({emptyVaultConfirmed:true});}
 return Object.freeze({capture,readReceipt,password,
  async begin({backupRaw,backupSaved=false,oldClientsClosed=false,role='owner'}={}){
   if(!['owner','receiver'].includes(role))throw Error('SETUP_ROLE_REQUIRED');
   if(!backupSaved||!oldClientsClosed)throw Error('BACKUP_AND_OLD_CLIENT_RETIREMENT_REQUIRED');
   const frozen=capture();if(backupRaw!==frozen)throw Error('SETUP_SOURCE_CHANGED_DOWNLOAD_BACKUP_AGAIN');
   const receipt={v:1,origin,sourceDigest:await digestText(frozen),backupSaved:true,oldClientsClosed:true,role};
   if(local.getItem(LOCAL_MODE)!==null)throw Error('SETUP_ALREADY_STARTED');
   const existing=readReceipt();if(existing&&canonical(existing)!==canonical(receipt))throw Error('SETUP_RECEIPT_DIFFERS');
   write(SETUP_RECEIPT,JSON.stringify(receipt));
   await cutover.prepare({independentBackupRaw:frozen,backupSaved:true,oldClientsClosed:true});
   return this.resume();
  },
  async resume(){
   const receipt=readReceipt(),mode=local.getItem(LOCAL_MODE);
   if(!receipt||!['preparing','encrypted-local','sync-enabled'].includes(mode))throw Error('SETUP_RECEIPT_REQUIRED');
   const pass=await password();
   if(mode==='preparing'){
    const frozen=capture();if(await digestText(frozen)!==receipt.sourceDigest)throw Error('SETUP_SOURCE_CHANGED_KEEP_ORIGINAL');
    const expected=decodeFormalBackup(frozen),phase=(await vault.inspectReadOnly()).phase;
    if(!storage.ready){if(phase==='EMPTY_LOCKED')await storage.initializeFrozen(JSON.stringify(expected),pass);else await storage.unlock(pass)}
    if(canonical(storage.read())!==canonical(expected))throw Error('SETUP_LOCAL_READBACK_DIFFERS');
    await cutover.commit({receipt:{...receipt,frozen},readEncryptedIndependent:async()=>{const c=independentVault();await c.unlock(pass);return c.readCurrent()}});
   }else if(!storage.ready)await storage.unlock(pass);
   const app=storage.read();
   if(!app.weeklyOptions.__migration?.evidence){
    await storage.saveWeekly({__migration:{...app.weeklyOptions.__migration,evidence:{sourceOrigin:origin,targetOrigin:origin,
     sourceDigest:receipt.sourceDigest,backupDigest:receipt.sourceDigest,independentBackupConfirmed:true,oldClientsClosedConfirmed:true}}});
   }
   return {passphrase:pass,app:storage.read(),syncEnabled:local.getItem(LOCAL_MODE)==='sync-enabled'};
  },
  async confirmEnabled({apiOrigin,boxId,credentialsVerified=false}={}){
   if(credentialsVerified!==true||local.getItem(LOCAL_MODE)!=='encrypted-local')throw Error('SETUP_VERIFICATION_REQUIRED');
   storage.assertSyncHistory({api:apiOrigin,boxId});
   const checkpoint=vault.readSyncCheckpoint();
   // Edits made after the verified first union are a durable pending queue,
   // not a reason to restart setup or overwrite that queue with the baseline.
   if(!checkpoint||checkpoint.serverRevision<1||canonical(checkpoint.snapshot.settings.syncLineage)!==canonical(storage.read().weeklyOptions.__syncLineage))throw Error('SETUP_FIRST_SYNC_NOT_VERIFIED');
   const check=independentVault();await check.unlock(await password());
   if(canonical(check.readCurrent())!==canonical(storage.read())||canonical(check.readSyncCheckpoint())!==canonical(checkpoint))throw Error('SETUP_FINAL_READBACK_DIFFERS');
   write(LOCAL_MODE,'sync-enabled');return {phase:'SYNC_ENABLED_VERIFIED'};
  }
 });
}
