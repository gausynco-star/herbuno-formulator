# Herbuno Formulator — Specification (the project constitution)

**Status:** living document. If code, a spreadsheet, or a decision record disagrees with this
file, this file is the intent — reconcile them, don't silently diverge. Every `.js`, `.liquid`,
`.csv`, and `.xlsx` in the project *implements* this spec.

**One-line definition:** a catalogue-independent botanical **ingredient-format compatibility
engine** with an integrated Herbuno **sourcing assistant**.

---

## 0. Scope guardrail — what this is NOT

The Formulator answers *"for this finished product and this ingredient role, what commercial
ingredient **format** is technically appropriate?"* It does **not** do, and must never drift into:

- dosing or dose optimisation
- efficacy / health-benefit prediction
- finished-formulation design (full recipes, percentages as advice)
- regulatory formulation or clinical optimisation

Suggesting *which botanicals suit a role's format* (Stage-1 Path B) is in scope. Recommending how
much to use, or what it does to the body, is not. Competitive advantage = physical-form
intelligence + sourcing, not replacing formulation software.

---

## 1. Two-stage architecture

### Stage 1 — Formulation engine (catalogue-independent)
Reasoning only. Never filtered by what Herbuno stocks. Output = an ordered **format ladder** for a
`Product × Role`, plus technical notes. The recommendation is always the *technically preferred
commercial form*, not the best Herbuno SKU.

Two entry paths:
- **Path A — "I know the ingredient":** user types any botanical (free text, not a catalogue
  search) → sees the ladder → selects an intended commercial form.
- **Path B — "Show ingredient ideas":** user knows the function, not the botanical → the tool
  suggests botanicals appropriate to that `Product × Role` (from **Layer 1**, curated formulation
  knowledge, NOT the catalogue) → user picks one → same ladder runs.

### Stage 2 — Fulfilment engine (catalogue-aware)
Only after Stage 1 fixes the intended `(botanical, format)` does the catalogue get searched.
Outcomes:
1. **Exact match** — same botanical, same required format → offer Add to Cart.
2. **Compatible alternative** — same botanical, a different but still best-fit format → offer.
3. **Conditional alternative** — same botanical, only a "possible with compromise" format →
   explain the compromise.
4. **No suitable stock** — nothing matches → "Ask Herbuno to source this specification."

**Inventory must never influence a Stage-1 recommendation.**

### Three knowledge layers
| Layer | Question | Source | Status |
|------|----------|--------|--------|
| 1 | What botanicals are used for this role? | Curated formulation knowledge (not catalogue) | **To build** (V1 curated per role) |
| 2 | What commercial form should it take? | The `Product × Role` matrix | **Built** (this spec + `herbuno-matrix.js`) |
| 3 | Do we stock it in that form? | Catalogue lookup | **Exists** (repurpose current search as Stage 2) |

---

## 2. Role definitions (Gate-1 classes)

| Role | Accepts | Extract formats? |
|------|---------|------------------|
| **active** | active botanical formats | yes, by default |
| **base** | the principal vehicle/bulk matrix for that product (carrier oil, dry bulk/carrier, syrup/gel matrix, excipient/fill, cut botanical) | no — extracts are actives, not the base |
| **functional** | fibre / bulk class | no |
| **flavour** | an actual flavour/aroma ingredient identity | no — aroma ≠ a usable flavour by phase alone |
| **colour** | an actual colourant identity | no |

"BASE = carrier oil only" is **wrong** as a universal rule — base is product-specific. Wrong-class
combinations → Not evaluated / guidance, never tiered by phase.

---

## 3. Format codes

Commercial ingredient forms (not SKUs). Catalogue `Type` is the canonical format signal; these
codes are the tool's internal handles.

| Code | Form | Core physical behaviour |
|------|------|--------------------------|
| **SE** | Standardised extract | overlay: "standardised + <behaviour>"; never stands alone as a behaviour |
| **WL** | Water-soluble extract | water-soluble **liquid** |
| **OE** | Oil-soluble extract | oil-soluble **liquid/paste** |
| **RE** | Botanical extract powder | dry, full-spectrum, **solubility unknown from Type**, water-favouring |
| **SD** | Spray-dried powder | dry, spray-dried; **water-dispersibility is SKU-dependent, not proven by Type** |
| **MP** | Dehydrated / milled powder | dry milled botanical |
| **CO** | Carrier oil | oil vehicle/base |
| **TC** | Tea & infusion cut | classical cut botanical |
| **WD** | Whole herb & spice | coarse/whole |
| **IC** | Nutraceutical active (isolate) | routes to application review (§6) |
| **LP** | Liposomal ingredient | routes to application review (§6) |

Naming rule: the SD label is **"Spray-dried powder"** — never "spray-dried *soluble* powder"
unless a SKU-level grade proves tested solubility.

---

## 4. Five-gate logic (the `classify()` architecture)

Applied in order; first match wins. Role class and manufacturing route are checked **before**
phase physics — that ordering is the whole point.

