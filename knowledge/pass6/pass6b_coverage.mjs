// ADR-013 Pass 6B — backbone COVERAGE audit (Gate 2, first half). EVIDENCE-ONLY. No fixes, no backbone edits.
//
// Coverage precedes correctness: you cannot assign "orange" correctly if Citrus sinensis isn't in the
// backbone. 6B audits what is MISSING. It combines DETERMINISTIC signals (derivable from the data) with a
// small CURATED SEED LIST of well-known commercial species (presence check only — it never invents
// commercial name→species mappings; that is 6C + owner adjudication).
//
// NOTE (from 6A): provenance is RECORD-LEVEL only (no per-name source), so 6C's provenance-based heuristics
// will be weaker than planned — per-name "which supplier contributed this alias" is not recoverable here.
//
// Run: node knowledge/pass6/pass6b_coverage.mjs   Writes: knowledge/pass6/pass6b_coverage.{md,json}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, buildIndices, resolve, statusOf } from '../../worker/src/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const rj = (rel) => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const backbone = rj('knowledge/identity/botanical_identity.json');
const pass1 = rj('knowledge/pass1/botanical_candidates.json');
const excludedDoc = rj('knowledge/identity/excluded.json');
const RECS = backbone.identities;
const { exact, common } = buildIndices(RECS);
const trArr = (a, n = 40) => ({ total: a.length, shown: a.slice(0, n), truncated: a.length > n });

// ---- name indices ----
const isStr = (s) => typeof s === 'string' && s.trim();
const isBinomial = (s) => isStr(s) && /^[A-Z][a-z]+[ ×]/.test(s.trim());        // Genus epithet…
const speciesKey = (s) => norm(String(s).replace(/^×/, '').replace(/\s×\s?/g, ' ')).split(' ').slice(0, 2).join(' '); // genus+epithet, normalised
const genusTok = (s) => norm(String(s).trim().split(/[ ×]/)[0]);
const recByAccepted = new Map();                                                // norm(genus epithet) -> record (own accepted)
const genusToSpecies = new Map();                                              // genus -> Set(canonical_id)
const validGenera = new Set();                                                 // real plant genera, from ACCEPTED names only (never synonyms — avoids common-name pollution)
for (const r of RECS) {
  if (isStr(r.authority_accepted_name)) { recByAccepted.set(speciesKey(r.authority_accepted_name), r); validGenera.add(genusTok(r.authority_accepted_name)); }
  if (isStr(r.genus)) { const g = norm(r.genus); validGenera.add(g); if (!genusToSpecies.has(g)) genusToSpecies.set(g, new Set()); genusToSpecies.get(g).add(r.canonical_id); }
}
// A real species binomial: "Genus epithet" whose genus is an actual plant genus. Rejects common names that
// happen to be Capitalised-word + word ("Holy basil", "Rose petal", "False daisy", "Gulab patti").
const isSpecies = (nm) => isBinomial(nm) && validGenera.has(genusTok(nm)) && /^[a-z][a-zà-ÿ-]{2,}$/.test((norm(nm).split(' ')[1] || ''));
// nameToRecs uses the LOOSE binomial pattern so a seed species present only as a synonym is still found —
// even when its synonym-genus (e.g. Argania, absorbed into Sideroxylon) is not itself an accepted genus.
// (Section 1's merge count uses the STRICT isSpecies to avoid common-name pollution.)
const nameToRecs = new Map();                                                   // binomial (norm) -> Set(record)
for (const r of RECS) for (const nm of [r.authority_accepted_name, ...(r.scientific_synonyms || []), ...(r.original_parsed_names || [])]) {
  if (!isBinomial(nm)) continue; const k = speciesKey(nm); if (!nameToRecs.has(k)) nameToRecs.set(k, new Set()); nameToRecs.get(k).add(r);
}
const S = {};

