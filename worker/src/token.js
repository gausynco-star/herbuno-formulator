// Short-lived signed specification_token (ADR-014). Bridges Stage 1 -> Stage 2 so the client cannot
// fabricate or alter a specification. Signed with SPECIFICATION_TOKEN_SECRET (SEPARATE from the App
// Proxy secret). The embedded snapshot versions force both stages onto the same data.
//
// Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload)). EXACTLY two parts.
//
// Replay policy (OWNER DECISION, recorded in README): replay within the 5-minute TTL is ACCEPTED —
// procurement is read-only, so a jti/replay store adds complexity without meaningful benefit now.
import { hmacB64url, hmacVerifyB64url, b64urlEncode, b64urlDecode } from './hmac.js';
import { TOKEN_TTL_SEC, TOKEN_VERSION, IAT_SKEW_SEC } from './version.js';

export async function signToken(secret, claims, nowSec = Math.floor(Date.now() / 1000), ttl = TOKEN_TTL_SEC) {
  const payload = { v: TOKEN_VERSION, ...claims, iat: nowSec, exp: nowSec + ttl };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacB64url(secret, body);
  return body + '.' + sig;
}

// Structural verification only: signature, exact shape, v, iat/exp. CLAIM VALUES (product/role/cid/
// selected_format/versions) are re-validated by the caller against live state — never trusted here.
export async function verifyToken(secret, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };      // reject extra segments
  const [body, sig] = parts;
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  if (!(await hmacVerifyB64url(secret, body, sig))) return { ok: false, reason: 'bad_signature' };
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { return { ok: false, reason: 'malformed' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: 'bad_token_version' };
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' };
  if (payload.exp < payload.iat) return { ok: false, reason: 'bad_expiry' };      // exp must be >= iat (FIX 4)
  if (payload.iat > nowSec + IAT_SKEW_SEC) return { ok: false, reason: 'iat_in_future' };
  if (payload.exp < nowSec) return { ok: false, reason: 'expired' };
  if (payload.exp - payload.iat > TOKEN_TTL_SEC + IAT_SKEW_SEC) return { ok: false, reason: 'ttl_too_long' };
  return { ok: true, payload };
}
