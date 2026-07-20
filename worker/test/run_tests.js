// ADR-014 Step 2/2a — local test suite (no framework, no deployment). Run: node worker/test/run_tests.js
import { handleRequest } from '../src/index.js';
import { __resetStore, __stats } from '../src/store.js';
import { __resetRate } from '../src/security.js';
import { signProxyQuery, deriveClientIp } from '../src/security.js';
import { signToken } from '../src/token.js';
import { b64urlEncode, hmacB64url } from '../src/hmac.js';
import { resolve, statusOf, makeEngine, displayName } from '../src/engine.js';
import { LimiterState, RateLimiterDurableObject } from '../src/rate_limiter_do.js';
import { DEGRADED_MESSAGE, API_SCHEMA_VERSION } from '../src/version.js';
import { generateAll, leakageScan } from '../tools/generate_payloads.js';

const SECRET = 'shpss_test_shared_secret_do_not_use';
const TOKEN_SECRET = 'spectok_test_secret_separate_from_proxy';
let pass = 0, fail = 0; const results = [];
function ok(name, cond, detail) { (cond ? pass++ : fail++); results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); }

const B = generateAll();
const engineRef = makeEngine(B.identityIndex, B.formGraph, B.matrix);
const PR = [...engineRef.ladder.keys()].find(k => (engineRef.ladder.get(k).preferred || []).length) || 'capsule|active';
const [PRODUCT, ROLE] = PR.split('|');
const latinTerm = B.identityIndex.identities.find(r => r.authority_accepted_name).authority_accepted_name;
const commonRec = B.identityIndex.identities.find(r => (r.common_names || []).length && resolve(null, r.common_names[0], engineRef.exact, engineRef.common).canonical_id === r.canonical_id);
const commonTerm = commonRec.common_names[0];
const realCid = resolve(null, latinTerm, engineRef.exact, engineRef.common).canonical_id;
// a genuinely ambiguous term = an EXACT common name on >1 identity that still resolves ambiguous
let AMBIG_TERM = 'Ajwain';
for (const [k, s] of engineRef.common) { if (s.size > 1 && statusOf(resolve(null, k, engineRef.exact, engineRef.common)) === 'ambiguous') { AMBIG_TERM = k; break; } }

function buildFakeKV(bundles) {
  const m = new Map();
  m.set('manifest:current', JSON.stringify(bundles.manifest));
  m.set('identity:' + bundles.manifest.identity_version, JSON.stringify(bundles.identityIndex));
  m.set('formgraph:' + bundles.manifest.observed_form_graph_version, JSON.stringify(bundles.formGraph));
  m.set('matrix:' + bundles.manifest.matrix_version, JSON.stringify(bundles.matrix));
  return { gets: 0, async get(k) { this.gets++; return m.has(k) ? m.get(k) : null; }, _map: m };
}
// Fake DO state (storage + blockConcurrencyWhile) so the storage-backed DO runs in-process. Real
// persistence/restart/concurrency is covered by the Miniflare integration suite (integration_do.mjs).
function fakeState() {
  const store = new Map();
  return {
    storage: {
      async get(k) { return store.get(k); },
      async put(o, v) { if (o && typeof o === 'object' && v === undefined) { for (const [k, val] of Object.entries(o)) store.set(k, val); } else store.set(o, v); },
      async delete(keys) { if (Array.isArray(keys)) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; } return store.delete(keys); },
      async list({ prefix } = {}) { const m = new Map(); for (const [k, v] of store) if (!prefix || k.startsWith(prefix)) m.set(k, v); return m; },
    },
    blockConcurrencyWhile(fn) { return fn(); },
  };
}
// One in-process instance => globally consistent, like a real DO.
function fakeDO() { const inst = new RateLimiterDurableObject(fakeState(), {}); return { idFromName: () => 'global', get: () => ({ fetch: (u, init) => inst.fetch(new Request(u, init)) }) }; }
const SHOP = '7zyiqd-p7.myshopify.com';
function envWith(kv, opts = {}) {
  return { SHOPIFY_APP_SECRET: SECRET, SPECIFICATION_TOKEN_SECRET: TOKEN_SECRET, SHOP_DOMAIN: opts.omitShopDomain ? undefined : SHOP, HEADER_CAPTURE: opts.capture ? '1' : undefined, HB_KV: kv, RATE_LIMITER: opts.noLimiter ? undefined : fakeDO() };
}