1. **Gate 1 — Role-class eligibility.** Wrong class → Not evaluated / guidance. (See §2.)
2. **Gate 2 — Product route override.** Classical/special routes apply their own rule before
   generic physics (see §5).
3. **Gate 3 — Required behaviour.** must-dissolve / may-disperse / need-not-dissolve; vehicle
   polarity (aqueous / oil / dry).
4. **Gate 4 — Does `Type` prove the behaviour?**
   - **SD does NOT prove solubility.**
   - **RE does NOT prove dispersibility.**
   - OE establishes oil compatibility (but not role identity).
   - WL proves a water-compatible liquid (but is wrong for dry products).
5. **Gate 5 — SKU evidence.** Where `Type` is insufficient → **Not evaluated pending
   `formulation.physical_behaviour`.**

**Tiers:** `Recommended` (ok) · `Acceptable with caveat` (warn) · `Usually unsuitable` (avoid) ·
`Not evaluated` (grey). Coverage % is **not** a target — trustworthy verdicts are.

---

## 5. Exception / classical routes (Gate 2)

| Route | Products | Rule |
|-------|----------|------|
| **Classical churna** | churna | base RE/SD → Avoid (classical default); active RE/SD → Acceptable-caveat (fortified/non-classical); WL/OE → Avoid (moisture/oil in a dry powder) |
| **Classical taila** | taila | premade extracts → Avoid **as a non-classical/process call** (decoction/kalka uses cut/milled botanical), **not** on oil-solubility grounds; base = carrier oil |
| **Tea / Kashaya** | tea, kashaya | cut botanical is the classical form; premade extracts → Avoid as classical default |
| **Direct compression** | tablet-dc | liquid (WL/OE) → Avoid; SD → Acceptable-caveat (variable compressibility) |
| **Wet granulation** | tablet-wg | WL → Acceptable-caveat (via granulation fluid); OE → Avoid; SD → Acceptable-caveat |
| **Oral spray** | spray | must pass the nozzle fully in solution; generic RE/SD → Not evaluated; OE → Avoid |
| **Effervescent** | effervescent | moisture-critical; WL/OE → Avoid; SD → Acceptable-caveat (hygroscopicity, low-moisture grade) |
| **Gummy / chewable** | gummy | wet, heated, pH-shifted slurry; RE/WL/SD → Acceptable-caveat (confirm dispersion & heat/pH) |
| **Softgel** | softgel | oil fill; RE/SD → Acceptable-caveat **only** where particle size, sedimentation, fill viscosity and dose uniformity are validated |
| **Balm** | balm | need-not-dissolve wax/oil matrix; a fine hydrophilic powder may be a **validated suspension** → RE/SD Acceptable-caveat (grit/uniformity/release caveats); coarse/settling → Avoid; WL → Avoid |

Related generic rulings: a neat oily extract in a dry format → Avoid, but acknowledge dry
adsorbed/encapsulated grades exist (usually a different `Type`). Oil-soluble into a wet base →
needs emulsion/biphasic; unsuitable for a single clear aqueous phase.

---

## 6. The Acai rule & the SKU-behaviour layer

A clean `Type` cannot tell you whether *this specific* Botanical Extract Powder (RE) or spray-dried
powder (SD) is water-soluble. So into a **clear aqueous** product (clear RTD, clear serum, oral
spray, uniform syrup), generic RE/SD stays **Not evaluated** pending SKU evidence — not guessed
green.

Future per-SKU metafield **`formulation.physical_behaviour`** resolves these, values:
`Water-soluble` · `Water-dispersible` · `Oil-soluble` · `Oil-dispersible` · `Suspension-compatible`
· `Not evaluated`. This field *refines* the broad `Type`-level ladder; it does not replace it. Do
**not** create a duplicate format-code metafield — `Type` already carries the format.

**IC / LP (Option A):** isolates and liposomals cannot carry one universal tier (suitability
depends on solubility, dose, physical grade). They route to **"application review / ask us"**, never
a fabricated compatibility tier.

---

## 7. Best-fit vs Selected vs Recommendation

- **Best-fit format** = the `ok` tier **only**, taken from an explicit **ordered
  `preferred_formats` array** — never JavaScript object-key order, never a `warn`/`avoid` format
  dressed up as "required."
- **preferred_formats / conditional_formats / unsuitable_formats** = the ordered ladder per
  `Product × Role`. Order is formulation judgment (owner-signed-off).
- **Selected format** = what the user actually chose (shown separately from the recommendation).
- If no `ok` exists → show the labelled compromise ("no single best fit · possible: X") or "no
  catalogue best fit — see options." Never a bare conditional presented as the answer.

---

## 8. Data model (`herbuno-matrix.js`)

