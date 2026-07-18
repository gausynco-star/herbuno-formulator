#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2 — owner sign-off on the 20 ambiguous synonyms.

Applies recorded owner decisions to knowledge/pass2/pass2_review_queue.json:
 - 15 RESOLVED: set the chosen accepted name (identity kept).
 - 5 TRADE-AMBIGUOUS: status=trade_ambiguous; NOT auto-resolved; require source/provenance.

Every decision is stamped resolved_by=owner, date=2026-07-18, provenance="ChatGPT+owner review".
This is the auditable human-decision layer. authority_results.json (raw GBIF output) is left
unchanged on purpose — the machine record is immutable; sign-off lives in the review queue.

Idempotent: re-running applies the same decisions. Also writes pass2_signoff.md.

Run:  python3 knowledge/pass2/apply_signoff.py
"""

import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.join(HERE, "pass2_review_queue.json")

SIGNOFF = {"resolved_by": "owner", "date": "2026-07-18", "provenance": "ChatGPT+owner review"}

# latin -> {"accepted": <chosen accepted name>, "note": <optional>, "keep_original": <bool>}
RESOLVED = {
    "Acacia catechu": {"accepted": "Senegalia catechu"},
    "Acacia concinna": {"accepted": "Senegalia rugata"},
    "Allium porrum": {"accepted": "Allium porrum", "keep_original": True,
                      "note": "Keep original; Allium ampeloprasum complex."},
    "Cassia absus": {"accepted": "Chamaecrista absus"},
    "Citrus limetta": {"accepted": "Citrus ×limon", "note": "Retain trade name: sweet lime / mosambi."},
    "Garcinia cambogia": {"accepted": "Garcinia gummi-gutta"},
    "Holarrhena antidysenterica": {"accepted": "Holarrhena pubescens"},
    "Luffa cylindrica": {"accepted": "Luffa aegyptiaca"},
    "Orchis laxiflora": {"accepted": "Anacamptis laxiflora"},
    "Physalis alkekengi": {"accepted": "Alkekengi officinarum"},
    "Polygonum cuspidatum": {"accepted": "Reynoutria japonica"},
    "Polygonum viviparum": {"accepted": "Bistorta vivipara"},
    "Prunus dulcis": {"accepted": "Prunus amygdalus", "note": "Retain trade synonym Prunus dulcis."},
    "Solanum xanthocarpum": {"accepted": "Solanum virginianum"},
    "Zanthoxylum alatum": {"accepted": "Zanthoxylum armatum"},
}

# latin -> guidance (do NOT auto-resolve; require source/provenance before resolving)
TRADE_AMBIGUOUS = {
    "Cinnamomum cassia": "Homonym; Chinese cassia trade material ≠ Neolitsea. Keep controlled identity "
                         "\"Chinese cassia — Cinnamomum cassia/aromaticum\" pending source.",
    "Dolichos biflorus": "Indian horse gram / kulattha = Macrotyloma uniflorum (not in GBIF candidates); "
                         "strict Linnaean = Macrotyloma biflorum. Flag.",
    "Orchis latifolia": "Himalayan salam panja often Dactylorhiza hatagirea; require provenance.",
    "Phaseolus trilobus": "Indian Ayurvedic identity = Vigna trilobata (not in GBIF candidates); flag.",
    "Salvia haematodes": "Behman Surkh = Salvia pratensis subsp. haematodes; clary sage = S. sclarea; "
                         "require author/commodity.",
}


def main():
    with open(RQ, encoding="utf-8") as f:
        rq = json.load(f)

    entries = {s["latin"]: s for s in rq["synonym_remaps"]}
    ambiguous = {k for k, v in entries.items() if v.get("ambiguous") and not v.get("signoff")}
    # on a re-run, also allow re-stamping already-signed entries
    ambiguous |= {k for k, v in entries.items() if v.get("signoff")}

    # --- validation before mutating ---
    covered = set(RESOLVED) | set(TRADE_AMBIGUOUS)
    all_ambiguous = {k for k, v in entries.items() if v.get("ambiguous") or v.get("signoff")}
    missing = all_ambiguous - covered
    extra = covered - all_ambiguous
    assert not missing, "ambiguous entries with no decision: %s" % sorted(missing)
    assert not extra, "decisions for non-ambiguous latin: %s" % sorted(extra)
    assert len(covered) == 20, "expected 20 decisions, got %d" % len(covered)
    for latin, d in RESOLVED.items():
        e = entries[latin]
        if not d.get("keep_original"):
            assert d["accepted"] in e["candidate_accepted_names"], \
                "%s: chosen %r not in candidates %s" % (latin, d["accepted"], e["candidate_accepted_names"])

    # --- apply RESOLVED ---
    for latin, d in RESOLVED.items():
        e = entries[latin]
        e["accepted_name"] = d["accepted"]
        e["ambiguous"] = False
        e["signoff"] = {"status": "resolved", "decision": d["accepted"], **SIGNOFF}
        e["note"] = "Owner-resolved from ambiguous candidates." + (" " + d["note"] if d.get("note") else "")

    # --- apply TRADE_AMBIGUOUS ---
    for latin, guidance in TRADE_AMBIGUOUS.items():
        e = entries[latin]
        e["status"] = "trade_ambiguous"
        e["accepted_name"] = None
        e["ambiguous"] = True
        e["signoff"] = {"status": "trade_ambiguous", "requires": "source/provenance before resolving",
                        "guidance": guidance, **SIGNOFF}
        e["note"] = "Trade-ambiguous — NOT auto-resolved; requires source/provenance."

    # --- meta ---
    rq["_meta"]["owner_signoff"] = {
        "date": SIGNOFF["date"], "resolved_by": SIGNOFF["resolved_by"], "provenance": SIGNOFF["provenance"],
        "ambiguous_total": 20, "resolved": len(RESOLVED), "trade_ambiguous": len(TRADE_AMBIGUOUS),
        "ambiguous_remaining": 0,
        "note": "Decisions applied to synonym_remaps. authority_results.json (raw GBIF output) left "
                "unchanged — this is the human sign-off layer.",
    }

    with open(RQ, "w", encoding="utf-8") as f:
        json.dump(rq, f, ensure_ascii=False, indent=2)

    # --- pass2_signoff.md (human-readable audit) ---
    L = ["# Pass-2 Owner Sign-off — Ambiguous Synonyms (ADR-013)\n",
         "> Applied %s · resolved_by **%s** · provenance _%s_.\n" %
         (SIGNOFF["date"], SIGNOFF["resolved_by"], SIGNOFF["provenance"]),
         "20 ambiguous synonyms adjudicated: **%d resolved**, **%d trade-ambiguous** (held for source/provenance).\n"
         % (len(RESOLVED), len(TRADE_AMBIGUOUS)),
         "## Resolved (accepted name applied)",
         "| # | original | → accepted name | note |", "|--:|---|---|---|"]
    for i, (latin, d) in enumerate(sorted(RESOLVED.items()), 1):
        L.append("| %d | `%s` | **%s** | %s |" % (i, latin, d["accepted"], d.get("note", "")))
    L.append("\n## Trade-ambiguous (NOT resolved — require source/provenance)")
    L.append("| # | original | candidates (GBIF) | owner guidance |")
    L.append("|--:|---|---|---|")
    for i, (latin, g) in enumerate(sorted(TRADE_AMBIGUOUS.items()), 1):
        cands = ", ".join(entries[latin]["candidate_accepted_names"])
        L.append("| %d | `%s` | %s | %s |" % (i, latin, cands, g))
    L.append("")
    with open(os.path.join(HERE, "pass2_signoff.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print("Owner sign-off applied: %d resolved, %d trade_ambiguous, 0 ambiguous remaining." %
          (len(RESOLVED), len(TRADE_AMBIGUOUS)))
    print("Updated pass2_review_queue.json; wrote pass2_signoff.md.")


if __name__ == "__main__":
    main()
