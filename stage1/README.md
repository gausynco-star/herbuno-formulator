# Stage 1 — Formulation engine (catalogue-independent)

Build target. Three knowledge layers:

- **Layer 1 — Role → botanical suggestions** (NEW). Curated formulation knowledge:
  "what botanicals are commonly used for this role" (e.g. Colour → beetroot, black carrot,
  curcumin, spirulina). NOT generated from the Herbuno catalogue. V1 = curated per role
  (Product × Role refinement later). Owner-vetted before it ships.
- **Layer 2 — Format ladders** (EXISTS). Product × Role → ordered `preferred_formats` /
  `conditional_formats` / `unsuitable_formats`. See docs/decision-records/Stage1_Format_Ladder_AUDIT.xlsx
  (pending order sign-off).
- **Layer 3 — Catalogue** is Stage 2, not here.

Entry paths: (A) user types any botanical; (B) "Show ingredient ideas" (Layer 1).
Either way the same compatibility engine renders the ladder. No catalogue call in Stage 1.
