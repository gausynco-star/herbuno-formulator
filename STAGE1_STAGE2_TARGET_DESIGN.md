# Stage-1 / Stage-2 Target Design (v2)

**Status:** approved architectural target (reviewer: ChatGPT, 9.5→adopted; owner sign-off recorded).
Child document of `FORMULATOR_SPECIFICATION.md` (the constitution) — where they touch, the
constitution's scope guardrails (§0) and two-stage principle (§1) govern. On acceptance this is
recorded as **ADR-012**. From here, resist further *architectural* change unless new research
genuinely contradicts it; remaining work is implementation, refinement, and populating the knowledge
layers.

---

## 0. North Star

> **The Formulator's primary output is not a Herbuno product recommendation. It is a technically
> defensible commercial ingredient specification. Herbuno products are one possible fulfilment of
> that specification.**

This single sentence explains every architectural decision below. Any feature request that makes the
Formulator's *primary* output a product recommendation is violating the architecture.

---

## 1. Positioning (canonical — preserve verbatim)

**Value proposition:**
> Herbuno helps the buyer determine what commercial botanical form should be sourced, then
> transparently shows whether Herbuno can supply it.

**Competitive wedge:**
> Formulaite generates formulas and routes manufacturing enquiries through its own lead-capture
> flow. Herbuno defines the correct ingredient specification and connects it directly to a real
> supplier catalogue and sourcing team.

**One-line category:** a catalogue-independent botanical ingredient compatibility and specification
engine, connected directly to real supplier procurement.

The wedge is evidence-based: Formulaite's "Connect to Manufacturer for free" routes to its *own*
inbox via a pre-filled email with a hidden routing footer — undisclosed lead-capture dressed as a
manufacturer connection. Herbuno occupies that commercial moment **honestly**: the supplier *is*
Herbuno, so routing is direct and disclosed.

---

## 2. Scope guardrail (reaffirm constitution §0)

Herbuno answers *"for this finished product and ingredient role, what commercial botanical **form**
is technically appropriate, and can Herbuno supply it?"* It does **not** generate finished formulas,
exact concentrations, per-dose figures, efficacy rationales, or regulatory-compliance verdicts.
Those belong to Formulaite / Coptis / Genesis R&D. Herbuno's advantage is being **narrow and
honest** about what the output proves.

---

## 3. Core design principles

**3.1 The absolute separation principle.** Stage 1 is technical guidance. Stage 2 is commercial
procurement. Their visual and language separation must be **absolute**. The procurement CTA must
never be styled as, or positioned to resemble, a scientific verdict. (This is the Formulaite failure
inverted — their "Compliant" badge and manufacturer upsell share the same green, so a marketing unit
reads as a scientific result.)

**3.2 The independence test (litmus).**
> **Stage 1 behaves exactly the same if Herbuno ceased to exist tomorrow.**
Stronger than "inventory never influences Stage 1." Use it as a test: any request that fails it
violates the architecture. Stage 1 renders identically whether or not Herbuno stocks anything.

**3.3 Stage 1 is standalone value.** The tool is fully usable with **no intent to buy**. This is
deliberate: catalogue-free, no-purchase-required use *increases* trust and, counterintuitively,
probably *increases* procurement enquiries. It is the top-of-funnel asset, not a gated sales tool.

**3.4 Identity ≠ specification.** A botanical *identity* is constant; its *commercial specification*
varies. Ashwagandha (one identity) → milled powder / 10:1 / 20:1 / standardised / water-soluble /
oil-soluble (many specifications). The internal model is therefore:

```
Ingredient identity  →  Commercial specification  →  Catalogue / supplier match
```
**not** `Ingredient → Catalogue`. This keeps every later feature clean.

---

## 4. Stage 1A — Guided brief (intake)

A short, chip-driven intake before results — borrowed from Formulaite's adaptive one-question-at-a-
time chips, kept minimal (Herbuno is not becoming a chat engine).

Questions (each a chip/toggle; typing rarely required):
1. **What are you making?** → finished product.
2. **What role should this ingredient perform?** → active / base / functional / flavour / colour.
3. **Do you already know the botanical?** → routes to 1B path A or B.
4. **Physical constraints** (only those the matrix uses as gates):
   - System phase: clear-aqueous / opaque-aqueous / dry / oil-based
   - Heat involved? yes / no
   - Visible particles acceptable? yes / no

