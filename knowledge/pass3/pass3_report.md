# Pass-3 Report — Observed Commercial-Form Discovery (ADR-013)

> Form DISCOVERY, not a market survey. No prevalence/availability language. Built against
> identity_version `2026-07-19.4`. Supplier detail is INTERNAL (see supplier_registry.md).

## Per-supplier
| supplier | rows | with_type | mapped | in-scope gap | out-of-scope | resolved | id_rate | tax_rate | gate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| thewholesaler.eu | 29075 | 5006 | 3930 | 144 | 932 | 3854 | 98% | 96% | PASS |
| medikonda.com | 2529 | 2505 | 1575 | 62 | 868 | 1198 | 76% | 96% | PASS |
| bulknaturalswholesale.com | 3938 | 702 | 229 | 74 | 399 | 176 | 77% | 76% | FLAGGED |
| hiyaindia.in | 2135 | 1186 | 579 | 0 | 607 | 545 | 94% | 100% | PASS |
| herbuno.own | 10443 | 1693 | 1693 | 0 | 0 | 1257 | 74% | 100% | PASS |

### match methods (contributing suppliers)
- **thewholesaler.eu**: accepted_name_exact=3210, ambiguous_exact=1, common_name_exact_unique=38, original_parsed_name_exact=606, unresolved=75
- **medikonda.com**: accepted_name_exact=45, ambiguous_exact=10, common_name_exact_unique=1147, original_parsed_name_exact=6, unresolved=367
- **hiyaindia.in**: accepted_name_exact=8, ambiguous_exact=18, common_name_exact_unique=537, unresolved=16
- **herbuno.own**: accepted_name_exact=900, ambiguous_exact=7, common_name_exact_unique=203, original_parsed_name_exact=152, trade_synonym_exact=2, unresolved=429

## Global (observed only — NO observed-vs-not tally)
| metric | value |
|---|--:|
| entities contributing | 4 |
| **independent source families contributing** | **3** |
| identities observed | 807 |
| identities observed by ≥2 entities | 457 |
| **identities observed by ≥2 INDEPENDENT source families** | **337** |
| botanical × part × form combinations observed | 4426 |
| duplicates collapsed (entity×id×part×form) | 1107 |
| review-queue entries (ambiguous + disagreements) | 87 |
| unresolved supplier rows (kept) | 938 |

## Source-family correlation (independence caveat)
thewholesaler and Herbuno share source family `sf_thewholesaler`: **Herbuno's product
listings were substantially catalogue-derived from thewholesaler**, so their form
observations are **correlated, not independent evidence**. This is **catalogue derivation,
NOT supply dependency** — Herbuno sources independently from its own suppliers. Judge
corroboration by `independent_source_family_count`, never by entity count.
With the current basket, only **3 independent source family** contributes to the graph, so **337 identities are corroborated across ≥2 independent families** — the entity-level figure (457) overstates corroboration.

## Quality gate
Threshold: identity resolution >=70% AND taxonomy mapping >=80%. Flagged (excluded from graph, committed as incomplete ingestion): bulknaturalswholesale.com.

## Basket-skew limitation (stated, not hidden)
The reviewed basket is **e-commerce-heavy**: Ayurvedic/Indian distributors + US cosmetic-
ingredient and fragrance shops. It is **light on bulk manufacturers** (India/China) and EU
distributors, and **private catalogues are inaccessible**. Non-observation therefore never
implies unavailability — it means *not seen in these sources*. Observation counts are a floor.

## Honesty
- Supplier label ≠ physical fact: outputs state only that a supplier *offers* a form under a
  stated label; no behaviour/solubility is asserted.
- No prevalence, market-share or rarity language anywhere.
- The frozen identity backbone was not modified.
