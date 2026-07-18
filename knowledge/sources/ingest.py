#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 — combined ingest driver for the 6 private supplier catalogues.

Verifies files (fail-loud via common.load_rows), runs each per-supplier parser, resolves against
the FROZEN backbone, writes per-supplier outputs + the combined ingest_report.md +
enrichment_delta_candidates.json. Does NOT run GBIF or rebuild the backbone (that is the later
delta -> rebuild -> version-bump step). Private data: raw files stay off-repo.
"""
import os, importlib.util, json
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("common", os.path.join(HERE, "common.py"))
c = importlib.util.module_from_spec(_s); _s.loader.exec_module(c)

PARSERS = [("sangam", "sangam/parse_sangam.py"),
           ("herbal_creative", "herbal_creative/parse_herbal_creative.py"),
           ("vaishno", "vaishno/parse_vaishno.py"),
           ("pending_mapping_01", "pending_mapping_01/parse_pending.py"),
           ("aethon", "aethon/parse_aethon.py"),
           ("nita", "nita/parse_nita.py")]


def load(path):
    sp = importlib.util.spec_from_file_location("p_" + path.replace("/", "_"), os.path.join(HERE, path))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
    return m


def main():
    id_version, exact, common, genera = c.load_backbone()
    print("Resolving against identity_version %s (%d exact keys)" % (id_version, len(exact)))
    summaries = []
    for sid, path in PARSERS:
        meta, raw = load(path).extract()
        out_dir = os.path.join(HERE, sid)
        s = c.process_supplier(meta, raw, exact, common, genera, id_version, out_dir)
        summaries.append(s)
        print("  %-20s rows=%-4d resolved=%-4d (%.0f%%) ambiguous=%d unresolved=%d ocr_fixes=%d" % (
            sid, s["rows"], s["resolved"], s["identity_resolution_rate"] * 100, s["ambiguous"],
            s["unresolved"], len(s["ocr_fixes"])))

    # ---- enrichment delta (dedupe unresolved across suppliers) ----
    delta = {}
    for s in summaries:
        for u in s["unresolved_candidates"]:
            k = c.norm(u["candidate"])
            if not k:
                continue
            rec = delta.setdefault(k, {"candidate": u["candidate"], "type": u["type"],
                                       "suppliers": set(), "labels": []})
            rec["suppliers"].add(u["supplier_id"])
            if u["type"] == "latin" and rec["type"] == "common_only":
                rec["type"] = "latin"; rec["candidate"] = u["candidate"]
            if len(rec["labels"]) < 3:
                rec["labels"].append(u["label"])
    records = [{"candidate": r["candidate"], "type": r["type"], "suppliers": sorted(r["suppliers"]),
                "example_labels": r["labels"]} for r in delta.values()]
    latin = [r for r in records if r["type"] == "latin"]
    common_only = [r for r in records if r["type"] == "common_only"]
    c._dump(os.path.join(HERE, "enrichment_delta_candidates.json"),
            {"_meta": {"artifact": "ADR-013 enrichment delta from 6 private supplier catalogues",
                       "built_against_identity_version": id_version, "total": len(records),
                       "latin": len(latin), "common_only": len(common_only),
                       "note": "Unresolved botanicals from private suppliers. Feed a later GBIF (Pass-2c) "
                               "-> backbone rebuild -> identity_version bump. NOT run here."},
             "candidates": sorted(records, key=lambda r: (r["type"], r["candidate"]))})

    _report(summaries, id_version, records, latin, common_only)
    _registry(summaries, id_version)

    print("\nENRICHMENT DELTA (not GBIF'd here): %d distinct (latin %d, common_only %d)" %
          (len(records), len(latin), len(common_only)))
    fams = {s["meta"]["source_family_id"] for s in summaries}
    print("NEW independent source families ingested: %d (%s)" % (len(fams), ", ".join(sorted(fams))))
    print("Independent source families now available (with existing sf_thewholesaler): %d" % (len(fams) + 1))


def _report(summaries, id_version, records, latin, common_only):
    L = ["# Ingest Report — 6 Private Supplier Catalogues (ADR-013)\n",
         "> INTERNAL. Supplier identity + counts are internal; never reach a storefront asset. Resolved",
         "> against frozen identity_version `%s`. No prevalence language. Backbone not edited.\n" % id_version,
         "## Per-supplier resolution"]
    L.append("| supplier | family | private | rows | resolved | id_rate | ambiguous | unresolved | ocr_fixes |")
    L.append("|---|---|---|--:|--:|--:|--:|--:|--:|")
    for s in summaries:
        m = s["meta"]
        L.append("| %s | %s | %s | %d | %d | %.0f%% | %d | %d | %d |" % (
            m["supplier_id"], m["source_family_id"], m["public_or_private"], s["rows"], s["resolved"],
            s["identity_resolution_rate"] * 100, s["ambiguous"], s["unresolved"], len(s["ocr_fixes"])))
    L.append("\n### match methods")
    for s in summaries:
        L.append("- **%s**: %s" % (s["meta"]["supplier_id"],
                 ", ".join("%s=%d" % (k, v) for k, v in sorted(s["match_methods"].items()))))
    L.append("\n### format distribution")
    for s in summaries:
        L.append("- **%s**: %s" % (s["meta"]["supplier_id"],
                 ", ".join("%s=%d" % (k, v) for k, v in sorted(s["fmt_dist"].items())) or "—"))
    L.append("\n### plant-part distribution")
    for s in summaries:
        L.append("- **%s**: %s" % (s["meta"]["supplier_id"],
                 ", ".join("%s=%d" % (k, v) for k, v in sorted(s["part_dist"].items())) or "—"))
    all_fixes = [f for s in summaries for f in s["ocr_fixes"]]
    L.append("\n## OCR fixes applied (full list — %d, logged never silent)" % len(all_fixes))
    if all_fixes:
        L.append("| supplier | kind | before | after |")
        L.append("|---|---|---|---|")
        for f in all_fixes:
            L.append("| %s | %s | `%s` | `%s` |" % (f["supplier_id"], f["kind"], f["before"], f["after"]))
    else:
        L.append("_none_")
    L.append("\n## Enrichment delta (NEW botanicals -> Pass-2c)")
    L.append("| metric | value |")
    L.append("|---|--:|")
    L.append("| distinct new botanicals (unresolved) | **%d** |" % len(records))
    L.append("| with Latin binomial | %d |" % len(latin))
    L.append("| common-only (need Latin) | %d |" % len(common_only))
    L.append("")
    L.append("These feed a later GBIF (Pass-2c) -> backbone rebuild -> identity_version bump. NOT run here.")
    L.append("")
    L.append("## Independent source families")
    fams = sorted({s["meta"]["source_family_id"] for s in summaries})
    L.append("6 NEW genuinely-independent private families ingested: %s." % ", ".join("`%s`" % f for f in fams))
    L.append("With the existing `sf_thewholesaler`, **%d independent source families** are now available "
             "for cross-source corroboration once Pass 3 is re-run against the enriched backbone." % (len(fams) + 1))
    L.append("")
    L.append("## Honesty")
    L.append("- Supplier label ≠ physical fact · absence ≠ nonexistence · no prevalence/market-share language.")
    L.append("- Supplier identity + counts INTERNAL_ONLY. Raw catalogue files stay OFF-repo (gitignored, SHA-256).")
    L.append("- Frozen backbone not edited. Pass 3 not re-run yet (per scope).")
    L.append("")
    open(os.path.join(HERE, "ingest_report.md"), "w", encoding="utf-8").write("\n".join(L))


def _registry(summaries, id_version):
    reg = []
    for s in summaries:
        m = s["meta"]
        reg.append({k: m.get(k) for k in ("supplier_id", "entity_id", "source_family_id",
                    "public_or_private", "source_file", "sha256", "snapshot_date",
                    "known_catalogue_bias", "notes")} | {
                    "rows": s["rows"], "identity_resolution_rate": s["identity_resolution_rate"]})
    c._dump(os.path.join(HERE, "supplier_registry.json"),
            {"_meta": {"identity_version": id_version, "visibility": "INTERNAL_ONLY",
                       "note": "Private supplier-shared catalogues. Raw files off-repo, referenced by SHA-256."},
             "suppliers": reg})


if __name__ == "__main__":
    main()
