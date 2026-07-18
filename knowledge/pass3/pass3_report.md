# Pass-3 Report — Observed Commercial-Form Discovery (ADR-013)

> Form DISCOVERY, not a market survey. No prevalence/availability language. Built against
> identity_version `2026-07-18`. Supplier detail is INTERNAL (see supplier_registry.md).

## Per-supplier
| supplier | rows | with_type | mapped | in-scope gap | out-of-scope | resolved | id_rate | tax_rate | gate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| thewholesaler.eu | 29075 | 5006 | 3930 | 144 | 932 | 3828 | 97% | 96% | PASS |
| medikonda.com | 2529 | 2505 | 1575 | 62 | 868 | 541 | 34% | 96% | FLAGGED |
| bulknaturalswholesale.com | 3938 | 702 | 229 | 74 | 399 | 115 | 50% | 76% | FLAGGED |
| hiyaindia.in | 2135 | 1186 | 579 | 0 | 607 | 372 | 64% | 100% | FLAGGED |
| herbuno.own | 10443 | 1693 | 1693 | 0 | 0 | 1186 | 70% | 100% | PASS |

### match methods (contributing suppliers)
- **thewholesaler.eu**: accepted_name_exact=3232, ambiguous_exact=5, common_name_exact_unique=12, original_parsed_name_exact=584, unresolved=97
- **herbuno.own**: accepted_name_exact=884, ambiguous_exact=7, common_name_exact_unique=156, original_parsed_name_exact=144, trade_synonym_exact=2, unresolved=500

## Global (observed only — NO observed-vs-not tally)
| metric | value |
|---|--:|
| entities contributing | 2 |
| **independent source families contributing** | **1** |
| identities observed | 561 |
| identities observed by ≥2 entities | 391 |
| **identities observed by ≥2 INDEPENDENT source families** | **0** |
| botanical × part × form combinations observed | 3636 |
| duplicates collapsed (entity×id×part×form) | 509 |
| review-queue entries (ambiguous + disagreements) | 101 |
| unresolved supplier rows (kept) | 1906 |

## Source-family correlation (independence caveat)
thewholesaler and Herbuno share source family `sf_thewholesaler`: **Herbuno's product
listings were substantially catalogue-derived from thewholesaler**, so their form
observations are **correlated, not independent evidence**. This is **catalogue derivation,
NOT supply dependency** — Herbuno sources independently from its own suppliers. Judge
corroboration by `independent_source_family_count`, never by entity count.
With the current basket, only **1 independent source family** contributes to the graph, so **0 identities are corroborated across ≥2 independent families** — the entity-level figure (391) overstates corroboration.

## Quality gate
Threshold: identity resolution >=70% AND taxonomy mapping >=80%. Flagged (excluded from graph, committed as incomplete ingestion): medikonda.com, bulknaturalswholesale.com, hiyaindia.in.

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
