# Regression Checklist

Run before any handover or deploy. Ties to spec §11 and the ADRs. A change that can't pass this
doesn't ship.

## Build integrity
- [ ] `node --check javascript/herbuno-matrix.js` passes.
- [ ] `node --check javascript/blend-builder.js` passes.
- [ ] Bash heredocs don't double-escape `\uXXXX` in generated JS (always `node --check` after
      generation).

## Dry-run harness
- [ ] Both modes (quick + build) × all products → **0 runtime errors**.
- [ ] No cell resolves via a conservative fallback rule (every archetype explicitly handled).

## Parity (ADR-009)
- [ ] Matrix edits are ADD-only.
- [ ] Every pre-existing `fmt[code]` byte-identical after apply.
- [ ] 0 signed-off overrides, 0 parity violations — else abort.

## Calibration anchors (must reproduce exactly)
RE anchors:
- [ ] capsule · active · RE = **Recommended**
- [ ] gummy · active · RE = **Acceptable with caveat**
- [ ] rtd-clear · active · RE = **Not evaluated** (already-mapped / Acai)
- [ ] face-oil · active · RE = **Usually unsuitable**
- [ ] tea · active · RE = **Usually unsuitable**

Churna ruling (ADR-004):
- [ ] churna · base · RE = Usually unsuitable · churna · base · SD = Usually unsuitable
- [ ] churna · active · RE = Acceptable with caveat · churna · active · SD = Acceptable with caveat

Gate/route spot-checks:
- [ ] BASE roles (softgel/taila/aroma-roll) → RE/WL/OE/SD **Not evaluated** (ADR-002).
- [ ] Clear systems (rtd-clear/serum/spray/syrup) → generic SD **Not evaluated** (ADR-003/007).
- [ ] balm · active · RE/SD = Acceptable with caveat (suspension, ADR-010).
- [ ] taila · active · RE = Usually unsuitable, reasoned as classical/process (ADR-005), not oil
      solubility.

## Best-fit labelling (ADR-006)
- [ ] Best-fit shows an `ok` tier only; never a `warn`/`avoid` surfaced as "required".
- [ ] Rows with no `ok` show a labelled compromise ("no single best fit · possible: X") or
      "no catalogue best fit — see options".
- [ ] Genuine best-fits still show (capsule=SE, rtd-clear=SE, face-oil=SE, softgel base=CO).
- [ ] Picked SKU shows "· selected: <format>" distinct from the recommendation.

## Rendering / routing
- [ ] IC/LP picks → ⚙ application-review state; excluded from cost and cart (ADR-008).
- [ ] SD label renders as "Spray-dried powder" (ADR-003).

## Live caveat
The dry-run proves the code doesn't crash and tiers resolve against real matrix data. It does **not**
prove live Shopify behaviour. Dev-theme test before production — see `ui_state_tests.md`.
