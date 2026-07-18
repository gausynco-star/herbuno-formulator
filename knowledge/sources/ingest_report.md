# Ingest Report — 6 Private Supplier Catalogues (ADR-013)

> INTERNAL. Supplier identity + counts are internal; never reach a storefront asset. Resolved
> against frozen identity_version `2026-07-18.1`. No prevalence language. Backbone not edited.

## Per-supplier resolution
| supplier | family | private | rows | resolved | id_rate | ambiguous | unresolved | ocr_fixes |
|---|---|---|--:|--:|--:|--:|--:|--:|
| sangam | sf_sangam | private | 104 | 77 | 74% | 0 | 27 | 13 |
| herbal_creative | sf_herbal_creative | private | 85 | 65 | 76% | 0 | 20 | 0 |
| vaishno | sf_vaishno | private | 313 | 144 | 46% | 3 | 166 | 0 |
| pending-mapping-01 | sf_pending_01 | private | 363 | 184 | 51% | 3 | 176 | 0 |
| aethon | sf_aethon | private | 85 | 64 | 75% | 6 | 15 | 0 |
| nita | sf_nita | private | 318 | 165 | 52% | 3 | 150 | 0 |

### match methods
- **sangam**: accepted_name_exact=55, common_name_exact_unique=9, original_parsed_name_exact=13, unresolved=27
- **herbal_creative**: accepted_name_exact=50, common_name_exact_unique=8, original_parsed_name_exact=7, unresolved=20
- **vaishno**: accepted_name_exact=41, ambiguous=3, common_name_exact_unique=95, original_parsed_name_exact=8, unresolved=166
- **pending-mapping-01**: accepted_name_exact=88, ambiguous=3, common_name_exact_unique=84, original_parsed_name_exact=12, unresolved=176
- **aethon**: ambiguous=6, common_name_exact_unique=64, unresolved=15
- **nita**: accepted_name_exact=5, ambiguous=3, common_name_exact_unique=156, original_parsed_name_exact=4, unresolved=150

### format distribution
- **sangam**: RE=104
- **herbal_creative**: RE=30, RE+SE=55
- **vaishno**: RE=202, RE+SE=110, SD=1
- **pending-mapping-01**: RE=248, RE+SE=114, SD=1
- **aethon**: EO=85
- **nita**: FD=41, MP=277

### plant-part distribution
- **sangam**: aerial=4, bark=1, flower=3, fruit=19, gum=2, leaf=14, peel=1, pod=1, rhizome=4, root=19, seed=16, stem=9, unspecified=11
- **herbal_creative**: aerial=3, bark=4, flower=4, fruit=18, gum=2, husk=1, leaf=13, peel=1, rhizome=2, root=12, seed=11, stem=3, unspecified=11
- **vaishno**: aerial=1, bark=7, flower=2, fruit=16, gum=1, leaf=12, peel=1, pod=1, root=9, seed=11, unspecified=251, wood=1
- **pending-mapping-01**: aerial=2, bark=7, flower=3, fruit=21, gum=1, leaf=13, peel=2, pod=1, root=10, seed=14, stem=1, tuber=1, unspecified=286, wood=1
- **aethon**: bark=1, bud=1, fruit=3, leaf=5, root=1, seed=2, unspecified=69, wood=3
- **nita**: fruit=19, gum=1, leaf=10, peel=4, root=4, seed=10, unspecified=269, wood=1

## OCR fixes applied (full list — 13, logged never silent)
| supplier | kind | before | after |
|---|---|---|---|
| sangam | glued_genus_split | `Adhatodavasica` | `Adhatoda vasica` |
| sangam | case_boundary_split | `TinosporaCordifolia` | `Tinospora Cordifolia` |
| sangam | glued_genus_split | `Gymnemasylvestre` | `Gymnema sylvestre` |
| sangam | glued_genus_split | `Commiphoramukul` | `Commiphora mukul` |
| sangam | case_boundary_split | `CissusQuandragulari s` | `Cissus Quandragulari s` |
| sangam | glued_genus_split | `Mucunapruriens` | `Mucuna pruriens` |
| sangam | case_boundary_split | `AndrographicsPanicu lata` | `Andrographics Panicu lata` |
| sangam | glued_genus_split | `Picrorhizakurroa` | `Picrorhiza kurroa` |
| sangam | glued_genus_split | `Centellaasiatica` | `Centella asiatica` |
| sangam | glued_genus_split | `Morindacitrifolia` | `Morinda citrifolia` |
| sangam | glued_genus_split | `Cyperusrotundus` | `Cyperus rotundus` |
| sangam | glued_genus_split | `Boerhaviadiffusa` | `Boerhavia diffusa` |
| sangam | glued_genus_split | `Zingiberofficinale` | `Zingiber officinale` |

## Enrichment delta (NEW botanicals -> Pass-2c)
| metric | value |
|---|--:|
| distinct new botanicals (unresolved) | **394** |
| with Latin binomial | 194 |
| common-only (need Latin) | 200 |

These feed a later GBIF (Pass-2c) -> backbone rebuild -> identity_version bump. NOT run here.

## Independent source families
6 NEW genuinely-independent private families ingested: `sf_aethon`, `sf_herbal_creative`, `sf_nita`, `sf_pending_01`, `sf_sangam`, `sf_vaishno`.
With the existing `sf_thewholesaler`, **7 independent source families** are now available for cross-source corroboration once Pass 3 is re-run against the enriched backbone.

## Honesty
- Supplier label ≠ physical fact · absence ≠ nonexistence · no prevalence/market-share language.
- Supplier identity + counts INTERNAL_ONLY. Raw catalogue files stay OFF-repo (gitignored, SHA-256).
- Frozen backbone not edited. Pass 3 not re-run yet (per scope).
