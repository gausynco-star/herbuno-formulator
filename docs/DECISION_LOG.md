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

---

## ADR-011 — Stage-1 ladder ordering (WL→SE, aroma-roll active = OE only, savoury scope)
**Accepted · 2026-07**

**Context.** Introducing `preferred_formats` (ADR-006) required an explicit order for every
`Product × Role`. 11 rows changed the displayed best-fit vs object order; reviewed and signed off.

**Decision.**
- **Aqueous actives** (rtd-clear, rtd-cloudy, drops-aq, syrup, spray, serum): `preferred = [WL, SE]`.
  Water-soluble form leads because phase compatibility is the first gate; standardisation is an
  **assay overlay**, not a standalone phase. WL note qualified: "best direct phase match, subject to
  concentration, pH and finished-system clarity validation" — WL is not automatically zero-risk.
- **Aroma roll-on active**: `preferred = [OE]`. Carrier oil (CO) is a base/vehicle class, not an
  active-format fallback — it was **removed from the active `fmt` entirely** (role-class leak) and
  remains only under `aroma-roll · base`.
- **Dry powder mask active**: `preferred = [RE, SD, MP]`. MP reframed as a legitimate
  lower-concentration botanical option (needs higher loading), not inferior.
- **Savoury flavour & colour**: `preferred = [MP, OE]`, **scoped to dry-seasoning systems only**.
- **Lozenge flavour**: `preferred = [SD, MP]`; SD caveat extended to non-hygroscopicity, compression
  behaviour and carrier taste.

**Consequence to protect.**
- The `savoury` MP→OE order is **not universal**. It holds for a dry seasoning / premix / dry matrix
  with no dedicated fat phase. Fat-containing sauces, emulsions, dressings, fillings and oil-based
  savoury products may legitimately favour OE. The matrix cannot express this fat-phase split (it
  keys on `Product × Role`, not finished-food context) — encoded in the notes, flagged here as a
  known limitation.
- **Future refinement (open):** SE should be modelled as a "standardised + <behaviour>" overlay
  rather than a peer code competing with WL. A future matrix should distinguish "standardised +
  water-soluble" from generic SE instead of ranking WL vs SE as mutually exclusive categories.
  
---

## ADR-012 — Two-stage rebuild: specification object, catalogue-free Stage 1, honest procurement
**Accepted · 2026-07**

**Context.** Post-launch review plus July-2026 competitive research (market directory, self-audit,
Formulaite teardown) showed the deployed tool has correct compatibility logic but is still
**catalogue-first**: the botanical input only queries Herbuno stock, and Stage 2 sits inside the
formulation flow, so inventory contaminates Stage-1 guidance. The nearest competitor (Formulaite)
owns AI formula generation but routes the sourcing step through its own lead-capture flow — leaving the
honest formulation-to-sourcing bridge unoccupied.

**Decision.** Rebuild to the two-stage design in `STAGE1_STAGE2_TARGET_DESIGN.md`:
- **North Star:** the primary output is a technically defensible **commercial ingredient
  specification**, not a Herbuno product recommendation; Herbuno products are one possible
  fulfilment of that spec.
- **Stage 1 emits a specification object** (identity + role + form + behaviour + assay + phase +
  status), not a string — the interface to Stage 2.
- **Internal model** `Ingredient identity → Commercial specification → Match`, not
  `Ingredient → Catalogue`.
- **Catalogue-free Path A:** any botanical typed as free text (with botanical, not catalogue,
  autocomplete) returns a full Stage-1 spec, including for botanicals Herbuno doesn't stock.
- **Guided chip intake (1A)** where every question maps to a real matrix gate.
- **Path B ("show ingredient ideas")** from a curated **Layer 1** (Role-level first), not derivable
  from catalogue or matrix.
- **Stage 2 = Procurement** (renamed from Fulfilment) with five explicit match classes and honest,
  disclosed Herbuno routing.
- **No "Compliant"/verdict badges;** approved status vocabulary only.

**Consequence to protect.**
- **Independence test:** Stage 1 must behave identically if Herbuno ceased to exist tomorrow. Any
  request that fails this test violates the architecture.
- **Absolute Stage-1/Stage-2 separation** in visuals and language; a procurement CTA must never be
  styled as a scientific verdict (the Formulaite failure inverted).
- **Stage 1 is standalone value** — usable with no intent to buy.
- Multi-supplier Stage-2 matching is a **preserved future option, not a v1 goal** (avoid
  over-engineering and wedge dilution).
