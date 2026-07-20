// Resolution + Product×Role intersection + specification build.
// Ported from the Step-1 benchmark stub (which mirrors knowledge/pass3/build_pass3.build_indices and
// knowledge/sources/common.resolve). Indices are built ONCE per isolate by makeEngine() — the hot
// requirement from ADR-014 Step 1. No runtime I/O.

// PRESENTATION-ONLY display-name overrides (ADR-014 Step 3), bundled at build time (not KV). Keyed by
// canonical_id; overrides ONLY the label shown on the card — never resolution/matching/identity truth.
import DISPLAY_OVERRIDES_FILE from './display_overrides.js';
const DISPLAY_OVERRIDES = (DISPLAY_OVERRIDES_FILE && DISPLAY_OVERRIDES_FILE.overrides) || {};

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
export const COLLISION_RESOLUTIONS = { apple: 'malus-domestica', atish: 'aconitum-heterophyllum',
  basil: 'ocimum-basilicum', chitrak: 'plumbago-zeylanica', hibiscus: 'hibiscus-sabdariffa',
  lavender: 'lavandula-angustifolia', rasna: 'pluchea-lanceolata', tea: 'camellia-sinensis',
  valerian: 'valeriana-officinalis' };

export function partStrip(name) {
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
// Candidates in DESCENDING specificity: the FULL name first (norm preserves hyphens, so hyphenated
// epithets like "Arctostaphylos uva-ursi" resolve to themselves — Pass 6A #1), then progressively
// part/format-stripped forms. Each candidate is checked exact-then-common and the FIRST hit wins, so a
// specific multi-word name never strips past a token that changes the species — e.g. "Tea Seed Oil"
// resolves to its own record before it could reduce to the owner-pinned bare "tea" (Pass 6A #2).
export function resolve(latin, label, exact, common) {
  const cands = [];
  if (latin) cands.push(latin);
  if (label != null && String(label).trim()) cands.push(String(label)); // full, unstripped name first
  const core = cleanLabel(label);
  if (core) { const p = core.split(' '); if (p.length > 1) cands.push(core, p.slice(0, 2).join(' '), p[0]); else cands.push(core); }
  for (const c of cands) {
    const n = norm(c); if (!n) continue;
    if (exact.has(n)) { const [, method, cid] = exact.get(n); return { canonical_id: cid, match_method: method, matched: c }; }
    if (common.has(n)) {
      const ids = common.get(n);
      if (ids.size === 1) return { canonical_id: [...ids][0], match_method: 'common_name_exact_unique', matched: c };
      return { canonical_id: null, match_method: 'ambiguous', candidates: [...ids].sort() }; // a genuinely ambiguous specific name
    }
  }
  return { canonical_id: null, match_method: 'unresolved' };
}

// public status vocabulary (ADR-014): resolved / ambiguous / unrecognised
export function statusOf(idn) {
  if (idn.canonical_id) return 'resolved';
  if (idn.match_method === 'ambiguous') return 'ambiguous';
  return 'unrecognised';
}

// Heuristic: cleanest common name = the most frequent part/form-stripped base among common_names
// (e.g. "Pomegranate" out of "Pomegranate Peel", "Anar Beej", "Pomegranate Seed Oil"). null if none usable.
function heuristicCommon(rec) {
  const commons = (rec && rec.common_names) || [];
  if (!commons.length) return null;
  const counts = new Map(), sample = new Map();
  for (const c of commons) {
    const base = nb(partStrip(c));
    if (!base || base.length < 3) continue;
    const k = norm(base);
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!sample.has(k)) sample.set(k, base);
  }
  if (!counts.size) return null;
  let bestK = null, bestN = -1;
  for (const [k, n] of counts) if (n > bestN || (n === bestN && bestK && sample.get(k).length < sample.get(bestK).length)) { bestK = k; bestN = n; }
  const exact = commons.find(c => norm(c) === bestK); // prefer an actual common_name (nicer casing)
  return exact || sample.get(bestK) || null;
}
// Display name for the identity card (ADR-014 Step 3 fix). The backbone's canonical_display_name is the
// Latin accepted name for ~99% of records. Resolution order (owner-ruled): 1) presentation override,
// 2) common-name heuristic, 3) canonical_display_name fallback. PRESENTATION only — long-term the display
// name belongs in the identity backbone (ADR-013).
export function displayName(rec) {
  if (!rec) return null;
  if (rec.canonical_id && DISPLAY_OVERRIDES[rec.canonical_id]) return DISPLAY_OVERRIDES[rec.canonical_id]; // 1
  return heuristicCommon(rec) || rec.canonical_display_name || rec.authority_accepted_name || null;         // 2, 3
}

