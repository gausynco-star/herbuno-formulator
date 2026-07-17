#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Verification Pipeline — Pass 2 (authority cross-check).

Validates every Latin binomial from Pass 1 against the GBIF backbone taxonomy
(species/match API — free, no key). Classifies each into exactly ONE bucket, never
collapsing outcomes (ADR-013 §8):

  accepted  — resolves to an accepted name as-is (EXACT + ACCEPTED).
  synonym   — resolves but the name is a synonym -> record accepted name, KEEP the botanical.
  typo      — near-match to an accepted name (GBIF FUZZY) -> flag suggested correction, DO NOT apply.
  unknown   — no resolution (NONE / higher-rank only / doubtful) -> quarantine, do not discard.

Rules: no silent correction (synonyms mapped, typos only flagged); provenance per result
(authority + query date); identity verification is per-field, separate from form availability.

Authority note: GBIF is primary. POWO has no officially-supported free JSON API, so it is
recommended as the MANUAL secondary check for flagged typo/unknown cases (see review queue),
rather than scraping an unsupported endpoint. GBIF's backbone already incorporates Kew/WCVP
plant data.

Resumable: every GBIF response is cached under .cache/ (gitignored); re-runs do not re-query.

Run:  python3 knowledge/pass2/authority_pass2.py
"""

import json, os, time, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PASS1 = os.path.join(HERE, "..", "pass1", "botanical_candidates.json")
CACHE_DIR = os.path.join(HERE, ".cache")
MATCH_CACHE = os.path.join(CACHE_DIR, "gbif_match.json")
SPECIES_CACHE = os.path.join(CACHE_DIR, "gbif_species.json")
NAMEUSAGE_CACHE = os.path.join(CACHE_DIR, "gbif_nameusage.json")
GBIF_BACKBONE = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c"  # restrict name-usage lookup to GBIF backbone

AUTHORITY = "GBIF backbone (species/match v1)"
QUERY_DATE = "2026-07-18"
GBIF_MATCH = "https://api.gbif.org/v1/species/match"
GBIF_SPECIES = "https://api.gbif.org/v1/species/"
SLEEP = 0.04           # polite pause between *uncached* calls
RETRIES = 3


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


match_cache = _load(MATCH_CACHE, {})
species_cache = _load(SPECIES_CACHE, {})
nameusage_cache = _load(NAMEUSAGE_CACHE, {})

import re
CANON_RE = re.compile(r"^([A-Z][a-zA-Z-]+)\s+(×?[a-z][a-zA-Z-]+)")  # Genus species (allow ×hybrid, hyphen)


def canonical_of(sciname):
    """Strip author from a GBIF scientificName -> 'Genus species' (or None)."""
    if not sciname:
        return None
    m = CANON_RE.match(sciname.strip())
    return (m.group(1) + " " + m.group(2)) if m else None


def _get_json(url):
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "herbuno-formulator/ADR-013-pass2 (data-eng; contact hello@herbuno.com)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            last = e
            time.sleep(0.5 * (attempt + 1))
    raise last


def gbif_match(name):
    if name in match_cache:
        return match_cache[name]
    url = GBIF_MATCH + "?" + urllib.parse.urlencode({"name": name, "verbose": "true", "strict": "false"})
    data = _get_json(url)
    match_cache[name] = data
    time.sleep(SLEEP)
    return data


def gbif_species(key):
    k = str(key)
    if k in species_cache:
        return species_cache[k]
    data = _get_json(GBIF_SPECIES + k)
    species_cache[k] = data
    time.sleep(SLEEP)
    return data


def gbif_name_usage(name):
    """Backbone name-usage lookup — resolves names the fuzzy matcher backs off on (HIGHERRANK/NONE)."""
    if name in nameusage_cache:
        return nameusage_cache[name]
    url = GBIF_SPECIES + "?" + urllib.parse.urlencode({"name": name, "datasetKey": GBIF_BACKBONE})
    data = _get_json(url)
    res = data.get("results", [])
    nameusage_cache[name] = res
    time.sleep(SLEEP)
    return res


SPECIESLIKE = ("SPECIES", "SUBSPECIES", "VARIETY", "FORM")


def resolve_by_name_usage(latin):
    """
    Fallback for names GBIF match couldn't place. Look up exact backbone name-usages.
    Returns (status, accepted_name, candidate_accepted_names, note) where status is one of
    'accepted' | 'synonym' | None(=still unknown).
    """
    try:
        usages = gbif_name_usage(latin)
    except Exception:
        return (None, None, [], "name-usage lookup failed")
    norm = latin.lower()
    exact = [u for u in usages
             if (u.get("canonicalName") or "").lower() == norm and u.get("rank") in SPECIESLIKE]
    if not exact:
        return (None, None, [], "no exact backbone name-usage; genuinely unresolved")
    # accepted usage present -> accepted
    for u in exact:
        if u.get("taxonomicStatus") == "ACCEPTED":
            return ("accepted", u.get("canonicalName"), [], "resolved via backbone name-usage (accepted)")
    # otherwise synonym(s): collect DISTINCT accepted names (do not silently pick one)
    accepted = []
    for u in exact:
        c = canonical_of(u.get("accepted"))
        if c and c not in accepted:
            accepted.append(c)
    if len(accepted) == 1:
        return ("synonym", accepted[0], [], "synonym via backbone name-usage")
    if len(accepted) > 1:
        return ("synonym", None, sorted(accepted),
                "AMBIGUOUS synonym: maps to %d accepted names; owner must pick." % len(accepted))
    return (None, None, [], "backbone name-usage present but no accepted name resolvable")


def levenshtein(a, b):
    a, b = a.lower(), b.lower()
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def classify(latin, m):
    """Return a result dict for one binomial."""
    mt = m.get("matchType")            # EXACT / FUZZY / HIGHERRANK / NONE
    status = m.get("status")           # ACCEPTED / SYNONYM / DOUBTFUL
    rank = m.get("rank")
    conf = m.get("confidence")
    key = m.get("usageKey")
    canon = m.get("canonicalName")

    res = {"latin": latin, "status": None, "accepted_name": None,
           "authority": AUTHORITY, "match_type": mt, "match_confidence": conf,
           "gbif_usage_key": key, "suggested_correction": None,
           "ambiguous": False, "candidate_accepted_names": [],
           "query_date": QUERY_DATE, "note": ""}

    # Names the fuzzy matcher backs off on (NONE / genus-only / doubtful) get a backbone
    # name-usage fallback before we call them unknown — recovers ambiguous synonyms.
    if mt == "NONE" or not key or mt == "HIGHERRANK" \
            or rank not in ("SPECIES", "SUBSPECIES", "VARIETY", "FORM") or status == "DOUBTFUL":
        st, acc, cands, note = resolve_by_name_usage(latin)
        if st == "accepted":
            res.update(status="accepted", accepted_name=acc, match_type=(mt + "+nameusage"), note=note)
        elif st == "synonym":
            res.update(status="synonym", accepted_name=acc, candidate_accepted_names=cands,
                       ambiguous=bool(cands), match_type=(mt + "+nameusage"), note=note)
        else:
            res.update(status="unknown", note=(note or "No GBIF resolution; quarantined."))
        return res

    if mt == "FUZZY":
        res["status"] = "typo"
        res["suggested_correction"] = canon
        res["note"] = "GBIF fuzzy match; edit-distance %d to '%s'. NOT auto-applied." % (
            levenshtein(latin, canon or ""), canon)
        return res

    # EXACT (or accepted-rank) from here
    if status == "SYNONYM":
        res["status"] = "synonym"
        acc_key = m.get("acceptedUsageKey")
        acc_name = None
        if acc_key:
            try:
                acc_name = gbif_species(acc_key).get("canonicalName")
            except Exception:
                acc_name = None
        res["accepted_name"] = acc_name or canon
        res["note"] = "Synonym; mapped to accepted name. Botanical kept."
        return res

    # ACCEPTED
    res["status"] = "accepted"
    res["accepted_name"] = canon
    return res


def main():
    candidates = _load(PASS1, {}).get("botanicals", {})
    latins = sorted(candidates.keys())
    total = len(latins)
    print("Pass 2 — cross-checking %d binomials against GBIF..." % total)

    results = {}
    counts = {"accepted": 0, "synonym": 0, "typo": 0, "unknown": 0}
    synonym_remaps, typo_flags, unknown_q = [], [], []
    errors = []

    for i, latin in enumerate(latins, 1):
        try:
            m = gbif_match(latin)
            r = classify(latin, m)
        except Exception as e:
            r = {"latin": latin, "status": "unknown", "accepted_name": None,
                 "authority": AUTHORITY, "match_type": "ERROR", "match_confidence": None,
                 "gbif_usage_key": None, "suggested_correction": None,
                 "query_date": QUERY_DATE, "note": "Query error: %s; treat as unresolved." % e}
            errors.append(latin)
        results[latin] = r
        counts[r["status"]] = counts.get(r["status"], 0) + 1

        if r["status"] == "synonym":
            synonym_remaps.append({"latin": latin, "accepted_name": r["accepted_name"],
                                   "ambiguous": r.get("ambiguous", False),
                                   "candidate_accepted_names": r.get("candidate_accepted_names", []),
                                   "match_confidence": r["match_confidence"],
                                   "note": ("AMBIGUOUS — maps to multiple accepted names; owner MUST pick one."
                                            if r.get("ambiguous") else
                                            "Map to accepted name; keep the botanical. Owner sign-off.")})
        elif r["status"] == "typo":
            typo_flags.append({"latin": latin, "suggested_correction": r["suggested_correction"],
                               "edit_distance": levenshtein(latin, r["suggested_correction"] or ""),
                               "match_confidence": r["match_confidence"],
                               "note": "NOT auto-applied. Owner review; secondary check POWO (powo.science.kew.org)."})
        elif r["status"] == "unknown":
            unknown_q.append({"latin": latin, "match_type": r["match_type"], "note": r["note"]})

        if i % 50 == 0 or i == total:
            _save(MATCH_CACHE, match_cache)
            _save(SPECIES_CACHE, species_cache)
            _save(NAMEUSAGE_CACHE, nameusage_cache)
            print("  %d/%d  (acc=%d syn=%d typo=%d unk=%d)" %
                  (i, total, counts["accepted"], counts["synonym"], counts["typo"], counts["unknown"]))

    _save(MATCH_CACHE, match_cache)
    _save(SPECIES_CACHE, species_cache)
    _save(NAMEUSAGE_CACHE, nameusage_cache)

    clean = counts["accepted"] + counts["synonym"]
    pct_clean = 100.0 * clean / total if total else 0.0
    n_ambiguous = sum(1 for s in synonym_remaps if s.get("ambiguous"))

    # ---- authority_results.json ----
    results_doc = {
        "_meta": {
            "input": "knowledge/pass1/botanical_candidates.json",
            "authority": AUTHORITY, "query_date": QUERY_DATE,
            "total": total,
            "per_field_note": "Identity verification only. Form-availability verification is separate "
                              "(single-supplier until Pass 3); statuses here do not touch forms.",
            "status_note": "UNVERIFIED forms remain UNVERIFIED. This pass resolves IDENTITY only.",
        },
        "counts": counts,
        "cleanly_resolved": {"count": clean, "pct": round(pct_clean, 1)},
        "results": results,
    }
    _save(os.path.join(HERE, "authority_results.json"), results_doc)

    # ---- pass2_review_queue.json ----
    review_doc = {
        "_meta": {"authority": AUTHORITY, "query_date": QUERY_DATE,
                  "note": "No silent correction. Synonyms mapped (owner sign-off); typos flagged only; "
                          "unknowns quarantined. All await owner review.",
                  "synonym_remaps": len(synonym_remaps), "typo_flags": len(typo_flags),
                  "unknown_quarantine": len(unknown_q)},
        "synonym_remaps": sorted(synonym_remaps, key=lambda x: x["latin"]),
        "typo_flags": sorted(typo_flags, key=lambda x: x["latin"]),
        "unknown_quarantine": sorted(unknown_q, key=lambda x: x["latin"]),
    }
    _save(os.path.join(HERE, "pass2_review_queue.json"), review_doc)

    # ---- pass2_report.md ----
    def sample(pred, n=12):
        out = []
        for latin in latins:
            r = results[latin]
            if pred(r):
                out.append(r)
                if len(out) >= n:
                    break
        return out

    L = []
    L.append("# Pass-2 Report — GBIF Authority Cross-Check (ADR-013)\n")
    L.append("> Identity verification only. Forms remain **UNVERIFIED** (single-supplier until Pass 3).\n")
    L.append("## Provenance")
    L.append("| field | value |")
    L.append("|---|---|")
    L.append("| authority | `%s` |" % AUTHORITY)
    L.append("| query_date | `%s` |" % QUERY_DATE)
    L.append("| input | `knowledge/pass1/botanical_candidates.json` (%d keys) |" % total)
    L.append("| secondary (manual) | POWO — recommended for flagged typo/unknown cases |")
    L.append("")
    L.append("## Status counts (each binomial in exactly ONE bucket)")
    L.append("| status | count | %% of %d |" % total)
    L.append("|---|---:|---:|")
    for s in ("accepted", "synonym", "typo", "unknown"):
        L.append("| **%s** | %d | %.1f%% |" % (s, counts[s], 100.0 * counts[s] / total))
    L.append("| _(query errors, counted as unknown)_ | %d | — |" % len(errors))
    L.append("")
    L.append("## Identity-quality signal")
    L.append("**Cleanly resolved (accepted + synonym): %d / %d = %.1f%%** of candidates map to a real "
             "accepted name." % (clean, total, pct_clean))
    L.append("- Of the %d synonyms, **%d are AMBIGUOUS** (map to >1 accepted name) — owner must pick one; "
             "not silently resolved." % (counts["synonym"], n_ambiguous))
    L.append("- Typos (%d) are flagged with a suggested correction but **NOT applied**." % counts["typo"])
    L.append("- Unknowns (%d) are quarantined (kept, not discarded). These are overwhelmingly **not Latin "
             "binomials** — minerals (bentonite clay, sendha namak), Hindi/English common names (methi dana, "
             "butterfly pea), and `Genus spp` — i.e. Pass-1 false-positive keys now correctly caught." % counts["unknown"])
    L.append("")
    L.append("## Spot samples")
    L.append("### Synonyms remapped (identity kept, accepted name recorded)")
    for r in sample(lambda r: r["status"] == "synonym" and not r.get("ambiguous")):
        L.append("- `%s` → **%s** (conf %s)" % (r["latin"], r["accepted_name"], r["match_confidence"]))
    L.append("\n### Ambiguous synonyms (multiple accepted names — owner MUST pick, not auto-resolved)")
    for r in sample(lambda r: r.get("ambiguous"), 10):
        L.append("- `%s` → candidates: %s" % (r["latin"], ", ".join("**%s**" % c for c in r["candidate_accepted_names"])))
    L.append("\n### Typos flagged (suggested correction — NOT applied)")
    for r in sample(lambda r: r["status"] == "typo"):
        L.append("- `%s` → suggests **%s** (conf %s)" % (r["latin"], r["suggested_correction"], r["match_confidence"]))
    L.append("\n### Unknown / quarantined (kept for owner + POWO)")
    for r in sample(lambda r: r["status"] == "unknown"):
        L.append("- `%s` — %s" % (r["latin"], r["note"]))
    L.append("")
    L.append("## Cross-validation with Pass 1")
    rc = results.get("Ricinus communes")
    if rc:
        L.append("- Pass-1 near-duplicate flag `Ricinus communes` → GBIF **%s**%s — confirms the Pass-1 typo detector." %
                 (rc["status"], (" → suggests %s" % rc["suggested_correction"]) if rc["suggested_correction"] else ""))
    L.append("")
    L.append("## Next")
    L.append("Owner reviews `pass2_review_queue.json` (synonym remaps + typo flags). No name is corrected")
    L.append("without sign-off. Pass 3 (multi-supplier consensus) and form verification are separate.")
    L.append("")
    with open(os.path.join(HERE, "pass2_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    # ---- console ----
    print("\nPASS 2 COMPLETE")
    print("  accepted=%d  synonym=%d  typo=%d  unknown=%d  (errors=%d)" %
          (counts["accepted"], counts["synonym"], counts["typo"], counts["unknown"], len(errors)))
    print("  cleanly resolved (accepted+synonym): %d/%d = %.1f%%" % (clean, total, pct_clean))
    print("  Ricinus communes ->", results.get("Ricinus communes", {}).get("status"),
          "->", results.get("Ricinus communes", {}).get("suggested_correction"))
    print("  wrote authority_results.json, pass2_review_queue.json, pass2_report.md")


if __name__ == "__main__":
    main()
