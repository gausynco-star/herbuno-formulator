// ADR-014 Step 2/2a — local test suite (no framework, no deployment). Run: node worker/test/run_tests.js
import { handleRequest } from '../src/index.js';
import { __resetStore, __stats } from '../src/store.js';
import { __resetRate } from '../src/security.js';
import { signProxyQuery, deriveClientIp } from '../src/security.js';
import { signToken } from '../src/token.js';
import { b64urlEncode, hmacB64url } from '../src/hmac.js';
import { resolve, statusOf, makeEngine } from '../src/engine.js';
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
  return { SHOPIFY_APP_SECRET: SECRET, SPECIFICATION_TOKEN_SECRET: TOKEN_SECRET, SHOP_DOMAIN: opts.omitShopDomain ? undefined : SHOP, HB_KV: kv, RATE_LIMITER: opts.noLimiter ? undefined : fakeDO() };
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
    ok('response: top-level keys are exactly the permitted set', JSON.stringify(Object.keys(b).sort()) === '["explanation","identity","identity_status","specification","specification_token","version"]', JSON.stringify(Object.keys(b)));
    const amb = await call(env, specBody({ botanical: AMBIG_TERM }));
    ok('response: ambiguous returns neutral message, no candidate IDs, no token',
      amb.body.identity_status === 'ambiguous' && amb.body.specification === null && amb.body.specification_token === null &&
      amb.body.identity.display_name === null && amb.body.identity.authority_name === null && !('candidates' in amb.body.identity),
      JSON.stringify(amb.body));
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
