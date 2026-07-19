// ADR-014 Step 1 — Workers feasibility benchmark (size + CPU). Measurement only; nothing deployed.
//
//   node knowledge/benchmarks/adr014_benchmark.js
//
// Produces knowledge/benchmarks/adr014_feasibility.md. Reproducible as the data grows.
// Uses the deployable logic in adr014_worker_logic_stub.js so the CPU numbers time the REAL
// resolution+intersection path and the size numbers reflect the real Worker script.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const W = require('./adr014_worker_logic_stub.js');

const ROOT = path.resolve(__dirname, '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const gz = (s) => zlib.gzipSync(Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)), { level: 9 }).length;
const rawB = (s) => Buffer.byteLength(typeof s === 'string' ? s : JSON.stringify(s));
const KB = (n) => (n / 1024).toFixed(1);
const size = (o) => ({ raw: rawB(o), gz: gz(o) });

// ---------------- load sources ----------------
const backbone = JSON.parse(fs.readFileSync(P('knowledge/identity/botanical_identity.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(P('knowledge/pass3/observed_form_graph.json'), 'utf8'));
const matrixSrc = fs.readFileSync(P('javascript/herbuno-matrix.js'), 'utf8');
const HB_MX = JSON.parse(matrixSrc.slice(matrixSrc.indexOf('=') + 1).replace(/;\s*$/, '').trim());
const stubSrc = fs.readFileSync(P('knowledge/benchmarks/adr014_worker_logic_stub.js'), 'utf8');

// ---------------- runtime-minimal backbone ----------------
const KEEP = ['canonical_id', 'canonical_display_name', 'authority_accepted_name',
  'original_parsed_names', 'scientific_synonyms', 'trade_synonyms', 'common_names', 'resolution_status'];
function minRecord(r) {
  const o = {};
  for (const k of KEEP) if (r[k] !== undefined && r[k] !== null) o[k] = r[k];
  if (r.ambiguity_flag) o.ambiguity_flag = true;
  if (r.candidate_accepted_names && r.candidate_accepted_names.length) o.candidate_accepted_names = r.candidate_accepted_names;
  return o;
}
const minBackbone = {
  identity_version: backbone._meta.identity_version,
  identity_schema_version: backbone._meta.identity_schema_version,
  identities: backbone.identities.map(minRecord),
};

// ---------------- runtime-minimal / storefront-safe form graph ----------------
// Strip supplier identity, supplier counts, observation provenance, source families (ADR-014
// storefront contract). Keep only per-identity form availability the intersection needs.
function minGraph(g) {
  const out = {};
  for (const cid of Object.keys(g.identities)) {
    const node = g.identities[cid]; const pp = {};
    for (const part of Object.keys(node.plant_parts || {})) {
      const forms = {};
      for (const sig of Object.keys(node.plant_parts[part].forms || {})) {
        const f = node.plant_parts[part].forms[sig];
        forms[sig] = { base_format_code: f.base_format_code, overlays: f.overlays || [], observation_status: f.observation_status };
        if (f.ingredient_class) forms[sig].ingredient_class = f.ingredient_class;
      }
      pp[part] = { forms };
    }
    out[cid] = { canonical_display_name: node.canonical_display_name, authority_accepted_name: node.authority_accepted_name, plant_parts: pp };
  }
  return { identity_version: g._meta.identity_version, observed_form_graph_version: g._meta.build_date || g._meta.identity_version, identities: out };
}
const minFormGraph = minGraph(graph);

// ---------------- sizes ----------------
const sizes = {
  backbone_full: size(backbone),
  backbone_min: size(minBackbone),
  graph_full: size(graph),
  graph_min: size(minFormGraph),
  matrix: size(matrixSrc),
  worker_logic: size(stubSrc),
};
// deployed runtime datasets (what a leaked bundle exposes) = minimal backbone + minimal graph
const runtimeDatasetsGz = sizes.backbone_min.gz + sizes.graph_min.gz;
// bundle scenarios
const bundle_logic_only_gz = sizes.worker_logic.gz;                        // data in KV/R2
const bundle_all_gz = gz(stubSrc + JSON.stringify(minBackbone) + JSON.stringify(minFormGraph)); // data embedded

// ---------------- engine (startup / index build cost) ----------------
function hrms(t0) { return Number(process.hrtime.bigint() - t0) / 1e6; }
const peak = { heap: 0, rss: 0 };
function sampleMem() { const m = process.memoryUsage(); peak.heap = Math.max(peak.heap, m.heapUsed); peak.rss = Math.max(peak.rss, m.rss); }
sampleMem();

const buildTimes = [];
let engine;
const memBeforeEngine = process.memoryUsage().heapUsed;
for (let i = 0; i < 6; i++) { const t0 = process.hrtime.bigint(); engine = W.makeEngine(minBackbone, minFormGraph, HB_MX); buildTimes.push(hrms(t0)); }
const engineHeapDelta = Math.max(0, process.memoryUsage().heapUsed - memBeforeEngine); // approx retained index footprint
buildTimes.sort((a, b) => a - b);
const indexBuildMs = buildTimes[Math.floor(buildTimes.length / 2)]; // median of repeats
sampleMem();

// ---------------- query set (>=200, representative buckets) ----------------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260719);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const withCommon = backbone.identities.filter(r => (r.common_names || []).length);
const PARTS = ['Root', 'Bark', 'Leaf', 'Seed', 'Powder', 'Extract'];
// known-ambiguous terms: collision quarantine keys + trade_ambiguous common names
const AMBIG = ['Bay', 'Cinnamon', 'Gaozaban', 'Gokhru', 'Jasmine', 'Nagarmotha', 'Passion',
  'Rose Petal', 'Sarsaparilla', 'Soap', 'Kelp', 'Gond', 'Ratanjot', 'Catuaba', 'Cedar',
  'Gooseberry', 'Wormseed', 'Mesquite', 'Rosewood', 'Shankhpushpi'];
const GIBBERISH = ['Xyzzy Blorptonium', 'Quffle Root', 'Zzntar', 'Vurpil Extract', 'Krelbo', 'Nonsuchia plantae'];
const N_PER = 45;
const queries = [];
for (let i = 0; i < N_PER; i++) {                              // recognised Latin
  const r = pick(backbone.identities);
  const nm = r.authority_accepted_name || (r.original_parsed_names || [])[0];
  if (nm) queries.push({ bucket: 'latin', term: nm });
}
for (let i = 0; i < N_PER; i++) queries.push({ bucket: 'common', term: pick(pick(withCommon).common_names) });
for (let i = 0; i < N_PER; i++) queries.push({ bucket: 'part_stripped', term: pick(pick(withCommon).common_names) + ' ' + pick(PARTS) });
for (let i = 0; i < N_PER; i++) queries.push({ bucket: 'ambiguous', term: pick(AMBIG) });
for (let i = 0; i < N_PER; i++) queries.push({ bucket: 'unrecognised', term: pick(GIBBERISH) + ' ' + i });
const prKeys = [...engine.ladder.keys()];
for (const q of queries) q.prk = pick(prKeys);

// ---------------- Stage-1 CPU ----------------
for (let w = 0; w < 5; w++) for (const q of queries) W.stage1(engine, q.term, q.prk); // JIT warmup
const s1 = []; const byBucket = {};
for (const q of queries) {
  const t0 = process.hrtime.bigint();
  const spec = W.stage1(engine, q.term, q.prk);
  const ms = hrms(t0);
  s1.push(ms);
  (byBucket[q.bucket] = byBucket[q.bucket] || []).push(ms);
  q._status = spec.identity.status;
}
sampleMem();

// ---------------- Stage-2 CPU ----------------
const resolvedIds = queries.map(q => W.resolve(null, q.term, engine.exact, engine.common).canonical_id).filter(Boolean);
const s2targets = resolvedIds.map(cid => ({ cid, fmt: pick(['RE', 'SD', 'MP', 'WL', 'OE', 'CO']) }));
for (let w = 0; w < 5; w++) for (const t of s2targets) W.stage2(engine, t.cid, t.fmt);
const s2 = [];
for (const t of s2targets) { const t0 = process.hrtime.bigint(); W.stage2(engine, t.cid, t.fmt); s2.push(hrms(t0)); }
sampleMem();

// per-response payload weight (one spec) — leak-per-request and wire cost
const sampleSpec = W.stage1(engine, 'Withania somnifera', prKeys[0]);
const responseSize = size(sampleSpec);

// ---------------- stats ----------------
function stat(a) { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { median: q(0.5), p95: q(0.95), max: s[s.length - 1], n: s.length }; }
const S1 = stat(s1), S2 = stat(s2);
const bucketResolve = {};
for (const q of queries) { const b = bucketResolve[q.bucket] = bucketResolve[q.bucket] || {}; b[q._status] = (b[q._status] || 0) + 1; }

// ---------------- verdict ----------------
const CPU_LIMIT = 10, SAFE = CPU_LIMIT / 3;               // "within ~3x is not safe"
const cpuWorst = Math.max(S1.p95, S1.max, S2.p95, S2.max);
const cpuFlag = cpuWorst > SAFE;
const logicUnder3MB = bundle_logic_only_gz < 3 * 1024 * 1024;
const kvOK = sizes.backbone_min.gz < 25 * 1024 * 1024 && sizes.graph_min.gz < 25 * 1024 * 1024;
let verdict, verdictNote;
if (!cpuFlag && logicUnder3MB && kvOK) {
  verdict = 'FREE TIER VIABLE';
  verdictNote = 'CPU is far under the 10 ms budget; Worker script (logic only) is well under 3 MB; ' +
    'runtime datasets fit KV/R2 comfortably. Data must live in KV/R2/static assets (not bundled).';
} else if (cpuFlag && cpuWorst < CPU_LIMIT) {
  verdict = 'PAID TIER RECOMMENDED (CPU margin)';
  verdictNote = 'A hot path is within ~3x of the 10 ms free limit — margin not safe as data grows.';
} else if (cpuWorst >= CPU_LIMIT) {
  verdict = 'NEEDS RESTRUCTURING';
  verdictNote = 'Per-request CPU meets/exceeds 10 ms even locally; restructure before deploying.';
} else {
  verdict = 'PAID TIER NEEDED (size)';
  verdictNote = 'Script bundle exceeds the 3 MB compressed budget; move data out or take the paid tier.';
}

// ---------------- write report ----------------
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const L = [];
L.push('# ADR-014 Step 1 — Cloudflare Workers feasibility benchmark');
L.push('');
L.push('> Measurement only — no Worker deployed, no Shopify app, no client changes. Reproduce with');
L.push('> `node knowledge/benchmarks/adr014_benchmark.js`. Generated: `' + now + '`.');
L.push('> Backbone `identity_version ' + backbone._meta.identity_version + '` (' + backbone._meta.identity_records + ' records), matrix `' + HB_MX.schema_version + '`.');
L.push('');
L.push('## Verdict: **' + verdict + '**');
L.push('');
L.push(verdictNote);
L.push('');
L.push('**Workers Free limits:** 10 ms CPU/request · 3 MB compressed script · 128 MB memory · 100k req/day.');
L.push('');
L.push('## 1. Data size (raw / gzipped)');
L.push('');
L.push('| payload | raw KB | gzip KB | role |');
L.push('|---|---:|---:|---|');
L.push('| botanical_identity.json (full) | ' + KB(sizes.backbone_full.raw) + ' | ' + KB(sizes.backbone_full.gz) + ' | authoring artifact |');
L.push('| **backbone — runtime-minimal** | ' + KB(sizes.backbone_min.raw) + ' | **' + KB(sizes.backbone_min.gz) + '** | **deployed dataset** |');
L.push('| observed_form_graph.json (full) | ' + KB(sizes.graph_full.raw) + ' | ' + KB(sizes.graph_full.gz) + ' | authoring artifact (has supplier IP) |');
L.push('| **form graph — runtime-minimal / storefront-safe** | ' + KB(sizes.graph_min.raw) + ' | **' + KB(sizes.graph_min.gz) + '** | **deployed dataset** |');
L.push('| herbuno-matrix.js (data payload) | ' + KB(sizes.matrix.raw) + ' | ' + KB(sizes.matrix.gz) + ' | deployed dataset |');
L.push('| worker logic (stub) | ' + KB(sizes.worker_logic.raw) + ' | ' + KB(sizes.worker_logic.gz) + ' | Worker script |');
L.push('');
L.push('**Runtime-minimal reduction:** backbone ' + KB(sizes.backbone_full.gz) + ' → ' + KB(sizes.backbone_min.gz) + ' KB gz (' +
  (100 - 100 * sizes.backbone_min.gz / sizes.backbone_full.gz).toFixed(0) + '% smaller); form graph ' +
  KB(sizes.graph_full.gz) + ' → ' + KB(sizes.graph_min.gz) + ' KB gz (' +
  (100 - 100 * sizes.graph_min.gz / sizes.graph_full.gz).toFixed(0) + '% smaller, and supplier IP removed).');
L.push('');
L.push('### Worker bundle (the deployment artifact)');
L.push('');
L.push('| bundle component | gzip KB |');
L.push('|---|---:|');
L.push('| runtime datasets (min backbone + min graph) | ' + KB(runtimeDatasetsGz) + ' |');
L.push('| + matrix data | ' + KB(sizes.matrix.gz) + ' |');
L.push('| worker logic (stub) | ' + KB(sizes.worker_logic.gz) + ' |');
L.push('| **estimate: logic-only script (data in KV/R2)** | **' + KB(bundle_logic_only_gz) + '** |');
L.push('| estimate: everything embedded in the script | ' + KB(bundle_all_gz) + ' |');
L.push('');
L.push('- **Overhead:** these are compressed *script/data* bytes only. Plain ES module — **no web');
L.push('  framework**, so no framework overhead is included. The V8 isolate/Workers runtime is the');
L.push('  platform\'s and is **not** counted against the 3 MB script budget.');
L.push('- The recommended shape ships **logic only** in the Worker (~' + KB(bundle_logic_only_gz) + ' KB gz) with data in KV/R2,');
L.push('  which sits far under 3 MB. Embedding everything (' + KB(bundle_all_gz) + ' KB gz) also fits today but couples data');
L.push('  redeploys to the script and erodes headroom as the graph grows — not recommended.');
L.push('');
L.push('## 2. CPU cost per resolution');
L.push('');
L.push('| operation | median ms | p95 ms | max ms | n |');
L.push('|---|---:|---:|---:|---:|');
L.push('| Stage-1 specification (warm) | ' + S1.median.toFixed(4) + ' | ' + S1.p95.toFixed(4) + ' | ' + S1.max.toFixed(4) + ' | ' + S1.n + ' |');
L.push('| Stage-2 procurement match (warm) | ' + S2.median.toFixed(4) + ' | ' + S2.p95.toFixed(4) + ' | ' + S2.max.toFixed(4) + ' | ' + S2.n + ' |');
L.push('');
L.push('- **Startup / index build (one-off warm cost, NOT per-request):** ' + indexBuildMs.toFixed(3) + ' ms (median of 6 builds) — ' +
  'builds the identity indices (' + engine.stats.records + ' records, ' + engine.stats.resolved + ' collision resolutions, ' + engine.stats.quarantined + ' quarantined), ladder index, and form-availability index.');
L.push('  ⚠️ This is of the **same order as the 10 ms per-request budget** (and can exceed it across runs — JIT-dependent), ' +
  'so it must run **once at isolate initialisation** (global scope / lazy-once), amortised across the isolate\'s request ' +
  'lifetime — **never rebuilt per request**. A cold isolate pays it once (index build + one KV cold read); every subsequent ' +
  'request on that isolate hits only the warm ' + S1.median.toFixed(4) + ' ms path. Rebuilding the index per request would ' +
  'on its own consume most of / exceed the free-tier budget — so init-once is a hard requirement, not an optimisation.');
L.push('- **Memory:** this benchmark process also holds the full 8 MB authoring graph + full backbone (loaded only for ' +
  'sizing) plus the Node runtime, so its rss (~' + (peak.rss / 1048576).toFixed(0) + ' MB) and heapUsed (~' + (peak.heap / 1048576).toFixed(0) + ' MB) **overstate** the Worker. ' +
  'The Worker-relevant working set is the minimal datasets (~' + KB(sizes.backbone_min.raw + sizes.graph_min.raw) + ' KB raw parsed) plus the derived indices ' +
  '(~' + (engineHeapDelta / 1048576).toFixed(1) + ' MB heap delta to build them) — comfortably within the 128 MB limit.');
L.push('- **Per-response payload:** one specification object = ' + KB(responseSize.raw) + ' KB raw / ' + KB(responseSize.gz) + ' KB gz (response minimisation: only the selected spec).');
L.push('');
L.push('Resolution mix (confirms the sample exercises every path):');
L.push('');
L.push('| bucket | statuses |');
L.push('|---|---|');
for (const b of ['latin', 'common', 'part_stripped', 'ambiguous', 'unrecognised']) {
  const m = bucketResolve[b] || {};
  L.push('| ' + b + ' | ' + Object.entries(m).map(([k, v]) => k + ':' + v).join(', ') + ' |');
}
L.push('');
L.push('**Honest caveat (stated per brief):** local Node timing is **not** Workers CPU time — different');
L.push('runtime, and Workers meters CPU excluding I/O wait. Treat these as an **order-of-magnitude**');
L.push('indicator, not a verdict. ' + (cpuFlag
  ? '⚠️ A hot path is within ~3× of the 10 ms limit — margin **not safe**, re-measure on Workers.'
  : 'The worst hot path (' + cpuWorst.toFixed(4) + ' ms) is **>' + (SAFE / cpuWorst).toFixed(0) + '×** under the 3 ms safety line (10 ms / 3), ' +
    'so even a large runtime discrepancy keeps a comfortable margin.'));
L.push('');
L.push('## 3. Storage shape');
L.push('');
L.push('| option | fit | cold-read latency | versioning / redeploy | headroom |');
L.push('|---|---|---|---|---|');
L.push('| **KV (recommended)** | min backbone ' + KB(sizes.backbone_min.gz) + ' KB + min graph ' + KB(sizes.graph_min.gz) + ' KB, each one value, far under KV\'s 25 MB/value | ~low-tens ms cold, then edge-cached | write new versioned keys (e.g. `backbone:<identity_version>`); Worker pins versions; atomic-ish cutover | huge — datasets are KB, limit is MB |');
L.push('| R2 / static assets | same data as objects | similar; good for large blobs | object per version; cache-control | effectively unlimited |');
L.push('| bundle in Worker script | fits today (' + KB(bundle_all_gz) + ' KB gz < 3 MB) | none (in-memory) | **every data change = full script redeploy**; couples data to code | erodes as graph grows |');
L.push('| D1 (SQL) | n/a | query latency | migrations | **only if relational queries become necessary** — current access is pure key→record, so D1 is unjustified |');
L.push('');
L.push('**Recommendation:** **logic in the Worker script, data in KV** (backbone + storefront-safe form');
L.push('graph + matrix as versioned keys). Per-request access is a handful of `Map` lookups over indices');
L.push('built once at isolate warm-up, so KV cold-read is paid at most once per isolate, not per request.');
L.push('D1 only if a future feature needs relational queries. Private supplier provenance stays in a');
L.push('separate non-public dataset, never in the storefront KV namespace (ADR-014).');
L.push('');
L.push('## 4. Leak exposure');
L.push('');
L.push('If the Worker script *and* its KV data were fully extracted, the exposed knowledge would be the');
L.push('**runtime-minimal** payloads only: backbone ' + KB(sizes.backbone_min.gz) + ' KB gz (identity + resolution aliases, **no** provenance,');
L.push('GBIF metadata, review history or merge records) and the storefront-safe form graph ' + KB(sizes.graph_min.gz) + ' KB gz');
L.push('(**no** supplier identity, counts, observation provenance or source families). The authoring');
L.push('artifacts (full backbone provenance, 8 MB observation-level graph, supplier registry) are never');
L.push('shipped and cannot be reconstructed from the deployed data. This is the ADR-014 objective met structurally.');
L.push('');
fs.writeFileSync(P('knowledge/benchmarks/adr014_feasibility.md'), L.join('\n') + '\n');

// ---------------- console summary ----------------
console.log('VERDICT:', verdict, '—', verdictNote);
console.log('payload sizes (gzip KB): backbone_full=%s  backbone_min=%s  graph_full=%s  graph_min=%s  matrix=%s  worker_logic=%s',
  KB(sizes.backbone_full.gz), KB(sizes.backbone_min.gz), KB(sizes.graph_full.gz), KB(sizes.graph_min.gz), KB(sizes.matrix.gz), KB(sizes.worker_logic.gz));
console.log('bundle gz: logic-only=%s KB  everything-embedded=%s KB  (limit 3072 KB)', KB(bundle_logic_only_gz), KB(bundle_all_gz));
console.log('CPU stage1 (ms): median=%s p95=%s max=%s | stage2 median=%s p95=%s max=%s | index-build=%s ms | peak heap=%s MB',
  S1.median.toFixed(4), S1.p95.toFixed(4), S1.max.toFixed(4), S2.median.toFixed(4), S2.p95.toFixed(4), S2.max.toFixed(4),
  indexBuildMs.toFixed(3), (peak.heap / 1048576).toFixed(1));
console.log('per-response spec: %s KB raw / %s KB gz | queries=%d | wrote knowledge/benchmarks/adr014_feasibility.md', KB(responseSize.raw), KB(responseSize.gz), queries.length);
