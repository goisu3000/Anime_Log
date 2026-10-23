/* ANI:LOG v4.03. Restart an authenticated existing transport from the
 * independently verified encrypted WAL checkpoint. Never infer baseline
 * from current records: offline edits must remain distinct from server ACK.
 * Credentials are supplied by the caller; this module does not persist them.
 */
import {V30EncryptedClient} from './v30-encrypted-sync-client.mjs';
import {readEncryptedVaultForSync} from './v400-encrypted-vault-sync-readonly-bridge.mjs';
import {validateSnapshot} from '../sync-core.mjs';
import {checkLineage} from '../shared/sync-lineage.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function restoreTransportFromEncryptedVault({vault,fetcher,apiRoot,origin,boxId,device,masterKey}={}){
 if(!vault?.readSyncCheckpoint||!vault?.readRevision||!vault?.readCurrent)throw Error('V403_UNLOCKED_VAULT_REQUIRED');
 const cp=vault.readSyncCheckpoint();
 if(!cp||!Number.isSafeInteger(cp.serverRevision)||cp.serverRevision<1||!cp.snapshot)
  throw Error('V403_CONFIRMED_CHECKPOINT_REQUIRED');
 validateSnapshot(cp.snapshot);
 if(cp.snapshot.settings.syncLineage){const lineage=checkLineage(cp.snapshot.settings.syncLineage);
  if(lineage.api!==apiRoot||lineage.boxId!==boxId)throw Error('SYNC_LINEAGE_CONNECTION_MISMATCH')}
 const local=readEncryptedVaultForSync(vault);
 // Strongly typed constructor validates device credentials and key as well.
 const transport=new V30EncryptedClient({fetcher,apiRoot,origin,boxId,device,masterKey,
  local,baseline:cp.snapshot,revision:cp.serverRevision});
 if(!equal(transport.snapshot(),local)||!equal(transport.checkpoint().baseline,cp.snapshot))
  throw Error('V403_TRANSPORT_HYDRATION_FAILED');
 return transport;
}
