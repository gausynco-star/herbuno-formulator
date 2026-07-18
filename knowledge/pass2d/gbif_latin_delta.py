#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2d — GBIF authority on the LATIN delta candidates from the 6 private catalogues.

Runs GBIF only on the 216 latin-typed candidates in
knowledge/sources/enrichment_delta_candidates.json (common-only skipped — GBIF returns unknown
for vernacular names without a binomial). Same rules: accepted / synonym / typo / unknown; no
silent correction; provenance per result; ambiguity -> review; unknowns kept (never discarded).

Does NOT rebuild the backbone (a common-name round follows; one rebuild covers both).
Outputs: knowledge/pass2d/delta_authority_results.json, delta_review_queue.json
"""
import json, os, sys, importlib.util
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
_s = importlib.util.spec_from_file_location("ap2", os.path.join(K, "pass2", "authority_pass2.py"))
ap2 = importlib.util.module_from_spec(_s); _s.loader.exec_module(ap2)
QUERY_DATE = "2026-07-19"
SRC = os.path.join(K, "sources", "enrichment_delta_candidates.json")


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    cands = [c for c in src["candidates"] if c["type"] == "latin"]
    print("Pass 2d — GBIF on %d latin candidates (identity_version %s)" %
          (len(cands), src["_meta"]["built_against_identity_version"]))
    results, counts = [], Counter()
    review = {"ambiguous_synonyms": [], "typo_flags": []}
    for i, c in enumerate(cands, 1):
        name = c["candidate"]
        try:
            r = ap2.classify(name, ap2.gbif_match(name))
        except Exception as e:
            r = {"status": "unknown", "accepted_name": None, "match_type": "ERROR",
                 "match_confidence": None, "note": "query error: %s" % e, "ambiguous": False,
                 "candidate_accepted_names": [], "suggested_correction": None}
        counts[r["status"]] += 1
        rec = {"candidate": name, "suppliers": c.get("suppliers", []), "status": r["status"],
               "accepted_name": r.get("accepted_name"), "ambiguous": r.get("ambiguous", False),
               "candidate_accepted_names": r.get("candidate_accepted_names") or [],
               "suggested_correction": r.get("suggested_correction"), "match_type": r.get("match_type"),
               "match_confidence": r.get("match_confidence"), "authority": "GBIF backbone (species/match v1)",
               "query_date": QUERY_DATE, "note": r.get("note", "")}
        results.append(rec)
        if r["status"] == "synonym" and r.get("ambiguous"):
            review["ambiguous_synonyms"].append({"candidate": name, "candidates": rec["candidate_accepted_names"],
                "suppliers": rec["suppliers"], "note": "GBIF: multiple accepted names; owner must pick. Not merged."})
        elif r["status"] == "typo":
            review["typo_flags"].append({"candidate": name, "suggested_correction": r.get("suggested_correction"),
                "suppliers": rec["suppliers"], "note": "GBIF fuzzy near-match; NOT auto-applied."})
        if i % 25 == 0 or i == len(cands):
            ap2._save(ap2.MATCH_CACHE, ap2.match_cache)
            ap2._save(ap2.SPECIES_CACHE, ap2.species_cache)
            ap2._save(ap2.NAMEUSAGE_CACHE, ap2.nameusage_cache)
            print("  %d/%d  acc=%d syn=%d typo=%d unk=%d" % (i, len(cands), counts["accepted"],
                  counts["synonym"], counts["typo"], counts["unknown"]), flush=True)

    enrich = {}
    for r in results:
        if (r["status"] == "accepted" or (r["status"] == "synonym" and not r["ambiguous"])) and r["accepted_name"]:
            e = enrich.setdefault(r["accepted_name"], {"accepted_name": r["accepted_name"],
                "via": r["status"], "parsed_names": []})
            e["parsed_names"].append(r["candidate"])
    for e in enrich.values():
        e["parsed_names"] = sorted(set(e["parsed_names"]))

    doc = {"_meta": {"artifact": "ADR-013 Pass-2d GBIF on latin delta (6 private catalogues)",
                     "authority": "GBIF backbone (species/match v1)", "query_date": QUERY_DATE,
                     "built_against_identity_version": src["_meta"]["built_against_identity_version"],
                     "total": len(results), "counts": dict(counts), "enrichment_identities": len(enrich),
                     "note": "accepted + single-accepted synonym enrich the backbone (deduped by accepted "
                             "name). typo/ambiguous -> review. unknown -> quarantine. Backbone NOT rebuilt "
                             "here (common-name round follows; one rebuild covers both)."},
           "results": results, "enrichment": sorted(enrich.values(), key=lambda x: x["accepted_name"])}
    ap2._save(os.path.join(HERE, "delta_authority_results.json"), doc)
    ap2._save(os.path.join(HERE, "delta_review_queue.json"),
              {"_meta": {"query_date": QUERY_DATE, "ambiguous_synonyms": len(review["ambiguous_synonyms"]),
                         "typo_flags": len(review["typo_flags"]),
                         "note": "No silent correction. Ambiguous synonyms + typos await owner review."},
               **review})
    print("\nPASS 2d COMPLETE  accepted=%d synonym=%d typo=%d unknown=%d (of %d)" %
          (counts["accepted"], counts["synonym"], counts["typo"], counts["unknown"], len(results)))
    print("  enrichment identities (accepted + single-accepted synonym): %d" % len(enrich))
    print("  review: %d ambiguous, %d typo" % (len(review["ambiguous_synonyms"]), len(review["typo_flags"])))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
