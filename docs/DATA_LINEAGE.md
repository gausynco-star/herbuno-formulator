# Data Lineage — the Formulator matrix (129 cells) vs the abandoned 238-cell model

**Date:** 2026-07-21 · **Status:** resolved (evidence report)

**One line:** The **129-cell v5 model is canonical** and feeds the live Worker. The **238-cell model
is an abandoned artifact from a different project** (not in this repo). `na_tag` / `correct_format`
exist in **neither** — the public messaging taxonomy is new owner-authored decision data.

---

## 1. Authoritative source today

| File | Role | Feeds live Worker? |
|---|---|---|
| `matrix/FORMULATOR_decision_table_v5.xlsx` | The **signed-off decision record** (Krantik, 15 Jul 2026). Sheet *"1. Decision Table v5"* = `A1:J133` ≈ **129 rows × 10 cols**. Per CLAUDE.md, `matrix/` records win over code. | Indirectly (upstream of regeneration) |
| `FORMAT_MATRIX_SOURCE.csv` | **NOT IN THE REPO.** A *"different project (34 products, 238 cells, built 13 Jul for the pillar-page matrix + homepage widget)"* — `docs/herbuno-matrix_PARITY_REPORT.md` §1. | No |
| `matrix/format_mapping_v2.csv` | 219 rows of product×role×format-code **tier mappings** (the format-ladder, ADR-011). | Indirectly (ladder tiers) |
| `javascript/herbuno-matrix.js` | The in-repo **runtime matrix artifact** (`window.HB_MX`, 129 cells, schema `v8-ladder-ordered`, `source: "FORMULATOR_decision_table_v5.xlsx + format_mapping_v2.csv…"`). | Yes (via generator) |
| `worker/data/matrix.json` | The **generated bundle** (`matrix_version "v8-ladder-ordered"`) uploaded to KV. | **Yes — the live input** |

## 2. Transformation chain

```
FORMULATOR_decision_table_v5.xlsx  +  format_mapping_v2.csv
   │  mechanical regeneration, 15 Jul (external Python working state state2.pkl → _table2.json,
   │  NOT in repo; documented in docs/herbuno-matrix_PARITY_REPORT.md §2)
   ▼
javascript/herbuno-matrix.js          (window.HB_MX — 129 cells)
   │  worker/tools/generate_payloads.js buildMatrix()  (reads herbuno-matrix.js;
   │  injects `phase` from matrix/product_phase_map.json)
   ▼
worker/data/matrix.json               (matrix_version "v8-ladder-ordered")
   │  wrangler kv put  →  KV key  matrix:v8-ladder-ordered
   ▼
KV  →  worker/src/store.js getContext()  →  live Cloudflare Worker
```

## 3. Why 238 vs 129 — obsolete wrong-source file (not a migration)

`FORMAT_MATRIX_SOURCE.csv` was a **different project with 34 products** (pillar-page / homepage
widget). The old `herbuno-matrix.js` was mistakenly generated from it, and content **conflicted at
the definitional level** — e.g. `capsule|base` = *"the powder fill"* there vs *"N/A, the shell is
the body"* in v5. On 15 Jul, Krantik decided (Option 1) to rebuild `herbuno-matrix.js` from **v5
alone** — 39 products, 129 cells — carrying nothing over. **Distinguishing evidence:** 34 products
≠ 39 products; the two are different grids, not one grid with rows removed.

## 4. Owner-editable & authoritative going forward

- **Authority of record:** `FORMULATOR_decision_table_v5.xlsx` (signed off; `matrix/` wins).
- **Practical in-repo editable runtime artifact:** `javascript/herbuno-matrix.js` (what the generator
  reads; the xlsx→JS pipeline `state2.pkl`/`_table2.json` is **not in the repo**).
- The edit point going forward — *edit the workbook then regenerate* vs *edit `herbuno-matrix.js`
  directly* — is an owner decision, flagged not inferred.

## 5. Is the 238-model abandoned / does it hold na_tag / correct_format?

- **Abandoned / historical.** A different project, definitionally conflicting, rebuilt away on 15 Jul,
  and **not in the repo**. Nothing to migrate from.
- **`na_tag` / `correct_format`: absent from both models.** The 238-model's richer fields were
  `hard_gate` arrays, per-format disqualification maps, `common_mistake` text, free-text role labels
  (`PARITY_REPORT` §1, §3b) — not `na_tag`/`correct_format`. Confirmed absent from the v5 xlsx
  sharedStrings too. The messaging taxonomy's fields exist in no current or historical artifact and
  must be **authored fresh** on the 129 cells.

## Decision-gate finding

The 129-cell v5 model is **confirmed canonical**; the 238-model is **abandoned** (different project).
No migration is pending. → Author the messaging taxonomy against the 129-cell runtime (Option 1),
as new owner-approved decision data in a versioned sidecar (`matrix/public_message_category_map.json`),
keyed to the 129 cells — never retrofitted into the v5 workbook.
