#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2b — adopt GBIF accepted names for the synonym disagreements.

Owner decision (2026-07-18): for every Pass-2b entry where GBIF returned `synonym`
(gbif_recheck.status == "synonym"), switch the accepted identity to GBIF's accepted name and
keep the owner/trade name as a trade synonym.

Runs AFTER pass2b (recheck_pass2b.py) — switching names before the re-check would erase the
disagreements this step acts on. Idempotent, self-contained (reads gbif_recheck; no re-query).

Run:  python3 knowledge/pass2b/adopt_gbif.py
"""

import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.join(HERE, "..", "pass2", "pass2_review_queue.json")
DATE, BY = "2026-07-18", "owner"
PROV = "GBIF authority (Pass 2b), owner-adopted"


def main():
    with open(RQ, encoding="utf-8") as f:
        rq = json.load(f)

    adopted = []
    for listname in ("synonym_remaps", "unknown_quarantine", "typo_flags"):
        for e in rq[listname]:
            gr = e.get("gbif_recheck")
            if not gr or gr.get("status") != "synonym":
                continue
            acc = gr.get("gbif_accepted_name")
            owner = gr.get("queried_name")
            assert acc, "ambiguous GBIF accepted for %r — resolve manually" % owner
            e["accepted_name"] = acc
            ts = e.setdefault("trade_synonyms", [])
            if owner and owner not in ts:
                ts.append(owner)
            e["gbif_adopted"] = {"accepted_name": acc, "trade_synonym": owner,
                                 "resolved_by": BY, "date": DATE, "provenance": PROV}
            e["note"] = "Accepted name switched to GBIF's; '%s' kept as trade synonym." % owner
            adopted.append((listname, e.get("latin"), owner, acc))

    assert len(adopted) == 12, "expected 12 adoptions, got %d" % len(adopted)

    rq["_meta"]["gbif_adoption"] = {
        "date": DATE, "resolved_by": BY, "count": len(adopted),
        "note": "For Pass-2b synonym disagreements, accepted_name switched to GBIF's accepted name; "
                "owner/trade name kept in trade_synonyms. gbif_recheck and prior sign-off preserved.",
    }
    with open(RQ, "w", encoding="utf-8") as f:
        json.dump(rq, f, ensure_ascii=False, indent=2)

    L = ["# Pass-2b Adoption — GBIF Accepted Names (ADR-013)\n",
         "> Applied %s · %s. 12 synonym disagreements: accepted name switched to GBIF's; owner/trade "
         "name kept as trade synonym.\n" % (DATE, BY),
         "| owner / trade name | → adopted accepted name |", "|---|---|"]
    for _, _, owner, acc in sorted(adopted, key=lambda x: x[2]):
        L.append("| `%s` | **%s** |" % (owner, acc))
    L.append("")
    with open(os.path.join(HERE, "pass2b_adoption.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print("Adopted GBIF accepted names for %d synonym disagreements." % len(adopted))
    for _, _, owner, acc in sorted(adopted, key=lambda x: x[2]):
        print("  %-32s -> %s  (trade synonym: %s)" % (owner, acc, owner))


if __name__ == "__main__":
    main()
