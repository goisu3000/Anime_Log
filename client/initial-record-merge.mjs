// First pairing of independent records is an explicit union, never replacement.
// Reuse the existing field/tombstone conflict rules; do not invent a common past.
import {blankSnapshot,mergeSnapshots,validateSnapshot} from '../sync-core.mjs';
import {appToSnapshot} from './app-bridge.mjs';
import {validateFormalApp} from './formal-storage.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';
export function planInitialRecordMerge({localApp,remoteSnapshot,apiOrigin,boxId}={}){
 validateFormalApp(localApp);validateSnapshot(remoteSnapshot);
 if(localApp.weeklyOptions.__syncLineage||localApp.weeklyOptions.__registrationPending)throw Error('ALREADY_CONNECTED_LOCAL_RECORDS_NEED_REVIEW');
 const evidence=localApp.weeklyOptions.__migration?.evidence;
 if(localApp.weeklyOptions.__migration?.history==='unknown'&&(!evidence?.independentBackupConfirmed||!evidence.oldClientsClosedConfirmed))
  throw Error('LEGACY_CUTOVER_EVIDENCE_REQUIRED');
 if(remoteSnapshot.settings.syncLineage){const line=checkLineage(remoteSnapshot.settings.syncLineage);
  if(line.api!==apiOrigin||line.boxId!==boxId)throw Error('INITIAL_REMOTE_LINEAGE_MISMATCH')}
 const result=mergeSnapshots(blankSnapshot(),appToSnapshot(localApp),remoteSnapshot);
 return result.ok?{ok:true,snapshot:result.merged}:{ok:false,conflicts:result.conflicts};
}
