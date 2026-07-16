# CLAUDE.md — rules for working in this repository

This file is read automatically by Claude Code. Any AI or human contributor must follow it.
The owner (Krantik) owns **decision logic**; contributors own **plumbing**. When in doubt about
a rule, format tier, or ordering, stop and ask — do not infer.

## What this project is (and is NOT)

- It is a **format-compatibility engine + sourcing assistant**. Two stages:
  - **Stage 1 (formulation, catalogue-independent):** Product × Role → ordered format ladder
    (preferred / conditional / unsuitable), with technical notes. Never filtered by inventory.
  - **Stage 2 (fulfilment, catalogue-aware):** given the intended (botanical, format), search the
    catalogue and offer exact match / compatible alternative / conditional / "ask us to source".
- It is **NOT** Formulaite. Do NOT add: dosing, efficacy prediction, finished-formulation design,
  regulatory formulation, or clinical optimisation. Suggesting *which botanicals suit a role's
  format* is in scope; recommending doses or making health claims is not.

## HARD RULES (violating these is a serious error)

1. **Never override a signed-off cell.** `herbuno-matrix.js` `fmt` tiers were approved through the
   Option B v3 review. Matrix edits may ONLY add previously-unmapped cells. Every apply must run a
   **parity guard**: every pre-existing `fmt[code]` must be byte-identical afterwards; 0 overrides,
   0 parity violations. If a guard trips, stop.
2. **Do not promote `warn`→`ok` or demote `ok` because of display order.**
3. **SD (spray-dried) does NOT prove solubility. RE (full-spectrum) does NOT prove dispersibility.**
   For a *clear* aqueous system, generic RE/SD stays **Not evaluated** pending SKU-level
   `formulation.physical_behaviour` evidence (the "Acai rule").
4. **Role class before phase.** BASE = vehicle/bulk appropriate to the product (NOT a universal
   "carrier-oil-only" rule); FUNCTIONAL = fibre/bulk; FLAVOUR/COLOUR = ingredient identity, not a
   phase; only ACTIVE takes an extract format by default. Wrong class → Not evaluated / guidance.
5. **Best-fit = the `ok` tier only.** Never surface a conditional (`warn`) or `avoid` format as the
   recommendation. Recommendation order comes from explicit `preferred_formats` arrays, never from
   JavaScript object key order.
6. **Classical routes override generic physics:** churna, taila, tea/kashaya, direct compression,
   oral spray, effervescent, gummy, softgel, wet granulation, balm each apply their own rule.
7. **Privacy:** no live buyer formulation data in any committed file or public artifact. Everything
   published must be derivable from physics or trade convention only.

## Deploy model

- Deployables are in `theme-assets/`. Normal deploy set: `herbuno-matrix.js` + `blend-builder.js`.
  `blend-builder.css` and `blend-builder-shell.liquid` change rarely. Shell load order is
  css → matrix (`window.HB_MX`) → container → js.
- After upload, hard-refresh for the Shopify CDN.
- Assets are not size-capped (matrix is ~100 KB and fine); Shopify **sections** are ~50 KB, which is
  why the tool is split into assets + a thin shell.

## Validate before handing over or deploying

```bash
node --check theme-assets/herbuno-matrix.js
node --check theme-assets/blend-builder.js
```
Then run the dry-run harness (tools/) across both modes and all products — must report 0 errors —
and confirm applied tiers still render (e.g. capsule RE = ok, gummy RE = warn, face-oil RE = avoid).
The dry-run proves the code doesn't crash and tiers resolve; it does **not** prove live Shopify
behaviour. Always dev-theme test before production.

## Bash gotcha

Heredocs double-escape `\uXXXX`. Always `node --check` generated JS before handover.

## Source of truth

`docs/decision-records/` holds the approved artifacts. If code and a decision record disagree, the
record wins — surface the discrepancy, don't silently "fix" the record.
