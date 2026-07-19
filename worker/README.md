# worker/ — ADR-014 server-side knowledge backend

Implements ADR-014 (see `docs/DECISION_LOG.md`): the Product × Role matrix, identity backbone, and
observed-form graph, plus all resolution/intersection logic, run in a **Cloudflare Worker** behind a
**Shopify App Proxy**. The browser never receives the knowledge graph.

**Status: built + locally tested + external-audit fixes applied (Step 2a), NOT deployed.** Client
wiring (`javascript/blend-builder.js`) is Step 3 and is untouched here.

## Layout

```
worker/
  src/
    index.js            fetch handler + pipeline (signature → timestamp → allow-list → rate limit → resolve)
    engine.js           resolution + Product×Role selection (indices built once/isolate)
    security.js         App Proxy signature, timestamp, input allow-list, per-isolate rate PRE-check
    rate_limiter_do.js  central Durable Object limiter (authoritative) + LimiterState logic
    token.js            short-lived signed specification_token (Stage 1 → Stage 2 bridge)
    store.js            load-once KV cache, INIT_PROMISE (no cold-start race), fail-closed versions
    version.js          version contract, tunables, degraded message
    hmac.js             Web Crypto helpers (constant-time verify; work in Workers and Node)
  tools/generate_payloads.js   runtime-minimal payload generator + mandatory leakage test (committed)
  test/run_tests.js            unit/pipeline suite (no framework) — 41 assertions
  test/integration_do.mjs      Miniflare (real workerd) DO suite — routing, persistence, concurrency, fail-closed, latency
  data/                        generated bundles (gitignored — reproduce with the generator)
  wrangler.toml.example        deployment config template (no secrets)
```

## Run locally

```bash
node worker/tools/generate_payloads.js   # writes worker/data/*.json, runs the leakage test
node worker/test/run_tests.js            # 41 unit/pipeline assertions, no deployment
cd worker && npm install                 # once, for the integration suite (Miniflare devDependency)
node worker/test/integration_do.mjs      # real workerd via Miniflare: DO routing, persistence, concurrency, fail-closed, latency
```

The generator reads the frozen sources and emits the **runtime-minimal, storefront-safe** bundles —
provenance, GBIF metadata, review/merge history, supplier identity, supplier counts, observation
provenance, and source families are all stripped. The leakage test fails the build if any appear.

## Endpoints (via App Proxy: `https://<shop>/apps/formulator/*`)

- **`POST /apps/formulator/specification`** — in: `product`, `role`, `botanical` (+ optional
  `session_id`). Out (MINIMAL, ADR-014 Step-2a Option A):
  ```json
  {
    "identity_status": "resolved",
    "identity": { "display_name": "Ashwagandha", "authority_name": "Withania somnifera" },
    "specification": { "selected_format": "WL", "technical_status": "Best physical fit", "role": "Active" },
    "explanation": "…one caveat…",
    "specification_token": "…",
    "version": { "…": "…" }
  }
  ```
  **Nothing else crosses the wire** — no ladder arrays (`preferred`/`conditional`/`unsuitable`), no
  `observed_available`, no canonical IDs, no candidate lists, no counts, no supplier evidence.
  Ambiguous identities return only a neutral message; unrecognised terms return no identity detail.
- **`POST /apps/formulator/procurement`** — in: `specification_token` only. Any extra field is
  rejected, so the client cannot fabricate or alter a specification. The token's claims (cid, product,
  role, selected_format, api schema, snapshot versions) are re-validated against live state. Out:
  `match_class`, `product_handles`, `sourcing_route`, `version`.

Response minimisation throughout. **No bulk endpoint exists** (exact route matching, not `endsWith`).

## Request pipeline (order)

1. **App Proxy signature** (constant-time Web Crypto verify). Proves Shopify forwarded an untampered
   request — **not** that the caller is the Formulator UI (anonymous proxy calls are possible); the
   remaining controls exist because of this.