async function specRequest(body, opts = {}) {
  const ts = opts.ts != null ? opts.ts : Math.floor(Date.now() / 1000);
  const params = { shop: opts.shop || SHOP, path_prefix: '/apps/formulator', timestamp: String(ts) };
  if (opts.customer) params.logged_in_customer_id = opts.customer;
  const signature = opts.badSig ? 'deadbeef' : await signProxyQuery(params, SECRET);
  const qs = new URLSearchParams(params); if (!opts.omitSig) qs.set('signature', signature);
  const url = 'https://herbuno.com/apps/formulator/' + (opts.endpoint || 'specification') + '?' + qs.toString();
  const headers = { 'content-type': opts.contentType || 'application/json', 'CF-Connecting-IP': opts.ip || '203.0.113.7' };
  if (opts.xff) headers['X-Forwarded-For'] = opts.xff;
  return new Request(url, { method: opts.method || 'POST', headers, body: body === undefined ? undefined : (opts.rawBody || JSON.stringify(body)) });
}
const call = async (env, body, opts) => { const res = await handleRequest(await specRequest(body, opts), env); return { status: res.status, body: await res.json() }; };
const specBody = (extra = {}) => ({ product: PRODUCT, role: ROLE, botanical: latinTerm, ...extra });
async function craftToken(secret, payload) { const body = b64urlEncode(JSON.stringify(payload)); return body + '.' + (await hmacB64url(secret, body)); }
const nowSec = () => Math.floor(Date.now() / 1000);
const snap = { iv: B.manifest.identity_version, gv: B.manifest.observed_form_graph_version, mv: B.manifest.matrix_version };

