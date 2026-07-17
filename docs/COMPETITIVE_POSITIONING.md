# Herbuno Formulator — Competitive Positioning

**Purpose.** A short, defensible statement of where the Herbuno Formulator sits in the formulation/
sourcing software landscape and the gap it fills. Derived from the July-2026 market directory and
the Formulaite teardown. Physics-and-market-convention only; no unverified competitor pricing or
database-size figures (those in the source report are sourced from directories/blogs and are not for
public use without primary verification).

**Companion to:** `FORMULATOR_SPECIFICATION.md` (scope), `STAGE1_STAGE2_TARGET_DESIGN.md`
(architecture / ADR-012). This document is the *why-we're-different*; those are the *what* and *how*.

---

## The one-sentence gap

> Existing tools help companies **manage formulas**, **recommend finished products**, **configure
> custom orders**, or **search ingredient databases**. Herbuno helps buyers identify the **correct
> commercial botanical form** for a specific finished-product role, then transparently shows whether
> that specification can be **supplied**.

That specific combination — catalogue-independent *form* guidance joined to *real* supplier
procurement — is not occupied by the adjacent categories below.

---

## The North Star (why this positioning holds)

> The Formulator's primary output is not a Herbuno product recommendation. It is a technically
> defensible commercial ingredient specification. Herbuno products are one possible fulfilment of
> that specification.

Every positioning claim below follows from this: Herbuno competes on *specification quality and
honest fulfilment*, not on formula generation, regulatory scope, or database size.

---

## Herbuno vs the four adjacent categories

### 1. PLM / formulation software
*(e.g. enterprise cosmetic and supplement R&D systems: lab formulation, regulatory checking, label
generation, toxicology, costing, version control.)*

- **What they do well:** full formula lifecycle for professional R&D teams — deep regulatory,
  toxicology, and documentation scope.
- **Where they stop:** they manage the *formula*; they do not supply the *raw material*, and they
  are built for R&D chemists, not ingredient buyers.
- **Herbuno's difference:** Herbuno does not attempt formula management, regulatory verdicts, or
  efficacy. It answers a narrower, buyer-facing question — *what commercial form do I source?* —
  and then fulfils it. Competing on their scope would forfeit Herbuno's credibility advantage of
  being narrow and honest.

### 2. Ingredient marketplaces / sourcing databases
*(e.g. large B2B supplier directories and ingredient-discovery platforms with technical documents.)*

- **What they do well:** breadth — very large ingredient databases, supplier discovery, spec sheets.
- **Where they stop:** they help you *find* ingredients; they do not reason through whether a given
  commercial *form* is physically appropriate for a specific finished product and role.
- **Herbuno's difference:** Herbuno leads with the technical decision — *which form is right* —
  before showing inventory. It is smaller than these databases by design, and defensible because it
  explains the form the buyer should source rather than listing everything available.

### 3. Storefront custom-product builders
*(e.g. Shopify-style configurators for choosing components, proportions, sizes, and prices.)*

- **What they do well:** selection, proportions, pricing, variant logic, add-to-cart.
- **Where they stop:** they calculate selections and prices; they carry no technical formulation
  intelligence — they do not determine whether a chosen ingredient form is physically suitable.
- **Herbuno's difference:** the technical reasoning those builders lack *is* Herbuno's core. The
  earlier catalogue-first version of the tool risked looking like one of these with notes attached;
  the two-stage rebuild (ADR-012) restores the separation so the reasoning leads and the storefront
  follows.

### 4. AI recommendation / formulation tools
*(e.g. AI formula generators and personalization/diagnostic tools that propose ingredients,
concentrations, or finished products.)*

- **What they do well:** guided, conversational formula generation with evidence-linked rationale
  and strong UX; they answer *"what should be in it."*
- **Where they stop:** they generate the formula, then must hand the sourcing step to someone else.
  In the observed case, that handoff is routed through the tool's own lead-capture flow rather than
  a direct, disclosed supplier connection.
- **Herbuno's difference — the wedge:** Herbuno starts exactly where these tools become commercially
  weak: the transition from *"this is the ingredient/form you need"* to *"here is the supplier who
  can actually provide it."* Herbuno defines the correct ingredient specification and connects it
  directly to a real supplier catalogue and sourcing team — honestly, because the supplier is
  Herbuno itself.

---

## What Herbuno is — and is not

**Is:** botanical ingredient **compatibility, specification, and sourcing** software — technical
ingredient decision support, commercial-form selection, catalogue matching, and pre-RFQ
specification generation.

**Is not, and must never claim to be:** full formulation software · regulatory-compliance software ·
clinical-efficacy software · dosing software · cosmetic safety-assessment software · Supplement
Facts software · manufacturing ERP.

Being explicit about these limits is itself a credibility signal for a technical, regulated-adjacent
audience — the inverse of overclaiming.

---

## Sequential, not competing

Herbuno does not aim to replace formulation tools, sourcing databases, storefront builders, or a
cosmetic chemist. It sits **downstream** of the "what should be in it" question and **upstream** of
"who ships it":

```
what should be in it        →   what commercial FORM to source   →   who supplies it
(formulation / AI tools)         (Herbuno Stage 1)                    (Herbuno Stage 2 procurement)
```

That sequence is the strongest strategic finding of the research: the middle-and-right of that chain,
joined honestly, is unoccupied — and it is where Herbuno is built to sit.

---

## Notes on evidence discipline (internal)

- Do **not** publish competitor pricing, contract values, or database-size figures from the source
  market report without primary-source verification — several are sourced from directories, review
  sites, and vendor blogs.
- The "92 platforms" figure is a fragmented directory count (mixing ERPs, plugins, APIs,
  manufacturers); usable for "the landscape is fragmented," not as a market-size or
  competitor-count statistic.
- The competitive wedge is defensible because it rests on an observed, reproducible product
  behaviour, stated in neutral terms — keep it factual, not accusatory.
