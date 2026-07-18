# Pass-2c Report — Backbone Enrichment Delta (ADR-013)

> Delta-only enrichment from INDEPENDENT-family suppliers (not thewholesaler/Herbuno). GBIF
> authority on the delta; same rules (accepted/synonym/typo/unknown, no silent correction).
> The frozen backbone was NOT edited in place — it was rebuilt with the delta merged and
> identity_version bumped.

## Sources
- Enrichment suppliers: medikonda.com, bulknaturalswholesale.com, hiyaindia.in
- Excluded (same catalogue family sf_thewholesaler): thewholesaler.eu, herbuno.own
- Named but absent on disk (not in registry): vedaoils, lotioncrafter
- All recorded supplier files verified present + SHA-256 unchanged before starting.

## Delta candidates (before GBIF)
| metric | value |
|---|--:|
| total distinct delta | 1323 |
| latin binomial candidates | 288 |
| common-only candidates | 1035 |

Per-supplier (rows contributing a delta candidate):
| supplier | latin | common_only |
|---|--:|--:|
| medikonda.com | 322 | 1055 |
| bulknaturalswholesale.com | 81 | 88 |
| hiyaindia.in | 0 | 492 |

## GBIF resolution split (the delta)
| status | count |
|---|--:|
| accepted | 18 |
| synonym | 1 |
| typo | 6 |
| unknown | 1298 |

- **Enrichment identities** (accepted + single-accepted synonym, deduped by accepted name): **19**
- Ambiguous synonyms -> review: 0 · typo flags -> review: 6 (NOT applied)
- Unknown -> quarantine (kept, not discarded): 1298
- **Note:** common-only candidates cannot be authority-checked by scientific-name match and
  land overwhelmingly in `unknown` — they need a Latin binomial before they can enrich. Kept.

## Backbone rebuild (no in-place edit)
| field | value |
|---|---|
| new identity_version | `2026-07-18.1` |
| identity records (was 564) | 583 |
| pass1 keys accounted | 641 |
| enrichment: new identities | 19 |
| enrichment: merged into existing | 0 |

Prior identity_version stays in git history (freeze policy: correct upstream -> rebuild -> bump version, never in-place). Downstream Pass-3 artifacts must re-join against the new version.
