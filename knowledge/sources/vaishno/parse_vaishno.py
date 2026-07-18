#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Vaishno Herbal (files 1 + 2, ONE supplier / source_family sf_vaishno)."""
import os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE1 = "Product list vaishno herbal 1.xlsx"   # header row 2, data from row 4
FILE2 = "Product List vaishno herbal 2.xlsx"   # header row 1, data from row 2


def extract():
    raw = []
    r1, sha1, _ = c.load_rows(FILE1)
    for i in range(3, len(r1)):                # rows 4+  (S.NO | EXTRACT NAME | ASSAY/RATIO | APPEARANCE)
        row = r1[i]
        label = row[1] if len(row) > 1 else ""
        if not label or "EXTRACT NAME" in label.upper() or "IMPORTED EXTRACTS" in label.upper():
            continue
        raw.append({"label": label, "latin": None, "part_text": "",
                    "assay_raw": row[2] if len(row) > 2 else "", "source_row": ("f1:%d" % (i + 1))})
    r2, sha2, _ = c.load_rows(FILE2)
    for i in range(1, len(r2)):                # rows 2+  (EXTRACT NAME | ASSAY/RATIO | APPEARANCE)
        row = r2[i]
        label = row[0] if row else ""
        if not label or "EXTRACT NAME" in label.upper():
            continue
        raw.append({"label": label, "latin": None, "part_text": "",
                    "assay_raw": row[1] if len(row) > 1 else "", "source_row": ("f2:%d" % (i + 1))})
    meta = {"supplier_id": "vaishno", "entity_id": "ent_vaishno", "source_family_id": "sf_vaishno",
            "public_or_private": "private", "source_file": [FILE1, FILE2], "sha256": [sha1, sha2],
            "snapshot_date": "unknown", "known_catalogue_bias": "Imported + domestic extracts; trade labels, no Latin column.",
            "notes": "Two files, one supplier (sf_vaishno). Identity via common-name resolution."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