async function run() {
  // ===== BLOCKER 3: concurrent cold-start initialises exactly once =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const reqs = await Promise.all(Array.from({ length: 8 }, (_, i) => specRequest(specBody(), { ip: '203.0.113.' + (20 + i) })));
    await Promise.all(reqs.map(r => handleRequest(r, env)));
    ok('cold-start: 8 concurrent requests initialise indices exactly once', __stats().initCount === 1, 'initCount=' + __stats().initCount);
    ok('bundle load-once: KV read exactly 4 keys total', __stats().kvGets === 4, 'kvGets=' + __stats().kvGets);
  }

  // ===== signature + timestamp =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    ok('signature: valid request passes', (await call(env, specBody())).status === 200);
    ok('signature: tampered rejected (401)', (await call(env, specBody(), { badSig: true })).status === 401);
    ok('signature: absent rejected (401)', (await call(env, specBody(), { omitSig: true })).status === 401);
    ok('timestamp: stale rejected (401)', (await call(env, specBody(), { ts: nowSec() - 3600 })).status === 401);
    // shop binding: a VALIDLY-SIGNED request for a different store is rejected (defence in depth)
    const wrongShop = await call(env, specBody(), { shop: 'someone-else.myshopify.com' });
    ok('shop binding: validly-signed request for a foreign shop rejected (401 invalid_shop)', wrongShop.status === 401 && wrongShop.body.error === 'invalid_shop', JSON.stringify(wrongShop.body));
    ok('shop binding: our exact shop accepted', (await call(env, specBody(), { shop: SHOP })).status === 200);
    ok('shop binding: absent SHOP_DOMAIN fails closed (503 degraded)', (await call(envWith(buildFakeKV(B), { omitShopDomain: true }), specBody())).status === 503);
  }

  // ===== BLOCKER 1: minimal response — no ladder arrays / observed_available / canonical IDs =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const r = await call(env, specBody());
    const b = r.body;
    ok('response: identity has only display_name + authority_name', JSON.stringify(Object.keys(b.identity).sort()) === '["authority_name","display_name"]', JSON.stringify(b.identity));
    ok('response: specification has only selected_format + technical_status + role', JSON.stringify(Object.keys(b.specification).sort()) === '["role","selected_format","technical_status"]', JSON.stringify(b.specification));
    const wire = JSON.stringify({ ...b, specification_token: null });
    ok('response: no ladder arrays / observed_available on the wire', !/preferred|conditional|unsuitable|observed_available|format_ladder/.test(wire), wire.slice(0, 120));
    ok('response: no canonical_id on the wire', !wire.includes(realCid) && !('canonical_id' in b.identity) && !('candidates' in b.identity), realCid);
    // v2 (Step 3): reasoning_checks + reasoning_basis added; candidate_assessment only when supplied
    ok('response: top-level keys are exactly the v2 permitted set (no candidate supplied)', JSON.stringify(Object.keys(b).sort()) === '["explanation","identity","identity_status","reasoning_basis","reasoning_checks","specification","specification_token","version"]', JSON.stringify(Object.keys(b)));
    ok('response: reasoning_checks is exactly {phase,dissolution,process} of conclusions', JSON.stringify(Object.keys(b.reasoning_checks).sort()) === '["dissolution","phase","process"]' && typeof b.reasoning_checks.phase === 'string', JSON.stringify(b.reasoning_checks));
    ok('response: resolved reasoning_basis is botanical', b.reasoning_basis === 'botanical');
    ok('response: no candidate_assessment key unless a candidate_format was sent', !('candidate_assessment' in b));
    const amb = await call(env, specBody({ botanical: AMBIG_TERM }));
    const ambCids = resolve(null, AMBIG_TERM, engineRef.exact, engineRef.common).candidates || [];
    ok('response: ambiguous returns neutral message, no identity claim, no token, and NO canonical IDs on the wire',
      amb.body.identity_status === 'ambiguous' && amb.body.specification_token === null &&
      amb.body.identity.display_name === null && amb.body.identity.authority_name === null &&
      ambCids.length >= 2 && !ambCids.some((id) => JSON.stringify(amb.body).includes(id)),
      JSON.stringify(amb.body));
    // UX 1 — the sanctioned ambiguity-only exception: candidate IDENTITIES surface as PUBLIC names only
    // ({display_name, authority_name}); never canonical IDs, never a count. Scoped to ambiguous.
    ok('response UX1: identity.candidates lists names only ({display_name, authority_name}, ambiguity exception)',
      Array.isArray(amb.body.identity.candidates) && amb.body.identity.candidates.length >= 2 &&
      amb.body.identity.candidates.every((c) => JSON.stringify(Object.keys(c).sort()) === '["authority_name","display_name"]' && typeof (c.authority_name || c.display_name) === 'string'),
      JSON.stringify(amb.body.identity.candidates));
    ok('response: ambiguous STILL returns a generic role-based Product×Role spec + reasoning (labelled role)',
      amb.body.specification && typeof amb.body.specification.technical_status === 'string' && amb.body.reasoning_basis === 'role' && !JSON.stringify(amb.body).includes(realCid),
      JSON.stringify(amb.body.specification));
  }

  // ===== resolution parity vs local resolver (status + authority) =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    let ambigTerm = 'Ajwain';
    for (const [k, s] of engineRef.common) { if (s.size > 1 && statusOf(resolve(null, k, engineRef.exact, engineRef.common)) === 'ambiguous') { ambigTerm = k; break; } }
    const cases = [
      { term: latinTerm, want: 'resolved' }, { term: commonTerm, want: 'resolved' },
      { term: commonTerm + ' Root', want: 'resolved' }, { term: ambigTerm, want: 'ambiguous' },
      { term: 'Xyzzy Blorptonium 42', want: 'unrecognised' },
    ];
    let good = true, detail = '';
    for (const c of cases) {
      const local = resolve(null, c.term, engineRef.exact, engineRef.common);
      const r = await call(env, specBody({ botanical: c.term }));
      const authOk = c.want !== 'resolved' || r.body.identity.authority_name === engineRef.byId.get(local.canonical_id).authority_accepted_name;
      if (r.body.identity_status !== statusOf(local) || r.body.identity_status !== c.want || !authOk) { good = false; detail += `[${c.term}: ${r.body.identity_status} want ${c.want}] `; }
    }
    ok('resolution parity: status + authority match local resolver across buckets', good, detail);
  }

  // ===== BLOCKER 4: token hardening =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const spec = await call(env, specBody());
    const token = spec.body.specification_token;
    ok('token: signed with SPECIFICATION_TOKEN_SECRET, issued on resolved spec', typeof token === 'string' && token.split('.').length === 2);
    ok('token: valid token accepted at procurement (200)', (await call(env, { specification_token: token }, { endpoint: 'procurement' })).status === 200);
    ok('token: tampered rejected (401)', (await call(env, { specification_token: token.slice(0, -3) + 'zzz' }, { endpoint: 'procurement' })).status === 401);
    ok('token: extra 3rd segment rejected (401)', (await call(env, { specification_token: token + '.evil' }, { endpoint: 'procurement' })).body.detail === 'malformed');
    const expired = await signToken(TOKEN_SECRET, { cid: realCid, product: PRODUCT, role: ROLE, sf: 'RE', api: API_SCHEMA_VERSION, ...snap }, nowSec() - 10000);
    ok('token: expired rejected (401)', (await call(env, { specification_token: expired }, { endpoint: 'procurement' })).body.detail === 'expired');
    const badV = await craftToken(TOKEN_SECRET, { v: 99, cid: realCid, product: PRODUCT, role: ROLE, sf: 'RE', api: API_SCHEMA_VERSION, ...snap, iat: nowSec(), exp: nowSec() + 300 });
    ok('token: bad schema version v rejected (401)', (await call(env, { specification_token: badV }, { endpoint: 'procurement' })).body.detail === 'bad_token_version');
    const badApi = await signToken(TOKEN_SECRET, { cid: realCid, product: PRODUCT, role: ROLE, sf: 'RE', api: 99, ...snap });
    ok('token: wrong api_schema_version rejected (401)', (await call(env, { specification_token: badApi }, { endpoint: 'procurement' })).body.detail === 'api_schema');
    const badCid = await signToken(TOKEN_SECRET, { cid: 'no-such-identity-zzz', product: PRODUCT, role: ROLE, sf: 'RE', api: API_SCHEMA_VERSION, ...snap });
    ok('token: unknown cid claim rejected (401)', (await call(env, { specification_token: badCid }, { endpoint: 'procurement' })).body.detail === 'cid');
    const badPR = await signToken(TOKEN_SECRET, { cid: realCid, product: 'nope', role: 'nope', sf: 'RE', api: API_SCHEMA_VERSION, ...snap });
    ok('token: unknown product/role claim rejected (401)', (await call(env, { specification_token: badPR }, { endpoint: 'procurement' })).body.detail === 'product_role');
    const wrongSecret = await signToken(SECRET, { cid: realCid, product: PRODUCT, role: ROLE, sf: 'RE', api: API_SCHEMA_VERSION, ...snap });
    ok('token: signed with the proxy secret (not the token secret) rejected', (await call(env, { specification_token: wrongSecret }, { endpoint: 'procurement' })).body.detail === 'bad_signature');
    ok('procurement: client-fabricated spec fields rejected (400)', (await call(env, { specification_token: token, cid: 'x' }, { endpoint: 'procurement' })).status === 400);
    ok('procurement: missing token rejected (400)', (await call(env, { canonical_id: 'x' }, { endpoint: 'procurement' })).status === 400);
  }

  // ===== leakage in responses =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const spec = await call(env, specBody());
    const proc = await call(env, { specification_token: spec.body.specification_token }, { endpoint: 'procurement' });
    ok('leakage: no supplier/provenance fields in any response body', [...leakageScan('spec', spec.body), ...leakageScan('proc', proc.body)].length === 0);
  }

  // ===== hardening: body size, content-type, exact route =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    ok('hardening: oversized body rejected (413)', (await call(env, specBody({}), { rawBody: JSON.stringify(specBody({})) + ' '.repeat(3000) })).status === 413);
    ok('hardening: non-JSON content-type rejected (415)', (await call(env, specBody(), { contentType: 'text/plain' })).status === 415);
    ok('hardening: non-exact route rejected (404)', (await call(env, specBody(), { endpoint: 'specification/extra' })).status === 404);
    ok('hardening: unknown route rejected (404, no bulk endpoint)', (await call(env, undefined, { endpoint: 'all-botanicals', method: 'GET' })).status === 404);
    ok('hardening: over-long session_id rejected (400)', (await call(env, specBody({ session_id: 'x'.repeat(80) })).then(r => r.status)) === 400);
  }

  // ===== BLOCKER 2: central limiter (Durable Object) =====
  // rate limit is keyed on IP, not session_id — rotating session does not buy more calls
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    let last;
    for (let i = 0; i < 10; i++) last = await call(env, specBody({ session_id: 'sess' + i }), { ip: '198.51.100.5' });
    ok('rate limit: first 10/min from an IP pass (varying session_id)', last.status === 200, 'status=' + last.status);
    const over = await call(env, specBody({ session_id: 'freshsession' }), { ip: '198.51.100.5' });
    ok('rate limit: 11th within a minute rejected despite new session_id (429)', over.status === 429, 'status=' + over.status);
    ok('rate limit: a different IP is unaffected', (await call(env, specBody(), { ip: '198.51.100.6' })).status === 200);
  }
  // LimiterState logic (unit) — enumeration/traversal + unique-botanical + key isolation
  { const ls = new LimiterState({ perMin: 1000, perHour: 1000, perDay: 100000, uniqBotanicalsPerHour: 5, distinctProductRolePerHour: 5 });
    const now = 1_000_000;
    let uniqReason = null; for (let i = 0; i < 6; i++) uniqReason = ls.check('1.1.1.1', { botanical: 'b' + i, now }).reason;
    ok('central limiter: unique-botanical ceiling enforced per IP', uniqReason === 'unique_botanicals', 'reason=' + uniqReason);
    let enumR = null; for (let i = 0; i < 6; i++) enumR = ls.check('2.2.2.2', { productRole: 'p|r' + i, now });
    ok('central limiter: product×role traversal triggers enumeration challenge', enumR.reason === 'enumeration' && enumR.challenge === true, JSON.stringify(enumR));
    ok('central limiter: keys are isolated (a fresh IP is not blocked)', ls.check('3.3.3.3', { botanical: 'x', now }).ok === true);
  }
  { const e = envWith(buildFakeKV(B), { noLimiter: true }); __resetStore(); __resetRate();
    ok('pipeline: unbound central limiter => degraded (fail closed)', (await call(e, specBody(), { ip: '9.9.9.9' })).status === 503);
  }

  // ===== Step-2b BLOCKER: client IP behind the Shopify App Proxy (X-Forwarded-For, trust-from-right) =====
  // deriveClientIp unit coverage: real chain, spoof resistance, IPv6, and safe fallback.
  { const EG = '198.51.100.50'; // Shopify egress == CF-Connecting-IP appended by Cloudflare
    ok('client-ip: real chain "<shopper>, <egress>" keys on the shopper', deriveClientIp('203.0.113.9, ' + EG, EG) === '203.0.113.9');
    ok('client-ip: browser-injected leftmost is ignored (trust-from-the-right)', deriveClientIp('6.6.6.6, 203.0.113.9, ' + EG, EG) === '203.0.113.9');
    ok('client-ip: single-entry XFF (no visible CF append) keys on the shopper', deriveClientIp('203.0.113.9', EG) === '203.0.113.9');
    ok('client-ip: IPv4 :port on the shopper entry is normalised', deriveClientIp('203.0.113.9:54321, ' + EG, EG) === '203.0.113.9');
    ok('client-ip: IPv6 shopper accepted', deriveClientIp('2001:db8::1, ' + EG, EG) === '2001:db8::1');
    ok('client-ip: malformed shopper entry falls back to CF-Connecting-IP (never attacker-chosen)', deriveClientIp('not-an-ip, ' + EG, EG) === EG);
    ok('client-ip: empty XFF falls back to CF-Connecting-IP', deriveClientIp('', EG) === EG);
    ok('client-ip: absent XFF and absent CF-IP => stable shared bucket', deriveClientIp(null, null) === 'no-ip');
  }
  // end-to-end: two shoppers behind ONE Shopify egress must land in SEPARATE limiter buckets, not one shared.
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B)); const EG = '198.51.100.77';
    let a; for (let i = 0; i < 10; i++) a = await call(env, specBody({ session_id: 's' + i }), { ip: EG, xff: '203.0.113.40, ' + EG });
    const aOver = await call(env, specBody(), { ip: EG, xff: '203.0.113.40, ' + EG });
    const bFresh = await call(env, specBody(), { ip: EG, xff: '203.0.113.41, ' + EG });
    ok('client-ip: shopper A throttled at the 11th request behind the shared egress', a.status === 200 && aOver.status === 429, 'a=' + a.status + ' over=' + aOver.status);
    ok('client-ip: shopper B (same egress, different X-Forwarded-For) is NOT throttled by A', bFresh.status === 200, 'status=' + bFresh.status);
  }

  // ===== Step-2b review (a): dual-key limiter — coarse transport backstop on the non-spoofable egress =====
  // Unit: rotating the shopper key past the transport ceiling still trips (each shopper key stays fresh).
  { const ls = new LimiterState({ perMin: 5, perHour: 1000, perDay: 100000, uniqBotanicalsPerHour: 1000, distinctProductRolePerHour: 1000, transport: { perMin: 8, perHour: 1000, perDay: 100000 } });
    const now = 2_000_000; let res;
    for (let i = 0; i < 9; i++) res = ls.check('shopper-' + i, { transportKey: 'egress-X', now }); // 9 distinct shopper keys, one egress
    ok('transport backstop: XFF rotation past the transport ceiling is blocked (aggregate egress bound)', res.ok === false && res.reason === 'transport_per_minute', JSON.stringify(res));
    ok('transport backstop: a different egress is unaffected by the first egress hitting its ceiling', ls.check('shopper-z', { transportKey: 'egress-Y', now }).ok === true);
  }
  // Wiring: a normal spec request increments the transport counter keyed on CF-Connecting-IP (the egress).
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B)); const EG = '198.51.100.90';
    await call(env, specBody(), { ip: EG, xff: '203.0.113.55, ' + EG });
    const t = await env.RATE_LIMITER.get('global').fetch('https://do/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stat', key: 'tm:' + EG }) }).then(r => r.json());
    ok('transport backstop: request increments the transport counter keyed on the egress (CF-Connecting-IP)', t.count === 1, 'tm count=' + t.count);
  }

  // ===== dev-theme header capture (gated; DEPLOYMENT-GATE evidence; privacy: NEVER botanical/token/session) =====
  { __resetStore(); __resetRate(); const EG = '198.51.100.30';
    const grab = async (env, opts) => { const orig = console.log, lines = []; console.log = (...a) => lines.push(a.map(String).join(' ')); try { await call(env, specBody({ session_id: 'capsess42' }), opts); } finally { console.log = orig; } return lines; };
    const on = await grab(envWith(buildFakeKV(B), { capture: true }), { ip: EG, xff: '203.0.113.60, ' + EG });
    const cap = on.find(l => l.includes('[xff-capture]')) || '';
    ok('capture: emits an [xff-capture] line when HEADER_CAPTURE is set, with the raw XFF', cap.includes('[xff-capture]') && cap.includes('"xff":"203.0.113.60, ' + EG + '"'), cap.slice(0, 160));
    ok('capture: records cf, derived shopper key, shop, and the shared-transport signal',
      cap.includes('"cf":"' + EG + '"') && cap.includes('"derived":"203.0.113.60"') && cap.includes('"shop":"' + SHOP + '"') && cap.includes('"shared_transport":'), cap.slice(0, 200));
    ok('capture: NEVER logs the botanical query, the token, or session_id (HARD RULE 7 privacy)',
      !cap.toLowerCase().includes(latinTerm.toLowerCase()) && !cap.includes('token') && !cap.includes('capsess42'), cap.slice(0, 200));
    const off = await grab(envWith(buildFakeKV(B)), { ip: EG, xff: '203.0.113.61, ' + EG });
    ok('capture: OFF by default — no [xff-capture] line unless HEADER_CAPTURE is set', !off.some(l => l.includes('[xff-capture]')));
  }

  // ===== ADR-014 Step 3: candidate_format assessment + SE lock + validation =====
  // a catalogue cell that has BOTH an ok and an avoid code, for deterministic candidate assessment
  let CPR = null, C_OK = null, C_AVOID = null;
  for (const [k, L] of engineRef.ladder) { if (L.routing !== 'catalogue') continue;
    const okc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'ok' && c !== 'SE');
    const avc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'avoid' && c !== 'SE');
    if (okc && avc) { CPR = k; C_OK = okc; C_AVOID = avc; break; } }
  const [CPROD, CROLE] = CPR.split('|');
  const cand = (cf, opts) => call(envWith(buildFakeKV(B)), { product: CPROD, role: CROLE, botanical: latinTerm, candidate_format: cf }, opts);
  { __resetStore(); __resetRate();
    ok('candidate: absent unless the user supplies one', !('candidate_assessment' in (await call(envWith(buildFakeKV(B)), specBody())).body));
    const se = (await cand('SE')).body.candidate_assessment;
    ok('candidate SE: LOCKED application-review response, never assessed as a base format',
      se && se.format === 'SE' && se.technical_status === 'Application review needed' && /Standardisation describes assay, not physical format/.test(se.explanation), JSON.stringify(se));
    const av = (await cand(C_AVOID)).body.candidate_assessment;
    ok('candidate avoid-tier: "Not suitable for this role" + conclusion, no ladder arrays', av.technical_status === 'Not suitable for this role' && !/preferred|conditional|unsuitable/.test(JSON.stringify(av)), JSON.stringify(av));
    const okc = (await cand(C_OK)).body.candidate_assessment;
    ok('candidate ok-tier: "Best physical fit"', okc.technical_status === 'Best physical fit', JSON.stringify(okc));
    const withCand = Object.keys((await cand(C_OK)).body).sort();
    const noCand = Object.keys((await call(envWith(buildFakeKV(B)), { product: CPROD, role: CROLE, botanical: latinTerm })).body).sort();
    ok('candidate: supplying a format adds EXACTLY the candidate_assessment key, nothing else', JSON.stringify(withCand.filter(k => !noCand.includes(k))) === '["candidate_assessment"]', JSON.stringify(withCand));
    ok('candidate: "Other" rejected server-side (400)', (await cand('Other')).status === 400);
    ok('candidate: unknown code rejected server-side (400)', (await cand('ZZ')).status === 400);
    ok('candidate: non-string rejected server-side (400)', (await call(envWith(buildFakeKV(B)), { product: CPROD, role: CROLE, botanical: latinTerm, candidate_format: 3 })).status === 400);
    // candidate check runs and is labelled role-based under ambiguous (identity doesn't gate role physics)
    const ambCand = (await call(envWith(buildFakeKV(B)), { product: CPROD, role: CROLE, botanical: AMBIG_TERM, candidate_format: C_AVOID })).body;
    ok('candidate under ambiguous: assessment still runs, labelled role-based, no token/identity',
      ambCand.candidate_assessment && ambCand.candidate_assessment.technical_status === 'Not suitable for this role' && ambCand.reasoning_basis === 'role' && ambCand.specification_token === null && ambCand.identity.display_name === null, JSON.stringify(ambCand));
  }

  // ===== Step 3: candidate_format SET limiter (distinct formats per shopper×hour×product×role) =====
  { const ls = new LimiterState({ perMin: 1000, perHour: 1000, perDay: 100000, uniqBotanicalsPerHour: 1000, distinctProductRolePerHour: 1000, distinctCandidateFormatsPerCellPerHour: 3, transport: null });
    const now = 3_000_000, cell = 'gummy|active';
    let rep; for (let i = 0; i < 5; i++) rep = ls.check('ipA', { productRole: cell, candidateFormat: 'MP', now });
    ok('candidate SET: repeating ONE format never trips (set stays size 1 = legitimate re-checking)', rep.ok === true, JSON.stringify(rep));
    ls.check('ipB', { productRole: cell, candidateFormat: 'MP', now });
    ls.check('ipB', { productRole: cell, candidateFormat: 'RE', now });
    const third = ls.check('ipB', { productRole: cell, candidateFormat: 'WL', now });
    const fourth = ls.check('ipB', { productRole: cell, candidateFormat: 'OE', now });
    ok('candidate SET: 3 distinct pass; the 4th DISTINCT format for the cell is rate-limited', third.ok === true && fourth.ok === false && fourth.reason === 'candidate_enumeration', JSON.stringify({ third, fourth }));
    ok('candidate SET: a different product×role cell keeps its own set', ls.check('ipB', { productRole: 'tablet-dc|active', candidateFormat: 'OE', now }).ok === true);
  }
  // end-to-end: candidate queries update the distinct-format SET AND still increment ordinary + traversal limits
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B)); const IP = '198.51.100.44';
    const doStat = (key) => env.RATE_LIMITER.get('global').fetch('https://do/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stat', key }) }).then(r => r.json());
    const send = (cf) => call(env, { product: CPROD, role: CROLE, botanical: latinTerm, candidate_format: cf }, { ip: IP });
    const four = ['MP', 'RE', 'WL', 'OE'];
    let last; for (let i = 0; i < 3; i++) last = await send(four[i]);
    ok('candidate SET e2e: first 3 distinct candidate formats for a cell pass (200)', last.status === 200, 'status=' + last.status);
    ok('candidate SET e2e: repeating an already-seen format does NOT trip', (await send(four[0])).status === 200);
    ok('candidate SET e2e: the 4th DISTINCT format for the cell is rate-limited (429)', (await send(four[3])).status === 429);
    const m = await doStat('m:' + IP), t = await doStat('t:' + IP), cf = await doStat('cf:' + IP + '|' + CPR);
    ok('candidate SET e2e: ordinary per-minute counter still incremented for every candidate query', m.count === 5, 'm=' + m.count);
    ok('candidate SET e2e: the cell also joined the existing product×role traversal set', t.setSize === 1, 't=' + t.setSize);
    ok('candidate SET e2e: the persisted distinct-format set holds the queried formats', cf.setSize === 4, 'cf=' + cf.setSize);
  }

  // ===== Step 3: token suppression (server-side) + schema-version fail-closed =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    ok('token suppression: NO specification_token for ambiguous (server-side)', (await call(env, specBody({ botanical: AMBIG_TERM }))).body.specification_token === null);
    const unrec = (await call(env, specBody({ botanical: 'Xyzzy Blorptonium 42' }))).body;
    ok('token suppression: NO specification_token for unrecognised (server-side)', unrec.identity_status === 'unrecognised' && unrec.specification_token === null);
    const oldTok = await signToken(TOKEN_SECRET, { cid: realCid, product: PRODUCT, role: ROLE, sf: 'RE', api: 1, ...snap });
    ok('schema: a v1 (old) token is rejected at v2 procurement — fails closed', (await call(env, { specification_token: oldTok }, { endpoint: 'procurement' })).body.detail === 'api_schema');
    const vb = (await call(env, specBody())).body.version;
    ok('schema: response carries api_schema_version 2', vb.api_schema_version === 2);
    ok('schema: version block records phase_map_version (third authored layer, ADR-013 contract)', vb.phase_map_version === B.manifest.phase_map_version && typeof vb.phase_map_version === 'string', JSON.stringify(vb));
  }
  // phase_map_version mismatch between the matrix bundle and the manifest => fail closed (degraded)
  { __resetStore(); __resetRate();
    const bad = { ...B, matrix: { ...B.matrix, data: { ...B.matrix.data, phase_map_version: '1999-01-01.0' } } };
    const r = await call(envWith(buildFakeKV(bad)), specBody());
    ok('phase map: a phase_map_version mismatch fails closed (503 degraded), no internal reason leaked', r.status === 503 && r.body.message === DEGRADED_MESSAGE && !JSON.stringify(r.body).includes('phase_map_version'), 'status=' + r.status);
  }

  // ===== ADR-014 Step 3 live-fixes: display name · guidance routing · phase/solubility · unmapped cell =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    // #1 display name: prefer a clean common name over the bare Latin
    const pg = B.identityIndex.identities.find(r => r.authority_accepted_name === 'Punica granatum');
    if (pg) ok('fix#1 display: Punica granatum -> "Pomegranate" (not the Latin)', displayName(pg) === 'Pomegranate', displayName(pg));
    const spec = (await call(env, specBody())).body;
    ok('fix#1 display: identity.display_name is not a duplicate of the Latin authority name', typeof spec.identity.display_name === 'string' && spec.identity.display_name !== spec.identity.authority_name, JSON.stringify(spec.identity));
    // #1 override file: presentation-only, precedence override -> heuristic -> canonical_display_name
    const overrideKeys = ['camellia-sinensis', 'aloe-vera', 'terminalia-chebula', 'glycyrrhiza-glabra'];
    const present = overrideKeys.filter(k => B.identityIndex.identities.some(r => r.canonical_id === k));
    ok('fix#1 override: every override canonical_id exists in the backbone (no dead overrides)', present.length === overrideKeys.length, 'present=' + present.join(','));
    const cs = B.identityIndex.identities.find(r => r.canonical_id === 'camellia-sinensis');
    if (cs) ok('fix#1 override: override WINS over the heuristic (camellia-sinensis -> "Tea", not "Green Tea")', displayName(cs) === 'Tea', displayName(cs));
    ok('fix#1 order: heuristic applies when there is no override (Punica -> "Pomegranate")', pg ? displayName(pg) === 'Pomegranate' : true);
    ok('fix#1 fallback: no override + no usable common_names -> canonical_display_name', displayName({ canonical_id: 'zzz-none', canonical_display_name: 'Zzz example', authority_accepted_name: 'Zzz example', common_names: [] }) === 'Zzz example');
    // #2 guidance routing (gummy|base is out_of_scope): surface rec, null format, no token, no reasoning
    const gb = (await call(env, { product: 'gummy', role: 'base', botanical: latinTerm })).body;
    ok('fix#2 guidance: out_of_scope role surfaces rec guidance, not a dead-end', gb.specification.selected_format === null && /gel or compressed-chew matrix/.test(gb.explanation), JSON.stringify(gb.specification) + ' | ' + gb.explanation);
    ok('fix#2 guidance: no specification_token and no reasoning_checks for a guidance role', gb.specification_token === null && gb.reasoning_checks === null);
    ok('fix#2 guidance: out_of_scope carries NO guidance_label (client shows "Guidance", not "Typical commercial approach")', !('guidance_label' in gb));
    // UX 2 (Live-test R2): a catalogue cell fulfilled differently — taila|active (classical sneha-paka, the
    // herb is infused in-process) — is a CATEGORY ERROR, not "No suitable commercial format".
    const ta = (await call(env, { product: 'taila', role: 'active', botanical: latinTerm })).body;
    ok('UX2: taila|active is a category error ("This role is normally fulfilled differently"), never "No suitable commercial format"',
      ta.specification.technical_status === 'This role is normally fulfilled differently' && ta.specification.selected_format === null && !JSON.stringify(ta).includes('No suitable commercial format'), JSON.stringify(ta.specification));
    ok('UX2: taila|active surfaces the rec under guidance_label "Typical commercial approach", issues no token, no reasoning',
      ta.guidance_label === 'Typical commercial approach' && typeof ta.explanation === 'string' && ta.explanation.length > 0 && ta.specification_token === null && ta.reasoning_checks === null, JSON.stringify({ gl: ta.guidance_label, tok: ta.specification_token }));
    // #4 phase/solubility: a dry powder (SD) in a dry product is in-phase, not a "separate phase"
    const ih = (await call(env, { product: 'instant-hot', role: 'base', botanical: latinTerm })).body;
    ok('fix#4 phase: dry powder in a dry product reads as compatible, not a separate liquid phase', /compatible with incorporation into the product.s dry-solid matrix/.test(ih.reasoning_checks.phase) && !/separate phase/.test(ih.reasoning_checks.phase), JSON.stringify(ih.reasoning_checks.phase));
  }
  // #3 an unmapped-but-well-formed product×role is a DOMAIN outcome: 200 guidance (robust through the App
  // Proxy, never degraded), NOT a 400/5xx. Genuinely malformed input still 400s.
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const r = await call(env, { product: 'rtd-cloudy', role: 'carrier', botanical: 'orange' });
    ok('fix#3 unmapped cell: rtd-cloudy|carrier returns 200 guidance (not 400/5xx)',
      r.status === 200 && r.body.guidance_status === 'not_available_for_product' && r.body.specification === null && r.body.specification_token === null, 'status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 160));
    ok('fix#3 guidance carries the version block (client apiCompatible passes)', r.body.version && r.body.version.api_schema_version === API_SCHEMA_VERSION);
    // genuinely malformed input still 400s
    ok('fix#3 malformed input still 400s (unexpected field)', (await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm, bogus: 1 })).status === 400);
  }

  // ===== degraded: honest, no internal detail; fail-closed on version mismatch =====
  { __resetStore(); __resetRate(); const kv = buildFakeKV(B); kv._map.delete('matrix:' + B.manifest.matrix_version);
    const r = await call(envWith(kv), specBody());
    const wire = JSON.stringify(r.body);
    ok('degraded: missing bundle => 503 generic message, no partial result', r.status === 503 && r.body.message === DEGRADED_MESSAGE && !r.body.specification);
    ok('degraded: reveals no internal detail (no KV keys / version reasons)', !/matrix:|missing_key|version_mismatch|identity:|formgraph:/i.test(wire) && !('reason' in r.body), wire.slice(0, 100));
  }
  { __resetStore(); __resetRate();
    const bad = { ...B, formGraph: { ...B.formGraph, built_against_identity_version: '1999-01-01.9' } };
    const r = await call(envWith(buildFakeKV(bad)), specBody());
    ok('fail-closed: inconsistent bundle versions => degraded, no internal reason leaked', r.status === 503 && r.body.message === DEGRADED_MESSAGE && !JSON.stringify(r.body).includes('version_mismatch'));
  }

  console.log(results.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
