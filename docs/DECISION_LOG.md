# Decision Log

Architecture Decision Records for the Herbuno Formulator. Each entry states the **decision**, the
**context** that forced it, and the **consequence** to protect. Newest at the bottom. When you're
tempted to change a rule, read the ADR that set it first — most "improvements" are old assumptions
creeping back.

Format: `ADR-NNN — Title` · Status · Date.

---

## ADR-001 — Separate Stage 1 (formulation) from Stage 2 (fulfilment)
**Accepted · 2026-07**

**Context.** The tool was inventory-first: every ingredient search hit the Herbuno catalogue, so
the formulation advice was distorted by what happened to be in stock. This produced "not evaluated"
results for products we actually sell, a thin-looking catalogue, and constant tension between the
signed-off decision table and catalogue format codes.

**Decision.** Split the tool. **Stage 1** answers the pure formulation question ("for this product
and role, what commercial format is appropriate?") with **zero** dependence on inventory. **Stage
2** takes Stage 1's intended `(botanical, format)` and *then* checks the catalogue for match /
alternative / sourcing.

**Consequence to protect.** Inventory must never influence a Stage-1 recommendation. The
recommendation is the technically preferred commercial form, not the best Herbuno SKU. The
compatibility engine reasons about *formats*, not SKUs, so it is already catalogue-independent — do
not re-couple it.

---

## ADR-002 — Role class is checked before phase physics (the five gates)
**Accepted · 2026-07**

**Context.** Early rule engines tiered a format by its physical phase (dry+dry = fine, oil+oil =
fine) *before* checking whether the format was even the right ingredient class for the role. This
filled BASE roles with actives, tiered flavours by phase, and treated spray-dried as proof of
solubility.

**Decision.** Mandatory gate order: (1) role-class eligibility → (2) product route override → (3)
required behaviour → (4) does `Type` prove it → (5) SKU evidence. First match wins.

**Consequence to protect.** A rule must never fire on phase alone. BASE takes the product's
vehicle/bulk; FUNCTIONAL takes fibre/bulk; FLAVOUR/COLOUR are ingredient identities, not phases;
only ACTIVE takes an extract by default. Wrong class → Not evaluated / guidance.

---

## ADR-003 — Spray-dried (SD) does not imply solubility
**Accepted · 2026-07**

**Context.** The label "spray-dried soluble powder" and rules like "SD disperses cleanly" quietly
asserted that any spray-dried powder is water-soluble/dispersible. It isn't — dispersion, sediment,
clarity and carrier load are all SKU-dependent.

**Decision.** SD proves only that a powder was spray-dried. Renamed to **"Spray-dried powder."** For
disperse-tolerant systems SD is Acceptable-with-caveat (confirm dispersion per SKU); for systems
requiring complete dissolution (clear RTD, serum, oral spray, uniform syrup) generic SD is **Not
evaluated** pending SKU evidence.

**Consequence to protect.** Never restore a "free-flowing / water-dispersible by design" claim.
Symmetrically, **RE does not prove dispersibility.**

---

## ADR-004 — Classical Churna is distinct from a modern fortified powder
**Accepted · 2026-07**

**Context.** A churna's classical form is a milled whole botanical. Treating it as a generic dry
powder would let concentrated extracts sit in the base as if they were traditional.

**Decision.** Churna **base** RE/SD → Avoid (classical default). Churna **active** RE/SD →
Acceptable-with-caveat, explicitly framed as *fortified / non-classical*. Liquid extracts (WL/OE) →
Avoid (they add moisture/oil to a dry classical powder).

**Consequence to protect.** The classical vs fortified distinction is the point — don't collapse
churna into "dry powder = anything dry is fine."

---

## ADR-005 — Taila follows classical process logic, not face-oil physics
**Accepted · 2026-07**

**Context.** A rule engine marked premade extracts unsuitable in taila "because they won't dissolve
in oil" — importing face-oil (finished oil solution) physics. But classical taila transfers
constituents through the decoction and kalka stages using cut/milled botanical; the starting
material never has to dissolve in the finished oil.

**Decision.** In taila, premade extract formats are Avoid **as a non-classical / process-dependent
call**, citing the decoction/kalka route — **not** on oil-solubility grounds. The base is the
carrier/base oil.

**Consequence to protect.** Never reintroduce "won't dissolve in oil" reasoning for taila. Process
identity governs, not phase miscibility.

---

## ADR-006 — Ordered `preferred_formats` arrays, not JavaScript object order
**Accepted · 2026-07**

**Context.** `topFormatFor()` returned the first `ok` key in object order, and if none, fell
through to the first `warn` and then the first code *even if it was avoid* — surfacing a conditional
or disqualified format under a "Required format" label. Object key order is arbitrary and meaningless
as a ranking.

**Decision.** Each `Product × Role` carries explicit ordered `preferred_formats` /
`conditional_formats` / `unsuitable_formats` arrays. Best-fit = the first `ok` from
`preferred_formats` only; never a `warn`/`avoid` dressed up as required. Order is formulation
judgment, owner-signed-off.

**Consequence to protect.** Best-fit display must be deterministic and defensible, decoupled from
data-structure iteration order. "Selected format" (user's choice) is shown separately from the
recommendation.

---

## ADR-007 — The Acai rule: prefer "Not evaluated" over a false green
**Accepted · 2026-07**

**Context.** A clean catalogue `Type` cannot say whether *this* Botanical Extract Powder (RE) or
spray-dried powder (SD) is water-soluble. Guessing "acceptable" in a clear aqueous system would be
false confidence.

**Decision.** Where `Type` cannot prove the required behaviour, the cell stays **Not evaluated
pending `formulation.physical_behaviour`** — a future per-SKU metafield
(Water-soluble / Water-dispersible / Oil-soluble / Oil-dispersible / Suspension-compatible /
Not evaluated) that refines, not replaces, the `Type`-level ladder.

**Consequence to protect.** Coverage percentage is **not** a target; trustworthy verdicts are.
Never fill a grey cell to improve the number. Do not create a duplicate format-code metafield —
`Type` already carries the format.

---

## ADR-008 — Isolates (IC) and Liposomals (LP) route to application review
**Accepted · 2026-07**

**Context.** An isolate's or liposomal's suitability depends on solubility, dose and physical grade
that a single catalogue `Type` cannot resolve. Any blanket tier would be fabricated.

**Decision.** IC and LP never receive a compatibility tier. They render an "application review /
ask us" state and are excluded from costing and cart.

**Consequence to protect.** No fabricated tiers for IC/LP — the enquiry path is the honest answer
until per-SKU data exists.

---

## ADR-009 — Never override a signed-off cell (parity guard)
**Accepted · 2026-07**

**Context.** A prior incident destroyed a long task file by overwriting without reading it. In the
matrix, signed-off `fmt` tiers must not silently change when new cells are added.

**Decision.** Matrix edits **add only**. Every apply runs a parity guard: every pre-existing
`fmt[code]` must be byte-identical afterwards; 0 signed-off overrides, 0 parity violations, or the
apply aborts.

**Consequence to protect.** Reviewed logic is immutable except by explicit new sign-off. Read
originals before any write.

---

## ADR-010 — Balm allows validated suspended powders (need-not-dissolve)
**Accepted · 2026-07**

**Context.** A rule marked RE/SD "unsuitable" in a balm because they won't dissolve in the oil/wax —
collapsing need-not-dissolve back into must-dissolve-in-oil.

**Decision.** A balm need not dissolve its actives. A fine hydrophilic powder may be a **validated
suspension** → RE/SD Acceptable-with-caveat (grit / uniformity / release caveats). Coarse or
settling powder → Avoid. Water-based liquid (WL) → Avoid in an anhydrous matrix.

**Consequence to protect.** Don't re-import dissolution requirements into suspension-tolerant
matrices (balm, softgel fill). Softgel suspensions additionally require validated particle size,
sedimentation, fill viscosity and dose uniformity.
