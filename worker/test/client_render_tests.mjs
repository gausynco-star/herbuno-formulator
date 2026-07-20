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
const routingStatus = (r) => r === 'out_of_scope' ? 'Not a separately sourced ingredient here' : r === 'guidance_only' ? 'Technical guidance for this role' : 'Application review needed';
function buildResp(product, role, botanical, candidate) {
  const productRole = product + '|' + role;
  const idn = resolve(null, botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const resolved = status === 'resolved';
  const ladder = engine.ladder.get(productRole);
  const rec = resolved && idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;
  const isCatalogue = ladder && ladder.routing === 'catalogue';
  const catSel = isCatalogue ? selectSpecification(ladder) : null;
  const catalogueNoFit = !!(isCatalogue && catSel.selected_format == null && ladder.rec); // UX 2 category error
  const asGuidance = !isCatalogue || catalogueNoFit;
  const sel = !asGuidance ? catSel
    : { selected_format: null, technical_status: catalogueNoFit ? 'This role is normally fulfilled differently' : routingStatus(ladder && ladder.routing), role: ladder ? ladder.label : null };
  const explanation = !resolved ? oneCaveat(status, sel, ladder) : asGuidance ? ((ladder && ladder.rec) || 'contact Herbuno') : oneCaveat('resolved', sel, ladder);
  const identity = { display_name: rec ? rec.canonical_display_name : null, authority_name: rec ? rec.authority_accepted_name : null };
  if (status === 'ambiguous' && Array.isArray(idn.candidates)) { // faithful UX 1: names the Worker surfaces
    const named = idn.candidates.map((cid) => engine.byId.get(cid)).filter(Boolean)
      .map((r) => ({ display_name: r.canonical_display_name, authority_name: r.authority_accepted_name || null }));
    if (named.length) identity.candidates = named;
  }
  const resp = {
    identity_status: status,
    identity,
    specification: { selected_format: sel.selected_format, technical_status: sel.technical_status, role: sel.role },
    explanation,
    reasoning_checks: asGuidance ? null : reasoningChecks(ladder, sel.selected_format),
    reasoning_basis: resolved ? 'botanical' : 'role',
    specification_token: (resolved && !asGuidance) ? 'HEAD.SIG' : null,
    version: { api_schema_version: 2, matrix_version: 'm', identity_version: 'i', observed_form_graph_version: 'g', response_generated_at: 't' },
  };
  if (resolved && asGuidance && ((ladder && ladder.routing === 'guidance_only') || catalogueNoFit)) resp.guidance_label = 'Typical commercial approach';
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
  // UX 1: the resolver's candidate identities are listed as a bulleted name list; no canonical IDs leak
  const cnames = (buildResp(CPROD, CROLE, AMBIG).identity.candidates || []).map((c) => c.authority_name || c.display_name);
  ok('ambiguous UX1: candidates render as bullets ("This name may refer to:" + one <li> per name)',
    /This name may refer to:/.test(h) && /<ul>/.test(h) && cnames.length >= 2 && cnames.every((n) => h.includes('<li>' + n + '</li>')), h);
  const acids = resolve(null, AMBIG, engine.exact, engine.common).candidates || [];
  ok('ambiguous UX1: NO canonical_id string appears anywhere in the rendered card', acids.length >= 2 && acids.every((id) => !h.includes(id)), 'cids=' + acids.join(','));
}
// ---- UX 2: catalogue cell with no selectable format but a rec -> category-error guidance, not a dead-end ----
{ // taila|active is one of the 3 approved cells (classical sneha-paka; the herb is infused in-process)
  const r = buildResp('taila', 'active', resolvableLatin);
  const h = client.renderResponse(r);
  ok('UX2: response is a category error, NOT "No suitable commercial format"', r.specification.technical_status === 'This role is normally fulfilled differently' && !/No suitable commercial format/.test(JSON.stringify(r)), JSON.stringify(r.specification));
  ok('UX2: surfaces the role rec under "Typical commercial approach" and issues NO token (Stage-2 disabled)',
    r.guidance_label === 'Typical commercial approach' && r.specification_token === null && /Typical commercial approach/.test(h) && /disabled/.test(h) && !/Recommended form/.test(h), h);
}
// ---- wording audit: no Stage-2 copy may imply the catalogue/inventory was checked ----
{ const IMPLIES_STOCK = /sourcing network shows|in our inventory|we stock|in stock|available to source|catalogue match/i;
  for (const mc of ['exact_match', 'compatible_alternative', 'ask_us_to_source']) {
    const h = client.renderStage2Result({ match_class: mc, product_handles: [], sourcing_route: 'x' });
    ok('wording (' + mc + '): sourcing copy does not imply the catalogue/inventory was checked', !IMPLIES_STOCK.test(h), h);
  }
}
// ---- BUG 4: "not evaluated"/"application review" candidate must NOT render as pass (green) ----
{ const se = buildResp(CPROD, CROLE, resolvableLatin, 'SE');
  const hSE = client.renderResponse(se);
  ok('BUG4: SE (application review) is severity=neutral and renders the caution "review" class, never "ok"', se.candidate_assessment.severity === 'neutral' && /bb-cand review/.test(hSE) && !/bb-cand ok/.test(hSE), hSE);
  // a code not evaluated for this cell -> neutral, not a pass
  const unevalCode = ['MP', 'RE', 'OE', 'WL', 'WD', 'SD'].find((c) => !engine.ladder.get(CPR).fmt[c]);
  if (unevalCode) { const ne = buildResp(CPROD, CROLE, resolvableLatin, unevalCode); const hNE = client.renderResponse(ne);
    ok('BUG4: an unevaluated format is severity=neutral and never renders the green "ok" style', ne.candidate_assessment.severity === 'neutral' && /bb-cand review/.test(hNE) && !/bb-cand ok/.test(hNE), hNE); }
  // the "ok" candidate really is green (guard the mapping did not over-correct)
  const okc = buildResp(CPROD, CROLE, resolvableLatin, C_OK); const hOK = client.renderResponse(okc);
  ok('BUG4: a genuine best-fit candidate still renders the "ok" (green) style', okc.candidate_assessment.severity === 'ok' && /bb-cand ok/.test(hOK), hOK);
}
// ---- BUG 3: one status field, one meaning — guidance uses "Assessment", never a bare "Status" ----
{ const guidance = { identity_status: 'resolved', identity: { display_name: 'Licorice', authority_name: 'Glycyrrhiza glabra' },
    specification: { selected_format: null, technical_status: 'Technical guidance for this role', role: 'Flavour / aroma' },
    explanation: 'Water-soluble liquid flavour', reasoning_checks: null, reasoning_basis: 'botanical', specification_token: null };
  const gh = client.renderResolved(guidance);
  ok('BUG3: a guidance (no-format) result labels the row "Assessment", not a bare "Status"', /<span class="bb-sp-k">Assessment<\/span>/.test(gh) && !/<span class="bb-sp-k">Status<\/span>/.test(gh), gh);
  ok('BUG3: "Technical status" is reserved for a form\'s physical-fit verdict (present on the resolved+format card only)',
    /<span class="bb-sp-k">Technical status<\/span>/.test(client.renderResponse(buildResp(CPROD, CROLE, resolvableLatin))) && !/Technical status/.test(gh));
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
  }
  // BUG 2: the sourcing card's "Ask Herbuno to source this" is a WIRED control (data-enquiry), not inert
  const src = client.renderStage2Result({ match_class: 'ask_us_to_source', product_handles: [], sourcing_route: 'request_sourcing' });
  ok('BUG2: sourcing card exposes a wired enquiry control (data-enquiry on "Ask Herbuno to source this")', /data-enquiry="1"[^>]*>Ask Herbuno to source this/.test(src), src);
}
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
// ---- Step 3 live-fixes ----
{ // #3 a 400 (unmapped product×role) renders "not available", NEVER the degraded message
  const na = client.renderNotAvailable('unknown_product_role');
  ok('fix#3: 400 renders a "not available for this product" card, not degraded', /isn.t set up for this product/.test(na) && !/[Tt]emporarily un/.test(na), na);
  ok('fix#3: notAvailableMessage distinguishes unknown_product_role from generic input errors', /role isn.t set up/.test(client.notAvailableMessage('unknown_product_role')) && /check your selections/.test(client.notAvailableMessage('bad_botanical')));
  // #3 the 200 guidance response (guidance_status) renders the not-available card, whatever identity_status says
  const gd = client.renderResponse({ identity_status: 'not_applicable', guidance_status: 'not_available_for_product', guidance: 'This role is not set up for the selected finished product.', specification: null, specification_token: null, version: { api_schema_version: 2 } });
  ok('fix#3: a 200 guidance_status response renders the not-available card (not a spec/degraded card)', /Not available for this product/.test(gd) && /not set up for the selected finished product/.test(gd) && !/Recommended form|Temporarily/.test(gd), gd);
  // #2 guidance response (selected_format null) → guidance card, no fake "Recommended form", Stage-2 disabled
  const guidance = { identity_status: 'resolved', identity: { display_name: 'Pomegranate', authority_name: 'Punica granatum' },
    specification: { selected_format: null, technical_status: 'Not a separately sourced ingredient here', role: 'Base' },
    explanation: 'No sourced base — the gel or compressed-chew matrix is the body',
    reasoning_checks: null, reasoning_basis: 'botanical', specification_token: null };
  const gh = client.renderResponse(guidance);
  ok('fix#2: guidance response shows the guidance text and no fake "Recommended form" row', /No sourced base/.test(gh) && !/Recommended form/.test(gh), gh);
  ok('fix#2: guidance response disables Stage-2 (no token)', /disabled/.test(gh));
  // #1 display: common name + Latin, and de-duplicated when identical
  ok('fix#1: renders "Pomegranate — Punica granatum"', /Pomegranate/.test(gh) && /Punica granatum/.test(gh));
  const dup = client.renderResolved({ identity_status: 'resolved', identity: { display_name: 'Punica granatum', authority_name: 'Punica granatum' }, specification: { selected_format: 'MP', technical_status: 'Best physical fit', role: 'Active' }, explanation: 'x', reasoning_checks: null, reasoning_basis: 'botanical', specification_token: 'T' });
  ok('fix#1: when display == Latin, it is shown once (no "X — X" duplicate)', (dup.match(/Punica granatum/g) || []).length === 1, dup.slice(0, 160));
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