1b. **Shop binding** — reject a validly-signed request whose `shop` param is not our exact `SHOP_DOMAIN`
   (`*.myshopify.com`). Defence in depth: the signature proves only that our app secret signed it. Required
   config — fails closed (degraded) if `SHOP_DOMAIN` is unset.
2. **Timestamp freshness** (replay resistance).
3. **Strict input allow-list**. `session_id` is UNTRUSTED — bounded length/charset, and **never** a
   rate-limit key.
4. **Rate limit** — a cheap per-isolate pre-check, then the **authoritative central limiter** (see below).
   Dual-key: fine-grained on the **shopper IP** (see "Client IP behind the App Proxy") plus a coarse
   backstop on the non-spoofable **transport IP** (`CF-Connecting-IP`).
5. Resolve → select → respond.

## Client IP behind the App Proxy

The shopper does **not** connect to the Worker directly — Shopify's App Proxy forwards the request
server-to-server, so `CF-Connecting-IP` is **Shopify's shared egress**, not the shopper. Keying limits
on it would collapse every unrelated shopper into one bucket, letting a few visitors exhaust the
per-minute / traversal ceilings for everyone. Shopify forwards the real shopper IP in `X-Forwarded-For`.

`X-Forwarded-For` is read **only after** the App Proxy signature verifies (step 1), and extracted
**trust-from-the-right**, never leftmost. Note precisely: **the App Proxy signature authenticates the query
parameters, not the request headers — `X-Forwarded-For` is never cryptographically authenticated.**
Verification proves only that Shopify forwarded the request; the header is trusted by *topology*, not by
signature (hence the deployment gate below).

- Cloudflare itself **appends** its connecting peer (= Shopify egress = `CF-Connecting-IP`) to
  `X-Forwarded-For`, so a legitimate chain is normally multi-hop `<shopper>, <shopify-egress>` — hence
  "reject any multi-hop value" would reject real traffic and is **not** used.
- We peel a trailing entry equal to `CF-Connecting-IP`, then take the rightmost remaining entry — the
  shopper-IP position expected from the documented Shopify → Cloudflare proxy topology; confirmed during
  dev-theme testing. Leftmost is browser-spoofable and ignored. Malformed/empty → fall back to
  `CF-Connecting-IP` (the shared-bucket behaviour — safe, never attacker-chosen).

**Why a second, transport-keyed limit exists.** The shopper key is only as trustworthy as Shopify's
`X-Forwarded-For` stamping. If a caller could influence it — rotating distinct IPs, straddling a valid IP
and a malformed one (two different buckets), or forcing the fallback — they could stretch the fine-grained
limit. So every request *also* hits a coarse limit keyed on `CF-Connecting-IP`, which Cloudflare sets from
the real TCP peer and a caller **cannot** spoof. All of an abuser's traffic through one Shopify egress
shares that key, so aggregate abuse is bounded regardless of what `X-Forwarded-For` says. The trade-off:
that key is shared by all shoppers behind one egress, so its ceiling is deliberately high (`RATE.transport`)
— too low would throttle innocent co-tenants. It is a STARTING value to size from real egress fan-out.

> **🚫 DEPLOYMENT GATE (production is BLOCKED until this is cleared):** Miniflare cannot reproduce the real
> Shopify→Cloudflare header topology, and `X-Forwarded-For` is not cryptographically authenticated (above).
> **Production deploy is blocked until a live dev-theme request confirms the actual `X-Forwarded-For` shape
> and the peel offset** (i.e. that the rightmost-after-peeling-`CF-Connecting-IP` entry is genuinely the
> shopper, and that Shopify does not forward a browser-supplied header verbatim). While confirming, also log
> how many shoppers share one `CF-Connecting-IP` and size `RATE.transport` so it never throttles legitimate
> egress fan-out. Dev-theme deployment (to gather this) is permitted; production launch is not until it passes.
>
> **How to clear it:** set `HEADER_CAPTURE = "1"` on the **dev-theme Worker only**, drive a few real requests
> from 2–3 devices, and read the `[xff-capture]` log lines (raw `X-Forwarded-For`, `CF-Connecting-IP`, derived
> shopper key, `shop`, and per-transport fan-out). The capture logs **only** the proxy header chain — never a
> botanical query, token, or session. Confirm the derived key matches the true shopper, then remove
> `HEADER_CAPTURE` (and the temporary capture block in `index.js`) before production.

