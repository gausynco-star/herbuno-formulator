# ADR-013 Pass 6A — Backbone Mechanical Integrity (Gate 1)

**Run against** `identity_version 2026-07-19.4` · schema v2 · 826 records. **Report-only, deterministic.** Regenerate: `node knowledge/pass6/pass6a_integrity.mjs`.

> **What 6A CANNOT detect:** it proves *internal consistency*, not *commercial correctness*. A backbone can be perfectly consistent here and still map "bergamot" to lemon, or bare "orange" to bitter orange. Naming→species correctness is Gate 2 (6B/6C).

## Headline anomaly counts

| Section | Anomalies |
|---|---|
| 1 · Taxonomy mechanics | 0 |
| 2 · Provenance integrity | 0 |
| 3 · Normalisation (mechanical) | 0 |
| 4 · Resolver mechanics (deviations) | 2 |
| 5 · Schema consistency | 1 |
| **TOTAL mechanical anomalies** | **3** |

_Expected-by-design (not anomalies):_ Section 3 reports 12 common-name normalised collisions (resolver returns `ambiguous`), 55 non-ASCII names (accents / ≥ assay markers, consistently kept), and 1 hybrid `×` names.

## Section 1 — Taxonomy mechanics

| Check | Count |
|---|---|
| malformed_accepted_name | 0 |
| accepted_vs_authority_mismatch | 0 |
| rank_field_inconsistency | 0 |
| malformed_synonym | 0 |
| converged_accepted_name_duplicates | 0 |
| duplicate_canonical_id | 0 |
| missing_genus_species | 0 |

_No detail entries in this section._


## Section 2 — Provenance integrity

**Provenance granularity:** record-level only (names are flat strings; provenance is one object per record — carried by the whole record, not per name).
Per-record provenance keys: `authority, query_date, resolved_by, review_date`.
Name-assignment classification — total 2982: per-name 0, record-level 2982, unknown 0. `accepted_outside_gbif_candidates` records: 386.

| Check | Count |
|---|---|
| records_without_provenance | 0 |
| records_untraceable_to_source | 0 |
| enriched_by_not_array | 0 |
| accepted_outside_gbif_missing_stamp | 0 |

_No detail entries in this section._


## Section 3 — Normalisation

**Mechanical anomalies:**

| Check | Count |
|---|---|
| accepted_name_normalised_collisions | 0 |
| synonym_normalised_collisions | 0 |
| non_breaking_space | 0 |
| leading_trailing_or_double_space | 0 |
| author_abbreviation_in_accepted_or_synonym | 0 |

**Expected / features present:**

| Check | Count |
|---|---|
| common_name_normalised_collisions_EXPECTED | 12 |
| non_ascii_names_present | 55 |
| hybrid_multiplication_sign_present | 1 |

<details><summary><b>common_name_normalised_collisions_EXPECTED</b> — 12</summary>

```json
[
 {
  "normalized": "black cardamom",
  "canonical_ids": [
   "amomum-subulatum",
   "wurfbainia-villosa"
  ]
 },
 {
  "normalized": "ajwain",
  "canonical_ids": [
   "carum-copticum",
   "trachyspermum-ammi"
  ]
 },
 {
  "normalized": "cinnamon",
  "canonical_ids": [
   "cinnamomum-burmanni",
   "cinnamomum-verum"
  ]
 },
 {
  "normalized": "cinnamon bark",
  "canonical_ids": [
   "cinnamomum-burmanni",
   "cinnamomum-verum"
  ]
 },
 {
  "normalized": "bay leaf",
  "canonical_ids": [
   "cinnamomum-tamala",
   "laurus-nobilis"
  ]
 },
 {
  "normalized": "nagarmotha",
  "canonical_ids": [
   "cyperus-rotundus",
   "cyperus-scariosus"
  ]
 },
 {
  "normalized": "hibiscus flower",
  "canonical_ids": [
   "hibiscus-mutabilis",
   "hibiscus-sabdariffa"
  ]
 },
 {
  "normalized": "hibiscus flower cut",
  "canonical_ids": [
   "hibiscus-mutabilis",
   "hibiscus-sabdariffa"
  ]
 },
 {
  "normalized": "hibiscus flower whole",
  "canonical_ids": [
   "hibiscus-mutabilis",
   "hibiscus-sabdariffa"
  ]
 },
 {
  "normalized": "jasmine",
  "canonical_ids": [
   "jasminum",
   "jasminum-sambac"
  ]
 },
 {
  "normalized": "chitrak root",
  "canonical_ids": [
   "plumbago-indica",
   "plumbago-zeylanica"
  ]
 },
 {
  "normalized": "rose petal",
  "canonical_ids": [
   "rosa-damascena",
   "rosa-indica"
  ]
 }
]
```
</details>

