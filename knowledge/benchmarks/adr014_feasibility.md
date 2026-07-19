# ADR-014 Step 1 — Cloudflare Workers feasibility benchmark

> Measurement only — no Worker deployed, no Shopify app, no client changes. Reproduce with
> `node knowledge/benchmarks/adr014_benchmark.js`. Generated: `2026-07-19T08:53:00Z`.
> Backbone `identity_version 2026-07-19.4` (826 records), matrix `v8-ladder-ordered`.

## Verdict: **FREE TIER VIABLE**

CPU is far under the 10 ms budget; Worker script (logic only) is well under 3 MB; runtime datasets fit KV/R2 comfortably. Data must live in KV/R2/static assets (not bundled).

**Workers Free limits:** 10 ms CPU/request · 3 MB compressed script · 128 MB memory · 100k req/day.

## 1. Data size (raw / gzipped)

| payload | raw KB | gzip KB | role |
|---|---:|---:|---|
| botanical_identity.json (full) | 661.1 | 60.8 | authoring artifact |
| **backbone — runtime-minimal** | 255.4 | **33.9** | **deployed dataset** |
| observed_form_graph.json (full) | 4862.3 | 159.2 | authoring artifact (has supplier IP) |
| **form graph — runtime-minimal / storefront-safe** | 563.9 | **25.6** | **deployed dataset** |
| herbuno-matrix.js (data payload) | 108.5 | 16.8 | deployed dataset |
| worker logic (stub) | 11.0 | 4.2 | Worker script |

**Runtime-minimal reduction:** backbone 60.8 → 33.9 KB gz (44% smaller); form graph 159.2 → 25.6 KB gz (84% smaller, and supplier IP removed).

### Worker bundle (the deployment artifact)

| bundle component | gzip KB |
|---|---:|
| runtime datasets (min backbone + min graph) | 59.6 |
| + matrix data | 16.8 |
| worker logic (stub) | 4.2 |
| **estimate: logic-only script (data in KV/R2)** | **4.2** |
| estimate: everything embedded in the script | 64.2 |

- **Overhead:** these are compressed *script/data* bytes only. Plain ES module — **no web
  framework**, so no framework overhead is included. The V8 isolate/Workers runtime is the
  platform's and is **not** counted against the 3 MB script budget.
- The recommended shape ships **logic only** in the Worker (~4.2 KB gz) with data in KV/R2,
  which sits far under 3 MB. Embedding everything (64.2 KB gz) also fits today but couples data
  redeploys to the script and erodes headroom as the graph grows — not recommended.

## 2. CPU cost per resolution

| operation | median ms | p95 ms | max ms | n |
|---|---:|---:|---:|---:|
| Stage-1 specification (warm) | 0.0020 | 0.0046 | 0.5822 | 225 |
| Stage-2 procurement match (warm) | 0.0003 | 0.0004 | 0.0201 | 143 |

- **Startup / index build (one-off warm cost, NOT per-request):** 6.298 ms (median of 6 builds) — builds the identity indices (826 records, 9 collision resolutions, 10 quarantined), ladder index, and form-availability index.
  ⚠️ This is of the **same order as the 10 ms per-request budget** (and can exceed it across runs — JIT-dependent), so it must run **once at isolate initialisation** (global scope / lazy-once), amortised across the isolate's request lifetime — **never rebuilt per request**. A cold isolate pays it once (index build + one KV cold read); every subsequent request on that isolate hits only the warm 0.0020 ms path. Rebuilding the index per request would on its own consume most of / exceed the free-tier budget — so init-once is a hard requirement, not an optimisation.
- **Memory:** this benchmark process also holds the full 8 MB authoring graph + full backbone (loaded only for sizing) plus the Node runtime, so its rss (~146 MB) and heapUsed (~23 MB) **overstate** the Worker. The Worker-relevant working set is the minimal datasets (~819.3 KB raw parsed) plus the derived indices (~0.4 MB heap delta to build them) — comfortably within the 128 MB limit.
- **Per-response payload:** one specification object = 0.5 KB raw / 0.3 KB gz (response minimisation: only the selected spec).

Resolution mix (confirms the sample exercises every path):

| bucket | statuses |
|---|---|
| latin | accepted_name_exact:45 |
| common | common_name_exact_unique:43, unresolved:1, accepted_name_exact:1 |
| part_stripped | common_name_exact_unique:44, ambiguous:1 |
| ambiguous | unresolved:32, ambiguous:3, common_name_exact_unique:8, original_parsed_name_exact:2 |
| unrecognised | unresolved:45 |

**Honest caveat (stated per brief):** local Node timing is **not** Workers CPU time — different
runtime, and Workers meters CPU excluding I/O wait. Treat these as an **order-of-magnitude**
indicator, not a verdict. The worst hot path (0.5822 ms) is **>6×** under the 3 ms safety line (10 ms / 3), so even a large runtime discrepancy keeps a comfortable margin.

## 3. Storage shape

| option | fit | cold-read latency | versioning / redeploy | headroom |
|---|---|---|---|---|
| **KV (recommended)** | min backbone 33.9 KB + min graph 25.6 KB, each one value, far under KV's 25 MB/value | ~low-tens ms cold, then edge-cached | write new versioned keys (e.g. `backbone:<identity_version>`); Worker pins versions; atomic-ish cutover | huge — datasets are KB, limit is MB |
| R2 / static assets | same data as objects | similar; good for large blobs | object per version; cache-control | effectively unlimited |
| bundle in Worker script | fits today (64.2 KB gz < 3 MB) | none (in-memory) | **every data change = full script redeploy**; couples data to code | erodes as graph grows |
| D1 (SQL) | n/a | query latency | migrations | **only if relational queries become necessary** — current access is pure key→record, so D1 is unjustified |

**Recommendation:** **logic in the Worker script, data in KV** (backbone + storefront-safe form
graph + matrix as versioned keys). Per-request access is a handful of `Map` lookups over indices
built once at isolate warm-up, so KV cold-read is paid at most once per isolate, not per request.
D1 only if a future feature needs relational queries. Private supplier provenance stays in a
separate non-public dataset, never in the storefront KV namespace (ADR-014).

## 4. Leak exposure

If the Worker script *and* its KV data were fully extracted, the exposed knowledge would be the
**runtime-minimal** payloads only: backbone 33.9 KB gz (identity + resolution aliases, **no** provenance,
GBIF metadata, review history or merge records) and the storefront-safe form graph 25.6 KB gz
(**no** supplier identity, counts, observation provenance or source families). The authoring
artifacts (full backbone provenance, 8 MB observation-level graph, supplier registry) are never
shipped and cannot be reconstructed from the deployed data. This is the ADR-014 objective met structurally.