// ===================== SECTION 1 — MERGED DISTINCT SPECIES (synonym merges hiding species) =====================
(function s1() {
  const merged = [];
  for (const r of RECS) {
    const names = [...(r.original_parsed_names || []), ...(r.scientific_synonyms || [])].filter(isSpecies);
    const acc = isStr(r.authority_accepted_name) ? speciesKey(r.authority_accepted_name) : null;
    const distinct = new Map();                                                 // absorbed speciesKey -> original string (excl. the accepted itself)
    for (const nm of names) { const k = speciesKey(nm); if (k !== acc && !distinct.has(k)) distinct.set(k, nm); }
    if (distinct.size >= 1) merged.push({ canonical_id: r.canonical_id, accepted_name: r.authority_accepted_name, absorbed_distinct_species: [...distinct.values()], count: distinct.size });
  }
  merged.sort((a, b) => b.count - a.count);
  const multi = merged.filter(m => m.count >= 2);                               // HIGHER signal: >1 distinct species absorbed (Citrus/Aloe class)
  S.s1 = { title: 'Merged distinct species (candidate incorrect synonym merges hiding a commercial species)',
    note: 'A record whose original_parsed_names/scientific_synonyms include a DISTINCT species binomial beyond its accepted name. MOST are legitimate GBIF synonyms (Eclipta alba = Eclipta prostrata); the concern is commercially-distinct species absorbed into one record (the Citrus aurantium/paradisi/sinensis class). Which are genuine vs incorrect is 6C + owner — NOT decided here. The `multi_species_merges` subset (>=2 absorbed) is the higher-signal worklist.',
    counts: { records_absorbing_a_distinct_species: merged.length, multi_species_merges: multi.length, total_absorbed_species: merged.reduce((n, m) => n + m.count, 0) },
    detail: { multi_species_merges: trArr(multi), all_ranked: trArr(merged, 30) } };
})();

// ===================== SECTION 2 — BROAD COMMON NAME ON A SINGLE SPECIES (sibling needed for ambiguity) =====================
(function s2() {
  const PARTFORM = new Set(['root','roots','leaf','leaves','seed','seeds','bark','flower','flowers','fruit','fruits','berry','rhizome','peel','pericarp','rind','aerial','herb','wood','bud','buds','stem','tuber','husk','pod','pods','shell','resin','gum','nut','powder','extract','oil','dried','cut','whole','arils']);
  const byName = new Map();
  for (const r of RECS) for (const c of (r.common_names || [])) { const n = norm(c); if (!n) continue; if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(r.canonical_id); }
  const candidates = [];
  for (const [name, ids] of byName) {
    if (ids.size !== 1) continue; const toks = name.split(' '); if (toks.length !== 1) continue; const t = toks[0];
    if (t.length < 4 || PARTFORM.has(t)) continue;
    const cid = [...ids][0]; const r = RECS.find(x => x.canonical_id === cid); if (!r) continue;
    const g = norm((r.authority_accepted_name || '').split(' ')[0]); const sib = genusToSpecies.get(g) ? genusToSpecies.get(g).size : 1;
    if (sib >= 2) candidates.push({ bare_common: t, on_species: cid, latin: r.authority_accepted_name, sibling_species_in_genus: sib });
  }
  candidates.sort((a, b) => b.sibling_species_in_genus - a.sibling_species_in_genus || a.bare_common.localeCompare(b.bare_common));
  S.s2 = { title: 'Broad bare common name on a single species where the genus has siblings (ambiguity coverage gap)',
    note: 'A single-word common name unique to ONE species while its genus holds other species. If the name is colloquially broad (e.g. "orange"), the dominant sibling may be missing/merged, making the name resolve confidently to the wrong species instead of ambiguous. Commercial judgement (which are genuinely broad) is 6C.',
    counts: { bare_commons_on_single_species_with_siblings: candidates.length },
    detail: { ranked: trArr(candidates) } };
})();

