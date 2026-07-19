// ADR-014 Step-2b BLOCKER 2 — real Workers/Durable Object integration tests via Miniflare (workerd).
// Local only; no Cloudflare account. Run: node worker/test/integration_do.mjs
// Covers DO routing end-to-end, storage persistence across restart, concurrent-update integrity,
// fail-closed on a missing DO binding, and DO round-trip latency.
import { Miniflare } from 'miniflare';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { signProxyQuery } from '../src/security.js';
import { resolve, makeEngine } from '../src/engine.js';
import { DEGRADED_MESSAGE } from '../src/version.js';
import { generateAll } from '../tools/generate_payloads.js';

const SECRET = 'shpss_integration_secret';
const TOKEN_SECRET = 'spectok_integration_secret';
const B = generateAll();
const eng = makeEngine(B.identityIndex, B.formGraph, B.matrix);
const PR = [...eng.ladder.keys()].find(k => (eng.ladder.get(k).preferred || []).length);
const [PRODUCT, ROLE] = PR.split('|');
let BOTANICAL = 'Withania somnifera';
for (const r of B.identityIndex.identities) { if ((r.common_names || []).length && resolve(null, r.common_names[0], eng.exact, eng.common).canonical_id === r.canonical_id) { BOTANICAL = r.common_names[0]; break; } }

let pass = 0, fail = 0; const out = [];
function ok(name, cond, detail) { (cond ? pass++ : fail++); out.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); }

function mfOptions({ persist, withDO = true } = {}) {
  const o = {
    modules: true,
    scriptPath: path.resolve('src/index.js'),
    modulesRoot: path.resolve('src'),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-07-19',
    kvNamespaces: ['HB_KV'],
    bindings: { SHOPIFY_APP_SECRET: SECRET, SPECIFICATION_TOKEN_SECRET: TOKEN_SECRET },
  };
  if (withDO) o.durableObjects = { RATE_LIMITER: 'RateLimiterDurableObject' };
  if (persist) o.durableObjectsPersist = persist;
  return o;
}
async function seedKV(mf) {
  const kv = await mf.getKVNamespace('HB_KV');
  await kv.put('manifest:current', JSON.stringify(B.manifest));
  await kv.put('identity:' + B.manifest.identity_version, JSON.stringify(B.identityIndex));
  await kv.put('formgraph:' + B.manifest.observed_form_graph_version, JSON.stringify(B.formGraph));
  await kv.put('matrix:' + B.manifest.matrix_version, JSON.stringify(B.matrix));
}
async function specFetch(mf, body, { ip = '203.0.113.7', endpoint = 'specification' } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const params = { shop: 'h.myshopify.com', path_prefix: '/apps/formulator', timestamp: String(ts) };
  const sig = await signProxyQuery(params, SECRET);
  const qs = new URLSearchParams(params); qs.set('signature', sig);
  const res = await mf.dispatchFetch('https://herbuno.com/apps/formulator/' + endpoint + '?' + qs.toString(),
    { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
// Direct DO call (internal; the public Worker never sends action:'stat') for precise stat/concurrency.
async function doCall(mf, payload) {
  const ns = await mf.getDurableObjectNamespace('RATE_LIMITER');
  const stub = ns.get(ns.idFromName('global'));
  const res = await stub.fetch('https://do/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return res.json();
}
const stat = (mf, key) => doCall(mf, { action: 'stat', key });

async function run() {
  // ---------- 1. end-to-end DO routing + 3. concurrency + 5. latency (one instance) ----------
  const mfA = new Miniflare(mfOptions());
  await seedKV(mfA);

  const r1 = await specFetch(mfA, { product: PRODUCT, role: ROLE, botanical: BOTANICAL }, { ip: '203.0.113.10' });
  const s1 = await stat(mfA, 'm:203.0.113.10');
  ok('DO routing: valid request 200 and the DO recorded the IP end-to-end', r1.status === 200 && s1.count === 1, 'status=' + r1.status + ' count=' + s1.count);

  // concurrency: 25 parallel DO calls, same key -> every increment must land (single-threaded DO)
  const NOW = Date.now();
  await Promise.all(Array.from({ length: 25 }, () => doCall(mfA, { key: 'conc-ip', botanical: 'x', now: NOW })));
  const sc = await stat(mfA, 'm:conc-ip');
  ok('concurrency: 25 parallel updates, no lost writes (count === 25)', sc.count === 25, 'count=' + sc.count);

  // latency: a few hundred DO round trips
  const lat = [];
  for (let i = 0; i < 300; i++) { const t = performance.now(); await doCall(mfA, { key: 'lat-' + i, now: NOW }); lat.push(performance.now() - t); }
  lat.sort((a, b) => a - b);
  const median = lat[150], p95 = lat[Math.floor(0.95 * 300)], max = lat[299];
  await mfA.dispose();

  // ---------- 2. restart / persistence (retain storage across dispose+recreate) ----------
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-do-'));
  const P_NOW = Date.now();
  const mfB1 = new Miniflare(mfOptions({ persist: persistDir }));
  for (let i = 0; i < 5; i++) await doCall(mfB1, { key: 'persist-ip', botanical: 'b' + i, now: P_NOW });
  const before = await stat(mfB1, 'm:persist-ip');
  await mfB1.dispose(); // instance gone, storage retained on disk

  const mfB2 = new Miniflare(mfOptions({ persist: persistDir })); // fresh instance, same storage
  const after = await stat(mfB2, 'm:persist-ip');
  // one more request continues from the persisted count, not from zero
  await doCall(mfB2, { key: 'persist-ip', botanical: 'b-extra', now: P_NOW });
  const continued = await stat(mfB2, 'm:persist-ip');
  await mfB2.dispose();
  ok('persistence: minute counter survives DO restart (5 before, 5 after reload)', before.count === 5 && after.count === 5, 'before=' + before.count + ' after=' + after.count);
  ok('persistence: enforcement continues from persisted state (6th increment lands)', continued.count === 6, 'continued=' + continued.count);

  // ---------- 4. fail-closed when the DO binding is absent ----------
  const mfC = new Miniflare(mfOptions({ withDO: false }));
  await seedKV(mfC);
  const rc = await specFetch(mfC, { product: PRODUCT, role: ROLE, botanical: BOTANICAL }, { ip: '203.0.113.20' });
  await mfC.dispose();
  ok('fail-closed: missing DO binding => 503 degraded, no silent fallback to the isolate limiter',
    rc.status === 503 && rc.body.message === DEGRADED_MESSAGE, 'status=' + rc.status);

  fs.rmSync(persistDir, { recursive: true, force: true });

  console.log(out.join('\n'));
  console.log('\nDO round-trip latency over 300 local Miniflare calls (order-of-magnitude — NOT edge latency):');
  console.log('  median ' + median.toFixed(3) + ' ms | p95 ' + p95.toFixed(3) + ' ms | max ' + max.toFixed(3) + ' ms');
  console.log('  NOTE: local Miniflare latency is not production edge latency; treat as order-of-magnitude.');
  console.log('  This DO round trip now dominates the per-request budget (Step-1 resolution was ~0.005 ms).');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(1); });
