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

## 2026-07 — Stage-1 ladder ordering applied (ADR-011)
### Added
- `preferred_formats` / `conditional_formats` / `unsuitable_formats` ordered arrays on all 71
  catalogue roles (ADR-006). Best-fit is now the first `ok` of `preferred_formats`.
### Changed
- Aqueous actives (rtd-clear, rtd-cloudy, drops-aq, syrup, spray, serum): best-fit SE → **WL**;
  WL note qualified (concentration/pH/clarity validation).
- aroma-roll active: **CO removed from the active `fmt`** (role-class leak); active best-fit = OE.
- mask-dry active: best-fit MP → **RE** (RE→SD→MP); MP note reframed as lower-concentration option.
- savoury flavour & colour: best-fit OE → **MP** (MP→OE), scoped to dry-seasoning systems only.
- lozenge-c flavour: best-fit MP → **SD**; SD caveat extended.
- schema_version → v8-ladder-ordered.
### Guardrails
- 0 tier changes anywhere; 12 approved note edits + 1 approved cell removal (aroma-roll CO); parity
  verified (ADR-009). Reviewer: ChatGPT; owner sign-off recorded.
### Known limitation logged
- savoury MP→OE is scoped to dry systems; fat-containing savoury products may favour OE (matrix
  cannot yet express finished-food fat-phase context).

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
