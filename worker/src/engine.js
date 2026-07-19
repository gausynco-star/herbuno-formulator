// Resolution + Product×Role intersection + specification build.
// Ported from the Step-1 benchmark stub (which mirrors knowledge/pass3/build_pass3.build_indices and
// knowledge/sources/common.resolve). Indices are built ONCE per isolate by makeEngine() — the hot
// requirement from ADR-014 Step 1. Nothing here does I/O.

const enc = new Set(); // placeholder to keep shape parity; unused
const EMPTY = new Set();

function nb(s) { return String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
export function norm(s) {
  s = (s == null ? '' : String(s)).toLowerCase().replace(/×/g, 'x').trim();
  s = s.replace(/[^a-z0-9\- ]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

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

// accepted_name === authority_accepted_name (schema v2); the runtime-minimal index drops the alias.
export function buildIndices(identities) {
  const exact = new Map();
  const common = new Map();
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

// strictest-first exact, then UNIQUE common only (multiple candidates => ambiguous, never pick one)
export function resolve(latin, label, exact, common) {
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

// public status vocabulary (ADR-014): resolved / ambiguous / unrecognised
export function statusOf(idn) {
  if (idn.canonical_id) return 'resolved';
  if (idn.match_method === 'ambiguous') return 'ambiguous';
  return 'unrecognised';
}

function buildLadderIndex(matrixData) {
  const idx = new Map();
  for (const fam of matrixData.fam) for (const p of fam.products) for (const rid of Object.keys(p.roles)) {
    const r = p.roles[rid];
    idx.set(p.id + '|' + rid, { preferred: r.preferred_formats || [], conditional: r.conditional_formats || [],
      unsuitable: r.unsuitable_formats || [], fmt: r.fmt || {}, routing: r.routing, label: r.label });
  }
  return idx;
}
function buildFormsIndex(formGraph) {
  const forms = new Map();
  for (const cid of Object.keys(formGraph.identities)) {
    const set = new Set();
    const pp = formGraph.identities[cid].plant_parts || {};
    for (const part of Object.keys(pp)) for (const sig of Object.keys(pp[part].forms || {})) set.add(pp[part].forms[sig].base_format_code);
    forms.set(cid, set);
  }
  return forms;
}

// ---- specification (Stage 1) ----
export function buildSpec(engine, idn, ladder) {
  const observed = idn.canonical_id ? (engine.forms.get(idn.canonical_id) || EMPTY) : EMPTY;
  let bestFit = null;
  const preferred = ladder ? ladder.preferred : [];
  for (const code of preferred) { if ((ladder.fmt[code] || {}).tier === 'ok') { bestFit = code; break; } }
  return {
    role: ladder ? ladder.label : null,
    routing: ladder ? ladder.routing : null,
    format_ladder: { best_fit: bestFit, preferred, conditional: ladder ? ladder.conditional : [], unsuitable: ladder ? ladder.unsuitable : [] },
    best_fit_note: (bestFit && ladder) ? ((ladder.fmt[bestFit] || {}).note || null) : null,
    observed_available: preferred.filter(c => observed.has(c)),
  };
}

export function explain(status, rec, spec, ladder) {
  if (status === 'ambiguous') return 'Common name resolves to more than one botanical identity; a source/species is required before a specification can be issued.';
  if (status === 'unrecognised') return 'No botanical identity matched this term in the current knowledge snapshot.';
  const name = rec ? (rec.canonical_display_name || rec.authority_accepted_name) : null;
  const auth = rec ? rec.authority_accepted_name : null;
  const bf = spec.format_ladder.best_fit;
  const role = spec.role || 'this role';
  if (!bf) return `${name} resolved${auth && auth !== name ? ` (authority: ${auth})` : ''}; no preferred commercial format is rated suitable for ${role} — see the ladder.`;
  return `${name} resolved${auth && auth !== name ? ` (authority: ${auth})` : ''}. For ${role}, the best-fit commercial format is ${bf}.`;
}

// ---- procurement (Stage 2) ----
// NOTE: Herbuno stock is off-repo; engine.stock is a proxy (canonical_id -> observed formats) built
// from the storefront-safe form graph. Real catalogue product handles are wired in Step 3.
export function procurementMatch(engine, canonicalId, targetFormat) {
  const avail = engine.stock.get(canonicalId) || EMPTY;
  let cls;
  if (avail.has(targetFormat)) cls = 'exact_match';
  else if (avail.size > 0) cls = 'compatible_alternative';
  else cls = 'ask_us_to_source';
  const route = cls === 'exact_match' ? 'catalogue'
    : cls === 'compatible_alternative' ? 'catalogue_alternative' : 'request_sourcing';
  return { match_class: cls, sourcing_route: route, available_formats: [...avail] };
}

// ---- engine assembly (ONCE per isolate) ----
export function makeEngine(identityIndex, formGraph, matrixBundle) {
  const identities = identityIndex.identities;
  const { exact, common, quarantined, resolved } = buildIndices(identities);
  const byId = new Map(identities.map(r => [r.canonical_id, r]));
  const ladder = buildLadderIndex(matrixBundle.data);
  const forms = buildFormsIndex(formGraph);
  return {
    exact, common, byId, ladder, forms, stock: forms,
    stats: { records: byId.size, resolved, quarantined },
  };
}
