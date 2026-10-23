// User-supplied files only. No reads from another origin or legacy storage keys.
import {decodeFormalBackup,canonical} from './formal-storage.mjs';
import {digestText} from '../shared/registration-ticket.mjs';
export async function prepareFormalMigration({sourceRaw,backupRaw,sourceOrigin,targetOrigin,independentBackupConfirmed=false,oldClientsClosedConfirmed=false}={}){
 const a=new URL(sourceOrigin),b=new URL(targetOrigin);
 const local=b.protocol==='http:'&&b.hostname==='127.0.0.1';
 if(a.origin!==sourceOrigin||b.origin!==targetOrigin||a.origin===b.origin||a.protocol!=='https:'||(!local&&b.protocol!=='https:'))throw Error('SEPARATE_HTTPS_ORIGIN_REQUIRED');
 if(independentBackupConfirmed!==true||oldClientsClosedConfirmed!==true)throw Error('BACKUP_AND_LEGACY_CUTOVER_CONFIRMATION_REQUIRED');
 if(typeof sourceRaw!=='string'||typeof backupRaw!=='string'||sourceRaw.length>12000000||sourceRaw!==backupRaw)throw Error('INDEPENDENT_BACKUP_DIFFERS');
 const app=decodeFormalBackup(sourceRaw),backup=decodeFormalBackup(backupRaw);
 if(canonical(app)!==canonical(backup))throw Error('MIGRATION_COPY_DIFFERS');
 if(app.weeklyOptions.__syncLineage||app.weeklyOptions.__registrationPending)throw Error('EXISTING_SYNC_LINEAGE_NEEDS_SEPARATE_REVIEW');
 const sourceDigest=await digestText(sourceRaw);
 app.weeklyOptions.__migration={...app.weeklyOptions.__migration,
  history:app.weeklyOptions.__migration?.history==='unknown'?'unknown':'provided',
  evidence:{sourceOrigin,targetOrigin,sourceDigest,backupDigest:sourceDigest,independentBackupConfirmed:true,oldClientsClosedConfirmed:true}};
 return {app,receipt:{sourceDigest,backupDigest:sourceDigest,sourceOrigin,targetOrigin,recordCount:Object.keys(app.records).length,history:app.weeklyOptions.__migration.history}};
}
