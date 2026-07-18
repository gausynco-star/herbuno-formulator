#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2c (Phase A) — extract backbone-enrichment DELTA candidates.  [FIX 1 applied]

From the INDEPENDENT-family suppliers (NOT thewholesaler/Herbuno), extract candidate botanical
identities that are NOT already resolvable against the FROZEN backbone.

FIX 1 (resolver):
  (a) format/form words are in the binomial species stoplist, so "Ginger Extract" can NEVER parse
      as a binomial (genus=Ginger, species=extract).
  (b) generate ALL candidates and resolve each; LONGEST-that-resolves wins (falling back to shorter
      only if nothing longer resolves). Avoids over-stripping ("Black Pepper"->"pepper").
  (c) ambiguity routes to a review queue (never a silent first-match).
Also benefits from FIX 2 (part-stripped derived common-name keys) via bp3.build_indices.

Scope: rows mapping to a botanical FORMAT only. Run before GBIF. Reuses Pass-3 config.
Outputs: delta_candidates.json, delta_extract_review.json, common_index_quarantine.json, tiebreak_examples.json
"""
import json, os, re, importlib.util
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
BACKBONE = os.path.join(K, "identity", "botanical_identity.json")

spec = importlib.util.spec_from_file_location("bp3", os.path.join(K, "pass3", "build_pass3.py"))
bp3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(bp3)
norm = bp3.norm

ENRICH = [s for s in bp3.SUPPLIERS if bp3.FAMILY_OF.get(s["entity_id"]) != "sf_thewholesaler"]

# FIX 1a — form/format/part words that must never be a binomial genus OR species
FORMPART = {"extract", "extracts", "powder", "powders", "liquid", "oil", "oils", "granules",
    "granulated", "dried", "dry", "fresh", "whole", "cut", "sifted", "tincture", "concentrate",
    "concentrated", "isolate", "capsule", "capsules", "tablet", "tablets", "softgel", "juice",
    "paste", "resin", "gum", "flakes", "chips", "root", "roots", "bark", "leaf", "leaves", "seed",
    "seeds", "fruit", "flower", "flowers", "rhizome", "aerial", "herb", "oleoresins", "oleoresin"}
STOP = bp3.FORM_WORDS | set(bp3.PART_WORDS) | FORMPART | {
    "fragrance", "aroma", "diffuser", "inspired", "fresh", "million", "bliss", "ultra", "grade",
    "black", "white", "red", "green", "blue", "yellow", "golden", "wild", "sweet", "bitter",
    "organic", "natural", "pure", "raw", "food", "berry", "gel", "butter", "personal", "care"}
BINOM = re.compile(r"\b([A-Za-z][a-z]+)\s+([A-Za-z][a-z]{2,}(?:-[a-z]+)?)\b")


def gen(title):
    """Return (ordered_candidates, binomials, clean_core)."""
    t = re.sub(r"\([^)]*\)", " ", title)
    parens = re.findall(r"\(([^)]+)\)", title)
    t = re.sub(r"\b\d+(?:\.\d+)?\s*(?:ml|l|g|kg|gm|mg|oz|%|:1)\b", " ", t, flags=re.I)
    t = re.split(r"[|]", t)[0]
    t = re.sub(r"[-–—].*$", " ", t)
    toks = [w for w in re.split(r"[^A-Za-z]+", t) if w]
    binoms = []
    for m in BINOM.finditer(title):
        g, s = m.group(1), m.group(2)
        if g.lower() not in STOP and s.lower() not in STOP and len(s) >= 3:   # FIX 1a stoplist
            binoms.append(g.capitalize() + " " + s.lower())
    cands = list(binoms) + [p.strip() for p in parens]
    for k in range(len(toks), 0, -1):                # prefix n-grams, longest -> shortest
        cands.append(" ".join(toks[:k]))
    core = " ".join(t2 for t2 in toks if t2.lower() not in FORMPART) or (toks[0] if toks else "")
    # dedupe preserving order
    seen, out = set(), []
    for c in cands:
        cl = c.strip()
        if cl and cl.lower() not in seen:
            seen.add(cl.lower()); out.append(cl)
    return out, binoms, core


def resolve_label(title, exact, common):
    cands, binoms, core = gen(title)
    uniq, amb = [], []
    for c in cands:
        n = norm(c)
        nt = len(n.split())
        if n in exact:
            uniq.append((nt, 2, exact[n][2], c, exact[n][1], n))
        elif n in common:
            ids = common[n]
            if len(ids) == 1:
                uniq.append((nt, 1, next(iter(ids)), c, "common_name_exact_unique", n))
            else:
                amb.append((nt, sorted(ids), c))
    if uniq:
        pick = max(uniq, key=lambda x: (x[0], x[1]))          # FIX 1b: longest-that-resolves (exact tiebreak)
        short = min(uniq, key=lambda x: (x[0], -x[1]))
        return {"status": "resolved", "cid": pick[2], "method": pick[4], "matched": pick[3],
                "derived": pick[5] in bp3.DERIVED_COMMON_KEYS,
                "short_cid": short[2], "short_matched": short[3]}
    if amb:
        pick = max(amb, key=lambda x: x[0])                    # FIX 1c: ambiguity -> review
        return {"status": "ambiguous", "candidates": pick[1], "matched": pick[2]}
    return {"status": "unresolved", "binom": (binoms[0] if binoms else None), "core": core}


def main():
    backbone = json.load(open(BACKBONE, encoding="utf-8"))
    exact, common = bp3.build_indices(backbone)
    idv = backbone["_meta"]["identity_version"]

    delta = {}
    per_sup = defaultdict(lambda: {"latin": 0, "common_only": 0})
    review, tiebreaks = [], []
    recovered = []
    stats = Counter()

    import csv
    for sup in ENRICH:
        with open(sup["file"], newline="", encoding="utf-8-sig") as fh:
            r = csv.DictReader(fh)
            tcol = next((c for c in r.fieldnames if c and c.strip().lower() == "type"), "Type")
            for row in r:
                typ = (row.get(tcol) or "").strip()
                title = (row.get("Title") or "").strip()
                if not typ or not title or bp3.normalize_format(typ, title, sup["TYPE_MAP"]) is None:
                    continue
                res = resolve_label(title, exact, common)
                stats[res["status"]] += 1
                if res["status"] == "resolved":
                    if res["short_cid"] != res["cid"]:        # tiebreak did real work
                        tiebreaks.append({"title": title, "supplier": sup["supplier_id"],
                                          "longest": {"matched": res["matched"], "cid": res["cid"]},
                                          "shortest": {"matched": res["short_matched"], "cid": res["short_cid"]}})
                    recovered.append({"title": title, "supplier": sup["supplier_id"], "cid": res["cid"],
                                      "method": res["method"], "via_derived_key": res["derived"]})
                    continue
                if res["status"] == "ambiguous":
                    review.append({"type": "ambiguous_common_name", "supplier_id": sup["supplier_id"],
                                   "title": title, "matched": res["matched"], "candidates": res["candidates"],
                                   "requires_owner_review": True})
                    continue
                # unresolved -> delta candidate (clean binomial or form/part-stripped core)
                cand = res["binom"] or res["core"]
                if not cand or len(norm(cand)) < 3:
                    continue
                ctype = "latin" if res["binom"] else "common_only"
                k = norm(cand)
                rec = delta.get(k)
                if not rec:
                    rec = delta[k] = {"candidate": cand, "type": ctype, "suppliers": {}, "example_titles": []}
                if ctype == "latin" and rec["type"] == "common_only":
                    rec["type"] = "latin"; rec["candidate"] = cand
                rec["suppliers"][sup["supplier_id"]] = rec["suppliers"].get(sup["supplier_id"], 0) + 1
                if len(rec["example_titles"]) < 3:
                    rec["example_titles"].append({"supplier": sup["supplier_id"], "title": title})
                per_sup[sup["supplier_id"]][ctype] += 1

    records = sorted(delta.values(), key=lambda r: (r["type"], r["candidate"]))
    latin = [r for r in records if r["type"] == "latin"]
    common_only = [r for r in records if r["type"] == "common_only"]

    def dump(name, obj):
        json.dump(obj, open(os.path.join(HERE, name), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    dump("delta_candidates.json", {"_meta": {
        "artifact": "ADR-013 Pass-2c delta candidates (backbone enrichment) [FIX 1+2]",
        "built_against_identity_version": idv, "enrichment_sources": [s["supplier_id"] for s in ENRICH],
        "excluded_same_family": ["thewholesaler.eu", "herbuno.own"],
        "resolution_stats": dict(stats), "recovered_now_resolved": len(recovered),
        "ambiguous_to_review": len(review), "tiebreak_diffs": len(tiebreaks),
        "total_delta": len(records), "latin": len(latin), "common_only": len(common_only)},
        "candidates": records})
    dump("delta_extract_review.json", {"_meta": {"built_against_identity_version": idv, "count": len(review),
        "note": "Ambiguous common-name resolutions routed to review (Fix 1c). Owner adjudicates."}, "entries": review})
    dump("tiebreak_examples.json", {"_meta": {"note": "Cases where longest-that-resolves picked a different "
        "identity than shortest would have (Fix 1b doing real work).", "count": len(tiebreaks)}, "examples": tiebreaks})
    dump("common_index_quarantine.json", {"_meta": {"source": "Fix 2 collision guard",
        "collisions": len(bp3.COMMON_INDEX_QUARANTINE)}, "quarantine": sorted(bp3.COMMON_INDEX_QUARANTINE,
        key=lambda q: q["stripped_key"])})

    print("PASS 2c EXTRACTION (Fix 1+2)  identity_version %s" % idv)
    print("  resolution: %s" % dict(stats))
    print("  recovered (now resolved, was delta): %d | ambiguous->review: %d | tiebreak diffs: %d" %
          (len(recovered), len(review), len(tiebreaks)))
    print("  delta now: %d (latin %d, common_only %d)" % (len(records), len(latin), len(common_only)))
    print("  via derived (Fix 2) keys: %d" % sum(1 for r in recovered if r["via_derived_key"]))


if __name__ == "__main__":
    main()