```
window.HB_MX = {
  code_names: { SE:"Standardised extract", WL:"Water-soluble extract", SD:"Spray-dried powder", ... },
  fam: [ { name, products: [ {
    id, name, tag, tag_label,
    roles: {
      <role_id>: {
        rec, acc, avoid, reason, qual,      // v5 prose
        na, routing,                        // routing ∈ {catalogue, ask_us, guidance_only,
                                            //            no_code_application_dependent, na}
        fmt: { <code>: { tier, class, behaviour, overlay, note } },   // ok|warn|avoid only
        preferred_formats: [...], conditional_formats: [...], unsuitable_formats: [...]  // ordered
      }
    }
  } ] } ]
}
```
Not-evaluated cells are simply **absent** from `fmt` (render as neutral grey). `IC`/`LP` codes are
never mapped — the tool special-cases them to the review state.

---

## 9. UI behaviour

- **Dual mode:** "Check one ingredient" (quick) and "Build a complete blend" (build), shared state
  and shared result renderer.
- Result shows **Best fit / Possible / Usually unsuitable** bands with format chips and the caveat
  notes; picked SKU shows a compatibility icon (✓ / ⚠ / ⛔) and its **selected format**.
- **IC/LP** picks render a ⚙ "application review needed" state with an Ask-a-specialist button, and
  are excluded from costing and cart.
- Dropdown groups strictly by tier order: best-fit → possible → not-evaluated → unsuitable.
- **Privacy:** buyer formulations are fragment-encoded for sharing (`#f=`) and never posted to
  server logs. RFQ posts to the contact form only.

---

## 10. Deploy model

- Deployables are Shopify **theme assets**: `herbuno-matrix.js`, `blend-builder.js`,
  `blend-builder.css`, `blend-builder-shell.liquid`. Normal deploy set = the first two.
- Assets are not size-capped (matrix ≈100 KB is fine); Shopify **sections** cap ≈50 KB — hence the
  asset-split + thin shell (load order: css → matrix → container → js).
- After upload, **hard-refresh** to clear the CDN.

---

## 11. Regression / validation checklist (before any handover or deploy)

- [ ] `node --check herbuno-matrix.js` and `node --check blend-builder.js` pass.
- [ ] Dry-run harness: both modes × all products → **0 runtime errors**.
- [ ] **Parity guard:** matrix edits ADD only; every pre-existing `fmt` cell byte-identical;
      0 signed-off overrides, 0 parity violations.
- [ ] Calibration anchors intact — RE: capsule=Recommended, gummy=Acceptable-caveat,
      clear-RTD=Not-evaluated, face-oil=Avoid, tea=Avoid.
- [ ] Applied tiers still render (capsule RE ✓, gummy RE ⚠, face-oil RE ⛔, churna active SD ⚠,
      churna base RE ⛔); IC/LP = review; SD label = "Spray-dried powder".
- [ ] Best-fit shows only an `ok` tier; no conditional/avoid surfaced as "required".
- **Caveat:** the dry-run proves code doesn't crash and tiers resolve against real matrix data — it
  does **not** prove live Shopify behaviour. Dev-theme test before production (real `/products.json`,
  IC/LP render, RFQ delivery, cart adds).

---

## 12. Privacy & IP rule

No live buyer formulation data, supplier identities, pricing logic, or commercial terms in any
committed file or public artifact. Everything published must be derivable from **physics or trade
convention only**.

---

## 13. Known limitations

- 121 `Product × Role × format` cells are deliberately **Not evaluated**, pending
  `formulation.physical_behaviour` (the Acai cases, clear-system RE/SD, pet ambiguity).
- The format ladder is keyed on `Product × Role`, **not** on the botanical (V1 simplification).
- **Layer 1** (botanical suggestions) is not built yet.
- Stage-1 / Stage-2 as a two-screen UX is designed but not yet implemented; the current tool is the
  single-stage predecessor.
- Dry-run ≠ live Shopify (see §11).

---

## 14. Open decisions (pending owner sign-off)

1. **11 ladder rows** where the proposed best-fit order changes the displayed recommendation
   (see `docs/decision-records/Stage1_Format_Ladder_AUDIT.xlsx`).
2. `tablet-dc | functional | MP`: Avoid → Acceptable-with-caveat for a validated fibre-rich milled
   botanical (existing signed-off cell; not yet changed).
3. `pet`: rename to a precise dry dosage form (rank normally) vs keep routed to application review.
4. **Layer 1** curation granularity: per-role (recommended for V1) vs per-`Product × Role`.
5. Build order for the Stage-1/Stage-2 UX split.

---

## 15. Decision-record index

Authoritative artifacts live in `docs/decision-records/`:
- `FORMULATOR_decision_table_v5.xlsx` — the v5 decision table.
- `OptionB_v3_FINAL_approved.xlsx` — approved format-coverage expansion (five-gate).
- `Stage1_Format_Ladder_AUDIT.xlsx` — ordered ladders (order pending sign-off).
- `format_mapping_v2.csv` — format-code mapping.
- `herbuno-matrix_PARITY_REPORT.md` — parity report for the last matrix apply.
