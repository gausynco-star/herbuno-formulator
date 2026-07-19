# worker/ — ADR-014 server-side knowledge backend

Implements ADR-014 (see `docs/DECISION_LOG.md`): the Product × Role matrix, identity backbone, and
observed-form graph, plus all resolution/intersection logic, run in a **Cloudflare Worker** behind a
**Shopify App Proxy**. The browser never receives the knowledge graph.

**Status: built + locally tested, NOT deployed.** Client wiring (`javascript/blend-builder.js`) is
Step 3 and is untouched here.

## Layout

```
worker/
  src/
    index.js      fetch handler + pipeline (signature → timestamp → allow-list → rate limit → resolve)
    engine.js     resolution + Product×Role intersection + spec build (indices built once/isolate)
    security.js   App Proxy signature, timestamp freshness, input allow-list, rate limit
    token.js      short-lived signed specification_token (Stage 1 → Stage 2 bridge)
    store.js      load-once KV bundle cache, module-scope retention, fail-closed version check
    version.js    version contract, tunables, degraded message
    hmac.js       Web Crypto helpers (work identically in Workers and Node)
  tools/generate_payloads.js   runtime-minimal payload generator + mandatory leakage test (committed)
  test/run_tests.js            local suite (no framework); `node test/run_tests.js`
  data/                        generated bundles (gitignored — reproduce with the generator)
  wrangler.toml.example        deployment config template (no secrets)
```

## Run locally

```bash
node worker/tools/generate_payloads.js   # writes worker/data/*.json, runs the leakage test
node worker/test/run_tests.js            # 19 assertions, no deployment
```

The generator reads the frozen sources (`knowledge/identity/botanical_identity.json`,
`knowledge/pass3/observed_form_graph.json`, `javascript/herbuno-matrix.js`) and emits the
**runtime-minimal, storefront-safe** bundles — provenance, GBIF metadata, review/merge history,
supplier identity, supplier counts, observation provenance, and source families are all stripped. The
leakage test fails the build if any of those appear in a payload.

## Endpoints (via App Proxy: `https://<shop>/apps/formulator/*`)

- **`POST /apps/formulator/specification`** — in: `product`, `role`, `botanical` (+ optional
  `session_id`). Out: `identity_status` (`resolved`/`ambiguous`/`unrecognised`), display identity,
  specification object, `technical_explanation`, `version` block, and a short-lived signed
  `specification_token` (only when a single identity resolves).
- **`POST /apps/formulator/procurement`** — in: `specification_token` only. Any extra field is
  rejected, so the client cannot fabricate or alter a specification. Out: `match_class`,
  `product_handles`, `sourcing_route`, `version`.

Response minimisation: only the selected specification is returned. **No bulk endpoint exists.**

## Version contract

Every response carries `api_schema_version`, `matrix_version`, `identity_version`,
`observed_form_graph_version`, `response_generated_at`. The `specification_token` embeds the snapshot
versions; procurement rejects a token whose snapshot differs from the currently loaded bundles. On any
version inconsistency the Worker **fails closed** with the honest degraded message — never a mixed or
partial result.

## KV key scheme

A pointer key names the current versions; bundles live under version-stamped keys, so bumping
`identity_version` is a data change (write new bundles + update the pointer) with **no Worker
redeploy**.

| key | value |
|---|---|
| `manifest:current` | `{ api_schema_version, identity_version, observed_form_graph_version, matrix_version }` |
| `identity:<identity_version>` | identity index bundle |
| `formgraph:<observed_form_graph_version>` | storefront-safe form graph bundle |
| `matrix:<matrix_version>` | matrix data bundle |

The Worker reads the pointer once per isolate, loads the three bundles, verifies cross-consistency,
builds the indices **once**, and retains everything in module scope for the isolate's lifetime. KV
caching is not automatic — `store.js` *is* the cache. (See ADR-014 §0/§4 and Step-1 benchmark:
per-request rebuilds would blow the 10 ms CPU budget.)

---

## What Krantik must create before deploy (owner prerequisites)

Claude Code does **not** deploy. To go live you will need to:

1. **Cloudflare account** + Workers enabled. Free tier is sufficient per the Step-1 benchmark.
2. **KV namespace** (e.g. `HB_KV`). Bind it in `wrangler.toml` (copy from `wrangler.toml.example`).
3. **Shopify custom app** with **App Proxy** configured to forward `/apps/formulator/*` to the Worker
   URL. Note the app's **shared secret**.
4. **Worker secret** — store the Shopify shared secret; it is **never committed**:
   ```bash
   wrangler secret put SHOPIFY_APP_SECRET
   ```
5. **Upload the bundles to KV** (regenerate whenever the backbone/graph/matrix changes):
   ```bash
   node worker/tools/generate_payloads.js
   wrangler kv key put --binding=HB_KV "manifest:current"                  --path worker/data/manifest.json
   wrangler kv key put --binding=HB_KV "identity:<identity_version>"        --path worker/data/identity_index.json
   wrangler kv key put --binding=HB_KV "formgraph:<observed_form_graph_version>" --path worker/data/form_graph.json
   wrangler kv key put --binding=HB_KV "matrix:<matrix_version>"            --path worker/data/matrix.json
   ```
   (The generator prints the exact key names for the current versions.)
6. `wrangler deploy`.

**Secrets rule:** the shared secret lives only as a Worker secret (or local `.dev.vars`, gitignored).
Never in the repo. `SHOPIFY_APP_SECRET` is read from `env` — the code contains no secret.

## Known limitations (Step-3+ hardening, deliberately not done here)

- **Rate limiting is per-isolate** (in-memory module scope). Cross-isolate limits need Durable Objects
  or a KV/counter service — wire that when tuning from live telemetry.
- **App Proxy signature** proves Shopify forwarded an untampered request; it does **not** prove the
  caller is the Formulator UI, and anonymous proxy calls are supported (ADR-014). The other controls
  (timestamp, allow-list, rate limit) exist because of this.
- **Turnstile** is deliberately deferred until there is live telemetry (ADR-014 §6).
- **`product_handles` is empty**: real Herbuno catalogue matching needs the off-repo catalogue, wired
  in Step 3. Stage-2 `match_class` currently uses the observed-form graph as a stock proxy.
- No client changes; `javascript/blend-builder.js` is untouched (Step 3).
