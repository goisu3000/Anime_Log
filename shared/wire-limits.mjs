/* ANI:LOG sync v3.1 wire contract. Conservative LOCAL/STAGING prototype limits.
 * Shared by the client and the Worker. Not a substitute for D1 storage budgets.
 */
export const MAX_BODY_BYTES = 256_000;
export const MAX_CIPHER_CHARS = 220_000;
export const MAX_IV_CHARS = 16;
const encoder = new TextEncoder();
export function assessEncryptedPut({baseRevision,payload}={}) {
  // Client preflight. Server performs its own full shape and auth validation.
  if (!Number.isSafeInteger(baseRevision)||baseRevision<0||!payload||typeof payload!=='object'||Array.isArray(payload))
    return {ok:false,reason:'invalid_envelope',bytes:0,maxBytes:MAX_BODY_BYTES};
  if (!Number.isSafeInteger(payload.revision)||payload.revision!==baseRevision+1||payload.v!==1||
      typeof payload.iv!=='string'||payload.iv.length!==MAX_IV_CHARS||
      typeof payload.data!=='string'||!/^[A-Za-z0-9_-]+$/.test(payload.data))
    return {ok:false,reason:'invalid_envelope',bytes:0,maxBytes:MAX_BODY_BYTES};
  const bytes=encoder.encode(JSON.stringify({baseRevision,payload})).length;
  if (payload.data.length>MAX_CIPHER_CHARS)
    return {ok:false,reason:'ciphertext_too_large',bytes,maxBytes:MAX_BODY_BYTES,cipherChars:payload.data.length,maxCipherChars:MAX_CIPHER_CHARS};
  if(bytes>MAX_BODY_BYTES)
    return {ok:false,reason:'request_too_large',bytes,maxBytes:MAX_BODY_BYTES};
  return {ok:true,reason:null,bytes,maxBytes:MAX_BODY_BYTES,cipherChars:payload.data.length,maxCipherChars:MAX_CIPHER_CHARS};
}
