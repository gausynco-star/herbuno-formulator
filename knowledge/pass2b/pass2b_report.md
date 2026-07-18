# Pass-2b Report — GBIF Authority Re-check on Owner-Resolved Names (ADR-013)

> Re-checks names the owner supplied (outside GBIF's own candidate list) against GBIF as-is.
> No silent correction — disagreements are flagged; the owner sign-off remains authoritative.

## Provenance
| field | value |
|---|---|
| authority | `GBIF backbone (species/match v1)` |
| query_date | `2026-07-18` |
| scope | 55 owner-supplied names |

## Counts
| status | count | pct |
|---|---:|---:|
| **confirmed** | 43 | 78% |
| **synonym** | 12 | 22% |
| **not_found** | 0 | 0% |

## Disagreements — GBIF ≠ owner decision (12) — the point of this pass
| owner name | GBIF says | source |
|---|---|---|
| `Asteracantha longifolia` | synonym → **Hygrophila auriculata** | typo_flags |
| `Celosia cristata` | synonym → **Celosia argentea cristata** | unknown_quarantine |
| `Crateva nurvala` | synonym → **Crateva magna** | typo_flags |
| `Emblica officinalis` | synonym → **Phyllanthus emblica** | typo_flags |
| `Enicostema littorale` | synonym → **Enicostema axillare littorale** | typo_flags |
| `Hydnocarpus wightianus` | synonym → **Hydnocarpus pentandrus** | typo_flags |
| `Iris germanica var. florentina` | synonym → **Iris florentina** | unknown_quarantine |
| `Mammea longifolia` | synonym → **Mammea suriga** | unknown_quarantine |
| `Onosma bracteata` | synonym → **Maharanga bracteata** | typo_flags |
| `Roscoea procera` | synonym → **Roscoea purpurea purpurea** | typo_flags |
| `Valeriana wallichii` | synonym → **Valeriana jatamansi** | typo_flags |
| `Ziziphus sativa` | synonym → **Ziziphus jujuba** | typo_flags |

## Action
Owner reviews the disagreement list. Synonyms may warrant switching the accepted name to
GBIF's; not_found names may be valid trade/pharmacopoeial names GBIF lacks — keep with a
note. No change is made automatically. Pass-2b writes a `gbif_recheck` field alongside each
sign-off in pass2_review_queue.json; the sign-off itself is unchanged.
