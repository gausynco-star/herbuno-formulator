# Parse-QA Report — ADR-013 Pass 1 (thewholesaler.eu)

> **Status: UNVERIFIED candidate data.** Machine parse only. Identity is NOT authority-
> checked (Pass 2) and forms are single-supplier (Pass 3 pending). Not production-ready.

## Provenance
| field | value |
|---|---|
| source_supplier | `thewholesaler.eu` |
| observation_date | `2026-06-13` (snapshot date) |
| source_file | `allProducts[thewholesaler.eu]-2026-06-13T07-55-02.890Z.csv` (kept OUT of repo, see .gitignore) |
| source_sha256 | `00aeccfa879d07ce73174e1c0c73c7190ca649e14bd25e099469e69bead965e2` |

## Counts
| metric | value |
|---|---:|
| rows in file (data rows) | 29075 |
| rows with a non-empty `Type` | 5006 |
| rows with a **mapped** `Type` (processed for forms) | 3930 |
| distinct Latin keys (candidate botanicals) | 641 |
| unmapped `Type` — out-of-scope non-forms | 161 values |
| unmapped `Type` — candidate new codes | CO2 Extract×14, Essential Oil×195 |
| no-Latin records (routed to review) | 101 |
| review-queue entries (total) | 382 |

Review queue by reason: `assay_in_latin`=14, `case_variant_merge`=106, `multi_dash_latin_not_final`=53, `name_in_latin_paren`=20, `near_duplicate_latin`=3, `no_latin`=101, `suspicious_latin_rejected`=85

## Mandatory spot-check (§5) — must resolve correctly
Each MUST be present with its forms aggregated under ONE normalised Latin key.

- **Withania somnifera** — ✅ present · 12 listings · forms: **CO, MP, OE, RE, RE-paste, WL, WL-glycerin, WL-glycol** · common labels: _Ashwagandha; Ashwagandha Root_
- **Bacopa monnieri** — ✅ present · 17 listings · forms: **CO, MP, OE, RE, RE-paste, WD, WL, WL-glycerin, WL-glycol** · common labels: _Bacopa; Bacopa (≥20% bacosides); Bacopa (≥40% bacosides); Bacopa (≥50% bacosides); Brahmi; Brahmi Booti (Leaf), Whole_
- **Asparagus racemosus** — ✅ present · 11 listings · forms: **CO, MP, OE, RE, RE-paste, TC, WD, WL, WL-glycerin, WL-glycol** · common labels: _Satavari Yellow, Cut; Shatavari; Shatavari Root White, Cut; Shatavari Root White, Whole_
- **Centella asiatica** — ✅ present · 16 listings · forms: **CO, MP, OE, RE, RE-paste, TC, WL, WL-glycerin, WL-glycol** · common labels: _Gotu Kola; Gotu Kola (Asiaticoside); Gotu Kola (≥40% triterpenes); Gotu Kola, Cut; Pegagan (Gotu Kola) (20:1); Pegagan (Gotu Kola) (Asiaticoside-rich)_

## 50-botanical proof cohort — cost measurement (§6, the go/no-go gate)
Top 50 botanicals by product-listing count (highest commercial signal).

**Two honest levels** (do not conflate them):
- **Needs review** = ≥1 flag worth a human eyeball (`multi_dash_latin_not_final`,
  `near_duplicate_latin`, `suspicious_latin_rejected`). Most multi-dash cases parse
  *correctly* (e.g. `Mangifera indica` out of a 4-segment title) — they just want a confirm.
- **Likely genuinely wrong** = the subset with a probable real error: a species typo caught
  by near-duplicate detection, or a rejected false binomial. This is the true defect rate.
- `case_variant_merge` and assay/name-in-paren are applied-and-logged (auditable, not errors);
  they count in the review-entry burden but not in either rate above.

| metric | value |
|---|---:|
| **needs-review rate** on the 50 (human eyeball) | **11/50 = 22%** |
| **likely-genuine error rate** on the 50 | **1/50 = 2%** |
| review-queue entries attributable to the 50 | **51** |
| est. human review to reach identity-verified | **202 min (~3.4 h)** |
| &nbsp;&nbsp;→ assumption: per flagged entry | 2.5 min |
| &nbsp;&nbsp;→ assumption: per-botanical authority check | 1.5 min |
| &nbsp;&nbsp;→ implied per-botanical average | 4.0 min |

