#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Supplier identity PENDING (supplier_id pending-mapping-01). Header row 1."""
import os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE = "Herbal Extract Product list - Supplier exists - pending mapping.xlsx"


def extract():
    rows, sha, _ = c.load_rows(FILE)
    raw = []
    for i in range(1, len(rows)):              # rows 2+  (S.NO | EXTRACT NAME | ASSAY/RATIO)
        row = rows[i]
        label = row[1] if len(row) > 1 else ""
        if not label or "EXTRACT NAME" in label.upper():
            continue
        raw.append({"label": label, "latin": None, "part_text": "",
                    "assay_raw": row[2] if len(row) > 2 else "", "source_row": i + 1})
    meta = {"supplier_id": "pending-mapping-01", "entity_id": "ent_pending_01",
            "source_family_id": "sf_pending_01", "public_or_private": "private", "source_file": FILE,
            "sha256": sha, "snapshot_date": "unknown",
            "known_catalogue_bias": "Largest extract list; trade labels, some Latin/vernacular in parens.",
            "notes": "Supplier identity PENDING confirmation — placeholder id pending-mapping-01."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