// ===================== SECTION 3 — SUPPLIER COMMON NAMES THAT NEVER RESOLVE =====================
(function s3() {
  const supplierCommons = new Map();                                            // norm -> { raw, keys:Set(pass1 key) }
  for (const [key, v] of Object.entries(pass1.botanicals || {})) for (const c of (v.common_names || [])) {
    const n = norm(c); if (!n) continue; if (!supplierCommons.has(n)) supplierCommons.set(n, { raw: c, keys: new Set() }); supplierCommons.get(n).keys.add(key);
  }
  // A supplier common belongs to Pass-1 key(s). If every such key was excluded as non-botanical, the alias
  // is correctly uncovered (mineral/salt/bhasma) — not a botanical coverage gap.
  const excludedKeys = new Set((excludedDoc.excluded || []).map(e => norm(e.parsed_name)));
  const unresolved = [], nonBotanical = [];
  for (const [, info] of supplierCommons) {
    if (statusOf(resolve(null, info.raw, exact, common)) !== 'unrecognised') continue;
    const allExcluded = [...info.keys].every(k => excludedKeys.has(norm(k)));
    (allExcluded ? nonBotanical : unresolved).push({ supplier_common: info.raw, from_pass1_keys: [...info.keys].slice(0, 3) });
  }
  unresolved.sort((a, b) => a.supplier_common.localeCompare(b.supplier_common));
  S.s3 = { title: 'Supplier common names that never resolve to any backbone record (uncovered botanical aliases)',
    note: 'Distinct Pass-1 supplier common-name strings the resolver returns unrecognised for, AFTER removing those whose Pass-1 key was excluded as non-botanical (minerals/salts/bhasmas). What remains is a botanical alias with no home — a missing name on a present species, or a missing species.',
    counts: { distinct_supplier_commons: supplierCommons.size, never_resolve_botanical: unresolved.length, never_resolve_non_botanical_excluded: nonBotanical.length },
    detail: { unresolved_botanical: trArr(unresolved, 60), non_botanical_excluded: trArr(nonBotanical, 30) } };
})();

// ===================== SECTION 4 — THIN NAME COVERAGE =====================
(function s4() {
  const zeroCommon = [], oneCommon = [];
  let accepted = 0;
  for (const r of RECS) {
    if (r.resolution_status === 'genus_level' || /_ambiguous$/.test(r.resolution_status || '')) continue;
    accepted++;
    const nc = (r.common_names || []).length;
    if (nc === 0) zeroCommon.push({ canonical_id: r.canonical_id, accepted_name: r.authority_accepted_name, scientific_synonyms: (r.scientific_synonyms || []).length });
    else if (nc === 1) oneCommon.push({ canonical_id: r.canonical_id, accepted_name: r.authority_accepted_name, common_name: r.common_names[0] });
  }
  S.s4 = { title: 'Thin name coverage (present species with few/no vernacular names)',
    note: 'Accepted species records carrying 0 or 1 common name. A commercially-present species with no vernacular/trade name is likely under-covered (missing common/trade/pharmacopoeial aliases). Some genuinely have few names; commercial judgement is 6C.',
    counts: { accepted_species_records: accepted, zero_common_names: zeroCommon.length, one_common_name: oneCommon.length },
    detail: { zero_common_names: trArr(zeroCommon, 60), one_common_name: trArr(oneCommon) } };
})();

