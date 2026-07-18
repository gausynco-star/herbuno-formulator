# Pass-3 Supplier Registry — INTERNAL ONLY (ADR-013)

> **INTERNAL.** Supplier identity, counts and provenance are internal. Storefront assets must
> strip all of this and expose only 'observed in reviewed sources'.

| supplier_id | entity | source_family | domain | region | public | snapshot | rows | with_type | processed | tax_rate | id_rate | in_graph | bias |
|---|---|---|---|---|---|---|--:|--:|--:|--:|--:|---|---|
| thewholesaler.eu | ent_thewholesaler | sf_thewholesaler | thewholesaler.eu | EU distributor (India-sourced) | True | 2026-06-13 | 29075 | 5006 | 3930 | 96% | 97% | yes | Ayurvedic/Indian botanical extracts & powders; e-commerce distributor. |
| medikonda.com | ent_medikonda | sf_medikonda | medikonda.com | US | True | 2026-07-17 | 2529 | 2505 | 1575 | 96% | 34% | **no** | US e-commerce; broad category vocabulary (Powders/Extracts/Oils); many finished-dosage & non-botanical SKUs. |
| bulknaturalswholesale.com | ent_bulknaturals | sf_bulknaturals | bulknaturalswholesale.com | US | True | 2026-07-17 | 3938 | 702 | 229 | 76% | 50% | **no** | US cosmetic-ingredient wholesaler; carrier oils/butters/actives/fragrance-heavy; few classical botanical forms. |
| hiyaindia.in | ent_hiyaindia | sf_hiyaindia | hiyaindia.in | India | True | 2026-07-15 | 2135 | 1186 | 579 | 100% | 64% | **no** | India e-commerce; fragrance/aroma-diffuser oil dominant; some water/oil-soluble extracts & carrier oils. |
| herbuno.own | ent_herbuno | sf_thewholesaler | herbuno.com | own (US body) | True | unknown (sanitized export) | 10443 | 1693 | 1693 | 100% | 70% | yes | Herbuno's OWN catalogue. Dual role: (a) taxonomy authority [handled by taxonomy asset], (b) ONE market observation source. Only real product rows count as observations. |

> **Source families:** `sf_thewholesaler` = {thewholesaler, Herbuno} — Herbuno's listings were
> catalogue-derived from thewholesaler, so their observations are CORRELATED (not independent
> evidence). Catalogue derivation, NOT supply dependency — Herbuno sources independently.

### sha256
- `thewholesaler.eu` — `00aeccfa879d07ce73174e1c0c73c7190ca649e14bd25e099469e69bead965e2` (allProducts[thewholesaler.eu]-2026-06-13T07-55-02.890Z.csv)
- `medikonda.com` — `bfe170fcbfa0051d9bb01fa94083a234b88bea0c335ecd48bf5ca1ef2900c5f1` (allProducts[www.medikonda.com]-2026-07-17T19-08-17.804Z.csv)
- `bulknaturalswholesale.com` — `14b4f3368a545bfc4d54fd2e63dae025d7ad3e57837522e70a97a9fe53df51ed` (allProducts[www.bulknaturalswholesale.com]-2026-07-17T19-07-07.210Z.csv)
- `hiyaindia.in` — `469d185bc420d4ce131bb050e58873bc9cecbc9f692fd9a4540f7bbabed37e2d` (allProducts[hiyaindia.in]-2026-07-15T12-40-42.056Z.csv)
- `herbuno.own` — `7215fb1dc6322af6e81660b683c111e0a2fba71fb894bdf2daa3c6864e16ef6b` (herbuno_US_body_sanitized_FINAL.csv)
