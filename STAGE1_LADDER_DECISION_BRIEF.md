# Stage-1 Ladder — Best-Fit Ordering Decision Brief

**Purpose.** The Stage-1 format ladders (ADR-006) need an explicit order within each tier. For 65 of
71 `Product × Role` rows the order is unambiguous (one `ok` format, or no dispute). For **11 rows**
the proposed order changes which format displays as **best-fit** versus the old arbitrary
JavaScript object order. Those 11 are below, grouped into 5 real decisions.

**How to use this file.** Reviewer (ChatGPT) evaluates each decision against
`FORMULATOR_SPECIFICATION.md` §7 and the ADRs, agrees or proposes a different order. Owner signs
off. Then the agreed order is baked into `javascript/herbuno-matrix.js` via `preferred_formats`
arrays (add-only, parity guard per ADR-009). Nothing changes tiers — only the **order** within the
`ok` tier, and only the displayed best-fit.

Legend: **SE** standardised extract · **WL** water-soluble (liquid) extract · **OE** oil-soluble
extract · **RE** full-spectrum extract powder · **SD** spray-dried powder · **MP** milled powder ·
**CO** carrier oil.

---

## Decision 1 — Aqueous actives: WL vs SE as best-fit  *(6 rows)*

**Rows:** rtd-clear · rtd-cloudy · drops-aq · syrup · spray · serum — all `active`.
**Old best-fit:** SE. **Proposed best-fit:** WL. (Ladder: WL → SE.)

**Proposed rationale.** For an aqueous or liquid product, a **water-soluble liquid extract is the
most direct phase-match** — it goes straight into solution with no dissolution risk. **SE
(standardised) is an overlay**, not a delivery form: a "standardised extract" still has to be
water-soluble to work in a clear drink, so standardisation is a *spec attribute layered on top of*
a behaviour, not the behaviour itself. Hence phase-match (WL) leads; SE is the premium variant when
a defined marker/label-claim figure is required.

**Counter-argument to weigh.** Herbuno's B2B buyers frequently want a **quantified active-constituent
figure** (assay), which only a standardised grade supports. If "precision first" better matches how
buyers actually choose, SE should lead and WL follow.

**Confidence:** LOW — this is the closest call and drives 6 of the 11 rows. The single most important
one to get right.

**Proposed:** `WL → SE`  ·  **Reviewer verdict:** ______  ·  **Owner sign-off:** ______

---

## Decision 2 — Aroma roll-on active: OE vs CO  *(1 row)*

**Row:** aroma-roll · `active`. **Old:** CO. **Proposed:** OE. (Ladder: OE → CO.)

**Proposed rationale.** In an oil roll-on, the **active** should be the **oil-soluble extract (OE)**
— it is the functional ingredient, fully compatible with the oil vehicle. **CO (carrier oil) is the
base/vehicle, not an active** (ADR-002: base is a distinct class). Surfacing CO as the best-fit for
the active role confuses the vehicle with the active.

**Confidence:** HIGH — CO as best-fit for an active role looks like a role-class leak.

**Proposed:** `OE → CO`  ·  **Reviewer verdict:** ______  ·  **Owner sign-off:** ______

---

## Decision 3 — Dry powder mask active: RE vs MP  *(1 row)*

**Row:** mask-dry · `active`. **Old:** MP. **Proposed:** RE. (Ladder: RE → SD → MP.)

**Proposed rationale.** For an active in a dry powder mask blend, a **full-spectrum extract (RE)** is
the more concentrated, more appropriate active than a plain **milled botanical (MP)**, which is bulk
material. Dry format suits both, so the tie-break favours the extract for an *active* role.

**Confidence:** MEDIUM — defensible, but if the mask's actives are traditionally whole-botanical
(clay + herb powder), MP-first could be argued.

**Proposed:** `RE → SD → MP`  ·  **Reviewer verdict:** ______  ·  **Owner sign-off:** ______

---

## Decision 4 — Savoury flavour & colour: MP vs OE  *(2 rows)*

**Rows:** savoury · `flavour` and savoury · `colour`. **Old:** OE. **Proposed:** MP. (Ladder: MP → OE.)

**Proposed rationale.** A dry savoury seasoning is a **dry matrix**; a **milled botanical (MP)** is
the natural dry flavour/colour carrier that blends in without a fat phase. **OE (oil-soluble
extract) is a liquid** needing an oil/fat phase to distribute. So MP leads for a dry seasoning.

**Note.** These are pre-existing signed-off flavour/colour cells; per ADR-002 flavour/colour are
ingredient identities, so treat "best-fit" here as softer guidance, not a hard recommendation.

**Confidence:** MEDIUM-HIGH for a *dry* seasoning.

**Proposed:** `MP → OE`  ·  **Reviewer verdict:** ______  ·  **Owner sign-off:** ______

---

## Decision 5 — Lozenge flavour: SD vs MP  *(1 row)*

**Row:** lozenge-c · `flavour`. **Old:** MP. **Proposed:** SD. (Ladder: SD → MP.)

**Proposed rationale.** Spray-dried powders are a standard **dry flavour carrier** for compressed
lozenges — even distribution, controlled load. MP (milled) is coarser and can read gritty in a
mouthfeel-sensitive format.

**Caveat (ADR-003).** SD does not imply solubility; here it's used as a dry flavour carrier, not for
dissolution, so the ADR-003 concern doesn't apply — but the mouthfeel/grit caveat still holds for
both SD and MP.

**Confidence:** MEDIUM.

**Proposed:** `SD → MP`  ·  **Reviewer verdict:** ______  ·  **Owner sign-off:** ______

---

## Summary table

| # | Product · Role | Old best-fit | Proposed best-fit | Confidence |
|---|----------------|--------------|-------------------|------------|
| 1 | rtd-clear / rtd-cloudy / drops-aq / syrup / spray / serum · active | SE | **WL** | LOW (key) |
| 2 | aroma-roll · active | CO | **OE** | HIGH |
| 3 | mask-dry · active | MP | **RE** | MEDIUM |
| 4 | savoury · flavour & colour | OE | **MP** | MED-HIGH |
| 5 | lozenge-c · flavour | MP | **SD** | MEDIUM |

The other 60 catalogue roles are unaffected (single `ok` format or no order dispute). Full 71-row
ladder: `matrix/Stage1_Format_Ladder_AUDIT.xlsx`.