// ===================== SECTION 5 — CURATED SEED-LIST ABSENCE CHECK =====================
(function s5() {
  // Well-known commercial botanical species (supplement / food / spice / cosmetic). PRESENCE CHECK ONLY.
  // A SAMPLE, not exhaustive. Never asserts a common-name→species mapping — only whether the species name
  // exists in the backbone (as its own accepted record, absorbed into another, or absent).
  const SEED = [
    ['Citrus sinensis','sweet orange'],['Citrus paradisi','grapefruit'],['Citrus bergamia','bergamot'],['Citrus latifolia','persian lime'],['Citrus reticulata','mandarin'],
    ['Vaccinium macrocarpon','cranberry'],['Vaccinium myrtillus','bilberry'],['Vaccinium corymbosum','blueberry'],['Sambucus nigra','elderberry'],['Ribes nigrum','blackcurrant'],['Aronia melanocarpa','chokeberry'],
    ['Panax ginseng','asian ginseng'],['Panax quinquefolius','american ginseng'],['Eleutherococcus senticosus','siberian ginseng'],['Ginkgo biloba','ginkgo'],['Serenoa repens','saw palmetto'],['Actaea racemosa','black cohosh'],['Hypericum perforatum','st johns wort'],['Silybum marianum','milk thistle'],['Echinacea purpurea','echinacea'],['Rhodiola rosea','rhodiola'],['Valeriana officinalis','valerian'],
    ['Cinnamomum verum','ceylon cinnamon'],['Cinnamomum cassia','cassia'],['Zingiber officinale','ginger'],['Curcuma longa','turmeric'],['Piper nigrum','black pepper'],['Syzygium aromaticum','clove'],['Myristica fragrans','nutmeg'],['Crocus sativus','saffron'],['Vanilla planifolia','vanilla'],['Illicium verum','star anise'],['Capsicum annuum','chilli'],['Elettaria cardamomum','cardamom'],
    ['Camellia sinensis','tea'],['Coffea arabica','coffee'],['Theobroma cacao','cacao'],['Aspalathus linearis','rooibos'],['Ilex paraguariensis','yerba mate'],
    ['Punica granatum','pomegranate'],['Vitis vinifera','grape'],['Olea europaea','olive'],['Malus domestica','apple'],['Persea americana','avocado'],['Cocos nucifera','coconut'],
    ['Aloe vera','aloe'],['Simmondsia chinensis','jojoba'],['Vitellaria paradoxa','shea'],['Argania spinosa','argan'],['Rosa damascena','damask rose'],['Rosa canina','rosehip'],['Calendula officinalis','calendula'],['Lavandula angustifolia','english lavender'],['Melaleuca alternifolia','tea tree'],['Centella asiatica','gotu kola'],
    ['Withania somnifera','ashwagandha'],['Bacopa monnieri','bacopa'],['Tinospora cordifolia','guduchi'],['Emblica officinalis','amla'],['Phyllanthus emblica','amla'],['Terminalia chebula','haritaki'],['Trigonella foenum-graecum','fenugreek'],['Moringa oleifera','moringa'],['Boswellia serrata','boswellia'],
  ];
  const seen = [], absorbed = [], absent = [];
  for (const [latin, gloss] of SEED) {
    const k = speciesKey(latin); const own = recByAccepted.get(k); const anyRec = nameToRecs.get(k);
    if (own) seen.push({ species: latin, gloss, canonical_id: own.canonical_id });
    else if (anyRec && anyRec.size) { const into = [...anyRec].map(r => r.canonical_id); absorbed.push({ species: latin, gloss, absorbed_into: into }); }
    else absent.push({ species: latin, gloss });
  }
  S.s5 = { title: 'Curated seed-list presence check (well-known commercial species)',
    note: 'A SAMPLE of well-known commercial botanicals — presence only, no mappings invented. "absorbed" = the name exists only as a synonym/parsed-name of a DIFFERENT accepted record (merged, like Citrus sinensis→citrus-aurantium); "absent" = not found at all. Both are coverage gaps to review in 6C.',
    counts: { seed_size: SEED.length, present_own_record: seen.length, absorbed_into_other_species: absorbed.length, absent_entirely: absent.length },
    detail: { absorbed_into_other_species: trArr(absorbed), absent_entirely: trArr(absent), present_own_record: trArr(seen, 80) } };
})();

// ---- assemble ----
const headline = {
  s1_multi_species_merges: S.s1.counts.multi_species_merges,
  s1_records_absorbing_a_distinct_species: S.s1.counts.records_absorbing_a_distinct_species,
  s2_broad_commons_single_species: S.s2.counts.bare_commons_on_single_species_with_siblings,
  s3_supplier_commons_unresolved_botanical: S.s3.counts.never_resolve_botanical,
  s4_species_with_no_common_name: S.s4.counts.zero_common_names,
  s5_seed_absorbed: S.s5.counts.absorbed_into_other_species,
  s5_seed_absent: S.s5.counts.absent_entirely,
};
const out = { artifact: 'ADR-013 Pass 6B backbone coverage audit (Gate 2, report-only)', run_against_identity_version: backbone._meta.identity_version, backbone_records: RECS.length, provenance_note: 'record-level only (6A) — 6C provenance heuristics weakened', headline, sections: S };
fs.writeFileSync(P('knowledge/pass6/pass6b_coverage.json'), JSON.stringify(out, null, 2));

