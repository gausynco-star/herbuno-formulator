// ADR-014 server-side knowledge backend — Cloudflare Worker entrypoint.
// Pipeline order (ADR-014 §2): signature -> timestamp -> allow-list -> rate limit -> resolve.
// Step-2a security hardening folded in. No framework. Nothing here is deployed by CC.
import { getContext } from './store.js';
import { resolve, statusOf, selectSpecification, oneCaveat, procurementMatch, reasoningChecks, assessCandidate, displayName } from './engine.js';
import { verifyProxyQuery, checkTimestamp, validateSpecInput, validateProcurementInput, localRatePreCheck, deriveClientIp } from './security.js';
import { centralRateLimit } from './rate_limiter_do.js';
import { signToken, verifyToken } from './token.js';
import { versionBlock, DegradedError, DEGRADED_MESSAGE, FRESH_WINDOW_MS, MAX_BODY_BYTES, ROUTES, API_SCHEMA_VERSION } from './version.js';

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Degraded: log the internal reason SERVER-SIDE only; the browser gets the generic message with no
// KV key names / version details (BLOCKER 5 hardening).
function degraded(internalReason) {
  try { console.error('[degraded]', internalReason); } catch { /* noop */ }
  return json(503, { error: 'degraded', message: DEGRADED_MESSAGE });
}
const challenge429 = () => json(429, { error: 'rate_limited', challenge_required: true, message: 'Additional verification is required before continuing.' });
const rateLimited = () => json(429, { error: 'rate_limited' });

async function readJsonCapped(request) {
  const cl = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  if (!text) return { value: null };
  try { return { value: JSON.parse(text) }; } catch { return { bad: true }; }
}
function isJsonContentType(request) {
  const ct = request.headers.get('content-type') || '';
  return ct.split(';')[0].trim().toLowerCase() === 'application/json';
}
// Behind the Shopify App Proxy the real shopper IP is in X-Forwarded-For; CF-Connecting-IP is only
// Shopify's shared egress. Trusted ONLY here — clientIp() runs after verifyProxyQuery() has succeeded
// (see the call site in handleRequest). See deriveClientIp() for the trust-from-the-right model.
function clientIp(request) {
  return deriveClientIp(request.headers.get('X-Forwarded-For'), request.headers.get('CF-Connecting-IP'));
}

// TEMPORARY dev-theme header capture — the evidence that clears the X-Forwarded-For DEPLOYMENT GATE.
// Gated behind env.HEADER_CAPTURE; emits NOTHING unless it is '1'/'true' (so it is off in production).
// It logs ONLY the proxy header chain needed to confirm the real X-Forwarded-For shape / peel offset:
// the raw XFF, CF-Connecting-IP, the derived shopper key, and the shop param. It deliberately NEVER logs
// the botanical query, the specification_token, session_id, or any response content (HARD RULE 7 privacy).
// `distinct_shoppers_on_transport` is a per-isolate approximation to surface egress fan-out live; the
// authoritative fan-out is obtained by aggregating capture lines (group by `cf`, count distinct `derived`).
// REMOVE this whole block once the gate is cleared.
const HDR_CAP_MAX = 2_000;
const seenShoppersByTransport = new Map(); // cf -> Set<derived>, bounded
function logHeaderCapture(env, { xff, cf, derived, shop }) {
  if (!env || (env.HEADER_CAPTURE !== '1' && env.HEADER_CAPTURE !== 'true')) return;
  const t = cf || 'no-transport';
  let seen = seenShoppersByTransport.get(t);
  if (!seen) { seen = new Set(); if (seenShoppersByTransport.size < HDR_CAP_MAX) seenShoppersByTransport.set(t, seen); }
  seen.add(derived);
  try {
    console.log('[xff-capture]', JSON.stringify({
      xff: xff || null, cf: cf || null, derived, shop: shop || null,
      distinct_shoppers_on_transport: seen.size, shared_transport: seen.size > 1,
    }));
  } catch { /* noop — capture must never affect the response */ }
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isSpec = path === ROUTES.SPEC;   // exact match, not endsWith
  const isProc = path === ROUTES.PROC;

  if (!isSpec && !isProc) return json(404, { error: 'not_found' }); // no bulk endpoint, ever
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!isJsonContentType(request)) return json(415, { error: 'unsupported_media_type' });

  const proxySecret = env.SHOPIFY_APP_SECRET;
  const tokenSecret = env.SPECIFICATION_TOKEN_SECRET;
  const shopDomain = env.SHOP_DOMAIN;
  if (!proxySecret || !tokenSecret) return degraded('missing_secret');
  if (!shopDomain) return degraded('missing_shop_domain'); // fail closed: the shop binding is required

  // 1. App Proxy signature
  const sig = await verifyProxyQuery(url.searchParams, proxySecret);
  if (!sig.ok) return json(401, { error: 'invalid_signature' });

  // 1b. Shop binding — reject a validly-signed request whose `shop` is not our exact store. Defence in
  // depth beyond the signature (which proves only that OUR app secret signed it): pin the storefront.
  if (url.searchParams.get('shop') !== shopDomain) return json(401, { error: 'invalid_shop' });

  // 2. Timestamp freshness
  if (!checkTimestamp(url.searchParams.get('timestamp'), Date.now(), FRESH_WINDOW_MS)) {
    return json(401, { error: 'stale_request' });
  }

  // body size cap BEFORE parsing
  const parsed = await readJsonCapped(request);
  if (parsed.tooLarge) return json(413, { error: 'payload_too_large' });
  if (parsed.bad) return json(400, { error: 'bad_json' });
  const body = parsed.value;

  // load-once engine + versions (fails closed on version mismatch / unavailable data)
  let context;
  try { context = await getContext(env); }
  catch (e) { if (e instanceof DegradedError) return degraded(e.reason); throw e; }

  const ip = clientIp(request);                                     // shopper key (XFF, trust-from-right)
  const transportIp = request.headers.get('CF-Connecting-IP') || 'no-transport'; // non-spoofable egress
  // Dev-theme-only: capture the proxy header chain to clear the XFF gate (off unless HEADER_CAPTURE set).
  logHeaderCapture(env, { xff: request.headers.get('X-Forwarded-For'), cf: request.headers.get('CF-Connecting-IP'), derived: ip, shop: url.searchParams.get('shop') });
  try {
    if (isSpec) return await specification(env, context, body, ip, transportIp, tokenSecret);
    return await procurement(env, context, body, ip, transportIp, tokenSecret);
  } catch (e) {
    if (e instanceof DegradedError) return degraded(e.reason);
    return degraded('internal'); // honest degrade; never a partial/guessed result
  }
}