## Central rate limiter (Durable Object) — persisted

Per-isolate Maps cannot enforce across isolates and a rotated `session_id` bypasses them, so they are
only a cheap first layer. The **authoritative** limiter is a **Durable Object** (`RateLimiterDurableObject`,
bound as `RATE_LIMITER`): one globally-consistent instance enforcing per-IP minute/hour/day limits, a
unique-botanical ceiling, and **product×role traversal (enumeration) detection** with adaptive
escalation. Limits are keyed on the server-derived IP.

**State is PERSISTED to `state.storage` — it is the source of truth, not the in-memory Maps.** So
counters and enumeration history survive DO eviction/restart (verified by the Miniflare integration
suite). Specifically:

- **Persisted:** per-IP minute/hour/day counters, unique-botanical windows, product×role traversal
  windows (challenge/escalation is derived from the persisted traversal window).
- **Initialisation guard:** `state.blockConcurrencyWhile(...)` loads persisted state before any request
  is served, so a restarted DO does not race at startup.
- **Atomic updates:** all counter mutations go through the DO's single-threaded request path and are
  written back atomically (`storage.put`/`storage.delete`, batched). No Worker request read-modify-writes
  counters outside the DO. The in-memory Maps are a read-through cache only.
- **Traversal ceiling** `distinctProductRolePerHour` is a **starting** value of **12** (238 cells; a
  higher ceiling let one IP reconstruct the whole selected-output layer cheaply). Tune from telemetry.
- If the DO namespace is unbound, the Worker **fails closed** (degraded) rather than silently relying on
  the weak per-isolate layer. Creating the live DO namespace + binding is a **DEPLOY step**.
- Adaptive Turnstile: the limiter flags `challenge` on enumeration; the Turnstile **widget** is wired
  client-side in Step 3. Until then, flagged traffic is hard-limited (429 with `challenge_required`).

**DO round-trip latency** (Miniflare, 300 local calls): ~median 8 ms, p95 ~10 ms. **Local Miniflare
latency is not production edge latency — order-of-magnitude only.** Note this DO round trip now dominates
per-request time (Step-1 resolution was ~0.005 ms); it is I/O wait rather than Worker CPU, but it is the
real cost of a durable, consistent limiter.

## Honest limit (what ADR-014 does and does not prevent)

Even with the minimal response, querying each Product × Role cell reveals `selected_format`,
`technical_status`, and the first sentence of the selected cell note — which is matrix-derived IP.
**ADR-014 raises the cost of harvesting the matrix; it does not make reconstruction impossible.** The
traversal ceiling and enumeration detection are what make that cost meaningful. This is consistent with
ADR-014's stated honest limit — we do not claim more.

Non-issues (audit-confirmed, working as designed): resolved requests do more work than
ambiguous/unrecognised ones so timing can distinguish them — but `identity_status` states that
explicitly, so timing reveals nothing beyond the documented API; and ambiguous-vs-unrecognised being
distinguishable is the approved public status vocabulary (the neutral message exposes no candidate
identities).

## Version contract & degraded state

Every response carries `api_schema_version`, `matrix_version`, `identity_version`,
`observed_form_graph_version`, `response_generated_at`. The `specification_token` embeds the api schema
+ snapshot versions; procurement rejects a token whose snapshot differs from the loaded bundles. On any
version inconsistency or unavailable data the Worker **fails closed** with the honest generic degraded
message — never a mixed/partial result, and **internal reasons (KV key names, version mismatches) are
logged server-side only**, never returned to the browser.

