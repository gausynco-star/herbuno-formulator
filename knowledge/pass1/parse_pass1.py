#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Verification Pipeline — Pass 1 (clean parse + parse-QA).

Turns ONE supplier catalogue (thewholesaler.eu) into a strictly Latin-keyed
botanical -> commercial-forms candidate dataset, with a parse-QA report and a
50-botanical cost measurement (the go/no-go gate for the programme).

This is a DATA-ENGINEERING artifact. It touches no runtime code. Its output is
UNVERIFIED candidate data by definition (Pass 2 authority cross-check comes later).

Rules enforced (ADR-013 §7 defects, §8 pipeline rules; BUILD_BRIEF §0-§7):
  - Key strictly by NORMALISED Latin binomial (Genus species). Common names are labels only.
  - No silent auto-merge: every case-variant merge / assay-in-Latin / multi-dash / no-Latin /
    near-duplicate is written to review_queue.json (applied merges are logged, not silent).
  - Provenance per observed form: source_supplier + observation_date.
  - Only rows whose supplier `Type` is in the normalisation map are processed for forms;
    everything else -> unmapped_types.json (split: out-of-scope non-forms vs candidate new codes).

Run:  python3 knowledge/pass1/parse_pass1.py
Reads the input path in CONFIG below (kept OUT of the repo; provenance + SHA-256 recorded).
"""

import csv, json, os, re, hashlib, collections

# ---------------------------------------------------------------------------
# CONFIG / provenance
# ---------------------------------------------------------------------------
HOME = os.path.expanduser("~")
CONFIG = {
    "source_supplier": "thewholesaler.eu",
    # Disambiguated by row count: this snapshot = 29,075 data rows ≈ brief's "~29k"
    # (the 2026-02-20 snapshot is 25.6k). Filename carries the snapshot date.
    "observation_date": "2026-06-13",
    "input_csv": os.path.join(HOME, "Downloads",
                              "allProducts[thewholesaler.eu]-2026-06-13T07-55-02.890Z.csv"),
}
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Normalisation map: literal supplier `Type` string -> Herbuno format code
# (ADR-013 §6 / BUILD_BRIEF §2 grouping labels expanded to the real literals).
# ---------------------------------------------------------------------------
TYPE_MAP = {
    "Extract Powder": "RE",
    "Herbal Powder": "MP", "Fruit Powder": "MP", "Vegetable Powder": "MP", "Spice Powder": "MP",
    "Water Soluble Extract": "WL",
    "Oil Soluble Extract": "OE",
    "Propylene Glycol Extract": "WL-glycol",
    "Glycerin Extract": "WL-glycerin",
    "Extract Paste": "RE-paste",
    "Oleoresin": "OLR",
    "Hydrosol": "HYD",
    "Infused Oil": "CO", "Carrier Oil": "CO",
    "Herb,Cut": "TC", "Tea & Infusions": "TC", "Dried Flowers, Cut": "TC",
    "Whole Herb": "WD", "Whole Spice": "WD", "Seeds": "WD", "Seed": "WD",
    "Root": "WD", "Dried Fruits": "WD", "Dried Flowers, Whole": "WD",
}
# Owner decision (this pass): NOT mapped, but flagged as candidate NEW format codes for
# later matrix review (adding codes is a separate matrix change, out of scope here).
CANDIDATE_NEW_CODE_TYPES = {"Essential Oil", "CO2 Extract"}

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------
DASH_SPLIT = re.compile(r"\s+[-‐‑‒–—―]\s+")  # dash surrounded by whitespace
CC_PREFIX = re.compile(r"^\s*\[[A-Za-z]{2,4}\]\s*")                          # [ID] / [TH] / [VN] country code
TRAIL_PAREN = re.compile(r"\s*\([^()]*\)\s*$")                               # trailing (...) group
BINOMIAL = re.compile(r"^([A-Za-z]+)[ ×]+([A-Za-z]+(?:-[A-Za-z]+)?)")   # Genus species (allow × hybrid, hyphenated epithet e.g. arbor-tristis)
ASSAY_HINT = re.compile(r"[%≥≤:]|\d|std|standardi|bacoside|triterpene|"
                        r"withanolide|curcumin|extract|ratio|rich", re.I)

# Tokens that are plant-parts / form words / colours — never a Latin genus or species epithet.
# Guards against false-positive "binomials" like "Loose Leaf", "Bay Leaves", "Root Cut".
FORM_WORDS = {
    "extract", "powder", "paste", "oil", "soluble", "water", "glycerin", "glycol", "infused",
    "carrier", "essential", "oleoresin", "hydrosol", "cut", "whole", "seed", "seeds", "root",
    "roots", "leaf", "leaves", "flower", "flowers", "dried", "tea", "loose", "yellow", "green",
    "red", "black", "white", "brown", "fruit", "fruits", "vegetable", "herbal", "spice", "spices",
    "herb", "herbs", "flakes", "bark", "co", "pg", "organic", "natural", "pure", "dry", "raw",
    "bay", "peel", "pericarp", "bran", "resin", "gum", "stick", "sticks", "coffee", "dates",
    "nuts", "cereal", "dairy", "shilajit", "incense",
    # connectives / prep-state words — never a Latin genus or species epithet
    "and", "or", "the", "of", "with", "in", "for", "bud", "buds", "tips", "sliced",
    "dehydrated", "fresh", "mix", "x",
}
FORM_PHRASES = [  # stripped from the common-name label (longest first)
    "Oil Soluble Extract", "Water Soluble Extract", "Propylene Glycol Extract", "Glycerin Extract",
    "CO2 Extract", "PG Extract", "Infused Oil", "Carrier Oil", "Essential Oil", "Extract Paste",
    "Extract Powder", "Oleoresin", "Hydrosol", "Extract", "Powder", "Paste",
]


def strip_trailing_parens(tok):
    """Remove trailing (...) groups; return (clean_token, [stripped_contents])."""
    stripped = []
    while True:
        m = TRAIL_PAREN.search(tok)
        if not m:
            break
        stripped.append(tok[m.start():m.end()].strip().strip("()").strip())
        tok = tok[:m.start()].rstrip()
    return tok, stripped


def normalise_latin(genus, species):
    return genus[0].upper() + genus[1:].lower() + " " + species.lower()


def clean_common(seg):
    seg = CC_PREFIX.sub("", seg).strip()
    for ph in FORM_PHRASES:
        seg = re.sub(r"\b" + re.escape(ph) + r"\b", "", seg, flags=re.I)
    seg = re.sub(r"\s*[,\-–]\s*$", "", seg)         # trailing comma/dash
    seg = re.sub(r"\s{2,}", " ", seg).strip(" ,-")
    return seg


def parse_title(title):
    """
    Returns dict: latin_key, latin_raw, common, cc, segments, flags(list of (reason, detail)).
    latin_key is None if no confident binomial could be parsed.
    """
    flags = []
    raw = title.strip()
    cc_m = CC_PREFIX.search(raw)
    cc = cc_m.group(0).strip() if cc_m else ""
    segs = DASH_SPLIT.split(raw)
    multi_dash = len(segs) >= 3

    # Scan segments from LAST to first; take the last that yields a binomial (§7.3).
    latin_key = latin_raw = None
    matched_index = None
    for i in range(len(segs) - 1, -1, -1):
        seg = segs[i].strip()
        core, parens = strip_trailing_parens(seg)
        m = BINOMIAL.match(core.strip())
        if not m:
            continue
        genus, species = m.group(1), m.group(2)
        if genus.lower() in FORM_WORDS or species.lower() in FORM_WORDS:
            # false-positive binomial (plant-part / form words) — reject, log
            flags.append(("suspicious_latin_rejected", "%s %s" % (genus, species)))
            continue
        latin_raw = core.strip()
        latin_key = normalise_latin(genus, species)
        matched_index = i
        # log any trailing paren we removed from the Latin token (assay vs name-in-paren)
        for p in parens:
            reason = "assay_in_latin" if ASSAY_HINT.search(p) else "name_in_latin_paren"
            flags.append((reason, p))
        break

    if latin_key is None:
        flags.append(("no_latin", raw))
        return {"latin_key": None, "latin_raw": None, "common": clean_common(segs[0]),
                "cc": cc, "flags": flags}

    # multi-dash where Latin was NOT the final segment -> uncertainty worth a human look
    if multi_dash and matched_index != len(segs) - 1:
        flags.append(("multi_dash_latin_not_final", " | ".join(segs)))

    common = clean_common(segs[0]) if matched_index != 0 else ""
    return {"latin_key": latin_key, "latin_raw": latin_raw, "common": common,
            "cc": cc, "flags": flags}


def lev1(a, b):
    """True if edit distance between a and b is <= 1 (used for near-duplicate species)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:  # one substitution
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    # one insertion/deletion
    if la > lb:
        a, b = b, a
        la, lb = lb, la
    i = j = diff = 0
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1; j += 1
        else:
            diff += 1; j += 1
            if diff > 1:
                return False
    return True


