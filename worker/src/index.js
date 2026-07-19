// ADR-014 server-side knowledge backend — Cloudflare Worker entrypoint.
// Pipeline order (ADR-014 §2): signature -> timestamp -> allow-list -> rate limit -> resolve.
// No framework (keeps the bundle minimal per the Step-1 benchmark). Nothing here is deployed by CC.
import { getContext } from './store.js';
import { resolve, statusOf, buildSpec, explain, procurementMatch } from './engine.js';
import { verifyProxyQuery, checkTimestamp, validateSpecInput, validateProcurementInput, rateLimit } from './security.js';
import { signToken, verifyToken } from './token.js';
import { versionBlock, DegradedError, DEGRADED_MESSAGE, FRESH_WINDOW_MS } from './version.js';

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const degraded = (reason) => json(503, { error: 'degraded', reason: reason || 'unavailable', message: DEGRADED_MESSAGE });

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '0.0.0.0';
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const isSpec = path.endsWith('/apps/formulator/specification');
  const isProc = path.endsWith('/apps/formulator/procurement');

  // No bulk endpoint, ever: only the two POST routes exist.
  if (!isSpec && !isProc) return json(404, { error: 'not_found' });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const secret = env.SHOPIFY_APP_SECRET;
  if (!secret) return degraded('missing_secret');

  // 1. App Proxy signature
  const sig = await verifyProxyQuery(url.searchParams, secret);
  if (!sig.ok) return json(401, { error: 'invalid_signature' });

  // 2. Timestamp freshness
  if (!checkTimestamp(url.searchParams.get('timestamp'), Date.now(), FRESH_WINDOW_MS)) {
    return json(401, { error: 'stale_request' });
  }

  // load-once engine + versions (fails closed on version mismatch / unavailable data)
  let context;
  try { context = await getContext(env); }
  catch (e) { if (e instanceof DegradedError) return degraded(e.reason); throw e; }

  const body = await readJson(request);
  const ip = clientIp(request);

  try {
    if (isSpec) return await specification(request, env, context, body, ip, url);
    return await procurement(request, env, context, body, ip);
  } catch (e) {
    if (e instanceof DegradedError) return degraded(e.reason);
    return degraded('internal'); // honest degrade; never a partial/guessed result
  }
}

async function specification(request, env, context, body, ip, url) {
  const { engine, versions } = context;
  // 3. strict input allow-list
  const bad = validateSpecInput(body, engine);
  if (bad) return json(400, { error: 'bad_input', detail: bad });
  const session = body.session_id || url.searchParams.get('logged_in_customer_id') || ip;
  // 4. rate limit (per IP + per session, incl. unique-botanical ceiling)
  const rl = rateLimit(ip, String(session), body.botanical, Date.now());
  if (!rl.ok) return json(429, { error: 'rate_limited', detail: rl.reason });

  // 5. resolve -> intersect -> spec
  const idn = resolve(null, body.botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const ladder = engine.ladder.get(body.product + '|' + body.role);
  const rec = idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;
  const spec = buildSpec(engine, idn, ladder);

  // token only when a single identity resolved (nothing to procure otherwise)
  let token = null;
  if (status === 'resolved') {
    token = await signToken(secretOf(env), {
      v: 1, cid: idn.canonical_id, product: body.product, role: body.role,
      best_fit: spec.format_ladder.best_fit,
      iv: versions.identity_version, gv: versions.observed_form_graph_version, mv: versions.matrix_version,
    });
  }

  // response minimisation: only the selected specification — no other roles, no alternatives, no counts
  return json(200, {
    identity_status: status,
    identity: {
      canonical_id: idn.canonical_id,
      display_name: rec ? rec.canonical_display_name : null,
      authority_name: rec ? rec.authority_accepted_name : null,
      candidates: idn.candidates || null,
    },
    specification: spec,
    technical_explanation: explain(status, rec, spec, ladder),
    specification_token: token,
    version: versionBlock(versions),
  });
}

async function procurement(request, env, context, body, ip) {
  const { engine, versions } = context;
  // reject anything but the token — the client must not fabricate/alter a specification
  const bad = validateProcurementInput(body);
  if (bad) return json(400, { error: 'bad_input', detail: bad });
  // rate limit per IP (no botanical dimension here)
  const rl = rateLimit(ip, ip, null, Date.now());
  if (!rl.ok) return json(429, { error: 'rate_limited', detail: rl.reason });

  const v = await verifyToken(secretOf(env), body.specification_token);
  if (!v.ok) return json(401, { error: 'invalid_token', detail: v.reason });
  const p = v.payload;

  // fail closed: the token's snapshot must match the currently loaded snapshot
  if (p.iv !== versions.identity_version || p.gv !== versions.observed_form_graph_version || p.mv !== versions.matrix_version) {
    throw new DegradedError('token_snapshot_mismatch');
  }
  if (!p.cid) return json(422, { error: 'no_identity_in_token' });

  const match = procurementMatch(engine, p.cid, p.best_fit);
  // Real Herbuno catalogue (product handles) is off-repo; wired in Step 3. Handles empty for now.
  return json(200, {
    match_class: match.match_class,
    product_handles: [],
    sourcing_route: match.sourcing_route,
    version: versionBlock(versions),
  });
}

function secretOf(env) { return env.SHOPIFY_APP_SECRET; }

export default { fetch: handleRequest };