async function specification(env, context, body, ip, transportIp, tokenSecret) {
  const { engine, versions } = context;
  // 3. strict input allow-list (session_id is validated + never used as a limiter key)
  const bad = validateSpecInput(body, engine);
  // A well-formed selection whose product×role simply isn't a supported matrix cell is a DOMAIN outcome,
  // not malformed input — return 200 guidance (robust through the App Proxy, never read as degraded even by
  // an older client), NOT a 400. Genuinely malformed input still 400s below.
  if (bad === 'unknown_product_role') {
    return json(200, {
      identity_status: 'not_applicable',
      identity: { display_name: null, authority_name: null },
      guidance_status: 'not_available_for_product',
      guidance: 'This role is not set up for the selected finished product.',
      specification: null,
      reasoning_checks: null,
      reasoning_basis: 'role',
      specification_token: null,
      version: versionBlock(versions),
    });
  }
  if (bad) return json(400, { error: 'bad_input', detail: bad });

  const productRole = body.product + '|' + body.role;
  const candidateFormat = body.candidate_format;  // undefined unless the user chose one; validated above
  const now = Date.now();
  // 4a. cheap per-isolate pre-check, then 4b. AUTHORITATIVE central limiter (fine-grained shopper key +
  // coarse non-spoofable transport-key backstop + the per-cell candidate_format enumeration SET)
  if (!localRatePreCheck(ip, body.botanical, now).ok) return rateLimited();
  const central = await centralRateLimit(env, { key: ip, transportKey: transportIp, botanical: body.botanical, productRole, candidateFormat, now });
  if (central.unavailable) return degraded('limiter_unavailable'); // fail closed if DO unbound
  if (!central.ok) return central.challenge ? challenge429() : rateLimited();

  // 5. resolve -> select single spec (the ladder itself never leaves the Worker). The Product×Role
  // specification + reasoning + candidate assessment are identity-INDEPENDENT (role physics), so they are
  // returned for every status; identity detail and the specification_token are gated on `resolved`.
  const idn = resolve(null, body.botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const resolved = status === 'resolved';
  const ladder = engine.ladder.get(productRole);
  const rec = resolved && idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;

  // A role can route to the format ladder ('catalogue') OR to guidance (out_of_scope / ask_us /
  // guidance_only / no_code_application_dependent). For guidance roles there is no format to select, so we
  // surface the role's guidance text (rec) instead of a "no suitable format" dead-end, and issue no token.
  const isCatalogue = ladder && ladder.routing === 'catalogue';
  const sel = isCatalogue
    ? selectSpecification(ladder)
    : { selected_format: null, technical_status: routingStatus(ladder && ladder.routing), role: ladder ? ladder.label : null };
  const explanation = !resolved
    ? oneCaveat(status, sel, ladder)                        // ambiguous/unrecognised identity message
    : isCatalogue
      ? oneCaveat('resolved', sel, ladder)                 // the selected format's caveat
      : (ladder.rec || 'The right approach depends on the product and process — contact Herbuno for guidance.');

  // ADR-014 minimal-response EXCEPTION — AMBIGUITY ONLY (Live-test R2 UX 1): to let the shopper
  // disambiguate, surface the RESOLVER'S OWN candidate identities as PUBLIC display/authority names.
  // Never canonical IDs, never a count, never a backbone search — only the ids the resolver already
  // produced for THIS query. Scoped strictly to `ambiguous`; do NOT generalise this to other states.
  const identity = { display_name: rec ? displayName(rec) : null, authority_name: rec ? rec.authority_accepted_name : null };
  if (status === 'ambiguous' && Array.isArray(idn.candidates)) {
    const named = idn.candidates.map((cid) => engine.byId.get(cid)).filter(Boolean)
      .map((r) => ({ display_name: displayName(r), authority_name: r.authority_accepted_name || null }));
    if (named.length) identity.candidates = named; // presence of `candidates` IS the flagged exception
  }

  const resp = {
    identity_status: status,
    // ambiguous/unrecognised: NEVER an identity claim or canonical IDs. `identity.candidates` (public
    // display/authority names) is the ONLY relaxation and appears for `ambiguous` only.
    identity,
    specification: { selected_format: sel.selected_format, technical_status: sel.technical_status, role: sel.role },
    explanation,
    // three physics-only conclusions — only for catalogue roles (guidance roles have no format to reason about)
    reasoning_checks: isCatalogue ? reasoningChecks(ladder, sel.selected_format) : null,
    reasoning_basis: resolved ? 'botanical' : 'role',
    specification_token: null,      // set below ONLY for resolved catalogue roles (server-side enforcement)
    version: versionBlock(versions),
  };
  // candidate mismatch check — only when the user actually supplied a format (role physics; runs for every
  // status). SE returns the LOCKED application-review response inside assessCandidate.
  if (candidateFormat !== undefined) resp.candidate_assessment = assessCandidate(ladder, candidateFormat);

  // Token ONLY for a resolved identity on a catalogue role: guidance roles and unresolved identities have
  // nothing for Stage 2 to match against, so the client disables the Stage-2 action for them.
  if (resolved && isCatalogue) {
    resp.specification_token = await signToken(tokenSecret, {
      cid: idn.canonical_id, product: body.product, role: body.role,
      sf: sel.selected_format, api: API_SCHEMA_VERSION,
      iv: versions.identity_version, gv: versions.observed_form_graph_version, mv: versions.matrix_version,
    });
  }
  return json(200, resp);
}

// Guidance-role status label (non-catalogue routings). rec carries the actual guidance in `explanation`.
function routingStatus(routing) {
  switch (routing) {
    case 'out_of_scope': return 'Not a separately sourced ingredient here';
    case 'guidance_only': return 'Technical guidance for this role';
    case 'ask_us':
    case 'no_code_application_dependent': return 'Application review needed';
    default: return 'Application review needed';
  }
}

async function procurement(env, context, body, ip, transportIp, tokenSecret) {
  const { engine, versions } = context;
  // reject anything but the token — the client must not fabricate/alter a specification
  const bad = validateProcurementInput(body);
  if (bad) return json(400, { error: 'bad_input', detail: bad });

  const now = Date.now();
  if (!localRatePreCheck(ip, null, now).ok) return rateLimited();
  const central = await centralRateLimit(env, { key: ip, transportKey: transportIp, now });
  if (central.unavailable) return degraded('limiter_unavailable');
  if (!central.ok) return central.challenge ? challenge429() : rateLimited();

  const v = await verifyToken(tokenSecret, body.specification_token);
  if (!v.ok) return json(401, { error: 'invalid_token', detail: v.reason });
  const p = v.payload;

  // re-validate claim TYPES and permitted VALUES against live state — never trust decoded claims
  if (p.api !== API_SCHEMA_VERSION) return json(401, { error: 'invalid_token', detail: 'api_schema' });
  if (typeof p.cid !== 'string' || !engine.byId.has(p.cid)) return json(401, { error: 'invalid_token', detail: 'cid' });
  if (typeof p.product !== 'string' || typeof p.role !== 'string' || !engine.ladder.has(p.product + '|' + p.role)) return json(401, { error: 'invalid_token', detail: 'product_role' });
  if (p.sf != null && typeof p.sf !== 'string') return json(401, { error: 'invalid_token', detail: 'sf' });
  // fail closed: the token's snapshot must match the currently loaded snapshot
  if (p.iv !== versions.identity_version || p.gv !== versions.observed_form_graph_version || p.mv !== versions.matrix_version) {
    throw new DegradedError('token_snapshot_mismatch');
  }

  const match = procurementMatch(engine, p.cid, p.sf);
  // Real Herbuno catalogue (product handles) is off-repo; wired in Step 3. Handles empty for now.
  return json(200, {
    match_class: match.match_class,
    product_handles: [],
    sourcing_route: match.sourcing_route,
    version: versionBlock(versions),
  });
}

// Durable Object class must be exported from the Worker's main module for wrangler to bind it.
export { RateLimiterDurableObject } from './rate_limiter_do.js';

export default { fetch: handleRequest };
