// ADR-014 Step 2 — local test suite (no framework, no deployment). Run: node worker/test/run_tests.js
// Exercises the whole request pipeline against an in-memory fake KV built from the runtime-minimal
// bundles, plus the ADR-014 §5 assertions (init-once, signature, token, parity, leakage, rate limit,
// degraded, fail-closed on version mismatch, bundle load-once).
import { handleRequest } from '../src/index.js';
import { __resetStore, __stats } from '../src/store.js';
import { __resetRate } from '../src/security.js';
import { signProxyQuery } from '../src/security.js';
import { signToken } from '../src/token.js';
import { resolve, statusOf } from '../src/engine.js';
import { makeEngine } from '../src/engine.js';
import { generateAll, leakageScan } from '../tools/generate_payloads.js';

const SECRET = 'shpss_test_shared_secret_do_not_use';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, detail) { (cond ? pass++ : fail++); results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); }

// ---- build bundles once (in-memory; no disk dependency) ----
const B = generateAll();

function buildFakeKV(bundles) {
  const m = new Map();
  m.set('manifest:current', JSON.stringify(bundles.manifest));
  m.set('identity:' + bundles.manifest.identity_version, JSON.stringify(bundles.identityIndex));
  m.set('formgraph:' + bundles.manifest.observed_form_graph_version, JSON.stringify(bundles.formGraph));
  m.set('matrix:' + bundles.manifest.matrix_version, JSON.stringify(bundles.matrix));
  return { gets: 0, async get(k) { this.gets++; return m.has(k) ? m.get(k) : null; }, _map: m };
}
function envWith(kv) { return { SHOPIFY_APP_SECRET: SECRET, HB_KV: kv }; }

