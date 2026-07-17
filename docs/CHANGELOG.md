# Changelog

Notable changes to the Herbuno Formulator. Newest first. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Logic changes must reference a `DECISION_LOG.md`
ADR and a decision record in `/matrix`.

## [Unreleased]
### In progress
- ADR-012 Step 1 implemented: catalogue-free Path A, structured specification object, and explicit
  Stage-1 / Stage-2 split in Quick mode.
- Independence gate validated: Stage 1 returns the same technical result for botanicals regardless
  of Herbuno catalogue availability.
- Stage-2 procurement is revealed only through the explicit "Check Herbuno availability" action.
- Remaining: Shopify dev-theme visual testing, guided intake refinement, full five-class procurement
  rendering, Layer 1 / Path B, and eventual full-blend-mode migration.
- Canonical design: `docs/STAGE1_STAGE2_TARGET_DESIGN.md`.

### Pending sign-off
- `tablet-dc | functional | MP`: Avoid → Acceptable-with-caveat (validated fibre-rich milled
  botanical) — not yet applied.
- `pet`: precise dry dosage form vs keep routed to application review.
- Layer-1 (botanical suggestions) curation — Role-level first (ADR-012), not built.

## 2026-07 — Stage-1 ladder ordering applied (ADR-011)
### Added
- `preferred_formats` / `conditional_formats` / `unsuitable_formats` ordered arrays on all 71
  catalogue roles. Best-fit is the first `ok` of `preferred_formats`.
### Changed
- Aqueous actives (rtd-clear, rtd-cloudy, drops-aq, syrup, spray, serum): best-fit SE → **WL**;
  WL note qualified. aroma-roll active: **CO removed** (role-class leak), best-fit OE. mask-dry
  active: MP → **RE** (RE→SD→MP). savoury flavour & colour: OE → **MP** (dry-seasoning scope).
  lozenge-c flavour: MP → **SD**. schema → v8-ladder-ordered.
- UI ordering (ADR-011 completion): `codesForTier()` and catalogue-result sorting now read the
  ordered arrays via `ladderRank()`; unlisted formats sort last; RFQ wording "Required" →
  "Requested format".
### Guardrails
- 0 tier changes; 12 note edits + 1 approved cell removal; parity verified (ADR-009). Reviewer:
  ChatGPT; owner sign-off recorded.
### Known limitation logged
- savoury MP→OE scoped to dry systems; fat-containing savoury may favour OE (matrix cannot yet
  express finished-food fat-phase context).

## 2026-07 — Specification & repository constitution
### Added
- `FORMULATOR_SPECIFICATION.md` (project constitution), `DECISION_LOG.md`, this changelog, and
  `/tests` docs.
- Ordered `preferred_formats` / `conditional_formats` / `unsuitable_formats` layer (ADR-006).

## 2026-07 — Best-fit labelling fix
### Fixed
- Replaced `topFormatFor()` (object-order fallthrough that could surface a `warn`/`avoid` as
  "Required format") with `bestFitCode()` / `possibleCode()` / `needHint()`. Best-fit = `ok` only.
  Renamed the build column "Required format" → "Best-fit format"; picked SKU now shows
  "· selected: <format>". (ADR-006.)

## 2026-07 — Option B v3 (five-gate format-coverage expansion) applied
### Added
- 110 verdict cells added to `herbuno-matrix.js` (8 Recommended, 41 Acceptable-caveat,
  61 Usually-unsuitable); 121 cells deliberately left Not-evaluated (ADR-007).
- Option A wired in: IC/LP → application-review render, excluded from cost/cart (ADR-008).
### Changed
- SD label "Spray-dried soluble powder" → "Spray-dried powder" (ADR-003).
- BASE rule generalised from "carrier oil only" to product-specific vehicle/bulk (ADR-002).
- RE assay wording: "not standardised to a quantified marker" (not "cannot carry a label-claim
  figure").
### Guardrails
- Applied under the parity guard: 0 signed-off overrides, 0 parity violations (ADR-009).

## Earlier — pre-repo (reconstructed)
- v5 decision table signed off (`FORMULATOR_decision_table_v5.xlsx`).
- Monolithic `blend-builder.liquid` split into theme assets
  (`blend-builder.js` + `blend-builder.css` + `blend-builder-shell.liquid`) because Shopify
  sections cap at ~50 KB while assets do not. The old monolith is deprecated.

In Progress - ADR-013 approved (botanical intelligence layer + verification pipeline); 5 new format codes recorded; one-supplier parse proven; zero production-verified records.
