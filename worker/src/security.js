// Request-security controls (ADR-014 §2). Signature + timestamp + input allow-list + a cheap
// per-isolate rate pre-check. The AUTHORITATIVE limiter is the Durable Object in rate_limiter_do.js;
// this module is only the first, best-effort layer.
import { hmacHex, hmacVerifyHex } from './hmac.js';
import { RATE, SESSION_ID_RE } from './version.js';

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
  const ok = await hmacVerifyHex(secret, proxyMessage(searchParams), sig); // constant-time platform verify
  return { ok, reason: 'signature' };
}

// ---- 2. Timestamp freshness (replay resistance) ----
export function checkTimestamp(tsSeconds, nowMs, windowMs) {
  const t = Number(tsSeconds) * 1000;
  if (!Number.isFinite(t)) return false;
  return Math.abs(nowMs - t) <= windowMs;
}

// ---- 3. Strict input allow-list ----
// Exactly: product (known), role (known for that product), botanical (one term, <=80 chars).
// session_id optional but UNTRUSTED: bounded length + charset, never used as a limiter key.
function validSession(v) { return v === undefined || (typeof v === 'string' && SESSION_ID_RE.test(v)); }
export function validateSpecInput(body, engine) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_body';
  for (const k of Object.keys(body)) if (!['product', 'role', 'botanical', 'session_id'].includes(k)) return 'unexpected_field';
  if (typeof body.product !== 'string' || typeof body.role !== 'string') return 'missing_product_role';
  if (typeof body.botanical !== 'string' || !body.botanical.trim() || body.botanical.length > 80) return 'bad_botanical';
  if (!validSession(body.session_id)) return 'bad_session';
  if (!engine.ladder.has(body.product + '|' + body.role)) return 'unknown_product_role';
  return null;
}
export function validateProcurementInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_body';
  for (const k of Object.keys(body)) if (!['specification_token', 'session_id'].includes(k)) return 'unexpected_field'; // reject client-fabricated spec
  if (typeof body.specification_token !== 'string' || !body.specification_token) return 'missing_token';
  if (!validSession(body.session_id)) return 'bad_session';
  return null;
}

// ---- 4a. Per-isolate rate PRE-CHECK (cheap first layer only) ----
// Bounded + swept so it cannot grow unbounded. NOT the primary defence (see rate_limiter_do.js).
const counters = new Map();
const uniqSets = new Map();
const MAX_KEYS = 20_000;
export function __resetRate() { counters.clear(); uniqSets.clear(); }

function evict(map) {
  if (map.size <= MAX_KEYS) return;
  let i = 0; const drop = Math.ceil(MAX_KEYS * 0.01);
  for (const k of map.keys()) { map.delete(k); if (++i >= drop) break; }
}
function bump(key, windowMs, limit, now) {
  let e = counters.get(key);
  if (!e || now - e.start >= windowMs) { e = { start: now, n: 0 }; counters.set(key, e); evict(counters); }
  e.n++;
  return e.n <= limit;
}
export function localRatePreCheck(ip, botanical, now, cfg = RATE) {
  if (!bump('min:' + ip, 60_000, cfg.perMin, now)) return { ok: false, reason: 'per_minute' };
  if (!bump('hour:' + ip, 3_600_000, cfg.perHour, now)) return { ok: false, reason: 'per_hour' };
  if (!bump('day:' + ip, 86_400_000, cfg.perDay, now)) return { ok: false, reason: 'per_day' };
  if (botanical != null) {
    let e = uniqSets.get(ip);
    if (!e || now - e.start >= 3_600_000) { e = { start: now, set: new Set() }; uniqSets.set(ip, e); evict(uniqSets); }
    e.set.add(String(botanical).toLowerCase().trim());
    if (e.set.size > cfg.uniqBotanicalsPerHour) return { ok: false, reason: 'unique_botanicals' };
  }
  return { ok: true };
}
