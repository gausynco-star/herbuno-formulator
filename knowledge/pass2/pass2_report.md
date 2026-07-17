# Pass-2 Report — GBIF Authority Cross-Check (ADR-013)

> Identity verification only. Forms remain **UNVERIFIED** (single-supplier until Pass 3).

## Provenance
| field | value |
|---|---|
| authority | `GBIF backbone (species/match v1)` |
| query_date | `2026-07-18` |
| input | `knowledge/pass1/botanical_candidates.json` (641 keys) |
| secondary (manual) | POWO — recommended for flagged typo/unknown cases |

## Status counts (each binomial in exactly ONE bucket)
| status | count | % of 641 |
|---|---:|---:|
| **accepted** | 464 | 72.4% |
| **synonym** | 90 | 14.0% |
| **typo** | 23 | 3.6% |
| **unknown** | 64 | 10.0% |
| _(query errors, counted as unknown)_ | 0 | — |

## Identity-quality signal
**Cleanly resolved (accepted + synonym): 554 / 641 = 86.4%** of candidates map to a real accepted name.
- Of the 90 synonyms, **20 are AMBIGUOUS** (map to >1 accepted name) — owner must pick one; not silently resolved.
- Typos (23) are flagged with a suggested correction but **NOT applied**.
- Unknowns (64) are quarantined (kept, not discarded). These are overwhelmingly **not Latin binomials** — minerals (bentonite clay, sendha namak), Hindi/English common names (methi dana, butterfly pea), and `Genus spp` — i.e. Pass-1 false-positive keys now correctly caught.

## Spot samples
### Synonyms remapped (identity kept, accepted name recorded)
- `Abies webbiana` → **Abies spectabilis** (conf 98)
- `Abroma augusta` → **Abroma augustum** (conf 98)
- `Acacia arabica` → **Vachellia nilotica** (conf 98)
- `Acacia nilotica` → **Vachellia nilotica** (conf 97)
- `Actinidia deliciosa` → **Actinidia chinensis deliciosa** (conf 98)
- `Adhatoda vasica` → **Justicia adhatoda** (conf 98)
- `Alhagi camelorum` → **Alhagi maurorum** (conf 97)
- `Aloe barbadensis` → **Aloe vera** (conf 98)
- `Aloe indica` → **Aloe vera** (conf 98)
- `Amomum villosum` → **Wurfbainia villosa** (conf 98)
- `Argania spinosa` → **Sideroxylon spinosum** (conf 98)
- `Baliospermum montanum` → **Baliospermum solanifolium** (conf 98)

### Ambiguous synonyms (multiple accepted names — owner MUST pick, not auto-resolved)
- `Acacia catechu` → candidates: **Senegalia catechu**, **Senegalia chundra**, **Senegalia polyacantha**
- `Acacia concinna` → candidates: **Parasenegalia visco**, **Senegalia pennata**, **Senegalia rugata**
- `Allium porrum` → candidates: **Allium ampeloprasum**, **Allium obliquum**
- `Cassia absus` → candidates: **Chamaecrista absus**, **Senna insularis**
- `Cinnamomum cassia` → candidates: **Cinnamomum burmanni**, **Cinnamomum cassia**, **Neolitsea cassia**
- `Citrus limetta` → candidates: **Citrus medica**, **Citrus ×limon**
- `Dolichos biflorus` → candidates: **Macrotyloma axillare**, **Macrotyloma biflorum**
- `Garcinia cambogia` → candidates: **Garcinia cowa**, **Garcinia gummi-gutta**, **Garcinia hanburyi**
- `Holarrhena antidysenterica` → candidates: **Holarrhena pubescens**, **Wrightia antidysenterica**
- `Luffa cylindrica` → candidates: **Cucumis melo**, **Luffa aegyptiaca**

### Typos flagged (suggested correction — NOT applied)
- `Althea officianalis` → suggests **Althaea officinalis** (conf 80)
- `Astercantha longifolia` → suggests **Asteracantha longifolia** (conf 84)
- `Cedrus deodora` → suggests **Cedrus deodara** (conf 93)
- `Cinnamomum burmannii` → suggests **Cinnamomum burmanni** (conf 96)
- `Citrus aurantifolia` → suggests **Citrus aurantiifolia** (conf 96)
- `Clerodendrun serratum` → suggests **Clerodendrum serratum** (conf 80)
- `Crataeva nurvala` → suggests **Crateva nurvala** (conf 84)
- `Embelica officinalis` → suggests **Emblica officinalis** (conf 84)
- `Enicostemma littorale` → suggests **Enicostema littorale** (conf 84)
- `Hydnocarpus wightiana` → suggests **Hydnocarpus wightianus** (conf 96)
- `Lavendula stoechas` → suggests **Lavandula stoechas** (conf 85)
- `Malve sylvestris` → suggests **Malva sylvestris** (conf 85)

### Unknown / quarantined (kept for owner + POWO)
- `Abhrak bhasm` — no exact backbone name-usage; genuinely unresolved
- `Activated charcoal` — no exact backbone name-usage; genuinely unresolved
- `Akarkara irani` — no exact backbone name-usage; genuinely unresolved
- `Anantmool madrasi` — no exact backbone name-usage; genuinely unresolved
- `Anthem graveolens` — no exact backbone name-usage; genuinely unresolved
- `Arjuna chaal` — no exact backbone name-usage; genuinely unresolved
- `Asphaltum punjabianum` — no exact backbone name-usage; genuinely unresolved
- `Bentonite clay` — no exact backbone name-usage; genuinely unresolved
- `Ber patthar` — no exact backbone name-usage; genuinely unresolved
- `Bitter gourd` — no exact backbone name-usage; genuinely unresolved
- `Blue cornflower` — no exact backbone name-usage; genuinely unresolved
- `Bura armani` — no exact backbone name-usage; genuinely unresolved

## Cross-validation with Pass 1
- Pass-1 near-duplicate flag `Ricinus communes` → GBIF **typo** → suggests Ricinus communis — confirms the Pass-1 typo detector.

## Next
Owner reviews `pass2_review_queue.json` (synonym remaps + typo flags). No name is corrected
without sign-off. Pass 3 (multi-supplier consensus) and form verification are separate.
