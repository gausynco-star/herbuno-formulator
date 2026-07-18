#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2c (Phase A) — extract backbone-enrichment DELTA candidates.

From the INDEPENDENT-family suppliers (NOT thewholesaler/Herbuno), extract candidate botanical
identities that are NOT already resolvable against the FROZEN backbone. Latin binomials where
present; else the normalised common name. Dedupe across suppliers. Emits delta_candidates.json.

Scope: only rows that map to a botanical FORMAT (Pass-3 taxonomy) — excludes fragrance/finished/
non-botanical noise. Run before GBIF (Phase B). Reuses Pass-3 config + resolver.
"""
import json, os, re, importlib.util
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
BACKBONE = os.path.join(K, "identity", "botanical_identity.json")

spec = importlib.util.spec_from_file_location("bp3", os.path.join(K, "pass3", "build_pass3.py"))
bp3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(bp3)

# independent families only (exclude the backbone's own catalogue family sf_thewholesaler)
ENRICH = [s for s in bp3.SUPPLIERS if bp3.FAMILY_OF.get(s["entity_id"]) != "sf_thewholesaler"]

BINOM_CI = re.compile(r"\b([A-Za-z][a-z]+)\s+([A-Za-z][a-z]{2,}(?:-[a-z]+)?)\b")
STOP = bp3.FORM_WORDS | set(bp3.PART_WORDS) | {
    "fragrance", "aroma", "diffuser", "inspired", "fresh", "aquatic", "marine", "million", "bliss",
    "acqua", "aqua", "ultra", "coconut", "shell", "derived", "complex", "amplified", "peptide",
    "grade", "food", "berry", "gel", "butter", "clearance", "off", "personal", "care", "blend",
    "seed", "root", "bark", "leaf", "flower", "fruit", "powder", "oil", "extract",
    # English words that make a 'Genus species'-shaped phrase NOT a binomial
    "agar", "milk", "grass", "bean", "beans", "mushroom", "inulin", "flavonoid", "bitter", "sweet",
    "sour", "sprout", "sprouts", "hydroxy", "needle", "liquid", "sugar", "protein", "fiber", "fibre",
    "active", "alpha", "beta", "adzuki", "alfalfa", "almond", "juice", "meal", "flour", "starch",
    "bran", "hull", "pomace", "marc", "wax", "vera", "gum", "isolate", "vitamin", "acid", "green",
    "black", "white", "red", "yellow", "blue", "golden", "wild", "giant", "dwarf", "common"}


def is_latin_pair(g, s):
    return g.lower() not in STOP and s.lower() not in STOP and len(s) >= 4


def main():
    backbone = json.load(open(BACKBONE, encoding="utf-8"))
    exact, common = bp3.build_indices(backbone)

    def resolvable(nrm):
        return nrm in exact or (nrm in common and len(common[nrm]) == 1)

    delta = {}  # norm_name -> record
    per_sup = defaultdict(lambda: {"latin": 0, "common_only": 0})

    for sup in ENRICH:
        f = sup["file"]
        import csv
        with open(f, newline="", encoding="utf-8-sig") as fh:
            r = csv.DictReader(fh)
            tcol = next((c for c in r.fieldnames if c and c.strip().lower() == "type"), "Type")
            for row in r:
                typ = (row.get(tcol) or "").strip()
                title = (row.get("Title") or "").strip()
                if not typ or not title:
                    continue
                if bp3.normalize_format(typ, title, sup["TYPE_MAP"]) is None:
                    continue  # not a botanical format row
                found = None
                # 1) Latin binomial candidate
                for m in BINOM_CI.finditer(title):
                    g, s = m.group(1), m.group(2)
                    if not is_latin_pair(g, s):
                        continue
                    name = g.capitalize() + " " + s.lower()
                    nrm = bp3.norm(name)
                    if resolvable(nrm):
                        found = "resolved"; break
                    found = ("latin", name, nrm); break
                if found == "resolved":
                    continue
                if not found:
                    # 2) common-only candidate (first common candidate that isn't resolvable)
                    for kind, sname in bp3.title_candidates(title):
                        nrm = bp3.norm(sname)
                        if not nrm or len(nrm) < 3:
                            continue
                        if resolvable(nrm):
                            found = "resolved"; break
                        found = ("common_only", sname.strip(), nrm); break
                if not found or found == "resolved":
                    continue
                kind, name, nrm = found
                rec = delta.get(nrm)
                if not rec:
                    rec = delta[nrm] = {"candidate": name, "norm": nrm, "type": kind,
                                        "suppliers": {}, "example_titles": []}
                # a latin finding upgrades a common_only record
                if kind == "latin" and rec["type"] == "common_only":
                    rec["type"] = "latin"; rec["candidate"] = name
                rec["suppliers"][sup["supplier_id"]] = rec["suppliers"].get(sup["supplier_id"], 0) + 1
                if len(rec["example_titles"]) < 3:
                    rec["example_titles"].append({"supplier": sup["supplier_id"], "title": title})
                per_sup[sup["supplier_id"]][kind] += 1

    records = sorted(delta.values(), key=lambda r: (r["type"], r["candidate"]))
    latin = [r for r in records if r["type"] == "latin"]
    common_only = [r for r in records if r["type"] == "common_only"]

    doc = {"_meta": {
        "artifact": "ADR-013 Pass-2c delta candidates (backbone enrichment)",
        "built_against_identity_version": backbone["_meta"]["identity_version"],
        "enrichment_sources": [s["supplier_id"] for s in ENRICH],
        "excluded_same_family": ["thewholesaler.eu", "herbuno.own"],
        "absent_named_suppliers": ["vedaoils", "lotioncrafter"],
        "scope": "Rows mapping to a botanical format only; candidates NOT already resolvable in backbone.",
        "total_delta": len(records), "latin": len(latin), "common_only": len(common_only),
        "per_supplier": {k: dict(v) for k, v in per_sup.items()}},
        "candidates": records}
    json.dump(doc, open(os.path.join(HERE, "delta_candidates.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    print("DELTA CANDIDATES (before GBIF)")
    print("  total distinct delta: %d   (latin: %d, common_only: %d)" % (len(records), len(latin), len(common_only)))
    print("  per-supplier (rows contributing a delta candidate, latin/common_only):")
    for sid in [s["supplier_id"] for s in ENRICH]:
        v = per_sup.get(sid, {"latin": 0, "common_only": 0})
        print("    %-28s latin=%-5d common_only=%d" % (sid, v["latin"], v["common_only"]))
    print("\n  sample latin candidates:", ", ".join(r["candidate"] for r in latin[:12]))
    print("  sample common_only:", ", ".join(r["candidate"] for r in common_only[:12]))


if __name__ == "__main__":
    main()
