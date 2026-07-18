#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ADR-013 Pass 2c — report writer. Run after gbif_delta.py + build_identity.py rebuild."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")


def main():
    cand = json.load(open(os.path.join(HERE, "delta_candidates.json"), encoding="utf-8"))["_meta"]
    auth = json.load(open(os.path.join(HERE, "delta_authority_results.json"), encoding="utf-8"))["_meta"]
    rev = json.load(open(os.path.join(HERE, "delta_review_queue.json"), encoding="utf-8"))["_meta"]
    bb = json.load(open(os.path.join(K, "identity", "botanical_identity.json"), encoding="utf-8"))["_meta"]
    c = auth["counts"]
    L = ["# Pass-2c Report — Backbone Enrichment Delta (ADR-013)\n",
         "> Delta-only enrichment from INDEPENDENT-family suppliers (not thewholesaler/Herbuno). GBIF",
         "> authority on the delta; same rules (accepted/synonym/typo/unknown, no silent correction).",
         "> The frozen backbone was NOT edited in place — it was rebuilt with the delta merged and",
         "> identity_version bumped.\n",
         "## Sources",
         "- Enrichment suppliers: %s" % ", ".join(cand["enrichment_sources"]),
         "- Excluded (same catalogue family sf_thewholesaler): %s" % ", ".join(cand["excluded_same_family"]),
         "- Named but absent on disk (not in registry): %s" % ", ".join(cand["absent_named_suppliers"]),
         "- All recorded supplier files verified present + SHA-256 unchanged before starting.\n",
         "## Delta candidates (before GBIF)",
         "| metric | value |", "|---|--:|",
         "| total distinct delta | %d |" % cand["total_delta"],
         "| latin binomial candidates | %d |" % cand["latin"],
         "| common-only candidates | %d |" % cand["common_only"], ""]
    L.append("Per-supplier (rows contributing a delta candidate):")
    L.append("| supplier | latin | common_only |")
    L.append("|---|--:|--:|")
    for sid, v in cand["per_supplier"].items():
        L.append("| %s | %d | %d |" % (sid, v.get("latin", 0), v.get("common_only", 0)))
    L.append("")
    L.append("## GBIF resolution split (the delta)")
    L.append("| status | count |")
    L.append("|---|--:|")
    for s in ("accepted", "synonym", "typo", "unknown"):
        L.append("| %s | %d |" % (s, c.get(s, 0)))
    L.append("")
    L.append("- **Enrichment identities** (accepted + single-accepted synonym, deduped by accepted "
             "name): **%d**" % auth["enrichment_identities"])
    L.append("- Ambiguous synonyms -> review: %d · typo flags -> review: %d (NOT applied)" %
             (rev["ambiguous_synonyms"], rev["typo_flags"]))
    L.append("- Unknown -> quarantine (kept, not discarded): %d" % c.get("unknown", 0))
    L.append("- **Note:** common-only candidates cannot be authority-checked by scientific-name match and")
    L.append("  land overwhelmingly in `unknown` — they need a Latin binomial before they can enrich. Kept.")
    L.append("")
    L.append("## Backbone rebuild (no in-place edit)")
    L.append("| field | value |")
    L.append("|---|---|")
    L.append("| new identity_version | `%s` |" % bb["identity_version"])
    L.append("| identity records (was 564) | %d |" % bb["identity_records"])
    L.append("| pass1 keys accounted | %d |" % bb["pass1_keys_accounted"])
    e = bb.get("pass2c_enrichment", {})
    L.append("| enrichment: new identities | %d |" % e.get("new_identities", 0))
    L.append("| enrichment: merged into existing | %d |" % e.get("merged_into_existing", 0))
    L.append("")
    L.append("Prior identity_version stays in git history (freeze policy: correct upstream -> rebuild -> "
             "bump version, never in-place). Downstream Pass-3 artifacts must re-join against the new version.")
    L.append("")
    open(os.path.join(HERE, "pass2c_report.md"), "w", encoding="utf-8").write("\n".join(L))
    print("wrote pass2c_report.md (new identity_version %s, +%d new / %d merged)" %
          (bb["identity_version"], e.get("new_identities", 0), e.get("merged_into_existing", 0)))


if __name__ == "__main__":
    main()
