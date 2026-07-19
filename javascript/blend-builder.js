/* HerbIQ Formulator — client (ADR-014 Step 3).
 *
 * This client holds NO matrix, identity or graph decision data. Stage 1 (formulation) and Stage 2
 * (sourcing) run SERVER-SIDE behind the Shopify App Proxy → Cloudflare Worker; the browser only collects
 * inputs, calls the two endpoints, and renders the minimal response. The only data embedded here is UI
 * vocabulary: product/role labels for the pickers and format-code display labels. There is no window.HB_MX
 * dependency (herbuno-matrix.js is no longer loaded in production).
 *
 * Pure functions (request building, response→HTML rendering, version check) are exported under Node for
 * tests; the DOM/fetch bootstrap runs only in the browser. */
(function () {
  'use strict';
  var IS_BROWSER = typeof document !== 'undefined' && typeof window !== 'undefined';

  // The client rejects any response whose schema is not exactly this — never renders a partial/guessed result.
  var API_SCHEMA_VERSION = 2;
  var SPEC_ENDPOINT = '/apps/formulator/specification';
  var PROC_ENDPOINT = '/apps/formulator/procurement';

  var DEGRADED_FALLBACK = 'HerbIQ Formulator is temporarily unable to generate the technical specification. ' +
    'Your selections have been preserved; please retry shortly or send them to Herbuno for review.';
  var BUILD_STUB = 'Full blend builder is being upgraded — the multi-ingredient workspace is being migrated ' +
    'to the secure server-side knowledge layer. For now, use Check one ingredient.';

  // ---- UI vocabulary ONLY (NOT the decision matrix): format-code display labels ----
  var FORMAT_LABELS = { MP: 'Milled powder', RE: 'Ratio (full-spectrum) extract', SE: 'Standardised extract',
    WL: 'Water-soluble extract', OE: 'Oil-soluble extract', WD: 'Whole / cut material', CO: 'Carrier oil',
    SD: 'Spray-dried powder', TC: 'Cut botanical' };
  // Candidate picker: UI label -> code sent. The label is NEVER the contract. 'Other' is never sent
  // (free text in the enquiry only). "Liquid extract" is ambiguous and deliberately NOT offered.
  var CANDIDATE_OPTIONS = [ { label: 'Milled powder', code: 'MP' }, { label: 'Ratio extract', code: 'RE' },
    { label: 'Standardised extract', code: 'SE' }, { label: 'Water-soluble extract', code: 'WL' },
    { label: 'Oil-soluble extract', code: 'OE' }, { label: 'Whole / cut material', code: 'WD' },
    { label: 'Other', code: null } ];
  var ROLES = [ { id: 'base', label: 'Base', desc: 'the primary carrier or body of the product' },
    { id: 'active', label: 'Active', desc: 'the ingredient delivering the main intended benefit' },
    { id: 'functional', label: 'Functional', desc: 'fibre or bulking ingredient' },
    { id: 'flavour', label: 'Flavour', desc: 'flavour or aroma' },
    { id: 'carrier', label: 'Carrier', desc: 'carrier or excipient' },
    { id: 'texture', label: 'Texture', desc: 'texture or structure' },
    { id: 'colour', label: 'Colour', desc: 'colour' } ];
  var PRODUCTS = [
    { fam: 'Oral Solids', items: [{ id: 'capsule', name: 'Hard Capsule — conventional dry fill' }, { id: 'softgel', name: 'Softgel — oil-based fill' }, { id: 'tablet-dc', name: 'Tablet — Direct Compression' }, { id: 'tablet-wg', name: 'Tablet — Wet Granulation' }, { id: 'effervescent', name: 'Effervescent Tablet' }, { id: 'gummy', name: 'Gummy / Chewable' }, { id: 'lozenge-c', name: 'Lozenge — Compressed' }, { id: 'pastille', name: 'Pastille — Cooked' }] },
    { fam: 'Oral Powders', items: [{ id: 'instant-hot', name: 'Instant Beverage — Hot / Opaque or Cloudy' }, { id: 'instant-cold', name: 'Instant Beverage — Cold / Opaque or Cloudy' }, { id: 'sachet', name: 'Dispersible Sachet / Drink Powder' }, { id: 'scoop', name: 'Scoop / Bulk Blend' }] },
    { fam: 'Oral Liquids', items: [{ id: 'rtd-clear', name: 'RTD — Clear' }, { id: 'rtd-cloudy', name: 'RTD — Cloudy / Suspension' }, { id: 'drops-aq', name: 'Drops — Aqueous / Hydroalcoholic' }, { id: 'drops-oil', name: 'Drops — Oil-based' }, { id: 'syrup', name: 'Syrup — uniform solution' }, { id: 'spray', name: 'Oral Spray' }, { id: 'shot', name: 'Shot / Concentrate' }] },
    { fam: 'Food & Beverage', items: [{ id: 'bakery', name: 'Bakery & Snack Fortification' }, { id: 'confectionery', name: 'Chocolate / Fat-based Confectionery Coating' }, { id: 'dairy', name: 'Dairy & Plant Milk' }, { id: 'tea', name: 'Tea & Infusion — Brewed/Strained' }, { id: 'savoury', name: 'Savoury, Culinary & Seasoning' }] },
    { fam: 'Cosmetic & Topical', items: [{ id: 'serum', name: 'Clear Aqueous Serum / Toner' }, { id: 'cream', name: 'Cream / Lotion' }, { id: 'face-oil', name: 'Face & Hair Oil' }, { id: 'balm', name: 'Balm / Stick / Bar' }, { id: 'cleanser', name: 'Shampoo / Cleanser' }, { id: 'mask-dry', name: 'Mask — Dry Powder' }, { id: 'mask-wet', name: 'Mask — Preserved Wet' }] },
    { fam: 'Traditional & Specialty', items: [{ id: 'taila', name: 'Taila — medicated oil' }, { id: 'churna', name: 'Churna — classical powder' }, { id: 'kashaya', name: 'Kashaya — decoction' }, { id: 'aroma-diff', name: 'Aromatherapy — Room Diffuser' }, { id: 'aroma-roll', name: 'Aromatherapy — Topical Roll-on' }, { id: 'ff', name: 'Fragrance & Flavour System (B2B)' }, { id: 'pet', name: 'Pet Supplement' }, { id: 'rnd', name: 'R&D Pilot & Sampling' }] },
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function productName(id) { for (var i = 0; i < PRODUCTS.length; i++) { var it = PRODUCTS[i].items; for (var j = 0; j < it.length; j++) if (it[j].id === id) return it[j].name; } return id; }
  function roleLabel(id) { for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i].label; return id; }
  function formLabel(code) { return code ? (FORMAT_LABELS[code] || code) : 'Application review needed'; }
  function candidateLabel(code) { for (var i = 0; i < CANDIDATE_OPTIONS.length; i++) if (CANDIDATE_OPTIONS[i].code === code) return CANDIDATE_OPTIONS[i].label; return FORMAT_LABELS[code] || code; }

  // ---- pure: request body (candidate_format sent ONLY when the user actually chose one) ----
  function buildSpecBody(state) {
    var b = { product: state.product, role: state.role, botanical: (state.botanical || '').trim() };
    // 'Other' (sentinel 'OTHER') and empty are NEVER sent — 'Other' is free text in the enquiry only.
    if (state.candidate && state.candidate !== 'OTHER') b.candidate_format = state.candidate;
    return b;
  }
  // ---- pure: schema compatibility (reject incompatible responses in EITHER direction) ----
  function apiCompatible(resp) { return !!(resp && resp.version && resp.version.api_schema_version === API_SCHEMA_VERSION); }

  // ---- pure: rendering (return HTML strings; no DOM access) ----
  function reasoningRow(k, v) { return '<div class="bb-rc-r"><span class="bb-rc-k">' + esc(k) + '</span><span class="bb-rc-v">' + esc(v) + '</span></div>'; }
  function renderReasoning(resp) {
    var rc = resp.reasoning_checks; if (!rc) return '';
    var note = resp.reasoning_basis === 'role' ? '<p class="bb-rc-note">Based on the product and role only — not this specific botanical.</p>' : '';
    return '<details class="bb-reasoning"><summary>Why this recommendation — 3 checks</summary>' +
      '<div class="bb-rc-body">' + note +
      reasoningRow('Phase compatibility', rc.phase) +
      reasoningRow('Dissolution / dispersion requirement', rc.dissolution) +
      reasoningRow('Process constraint', rc.process) +
      '</div></details>';
  }
  function candidateStatusClass(status) {
    if (/^Best/.test(status)) return 'ok';
    if (/^Conditional/.test(status)) return 'warn';
    if (/^Not suitable/.test(status)) return 'avoid';
    return 'review';
  }
  function renderCandidate(resp) {
    var ca = resp.candidate_assessment; if (!ca) return '';
    return '<div class="bb-cand ' + candidateStatusClass(ca.technical_status) + '">' +
      '<div class="bb-cand-r"><span class="bb-cand-k">Your proposed format</span><span class="bb-cand-v">' + esc(candidateLabel(ca.format)) + '</span></div>' +
      '<div class="bb-cand-status">' + esc(ca.technical_status) + '</div>' +
      '<div class="bb-cand-exp">' + esc(ca.explanation) + '</div></div>';
  }
  function specRow(k, v) { return '<div class="bb-sp-r"><span class="bb-sp-k">' + esc(k) + '</span><span class="bb-sp-v">' + v + '</span></div>'; }
  // Stage-2 action. Enabled ONLY for a resolved identity (a valid token exists). Wording is
  // "Check sourcing options" — NEVER "Check Herbuno availability" and never a "catalogue match": real
  // stock/product handles are not wired yet (Stage 2 is a temporary proxy over the observed-form graph).
  function renderStage2Action(resp) {
    if (resp.identity_status === 'resolved' && resp.specification_token) {
      return '<div class="bb-actions"><button class="bb-btn" data-sourcing="1">Check sourcing options →</button></div>';
    }
    return '<div class="bb-actions"><button class="bb-btn" disabled>Check sourcing options →</button>' +
      '<span class="bb-actions-note">Confirm the botanical identity to check sourcing.</span></div>';
  }
  function renderResolved(resp) {
    var sp = resp.specification || {}, id = resp.identity || {};
    var who = id.display_name ? esc(id.display_name) + (id.authority_name ? ' — <i>' + esc(id.authority_name) + '</i>' : '') : '<i>unnamed</i>';
    var h = '<div class="bb-card resolved">' +
      specRow('Resolved botanical', who) +
      specRow('Recommended form', '<b>' + esc(formLabel(sp.selected_format)) + '</b>') +
      specRow('Technical status', esc(sp.technical_status || '—')) +
      specRow('Why', esc(resp.explanation || '')) +
      '</div>';
    h += renderCandidate(resp);
    h += renderReasoning(resp);
    h += renderStage2Action(resp);
    return h;
  }
  // ambiguous / unrecognised: NO identity claim, NO Stage-2. Generic Product×Role guidance may still show,
  // clearly labelled role-based (reasoning_basis === 'role').
  function renderNonResolved(resp) {
    var sp = resp.specification || {};
    var headline = resp.identity_status === 'ambiguous'
      ? 'Multiple botanical identities match this name'
      : 'No botanical identity matched this name';
    var h = '<div class="bb-card ' + esc(resp.identity_status) + '">' +
      '<div class="bb-card-head">' + esc(headline) + '</div>' +
      '<p class="bb-card-msg">' + esc(resp.explanation || '') + '</p>' +
      '<p class="bb-card-sub">Guidance below is <b>role-based, not botanical-specific</b>.</p>' +
      specRow('Form for this role', '<b>' + esc(formLabel(sp.selected_format)) + '</b>') +
      specRow('Technical status', esc(sp.technical_status || '—')) +
      '</div>';
    h += renderCandidate(resp);
    h += renderReasoning(resp);
    h += renderStage2Action(resp);
    return h;
  }
  // Valid 200 responses (the caller must have already confirmed apiCompatible).
  function renderResponse(resp) {
    return resp.identity_status === 'resolved' ? renderResolved(resp) : renderNonResolved(resp);
  }
  function renderStage2Result(proc) {
    // Stage 2 (temporary proxy over the observed-form graph): a sourcing route only, NEVER a catalogue match.
    var cls = proc.match_class, msg;
    if (cls === 'exact_match') msg = "Herbuno's sourcing network shows this form is available to source.";
    else if (cls === 'compatible_alternative') msg = 'A compatible form is available to source; the exact form may need a sourcing request.';
    else msg = 'Not currently in the observed sourcing network — ask Herbuno to source this.';
    return '<div class="bb-sourcing"><div class="bb-sourcing-h">Sourcing options</div>' +
      '<p class="bb-sourcing-msg">' + esc(msg) + '</p>' +
      '<div class="bb-actions"><button class="bb-btn o" data-enquiry="1">Ask Herbuno to source this →</button>' +
      '<button class="bb-btn o" data-backspec="1">← Back to specification</button></div></div>';
  }
  function renderLoading(label) { return '<div class="bb-loading"><span class="bb-spinner" aria-hidden="true"></span>' + esc(label || 'Generating specification…') + '</div>'; }
  function renderRateLimited() { return '<div class="bb-card ratelimited"><div class="bb-card-head">Too many checks just now</div>' +
    '<p class="bb-card-msg">Please wait a moment and try again.</p></div>'; }
  function renderDegraded(message) { return '<div class="bb-card degraded"><div class="bb-card-head">Temporarily unavailable</div>' +
    '<p class="bb-card-msg">' + esc(message || DEGRADED_FALLBACK) + '</p>' +
    '<div class="bb-actions"><button class="bb-btn" data-retry="1">Retry</button>' +
    '<button class="bb-btn o" data-copysel="1">Copy my selections</button>' +
    '<button class="bb-btn o" data-enquiry="1">Open an enquiry</button></div></div>'; }

  // ================= Browser bootstrap (skipped under Node) =================
  if (!IS_BROWSER) {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { buildSpecBody: buildSpecBody, apiCompatible: apiCompatible, renderResponse: renderResponse,
        renderResolved: renderResolved, renderNonResolved: renderNonResolved, renderReasoning: renderReasoning,
        renderCandidate: renderCandidate, renderStage2Action: renderStage2Action, renderStage2Result: renderStage2Result,
        renderLoading: renderLoading, renderRateLimited: renderRateLimited, renderDegraded: renderDegraded,
        formLabel: formLabel, candidateLabel: candidateLabel, FORMAT_LABELS: FORMAT_LABELS,
        CANDIDATE_OPTIONS: CANDIDATE_OPTIONS, ROLES: ROLES, PRODUCTS: PRODUCTS, API_SCHEMA_VERSION: API_SCHEMA_VERSION,
        BUILD_STUB: BUILD_STUB };
    }
    return;
  }

  var root = document.getElementById('bb');
  if (!root) return;
  var S = { mode: 'quick', product: '', role: '', botanical: '', candidate: '', view: 'input', message: '', resp: null, proc: null };
  try { var lm = sessionStorage.getItem('hb_mode'); if (lm === 'build' || lm === 'quick') S.mode = lm; } catch (e) {}

  function productOptions() {
    var o = '<option value="">Select a product…</option>';
    for (var i = 0; i < PRODUCTS.length; i++) { o += '<optgroup label="' + esc(PRODUCTS[i].fam) + '">';
      var it = PRODUCTS[i].items; for (var j = 0; j < it.length; j++) o += '<option value="' + esc(it[j].id) + '"' + (it[j].id === S.product ? ' selected' : '') + '>' + esc(it[j].name) + '</option>';
      o += '</optgroup>'; }
    return o;
  }
  function roleOptions() {
    var o = '<option value="">Select a role…</option>';
    for (var i = 0; i < ROLES.length; i++) o += '<option value="' + esc(ROLES[i].id) + '"' + (ROLES[i].id === S.role ? ' selected' : '') + '>' + esc(ROLES[i].label) + ' — ' + esc(ROLES[i].desc) + '</option>';
    return o;
  }
  function candidateOptionsHtml() {
    var o = '<option value="">Not sure / no preference</option>';
    for (var i = 0; i < CANDIDATE_OPTIONS.length; i++) { var c = CANDIDATE_OPTIONS[i];
      // 'Other' selects free text (never a code sent to the server); an empty candidate is sent as nothing.
      var val = c.code == null ? 'OTHER' : c.code, on = (c.code === S.candidate) || (c.code == null && S.candidate === 'OTHER');
      o += '<option value="' + esc(val) + '"' + (on ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }
    return o;
  }
  function controls() {
    var canSubmit = S.product && S.role && (S.botanical || '').trim();
    return '<div class="bb-controls">' +
      '<div class="bb-field"><label class="bb-lbl">1 · What are you making?</label><select class="bb-sel" id="bb-prod">' + productOptions() + '</select></div>' +
      '<div class="bb-field"><label class="bb-lbl">2 · Which role does it perform?</label><select class="bb-sel" id="bb-role">' + roleOptions() + '</select></div>' +
      '<div class="bb-field"><label class="bb-lbl">3 · Which botanical?</label><input class="bb-in" id="bb-bot" value="' + esc(S.botanical) + '" placeholder="Type any botanical — e.g. Ashwagandha" autocomplete="off"></div>' +
      '<div class="bb-field"><label class="bb-lbl">4 · Already have a format in mind? <span class="bb-opt">(optional)</span></label><select class="bb-sel" id="bb-cand">' + candidateOptionsHtml() + '</select></div>' +
      '<div class="bb-actions"><button class="bb-btn" id="bb-go"' + (canSubmit ? '' : ' disabled') + '>Get specification →</button></div>' +
      '</div>';
  }
  function workHtml() {
    if (S.view === 'loading') return renderLoading('Generating specification…');
    if (S.view === 'loading2') return renderResponse(S.resp) + renderLoading('Checking sourcing options…');
    if (S.view === 'degraded') return renderDegraded(S.message);
    if (S.view === 'ratelimited') return renderRateLimited();
    if (S.view === 'sourcing' && S.proc) return renderResponse(S.resp) + renderStage2Result(S.proc);
    if (S.view === 'result' && S.resp) return renderResponse(S.resp);
    return '<p class="bb-empty">Pick a product, a role and a botanical, then get the recommended ingredient form — and check a format you already have in mind before you buy.</p>';
  }
  function buildStub() { return '<div class="bb-card"><div class="bb-card-head">Full blend builder</div><p class="bb-card-msg">' + esc(BUILD_STUB) + '</p></div>'; }

  function draw() {
    var modes = document.querySelectorAll('.bb-mode');
    for (var i = 0; i < modes.length; i++) modes[i].classList.toggle('on', modes[i].getAttribute('data-mode') === S.mode);
    var C = document.getElementById('bb-controls'), W = document.getElementById('bb-work');
    if (S.mode === 'build') { C.innerHTML = ''; W.innerHTML = buildStub(); return; }
    C.innerHTML = controls();
    W.innerHTML = workHtml();
  }

  function enquiryMailto() {
    var subj = 'Formulator enquiry: ' + (S.botanical || 'botanical') + ' for ' + productName(S.product);
    var body = 'Product: ' + productName(S.product) + '\nRole: ' + roleLabel(S.role) + '\nBotanical: ' + (S.botanical || '') +
      (S.candidate && S.candidate !== 'OTHER' ? '\nFormat in mind: ' + candidateLabel(S.candidate) : '') +
      '\n\nPlease advise on sourcing.';
    return 'mailto:hello@herbuno.com?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.status === 429 ? { rate: true } : r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }
  function submitSpec() {
    if (!(S.product && S.role && (S.botanical || '').trim())) return;
    S.view = 'loading'; S.resp = null; S.proc = null; draw();
    postJson(SPEC_ENDPOINT, buildSpecBody(S)).then(function (r) {
      if (r.rate) { S.view = 'ratelimited'; return draw(); }
      if (r.status !== 200 || !apiCompatible(r.body)) { S.view = 'degraded'; S.message = (r.body && r.body.message) || DEGRADED_FALLBACK; return draw(); }
      S.resp = r.body; S.view = 'result'; draw();
    }).catch(function () { S.view = 'degraded'; S.message = DEGRADED_FALLBACK; draw(); });
  }
  function submitSourcing() {
    if (!S.resp || S.resp.identity_status !== 'resolved' || !S.resp.specification_token) return;
    S.view = 'loading2'; draw();
    postJson(PROC_ENDPOINT, { specification_token: S.resp.specification_token }).then(function (r) {
      if (r.rate) { S.view = 'ratelimited'; return draw(); }
      if (r.status !== 200 || !apiCompatible(r.body)) { S.view = 'degraded'; S.message = (r.body && r.body.message) || DEGRADED_FALLBACK; return draw(); }
      S.proc = r.body; S.view = 'sourcing'; draw();
    }).catch(function () { S.view = 'degraded'; S.message = DEGRADED_FALLBACK; draw(); });
  }

  root.addEventListener('click', function (e) {
    var md = e.target.closest ? e.target.closest('[data-mode]') : null;
    if (md) { S.mode = md.getAttribute('data-mode'); try { sessionStorage.setItem('hb_mode', S.mode); } catch (x) {} draw(); return; }
    var t = e.target.closest ? e.target.closest('[data-sourcing],[data-backspec],[data-retry],[data-enquiry],[data-copysel],#bb-go') : null;
    if (!t) return;
    if (t.id === 'bb-go') submitSpec();
    else if (t.getAttribute('data-sourcing') != null) submitSourcing();
    else if (t.getAttribute('data-backspec') != null) { S.view = 'result'; S.proc = null; draw(); }
    else if (t.getAttribute('data-retry') != null) submitSpec();
    else if (t.getAttribute('data-enquiry') != null) { window.location.href = enquiryMailto(); }
    else if (t.getAttribute('data-copysel') != null) {
      var sel = 'Product: ' + productName(S.product) + ' · Role: ' + roleLabel(S.role) + ' · Botanical: ' + (S.botanical || '');
      try { navigator.clipboard.writeText(sel); t.textContent = 'Copied'; } catch (x) {}
    }
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'bb-bot') { S.botanical = e.target.value; var go = document.getElementById('bb-go'); if (go) go.disabled = !(S.product && S.role && S.botanical.trim()); }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'bb-prod') { S.product = t.value; S.view = 'input'; S.resp = null; S.proc = null; draw(); }
    else if (t.id === 'bb-role') { S.role = t.value; S.view = 'input'; S.resp = null; S.proc = null; draw(); }
    else if (t.id === 'bb-cand') { S.candidate = t.value; }
  });

  draw();
})();
