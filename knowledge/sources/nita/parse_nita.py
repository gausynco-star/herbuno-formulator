#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Nita Trade. Dehydrated powders + freeze-dried. Header row 12; base MP (FD if freeze)."""
import os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE = "Nita Trade product List.xlsx"


def extract():
    rows, sha, _ = c.load_rows(FILE)
    raw = []
    for i in range(12, len(rows)):             # data from row 13
        row = rows[i]
        num = row[0] if row else ""
        label = row[1] if len(row) > 1 else ""
        if not label:
            continue
        if not c.is_num(num):                  # skip section headings / repeated headers (no SR.NO)
            continue
        raw.append({"label": label, "latin": None, "part_text": "", "assay_raw": "",
                    "source_row": i + 1})
    meta = {"supplier_id": "nita", "entity_id": "ent_nita", "source_family_id": "sf_nita",
            "public_or_private": "private", "source_file": FILE, "sha256": sha, "snapshot_date": "unknown",
            "base_default": "MP",
            "known_catalogue_bias": "Dehydrated powders + freeze-dried; heavy Hindi/vernacular naming.",
            "notes": "base MP (whole-material powder); freeze-dried -> FD. Vernacular common names."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