<details><summary><b>non_ascii_names_present</b> — 55 (first 25)</summary>

```json
[
 {
  "id": "allium-cepa",
  "where": "common",
  "name": "Onion (≥5% quercetin)"
 },
 {
  "id": "andrographis-paniculata",
  "where": "common",
  "name": "Fah Talai Jone (≥20% andrographolide)"
 },
 {
  "id": "andrographis-paniculata",
  "where": "common",
  "name": "Sambiloto (≥20% andrographolide)"
 },
 {
  "id": "andrographis-paniculata",
  "where": "common",
  "name": "Sambiloto (≥30% andrographolide)"
 },
 {
  "id": "andrographis-paniculata",
  "where": "common",
  "name": "Sambiloto (≥50% andrographolide)"
 },
 {
  "id": "andrographis-paniculata",
  "where": "common",
  "name": "Sambiloto Leaf (≥10% andrographolide)"
 },
 {
  "id": "bacopa-monnieri",
  "where": "common",
  "name": "Bacopa (≥20% bacosides)"
 },
 {
  "id": "bacopa-monnieri",
  "where": "common",
  "name": "Bacopa (≥40% bacosides)"
 },
 {
  "id": "bacopa-monnieri",
  "where": "common",
  "name": "Bacopa (≥50% bacosides)"
 },
 {
  "id": "camellia-sinensis",
  "where": "common",
  "name": "Green Tea (≥45% EGCG)"
 },
 {
  "id": "camellia-sinensis",
  "where": "common",
  "name": "Green Tea (≥50% polyphenols)"
 },
 {
  "id": "camellia-sinensis",
  "where": "common",
  "name": "Green Tea (≥98% EGCG)"
 },
 {
  "id": "centella-asiatica",
  "where": "common",
  "name": "Gotu Kola (≥40% triterpenes)"
 },
 {
  "id": "centella-asiatica",
  "where": "common",
  "name": "Pegagan (Gotu Kola) (≥40% triterpenes)"
 },
 {
  "id": "citrus-maxima",
  "where": "common",
  "name": "Pomelo Peel (≥20% hesperidin)"
 },
 {
  "id": "clitoria-ternatea",
  "where": "common",
  "name": "Butterfly Pea Flower (≥20% anthocyanins)"
 },
 {
  "id": "coffea-arabica",
  "where": "common",
  "name": "Green Coffee (≥50% chlorogenic acids)"
 },
 {
  "id": "coffea-arabica",
  "where": "common",
  "name": "Green Coffee (≥70% chlorogenic acids)"
 },
 {
  "id": "curcuma-longa",
  "where": "common",
  "name": "Turmeric (≥10% curcuminoids)"
 },
 {
  "id": "curcuma-longa",
  "where": "common",
  "name": "Turmeric (≥95% curcuminoids)"
 },
 {
  "id": "curcuma-longa",
  "where": "common",
  "name": "Turmeric (≥98% curcuminoids)"
 },
 {
  "id": "curcuma-xanthorrhiza",
  "where": "common",
  "name": "Temulawak (≥10% xanthorrhizol)"
 },
 {
  "id": "curcuma-xanthorrhiza",
  "where": "common",
  "name": "Temulawak (≥20% xanthorrhizol)"
 },
 {
  "id": "curcuma-xanthorrhiza",
  "where": "common",
  "name": "Temulawak (≥5% xanthorrhizol)"
 },
 {
  "id": "garcinia-mangostana",
  "where": "common",
  "name": "Mangosteen Pericarp (≥10% alpha-mangostin)"
 }
]
```
</details>

<details><summary><b>hybrid_multiplication_sign_present</b> — 1</summary>