function buildLadderIndex(matrixData) {
  const idx = new Map();
  for (const fam of matrixData.fam) for (const p of fam.products) for (const rid of Object.keys(p.roles)) {
    const r = p.roles[rid];
    // product physics-class (tag/tag_label) is retained so reasoning_checks can be derived from physics
    // (ADR-014 Step 3). Decision content (tiers/notes) is unchanged and never leaves the Worker.
    idx.set(p.id + '|' + rid, { preferred: r.preferred_formats || [], conditional: r.conditional_formats || [],
      unsuitable: r.unsuitable_formats || [], fmt: r.fmt || {}, routing: r.routing, label: r.label, rec: r.rec || null,
      tag: p.tag, tag_label: p.tag_label, phase: p.phase || 'application-dependent' });
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

// ---- specification (Stage 1), MINIMAL (ADR-014 Step-2a BLOCKER 1) ----
// Internally the engine sees the whole ladder; the RESPONSE must expose only the single selected
// format + a status + one caveat. selected = best-fit (first preferred with tier 'ok'), else the top
// conditional where no 'ok' exists. The ladder arrays, observed_available and canonical IDs never leave.
const AMBIGUOUS_MESSAGE = 'Multiple botanical identities match this name. Please provide the Latin name or source species.';

export function selectSpecification(ladder) {
  if (!ladder) return { selected_format: null, technical_status: null, best_fit: null, role: null, tier: null };
  let best = null;
  for (const c of ladder.preferred) { if ((ladder.fmt[c] || {}).tier === 'ok') { best = c; break; } }
  let selected = best, tier = 'ok';
  if (!selected) { selected = (ladder.conditional && ladder.conditional[0]) || null; tier = selected ? ((ladder.fmt[selected] || {}).tier || 'warn') : null; }
  const technical_status = selected == null ? 'No suitable commercial format'
    : tier === 'ok' ? 'Best physical fit' : 'Conditional — confirm suitability at SKU level';
  return { selected_format: selected, technical_status, best_fit: best, role: ladder.label || null, tier };
}

// ONE caveat only. For a selected format, the single first sentence of that cell's note (a caveat is
// explicitly permitted by BLOCKER 1); otherwise a controlled fallback. Never the full note.
function firstSentence(note) {
  if (!note) return '';
  const first = String(note).split(/\.\s/)[0].trim();
  return first ? (first.endsWith('.') ? first : first + '.') : '';
}
export function oneCaveat(status, sel, ladder) {
  if (status === 'ambiguous') return AMBIGUOUS_MESSAGE;
  if (status === 'unrecognised') return 'No botanical identity matched this term in the current knowledge snapshot.';
  if (!sel.selected_format) return `No commercial format is rated suitable for ${sel.role || 'this role'} — contact Herbuno for review.`;
  const s = firstSentence(ladder && (ladder.fmt[sel.selected_format] || {}).note);
  if (s) return s;
  return `Confirm SKU-level suitability of the ${sel.selected_format} grade with the supplier.`;
}

// ---- reasoning_checks (Stage 1, ADR-014 Step 3) ----
// Three query-specific CONCLUSIONS derived from PHYSICS ONLY. TWO orthogonal axes (owner ruling):
//   * PHASE  = the product's physical phase, from the AUTHORED 6-class map (ladder.phase). Drives `phase`
//              and `process`. NEVER inferred from `tag`.
//   * DISSOLUTION = the product's dissolution requirement, from `tag` (NND/MD/DISP). Drives `dissolution`.
//                   MD means the active must dissolve in WHATEVER phase the product IS.
// Constraints: state the conclusion for THIS query, never the rule; no ladder text, no rejected
// alternatives, no supplier/graph evidence; process derives ONLY from product phase + format behaviour and
// NEVER infers heat/pH/sensory/grit/stability/bioavailability/manufacturing not encoded by the matrix;
// where the subtype is genuinely variable (application-dependent) return the SKU fallback. For
// ambiguous/unrecognised the physics is identical (product×role-based) — reasoning_basis marks that.
const PROCESS_VARIABLE = 'Confirm process compatibility for the specific formulation and SKU.';
const PROCESS_SKU = 'Confirm process compatibility for the specific SKU.';
// The PHASE check IDENTIFIES the relevant phase ONLY (owner ruling) — never a behaviour verb (dissolves /
// miscible / partitions), which is only established at SKU level. Aligned form -> "compatible with
// incorporation into <phase>"; cross-phase -> "a separate phase from <phase>".
const PHASE_LABEL = { 'dry-solid': 'dry-solid matrix', aqueous: 'aqueous phase', oil: 'oil phase', 'suspension-dispersion': 'aqueous suspension' };
const DISS_NOUN = { aqueous: 'aqueous phase', oil: 'oil phase', emulsion: 'continuous phase', 'suspension-dispersion': 'aqueous phase' };

// PHYSICAL form of the selected format for the PHASE axis — its physical STATE as added (dry solid /
// water liquid / oil liquid / phase-matched), NOT its solubility. A spray-dried or full-spectrum powder is
// physically DRY even when water-SOLUBLE — solubility is the orthogonal DISSOLUTION axis (from `tag`), not
// a phase. So dry-solid is detected FIRST and wins over any soluble/dispersible qualifier.
function formPhysical(behaviour) {
  const b = String(behaviour || '').toLowerCase();
  if (b.includes('unresolved') || b.includes('per row text')) return null; // genuinely ambiguous => SKU fallback
  if (b.includes('dry-solid') || b.includes('coarse') || b.includes('whole') || b.includes('dried')) return 'dry';
  if (b.includes('dual') || b.includes('matched')) return 'matched';
  if (b.includes('oil')) return 'oil';       // an oil LIQUID (oil-soluble / oil / liquid)
  if (b.includes('water-soluble') || b.includes('dispersible')) return 'water'; // a water LIQUID (not a dry powder)
  return null;
}
function phaseCheck(phase, form) {
  if (phase === 'application-dependent') return 'The product’s phase varies by formulation — confirm phase compatibility for the specific formulation and SKU.';
  if (!form) return 'Confirm phase compatibility for the specific SKU.';
  if (phase === 'emulsion') {
    if (form === 'oil') return 'This form is intended for incorporation into the emulsion’s oil phase.';
    if (form === 'water') return 'This form is intended for incorporation into the emulsion’s water phase.';
    if (form === 'matched') return 'A phase-matched extract is intended for incorporation into the emulsion.';
    return 'This dry form is intended for incorporation into the emulsion.';
  }
  const label = PHASE_LABEL[phase];
  if (form === 'matched') return 'A phase-matched extract is compatible with incorporation into the product’s ' + label + '.';
  const aligned = (phase === 'dry-solid' && form === 'dry') ||
    ((phase === 'aqueous' || phase === 'suspension-dispersion') && (form === 'water' || (phase === 'suspension-dispersion' && form === 'dry'))) ||
    (phase === 'oil' && form === 'oil');
  if (aligned) return 'This form is compatible with incorporation into the product’s ' + label + '.';
  return 'This ' + (form === 'oil' ? 'oil-based' : form === 'water' ? 'water-based' : 'dry') + ' form is a separate phase from the product’s ' + label + '.';
}
function dissolutionCheck(tag, phase) {
  if (tag === 'NND') return 'Dissolution is not required for this role.';
  if (tag === 'DISP') return 'This role requires dispersion, not full dissolution.';
  if (tag === 'MD') {
    if (phase === 'application-dependent') return 'This role requires dissolution in the product’s phase; confirm it for the specific SKU.';
    if (phase === 'dry-solid') return 'This role requires the form to dissolve on use; confirm it for the specific SKU.';
    return 'This role requires dissolution in the product’s ' + (DISS_NOUN[phase] || 'phase') + '; confirm it for the specific SKU.';
  }
  return 'Confirm the dissolution requirement for this product at SKU level.';
}
function processCheck(phase, form) {
  if (phase === 'application-dependent' || !form) return PROCESS_VARIABLE;
  let cross = false;
  if (phase === 'dry-solid') cross = (form === 'oil' || form === 'water');
  else if (phase === 'oil') cross = (form === 'water');
  else if (phase === 'aqueous' || phase === 'suspension-dispersion') cross = (form === 'oil');
  // emulsion accommodates both phases => never a cross-phase process step
  if (!cross) return PROCESS_SKU;
  if (phase === 'dry-solid') return 'This form adds a liquid phase to a dry-solid process step — confirm a suitable grade for the SKU.';
  if (phase === 'oil') return 'This water-based form is a separate phase from the oil process — confirm incorporation for the SKU.';
  return 'This oil-based form is a separate phase from the aqueous process — confirm incorporation for the SKU.';
}
export function reasoningChecks(ladder, selectedFormat) {
  const phase = ladder ? ladder.phase : 'application-dependent';
  const tag = ladder ? ladder.tag : null;
  const beh = ladder && selectedFormat ? (ladder.fmt[selectedFormat] || {}).behaviour : null;
  const form = formPhysical(beh);
  return { phase: phaseCheck(phase, form), dissolution: dissolutionCheck(tag, phase), process: processCheck(phase, form) };
}

// ---- candidate_assessment (Stage 1, ADR-014 Step 3) ----
// Answers ONE asked question — "is my proposed format right?" — without exposing the ladder. SE is LOCKED:
// an assay overlay, never assessed as a base physical format. Independent of identity (role physics), so
// it runs for ambiguous/unrecognised too (labelled role-based via reasoning_basis).
const SE_LOCKED_ASSESSMENT = {
  format: 'SE', technical_status: 'Application review needed',
  explanation: 'Standardisation describes assay, not physical format. Specify whether the extract is water-soluble, oil-soluble, powdered, liquid, or another base form.',
};
export function assessCandidate(ladder, code) {
  if (code === 'SE') return { ...SE_LOCKED_ASSESSMENT };
  const e = ladder && ladder.fmt ? ladder.fmt[code] : null;
  if (!e) return { format: code, technical_status: 'Not evaluated for this role', explanation: 'This format is not evaluated for this product and role — confirm suitability with Herbuno.' };
  const status = e.tier === 'ok' ? 'Best physical fit' : e.tier === 'warn' ? 'Conditional fit — confirm at SKU level' : 'Not suitable for this role';
  const explanation = firstSentence(e.note) ||
    (e.tier === 'ok' ? 'A physically appropriate form for this role; confirm SKU-level suitability.'
      : e.tier === 'warn' ? 'Usable with a compromise for this role; confirm suitability at SKU level.'
      : 'This format is not physically suited to this role.');
  return { format: code, technical_status: status, explanation };
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