async function specRequest(body, opts = {}) {
  const ts = opts.ts != null ? opts.ts : Math.floor(Date.now() / 1000);
  const params = { shop: 'herbuno.myshopify.com', path_prefix: '/apps/formulator', timestamp: String(ts) };
  if (opts.customer) params.logged_in_customer_id = opts.customer;
  const signature = opts.badSig ? 'deadbeef' : await signProxyQuery(params, SECRET);
  if (opts.omitSig) delete params.signature;
  const qs = new URLSearchParams(params); if (!opts.omitSig) qs.set('signature', signature);
  const url = 'https://herbuno.com/apps/formulator/' + (opts.endpoint || 'specification') + '?' + qs.toString();
  return new Request(url, { method: opts.method || 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': opts.ip || '203.0.113.7' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const call = async (env, body, opts) => { const res = await handleRequest(await specRequest(body, opts), env); return { status: res.status, body: await res.json() }; };

// a product|role pair known to exist + resolved botanical (from the real backbone)
const engineRef = makeEngine(B.identityIndex, B.formGraph, B.matrix);
const PR = [...engineRef.ladder.keys()].find(k => (engineRef.ladder.get(k).preferred || []).length) || 'capsule|active';
const [PRODUCT, ROLE] = PR.split('|');
const latinTerm = B.identityIndex.identities.find(r => r.authority_accepted_name).authority_accepted_name;
const commonRec = B.identityIndex.identities.find(r => (r.common_names || []).length && resolve(null, r.common_names[0], engineRef.exact, engineRef.common).canonical_id === r.canonical_id);
const commonTerm = commonRec.common_names[0];

async function run() {
  // ===== 1. init-once + bundle load-once =====
  { __resetStore(); __resetRate(); const kv = buildFakeKV(B); const env = envWith(kv);
    await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { ip: '203.0.113.8' });
    await call(env, { product: PRODUCT, role: ROLE, botanical: commonTerm }, { ip: '203.0.113.9' });
    const s = __stats();
    ok('init-once: indices built exactly once across 3 requests', s.initCount === 1, 'initCount=' + s.initCount);
    ok('bundle load-once: KV read 4 keys once, not per request', kv.gets === 4 && s.kvGets === 4, 'kv.gets=' + kv.gets + ' storeGets=' + s.kvGets);
  }

  // ===== 2. signature =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const good = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    ok('signature: valid request passes', good.status === 200, 'status=' + good.status);
    const bad = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { badSig: true });
    ok('signature: tampered signature rejected (401)', bad.status === 401, 'status=' + bad.status);
    const none = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { omitSig: true });
    ok('signature: absent signature rejected (401)', none.status === 401, 'status=' + none.status);
    const stale = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { ts: Math.floor(Date.now() / 1000) - 3600 });
    ok('timestamp: stale request rejected (401)', stale.status === 401 && stale.body.error === 'stale_request', 'status=' + stale.status);
  }

  // ===== 3. resolution parity (vs local resolver) =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const partTerm = commonTerm + ' Root';
    // a genuinely ambiguous term = an EXACT common name on >1 identity that still resolves ambiguous
    // (not a quarantined derived key, which correctly resolves to unrecognised)
    let ambigTerm = 'Ajwain';
    for (const [k, s] of engineRef.common) { if (s.size > 1 && statusOf(resolve(null, k, engineRef.exact, engineRef.common)) === 'ambiguous') { ambigTerm = k; break; } }
    const cases = [
      { label: 'latin', term: latinTerm, want: 'resolved' },
      { label: 'common', term: commonTerm, want: 'resolved' },
      { label: 'part_stripped', term: partTerm, want: 'resolved' },
      { label: 'ambiguous', term: ambigTerm, want: 'ambiguous' },
      { label: 'unrecognised', term: 'Xyzzy Blorptonium 42', want: 'unrecognised' },
    ];
    let allParity = true, detail = '';
    for (const c of cases) {
      const local = resolve(null, c.term, engineRef.exact, engineRef.common);
      const localStatus = statusOf(local);
      const r = await call(env, { product: PRODUCT, role: ROLE, botanical: c.term });
      const match = r.body.identity_status === localStatus && r.body.identity.canonical_id === (local.canonical_id || null) && r.body.identity_status === c.want;
      if (!match) { allParity = false; detail += `[${c.label}: worker=${r.body.identity_status}/${r.body.identity.canonical_id} local=${localStatus}/${local.canonical_id} want=${c.want}] `; }
    }
    ok('resolution parity: Stage-1 matches local resolver across all buckets', allParity, detail);
  }

  // ===== 4. token: valid / tampered / expired / client-fabricated =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const spec = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    const token = spec.body.specification_token;
    ok('token: issued on resolved specification', typeof token === 'string' && token.includes('.'), 'token=' + token);
    const good = await call(env, { specification_token: token }, { endpoint: 'procurement' });
    ok('token: valid token accepted at procurement (200)', good.status === 200 && typeof good.body.match_class === 'string', 'status=' + good.status);
    const tamper = token.slice(0, -3) + (token.slice(-3) === 'aaa' ? 'bbb' : 'aaa');
    const bad = await call(env, { specification_token: tamper }, { endpoint: 'procurement' });
    ok('token: tampered token rejected (401)', bad.status === 401, 'status=' + bad.status);
    const expiredTok = await signToken(SECRET, { v: 1, cid: 'x', product: PRODUCT, role: ROLE, best_fit: 'RE', iv: B.manifest.identity_version, gv: B.manifest.observed_form_graph_version, mv: B.manifest.matrix_version }, Math.floor(Date.now() / 1000) - 10000);
    const exp = await call(env, { specification_token: expiredTok }, { endpoint: 'procurement' });
    ok('token: expired token rejected (401)', exp.status === 401 && exp.body.detail === 'expired', 'status=' + exp.status + ' detail=' + exp.body.detail);
    const fabricated = await call(env, { specification_token: token, canonical_id: 'withania-somnifera', best_fit: 'RE' }, { endpoint: 'procurement' });
    ok('token: client-fabricated specification fields rejected (400)', fabricated.status === 400, 'status=' + fabricated.status);
    const noTok = await call(env, { canonical_id: 'x', best_fit: 'RE' }, { endpoint: 'procurement' });
    ok('procurement: missing token rejected (400)', noTok.status === 400, 'status=' + noTok.status);
  }

  // ===== 5. leakage: no supplier identity/counts/provenance in any response body =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const spec = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    const proc = await call(env, { specification_token: spec.body.specification_token }, { endpoint: 'procurement' });
    const hits = [...leakageScan('spec_response', spec.body), ...leakageScan('proc_response', proc.body)];
    ok('leakage: no supplier/provenance fields in any response body', hits.length === 0, hits.join(' | '));
  }

  // ===== 6. rate limit (per-minute threshold = 10) =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    let last;
    for (let i = 0; i < 10; i++) last = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { ip: '198.51.100.5' });
    ok('rate limit: first 10/min from an IP pass', last.status === 200, 'status=' + last.status);
    const over = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm }, { ip: '198.51.100.5' });
    ok('rate limit: 11th within a minute rejected (429)', over.status === 429 && over.body.detail === 'per_minute', 'status=' + over.status + ' detail=' + over.body.detail);
  }

  // ===== 7. degraded: unavailable data yields honest error, never a partial result =====
  { __resetStore(); __resetRate(); const kv = buildFakeKV(B); kv._map.delete('matrix:' + B.manifest.matrix_version); const env = envWith(kv);
    const r = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    ok('degraded: missing bundle => 503 honest error (no partial result)', r.status === 503 && r.body.error === 'degraded' && !r.body.specification, 'status=' + r.status);
  }

  // ===== 8. fail closed on version mismatch =====
  { __resetStore(); __resetRate();
    const bad = { ...B, formGraph: { ...B.formGraph, built_against_identity_version: '1999-01-01.9' } };
    const kv = buildFakeKV(bad); const env = envWith(kv);
    const r = await call(env, { product: PRODUCT, role: ROLE, botanical: latinTerm });
    ok('fail-closed: inconsistent bundle versions => degraded, not mixed snapshot', r.status === 503 && r.body.error === 'degraded' && String(r.body.reason).startsWith('version_mismatch'), 'status=' + r.status + ' reason=' + r.body.reason);
  }

  // ===== 9. no bulk endpoint =====
  { __resetStore(); __resetRate(); const env = envWith(buildFakeKV(B));
    const res = await handleRequest(await specRequest(undefined, { endpoint: 'all-botanicals', method: 'GET' }), env);
    ok('no bulk endpoint: unknown route => 404', res.status === 404, 'status=' + res.status);
  }

  console.log(results.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
