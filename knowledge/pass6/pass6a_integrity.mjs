// ADR-013 Pass 6A — backbone MECHANICAL INTEGRITY audit (Gate 1). DETERMINISTIC, EVIDENCE-ONLY.
//
// Proves the frozen identity backbone is INTERNALLY CONSISTENT. It does NOT judge commercial correctness
// (that is 6B/6C): a backbone can be perfectly consistent here and still map "bergamot" to lemon, or bare
// "orange" to bitter orange. This script makes NO edits — it only reads artifacts and writes reports. It is
// a PERMANENT regression suite: every future identity_version must re-run it (and later 6D/6E) before release.
//
// Run: node knowledge/pass6/pass6a_integrity.mjs
// Writes: knowledge/pass6/pass6a_integrity.md  +  knowledge/pass6/pass6a_integrity.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, buildIndices, resolve, statusOf } from '../../worker/src/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const readJson = (rel) => JSON.parse(fs.readFileSync(P(rel), 'utf8'));

const backbone = readJson('knowledge/identity/botanical_identity.json');
const excludedDoc = readJson('knowledge/identity/excluded.json');
const quarantine = readJson('knowledge/identity/common_index_quarantine.json');
const pass1 = readJson('knowledge/pass1/botanical_candidates.json');

const RECS = backbone.identities;
const META = backbone._meta;
const IDV = META.identity_version;