- This is the settled architecture: resist further architectural change absent genuinely
  contradicting research; remaining work is implementation and populating knowledge layers.

  # ADR-013 (APPROVED — reviewer: ChatGPT) — Botanical Intelligence Layer + Verification Pipeline

**Status:** APPROVED architecture (reviewer: ChatGPT; owner sign-off recorded). Proven on real data.
Child of `STAGE1_STAGE2_TARGET_DESIGN.md` (ADR-012) and `FORMULATOR_SPECIFICATION.md`. The
verification pipeline (§8) is the defined build task; the raw session data remains UNVERIFIED until
it clears the pipeline.

---

## 1. The problem this solves

The deployed tool (ADR-012 step 1) gives the **same** format ladder for "Gummy · Active" regardless
of botanical — it keys on Product × Role only. Typing "Shatavari" produced a generic result and
"application review needed", which is indistinguishable from a worse version of the site's search.
The tool has no per-botanical knowledge, so it cannot answer its own core question: *which commercial
FORM of this specific botanical fits this product role?*

## 2. The factorised model (the key insight)

Do **not** author a recommendation per (botanical × product × role) — that's combinatorially
impossible. Instead:

```
BOTANICAL INTRINSIC PROFILE   ×   PRODUCT × ROLE REQUIREMENTS   =   botanical-specific recommendation
   (new layer — per botanical)       (existing matrix, unchanged)      (engine intersects them)
```

Profile a botanical **once** (what forms exist, how they behave) → it becomes botanical-specific
across *every* product and role automatically, by intersecting with the existing matrix. This reuses
everything already built.

## 3. What a botanical profile contains (two tiers)

- **Tier 1 — Commercial form availability (CATALOGUE-DERIVED).** Which commercial forms are actually
  offered in the market for this botanical, and how common. Sourced by aggregating real supplier
  catalogues. This is most of the value and is **observable data, not expert opinion.**
- **Tier 2 — Intrinsic behaviour (INFERRED + HONESTLY DEFERRED).** Physics-implied behaviour already
  in the matrix (milled root = insoluble particulate; a "water-soluble" grade = a supplier *claim*,
  not proven fact). SKU-specific solubility/grit/sensory is **not researched per botanical** — it is
  routed to "confirm with supplier COA," consistent with ADR-003 (type ≠ proven behaviour).

## 4. Honesty guardrails (non-negotiable)

- **Supplier label ≠ physical fact.** "Water-soluble extract" on a supplier page is a *declared
  claim*; output must say "best phase match, subject to supplier solubility data and finished-system
  validation."
- **Absence ≠ nonexistence.** If no supplier in the sampled basket offers a form, say "not observed
  in reviewed sources," never "unavailable."
- **Milled ≠ guaranteed gritty.** State "insoluble particulate; grit risk depends on particle size
  and finished-system tolerance."
- **Market-status vocabulary** computed from supplier counts, never guessed: widely / commonly /
  occasionally / specialist / not observed in reviewed sources / unresolved.
- **Identity coverage ≠ intelligence coverage.** The tool may recognise a botanical *name* without
  having a verified *profile*. Four states: verified profile / partial profile / identity-only
  (generic guidance) / unverified free text (generic guidance only).

## 5. Proof achieved this session (on REAL data — thewholesaler.eu, 29k rows)

- Parsed the catalogue into a botanical → commercial-forms map.
- **Shatavari (Asparagus racemosus)** resolves to real market forms: WL, WL-glycerin, WL-glycol, OE,
  RE, RE-paste, MP, CO, TC, WD. The exact query that failed in the live tool now has botanical-
  specific market data behind it.
