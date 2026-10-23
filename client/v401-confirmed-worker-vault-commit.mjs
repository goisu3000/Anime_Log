/* ANI:LOG v4.01 SYNTHETIC ONLY, SYNC OFF.
 * Safe handoff from the existing authenticated V30EncryptedClient transport
 * into the v401 append-only encrypted WAL. A successful sync result alone is
 * insufficient: fetch and decrypt the server state once more before WAL commit.
 * The vault is the durable source of truth, NOT the volatile transport client.
 */
import {decryptSnapshot,validateSnapshot} from '../sync-core.mjs';
const clone=structuredClone;
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':
 x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
export async function confirmTransportAndCommitVault({vault,transport,syncResult,expectedVaultRevision}={}){
 if(!vault?.commitConfirmedSync||!transport?.request||!transport?.checkpoint||!transport?.snapshot)
  throw Error('V401_VALID_SYNTHETIC_TRANSPORT_AND_VAULT_REQUIRED');
 if(syncResult?.status!=='synced'||!Number.isSafeInteger(syncResult.revision)||syncResult.revision<1)
  throw Error('V401_UNCONFIRMED_ACK_NO_VAULT_WRITE');
 const point=transport.checkpoint(),expected=transport.snapshot();
 if(point.revision!==syncResult.revision||stable(point.baseline)!==stable(expected)||stable(point.local)!==stable(expected))
  throw Error('V401_UNCONFIRMED_TRANSPORT_STATE');
 validateSnapshot(expected);
 // Finish remote I/O before entering the durable local transaction. Network
 // failure leaves the local WAL active and writable, with its old checkpoint.
 const response=await transport.request('GET');
 const {revision,payload}=response.data||{};
 if(!Number.isSafeInteger(revision)||revision!==syncResult.revision||!payload)throw Error('V401_REMOTE_NOT_COMMITTED');
 const snapshot=await decryptSnapshot(payload,{masterKey:transport.masterKey,boxId:transport.boxId,revision});
 if(stable(snapshot)!==stable(expected))throw Error('V401_REMOTE_SNAPSHOT_MISMATCH');
 if(vault.readRevision&&vault.readRevision()!==expectedVaultRevision)throw Error('V401_LOCAL_CHANGED_DURING_READBACK');
 return vault.commitConfirmedSync({expectedVaultRevision,ackRevision:syncResult.revision,expectedSyncedSnapshot:clone(expected),
  readBack:async()=>({revision,snapshot:clone(snapshot)})});
}
