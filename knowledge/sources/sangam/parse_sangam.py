#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Sangam Agro. Multiple sub-tables with DIFFERENT column positions
(PDF->XLSX drift). Re-detect columns at every header row that contains 'BOTANICAL'."""
import os, re, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE = "SANGAM AGRO CATALOUGE.xlsx"


def _col(header, *kws):
    for i, cell in enumerate(header):
        u = (cell or "").upper()
        if any(k in u for k in kws):
            return i
    return None


def extract():
    rows, sha, _ = c.load_rows(FILE)
    raw = []
    cols = None
    for i, row in enumerate(rows):
        up = " ".join(row).upper()
        if "BOTANICAL" in up:                       # header row -> (re)map columns for this section
            cols = {"label": _col(row, "HERBAL EXTRACTS", "HERBS"), "latin": _col(row, "BOTANICAL"),
                    "part": _col(row, "PART"), "ratio": _col(row, "RATIO", "CONCENTRA"),
                    "active": _col(row, "ACTIVE"), "method": _col(row, "METHOD")}
            continue
        if not cols:
            continue

        def g(k):
            j = cols.get(k)
            return row[j].strip() if j is not None and j < len(row) and row[j] else ""
        label, latin = g("label"), g("latin")
        if not label or label.upper() in ("HERBS", "SR NO", "HERBAL EXTRACTS"):
            continue
        if not latin and not g("part"):
            continue
        assay = ", ".join(x for x in [g("ratio"), g("active"), g("method")] if x)
        raw.append({"label": label, "latin": (latin if latin not in ("-", "*", "***") else None),
                    "part_text": g("part"), "assay_raw": assay, "source_row": i + 1})
    meta = {"supplier_id": "sangam", "entity_id": "ent_sangam", "source_family_id": "sf_sangam",
            "public_or_private": "private", "source_file": FILE, "sha256": sha, "snapshot_date": "unknown",
            "known_catalogue_bias": "Indian Ayurvedic herbal extracts; Latin + part + assay; multi-section sheet.",
            "notes": "Columns re-detected per section header (BOTANICAL); ratio+active combined into raw_assay_ratio."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