```json
[
 {
  "id": "citrus-x-limon",
  "where": "accepted",
  "name": "Citrus ×limon"
 }
]
```
</details>


## Section 4 — Resolver mechanics (behaviour of the code, not commercial correctness)

**Key finding:** Resolver gap: 13 accepted names (12 with hyphenated epithets, e.g. "Arctostaphylos uva-ursi") do NOT resolve to themselves — resolve()'s cleanLabel splits hyphens the exact index retains. The index KEY exists; resolve() cannot reach it.

| Check | Count |
|---|---|
| paths_checked | 8 |
| paths_behaving_as_specified | 6 |
| paths_deviating | 2 |

**Probes:**

| Path | Expectation | Result | OK |
|---|---|---|---|
| accepted_name_exact | each accepted name resolves to its own record | 813 ok / 13 fail (12 of them hyphenated-epithet) | ❌ |
| scientific_synonym_exact | each synonym resolves to its record (or ambiguous) | 0 not resolving to own record (0 hyphenated) | ✅ |
| common_name_exact_unique | a unique common never resolves to a DIFFERENT record | 22 wrong picks (1826/1886 round-trip; rest → ambiguous/unrecognised by part-strip/quarantine design) | ❌ |
| ambiguous_never_picks_outside_candidates | ambiguous input never resolves to a non-candidate species | 0 violations (6/12 return ambiguous; rest owner-pinned to a candidate or part-stripped) | ✅ |
| unrecognised | gibberish → unrecognised | 4/4 unrecognised | ✅ |
| part_and_format_stripped | part/format-suffixed input still resolves | 240 resolve / 0 lost | ✅ |
| case_whitespace_normalisation | case/whitespace variants → same record | 4/4 normalised | ✅ |
| no_substring_or_fuzzy_false_match | genus-only / substring / typo never fuzzy-match | none (resolver is exact-only, no fuzzy) | ✅ |

<details><summary><b>accepted_name_not_resolving_to_self</b> — 13</summary>

```json
[
 {
  "id": "arctostaphylos-uva-ursi",
  "name": "Arctostaphylos uva-ursi",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "aspidosperma-quebracho-blanco",
  "name": "Aspidosperma quebracho-blanco",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "auricularia-auricula-judae",
  "name": "Auricularia auricula-judae",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "capsella-bursa-pastoris",
  "name": "Capsella bursa-pastoris",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "citrus-x-limon",
  "name": "Citrus ×limon",
  "got": "resolved:citrus-limon",
  "hyphen_epithet": false
 },
 {
  "id": "echinochloa-crus-galli-utilis",
  "name": "Echinochloa crus-galli utilis",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "ferula-assa-foetida",
  "name": "Ferula assa-foetida",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "opuntia-ficus-indica",
  "name": "Opuntia ficus-indica",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "pleurotus-tuber-regium",
  "name": "Pleurotus tuber-regium",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "strychnos-nux-vomica",
  "name": "Strychnos nux-vomica",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "trigonella-foenum-graecum",
  "name": "Trigonella foenum-graecum",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "vaccinium-vitis-idaea",
  "name": "Vaccinium vitis-idaea",
  "got": "unrecognised",
  "hyphen_epithet": true
 },
 {
  "id": "ziziphus-spina-christi",
  "name": "Ziziphus spina-christi",
  "got": "unrecognised",
  "hyphen_epithet": true
 }
]
```
</details>

<details><summary><b>common_unique_wrong_pick</b> — 22</summary>

