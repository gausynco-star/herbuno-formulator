#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 ingest — Aethon essential oils (section 1.1). TWO side-by-side blocks; header row 16.
Left: S.No col 2, Name col 4, Origin col 19. Right: S.No col 35, Name col 41, Origin col 59."""
import os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "..", "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)
FILE = "Aethon - Catalogue -WP.xlsx"
BLOCKS = [(2, 4, 19), (35, 41, 59)]   # (S.No, Name, Origin) for left, right


def extract():
    rows, sha, _ = c.load_rows(FILE)
    raw = []
    for i in range(16, len(rows)):             # data from row 17
        r = rows[i]
        joined = " ".join(r)
        if "SECTION" in joined or joined.strip().startswith("Sr.") or "Cosmetic" in joined:
            break                              # end of section 1.1
        for sno, nname, sorig in BLOCKS:
            name = r[nname] if nname < len(r) else ""
            num = r[sno] if sno < len(r) else ""
            if name and c.is_num(num):
                raw.append({"label": name, "latin": None, "part_text": "",
                            "assay_raw": "", "origin": (r[sorig] if sorig < len(r) else "") or None,
                            "source_row": "r%d:%s" % (i + 1, num)})
    meta = {"supplier_id": "aethon", "entity_id": "ent_aethon", "source_family_id": "sf_aethon",
            "public_or_private": "private", "source_file": FILE, "sha256": sha, "snapshot_date": "unknown",
            "base_default": "EO",
            "known_catalogue_bias": "Essential oils (steam-distilled); country_of_origin recorded.",
            "notes": "Two side-by-side blocks in section 1.1; base EO; origin per row."}
    return meta, raw


if __name__ == "__main__":
    m, r = extract(); print(m["supplier_id"], "rows:", len(r))
