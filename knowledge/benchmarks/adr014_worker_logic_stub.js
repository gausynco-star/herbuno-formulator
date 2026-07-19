// ADR-014 Step 1 — realistic stub of the Cloudflare Worker LOGIC (measurement only; NOT deployed).
//
// This is the code that would ship *in the Worker script* (the 3 MB compressed budget). It is a
// faithful stub: the resolution + Product×Role intersection + specification build are the real
// algorithms (ported from knowledge/pass3/build_pass3.py build_indices() and
// knowledge/sources/common.py resolve()); the security controls (signature, timestamp, rate limit,
// input allow-list) are representative stubs so the measured script size reflects a real deployment,
// not just the algorithm. Data (backbone + form graph) is injected, NOT bundled here — see the
// storage recommendation in adr014_feasibility.md.
'use strict';

// ---------- normalisation (mirrors build_pass3.norm / common.nb) ----------
function nb(s) { return String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
function norm(s) {
  s = (s == null ? '' : String(s)).toLowerCase().replace(/×/g, 'x').trim();
  s = s.replace(/[^a-z0-9\- ]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- token sets (verbatim from build_pass3.py) ----------
const FORM_WORDS = new Set(['extract', 'powder', 'powdered', 'oil', 'soluble', 'water', 'glycerin',
  'glycol', 'infused', 'carrier', 'essential', 'oleoresin', 'hydrosol', 'paste', 'dried', 'freeze',
  'cut', 'whole', 'isolate', 'standardized', 'standardised', 'organic', 'natural', 'pure',
  'concentrate', 'concentrated', 'liquid', 'gum', 'co2', 'virgin', 'refined', 'fine', 'bulk',
  'wholesale', 'premium', 'ground', 'raw', 'for', 'personal', 'care']);
const PART_WORDS = new Set(['root', 'roots', 'leaf', 'leaves', 'seed', 'seeds', 'bark', 'flower',
  'flowers', 'phool', 'phul', 'fruit', 'fruits', 'berry', 'rhizome', 'peel', 'pericarp', 'rind',
  'aerial', 'herb', 'wood', 'bud', 'buds', 'stem', 'tuber', 'husk', 'pod', 'pods', 'shell', 'resin',
  'gum', 'nut']);
const STRIP_WORDS = new Set([...PART_WORDS, ...FORM_WORDS, 'chaal', 'chhal', 'patta', 'patti',
  'phool', 'phul', 'beej', 'mool', 'chilka', 'dana', 'sabut', 'gutli', 'booti', 'buti', 'whole',
  'cut', 'big', 'small', 'kg', 'gm']);
// owner-adjudicated collision resolutions (FIX 2b) — stripped key -> the one identity it pins to
const COLLISION_RESOLUTIONS = { apple: 'malus-domestica', atish: 'aconitum-heterophyllum',
  basil: 'ocimum-basilicum', chitrak: 'plumbago-zeylanica', hibiscus: 'hibiscus-sabdariffa',
  lavender: 'lavandula-angustifolia', rasna: 'pluchea-lanceolata', tea: 'camellia-sinensis',
  valerian: 'valeriana-officinalis' };

function partStrip(name) {
  const s = name.replace(/\([^)]*\)/g, ' ');
  return s.split(/[^A-Za-z]+/).filter(t => t && !STRIP_WORDS.has(t.toLowerCase())).join(' ');
}
function cleanLabel(label) {
  const t = nb(label).replace(/\([^)]*\)/g, ' ');
  return t.split(/[^A-Za-z]+/)
    .filter(w => w && !FORM_WORDS.has(w.toLowerCase()) && !PART_WORDS.has(w.toLowerCase()))
    .join(' ').trim();
}

// ---------- identity index build (startup / warm cost) ----------
// accepted_name === authority_accepted_name in schema v2; the runtime-minimal backbone drops the
// redundant accepted_name alias, so authority_accepted_name is the rank-0 exact key.
function buildIndices(identities) {
  const exact = new Map();          // norm -> [rank, method, cid]
  const common = new Map();         // norm -> Set(cid)
  const METHODS = [['authority_accepted_name', 0, 'accepted_name_exact'],
    ['original_parsed_names', 1, 'original_parsed_name_exact'],
    ['scientific_synonyms', 2, 'scientific_synonym_exact'],
    ['trade_synonyms', 3, 'trade_synonym_exact']];
  for (const r of identities) {
    const cid = r.canonical_id;
    for (const [field, rank, method] of METHODS) {
      let vals = r[field]; if (vals == null) continue;
      if (typeof vals === 'string') vals = [vals];
      for (const v of vals) { const n = norm(v); if (n && (!exact.has(n) || rank < exact.get(n)[0])) exact.set(n, [rank, method, cid]); }
    }
    for (const c of (r.common_names || [])) { const n = norm(c); if (n) { if (!common.has(n)) common.set(n, new Set()); common.get(n).add(cid); } }
  }
  // derived part-stripped common keys (collision-guarded + owner resolutions)
  const derived = new Map();
  for (const r of identities) for (const c of (r.common_names || [])) {
    const k = norm(partStrip(c));
    if (k && k !== norm(c) && k.length >= 3) { if (!derived.has(k)) derived.set(k, new Set()); derived.get(k).add(r.canonical_id); }
  }
  let quarantined = 0, resolved = 0;
  for (const [k, cids] of derived) {
    const allc = new Set(cids); if (common.has(k)) for (const x of common.get(k)) allc.add(x);
    if (allc.size === 1) { if (!common.has(k)) common.set(k, new Set([[...allc][0]])); }
    else { const res = COLLISION_RESOLUTIONS[k]; if (res && allc.has(res)) { common.set(k, new Set([res])); resolved++; } else quarantined++; }
  }
  return { exact, common, quarantined, resolved };
}

// ---------- resolve (strictest-first, then unique common) ----------
function resolve(latin, label, exact, common) {
  const cands = []; if (latin) cands.push(latin);
  const core = cleanLabel(label);
  if (core) { const p = core.split(' '); if (p.length > 1) cands.push(core, p.slice(0, 2).join(' '), p[0]); else cands.push(core); }
  for (const c of cands) { const n = norm(c); if (exact.has(n)) { const [, method, cid] = exact.get(n); return { canonical_id: cid, match_method: method, matched: c }; } }
  const uids = new Set(); let amb = null;
  for (const c of cands) { const n = norm(c); if (common.has(n)) { const ids = common.get(n); if (ids.size === 1) uids.add([...ids][0]); else amb = { candidates: [...ids].sort() }; } }
  if (uids.size === 1) return { canonical_id: [...uids][0], match_method: 'common_name_exact_unique', matched: core };
  if (uids.size > 1 || amb) return { canonical_id: null, match_method: 'ambiguous', candidates: uids.size > 1 ? [...uids].sort() : amb.candidates };
  return { canonical_id: null, match_method: 'unresolved' };
}

// ---------- Product × Role ladder index ----------
function buildLadderIndex(HB_MX) {
  const idx = new Map();
  for (const fam of HB_MX.fam) for (const p of fam.products) for (const rid of Object.keys(p.roles)) {
    const r = p.roles[rid];
    idx.set(p.id + '|' + rid, { preferred: r.preferred_formats || [], conditional: r.conditional_formats || [],
      unsuitable: r.unsuitable_formats || [], fmt: r.fmt || {}, routing: r.routing, label: r.label });
  }
  return idx;
}
// per-identity observed base-format availability (from the storefront-safe form graph)
function buildFormsIndex(minGraph) {
  const forms = new Map();
  for (const cid of Object.keys(minGraph.identities)) {
    const set = new Set();
    const pp = minGraph.identities[cid].plant_parts || {};
    for (const part of Object.keys(pp)) for (const sig of Object.keys(pp[part].forms || {})) set.add(pp[part].forms[sig].base_format_code);
    forms.set(cid, set);
  }
  return forms;
}

// ---------- security controls (representative stubs — size, not real crypto) ----------
const ALLOWED_ROLES = null; // set at init from the matrix; null = accept any known key
function validateInput(body, ladderIndex) {
  if (!body || typeof body !== 'object') return 'bad_body';
  if (typeof body.product !== 'string' || typeof body.role !== 'string') return 'missing_product_role';
  if (typeof body.botanical !== 'string' || body.botanical.length > 80) return 'bad_botanical';
  if (!ladderIndex.has(body.product + '|' + body.role)) return 'unknown_product_role';
  return null; // one botanical term, known product+role, nothing else — strict allow-list
}
function verifyAppProxySignature(query, secret) {
  // Real impl: HMAC-SHA256 over sorted params, constant-time compare. Stub keeps the shape/size.
  const keys = Object.keys(query).filter(k => k !== 'signature').sort();
  let acc = 0; const s = keys.map(k => k + '=' + query[k]).join('') + String(secret || '');
  for (let i = 0; i < s.length; i++) acc = (acc * 31 + s.charCodeAt(i)) >>> 0;
  return typeof query.signature === 'string';
}
function checkTimestamp(ts, nowMs, windowMs) { const t = Number(ts) * 1000; return Number.isFinite(t) && Math.abs(nowMs - t) <= (windowMs || 60000); }
function rateLimit(state, key, nowMs, perMin) {
  let e = state.get(key); if (!e || nowMs - e.start >= 60000) { e = { start: nowMs, n: 0 }; state.set(key, e); }
  e.n++; return e.n <= (perMin || 10);
}

// ---------- Stage 1: specification ----------
function stage1(engine, term, productRoleKey) {
  const idn = resolve(null, term, engine.exact, engine.common);
  const ladder = engine.ladder.get(productRoleKey);
  const rec = idn.canonical_id ? engine.byId.get(idn.canonical_id) : null;
  const observed = idn.canonical_id ? (engine.forms.get(idn.canonical_id) || EMPTY) : EMPTY;
  let bestFit = null;
  const preferred = ladder ? ladder.preferred : [];
  for (const code of preferred) { const t = (ladder.fmt[code] || {}).tier; if (t === 'ok') { bestFit = code; break; } }
  const observedAvailable = preferred.filter(c => observed.has(c));
  return {
    api_schema_version: 1,
    identity: {
      status: idn.match_method,
      canonical_id: idn.canonical_id,
      display_name: rec ? rec.canonical_display_name : null,
      authority_name: rec ? rec.authority_accepted_name : null,
      candidates: idn.candidates || null,
    },
    role: ladder ? ladder.label : null,
    routing: ladder ? ladder.routing : null,
    format_ladder: { best_fit: bestFit, preferred, conditional: ladder ? ladder.conditional : [], unsuitable: ladder ? ladder.unsuitable : [] },
    observed_available: observedAvailable,
    version: engine.version,
  };
}

// ---------- Stage 2: procurement match ----------
// NOTE: Herbuno stock is off-repo; engine.stock is a proxy (canonical_id -> available formats)
// built from the observed-form graph for CPU measurement only.
function stage2(engine, canonicalId, targetFormat) {
  const avail = engine.stock.get(canonicalId) || EMPTY;
  let cls;
  if (avail.has(targetFormat)) cls = 'exact_match';
  else if (avail.size > 0) cls = 'compatible_alternative';
  else cls = 'ask_us_to_source';
  return { canonical_id: canonicalId, target_format: targetFormat, match_class: cls, available_formats: [...avail], version: engine.version };
}

const EMPTY = new Set();

// ---------- engine assembly (startup) ----------
function makeEngine(minBackbone, minGraph, HB_MX) {
  const { exact, common, quarantined, resolved } = buildIndices(minBackbone.identities);
  const byId = new Map(minBackbone.identities.map(r => [r.canonical_id, r]));
  const ladder = buildLadderIndex(HB_MX);
  const forms = buildFormsIndex(minGraph);
  const stock = forms; // proxy for Herbuno stock (see stage2 note)
  const version = {
    api_schema_version: 1,
    matrix_version: HB_MX.schema_version,
    identity_version: minBackbone.identity_version,
    observed_form_graph_version: minGraph.observed_form_graph_version,
  };
  return { exact, common, byId, ladder, forms, stock, version, stats: { quarantined, resolved, records: byId.size } };
}

module.exports = { nb, norm, buildIndices, resolve, buildLadderIndex, buildFormsIndex, makeEngine,
  stage1, stage2, validateInput, verifyAppProxySignature, checkTimestamp, rateLimit };
