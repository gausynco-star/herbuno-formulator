// Client (javascript/blend-builder.js) render tests — v3 messaging taxonomy.
// Run: node worker/test/client_render_tests.mjs
// The client is pure-tested against FAITHFUL Worker responses: each response is built with the SAME engine
// functions the Worker uses (buildMessage / reasoning_checks / candidate_assessment), then rendered. Also
// asserts the shipped client + shell carry NO matrix/identity/graph decision data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeEngine, resolve, statusOf, selectSpecification, buildMessage, cleanProse, reasoningChecks, assessCandidate, displayName } from '../src/engine.js';
import { generateAll } from '../tools/generate_payloads.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_PATH = path.join(ROOT, 'javascript', 'blend-builder.js');
const SHELL_PATH = path.join(ROOT, 'liquid', 'blend-builder-shell.liquid');
const client = require(CLIENT_PATH);

const B = generateAll();
const engine = makeEngine(B.identityIndex, B.formGraph, B.matrix);
const resolvableLatin = B.identityIndex.identities.find(r => r.authority_accepted_name).authority_accepted_name;
let AMBIG = 'Ajwain';
for (const [k, s] of engine.common) { if (s.size > 1 && statusOf(resolve(null, k, engine.exact, engine.common)) === 'ambiguous') { AMBIG = k; break; } }
// a Cat-1 catalogue cell with an ok AND an avoid code (for candidate contrast)
let CPR = null, C_OK = null, C_AVOID = null;
for (const [k, L] of engine.ladder) { if (L.routing !== 'catalogue') continue;
  const okc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'ok' && c !== 'SE');
  const avc = Object.keys(L.fmt).find(c => L.fmt[c].tier === 'avoid' && c !== 'SE');
  if (okc && avc) { CPR = k; C_OK = okc; C_AVOID = avc; break; } }
const [CPROD, CROLE] = CPR.split('|');

// faithful reproduction of index.js specification() v3 response construction (no HTTP/limiter/token crypto)
function buildResp(product, role, botanical, candidate) {
  const idn = resolve(null, botanical, engine.exact, engine.common);
  const status = statusOf(idn);
  const resolved = status === 'resolved';
  const ladder = engine.ladder.get(product + '|' + role);
  const rec = resolved && idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;
  const message = buildMessage(ladder);
  const isCatalogue = ladder && ladder.routing === 'catalogue';
  const catSel = isCatalogue ? selectSpecification(ladder) : null;
  const cat1WithFormat = message && message.category === '1' && !!(catSel && catSel.selected_format);
  const identity = { display_name: rec ? displayName(rec) : null, authority_name: rec ? rec.authority_accepted_name : null };
  if (status === 'ambiguous' && Array.isArray(idn.candidates)) {
    const named = idn.candidates.map((cid) => engine.byId.get(cid)).filter(Boolean)
      .map((r) => ({ display_name: displayName(r), authority_name: r.authority_accepted_name || null }));
    if (named.length) identity.candidates = named;
  }
  const resp = {
    identity_status: status, identity, message,
    reasoning_checks: cat1WithFormat ? reasoningChecks(ladder, catSel.selected_format) : null,
    reasoning_basis: resolved ? 'botanical' : 'role',
    specification_token: (resolved && cat1WithFormat) ? 'HEAD.SIG' : null,
    version: { api_schema_version: 3, matrix_version: 'm', identity_version: 'i', observed_form_graph_version: 'g', response_generated_at: 't' },
  };
  if (candidate !== undefined) resp.candidate_assessment = assessCandidate(ladder, candidate);
  return resp;
}

let pass = 0, fail = 0; const out = [];
const ok = (name, cond, detail) => { (cond ? pass++ : fail++); out.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + (detail || ''))); };
const NO_AVAIL = /Check Herbuno availability/i, NO_CATMATCH = /catalogue match|in stock/i;