```json
[
 {
  "common": "wood apple oil",
  "expected": "aegle-marmelos",
  "got": "malus-domestica"
 },
 {
  "common": "tea seed oil",
  "expected": "camellia-oleifera",
  "got": "camellia-sinensis"
 },
 {
  "common": "sarsaparilla root",
  "expected": "hemidesmus-indicus",
  "got": "decalepis-hamiltonii"
 },
 {
  "common": "sarsaparilla root cut",
  "expected": "hemidesmus-indicus",
  "got": "decalepis-hamiltonii"
 },
 {
  "common": "lavender",
  "expected": "lavandula-stoechas",
  "got": "lavandula-angustifolia"
 },
 {
  "common": "lavender flower bud whole",
  "expected": "lavandula-stoechas",
  "got": "lavandula-angustifolia"
 },
 {
  "common": "freeze dried basil",
  "expected": "ocimum-tenuiflorum",
  "got": "ocimum-basilicum"
 },
 {
  "common": "gokhru big cut",
  "expected": "pedalium-murex",
  "got": "tribulus-terrestris"
 },
 {
  "common": "chitrak bark cut",
  "expected": "plumbago-indica",
  "got": "plumbago-zeylanica"
 },
 {
  "common": "chitrak roots cut",
  "expected": "plumbago-indica",
  "got": "plumbago-zeylanica"
 },
 {
  "common": "freeze dried rose petal",
  "expected": "rosa-indica",
  "got": "rosa-damascena"
 },
 {
  "common": "rose petal tea",
  "expected": "rosa-indica",
  "got": "rosa-damascena"
 },
 {
  "common": "rose petal cut",
  "expected": "rosa-indica",
  "got": "rosa-damascena"
 },
 {
  "common": "rose petal whole",
  "expected": "rosa-indica",
  "got": "rosa-damascena"
 },
 {
  "common": "sarsaparilla cut",
  "expected": "smilax-medica",
  "got": "decalepis-hamiltonii"
 },
 {
  "common": "sarsaparilla whole",
  "expected": "smilax-medica",
  "got": "decalepis-hamiltonii"
 },
 {
  "common": "tagetes",
  "expected": "tagetes-minuta",
  "got": "tagetes"
 },
 {
  "common": "valerian",
  "expected": "valeriana-jatamansi",
  "got": "valeriana-officinalis"
 },
 {
  "common": "valerian root",
  "expected": "valeriana-jatamansi",
  "got": "valeriana-officinalis"
 },
 {
  "common": "valerian root cut",
  "expected": "valeriana-jatamansi",
  "got": "valeriana-officinalis"
 },
 {
  "common": "valerian root whole",
  "expected": "valeriana-jatamansi",
  "got": "valeriana-officinalis"
 },
 {
  "common": "rasna leaf",
  "expected": "vanda-tessellata",
  "got": "pluchea-lanceolata"
 }
]
```
</details>


## Section 5 — Schema consistency

**Facts:** backbone_records=826 · meta_identity_records=826 · pass1_keys=641 · meta_pass1_keys_accounted=641 · excluded_json_count=28 · meta_excluded=28

| Check | Count |
|---|---|
| missing_schema_v2_fields | 0 |
| display_name_semantics_violation | 0 |
| trade_primary_semantics_violation | 0 |
| excluded_name_also_resolved | 0 |
| pass1_keys_unaccounted | 0 |
| version_field_issues | 0 |
| quarantine_version_mismatch | 1 |
| excluded_count_mismatch | 0 |

<details><summary><b>quarantine_version_mismatch</b> — 1</summary>

```json
[
 {
  "artifact": "knowledge/identity/common_index_quarantine.json",
  "its_identity_version": "2026-07-19.3",
  "backbone_identity_version": "2026-07-19.4"
 }
]
```
</details>


## Where the anomalies live

- **Section 4 findings are RESOLVER (`worker/src/engine.js`) behaviour, not backbone DATA.** The backbone *stores* the correct hyphenated accepted names and the unique common names; `resolve()` cannot reach them (hyphen split) or over-generalises them (part-strip → owner collision-pin). They are fixed in the resolver, not by a backbone rebuild — reported here, not corrected (6A is report-only).

- **Section 5 quarantine mismatch is an ARTIFACT stamp**, not a data defect: `common_index_quarantine.json` was built against an earlier `identity_version`.

## What 6A CANNOT detect (honest limits)

6A proves **internal consistency, not commercial correctness**. Specifically it cannot detect:
- **Naming→species correctness** — a consistent backbone can still map "bergamot"→lemon or bare "orange"→bitter orange (that is Gate 2 / 6B–6C).
- **Silently dropped obsolete synonyms** — verifying a name was *retained* needs a prior-`identity_version` baseline to diff against; 6A only checks that present synonyms are well-formed.
- **Transliteration-variant equivalence** — two spellings of the same vernacular that normalise to *different* keys are indistinguishable from two different names without an authored equivalence map.
- **Coverage gaps** — names/species that *should* exist but do not (6B).
