// ADR-014 Step 3 — client (javascript/blend-builder.js) render tests. Run: node worker/test/client_render_tests.mjs
// The client is pure-tested against FAITHFUL Worker responses: we build each response with the SAME engine
// functions the Worker uses (real reasoning_checks / candidate_assessment / spec), then render it. Also
// asserts the shipped client + shell carry NO matrix/identity/graph decision data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeEngine, resolve, statusOf, selectSpecification, oneCaveat, reasoningChecks, assessCandidate } from '../src/engine.js';
import { generateAll } from '../tools/generate_payloads.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_PATH = path.join(ROOT, 'javascript', 'blend-builder.js');
const SHELL_PATH = path.join(ROOT, 'liquid', 'blend-builder-shell.liquid');
const client = require(CLIENT_PATH);

const B = generateAll();
const engine = makeEngine(B.identityIndex, B.formGraph, B.matrix);
// pick real cells + a real resolvable botanical
const resolvableLatin = B.identityIndex.identities.find(r => r.authority_accepted_name).authority_accepted_name;
let AMBIG = 'Ajwain';
for (const [k, s] of engine.common) { if (s.size > 1 && statusOf(resolve(null, k, engine.exact, engine.common)) === 'ambiguous') { AMBIG = k; break; } }
// a cell with an ok AND an avoid code (for candidate contrast)
let CPR = null, C_OK = null, C_AVOID = null;
for (const [k, L] of engine.ladder) { if (L.routing !== 'catalogue') continue;
  const okc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'ok' && c !== 'SE');
  const avc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'avoid' && c !== 'SE');
  if (okc && avc) { CPR = k; C_OK = okc; C_AVOID = avc; break; } }
const [CPROD, CROLE] = CPR.split('|');

// faithful reproduction of index.js specification() response construction (no HTTP/limiter/token crypto)
function buildResp(product, role, botanical, candidate) {
  const productRole = product + '|' + role;
  const idn = resolve(null, botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const resolved = status === 'resolved';
  const ladder = engine.ladder.get(productRole);
  const sel = selectSpecification(ladder);
  const rec = resolved && idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;
  const resp = {
    identity_status: status,
    identity: { display_name: rec ? rec.canonical_display_name : null, authority_name: rec ? rec.authority_accepted_name : null },
    specification: { selected_format: sel.selected_format, technical_status: sel.technical_status, role: sel.role },
    explanation: oneCaveat(status, sel, ladder),
    reasoning_checks: reasoningChecks(ladder, sel.selected_format),
    reasoning_basis: resolved ? 'botanical' : 'role',
    specification_token: resolved ? 'HEAD.SIG' : null,
    version: { api_schema_version: 2, matrix_version: 'm', identity_version: 'i', observed_form_graph_version: 'g', response_generated_at: 't' },
  };
  if (candidate !== undefined) resp.candidate_assessment = assessCandidate(ladder, candidate);
  return resp;
}

let pass = 0, fail = 0; const out = [];
const ok = (name, cond, detail) => { (cond ? pass++ : fail++); out.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); };
const NO_AVAIL = /Check Herbuno availability/i, NO_CATMATCH = /catalogue match|in stock/i;