// ---- shared helpers ----
const NBSP = { test: (x) => typeof x === 'string' && [...x].some(ch => { const c = ch.charCodeAt(0); return c===0xA0||c===0x202F||c===0xFEFF||c===0x2007||(c>=0x2000&&c<=0x200A); }) }; // non-ordinary whitespace
const ASCII_ONLY = (s) => /^[\x00-\x7F]*$/.test(s);
const AUTHOR_ABBR = /(\([A-Z][a-zà-ÿ'.-]*\.?\)|\b[A-Z][a-z]*\.(?:\s|$))/; // "(L.)" / "Mill." author citations
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const isAmbiguousStatus = (r) => /_ambiguous$/.test(r.resolution_status || ''); // trade_ambiguous / species_ambiguous
const hyphenEpithet = (name) => isStr(name) && /\S-\S/.test(name.split(' ').slice(1).join(' '));
function nameWellFormed(name) {
  if (!isStr(name)) return false;
  const toks = name.trim().split(/\s+/);
  if (!/^[A-Z][a-zA-Z-]+$/.test(toks[0])) return false;                 // genus: capitalised
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t === '×' || t === 'x') continue;
    if (!/^×?[a-z][a-zà-ÿ-]*$/.test(t)) return false;                    // epithet: lowercase (× may prefix)
  }
  return true;
}
const trArr = (arr, n = 25) => ({ total: arr.length, shown: arr.slice(0, n), truncated: arr.length > n });
const S = {};

// ===================== SECTION 1 — TAXONOMY MECHANICS =====================
(function section1() {
  const a = { malformed_accepted_name: [], accepted_vs_authority_mismatch: [], rank_field_inconsistency: [],
    malformed_synonym: [], converged_accepted_name_duplicates: [], duplicate_canonical_id: [], missing_genus_species: [] };
  const RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM', 'GENUS', 'HYBRID', 'SUBVARIETY']);
  const byAccepted = new Map(), byId = new Map();
  for (const r of RECS) {
    const amb = isAmbiguousStatus(r);           // *_ambiguous records legitimately carry no single accepted name
    const genusRank = r.accepted_rank === 'GENUS';
    // 1a accepted name well-formed
    if (amb) { if (r.accepted_name != null) a.malformed_accepted_name.push({ id: r.canonical_id, note: r.resolution_status + ' should have null accepted_name', accepted_name: r.accepted_name }); }
    else if (!nameWellFormed(r.accepted_name)) a.malformed_accepted_name.push({ id: r.canonical_id, accepted_name: r.accepted_name });
    // 1b accepted_name === authority_accepted_name (schema v2)
    if ((r.accepted_name ?? null) !== (r.authority_accepted_name ?? null)) a.accepted_vs_authority_mismatch.push({ id: r.canonical_id, accepted_name: r.accepted_name, authority_accepted_name: r.authority_accepted_name });
    // 1c rank / genus / species / infra mutual consistency
    if (!amb) {
      if (r.accepted_rank && !RANKS.has(r.accepted_rank)) a.rank_field_inconsistency.push({ id: r.canonical_id, issue: 'unknown accepted_rank', accepted_rank: r.accepted_rank });
      const toks = isStr(r.accepted_name) ? r.accepted_name.replace(/\s×\s?/g, ' ').replace(/^×/, '').trim().split(/\s+/) : [];
      if (r.genus && toks[0] && r.genus !== toks[0].replace(/^×/, '')) a.rank_field_inconsistency.push({ id: r.canonical_id, issue: 'genus != accepted_name genus token', genus: r.genus, accepted_name: r.accepted_name });
      if (r.accepted_rank === 'SPECIES' && r.infraspecific_epithet) a.rank_field_inconsistency.push({ id: r.canonical_id, issue: 'SPECIES rank but infraspecific_epithet set', infraspecific_epithet: r.infraspecific_epithet });
      if (['SUBSPECIES', 'VARIETY', 'FORM'].includes(r.accepted_rank) && !r.infraspecific_epithet) a.rank_field_inconsistency.push({ id: r.canonical_id, issue: r.accepted_rank + ' rank but no infraspecific_epithet', accepted_name: r.accepted_name });
      if (!genusRank && (!isStr(r.genus) || !isStr(r.species))) a.missing_genus_species.push({ id: r.canonical_id, genus: r.genus, species: r.species, rank: r.accepted_rank }); // GENUS-rank legitimately has no species
    }
    // 1d synonyms well-formed
    for (const syn of (r.scientific_synonyms || [])) if (!nameWellFormed(syn)) a.malformed_synonym.push({ id: r.canonical_id, synonym: syn });
    // 1e converged accepted-name duplicates
    if (isStr(r.authority_accepted_name)) { const k = r.authority_accepted_name; if (!byAccepted.has(k)) byAccepted.set(k, []); byAccepted.get(k).push(r.canonical_id); }
    // 1f canonical_id collision
    if (byId.has(r.canonical_id)) a.duplicate_canonical_id.push({ id: r.canonical_id });
    byId.set(r.canonical_id, true);
  }
  for (const [name, ids] of byAccepted) if (ids.length > 1) a.converged_accepted_name_duplicates.push({ accepted_name: name, canonical_ids: ids });
  S.s1 = { title: 'Taxonomy mechanics', counts: cnt(a), detail: det(a) };
})();

// ===================== SECTION 2 — PROVENANCE INTEGRITY =====================
(function section2() {
  // FIRST: establish granularity. Names live in flat arrays with no per-name source field; provenance is a
  // single per-RECORD object => record-level only.
  const sampleProv = (RECS.find(r => r.provenance) || {}).provenance || {};
  const perName = RECS.some(r => Array.isArray(r.common_names) && r.common_names.some(c => c && typeof c === 'object'));
  const granularity = perName ? 'per-name' : 'record-level only (names are flat strings; provenance is one object per record — carried by the whole record, not per name)';

  const a = { records_without_provenance: [], records_untraceable_to_source: [], enriched_by_not_array: [], accepted_outside_gbif_missing_stamp: [] };
  let nameAssignments = 0, outsideGbif = 0;
  for (const r of RECS) {
    nameAssignments += (r.common_names || []).length + (r.original_parsed_names || []).length + (r.scientific_synonyms || []).length + (r.trade_synonyms || []).length;
    const pv = r.provenance;
    if (!pv || typeof pv !== 'object') { a.records_without_provenance.push(r.canonical_id); continue; }
    if ('enriched_by' in pv && !Array.isArray(pv.enriched_by)) a.enriched_by_not_array.push({ id: r.canonical_id, enriched_by: pv.enriched_by });
    const traceable = isStr(pv.authority) || isStr(pv.resolved_by) || (Array.isArray(pv.enriched_by) && pv.enriched_by.length > 0);
    if (!traceable) a.records_untraceable_to_source.push(r.canonical_id);
    // accepted_outside_gbif_candidates records must carry an owner/decision marker AND a date stamp
    if (pv.accepted_outside_gbif_candidates === true) {
      outsideGbif++;
      const hasDate = isStr(pv.query_date) || isStr(pv.review_date) || (pv.gbif_recheck && isStr(pv.gbif_recheck.query_date));
      const hasOwnerMarker = pv.owner_common_mapping === true || isStr(pv.review_date) || (isStr(pv.resolved_by) && !/^gbif$/i.test(pv.resolved_by)) || !!pv.gbif_recheck || pv.owner_resolved === true;
      if (!(hasDate && hasOwnerMarker)) a.accepted_outside_gbif_missing_stamp.push({ id: r.canonical_id, provenance: pv });
    }
  }
  S.s2 = {
    title: 'Provenance integrity',
    provenance_granularity: granularity,
    provenance_record_keys: Object.keys(sampleProv),
    name_assignment_classification: { total_name_assignments: nameAssignments, per_name_provenance: 0, record_level: nameAssignments, unknown: 0 },
    accepted_outside_gbif_candidates_records: outsideGbif,
    counts: cnt(a), detail: det(a),
  };
})();

// ===================== SECTION 3 — NORMALISATION =====================
(function section3() {
  const idx = { accepted: new Map(), synonym: new Map(), common: new Map() };
  const feat = { non_breaking_space: [], author_abbreviation: [], leading_trailing_or_double_space: [], non_ascii_present: [], hybrid_multiplication_sign: [] };
  const add = (type, name, cid) => { const n = norm(name); if (!n) return; if (!idx[type].has(n)) idx[type].set(n, new Set()); idx[type].get(n).add(cid); };
  const scan = (name, cid, where) => {
    if (typeof name !== 'string') return;
    if (NBSP.test(name)) feat.non_breaking_space.push({ id: cid, where, name });
    if (/^\s|\s$|\s\s/.test(name)) feat.leading_trailing_or_double_space.push({ id: cid, where, name });
    if ((where === 'accepted' || where === 'synonym') && AUTHOR_ABBR.test(name)) feat.author_abbreviation.push({ id: cid, where, name });
    if (!ASCII_ONLY(name.replace(/×/g, ''))) feat.non_ascii_present.push({ id: cid, where, name });     // FEATURE, reviewed for consistency
    if (name.includes('×')) feat.hybrid_multiplication_sign.push({ id: cid, where, name });               // FEATURE, reviewed for consistency
  };
  for (const r of RECS) {
    if (isStr(r.authority_accepted_name)) { add('accepted', r.authority_accepted_name, r.canonical_id); scan(r.authority_accepted_name, r.canonical_id, 'accepted'); }
    for (const s of (r.scientific_synonyms || [])) { add('synonym', s, r.canonical_id); scan(s, r.canonical_id, 'synonym'); }
    for (const s of (r.trade_synonyms || [])) { scan(s, r.canonical_id, 'trade'); }
    for (const c of (r.common_names || [])) { add('common', c, r.canonical_id); scan(c, r.canonical_id, 'common'); }
  }
  const coll = (map) => { const out = []; for (const [k, set] of map) if (set.size > 1) out.push({ normalized: k, canonical_ids: [...set] }); return out; };
  const acceptedColl = coll(idx.accepted), synColl = coll(idx.synonym), commonColl = coll(idx.common);
  // MECHANICAL ANOMALIES: resolver-key collisions on accepted/synonym, and true whitespace/author defects.
  const mech = { accepted_name_normalised_collisions: acceptedColl, synonym_normalised_collisions: synColl,
    non_breaking_space: feat.non_breaking_space, leading_trailing_or_double_space: feat.leading_trailing_or_double_space, author_abbreviation_in_accepted_or_synonym: feat.author_abbreviation };
  S.s3 = {
    title: 'Normalisation',
    mechanical_anomaly_counts: cnt(mech),
    expected_or_feature_counts: {
      common_name_normalised_collisions_EXPECTED: commonColl.length,   // resolver returns ambiguous — by design
      non_ascii_names_present: feat.non_ascii_present.length,          // accents / ≥ assay markers / transliteration — consistently kept
      hybrid_multiplication_sign_present: feat.hybrid_multiplication_sign.length,
    },
    detail: { ...det(mech), common_name_normalised_collisions_EXPECTED: trArr(commonColl), non_ascii_names_present: trArr(feat.non_ascii_present), hybrid_multiplication_sign_present: trArr(feat.hybrid_multiplication_sign) },
  };
})();

// ===================== SECTION 4 — RESOLVER MECHANICS (behaviour, not correctness) =====================
(function section4() {
  const { exact, common } = buildIndices(RECS);
  const probes = [];
  const rec = (path, expect, ok, got) => probes.push({ path, expect, ok, got });

  // 4a accepted-name exact — EVERY record. A record's own accepted name MUST resolve to it.
  const aBad = [];
  for (const r of RECS) { if (!isStr(r.authority_accepted_name)) continue; const res = resolve(null, r.authority_accepted_name, exact, common);
    if (res.canonical_id !== r.canonical_id) aBad.push({ id: r.canonical_id, name: r.authority_accepted_name, got: statusOf(res) + (res.canonical_id ? ':' + res.canonical_id : ''), hyphen_epithet: hyphenEpithet(r.authority_accepted_name) }); }
  const aBadHyphen = aBad.filter(x => x.hyphen_epithet).length;
  rec('accepted_name_exact', 'each accepted name resolves to its own record', aBad.length === 0, `${RECS.length - aBad.length} ok / ${aBad.length} fail (${aBadHyphen} of them hyphenated-epithet)`);

  // 4b scientific-synonym exact
  const sBad = [];
  for (const r of RECS) for (const syn of (r.scientific_synonyms || [])) { const res = resolve(null, syn, exact, common);
    if (res.canonical_id !== r.canonical_id && res.match_method !== 'ambiguous') sBad.push({ id: r.canonical_id, synonym: syn, got: statusOf(res) + (res.canonical_id ? ':' + res.canonical_id : ''), hyphen_epithet: hyphenEpithet(syn) }); }
  rec('scientific_synonym_exact', 'each synonym resolves to its record (or ambiguous)', sBad.length === 0, `${sBad.length} not resolving to own record (${sBad.filter(x => x.hyphen_epithet).length} hyphenated)`);

  // 4c common exact-unique — the resolver must never pick a DIFFERENT single record for a unique common
  const commonToIds = new Map();
  for (const r of RECS) for (const c of (r.common_names || [])) { const n = norm(c); if (!n) continue; if (!commonToIds.has(n)) commonToIds.set(n, new Set()); commonToIds.get(n).add(r.canonical_id); }
  let uniqueTotal = 0, uniqueRoundTrip = 0; const uniqueWrongPick = [];
  for (const [n, ids] of commonToIds) { if (ids.size !== 1) continue; uniqueTotal++; const only = [...ids][0]; const res = resolve(null, n, exact, common);
    if (res.canonical_id === only) uniqueRoundTrip++;
    else if (statusOf(res) === 'resolved' && res.canonical_id !== only) uniqueWrongPick.push({ common: n, expected: only, got: res.canonical_id }); } // ambiguous/unrecognised = part-strip/quarantine (expected), NOT a wrong pick
  rec('common_name_exact_unique', 'a unique common never resolves to a DIFFERENT record', uniqueWrongPick.length === 0, `${uniqueWrongPick.length} wrong picks (${uniqueRoundTrip}/${uniqueTotal} round-trip; rest → ambiguous/unrecognised by part-strip/quarantine design)`);

  // 4d ambiguous → never silently picks a species OUTSIDE the candidate set
  const ambViolations = []; let ambTotal = 0, ambReturnedAmbiguous = 0;
  for (const [n, set] of common) { if (set.size <= 1) continue; ambTotal++; const res = resolve(null, n, exact, common);
    if (res.match_method === 'ambiguous') ambReturnedAmbiguous++;
    else if (statusOf(res) === 'resolved' && !set.has(res.canonical_id)) ambViolations.push({ common: n, candidates: [...set], picked: res.canonical_id }); }
  rec('ambiguous_never_picks_outside_candidates', 'ambiguous input never resolves to a non-candidate species', ambViolations.length === 0, `${ambViolations.length} violations (${ambReturnedAmbiguous}/${ambTotal} return ambiguous; rest owner-pinned to a candidate or part-stripped)`);

  // 4e unrecognised
  const gibberish = ['Xyzzy blorptonium 42', 'qwertyuiop', 'zzz zzz zzz', '1234567'];
  const unrecBad = gibberish.filter(g => statusOf(resolve(null, g, exact, common)) !== 'unrecognised');
  rec('unrecognised', 'gibberish → unrecognised', unrecBad.length === 0, `${gibberish.length - unrecBad.length}/${gibberish.length} unrecognised`);

  // 4f part / format-stripped
  const uniq = [...commonToIds].filter(([, ids]) => ids.size === 1).slice(0, 80).map(([n, ids]) => ({ n, id: [...ids][0] }));
  let stripOk = 0; const stripLost = [];
  for (const { n, id } of uniq) for (const suf of [' Root', ' Powder', ' Leaf, Cut']) { const res = resolve(null, n + suf, exact, common);
    if (statusOf(res) !== 'unrecognised') stripOk++; else stripLost.push({ input: n + suf, expect: id }); }
  rec('part_and_format_stripped', 'part/format-suffixed input still resolves', stripLost.length === 0, `${stripOk} resolve / ${stripLost.length} lost`);

  // 4g case / whitespace normalisation
  const cr = RECS.find(r => isStr(r.authority_accepted_name) && !hyphenEpithet(r.authority_accepted_name));
  const nm = cr.authority_accepted_name;
  const variants = [nm.toUpperCase(), nm.toLowerCase(), '  ' + nm + '  ', nm.replace(/ /g, '  ')];
  const caseBad = variants.filter(v => resolve(null, v, exact, common).canonical_id !== cr.canonical_id);
  rec('case_whitespace_normalisation', 'case/whitespace variants → same record', caseBad.length === 0, `${variants.length - caseBad.length}/${variants.length} normalised`);

  // 4h NO substring / fuzzy false matches — assert explicitly
  const negatives = [
    { kind: 'genus-only', input: cr.genus || nm.split(' ')[0] },
    { kind: 'substring', input: nm.slice(0, Math.max(5, Math.floor(nm.length / 2))) },
    { kind: 'one-char-typo', input: nm.slice(0, -1) + (nm.endsWith('a') ? 'x' : 'a') },
  ];
  const falseMatch = [];
  for (const neg of negatives) { const res = resolve(null, neg.input, exact, common); const n = norm(neg.input);
    const legitExactKey = exact.has(n) || (common.has(n) && common.get(n).size === 1);   // a genuine exact/unique key is not a false match
    if (statusOf(res) === 'resolved' && !legitExactKey) falseMatch.push({ kind: neg.kind, input: neg.input, picked: res.canonical_id, method: res.match_method }); }
  rec('no_substring_or_fuzzy_false_match', 'genus-only / substring / typo never fuzzy-match', falseMatch.length === 0, falseMatch.length ? JSON.stringify(falseMatch) : 'none (resolver is exact-only, no fuzzy)');

  const deviations = probes.filter(p => !p.ok);
  S.s4 = {
    title: 'Resolver mechanics (behaviour of the code, not commercial correctness)',
    counts: { paths_checked: probes.length, paths_behaving_as_specified: probes.length - deviations.length, paths_deviating: deviations.length },
    probes,
    key_finding: aBad.length ? `Resolver gap: ${aBad.length} accepted names (${aBadHyphen} with hyphenated epithets, e.g. "Arctostaphylos uva-ursi") do NOT resolve to themselves — resolve()'s cleanLabel splits hyphens the exact index retains. The index KEY exists; resolve() cannot reach it.` : null,
    detail: { accepted_name_not_resolving_to_self: trArr(aBad), synonym_not_resolving_to_own_record: trArr(sBad), common_unique_wrong_pick: trArr(uniqueWrongPick), ambiguous_picked_outside_candidates: trArr(ambViolations), part_format_lost: trArr(stripLost) },
  };
})();

// ===================== SECTION 5 — SCHEMA CONSISTENCY =====================
(function section5() {
  const a = { missing_schema_v2_fields: [], display_name_semantics_violation: [], trade_primary_semantics_violation: [],
    excluded_name_also_resolved: [], pass1_keys_unaccounted: [], version_field_issues: [], quarantine_version_mismatch: [], excluded_count_mismatch: [] };
  const V2 = ['authority_accepted_name', 'trade_primary_name', 'canonical_display_name', 'accepted_name'];
  for (const r of RECS) {
    const missing = V2.filter(f => !(f in r)); if (missing.length) a.missing_schema_v2_fields.push({ id: r.canonical_id, missing });
    const amb = isAmbiguousStatus(r);
    if (!amb) {
      const expectDisplay = r.trade_primary_name || r.authority_accepted_name;
      if ((r.canonical_display_name ?? null) !== (expectDisplay ?? null)) a.display_name_semantics_violation.push({ id: r.canonical_id, canonical_display_name: r.canonical_display_name, expected: expectDisplay });
      if (r.trade_primary_name != null && r.trade_primary_name === r.authority_accepted_name) a.trade_primary_semantics_violation.push({ id: r.canonical_id, trade_primary_name: r.trade_primary_name });
    } else if (r.canonical_display_name != null) a.display_name_semantics_violation.push({ id: r.canonical_id, issue: r.resolution_status + ' should have null canonical_display_name', canonical_display_name: r.canonical_display_name });
  }
  for (const f of ['identity_version', 'identity_schema_version', 'initial_backbone_created', 'generated_at']) if (META[f] == null) a.version_field_issues.push({ field: f, issue: 'missing' });
  if (META.identity_schema_version !== 2) a.version_field_issues.push({ field: 'identity_schema_version', value: META.identity_schema_version, expected: 2 });
  if (META.identity_records != null && META.identity_records !== RECS.length) a.version_field_issues.push({ field: '_meta.identity_records', value: META.identity_records, actual: RECS.length });
  const excludedArr = excludedDoc.excluded || [];
  if (META.excluded != null && META.excluded !== excludedArr.length) a.excluded_count_mismatch.push({ meta_excluded: META.excluded, excluded_json_length: excludedArr.length });
  const resolvedNames = new Set(); for (const r of RECS) for (const nm of (r.original_parsed_names || [])) resolvedNames.add(norm(nm));
  const excludedNames = new Set(excludedArr.map(e => norm(e.parsed_name)).filter(Boolean));
  for (const e of excludedArr) { const n = norm(e.parsed_name); if (n && resolvedNames.has(n)) a.excluded_name_also_resolved.push({ excluded: e.parsed_name }); }
  const qv = quarantine._meta && quarantine._meta.identity_version;
  if (qv && qv !== IDV) a.quarantine_version_mismatch.push({ artifact: 'knowledge/identity/common_index_quarantine.json', its_identity_version: qv, backbone_identity_version: IDV });
  const pass1Keys = Object.keys(pass1.botanicals || {});
  const unaccounted = pass1Keys.filter(k => { const n = norm(k); return !resolvedNames.has(n) && !excludedNames.has(n); });
  for (const k of unaccounted) a.pass1_keys_unaccounted.push({ pass1_key: k });
  S.s5 = {
    title: 'Schema consistency',
    facts: { backbone_records: RECS.length, meta_identity_records: META.identity_records, pass1_keys: pass1Keys.length, meta_pass1_keys_accounted: META.pass1_keys_accounted, excluded_json_count: excludedArr.length, meta_excluded: META.excluded },
    counts: cnt(a), detail: det(a),
  };
})();

// ---- helpers for section assembly ----
function cnt(obj) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.length])); }
function det(obj) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, trArr(v)])); }
const sum = (counts) => Object.values(counts).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0);

