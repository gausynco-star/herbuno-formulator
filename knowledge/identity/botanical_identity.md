# Frozen Identity Backbone — ADR-013 (Pass-3 join target)

> **🔒 FROZEN — identity_version `2026-07-19.4`, schema v2.** Do NOT edit `botanical_identity.json` in
> place once Pass 3 has started. Corrections: fix upstream in the applicable Pass-2 source (pass2, pass2b, pass2c, or pass2d) → rebuild → bump identity_version.
> Every downstream (Pass 3+) artifact must record the identity_version it built against. See README.md.

> One record per resolved botanical identity. Pass 3 joins supplier/form data via
> `original_parsed_names`. `accepted_name` authoritative; owner sign-off overrides GBIF where set.

## Totals
| metric | value |
|---|---:|
| identity records | **826** |
| excluded (non_botanical + unresolvable) | 28 |
| Pass-1 keys accounted for | 641 / 641 |
| trinomials (infraspecific) | 15 |

## Records by resolution_status
| status | count |
|---|---:|
| accepted | 461 |
| owner-common-mapped | 222 |
| synonym-resolved | 65 |
| delta-accepted | 39 |
| typo-corrected | 13 |
| owner-resolved | 11 |
| delta-synonym-resolved | 6 |
| genus_level | 4 |
| trade_ambiguous | 4 |
| species_ambiguous | 1 |

## Trinomials parsed (accepted_name → rank · infraspecific epithet)
| accepted_name | rank | infraspecific |
|---|---|---|
| `Actinidia chinensis deliciosa` | VARIETY | deliciosa |
| `Betula pubescens pubescens` | SUBSPECIES | pubescens |
| `Celosia argentea cristata` | FORM | cristata |
| `Ceropegia adscendens fimbriata` | VARIETY | fimbriata |
| `Crambe hispanica abyssinica` | SUBSPECIES | abyssinica |
| `Diplocyclos palmatus palmatus` | SUBSPECIES | palmatus |
| `Echinochloa crus-galli utilis` | SUBSPECIES | utilis |
| `Enicostema axillare littorale` | SUBSPECIES | littorale |
| `Frangula alnus alnus` | SUBSPECIES | alnus |
| `Leuzea carthamoides carthamoides` | SUBSPECIES | carthamoides |
| `Madhuca longifolia latifolia` | VARIETY | latifolia |
| `Orthosiphon aristatus aristatus` | VARIETY | aristatus |
| `Roscoea purpurea purpurea` | FORM | purpurea |
| `Trapa natans bispinosa` | VARIETY | bispinosa |
| `Trigonella glabra uncata` | SUBSPECIES | uncata |

## Excluded (28)
non_botanical 18 · unresolvable 10 — see excluded.json.