# ---------------------------------------------------------------------------
# Main pass
# ---------------------------------------------------------------------------
def main():
    inp = CONFIG["input_csv"]
    supplier, obs = CONFIG["source_supplier"], CONFIG["observation_date"]

    # SHA-256 of the (uncommitted) input, for provenance/reproducibility.
    h = hashlib.sha256()
    with open(inp, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    sha256 = h.hexdigest()

    rows_total = rows_with_type = rows_mapped = 0
    unmapped_counter = collections.Counter()
    # botanicals[key] = {common_names:set, forms:set(code), listings:int, cc:set}
    botanicals = collections.defaultdict(lambda: {"common": set(), "forms": set(),
                                                  "listings": 0, "cc": set()})
    # raw-case variants per normalised key -> to log case_variant_merge (§7.1, no silent merge)
    case_variants = collections.defaultdict(set)
    # review entries; also index attributable ones by latin_key for the 50-cohort cost
    review = []
    review_by_key = collections.defaultdict(list)
    no_latin_titles = []

    with open(inp, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            rows_total += 1
            typ = (row.get("Type") or "").strip()
            title = (row.get("Title") or "").strip()
            if not typ:
                continue
            rows_with_type += 1
            if typ not in TYPE_MAP:
                unmapped_counter[typ] += 1
                continue
            rows_mapped += 1
            code = TYPE_MAP[typ]
            p = parse_title(title)

            if p["latin_key"] is None:
                no_latin_titles.append(title)
                review.append({"reason": "no_latin", "raw_titles": [title],
                               "candidate_latin": None,
                               "note": "No parseable binomial; routed to no-Latin queue, NOT common-name merged."})
                for r, d in p["flags"]:
                    if r == "suspicious_latin_rejected":
                        review.append({"reason": "suspicious_latin_rejected", "raw_titles": [title],
                                       "candidate_latin": d,
                                       "note": "Last dash-segment looked like a binomial but is a plant-part/form word; rejected."})
                continue

            key = p["latin_key"]
            b = botanicals[key]
            b["forms"].add(code)
            b["listings"] += 1
            if p["common"]:
                b["common"].add(p["common"])
            if p["cc"]:
                b["cc"].add(p["cc"])
            case_variants[key].add(p["latin_raw"])

            for r, d in p["flags"]:
                if r in ("assay_in_latin", "name_in_latin_paren", "multi_dash_latin_not_final"):
                    entry = {"reason": r, "raw_titles": [title], "candidate_latin": key, "note": d}
                    review.append(entry)
                    review_by_key[key].append(entry)

    # ---- case_variant_merge: applied AND logged (no silent auto-merge, §7.1/§8) ----
    for key, variants in case_variants.items():
        if len(variants) > 1:
            entry = {"reason": "case_variant_merge", "raw_titles": sorted(variants),
                     "candidate_latin": key,
                     "note": "Case/spacing variants normalised to one key (Genus species). Merge applied AND logged."}
            review.append(entry)
            review_by_key[key].append(entry)

    # ---- near-duplicate Latin keys: genus matches, species differs by <=1 char ----
    by_genus = collections.defaultdict(list)
    for key in botanicals:
        g, s = key.split(" ", 1)
        by_genus[g].append((key, s))
    for g, items in by_genus.items():
        items.sort()
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                if lev1(items[i][1], items[j][1]):
                    k1, k2 = items[i][0], items[j][0]
                    entry = {"reason": "near_duplicate_latin", "raw_titles": [k1, k2],
                             "candidate_latin": [k1, k2],
                             "note": "Same genus, species differs by <=1 char; possible typo/synonym. NOT merged."}
                    review.append(entry)
                    review_by_key[k1].append(entry)
                    review_by_key[k2].append(entry)

    # ---- assemble candidate dataset (strictly Latin-keyed) ----
    def forms_list(codes):
        return [{"code": c, "source_supplier": supplier, "observation_date": obs}
                for c in sorted(codes)]

    candidates = {}
    for key in sorted(botanicals):
        b = botanicals[key]
        candidates[key] = {
            "common_names": sorted(b["common"]),
            "forms": forms_list(b["forms"]),
            "listing_count": b["listings"],
            "source_countries": sorted(b["cc"]),
        }
    candidates_doc = {
        "_meta": {
            "status": "UNVERIFIED candidate data (ADR-013 Pass 1) — NOT production-ready; "
                      "identity not authority-checked (Pass 2) and single-supplier (Pass 3 pending).",
            "source_supplier": supplier, "observation_date": obs,
            "source_file": os.path.basename(inp), "source_sha256": sha256,
            "distinct_latin_keys": len(candidates),
        },
        "botanicals": candidates,
    }

    # ---- unmapped types: split into (a) out-of-scope non-forms, (b) candidate new codes ----
    unmapped_doc = {
        "_meta": {"source_supplier": supplier, "observation_date": obs,
                  "note": "Type values not in the Pass-1 normalisation map. Not guessed."},
        "candidate_new_format_codes": {t: unmapped_counter.get(t, 0) for t in sorted(CANDIDATE_NEW_CODE_TYPES)
                                       if unmapped_counter.get(t, 0)},
        "out_of_scope_non_forms": {t: n for t, n in sorted(unmapped_counter.items(),
                                   key=lambda kv: (-kv[1], kv[0])) if t not in CANDIDATE_NEW_CODE_TYPES},
    }

    review_doc = {
        "_meta": {"source_supplier": supplier, "observation_date": obs,
                  "total_entries": len(review),
                  "by_reason": dict(collections.Counter(e["reason"] for e in review)),
                  "note": "Every ambiguity. Applied merges (case_variant_merge) are logged here, "
                          "never silent. no_latin/near_duplicate are NOT merged."},
        "entries": review,
    }

    # ---- 50-botanical proof cohort + cost measurement (§6 — the go/no-go gate) ----
    ranked = sorted(candidates.items(), key=lambda kv: (-kv[1]["listing_count"], kv[0]))
    cohort = ranked[:50]
    PER_ENTRY_MIN = 2.5   # minutes to adjudicate one flagged ambiguity (identity call)
    PER_BOT_AUTHORITY_MIN = 1.5  # minutes to authority-check one binomial (Pass-2 eyeball)
    # "needs review" = anything worth a human eyeball; "likely wrong" = the subset that is
    # probably a genuine parse error (a typo caught by near-dup, or a rejected false binomial).
    UNCERTAIN = {"multi_dash_latin_not_final", "near_duplicate_latin", "suspicious_latin_rejected"}
    LIKELY_WRONG = {"near_duplicate_latin", "suspicious_latin_rejected"}

    cohort_rows = []
    n_need_review = 0      # ≥1 uncertain flag (review burden)
    n_likely_wrong = 0     # ≥1 likely-genuine-error flag
    total_flags_50 = 0
    for key, data in cohort:
        entries = review_by_key.get(key, [])
        reasons = collections.Counter(e["reason"] for e in entries)
        uncertain = sum(v for r, v in reasons.items() if r in UNCERTAIN)
        likely = any(r in LIKELY_WRONG for r in reasons)
        total_flags_50 += len(entries)
        if uncertain > 0:
            n_need_review += 1
        if likely:
            n_likely_wrong += 1
        cohort_rows.append((key, data["listing_count"], len(data["forms"]),
                            len(entries), uncertain, likely, dict(reasons)))

    review_rate = n_need_review / 50.0
    error_rate = n_likely_wrong / 50.0
    review_minutes = total_flags_50 * PER_ENTRY_MIN + 50 * PER_BOT_AUTHORITY_MIN

    # ---- write JSON outputs ----
    def dump(name, obj):
        with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    dump("botanical_candidates.json", candidates_doc)
    dump("review_queue.json", review_doc)
    dump("unmapped_types.json", unmapped_doc)

    # ---- parse_qa_report.md ----
    spot = ["Withania somnifera", "Bacopa monnieri", "Asparagus racemosus", "Centella asiatica"]
    L = []
    L.append("# Parse-QA Report — ADR-013 Pass 1 (thewholesaler.eu)\n")
    L.append("> **Status: UNVERIFIED candidate data.** Machine parse only. Identity is NOT authority-")
    L.append("> checked (Pass 2) and forms are single-supplier (Pass 3 pending). Not production-ready.\n")
    L.append("## Provenance")
    L.append("| field | value |")
    L.append("|---|---|")
    L.append("| source_supplier | `%s` |" % supplier)
    L.append("| observation_date | `%s` (snapshot date) |" % obs)
    L.append("| source_file | `%s` (kept OUT of repo, see .gitignore) |" % os.path.basename(inp))
    L.append("| source_sha256 | `%s` |" % sha256)
    L.append("")
    L.append("## Counts")
    L.append("| metric | value |")
    L.append("|---|---:|")
    L.append("| rows in file (data rows) | %d |" % rows_total)
    L.append("| rows with a non-empty `Type` | %d |" % rows_with_type)
    L.append("| rows with a **mapped** `Type` (processed for forms) | %d |" % rows_mapped)
    L.append("| distinct Latin keys (candidate botanicals) | %d |" % len(candidates))
    L.append("| unmapped `Type` — out-of-scope non-forms | %d values |" % len(unmapped_doc["out_of_scope_non_forms"]))
    L.append("| unmapped `Type` — candidate new codes | %s |" %
             (", ".join("%s×%d" % (t, n) for t, n in unmapped_doc["candidate_new_format_codes"].items()) or "none"))
    L.append("| no-Latin records (routed to review) | %d |" % len(no_latin_titles))
    L.append("| review-queue entries (total) | %d |" % len(review))
    L.append("")
    L.append("Review queue by reason: " +
             ", ".join("`%s`=%d" % (r, n) for r, n in sorted(review_doc["_meta"]["by_reason"].items())) + "\n")

    L.append("## Mandatory spot-check (§5) — must resolve correctly")
    L.append("Each MUST be present with its forms aggregated under ONE normalised Latin key.\n")
    for name in spot:
        if name in candidates:
            d = candidates[name]
            codes = ", ".join(f["code"] for f in d["forms"])
            cn = "; ".join(d["common_names"][:6]) or "(none captured)"
            L.append("- **%s** — ✅ present · %d listings · forms: **%s** · common labels: _%s_" %
                     (name, d["listing_count"], codes, cn))
        else:
            L.append("- **%s** — ❌ MISSING — Pass 1 has FAILED." % name)
    L.append("")

    L.append("## 50-botanical proof cohort — cost measurement (§6, the go/no-go gate)")
    L.append("Top 50 botanicals by product-listing count (highest commercial signal).\n")
    L.append("**Two honest levels** (do not conflate them):")
    L.append("- **Needs review** = ≥1 flag worth a human eyeball (`multi_dash_latin_not_final`,")
    L.append("  `near_duplicate_latin`, `suspicious_latin_rejected`). Most multi-dash cases parse")
    L.append("  *correctly* (e.g. `Mangifera indica` out of a 4-segment title) — they just want a confirm.")
    L.append("- **Likely genuinely wrong** = the subset with a probable real error: a species typo caught")
    L.append("  by near-duplicate detection, or a rejected false binomial. This is the true defect rate.")
    L.append("- `case_variant_merge` and assay/name-in-paren are applied-and-logged (auditable, not errors);")
    L.append("  they count in the review-entry burden but not in either rate above.\n")
    L.append("| metric | value |")
    L.append("|---|---:|")
    L.append("| **needs-review rate** on the 50 (human eyeball) | **%d/50 = %.0f%%** |" % (n_need_review, review_rate * 100))
    L.append("| **likely-genuine error rate** on the 50 | **%d/50 = %.0f%%** |" % (n_likely_wrong, error_rate * 100))
    L.append("| review-queue entries attributable to the 50 | **%d** |" % total_flags_50)
    L.append("| est. human review to reach identity-verified | **%.0f min (~%.1f h)** |" %
             (review_minutes, review_minutes / 60.0))
    L.append("| &nbsp;&nbsp;→ assumption: per flagged entry | %.1f min |" % PER_ENTRY_MIN)
    L.append("| &nbsp;&nbsp;→ assumption: per-botanical authority check | %.1f min |" % PER_BOT_AUTHORITY_MIN)
    L.append("| &nbsp;&nbsp;→ implied per-botanical average | %.1f min |" % (review_minutes / 50.0))
    L.append("")
    L.append("### The 50 (rank · Latin · listings · #forms · flags)")
    L.append("| # | Latin key | listings | forms | entries | needs-review | likely-wrong | reasons |")
    L.append("|--:|---|--:|--:|--:|:--:|:--:|---|")
    for i, (key, listings, nforms, nflags, uncertain, likely, reasons) in enumerate(cohort_rows, 1):
        rtxt = ", ".join("%s×%d" % (r, n) for r, n in sorted(reasons.items())) or "—"
        L.append("| %d | `%s` | %d | %d | %d | %s | %s | %s |" %
                 (i, key, listings, nforms, nflags, "yes" if uncertain else "—",
                  "**yes**" if likely else "—", rtxt))
    L.append("")
    L.append("## Known limitations (hand-off to Pass 2)")
    L.append("- **Single supplier.** Forms are thewholesaler.eu only; market-status counts are NOT yet")
    L.append("  meaningful (needs Pass 3 multi-supplier consensus). Provenance is recorded per form.")
    L.append("- **Identity not authority-checked.** No binomial has been validated against GBIF/POWO/Kew")
    L.append("  (Pass 2). Near-duplicate typos (e.g. `Ricinus communes`↔`communis`) are flagged, not fixed.")
    L.append("- **Hyphenated epithets allowed** (fixes `Trigonella foenum-graecum`, `Nyctanthes arbor-tristis`,")
    L.append("  `Strychnos nux-vomica`, `Opuntia ficus-indica`). Rarely over-captures a hyphen-joined common")
    L.append("  name (`Portulaca oleracea-purslane`, 1 listing) — Pass 2 authority check resolves it.")
    L.append("- **Genus-only / no-binomial titles** are routed to the no-Latin queue, never common-name merged.")
    L.append("")
    L.append("### Go/No-Go note")
    L.append("This cost is the gate for scaling to the full ~700. Do **not** proceed to Pass 2 or")
    L.append("additional suppliers until the owner has reviewed these numbers (BUILD_BRIEF §6, ADR-013 §8).")
    L.append("")

    with open(os.path.join(OUT_DIR, "parse_qa_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    # ---- console summary (shown to owner before commit) ----
    print("PASS 1 COMPLETE")
    print("  rows(data)=%d  with Type=%d  mapped=%d  distinct Latin keys=%d" %
          (rows_total, rows_with_type, rows_mapped, len(candidates)))
    print("  review entries=%d  no_latin=%d  unmapped types=%d" %
          (len(review), len(no_latin_titles), len(unmapped_counter)))
    print("\nSPOT-CHECK:")
    for name in spot:
        if name in candidates:
            d = candidates[name]
            print("  OK  %-22s %2d listings  forms: %s" %
                  (name, d["listing_count"], ", ".join(f["code"] for f in d["forms"])))
        else:
            print("  MISSING  %s  <-- FAIL" % name)
    print("\n50-COHORT COST GATE:")
    print("  needs-review rate:      %d/50 = %.0f%% (human eyeball; most parse correctly)" % (n_need_review, review_rate * 100))
    print("  likely-genuine errors:  %d/50 = %.0f%% (true defect rate)" % (n_likely_wrong, error_rate * 100))
    print("  review entries attributable to the 50: %d" % total_flags_50)
    print("  est. review to identity-verified: %.0f min (~%.1f h)  [%.1f min/botanical avg]" %
          (review_minutes, review_minutes / 60.0, review_minutes / 50.0))
    print("\nWrote: botanical_candidates.json, review_queue.json, unmapped_types.json, parse_qa_report.md")


if __name__ == "__main__":
    main()