// ---- Cat 1: recommendation ----
{ const r = buildResp(CPROD, CROLE, resolvableLatin);
  const h = client.renderResponse(r);
  const recBody = cleanProse(engine.ladder.get(CPR).rec), whyBody = cleanProse(engine.ladder.get(CPR).reason);
  ok('cat1: header from category ("Recommended form"), status badge, Recommendation + Why this form fits',
    /Resolved botanical/.test(h) && /bb-msg-head">Recommended form</.test(h) && /bb-status /.test(h) && /Recommendation<\/span>/.test(h) && /Why this form fits<\/span>/.test(h), h.slice(0, 200));
  ok('cat1: body is the stored `rec` VERBATIM (message.body) and rendered', r.message.body === recBody && h.includes(recBody), r.message.body);
  ok('cat1: "Why this form fits" is the stored `reason`, NOT concatenated with rec', r.message.why === whyBody && whyBody !== recBody && !h.includes(recBody + ' ' + whyBody), r.message.why);
  ok('cat1: Stage-2 action reads "Check sourcing options" and is ENABLED', /Check sourcing options/.test(h) && !/disabled>Check sourcing options/.test(h), h);
  ok('cat1: NEVER "Check Herbuno availability"/"catalogue match"/"in stock"', !NO_AVAIL.test(h) && !NO_CATMATCH.test(h));
  ok('cat1: reasoning renders 3 checks (collapsed <details>)', /Why this recommendation — 3 checks/.test(h) && /Phase compatibility/.test(h) && /Dissolution \/ dispersion requirement/.test(h) && /Process constraint/.test(h) && /<details/.test(h), h);
  ok('cat1: best-fit is NOT labelled role-based', !/role-based, not botanical-specific/.test(h));
}
// ---- Cat 1: status subtypes render visibly distinct ----
{ const hBest = client.renderResponse(buildResp(CPROD, CROLE, resolvableLatin));   // Best physical fit
  const rProc = buildResp('taila', 'active', resolvableLatin);                     // Process-specific recommendation
  const hProc = client.renderResponse(rProc);
  const rRev = buildResp('capsule', 'functional', resolvableLatin);               // Application review needed
  const hRev = client.renderResponse(rRev);
  ok('cat1 status: Best physical fit -> bb-status-best', /bb-status-best/.test(hBest) && client.statusSlug('Best physical fit') === 'best', hBest.slice(0, 120));
  ok('cat1 status: Process-specific recommendation -> distinct class, no Stage-2/reasoning (no format)',
    rProc.message.technical_status === 'Process-specific recommendation' && /bb-status-process/.test(hProc) && !/Check sourcing options/.test(hProc) && !/3 checks/.test(hProc), hProc.slice(0, 160));
  ok('cat1 status: Application review needed -> distinct (dashed) class, never the green "best" class',
    rRev.message.technical_status === 'Application review needed' && /bb-status-review/.test(hRev) && !/bb-status-best/.test(hRev), hRev.slice(0, 160));
  ok('cat1 status: process/review body is still the stored rec VERBATIM', rProc.message.body === cleanProse(engine.ladder.get('taila|active').rec) && hProc.includes(rProc.message.body), rProc.message.body);
}
// ---- Cat 5: role-driven; BOTH authored sentences; no Why, no reasoning ----
{ const r = buildResp('syrup', 'flavour', resolvableLatin);
  const h = client.renderResponse(r);
  ok('cat5: header "The same type of ingredient is used for any botanical here"', r.message.category === '5' && /bb-msg-head">The same type of ingredient is used for any botanical here</.test(h), h.slice(0, 200));
  ok('cat5: shows BOTH sentences (required form + "does not change that requirement"), not truncated',
    /the required form is/.test(h) && /does not change that requirement/.test(h), h);
  ok('cat5: NO "Why" row and NO reasoning checks and NO Stage-2', !/Why<\/span>|Why this form fits/.test(h) && !/3 checks/.test(h) && !/Check sourcing options/.test(h) && r.message.why === null, h);
}
// ---- Cat 2 / 4B / 6: header from map, body verbatim, Why only when it adds info ----
{ const c2 = buildResp('gummy', 'base', resolvableLatin); const h2 = client.renderResponse(c2);
  ok('cat2: header "This function is handled elsewhere in the product", body = stored rec verbatim',
    c2.message.category === '2' && /bb-msg-head">This function is handled elsewhere in the product</.test(h2) && c2.message.body === cleanProse(engine.ladder.get('gummy|base').rec) && h2.includes(c2.message.body), h2.slice(0, 160));
  ok('cat2: reason ADDS info here -> shown as a "Why" row; no reasoning checks, no Stage-2', c2.message.why && /Why<\/span>/.test(h2) && !/3 checks/.test(h2) && !/Check sourcing options/.test(h2), h2);
  const c4 = buildResp('softgel', 'functional', resolvableLatin);
  ok('cat4B: header "This role does not apply to this product", body verbatim', client.renderResponse(c4).includes('This role does not apply to this product') && c4.message.body === cleanProse(engine.ladder.get('softgel|functional').rec));
  const c6 = buildResp('rnd', 'active', resolvableLatin);
  ok('cat6: header "This needs testing in the finished product", body verbatim', client.renderResponse(c6).includes('This needs testing in the finished product') && c6.message.body === cleanProse(engine.ladder.get('rnd|active').rec));
}
// ---- buildMessage: "Why" shown only when the reason adds information (Cat 2/4B/6); Cat 1 always; Cat 5 never ----
{ ok('why-rule: Cat-2 reason that merely repeats the rec is OMITTED', buildMessage({ msg: { category: '2', header: 'H' }, rec: 'The base is the body.', reason: 'The base is the body.' }).why === null);
  ok('why-rule: Cat-2 reason that adds detail is KEPT', !!buildMessage({ msg: { category: '2', header: 'H' }, rec: 'The base is the body.', reason: 'The base is the body — a formulation system, not a sourced botanical.' }).why);
  ok('why-rule: Cat-1 always keeps the reason as "Why this form fits"', buildMessage({ msg: { category: '1', header: 'H', technical_status: 'Best physical fit' }, rec: 'x', reason: 'x' }).why === 'x');
  ok('why-rule: Cat-5 never has a Why (its authored 2nd sentence carries it)', buildMessage({ msg: { category: '5', header: 'H', body: 'Authored. Both sentences.' }, rec: 'ignored', reason: 'ignored' }).why === null);
}
// ---- ambiguous ----
{ const r = buildResp(CPROD, CROLE, AMBIG, C_AVOID);
  const h = client.renderResponse(r);
  ok('ambiguous: header "This name can refer to more than one botanical", no identity claim', /This name can refer to more than one botanical/.test(h) && !/Resolved botanical/.test(h), h.slice(0, 160));
  ok('ambiguous: labelled role-based, candidate check STILL runs, Stage-2 disabled (Cat-1 cell)',
    /role-based, not botanical-specific/.test(h) && /Your proposed format/.test(h) && /disabled>Check sourcing options/.test(h), h);
  const acids = resolve(null, AMBIG, engine.exact, engine.common).candidates || [];
  ok('ambiguous UX1: candidates as a bulleted list; NO canonical_id leaks', /This name may refer to:/.test(h) && /<ul>/.test(h) && acids.length >= 2 && acids.every((id) => !h.includes(id)), 'cids=' + acids.join(','));
}
// ---- ambiguous candidate formatting: "Common name — Latin name"; Latin-only when no distinct common ----
{ const syn = { identity_status: 'ambiguous', identity: { display_name: null, authority_name: null, candidates: [
      { display_name: 'Arabian Jasmine', authority_name: 'Jasminum sambac' },
      { display_name: 'Jasminum grandiflorum', authority_name: 'Jasminum grandiflorum' }] },
    message: { category: '1', header: 'Recommended form', body: 'x', why: null, technical_status: 'Best physical fit' },
    reasoning_checks: null, reasoning_basis: 'role', specification_token: null, version: { api_schema_version: 3 } };
  const h = client.renderResponse(syn);
  ok('ambiguous: "Common name — Latin name" when a distinct common name exists', /Arabian Jasmine — <i>Jasminum sambac<\/i>/.test(h), h);
  ok('ambiguous: Latin-only when the common name equals the Latin', /<li><i>Jasminum grandiflorum<\/i><\/li>/.test(h), h);
}
// ---- unrecognised ----
{ const h = client.renderResponse(buildResp(CPROD, CROLE, 'Xyzzy Blorptonium 42'));
  ok('unrecognised: "No botanical identity matched this name", role-based, Stage-2 disabled', /No botanical identity matched this name/.test(h) && /role-based, not botanical-specific/.test(h) && /disabled/.test(h), h.slice(0, 160));
}
// ---- candidate assessment: absent unless supplied; SE locked; neutral never green (BUG 4 carried) ----
{ ok('candidate: absent when not supplied', !/Your proposed format/.test(client.renderResponse(buildResp(CPROD, CROLE, resolvableLatin))));
  const se = buildResp(CPROD, CROLE, resolvableLatin, 'SE'); const hSE = client.renderResponse(se);
  ok('candidate SE: locked "Application review needed", neutral "review" class, never "ok"', /Application review needed/.test(hSE) && se.candidate_assessment.severity === 'neutral' && /bb-cand review/.test(hSE) && !/bb-cand ok/.test(hSE), hSE);
  const avc = buildResp(CPROD, CROLE, resolvableLatin, C_AVOID);
  ok('candidate avoid: "Not suitable for this role", avoid class', avc.candidate_assessment.severity === 'avoid' && /Not suitable for this role/.test(client.renderResponse(avc)));
  const okc = buildResp(CPROD, CROLE, resolvableLatin, C_OK); const hOK = client.renderResponse(okc);
  ok('candidate ok: best-fit still renders the green "ok" style', okc.candidate_assessment.severity === 'ok' && /bb-cand ok/.test(hOK), hOK);
}
// ---- Stage-2 sourcing result: never implies the catalogue/inventory was checked; enquiry wired ----
{ const IMPLIES_STOCK = /sourcing network shows|in our inventory|we stock|in stock|available to source|catalogue match/i;
  for (const mc of ['exact_match', 'compatible_alternative', 'ask_us_to_source']) {
    const h = client.renderStage2Result({ match_class: mc, product_handles: [], sourcing_route: 'x' });
    ok('sourcing (' + mc + '): route only, no catalogue/inventory-checked implication', /Sourcing options/.test(h) && !NO_CATMATCH.test(h) && !NO_AVAIL.test(h) && !IMPLIES_STOCK.test(h), h);
  }
  const src = client.renderStage2Result({ match_class: 'ask_us_to_source', product_handles: [], sourcing_route: 'request_sourcing' });
  ok('sourcing: "Ask Herbuno to source this" is a WIRED enquiry control (data-enquiry)', /data-enquiry="1"[^>]*>Ask Herbuno to source this/.test(src), src);
}
// ---- unmapped product×role (guidance_status) + other states ----
{ const gd = client.renderResponse({ identity_status: 'not_applicable', guidance_status: 'not_available_for_product', guidance: 'This role is not set up for the selected finished product.', message: null, specification_token: null, version: { api_schema_version: 3 } });
  ok('unmapped: a guidance_status response renders the not-available card (not a message/degraded card)', /Not available for this product/.test(gd) && /not set up for the selected finished product/.test(gd) && !/Recommended form|Temporarily/.test(gd), gd);
  const na = client.renderNotAvailable('unknown_product_role');
  ok('notAvailable: 400 renders "not available for this product", not degraded', /isn.t set up for this product/.test(na) && !/[Tt]emporarily un/.test(na), na);
  ok('loading: honest indicator, no fake staged reasoning', /Generating specification/.test(client.renderLoading()) && !/step 1|analysing phase/i.test(client.renderLoading()));
  const dg = client.renderDegraded('HerbIQ Formulator is temporarily unable to generate the technical specification.');
  ok('degraded: honest message + retry + copy + enquiry', /temporarily unable/i.test(dg) && /data-retry/.test(dg) && /data-copysel/.test(dg) && /data-enquiry/.test(dg), dg);
}
// ---- schema version: reject incompatible in BOTH directions (v3) ----
{ ok('schema: v3 accepted', client.apiCompatible({ version: { api_schema_version: 3 } }) === true);
  ok('schema: v2 (older worker) rejected', client.apiCompatible({ version: { api_schema_version: 2 } }) === false);
  ok('schema: v4 (newer worker) rejected', client.apiCompatible({ version: { api_schema_version: 4 } }) === false);
  ok('schema: missing version rejected', client.apiCompatible({}) === false && client.apiCompatible(null) === false);
}
// ---- Commit 2: enquiry mailto href generation (unchanged) ----
{ const st = { product: 'capsule', role: 'active', botanical: 'Ashwagandha (Withania somnifera) & root', candidate: 'WL' };
  const href = client.buildMailto(st);
  ok('mailto: starts with recipient + subject param', href.indexOf('mailto:hello@herbuno.com?subject=') === 0, href);
  ok('mailto: EXACTLY one literal "&" (botanical "&" is encoded)', (href.match(/&/g) || []).length === 1 && href.includes('&body='), href);
  ok('mailto: no raw whitespace in the href', !/\s/.test(href), JSON.stringify(href));
  const params = new URLSearchParams(href.slice('mailto:hello@herbuno.com?'.length));
  ok('mailto: subject + body decode correctly, "&" survives as data', /Ashwagandha .* & root/.test(params.get('subject')) && /Product: Hard Capsule/.test(params.get('body')) && /Format in mind: Water-soluble extract/.test(params.get('body')) && params.get('body').includes('& root') && !href.includes('& root'), href);
  const noCand = new URLSearchParams(client.buildMailto({ product: 'capsule', role: 'active', botanical: 'Tulsi', candidate: '' }).split('?')[1]).get('body');
  ok('mailto: omits "Format in mind" when no candidate / "Other"', !noCand.includes('Format in mind') && !new URLSearchParams(client.buildMailto({ product: 'capsule', role: 'active', botanical: 'Tulsi', candidate: 'OTHER' }).split('?')[1]).get('body').includes('Format in mind'));
}
// ---- no matrix/identity/graph decision data in the shipped client or shell ----
{ const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  const src = stripJs(fs.readFileSync(CLIENT_PATH, 'utf8'));
  const shell = fs.readFileSync(SHELL_PATH, 'utf8').replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/g, '');
  const FORBIDDEN = ['HB_MX', 'preferred_formats', 'conditional_formats', 'unsuitable_formats', 'observed_available',
    'canonical_id', 'base_format_code', 'plant_parts', 'product_helpers', 'code_names', 'scientific_synonyms',
    'trade_synonyms', 'ambiguity_flag', '/products.json'];
  const hits = FORBIDDEN.filter(t => src.includes(t));
  ok('no matrix data: shipped client CODE references no matrix/identity/graph decision tokens', hits.length === 0, 'hits=' + hits.join(','));
  ok('no matrix data: client carries no per-format tier decisions (.tier)', !/\.tier\b/.test(src) && !/tier\s*[:=]/.test(src));
  ok('no matrix data: client carries no message-category MAP (only renders the per-request `message`)', !/public_message_category_map|"category"\s*:\s*"[12456]/.test(src));
  ok('no matrix data: shell CODE no longer loads herbuno-matrix.js (only the comment names it)', !/herbuno-matrix\.js/.test(shell));
}

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
