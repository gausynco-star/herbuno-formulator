#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Herbal Creative. Columns DRIFT across pages (PDF->XLSX). Row-scan:
the product cell carries the Latin in parens; part/marker/limits found by pattern per row."""
import os, re, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE = "Herbal Creative Product List.xlsx"
METHOD_W = ("gravimetric", "gravimetr", "hplc", "gc", "uv", "titration", "titrimetric")
HDR = ("PRODUCT NAME", "BIO-MARKER", "PRODUCT RANGE", "METHOD OF ANALYSIS", "S.NO")


def extract():
    rows, sha, _ = c.load_rows(FILE)
    raw = []
    for i in range(8, len(rows)):
        row = rows[i]
        vals = [v for v in row if v]
        if not vals:
            continue
        up = " ".join(row).upper()
        if any(h in up for h in HDR):
            continue
        # product cell: contains "(" with letters (name + Latin in parens)
        prod = next((v for v in row if "(" in v and re.search(r"[A-Za-z]", v) and len(v) > 4), None)
        if not prod:
            continue
        part = c.plant_part(*row)["raw"]
        limits = next((v for v in row if re.search(r"\d+\s*%", v) or re.fullmatch(r"0?\.\d+", v.strip())), "")
        # marker: an alpha cell that isn't the product, a part word, or a method word
        marker = ""
        for v in row:
            vl = v.lower().strip()
            if v is prod or not re.fullmatch(r"[A-Za-z ]{3,}", v.strip()):
                continue
            if vl in c.PART_WORDS or any(w in vl for w in METHOD_W) or vl == part:
                continue
            marker = v.strip(); break
        assay = " ".join(x for x in [marker, limits] if x)
        raw.append({"label": prod, "latin": None, "part_text": part or "",
                    "assay_raw": assay, "source_row": i + 1})
    meta = {"supplier_id": "herbal_creative", "entity_id": "ent_herbal_creative",
            "source_family_id": "sf_herbal_creative", "public_or_private": "private", "source_file": FILE,
            "sha256": sha, "snapshot_date": "unknown",
            "known_catalogue_bias": "Standardised herbal extracts; Latin in product-name parens; column drift.",
            "notes": "Row-scan (columns drift across pages); Latin from parens; marker+limits -> assay."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
