// ADR-014 server-side knowledge backend — Cloudflare Worker entrypoint.
// Pipeline order (ADR-014 §2): signature -> timestamp -> allow-list -> rate limit -> resolve.
// Step-2a security hardening folded in. No framework. Nothing here is deployed by CC.
import { getContext } from './store.js';
import { resolve, statusOf, selectSpecification, oneCaveat, procurementMatch } from './engine.js';
import { verifyProxyQuery, checkTimestamp, validateSpecInput, validateProcurementInput, localRatePreCheck } from './security.js';
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
// Cloudflare-set connecting IP ONLY — never trust x-forwarded-for. Unknown => a shared strict bucket.
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'no-ip'; }

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
  if (!proxySecret || !tokenSecret) return degraded('missing_secret');

  // 1. App Proxy signature
  const sig = await verifyProxyQuery(url.searchParams, proxySecret);
  if (!sig.ok) return json(401, { error: 'invalid_signature' });

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

  const ip = clientIp(request);
  try {
    if (isSpec) return await specification(env, context, body, ip, tokenSecret);
    return await procurement(env, context, body, ip, tokenSecret);
  } catch (e) {
    if (e instanceof DegradedError) return degraded(e.reason);
    return degraded('internal'); // honest degrade; never a partial/guessed result
  }
}

async function specification(env, context, body, ip, tokenSecret) {
  const { engine, versions } = context;
  // 3. strict input allow-list (session_id is validated + never used as a limiter key)
  const bad = validateSpecInput(body, engine);
  if (bad) return json(400, { error: 'bad_input', detail: bad });

  const productRole = body.product + '|' + body.role;
  const now = Date.now();
  // 4a. cheap per-isolate pre-check, then 4b. AUTHORITATIVE central limiter (keyed on IP)
  if (!localRatePreCheck(ip, body.botanical, now).ok) return rateLimited();
  const central = await centralRateLimit(env, { key: ip, botanical: body.botanical, productRole, now });
  if (central.unavailable) return degraded('limiter_unavailable'); // fail closed if DO unbound
  if (!central.ok) return central.challenge ? challenge429() : rateLimited();

  // 5. resolve -> select single spec (ladder never leaves the Worker)
  const idn = resolve(null, body.botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const ladder = engine.ladder.get(productRole);
  const rec = idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;

  // ambiguous / unrecognised: no identity detail, no candidate IDs, no spec, no token
  if (status !== 'resolved') {
    return json(200, {
      identity_status: status,
      identity: { display_name: null, authority_name: null },
      specification: null,
      explanation: oneCaveat(status, {}, null),
      specification_token: null,
      version: versionBlock(versions),
    });
  }

  const sel = selectSpecification(ladder);
  const token = await signToken(tokenSecret, {
    cid: idn.canonical_id, product: body.product, role: body.role,
    sf: sel.selected_format, api: API_SCHEMA_VERSION,
    iv: versions.identity_version, gv: versions.observed_form_graph_version, mv: versions.matrix_version,
  });

  // MINIMAL response — nothing beyond this crosses the wire (BLOCKER 1 / Option A)
  return json(200, {
    identity_status: status,
    identity: { display_name: rec.canonical_display_name, authority_name: rec.authority_accepted_name },
    specification: { selected_format: sel.selected_format, technical_status: sel.technical_status, role: sel.role },
    explanation: oneCaveat(status, sel, ladder),
    specification_token: token,
    version: versionBlock(versions),
  });
}

async function procurement(env, context, body, ip, tokenSecret) {
  const { engine, versions } = context;
  // reject anything but the token — the client must not fabricate/alter a specification
  const bad = validateProcurementInput(body);
  if (bad) return json(400, { error: 'bad_input', detail: bad });

  const now = Date.now();
  if (!localRatePreCheck(ip, null, now).ok) return rateLimited();
  const central = await centralRateLimit(env, { key: ip, now });
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
