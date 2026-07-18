#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 — build the common-only manual-mapping worklist.

Combines the unresolved common-only candidates from the private-catalogue ingest + the Pass-2c
e-commerce delta, ranks by supplier-row references, and filters out generic label artifacts /
non-botanical fragments. Filter tuned to avoid false positives (see FILTER NOTES).

Output: knowledge/sources/common_only_worklist.md
"""
import json, os, glob, importlib.util
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
spec = importlib.util.spec_from_file_location("common", os.path.join(HERE, "common.py"))
cm = importlib.util.module_from_spec(spec); spec.loader.exec_module(cm)
norm, bp3 = cm.norm, cm.bp3

# ---- filter token sets ----
# FILTER NOTES:
#  - "tea" is NOT in DESC (White/Green/Black Tea are Camellia sinensis, a real botanical).
#  - "egg" is NOT a NONBOT token (Canistel Egg = Pouteria campechiana); only the whole-string
#    "egg shell" is excluded (in WHOLE_STRING_DROP).
#  - "paneer" is NOT a NONBOT token (Paneer Dodi = Withania coagulans; not the dairy sense).
DESC = set(bp3.PART_WORDS) | bp3.FORM_WORDS | {
    "freeze", "cold", "coldpressed", "pressed", "extra", "virgin", "granular", "vegan", "natural",
    "soluble", "soluable", "fine", "coarse", "steel", "dry", "organic", "i", "p", "n", "sp", "hcl",
    "cut", "whole", "dried", "spray"}
GENERIC = {"black", "white", "red", "green", "blue", "yellow", "golden", "wild", "giant", "dwarf",
    "sweet", "bitter", "thai", "borneo", "da", "pure", "raw", "hot", "king", "baby", "purple", "narrow"}
NONBOT = {"mineral", "paraffin", "talc", "pumice", "bentonite", "calamine", "plaster", "paris", "salt",
    "sea", "celtic", "multani", "shilajit", "shilajeet", "aqua", "honey", "beeswax", "propolis", "krill",
    "emu", "collagen", "cheese", "curd", "yeast", "milk", "cream", "soap", "vinegar", "wax", "acid",
    "vitamin", "caffeine", "menthol", "xylitol", "erythritol", "xanthan", "citric", "mandelic", "ferulic",
    "glycine", "glucosamine", "inositol", "phosphatidylcholine", "squalane", "hemisqualene", "ceramide",
    "dermapeptide", "carotene", "astaxanthin", "resveratrol", "quercetin", "hesperidin", "diosmin",
    "diosmetin", "naringin", "piperine", "piperrine", "curcumin", "berberin", "berberine", "harmala",
    "harmaline", "glutathione", "lycopene", "lutein", "thaumatin", "synephrine", "emodin", "matrine",
    "khellin", "polydatin", "betaine", "sophoricoside", "kaempferol", "genistein", "equol", "mannose",
    "dim", "dha", "propanediol", "phytosterols", "glycerin", "oils", "complex", "protein", "fiber",
    "fibre", "starch", "flour", "meal", "cake", "sugar", "jaggery"}
EXPLICIT = {"freeze dried", "extract powder", "grape", "passion", "black", "bill", "omega", "soap"}
WHOLE_STRING_DROP = {"egg shell"}   # non-botanical whole strings (whole-token context only)


def keep(k):
    if k in EXPLICIT or k in WHOLE_STRING_DROP:
        return False
    toks = k.split()
    if any(t in NONBOT for t in toks):
        return False
    content = [t for t in toks if t not in DESC]
    if not content:
        return False
    if all(t in GENERIC for t in content):
        return False
    return len(k) > 2


def main():
    seen = {}
    for c in json.load(open(os.path.join(HERE, "enrichment_delta_candidates.json")))["candidates"]:
        if c["type"] == "common_only":
            seen.setdefault(norm(c["candidate"]), c["candidate"])
    for c in json.load(open(os.path.join(K, "pass2c", "delta_candidates.json")))["candidates"]:
        if c["type"] == "common_only":
            seen.setdefault(norm(c["candidate"]), c["candidate"])
    count = Counter()
    for f in glob.glob(os.path.join(HERE, "*", "*_rows.json")):
        for row in json.load(open(f))["rows"]:
            if row["canonical_id"] is None and row["match_method"] == "unresolved" and not row["normalized_botanical_name"]:
                k = norm(cm.clean_label(row["supplier_product_label"]))
                if k in seen:
                    count[k] += 1
    for c in json.load(open(os.path.join(K, "pass2c", "delta_candidates.json")))["candidates"]:
        k = norm(c["candidate"])
        if k in seen:
            count[k] += sum(c.get("suppliers", {}).values())

    ranked = sorted((k for k in seen if keep(k)), key=lambda k: (-count[k], seen[k].lower()))
    idv = json.load(open(os.path.join(K, "identity", "botanical_identity.json")))["_meta"]["identity_version"]
    L = ["# Common-only Worklist — manual binomial mapping (ADR-013)\n",
         "> Unresolved common/vernacular names with no Latin binomial. Ranked by supplier-row references.",
         "> Built against identity_version `%s` by build_worklist.py. Fill the binomial after each `->`.\n" % idv,
         "Format: `N. Name [supplier-row count] -> <accepted binomial>`\n", "**%d names.**\n" % len(ranked)]
    L += ["%d. %s [%d] -> " % (i, seen[k], count[k]) for i, k in enumerate(ranked, 1)]
    open(os.path.join(HERE, "common_only_worklist.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("worklist: %d names (identity_version %s)" % (len(ranked), idv))
    for chk in ["Canistel Egg", "Paneer Dodi Phool", "White Tea", "Egg Shell"]:
        k = norm(chk)
        print("  %-20s kept=%s" % (chk, k in seen and keep(k)))


if __name__ == "__main__":
    main()
