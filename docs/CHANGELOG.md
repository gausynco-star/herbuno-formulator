# Changelog

Notable changes to the Herbuno Formulator. Newest first. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Logic changes must reference a `DECISION_LOG.md`
ADR and a decision record in `/matrix`.

## [Unreleased]
### Pending sign-off
- 11 Stage-1 ladder rows where the proposed best-fit order changes the displayed recommendation
  (`/matrix/Stage1_Format_Ladder_AUDIT.xlsx`). See spec §14.
- `tablet-dc | functional | MP`: Avoid → Acceptable-with-caveat (validated fibre-rich milled
  botanical) — not yet applied.
- `pet`: precise dry dosage form vs keep routed to application review.
- Layer-1 (botanical suggestions) curation — not built.
- Stage-1 / Stage-2 two-screen UX — designed, not built.

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