// ---- resolved ----
{ const r = buildResp(CPROD, CROLE, resolvableLatin);
  const h = client.renderResponse(r);
  ok('resolved: card shows Resolved botanical + Recommended form + Technical status + Why', /Resolved botanical/.test(h) && /Recommended form/.test(h) && /Technical status/.test(h) && />Why</.test(h), h.slice(0, 120));
  ok('resolved: Stage-2 action reads "Check sourcing options" and is ENABLED', /Check sourcing options/.test(h) && !/disabled>Check sourcing options/.test(h), h);
  ok('resolved: NEVER "Check Herbuno availability" and NEVER "catalogue match"/"in stock"', !NO_AVAIL.test(h) && !NO_CATMATCH.test(h));
  ok('resolved: reasoning renders 3 checks (collapsed <details>)', /Why this recommendation — 3 checks/.test(h) && /Phase compatibility/.test(h) && /Dissolution \/ dispersion requirement/.test(h) && /Process constraint/.test(h) && /<details/.test(h), h);
  ok('resolved: reasoning is NOT labelled role-based', !/role-based, not botanical-specific/.test(h));
}
// ---- resolved + candidate (avoid) ----
{ const r = buildResp(CPROD, CROLE, resolvableLatin, C_AVOID);
  const h = client.renderResponse(r);
  ok('candidate: mismatch check appears ONLY when supplied — "Your proposed format" + status', /Your proposed format/.test(h) && /Not suitable for this role/.test(h), h);
}
{ const r = buildResp(CPROD, CROLE, resolvableLatin); // no candidate
  ok('candidate: absent when not supplied (no "Your proposed format")', !/Your proposed format/.test(client.renderResponse(r)));
}
// ---- candidate SE locked ----
{ const r = buildResp(CPROD, CROLE, resolvableLatin, 'SE');
  const h = client.renderResponse(r);
  ok('candidate SE: renders the locked "Application review needed" response, echoed as "Standardised extract"', /Application review needed/.test(h) && /Standardised extract/.test(h) && /Standardisation describes assay/.test(h), h);
}
// ---- ambiguous (+ candidate, labelled role-based) ----
{ const r = buildResp(CPROD, CROLE, AMBIG, C_AVOID);
  const h = client.renderResponse(r);
  ok('ambiguous: no identity claim (no Latin authority line), neutral message', !/ — <i>/.test(h) && /Multiple botanical identities match this name/.test(h), h.slice(0, 160));
  ok('ambiguous: Stage-2 action is DISABLED', /disabled>Check sourcing options/.test(h) || /disabled(?:="")?>Check sourcing options/.test(h), h);
  ok('ambiguous: candidate check STILL runs and the card is labelled role-based, not botanical-specific', /Your proposed format/.test(h) && /role-based, not botanical-specific/.test(h), h);
}
// ---- unrecognised ----
{ const r = buildResp(CPROD, CROLE, 'Xyzzy Blorptonium 42');
  const h = client.renderResponse(r);
  ok('unrecognised: generic role-based guidance, no identity claim, Stage-2 disabled', /No botanical identity matched this name/.test(h) && /role-based, not botanical-specific/.test(h) && /disabled/.test(h), h.slice(0, 160));
}
// ---- Stage-2 sourcing result: never a catalogue match ----
{ for (const mc of ['exact_match', 'compatible_alternative', 'ask_us_to_source']) {
    const h = client.renderStage2Result({ match_class: mc, product_handles: [], sourcing_route: 'x' });
    ok('sourcing (' + mc + '): shows sourcing route, NEVER "catalogue match"/"in stock"/"availability"', /Sourcing options/.test(h) && !NO_CATMATCH.test(h) && !NO_AVAIL.test(h), h);
  } }
// ---- other states ----
{ ok('loading: renders an honest indicator (no fake staged reasoning)', /Generating specification/.test(client.renderLoading()) && !/step 1|analysing phase/i.test(client.renderLoading()));
  ok('rate-limited: plain message, no internal reason/counters', /try again/i.test(client.renderRateLimited()) && !/per_minute|reason|counter/i.test(client.renderRateLimited()));
  const dg = client.renderDegraded('HerbIQ Formulator is temporarily unable to generate the technical specification.');
  ok('degraded: honest message + retry + copy selections + enquiry (inputs preserved elsewhere in state)', /temporarily unable/i.test(dg) && /data-retry/.test(dg) && /data-copysel/.test(dg) && /data-enquiry/.test(dg), dg);
}
// ---- schema version: reject incompatible in BOTH directions ----
{ ok('schema: v2 accepted', client.apiCompatible({ version: { api_schema_version: 2 } }) === true);
  ok('schema: v1 (older worker) rejected -> client would degrade', client.apiCompatible({ version: { api_schema_version: 1 } }) === false);
  ok('schema: v3 (newer worker) rejected -> client would degrade', client.apiCompatible({ version: { api_schema_version: 3 } }) === false);
  ok('schema: missing version rejected', client.apiCompatible({}) === false && client.apiCompatible(null) === false);
}
// ---- no matrix/identity/graph decision data in the shipped client or shell ----
{ // scan CODE, not the explanatory comments (which legitimately name what was removed)
  const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  const src = stripJs(fs.readFileSync(CLIENT_PATH, 'utf8'));
  const shell = fs.readFileSync(SHELL_PATH, 'utf8').replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/g, '');
  const FORBIDDEN = ['HB_MX', 'preferred_formats', 'conditional_formats', 'unsuitable_formats', 'observed_available',
    'canonical_id', 'base_format_code', 'plant_parts', 'product_helpers', 'code_names', 'scientific_synonyms',
    'trade_synonyms', 'ambiguity_flag', '/products.json'];
  const hits = FORBIDDEN.filter(t => src.includes(t));
  ok('no matrix data: shipped client CODE references no matrix/identity/graph decision tokens', hits.length === 0, 'hits=' + hits.join(','));
  // the client must not carry format TIER decisions (the .tier field of the matrix)
  ok('no matrix data: client carries no per-format tier decisions (.tier)', !/\.tier\b/.test(src) && !/tier\s*[:=]/.test(src));
  ok('no matrix data: shell CODE no longer loads herbuno-matrix.js (only the comment names it)', !/herbuno-matrix\.js/.test(shell));
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