**Rule — every intake question must map to an actual matrix gate. No cosmetic questions.** Q2 = Gate
1 (role class); Q4 = Gates 2–4 (route / phase / dissolution / process). 1A *surfaces* existing gate
logic as intake; it does not add a new knowledge layer.

---

## 5. Stage 1B — Ingredient entry or discovery (catalogue-free)

Two paths, both **independent of Herbuno stock**:

**Path A — "I know the botanical."** The user types **any** botanical name as free text with
**botanical autocomplete** (a known Latin-binomial list for typo correction — **not** a catalogue
search, so no inventory bias). Stage 1 returns the full specification for that botanical × product ×
role, **including for botanicals Herbuno does not stock.** Only Stage 2 later reports availability.

> **Key architectural fix.** Today the "Search a botanical" box only queries `CAT` (Shopify
> products), so a user cannot get a Stage-1 answer for anything Herbuno doesn't sell. The rebuild
> decouples the ingredient *input* from the catalogue entirely. This is build-step #1.

**Path B — "Show ingredient ideas."** User knows the function, not the botanical. The tool suggests
probable botanicals for the `Product × Role` from the curated **Layer 1** knowledge base — not from
the catalogue or the format matrix.

> **Dependency.** Layer 1 does not exist yet and cannot be derived from the catalogue or the matrix
> (the matrix answers *format*, Layer 1 answers *which botanical* — different knowledge systems).
> Path B is gated on curating Layer 1. Path A ships without Path B.

---

## 6. Stage 1C — The specification object (Stage 1's real output)

Stage 1 does not end at a recommendation; it **produces a specification object** — the technically
defensible artifact that Stage 2 fulfils. Rendered as a structured card, and carried forward as
structured data:

```
Selected specification
  Botanical:          Acai (Euterpe oleracea)          ← identity
  Role:               Primary active
  Commercial form:    Standardised water-soluble extract  ← specification
  Required behaviour: Water-soluble
  Assay:              Standardised
  Phase:              Aqueous
  Technical status:   Best physical fit
```

Around it, the structured result separates: **best-fit form** (`ok`, ordered by `preferred_formats`
— ADR-006/011) · **conditional alternatives** (`warn`, `conditional_formats`) · **unsuitable forms**
(`avoid`, `unsuitable_formats`) · **technical reason** (collapsed) · the **selected specification**
(above).

**Transparent logic — shown, not faked.** Herbuno's reasoning is instant, so **do not fake a loading
animation** (Formulaite's staged log works only because its process is genuinely slow). Expose the
logic as a compact honest checklist inside the collapsed technical explanation: Phase match checked ·
Dissolution/dispersion checked · Process (heat/pH) tolerance checked · Sensory risk checked ·
(Stage 2:) availability checked. Technical explanation **collapsed by default**.

---

## 7. Status labels (approved — no "Compliant")

Herbuno has not checked regulatory compliance and must never imply it.

| Context | Label |
|---------|-------|
| best-fit form | **Best physical fit** |
| conditional form | **Conditional fit** |
| routed to review (IC/LP, application-dependent) | **Application review needed** |
| disqualified form | **Not suitable for this role** |
| Stage-2 stock hit | **Catalogue match found** |

Never: "Compliant", "Approved", "Safe", "Validated", or any regulatory/efficacy-implying badge.

---

## 8. Stage 2 — Procurement (renamed from "Fulfilment")

"Procurement", not "Fulfilment" — the latter implies shipping; this stage answers *can this
specification be supplied, and how.* Appears **only after** a Stage-1 specification object exists and
the user proceeds. Stage 2 asks *"Can Herbuno supply THIS specification?"* — not *"what product do
you want?"*.

Match classes (against the spec object):
1. **Exact specification match** — same botanical, same form → Add to cart / Request sample.
2. **Compatible best-fit alternative** — same botanical, a different but still `ok` form → offer,
   labelled as alternative.
3. **Conditional stocked alternative** — same botanical, only a `warn` form in stock → offer with
   the compromise stated.
4. **No appropriate match** → **"Ask Herbuno to source this specification."**
5. **Application review** (IC/LP) → routed to a specialist; excluded from cart/costing.

**Honest routing.** Explicit and disclosed: **"Send this specification to Herbuno"** / **"Ask
Herbuno to source this format."** No implication of an automatic third-party manufacturer match; no
hidden routing footer.

**Styling.** Distinct "Herbuno catalogue / sourcing" treatment, visibly separate from Stage-1
technical styling (§3.1).

**Preserved future option (not a v1 goal).** Because Stage 1 now emits a clean specification object,
Stage 2 could later match that same object against partner suppliers, distributor catalogues or
manufacturer APIs — not only Herbuno — **without touching Stage 1**. Keep the architecture open to
this; do **not** build multi-supplier matching in v1 (over-engineering, and it could dilute the
"Herbuno is the honest direct supplier" wedge). Filed as future-optional.

---

## 9. Borrow / don't-borrow from Formulaite

| Borrow | Don't borrow |
|--------|--------------|
| Guided one-at-a-time intake with quick-reply chips | Complete formula generation |
| Adaptive input widgets (chips/toggles, not one text box) | Exact concentration / per-dose claims |
| Structured result card (separated fields) | Broad regulatory-compliance claims |
| Expandable technical detail (collapsed by default) | "Compliant" badges / verdict-styled status |
| Transparent logic visibility (honest, not faked staging) | Hidden lead-routing behaviour |
| Saved projects / compare (later, not required for v1) | Marketing CTAs styled like scientific results |

---

## 10. Architecture & data implications

- **Specification object** — Stage 1's output is a structured object (identity + role + form +
  behaviour + assay + phase + status), not a string. It is the interface between Stage 1 and Stage 2.