### The 50 (rank · Latin · listings · #forms · flags)
| # | Latin key | listings | forms | entries | needs-review | likely-wrong | reasons |
|--:|---|--:|--:|--:|:--:|:--:|---|
| 1 | `Punica granatum` | 40 | 10 | 2 | — | — | assay_in_latin×1, case_variant_merge×1 |
| 2 | `Brassica oleracea` | 27 | 7 | 0 | — | — | — |
| 3 | `Azadirachta indica` | 26 | 10 | 1 | — | — | case_variant_merge×1 |
| 4 | `Capsicum annuum` | 26 | 9 | 1 | — | — | case_variant_merge×1 |
| 5 | `Carica papaya` | 26 | 8 | 2 | yes | — | multi_dash_latin_not_final×2 |
| 6 | `Citrus limon` | 26 | 10 | 2 | yes | — | multi_dash_latin_not_final×2 |
| 7 | `Moringa oleifera` | 24 | 10 | 1 | — | — | case_variant_merge×1 |
| 8 | `Myristica fragrans` | 24 | 10 | 1 | — | — | case_variant_merge×1 |
| 9 | `Psidium guajava` | 24 | 9 | 1 | yes | — | multi_dash_latin_not_final×1 |
| 10 | `Ricinus communis` | 23 | 10 | 2 | yes | **yes** | case_variant_merge×1, near_duplicate_latin×1 |
| 11 | `Camellia sinensis` | 22 | 8 | 1 | — | — | assay_in_latin×1 |
| 12 | `Curcuma longa` | 21 | 9 | 2 | — | — | assay_in_latin×2 |
| 13 | `Mangifera indica` | 21 | 9 | 4 | yes | — | assay_in_latin×1, case_variant_merge×1, multi_dash_latin_not_final×2 |
| 14 | `Vitis vinifera` | 21 | 7 | 2 | — | — | assay_in_latin×1, case_variant_merge×1 |
| 15 | `Citrus sinensis` | 20 | 10 | 1 | yes | — | multi_dash_latin_not_final×1 |
| 16 | `Oryza sativa` | 20 | 8 | 1 | — | — | case_variant_merge×1 |
| 17 | `Zingiber officinale` | 20 | 10 | 1 | yes | — | multi_dash_latin_not_final×1 |
| 18 | `Allium cepa` | 19 | 8 | 0 | — | — | — |
| 19 | `Nelumbo nucifera` | 19 | 10 | 0 | — | — | — |
| 20 | `Cassia fistula` | 18 | 10 | 1 | — | — | case_variant_merge×1 |
| 21 | `Nyctanthes arbor-tristis` | 18 | 9 | 1 | — | — | case_variant_merge×1 |
| 22 | `Aegle marmelos` | 17 | 10 | 1 | — | — | case_variant_merge×1 |
| 23 | `Ananas comosus` | 17 | 7 | 1 | yes | — | multi_dash_latin_not_final×1 |
| 24 | `Bacopa monnieri` | 17 | 9 | 4 | yes | — | assay_in_latin×1, case_variant_merge×1, multi_dash_latin_not_final×2 |
| 25 | `Citrullus lanatus` | 17 | 8 | 5 | yes | — | case_variant_merge×1, multi_dash_latin_not_final×4 |
| 26 | `Ocimum sanctum` | 17 | 10 | 0 | — | — | — |
| 27 | `Syzygium aromaticum` | 17 | 10 | 0 | — | — | — |
| 28 | `Centella asiatica` | 16 | 9 | 0 | — | — | — |
| 29 | `Piper nigrum` | 16 | 10 | 1 | — | — | case_variant_merge×1 |
| 30 | `Raphanus sativus` | 16 | 8 | 0 | — | — | — |
| 31 | `Terminalia chebula` | 16 | 10 | 3 | yes | — | case_variant_merge×1, multi_dash_latin_not_final×2 |
| 32 | `Achyranthes aspera` | 15 | 10 | 1 | — | — | case_variant_merge×1 |
| 33 | `Andrographis paniculata` | 15 | 8 | 2 | — | — | assay_in_latin×1, case_variant_merge×1 |
| 34 | `Bambusa arundinacea` | 15 | 8 | 0 | — | — | — |
| 35 | `Daucus carota` | 15 | 9 | 0 | — | — | — |
| 36 | `Foeniculum vulgare` | 15 | 11 | 0 | — | — | — |
| 37 | `Garcinia mangostana` | 15 | 7 | 0 | — | — | — |
| 38 | `Rosa indica` | 15 | 8 | 0 | — | — | — |
| 39 | `Sida cordifolia` | 15 | 10 | 1 | — | — | case_variant_merge×1 |
| 40 | `Syzygium cumini` | 15 | 8 | 1 | — | — | case_variant_merge×1 |
| 41 | `Allium sativum` | 14 | 9 | 0 | — | — | — |
| 42 | `Coriandrum sativum` | 14 | 9 | 0 | — | — | — |
| 43 | `Hibiscus sabdariffa` | 14 | 9 | 1 | — | — | assay_in_latin×1 |
| 44 | `Lepidium meyenii` | 14 | 7 | 0 | — | — | — |
| 45 | `Mimusops elengi` | 14 | 10 | 0 | — | — | — |
| 46 | `Momordica charantia` | 14 | 10 | 1 | — | — | case_variant_merge×1 |
| 47 | `Murraya koenigii` | 14 | 10 | 0 | — | — | — |
| 48 | `Premna integrifolia` | 14 | 9 | 0 | — | — | — |
| 49 | `Psoralea corylifolia` | 14 | 8 | 1 | — | — | case_variant_merge×1 |
| 50 | `Stevia rebaudiana` | 14 | 7 | 1 | — | — | assay_in_latin×1 |

## Known limitations (hand-off to Pass 2)
- **Single supplier.** Forms are thewholesaler.eu only; market-status counts are NOT yet
  meaningful (needs Pass 3 multi-supplier consensus). Provenance is recorded per form.
- **Identity not authority-checked.** No binomial has been validated against GBIF/POWO/Kew
  (Pass 2). Near-duplicate typos (e.g. `Ricinus communes`↔`communis`) are flagged, not fixed.
- **Hyphenated epithets allowed** (fixes `Trigonella foenum-graecum`, `Nyctanthes arbor-tristis`,
  `Strychnos nux-vomica`, `Opuntia ficus-indica`). Rarely over-captures a hyphen-joined common
  name (`Portulaca oleracea-purslane`, 1 listing) — Pass 2 authority check resolves it.
- **Genus-only / no-binomial titles** are routed to the no-Latin queue, never common-name merged.

### Go/No-Go note
This cost is the gate for scaling to the full ~700. Do **not** proceed to Pass 2 or
additional suppliers until the owner has reviewed these numbers (BUILD_BRIEF §6, ADR-013 §8).
