# Herbuno Formulator

A catalogue-independent botanical ingredient **compatibility engine** with an integrated
Herbuno **sourcing assistant**. Lives as a set of Shopify theme assets on herbuno.com.

> Direction (agreed Jul 2026): two-stage architecture.
> **Stage 1 — Formulation** answers "for this finished product and this ingredient role,
> what commercial ingredient *format* is technically appropriate?" — with zero dependence on
> what Herbuno stocks. **Stage 2 — Fulfilment** then checks the catalogue and offers add-to-cart
> or sourcing. Inventory must never influence a Stage-1 recommendation.

## Repository layout

```
theme-assets/            Shopify theme assets (the deployables)
  herbuno-matrix.js      Compatibility data: Product × Role → format ladder (Stage-1 brain)
  blend-builder.js       Tool logic (loads window.HB_MX, renders UI)
  blend-builder.css      Styles (rarely changes)
  blend-builder-shell.liquid   Thin section that loads css + matrix + js in order

docs/
  TASKS.md               Live status / task log
  WORKFLOW.md            How we iterate (you + developer + Claude)
  decision-records/      Signed-off source-of-truth artifacts (DO NOT silently override):
    FORMULATOR_decision_table_v5.xlsx    The v5 decision table
    OptionB_v3_FINAL_approved.xlsx       Approved Option B format-coverage expansion
    Stage1_Format_Ladder_AUDIT.xlsx      Ordered format ladders (pending sign-off)
    format_mapping_v2.csv                Format-code mapping
    herbuno-matrix_PARITY_REPORT.md      Parity report for the last matrix apply

stage1/                  Stage-1 build (format ladder data + Layer-1 botanical suggestions)
tools/                   Build & validation scripts (matrix apply, dry-run harness)
```

## Deploy (Shopify)

1. Upload the changed file(s) in `theme-assets/` to the store theme's **Assets**.
   The deploy set is normally just `herbuno-matrix.js` and `blend-builder.js`;
   `blend-builder.css` and `blend-builder-shell.liquid` change rarely.
2. Hard-refresh to clear the Shopify CDN cache.
3. Dev-theme test before production (real `/products.json`, IC/LP review render, RFQ delivery,
   cart adds, best-fit labelling) — the local dry-run cannot prove live Shopify behaviour.

## Validate before every deploy

```bash
node --check theme-assets/herbuno-matrix.js
node --check theme-assets/blend-builder.js
# then the dry-run harness in tools/ (both modes, all products, 0 errors)
```

See **CLAUDE.md** for the hard rules any contributor (human or AI) must follow.