- **Identity → Specification → Match** — the internal model (§3.4); do not collapse identity into
  catalogue.
- **Catalogue-free Stage-1 input** — decouple the ingredient input from `CAT`. Stage-1 reasoning
  already runs off `window.HB_MX` with zero catalogue reference; the change is the *input path* and
  *UI flow*, not the reasoning engine.
- **Layer 1** — new curated knowledge base for Path B; **curated at Role level first**, Product ×
  Role later (avoids an exploding initial curation workload); owner-owned; not derivable from
  catalogue or matrix. Blocks Path B only.
- **Richer specification (future, logged)** — a single format code can't fully express "standardised,
  water-soluble beetroot extract with confirmed dispersion and heat/pH stability." The
  `formulation.physical_behaviour` metafield (spec §6) and SE-as-overlay refinement (ADR-011) are the
  path. Not required for the rebuild; keep the format-code ladder as the v1 spec vocabulary.
- **Reuse** — ladder logic, `codesForTier`, `bestFitCode`, `ladderRank`, tier rendering, RFQ, cart,
  fragment-encoded sharing all carry over. The rebuild reorganises flow, input, and output-shape; it
  does not rewrite the engine.

---

## 11. Build sequencing

1. **Catalogue-free Path A + Stage-1/Stage-2 split + specification object.** Highest value; unblocks
   the wedge. Stage 1 stands alone (product + role + typed botanical → ladder + reasoning + spec
   object); Stage 2 is a separate, clearly-styled procurement step behind an explicit action. **Do
   not build Path B before 1A/Path A is polished.**
2. **Guided intake (1A).** Chip-driven brief in front of Stage 1.
3. **Stage-2 procurement view.** The five match classes as a clean, distinctly-styled screen.
4. **Layer 1 (Role-level) + Path B.** After Layer 1 is curated.
5. **Saved projects / compare.** Later; not required for v1.

---

## 12. Owner decisions — RESOLVED

1. **Stage 1 standalone?** → **Yes.** Usable with no intent to buy (§3.3).
2. **Intake question set?** → **Approved**, with the rule that every question maps to a real matrix
   gate; no cosmetic questions (§4).
3. **Layer 1 granularity?** → **Role level first**, Product × Role later (§10).
4. **Path A input?** → **Free-text with botanical autocomplete** (Latin binomials), not catalogue
   autocomplete (§5).

---

## 13. Relationship to existing records

- Implements `FORMULATOR_SPECIFICATION.md` §1 (two-stage) and §9 (UI); honours §0 (scope) and §12
  (privacy).
- Consistent with ADR-001 (Stage-1/Stage-2 split), ADR-006/011 (ordered ladders), ADR-008 (IC/LP
  review).
- Record as **ADR-012 — Two-stage rebuild: North Star specification object, catalogue-free Stage 1,
  guided intake, honest Stage-2 procurement.** Move the changelog's "Stage-1/Stage-2 two-screen UX"
  line from *pending* to *in progress*.
