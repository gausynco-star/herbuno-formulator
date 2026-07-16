# herbuno-matrix.js — Regeneration & Parity Report
**Date:** 15 Jul 2026
**Source of truth:** FORMULATOR_decision_table_v5.xlsx (signed off by Krantik, 15 Jul 2026)
**This report is separate from the table sign-off** — it covers code regeneration and parity only.

---

## 1. What changed and why

The previous `herbuno-matrix.js` was discovered, on inspection, to be generated from
**`FORMAT_MATRIX_SOURCE.csv`** — a different project (34 products, 238 cells, built 13 Jul for
the pillar-page matrix + homepage widget) — not from the Formulator's own decision table.
Content conflicted at the definitional level for overlapping cells (example: `capsule|base`
meant "the powder fill" in the old file and "N/A, the shell is the body" in v5).

Per Krantik's decision (Option 1), this file is a **full rebuild from v5 alone.** Nothing from
the old `FORMAT_MATRIX_SOURCE.csv` lineage — hard-gate format-code arrays, per-format
disqualification-reason maps, common-mistake lines, free-text role labels — was carried over,
because none of that existed in or was reviewed as part of v5.

## 2. Regeneration method

Mechanical, script-generated from the same corrected working state used to build the v5
workbook (`state2.pkl` → `_table2.json` + the two correction rounds: aroma-diff tag/content,
spray/serum wording, tea/kashaya wording). No manual editing of the output file.

## 3. Schema (new — 5-field only)

```
window.HB_MX = {
  schema_version: "v5",
  source: "FORMULATOR_decision_table_v5.xlsx — signed off 15 Jul 2026",
  note: "...", // explains the missing hard-gate/disqualification-map fields
  product_count: 39,
  row_count: 129,
  fam: [
    [fam_id, fam_name, [
      [product_id, product_name, tag_code, tag_label, {
        role_id: [rec, acc, avoid, reason, qualifier, na_flag, role_label]
      }]
    ]]
  ]
}
```

Role keys match the old file's convention (`base`, `active`, `functional`, `flavour`,
`carrier`, `colour`, `texture`) for compatibility. `FUNCTIONAL (fibre / bulking)` → `functional`.

**Fields NOT present** (existed in the old file, sourced from the wrong project):
`hard_gate` format-code array, per-format-code disqualification-reason map, standalone
`common_mistake` text. If `blend-builder.liquid` reads any of these for live SKU matching,
that logic will break against this file and needs separate rebuilding — see Section 6.

## 4. Coverage & Parity Results

| Check | Result |
|---|---|
| Products | 39 / 39 — matches v5 exactly |
| Rows | 129 / 129 — matches v5 exactly |
| Content parity (rec/acc/avoid/reason/qualifier, verbatim, all 129 rows) | **126/129 exact string match; 3/129 representational difference only** |
| Physics-class tag + label parity (all 39 products) | **0 mismatches** |
| JS syntax (`node --check`) | **PASS** |

Parity was checked programmatically field-by-field against the corrected source data — not
by inspection. **Correction (Krantik caught this):** the original version of this report claimed
"0 mismatches," which was not literally accurate. A full 129-row × 5-field audit against the
saved xlsx (not the pre-save Python data) found 3 cells — `softgel|base|qualifier`,
`tea|flavour|qualifier`, `balm|active|qualifier` — where the workbook stores `None` (blank cell)
and the JS stores `""` (empty string). Root cause: openpyxl silently converts an empty-string
write into a blank cell on save; the JS was generated from the pre-save data, so it's correct,
and the xlsx is the one with the representational quirk. Content is identical in both — "no
qualifier text" either way — but "0 mismatches" overstated what was actually tested, since the
comparison should be against the saved artifact, not an intermediate data structure.
**126/129 rows are exact string matches; the remaining 3 are None-vs-empty-string only, with
no content difference.**

## 3b. blend-builder.liquid compatibility — CONFIRMED INCOMPATIBLE (not just missing fields)

Static analysis of the `.liquid` file Krantik provided shows this is worse than "may silently
lose functionality." The product- and role-array field positions have changed meaning entirely,
not just lost extra fields:

| Position | Old schema (what the .liquid code reads) | New v5 schema (what's actually there) |
|---|---|---|
| `p[2]` | Physics description text (shown in `.bb-phys`) | Tag code (`"MD"`, `"DISP"`, etc.) |
| `p[3]` | Roles object | Tag label (`"Must-dissolve"`, a string) |
| `p[4]` | Phase code (`"dissolve"`, `"oil"`, ... — used to key the `WHY` lookup tables) | Roles object |
| `c[6]` (role-level) | Array of format codes that tier as "ok" (drives `tier()`) | **Does not exist** |
| `c[7]` (role-level) | Map of format-code → caveat text for "warn" tier | **Does not exist** |

Because `p[3]`/`p[4]` shift position, `PROD[id].roles` would be assigned a plain string
(`"Must-dissolve"`) instead of the roles object. The moment a product is selected, `P.roles[role]`
returns `undefined` (string-indexed-by-word), and the next line — `c[5]`, `c[0]`, etc. — throws
`TypeError: Cannot read properties of undefined`. **This is a hard crash on first product
selection, not a silent feature loss.** The `tier()` function (`c[6].indexOf(...)`) and the
`why()` disqualification-message lookups also have no data to read even if the crash were fixed,
since `c[6]`/`c[7]` don't exist in the v5 schema at all.

**This confirms: `blend-builder.liquid`, unmodified, cannot run against the regenerated
`herbuno-matrix.js`.** Deploying the new JS to the live theme asset without also rewriting the
`.liquid` file's data-access logic would break the tool immediately for every visitor.

## 5. Spot-checked corrections (all confirmed present in the output file)

- `aroma-diff` — tag `MD` / "Must-dissolve"; active & base rows carry the Krantik-supplied
  homogeneous-system text, not the old "Ask us, diffuser type determines the form" framing.
- `tea|base`, `kashaya|base` — reason text no longer contains "spent-material extract."
- `spray|active`, `serum|active` — Avoid text carries the "unless solubilised..." qualifiers.
- Five-row FUNCTIONAL ruling (capsule/tablet-dc/tablet-wg/bakery kept, lozenge-c → N/A) —
  present and correctly tagged.

## 6. NOT yet run / open items

These are the 5 post-regeneration tool tests named in the v5 workbook's Audit tab — they test
**runtime behaviour in `blend-builder.liquid`**, which this report cannot cover without that
file:

1. Format codes derived from product phase × role at runtime
2. Ratio interception (Camilla case) behaves correctly
3. Disqualification reasons are phase- and role-aware in the live tool
4. N/A roles are not offered as addable ingredients
5. RFQ path submits to Shopify's native `/contact#contact_form`

**Update — now confirmed, not hypothetical (see Section 3b):** `blend-builder.liquid` was
provided and inspected. It does not merely lose functionality against the new schema — it hard
crashes on first product selection, because product/role array field positions have shifted
meaning, not just dropped extra data. The 5 runtime tests above cannot be run at all until the
`.liquid` file's data-access logic is rebuilt against the new schema; there is no "test and see"
option with the file as it stands.

**Recommendation: do not deploy this file to the live theme asset.** `blend-builder.liquid`
needs a rewrite of its data-access layer (`tier()`, `why()`, the `PROD` assignment, and the
`c[6]`/`c[7]` hard-gate/caveat lookups) before the two files can work together. That rewrite is
new scoping work — deciding how tiering and disqualification messages work without the old
hard-gate arrays — not a mechanical port, and it hasn't been started.
