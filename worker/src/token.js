// Short-lived signed specification_token (ADR-014). Bridges Stage 1 -> Stage 2 so the client cannot
// fabricate or alter a specification: Stage 2 only trusts what this Worker signed, and the embedded
// snapshot versions force both stages onto the same data.
//
// Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload)).
import { hmacB64url, timingSafeEqual, b64urlEncode, b64urlDecode } from './hmac.js';
import { TOKEN_TTL_SEC } from './version.js';

export async function signToken(secret, claims, nowSec = Math.floor(Date.now() / 1000), ttl = TOKEN_TTL_SEC) {
  const payload = { ...claims, iat: nowSec, exp: nowSec + ttl };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacB64url(secret, body);
  return body + '.' + sig;
}

export async function verifyToken(secret, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return { ok: false, reason: 'malformed' };
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  const expect = await hmacB64url(secret, body);
  if (!timingSafeEqual(sig, expect)) return { ok: false, reason: 'bad_signature' };
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { return { ok: false, reason: 'malformed' }; }
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