## KV key scheme

A pointer key names the current versions; bundles live under version-stamped keys, so bumping
`identity_version` is a data change (write new bundles + update the pointer) with **no redeploy**.

| key | value |
|---|---|
| `manifest:current` | `{ api_schema_version, identity_version, observed_form_graph_version, matrix_version }` |
| `identity:<identity_version>` | identity index bundle |
| `formgraph:<observed_form_graph_version>` | storefront-safe form graph bundle |
| `matrix:<matrix_version>` | matrix data bundle |

`store.js` loads these **once per isolate** (guarded by a module-scope `INIT_PROMISE` so concurrent
cold requests initialise exactly once), builds the indices once, and retains everything in module
scope. KV caching is not automatic — this module *is* the cache.

## Security decisions recorded (deliberate, not oversights)

- **Token replay within the 5-minute TTL is ACCEPTED.** Procurement is read-only, so a `jti`/replay
  store adds complexity without meaningful benefit at this stage. (Owner decision.)
- **Two separate secrets:** `SHOPIFY_APP_SECRET` verifies the App Proxy signature; a distinct
  `SPECIFICATION_TOKEN_SECRET` signs specification tokens. Neither is ever committed.
- **Minimal Stage-1 response (Option A):** the three-band ladder is intentionally not returned; the
  Stage-1 UI three-band display is dropped and that UX change lands in Step 3. (Owner decision.)

---

## What Krantik must create before deploy (owner prerequisites)

Claude Code does **not** deploy. To go live you will need to:

1. **Cloudflare account** + Workers enabled. Free tier is sufficient per the Step-1 benchmark.
2. **KV namespace** (`HB_KV`). Bind it in `wrangler.toml` (copy from `wrangler.toml.example`).
3. **Durable Object namespace** for the central rate limiter (`RATE_LIMITER` → `RateLimiterDurableObject`),
   with the migration in `wrangler.toml.example`. **The Worker fails closed without it.**
4. **Shopify custom app** with **App Proxy** forwarding `/apps/formulator/*` to the Worker. Note the
   app's **shared secret**.
5. **Two Worker secrets** (never committed):
   ```bash
   wrangler secret put SHOPIFY_APP_SECRET            # Shopify App Proxy shared secret
   wrangler secret put SPECIFICATION_TOKEN_SECRET    # independent random secret for token signing
   ```
6. **Upload the bundles to KV** (regenerate whenever the backbone/graph/matrix changes):
   ```bash
   node worker/tools/generate_payloads.js
   wrangler kv key put --binding=HB_KV "manifest:current"                        --path worker/data/manifest.json
   wrangler kv key put --binding=HB_KV "identity:<identity_version>"              --path worker/data/identity_index.json
   wrangler kv key put --binding=HB_KV "formgraph:<observed_form_graph_version>"  --path worker/data/form_graph.json
   wrangler kv key put --binding=HB_KV "matrix:<matrix_version>"                  --path worker/data/matrix.json
   ```
   (The generator prints the exact key names for the current versions.)
7. `wrangler deploy`.

**Secrets rule:** secrets live only as Worker secrets (or local `.dev.vars`, gitignored). Never in the
repo — the code reads them from `env`.

## Known limitations (Step-3+, deliberately not done here)

- **Procurement uses the observed-form graph as a STOCK PROXY.** This is functionally incorrect until
  real Herbuno catalogue stock is wired, and repeated `match_class` responses form a graph-membership
  oracle. `product_handles` is empty. Resolve when catalogue stock is wired (Step 3).
- **Turnstile widget** is deferred to Step 3; the limiter already computes the escalation signal.
- **Central limiter requires the live DO binding** (a deploy prerequisite; logic is built + tested).
- No client changes; `javascript/blend-builder.js` is untouched (Step 3).
