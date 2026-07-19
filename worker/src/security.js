// Request-security controls (ADR-014 §2). Signature + timestamp + input allow-list + a cheap
// per-isolate rate pre-check. The AUTHORITATIVE limiter is the Durable Object in rate_limiter_do.js;
// this module is only the first, best-effort layer.
import { hmacHex, hmacVerifyHex } from './hmac.js';
import { RATE, SESSION_ID_RE, FORMAT_CODES } from './version.js';

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

// ---- 2b. Client IP behind the Shopify App Proxy (call ONLY after verifyProxyQuery succeeds) ----
// Topology: shopper --> Shopify App Proxy (server-to-server) --> Cloudflare (this Worker). CF-Connecting-IP
// is therefore the IP that connected to Cloudflare = SHOPIFY'S EGRESS, shared by countless unrelated
// shoppers. Keying the limiter on it collapses every shopper into ONE bucket, so a handful of visitors
// can exhaust the per-minute / traversal ceilings for everyone (Step-2b BLOCKER: wrong client IP behind
// the App Proxy). Shopify forwards the real shopper IP in X-Forwarded-For.
//
// We only read X-Forwarded-For AFTER the App Proxy signature is verified. NOTE, precisely: the App Proxy
// signature authenticates the QUERY PARAMETERS, not the request headers — X-Forwarded-For is NEVER
// cryptographically authenticated. Verification only tells us Shopify forwarded the request; the header is
// then trusted by TOPOLOGY, not by signature. Extraction is trust-from-the-RIGHT, deliberately NOT the
// reviewer's "take one value / reject multi-hop":
//   * leftmost is browser-spoofable (a shopper can inject X-Forwarded-For into their request to Shopify);
//   * "reject multi-hop" is wrong here because Cloudflare ITSELF appends the connecting peer
//     (= Shopify egress = CF-Connecting-IP) to X-Forwarded-For, so a legitimate chain is normally
//     multi-hop: `<shopper>, <shopify-egress>`.
// Rule: peel a trailing entry equal to CF-Connecting-IP (Cloudflare's own append), then take the rightmost
// REMAINING entry — the shopper-IP position expected from the documented Shopify -> Cloudflare proxy
// topology; confirmed during dev-theme testing. Malformed / empty => fall back to CF-Connecting-IP (the
// pre-fix shared-bucket behaviour: safe, never attacker-chosen, never worse than the status quo).
// RESIDUAL RISK: if Shopify ever forwarded a browser-supplied X-Forwarded-For verbatim without stamping its
// own observed client IP (contradicting its docs), the rightmost pre-egress entry could be caller-chosen —
// this is why the DEPLOYMENT GATE below (confirm the live header shape) blocks production, and why the coarse
// non-spoofable transport-key limit backs up the shopper key regardless.
const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp('^' + IPV4_OCTET + '(\\.' + IPV4_OCTET + '){3}$');
function isIpv4(s) { return typeof s === 'string' && IPV4_RE.test(s); }
// Strict-enough IPv6: <=1 '::' compression, 1-4 hex per group, optional trailing IPv4-mapped quad.
function isIpv6(s) {
  if (typeof s !== 'string' || s.indexOf(':') === -1) return false;
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;
  const toGroups = seg => (seg === '' ? [] : seg.split(':'));
  let groups = toGroups(halves[0]).concat(compressed ? toGroups(halves[1]) : []);
  let v4tail = 0;
  if (groups.length && groups[groups.length - 1].indexOf('.') !== -1) {
    if (!isIpv4(groups[groups.length - 1])) return false;
    v4tail = 2; groups = groups.slice(0, -1);       // one dotted quad occupies two 16-bit groups
  }
  for (const g of groups) if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
  const count = groups.length + v4tail;
  return compressed ? count <= 7 : count === 8;     // '::' must stand for >=1 zero group
}
// Normalise one X-Forwarded-For token: strip [..] brackets, an IPv4 :port, and any IPv6 zone id.
function normalizeIp(tok) {
  let s = typeof tok === 'string' ? tok.trim() : '';
  if (!s) return null;
  if (s[0] === '[') { const end = s.indexOf(']'); if (end === -1) return null; s = s.slice(1, end); }
  else if (s.indexOf('.') !== -1 && s.split(':').length === 2) s = s.split(':')[0]; // ipv4:port
  const pct = s.indexOf('%'); if (pct !== -1) s = s.slice(0, pct);                    // ipv6 zone id
  return isIpv4(s) || isIpv6(s) ? s : null;
}
export function deriveClientIp(xff, cfConnectingIp) {
  const cf = typeof cfConnectingIp === 'string' && cfConnectingIp ? cfConnectingIp : null;
  const fallback = cf || 'no-ip';
  if (typeof xff !== 'string' || !xff) return fallback;
  const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  if (cf && parts.length > 1 && parts[parts.length - 1] === cf) parts.pop(); // peel Cloudflare's own hop
  return normalizeIp(parts[parts.length - 1]) || fallback;
}

// ---- 3. Strict input allow-list ----
// Exactly: product (known), role (known for that product), botanical (one term, <=80 chars).
// session_id optional but UNTRUSTED: bounded length + charset, never used as a limiter key.
function validSession(v) { return v === undefined || (typeof v === 'string' && SESSION_ID_RE.test(v)); }
export function validateSpecInput(body, engine) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_body';
  for (const k of Object.keys(body)) if (!['product', 'role', 'botanical', 'session_id', 'candidate_format'].includes(k)) return 'unexpected_field';
  if (typeof body.product !== 'string' || typeof body.role !== 'string') return 'missing_product_role';
  if (typeof body.botanical !== 'string' || !body.botanical.trim() || body.botanical.length > 80) return 'bad_botanical';
  if (!validSession(body.session_id)) return 'bad_session';
  // candidate_format is OPTIONAL; when present it MUST be an allow-listed code. 'Other'/unknown/non-string
  // are rejected here (the label is never the contract; 'Other' is free text in the enquiry only).
  if (body.candidate_format !== undefined && !FORMAT_CODES.has(body.candidate_format)) return 'bad_candidate_format';
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