// ---- headline (anomalies only; expected/feature counts excluded) ----
const headline = {
  s1_taxonomy: sum(S.s1.counts),
  s2_provenance: sum(S.s2.counts),
  s3_normalisation_mechanical: sum(S.s3.mechanical_anomaly_counts),
  s4_resolver_deviations: S.s4.counts.paths_deviating,
  s5_schema: sum(S.s5.counts),
};
headline.TOTAL = sum(headline);
const out = { artifact: 'ADR-013 Pass 6A backbone mechanical integrity (Gate 1, report-only)', run_against_identity_version: IDV, identity_schema_version: META.identity_schema_version, backbone_records: RECS.length, headline_anomaly_counts: headline, sections: S };
fs.writeFileSync(P('knowledge/pass6/pass6a_integrity.json'), JSON.stringify(out, null, 2));

// ---- markdown ----
const md = [];
const push = (...l) => md.push(...l);
push('# ADR-013 Pass 6A — Backbone Mechanical Integrity (Gate 1)', '');
push(`**Run against** \`identity_version ${IDV}\` · schema v${META.identity_schema_version} · ${RECS.length} records. **Report-only, deterministic.** Regenerate: \`node knowledge/pass6/pass6a_integrity.mjs\`.`, '');
push('> **What 6A CANNOT detect:** it proves *internal consistency*, not *commercial correctness*. A backbone can be perfectly consistent here and still map "bergamot" to lemon, or bare "orange" to bitter orange. Naming→species correctness is Gate 2 (6B/6C).', '');
push('## Headline anomaly counts', '');
push('| Section | Anomalies |', '|---|---|');
push(`| 1 · Taxonomy mechanics | ${headline.s1_taxonomy} |`);
push(`| 2 · Provenance integrity | ${headline.s2_provenance} |`);
push(`| 3 · Normalisation (mechanical) | ${headline.s3_normalisation_mechanical} |`);
push(`| 4 · Resolver mechanics (deviations) | ${headline.s4_resolver_deviations} |`);
push(`| 5 · Schema consistency | ${headline.s5_schema} |`);
push(`| **TOTAL mechanical anomalies** | **${headline.TOTAL}** |`, '');
push('_Expected-by-design (not anomalies):_ Section 3 reports ' + S.s3.expected_or_feature_counts.common_name_normalised_collisions_EXPECTED + ' common-name normalised collisions (resolver returns `ambiguous`), ' + S.s3.expected_or_feature_counts.non_ascii_names_present + ' non-ASCII names (accents / ≥ assay markers, consistently kept), and ' + S.s3.expected_or_feature_counts.hybrid_multiplication_sign_present + ' hybrid `×` names.', '');
for (const key of ['s1', 's2', 's3', 's4', 's5']) {
  const s = S[key]; push(`## Section ${key[1]} — ${s.title}`, '');
  if (s.provenance_granularity) { push(`**Provenance granularity:** ${s.provenance_granularity}.`, `Per-record provenance keys: \`${(s.provenance_record_keys || []).join(', ')}\`.`, `Name-assignment classification — total ${s.name_assignment_classification.total_name_assignments}: per-name 0, record-level ${s.name_assignment_classification.record_level}, unknown 0. \`accepted_outside_gbif_candidates\` records: ${s.accepted_outside_gbif_candidates_records}.`, ''); }
  if (s.facts) { push('**Facts:** ' + Object.entries(s.facts).map(([k, v]) => `${k}=${v}`).join(' · '), ''); }
  if (s.key_finding) { push('**Key finding:** ' + s.key_finding, ''); }
  const countBlocks = s.counts ? [['', s.counts]] : [['Mechanical anomalies', s.mechanical_anomaly_counts], ['Expected / features present', s.expected_or_feature_counts]];
  for (const [label, counts] of countBlocks) { if (label) push(`**${label}:**`, ''); push('| Check | Count |', '|---|---|'); for (const [k, v] of Object.entries(counts)) push(`| ${k} | ${v} |`); push(''); }
  if (key === 's4') { push('**Probes:**', '', '| Path | Expectation | Result | OK |', '|---|---|---|---|'); for (const p of s.probes) push(`| ${p.path} | ${p.expect} | ${p.got} | ${p.ok ? '✅' : '❌'} |`); push(''); }
  const nonEmpty = Object.entries(s.detail || {}).filter(([, v]) => v && v.total > 0);
  if (!nonEmpty.length) push('_No detail entries in this section._', '');
  else for (const [k, v] of nonEmpty) { push(`<details><summary><b>${k}</b> — ${v.total}${v.truncated ? ' (first 25)' : ''}</summary>`, '', '```json', JSON.stringify(v.shown, null, 1), '```', '</details>', ''); }
  push('');
}
push('## Where the anomalies live', '');
push('- **Section 4 findings are RESOLVER (`worker/src/engine.js`) behaviour, not backbone DATA.** The backbone *stores* the correct hyphenated accepted names and the unique common names; `resolve()` cannot reach them (hyphen split) or over-generalises them (part-strip → owner collision-pin). They are fixed in the resolver, not by a backbone rebuild — reported here, not corrected (6A is report-only).', '');
push('- **Section 5 quarantine mismatch is an ARTIFACT stamp**, not a data defect: `common_index_quarantine.json` was built against an earlier `identity_version`.', '');
push('## What 6A CANNOT detect (honest limits)', '');
push('6A proves **internal consistency, not commercial correctness**. Specifically it cannot detect:');
push('- **Naming→species correctness** — a consistent backbone can still map "bergamot"→lemon or bare "orange"→bitter orange (that is Gate 2 / 6B–6C).');
push('- **Silently dropped obsolete synonyms** — verifying a name was *retained* needs a prior-`identity_version` baseline to diff against; 6A only checks that present synonyms are well-formed.');
push('- **Transliteration-variant equivalence** — two spellings of the same vernacular that normalise to *different* keys are indistinguishable from two different names without an authored equivalence map.');
push('- **Coverage gaps** — names/species that *should* exist but do not (6B).', '');
fs.writeFileSync(P('knowledge/pass6/pass6a_integrity.md'), md.join('\n'));

// ---- console ----
console.log('ADR-013 Pass 6A — backbone mechanical integrity (report-only)\nrun against identity_version', IDV, '·', RECS.length, 'records\n');
console.log('PER-SECTION ANOMALY COUNTS:');
for (const [k, v] of Object.entries(headline)) console.log('  ' + k.padEnd(34), v);
console.log('\nS2 provenance granularity:', S.s2.provenance_granularity.split(' (')[0]);
console.log('S4 resolver:', S.s4.counts.paths_behaving_as_specified + '/' + S.s4.counts.paths_checked, 'paths as specified;', S.s4.key_finding ? 'KEY FINDING present' : 'no gaps');
console.log('\nwrote knowledge/pass6/pass6a_integrity.{md,json}');
