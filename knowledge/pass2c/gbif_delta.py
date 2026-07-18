#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2c (Phase B) — GBIF authority on the enrichment delta only.

Reuses the Pass-2 classifier (accepted / synonym / typo / unknown; name-usage fallback for
ambiguous synonyms). Same rules: no silent correction, provenance per result, ambiguity to a
review queue, unknowns quarantined (never discarded). Only accepted + single-accepted synonym
candidates enrich the backbone; typo/ambiguous -> review; unknown -> quarantine.

Outputs: delta_authority_results.json, delta_review_queue.json
"""
import json, os, importlib.util
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
spec = importlib.util.spec_from_file_location("ap2", os.path.join(K, "pass2", "authority_pass2.py"))
ap2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(ap2)
QUERY_DATE = "2026-07-18"


def main():
    delta = json.load(open(os.path.join(HERE, "delta_candidates.json"), encoding="utf-8"))
    cands = delta["candidates"]
    results = []
    counts = Counter()
    review = {"ambiguous_synonyms": [], "typo_flags": []}
    quarantine = 0
    for i, c in enumerate(cands, 1):
        name = c["candidate"]
        try:
            m = ap2.gbif_match(name)
            r = ap2.classify(name, m)
        except Exception as e:
            r = {"status": "unknown", "accepted_name": None, "match_type": "ERROR",
                 "match_confidence": None, "note": "query error: %s" % e,
                 "ambiguous": False, "candidate_accepted_names": [], "suggested_correction": None}
        counts[r["status"]] += 1
        rec = {"candidate": name, "candidate_type": c["type"], "suppliers": list(c["suppliers"].keys()),
               "status": r["status"], "accepted_name": r.get("accepted_name"),
               "ambiguous": r.get("ambiguous", False),
               "candidate_accepted_names": r.get("candidate_accepted_names") or [],
               "suggested_correction": r.get("suggested_correction"),
               "match_type": r.get("match_type"), "match_confidence": r.get("match_confidence"),
               "authority": "GBIF backbone (species/match v1)", "query_date": QUERY_DATE,
               "note": r.get("note", "")}
        results.append(rec)
        if r["status"] == "synonym" and r.get("ambiguous"):
            review["ambiguous_synonyms"].append({"candidate": name, "candidates": rec["candidate_accepted_names"],
                "suppliers": rec["suppliers"], "note": "GBIF: multiple accepted names; owner must pick. Not merged."})
        elif r["status"] == "typo":
            review["typo_flags"].append({"candidate": name, "suggested_correction": r.get("suggested_correction"),
                "suppliers": rec["suppliers"], "note": "GBIF fuzzy near-match; NOT auto-applied."})
        elif r["status"] == "unknown":
            quarantine += 1
        if i % 100 == 0 or i == len(cands):
            ap2._save(ap2.MATCH_CACHE, ap2.match_cache)
            ap2._save(ap2.SPECIES_CACHE, ap2.species_cache)
            ap2._save(ap2.NAMEUSAGE_CACHE, ap2.nameusage_cache)
            print("  %d/%d  acc=%d syn=%d typo=%d unk=%d" % (i, len(cands), counts["accepted"],
                  counts["synonym"], counts["typo"], counts["unknown"]))

    # enrichment set = accepted + single-accepted synonym, deduped by accepted_name
    enrich = {}
    for r in results:
        if r["status"] == "accepted" and r["accepted_name"]:
            enrich.setdefault(r["accepted_name"], {"accepted_name": r["accepted_name"], "via": "accepted",
                "parsed_names": [], "common_suppliers": set()})["parsed_names"].append(r["candidate"])
        elif r["status"] == "synonym" and r["accepted_name"] and not r["ambiguous"]:
            enrich.setdefault(r["accepted_name"], {"accepted_name": r["accepted_name"], "via": "synonym",
                "parsed_names": [], "common_suppliers": set()})["parsed_names"].append(r["candidate"])
    for e in enrich.values():
        e["parsed_names"] = sorted(set(e["parsed_names"]))
        e.pop("common_suppliers", None)

    doc = {"_meta": {"artifact": "ADR-013 Pass-2c GBIF authority on enrichment delta",
                     "authority": "GBIF backbone (species/match v1)", "query_date": QUERY_DATE,
                     "total": len(results), "counts": dict(counts),
                     "enrichment_identities": len(enrich),
                     "note": "accepted + single-accepted synonym enrich the backbone (deduped by accepted "
                             "name). typo/ambiguous -> review (not applied). unknown -> quarantine (kept)."},
           "results": results, "enrichment": sorted(enrich.values(), key=lambda x: x["accepted_name"])}
    json.dump(doc, open(os.path.join(HERE, "delta_authority_results.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump({"_meta": {"query_date": QUERY_DATE,
                         "ambiguous_synonyms": len(review["ambiguous_synonyms"]),
                         "typo_flags": len(review["typo_flags"]),
                         "note": "No silent correction. Ambiguous synonyms + typos await owner review."},
               **review},
              open(os.path.join(HERE, "delta_review_queue.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print("\nPASS 2c GBIF COMPLETE")
    print("  accepted=%d synonym=%d typo=%d unknown=%d (of %d)" % (counts["accepted"], counts["synonym"],
          counts["typo"], counts["unknown"], len(results)))
    print("  enrichment identities (accepted + single-accepted synonym, deduped): %d" % len(enrich))
    print("  review: %d ambiguous-synonym, %d typo | quarantined unknown: %d" %
          (len(review["ambiguous_synonyms"]), len(review["typo_flags"]), quarantine))


if __name__ == "__main__":
    main()
