#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 — common-name mapping round.

Applies the owner's worklist common-name -> binomial mappings (common_name_mappings.txt):
 - applies the 2 corrections from common_name_review_queue.json (Giyol, Szechuan),
 - routes the 12 trade_ambiguous names (+ label variants) to UNRESOLVED (not resolved here),
 - groups the remaining clean mappings by binomial, stamping each: resolved_by=owner,
   provenance="owner botanical knowledge + trade review", accepted_outside_gbif_candidates=true,
   date=2026-07-19,
 - GBIF re-checks every applied binomial: confirmed / synonym / not_found (no silent correction).

Outputs: common_name_resolved_mappings.json (fed to build_identity.py), common_name_gbif_recheck.json
"""
import json, os, importlib.util, re
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
spec = importlib.util.spec_from_file_location("cm", os.path.join(HERE, "common.py"))
cm = importlib.util.module_from_spec(spec); spec.loader.exec_module(cm)
norm = cm.norm
_a = importlib.util.spec_from_file_location("ap2", os.path.join(K, "pass2", "authority_pass2.py"))
ap2 = importlib.util.module_from_spec(_a); _a.loader.exec_module(ap2)

DATE = "2026-07-19"
PROV = "owner botanical knowledge + trade review"


def main():
    rq = json.load(open(os.path.join(HERE, "common_name_review_queue.json"), encoding="utf-8"))
    corrections = {norm(c["common_name"]): c["corrected_binomial"] for c in rq["corrections"]}
    exclude = set()
    for t in rq["trade_ambiguous"]:
        exclude.add(norm(t["common_name"]))
        for v in t.get("source_label_variants", []):
            exclude.add(norm(v))

    resolved = defaultdict(set)   # binomial -> {common_names}
    excluded_names, corrected_names = [], []
    for line in open(os.path.join(HERE, "common_name_mappings.txt"), encoding="utf-8"):
        line = line.strip()
        if not line or "->" not in line:
            continue
        cn, binom = [x.strip() for x in line.split("->", 1)]
        ncn = norm(cn)
        if ncn in exclude:
            excluded_names.append(cn); continue
        if ncn in corrections:
            binom = corrections[ncn]; corrected_names.append((cn, binom))
        resolved[binom].add(cn)

    # ---- GBIF re-check every distinct binomial ----
    counts = Counter()
    recheck = {}
    for i, binom in enumerate(sorted(resolved), 1):
        try:
            r = ap2.classify(binom, ap2.gbif_match(binom))
        except Exception as e:
            r = {"status": "unknown", "accepted_name": None, "match_type": "ERROR", "note": str(e),
                 "suggested_correction": None, "ambiguous": False, "candidate_accepted_names": []}
        st = r["status"]
        status = "confirmed" if st == "accepted" else "synonym" if st == "synonym" else "not_found"
        counts[status] += 1
        recheck[binom] = {"status": status, "gbif_accepted_name": r.get("accepted_name"),
                          "gbif_status_raw": st, "match_type": r.get("match_type"),
                          "suggested_correction": r.get("suggested_correction"),
                          "ambiguous": r.get("ambiguous", False),
                          "candidate_accepted_names": r.get("candidate_accepted_names") or [],
                          "authority": "GBIF backbone (species/match v1)", "query_date": DATE}
        if i % 40 == 0 or i == len(resolved):
            ap2._save(ap2.MATCH_CACHE, ap2.match_cache); ap2._save(ap2.SPECIES_CACHE, ap2.species_cache)
            ap2._save(ap2.NAMEUSAGE_CACHE, ap2.nameusage_cache)
            print("  gbif %d/%d  confirmed=%d synonym=%d not_found=%d" %
                  (i, len(resolved), counts["confirmed"], counts["synonym"], counts["not_found"]), flush=True)

    mappings = {b: {"common_names": sorted(cns), "resolved_by": "owner", "provenance": PROV,
                    "accepted_outside_gbif_candidates": True, "date": DATE,
                    "gbif_recheck": recheck[b]} for b, cns in sorted(resolved.items())}
    doc = {"_meta": {"artifact": "ADR-013 common-name mapping round (owner-resolved)",
                     "date": DATE, "provenance": PROV,
                     "distinct_binomials": len(resolved), "clean_mappings_applied": sum(len(v) for v in resolved.values()),
                     "excluded_trade_ambiguous": len(excluded_names), "corrections_applied": len(corrected_names),
                     "gbif_recheck": dict(counts),
                     "note": "Owner binomials are authoritative (accepted_outside_gbif_candidates). GBIF "
                             "re-check flags disagreements; no silent correction (adoption is a later step)."},
           "corrections": corrected_names, "excluded_trade_ambiguous": sorted(excluded_names),
           "mappings": mappings}
    ap2._save(os.path.join(HERE, "common_name_resolved_mappings.json"), doc)

    disagree = {b: recheck[b] for b in recheck if recheck[b]["status"] != "confirmed"}
    ap2._save(os.path.join(HERE, "common_name_gbif_recheck.json"),
              {"_meta": {"date": DATE, "counts": dict(counts), "disagreements": len(disagree),
                         "note": "confirmed / synonym / not_found. Owner binomial stands; disagreements "
                                 "flagged for a later adoption decision (no silent correction)."},
               "disagreements": {b: recheck[b] for b in sorted(disagree)}})

    print("\nCOMMON-NAME MAPPING ROUND")
    print("  clean mappings applied: %d  ->  distinct binomials: %d" %
          (sum(len(v) for v in resolved.values()), len(resolved)))
    print("  corrections: %d  |  excluded (trade_ambiguous): %d" % (len(corrected_names), len(excluded_names)))
    print("  GBIF re-check: confirmed=%d synonym=%d not_found=%d (disagreements=%d)" %
          (counts["confirmed"], counts["synonym"], counts["not_found"], len(disagree)))


if __name__ == "__main__":
    main()