- **Distinct-botanical universe ≈ 673–800** (492 cleanly Latin-anchored species + ~181 real
  un-Latin'd names + noise). This confirms the owner's independent estimate of 700–800 and means the
  scope is tractable — NOT 4,000.
- **Normalization taxonomy validated** against real supplier `Type` labels (see §6).

## 6. Normalization taxonomy (supplier Type → Herbuno format code) — validated on real labels

| Supplier `Type` label (thewholesaler.eu) | Herbuno code | Notes |
|---|---|---|
| Extract Powder | RE | full-spectrum extract powder |
| Herbal/Fruit/Vegetable/Spice Powder | MP | milled |
| Water Soluble Extract | WL | water-soluble liquid |
| Oil Soluble Extract | OE | |
| Propylene Glycol Extract | **WL-glycol** | NEW — ~256 products; glycol carrier |
| Glycerin Extract | **WL-glycerin** | NEW — ~273 products; glycerin carrier (cleaner-label) |
| Extract Paste | **RE-paste** | NEW — concentrated paste state |
| Oleoresin | **OLR** | NEW — concentrated oleoresin |
| Hydrosol | **HYD** | NEW — distillate water |
| Infused Oil / Carrier Oil | CO | |
| Herb,Cut / Tea & Infusions / Dried Flowers Cut | TC | |
| Whole Herb/Spice, Seeds, Root, Dried Fruits/Flowers Whole | WD | |

**Owner decision (made):** glycol and glycerin extracts are kept as **distinct** codes (they differ
in food/cosmetic regulatory acceptability). The 5 NEW codes extend the existing set
(SE/WL/OE/RE/SD/MP/CO/TC/WD) and must be added to the matrix's `code_names`.

## 7. KNOWN PARSER DEFECTS (must be fixed in Pass 1 — documented, not mysterious)

Found via spot-check; these are why the raw parse is NOT yet trustworthy:
1. **Case inconsistency in Latin names** — "Withania Somnifera" vs "Withania somnifera" created
   separate keys; Ashwagandha was dropped from one spot-check as a result. Normalise Latin to
   `Genus species` (capital genus, lowercase species) everywhere.
2. **Assay stuck to Latin** — "Bacopa monnieri(≥20% Bacosides)" (no space) mis-keyed. Strip trailing
   assay parens from the Latin token.
3. **Multi-dash titles** — "Brahmi – Water hyssop Extract - Bacopa monnieri" has two dashes; naive
   split grabbed the wrong segment, scattering Bacopa across keys. Take the Latin from the LAST
   binomial-matching segment.
4. **Common-name fuzzy merge is risky** — substring matching can mis-join distinct species. Key
   strictly off the (normalised) Latin binomial; treat common names as labels only.

## 8. The verification pipeline (hardened — reviewer additions folded in)

The botanical list is the foundation; an error propagates into every recommendation. Multi-pass,
multi-reviewer, built **in the repo** (persistent, auditable) — NOT a one-shot chat output. **The raw
session data (~673 findings) is UNVERIFIED and must not be used for production.**

**Cross-cutting rules (apply to every pass):**
- **No silent auto-merge.** Any ambiguous merge (case variants like "Withania Somnifera"/"…somnifera",
  assay-suffixed Latin, multi-dash titles, fuzzy common-name matches) is **logged to a review queue,
  never silently joined.** *(This is the exact defect that silently dropped Ashwagandha — silent
  merges are now illegal.)*
- **Provenance per claim.** Every observed form carries its **source supplier + observation date**, so
  market-status counts are auditable and staleness is detectable.
- **Verification is per-field, not per-botanical.** A botanical's *identity* can be verified while a
  specific *form availability* is still single-source/unverified. Each claim carries its own status.

**Passes:**
- **Pass 1 — Machine parse (clean).** Fix §7 defects. One species per normalised Latin key; forms
  aggregate correctly; no near-duplicate Latin keys. Ambiguities → review queue (never silent merge).
  Output: candidate list + parse-QA report.
- **Pass 2 — Authority cross-check.** Validate every Latin binomial against an accepted-names authority
  (GBIF / POWO / Kew). **Distinguish three outcomes, do not collapse them:** *synonym* → map to
  accepted name (keep the botanical); *typo/misspelling* → flag for correction; *genuinely unknown* →
  quarantine. Never discard a name as "invalid" without this distinction.
- **Pass 3 — Multi-supplier consensus.** Layer lotioncrafter + vedaoils (+ later suppliers). Where ≥2
  suppliers agree on common↔Latin and forms → high confidence. Disagreements → review queue. Produces
  the real, provenance-backed market-status counts (§4).
- **Pass 4 — Independent audit (ChatGPT).** Review pipeline logic, flagged ambiguities, and a sample
  of resolved records.
- **Pass 5 — Owner sign-off.** Resolve domain-judgement cases a machine cannot (e.g. "Brahmi" =
  *Bacopa monnieri* vs *Centella asiatica* — regionally ambiguous; both sold as Brahmi). **Sign-off is
  recorded: who, when, on what evidence.**

No record is "verified" (per field) until it has cleared Pass 2 (authority) and either Pass 3
consensus or recorded Pass 5 sign-off.

**One-cohort proof gate (build discipline).** Build and run the FULL pipeline on ONE small priority
cohort (~50 top botanicals) end-to-end *before* scaling. This gate must achieve two things: **(a)**
prove the pipeline works end-to-end, and **(b) measure the true per-botanical review cost** (owner
hours per botanical at full rigor). The decision to scale to the full ~700-cohort is made only after
seeing real cost numbers from the proof cohort — not on estimate. This prevents both a
break-at-volume pipeline and an unaffordable curation commitment discovered at botanical #40.

## 9. Open items / for reviewer

- Is the two-tier profile (catalogue-derived availability + deferred SKU behaviour) the right scope,
  or is more intrinsic data needed at launch?
- Is the 5-pass verification sufficient, over-engineered, or missing a failure mode?
- Should Pass 1 build a lighter first-cohort profile (availability + confidence) and harden to
  per-assertion evidence later, to reach a useful cohort faster? (Risk: 50 perfect profiles vs 300
  useful ones.)
- Acquisition skew: the obtainable suppliers are Shopify e-commerce; bulk manufacturers (India/China)
  and EU distributors are mostly NOT Shopify and harder to acquire. First release basket will be
  e-commerce-skewed — a known limitation to state, not hide.

## 10. Relationship to existing records

- Extends ADR-012 (adds the botanical layer that makes Stage-1 genuinely botanical-specific).
- Adds 5 format codes to `FORMULATOR_SPECIFICATION.md` §3.
- Does NOT change the Product × Role matrix or any existing tier (intersection happens at runtime).
- On acceptance: record as ADR-013 (Accepted), add the 5 codes, and open the verification pipeline as
  a build task.

---

# ADR-014 (ACCEPTED) — Server-side knowledge layer

**Status:** ACCEPTED (reviewer: ChatGPT) · 2026-07-19. Child of ADR-012 (two-stage) and ADR-013 (ingredient
intelligence). Changes *where the knowledge executes*, not what the tool does.

## Context

The Formulator currently ships its knowledge layer to the browser: `herbuno-matrix.js` (~138 KB) is
the complete Product × Role matrix — 238 cells, format rules, disqualification reasoning. Shopify
theme assets are plaintext to every visitor; view-source is sufficient to take the engine. Any
identity or observed-form asset would, under the current design, be shipped the same way.

The tool architecture is reconstructible by a competent formulator and that is accepted. **The
knowledge layer is not**: the identity backbone (826 records, authority-verified, owner-adjudicated)
and the observed-form graph are built substantially from private supplier catalogues that cannot be
scraped. That is the durable asset.

**Owner constraint (recorded):** *no IP on the client side unless operationally necessary.*

**Objective, stated plainly:** the aim is not to hide the tool's outputs, but to prevent disclosure
of the curated knowledge graph and the underlying supplier-derived intelligence from which those
outputs are generated.

## Decision

```
Browser  →  herbuno.com/apps/formulator/*   (Shopify App Proxy — same-origin, signed proxy requests)
         →  Cloudflare Worker  (verifies signature; resolution + intersection logic)
         →  KV / versioned store  (matrix / identity / form-graph bundles)
         →  render-ready specification
```

**Server-side:** Product × Role matrix · identity backbone · observed-form graph · supplier
provenance · all resolution and intersection logic.

**Client-side (operationally necessary only):** input handling, rendering, and the minimal display
vocabulary needed to draw a response. No matrix, no graph, no identity data.

### Why App Proxy — corrected justification

> Shopify App Proxy is selected because it provides same-origin storefront routing, hides the Worker
> origin, and attaches a verifiable Shopify signature to forwarded parameters. The signature proves
> that **Shopify forwarded an untampered request**; it does **not** prove the request came from the
> Formulator UI, nor does it prevent automated calls through the public proxy route (anonymous proxy
> requests are supported, with an empty `logged_in_customer_id`). Protection against harvesting
> therefore also requires response minimisation, timestamp validation, rate limiting, enumeration
> detection and adaptive bot challenges.

**Note:** App Proxy strips cookies and `Set-Cookie` — do not design cookie sessions around it.

### Why Cloudflare Worker

Workers Free: **100,000 requests/day · 10 ms CPU per request · 128 MB memory · 3 MB compressed
script.** Paid starts at $5/month with substantially more CPU and a larger script budget.

Two consequences, both requiring benchmarking before committing to the free tier:
- **10 ms CPU/request** should suffice for indexed lookups and intersection, but must be measured
  against the full graph.
- **3 MB script cap** means the 826-record backbone plus the form graph almost certainly **cannot be
  bundled** into the Worker. Data lives in **KV or another suitable private/versioned store, such as R2, D1 or protected
  static assets; the Worker holds logic only.** D1 only if relational queries become necessary. Private supplier
  provenance stays in a separate non-public dataset, never queryable from the storefront.

## Defence in depth (no single control is sufficient)

1. **App Proxy signature verification** — reject unsigned direct calls to the Worker.
2. **Timestamp freshness** — reject signed requests outside a short window (replay resistance).
3. **Strict input allow-list** — published product IDs, known role IDs, one botanical term. Nothing else.
4. **Response minimisation** — return only the selected specification. Never unused ladder cells,
   alternative botanicals, supplier counts, or graph fragments.
5. **Rate limits — per IP and per session** (a browser-generated session ID alone is regenerable).
6. **Enumeration detection** — flag systematic traversal across products/roles/botanicals.
7. **Adaptive Cloudflare Turnstile** — not on every user; only after thresholds are crossed.
8. **Response caching** for legitimate repeats, kept separate from rate-limit accounting.
9. **No bulk endpoint, ever** — no list-botanicals, no all-forms, no export, no wildcard queries.

**Honest limit:** no public query tool can make its outputs impossible to collect. These controls
raise the cost of extraction; they do not eliminate it.

**Starting rate limits** (tune from telemetry, not permanent): 10/min/IP · 60/hour/IP · 150/day/IP ·
max 30 unique botanical queries/hour · Turnstile on suspicious enumeration.

## Endpoints — separate, mirroring ADR-012

**`POST /apps/formulator/specification`**
In: finished product · role · botanical term.
Out: identity status · accepted/display identity · specification object · technical explanation ·
version block · **short-lived signed `specification_token`**.

**`POST /apps/formulator/procurement`**
In: the signed `specification_token`.
Out: Herbuno match class · product handles · sourcing route.

**The browser must not construct or alter the Stage-1 specification before sending it to Stage 2.**
Stage 2 verifies the token; the token embeds (or references) the knowledge-snapshot versions so both
stages use the same data. This also keeps procurement data out of Stage-1 traffic entirely.

## Version contract

Every response carries: `api_schema_version` · `matrix_version` · `identity_version` ·
`observed_form_graph_version` · `response_generated_at`. Client and Worker **reject incompatible
schema versions** rather than rendering malformed results. Satisfies the ADR-013 downstream contract.

## Degraded state

If the endpoint is unreachable, show an honest message — **do not** ship a cached generic matrix as a
fallback, which would defeat this ADR:

> "HerbIQ Formulator is temporarily unable to generate the technical specification. Your selections
> have been preserved; please retry shortly or send them to Herbuno for review."

Allow: retry · copy entered selections · open a prefilled enquiry. Never silently degrade to weaker
reasoning.

## Consequences

- New infrastructure: a Shopify custom app and a Worker + KV. The tool previously had no backend.
- New failure mode (handled above). Added latency: one round-trip per resolution.
- Deployment becomes two-part — theme asset and Worker must version together.
- Pass-3's storefront contract (strip supplier identity, counts, location) is satisfied
  **structurally**: the browser never receives the graph at all.

## Rejected

- **Bare Worker + CORS** — no request authentication at all; strictly weaker than App Proxy.
- **Matrix client-side, graph server-side** — violates the owner constraint.
- **Vercel/other serverless** — no material advantage over Cloudflare's free tier and edge footprint.
- **Cached client fallback** — would ship the matrix, defeating the purpose.

## Before build

Benchmark dataset size and CPU against the free-tier limits (10 ms, 3 MB) with the real 826-record
backbone and form graph. If exceeded, the $5/month paid tier is acceptable — but measure first.

## Not in scope

No change to the two-stage architecture (ADR-012), matrix content, the identity pipeline (ADR-013),
or the UI.

## Open items

- **Real-stock (catalogue) integration — confirmed architectural gap, not a bug.** Stage 2 has never
  consulted Herbuno inventory. `procurementMatch` runs against the **observed-form graph** (a proxy for
  common commercial formats, trade-convention derived), and `product_handles` is always `[]`; the real
  catalogue product handles are off-repo and unwired. Consequence recorded during Live-test round 2
  (2026-07-20): **until this is wired, no user-facing copy may imply the catalogue or stock was
  checked.** That constraint was applied by rewording the `guidance_only` label, the guidance rec row
  ("Typical commercial approach"), and the Stage-2 result copy. Wiring real catalogue lookup (Herbuno
  product handles → exact/compatible/ask-us classes with honest availability language) is the proper
  fix and remains open.
- **X-Forwarded-For deployment gate** (unchanged): production remains blocked until live dev-theme
  testing confirms the shopper-IP position in the Shopify→Cloudflare proxy chain; `HEADER_CAPTURE` must
  be removed before production.