const md = []; const push = (...l) => md.push(...l);
push('# ADR-013 Pass 6B — Backbone Coverage (Gate 2, first half)', '');
push(`**Run against** \`identity_version ${backbone._meta.identity_version}\` · ${RECS.length} records. **Report-only.** Regenerate: \`node knowledge/pass6/pass6b_coverage.mjs\`.`, '');
push('> **Coverage precedes correctness.** 6B finds what is MISSING; it does NOT decide the correct name→species mapping (that is 6C + owner). Deterministic signals + a curated seed list (presence only — no invented commercial mappings).', '');
push('> **Provenance is record-level only** (established in 6A): per-name "which supplier contributed this alias" is unrecoverable, so 6C\'s provenance heuristics will be weaker than planned.', '');
push('## Headline coverage-gap counts', '', '| Signal | Count |', '|---|---|');
push(`| 1 · multi-species merges (>=2 distinct species absorbed) | ${headline.s1_multi_species_merges} |`);
push(`| 1 · records absorbing any distinct species (broad worklist) | ${headline.s1_records_absorbing_a_distinct_species} |`);
push(`| 2 · broad bare commons on a single species (siblings exist) | ${headline.s2_broad_commons_single_species} |`);
push(`| 3 · supplier common names that never resolve (botanical) | ${headline.s3_supplier_commons_unresolved_botanical} |`);
push(`| 4 · present species with ZERO common name | ${headline.s4_species_with_no_common_name} |`);
push(`| 5 · seed species ABSORBED into another record | ${headline.s5_seed_absorbed} |`);
push(`| 5 · seed species ABSENT entirely | ${headline.s5_seed_absent} |`, '');
for (const key of ['s1', 's2', 's3', 's4', 's5']) {
  const s = S[key]; push(`## Section ${key[1]} — ${s.title}`, '');
  if (s.note) push('> ' + s.note, '');
  push('| Metric | Count |', '|---|---|'); for (const [k, v] of Object.entries(s.counts)) push(`| ${k} | ${v} |`); push('');
  for (const [k, v] of Object.entries(s.detail)) { if (!v || !v.total) continue;
    push(`<details><summary><b>${k}</b> — ${v.total}${v.truncated ? ' (first ' + v.shown.length + ')' : ''}</summary>`, '', '```json', JSON.stringify(v.shown, null, 1), '```', '</details>', ''); }
  push('');
}
push('## What 6B CANNOT detect (honest limits)', '');
push('- **Correctness of any mapping** — 6B says a species is missing/absorbed, not what "orange" *should* mean. That is 6C + owner.');
push('- **Completeness of the seed list** — the seed list is a curated SAMPLE of well-known species; absence from it is not evidence of coverage. A species not flagged may still be missing.');
push('- **Per-name provenance / supplier attribution** — record-level provenance only (6A), so "which supplier uses this alias" and single-supplier-only names cannot be isolated here.');
push('- **Pharmacopoeial / regulatory name gaps** — require an external pharmacopoeia reference not present in the data; only raw absence of *any* vernacular is detectable (Section 4).');
push('- **Whether a merge is legitimate** — Section 1 lists all multi-species merges; GBIF-true synonyms and incorrect commercial merges look identical here.');
fs.writeFileSync(P('knowledge/pass6/pass6b_coverage.md'), md.join('\n'));

console.log('ADR-013 Pass 6B — backbone coverage (report-only) · identity_version', backbone._meta.identity_version, '·', RECS.length, 'records\n');
console.log('HEADLINE COVERAGE-GAP COUNTS:');
for (const [k, v] of Object.entries(headline)) console.log('  ' + k.padEnd(44), v);
console.log('\nwrote knowledge/pass6/pass6b_coverage.{md,json}');
