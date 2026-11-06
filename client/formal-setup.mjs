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
  if(r.v===2){if(r.origin!==origin||r.initialization!=='empty-encrypted'||!['owner','receiver'].includes(r.role))throw Error('SETUP_RECEIPT_INVALID');return r}
  if(r.v!==1||r.origin!==origin||!['owner','receiver'].includes(r.role)||!/^[a-f0-9]{64}$/.test(r.sourceDigest)||r.backupSaved!==true||r.oldClientsClosed!==true)throw Error('SETUP_RECEIPT_INVALID');return r};
 async function password(){const saved=await deviceKeys.read();if(saved)return saved;
  if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('SETUP_KEY_MISSING_KEEP_VAULT');
  return deviceKeys.create({emptyVaultConfirmed:true});}
 const emptyApp=()=>({records:{},tombstones:{},weeklyOptions:{open:false,statuses:['watching']}});
 // Fresh encrypted-local setup is not a migration or a network approval.
 // Refuse any existing plaintext records; never copy, erase or reinterpret them.
 const assertNoPlainRecords=()=>{
  const raw=local.getItem('anilog-v1');if(raw===null)return;
  let x;try{x=JSON.parse(raw)}catch{throw Error('LOCAL_START_EXISTING_RECORDS')}
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length)throw Error('LOCAL_START_EXISTING_RECORDS');
 };
 return Object.freeze({capture,readReceipt,password,
  async initializeLocal({role='owner'}={}){
   if(!['owner','receiver'].includes(role))throw Error('SETUP_ROLE_REQUIRED');
   if(local.getItem(LOCAL_MODE)!==null)throw Error('SETUP_ALREADY_STARTED');
   await locks.request('anilog-v1-write',{mode:'exclusive'},async()=>{
    if(local.getItem(LOCAL_MODE)!==null){
     const concurrent=readReceipt();
     if(concurrent?.v!==2||concurrent.role!==role)throw Error('SETUP_ALREADY_STARTED');
     return;
    }
    assertNoPlainRecords();
    const previous=readReceipt();
    if(previous){if(previous.v!==2||previous.role!==role)throw Error('SETUP_RECEIPT_DIFFERS')}
    else{
     if((await vault.inspectReadOnly()).phase!=='EMPTY_LOCKED')throw Error('LOCAL_START_EXISTING_VAULT');
     write(SETUP_RECEIPT,JSON.stringify({v:2,origin,role,initialization:'empty-encrypted'}));
    }
    write(LOCAL_MODE,'preparing');
   });
   return this.resume();
  },
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
   if(receipt.v===2)return locks.request('anilog-encrypted-local-resume',{mode:'exclusive'},async()=>{
    const currentMode=local.getItem(LOCAL_MODE);
    if(!['preparing','encrypted-local','sync-enabled'].includes(currentMode))throw Error('SETUP_RECEIPT_REQUIRED');
    if(currentMode==='preparing')assertNoPlainRecords();
    const pass=await password();
    if(!storage.ready){
     if(currentMode==='preparing'&&(await vault.inspectReadOnly()).phase==='EMPTY_LOCKED')await storage.initializeFrozen(JSON.stringify(emptyApp()),pass);
     else await storage.unlock(pass);
    }
    if(currentMode==='preparing'){
     const check=independentVault();await check.unlock(pass);
     if(canonical(storage.read())!==canonical(emptyApp())||canonical(check.readCurrent())!==canonical(emptyApp())||vault.readRevision()!==0||check.readRevision()!==0)throw Error('LOCAL_START_READBACK_DIFFERS');
     write(LOCAL_MODE,'encrypted-local');
    }
    return {passphrase:pass,app:storage.read(),syncEnabled:local.getItem(LOCAL_MODE)==='sync-enabled'};
   });
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
   if(credentialsVerified!==true||!['encrypted-local','sync-enabled'].includes(local.getItem(LOCAL_MODE)))throw Error('SETUP_VERIFICATION_REQUIRED');
   storage.assertSyncHistory({api:apiOrigin,boxId});
   const checkpoint=vault.readSyncCheckpoint();
   // Edits made after the verified first union are a durable pending queue,
   // not a reason to restart setup or overwrite that queue with the baseline.
   if(!checkpoint||checkpoint.serverRevision<1||canonical(checkpoint.snapshot.settings.syncLineage)!==canonical(storage.read().weeklyOptions.__syncLineage))throw Error('SETUP_FIRST_SYNC_NOT_VERIFIED');
   const check=independentVault();await check.unlock(await password());
   if(canonical(check.readCurrent())!==canonical(storage.read())||canonical(check.readSyncCheckpoint())!==canonical(checkpoint))throw Error('SETUP_FINAL_READBACK_DIFFERS');
   if(local.getItem(LOCAL_MODE)!=='sync-enabled')write(LOCAL_MODE,'sync-enabled');
   return {phase:'SYNC_ENABLED_VERIFIED'};
  }
 });
}
