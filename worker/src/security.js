// Request-security controls (ADR-014 §2). Signature + timestamp + input allow-list + rate limit.
import { hmacHex, timingSafeEqual } from './hmac.js';
import { RATE } from './version.js';

// ---- 1. Shopify App Proxy signature ----
// Shopify signs the QUERY params (sorted by key, `key=value` concatenated with NO separator) with the
// app's shared secret, HMAC-SHA256 hex, in the `signature` param. Duplicate keys join with ','.
// HONEST NOTE (ADR-014): this proves Shopify forwarded an untampered request; it does NOT prove the
// caller is the Formulator UI, and anonymous proxy calls are supported. Hence the other controls.
function proxyMessage(searchParams) {
  const map = new Map();
  for (const [k, v] of searchParams) {
    if (k === 'signature') continue;
    map.set(k, map.has(k) ? map.get(k) + ',' + v : v);
  }
  return [...map.keys()].sort().map(k => k + '=' + map.get(k)).join('');
}
export async function signProxyQuery(paramsObj, secret) {
  const sp = new URLSearchParams(paramsObj);
  return hmacHex(secret, proxyMessage(sp));
}
export async function verifyProxyQuery(searchParams, secret) {
  const sig = searchParams.get('signature');
  if (!sig) return { ok: false, reason: 'no_signature' };
  const expect = await hmacHex(secret, proxyMessage(searchParams));
  return { ok: timingSafeEqual(sig, expect), reason: 'signature' };
}

// ---- 2. Timestamp freshness (replay resistance) ----
export function checkTimestamp(tsSeconds, nowMs, windowMs) {
  const t = Number(tsSeconds) * 1000;
  if (!Number.isFinite(t)) return false;
  return Math.abs(nowMs - t) <= windowMs;
}

// ---- 3. Strict input allow-list ----
// Exactly: product (known), role (known for that product), botanical (one term, <=80 chars).
// session_id optional (opaque string). Anything else — arrays, extra keys, wildcards — is rejected.
export function validateSpecInput(body, engine) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_body';
  for (const k of Object.keys(body)) if (!['product', 'role', 'botanical', 'session_id'].includes(k)) return 'unexpected_field:' + k;
  if (typeof body.product !== 'string' || typeof body.role !== 'string') return 'missing_product_role';
  if (typeof body.botanical !== 'string' || !body.botanical.trim() || body.botanical.length > 80) return 'bad_botanical';
  if (body.session_id !== undefined && typeof body.session_id !== 'string') return 'bad_session';
  if (!engine.ladder.has(body.product + '|' + body.role)) return 'unknown_product_role';
  return null;
}
export function validateProcurementInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_body';
  for (const k of Object.keys(body)) if (!['specification_token', 'session_id'].includes(k)) return 'unexpected_field:' + k; // reject client-fabricated spec
  if (typeof body.specification_token !== 'string' || !body.specification_token) return 'missing_token';
  if (body.session_id !== undefined && typeof body.session_id !== 'string') return 'bad_session';
  return null;
}

// ---- 4. Rate limit (per IP + per session) ----
// In-memory, MODULE SCOPE => per-isolate only. Real cross-isolate limiting needs Durable Objects or a
// KV/counter service — documented as Step-3+ hardening in README. Windows are simple fixed buckets.
const counters = new Map();   // key -> { start, n }
const uniqSets = new Map();   // session -> { start, set }
export function __resetRate() { counters.clear(); uniqSets.clear(); }

function bump(key, windowMs, limit, now) {
  let e = counters.get(key);
  if (!e || now - e.start >= windowMs) { e = { start: now, n: 0 }; counters.set(key, e); }
  e.n++;
  return e.n <= limit;
}
export function rateLimit(ip, session, botanical, now, cfg = RATE) {
  if (!bump('min:' + ip, 60_000, cfg.perMin, now)) return { ok: false, reason: 'per_minute' };
  if (!bump('hour:' + ip, 3_600_000, cfg.perHour, now)) return { ok: false, reason: 'per_hour' };
  if (!bump('day:' + ip, 86_400_000, cfg.perDay, now)) return { ok: false, reason: 'per_day' };
  if (botanical != null) {
    let e = uniqSets.get(session);
    if (!e || now - e.start >= 3_600_000) { e = { start: now, set: new Set() }; uniqSets.set(session, e); }
    e.set.add(String(botanical).toLowerCase().trim());
    if (e.set.size > cfg.uniqBotanicalsPerHour) return { ok: false, reason: 'unique_botanicals_per_hour' };
  }
  return { ok: true };
}
