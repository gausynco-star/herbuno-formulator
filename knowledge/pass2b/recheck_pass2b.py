#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2b — GBIF authority re-check on owner-resolved names.

Scope: every review-queue entry whose accepted/corrected name came from OWNER input rather than
GBIF's own candidate list —
  - synonym_remaps with signoff.accepted_outside_gbif_candidates == true (2 catalogue cases),
  - unknown_quarantine with status == "resolved" (30: 29 common-name resolutions + Rhizoma iridis),
  - typo_flags (23: verify the corrected spelling now resolves cleanly).

For each, GBIF species/match is queried on the OWNER-SUPPLIED name and classified:
  confirmed  — GBIF returns it as an accepted name (as-is).
  synonym    — GBIF resolves it to a DIFFERENT accepted name (both recorded; flagged for owner).
  not_found  — no clean GBIF match (fuzzy/higher-rank/none/doubtful); flagged, not discarded.

Rules: NO silent correction. authority + query_date per result. The existing owner sign-off is
NOT altered — a `gbif_recheck` field is added alongside it in pass2_review_queue.json.

Outputs -> knowledge/pass2b/: recheck_results.json, pass2b_report.md. Cached/resumable.

Run:  python3 knowledge/pass2b/recheck_pass2b.py
"""

import json, os, re, time, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.join(HERE, "..", "pass2", "pass2_review_queue.json")
CACHE_DIR = os.path.join(HERE, ".cache")
MATCH_CACHE = os.path.join(CACHE_DIR, "gbif_match.json")
SPECIES_CACHE = os.path.join(CACHE_DIR, "gbif_species.json")
NAMEUSAGE_CACHE = os.path.join(CACHE_DIR, "gbif_nameusage.json")

AUTHORITY = "GBIF backbone (species/match v1)"
QUERY_DATE = "2026-07-18"
GBIF_MATCH = "https://api.gbif.org/v1/species/match"
GBIF_SPECIES = "https://api.gbif.org/v1/species/"
GBIF_BACKBONE = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c"
SPECIESLIKE = ("SPECIES", "SUBSPECIES", "VARIETY", "FORM")
SLEEP, RETRIES = 0.04, 3
CANON_RE = re.compile(r"^([A-Z][a-zA-Z-]+)\s+(×?[a-z][a-zA-Z-]+)")


def _load(p, d):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


def _save(p, o):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False)


match_cache = _load(MATCH_CACHE, {})
species_cache = _load(SPECIES_CACHE, {})
nameusage_cache = _load(NAMEUSAGE_CACHE, {})


def _get(url):
    last = None
    for a in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "herbuno-formulator/ADR-013-pass2b (hello@herbuno.com)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            last = e
            time.sleep(0.5 * (a + 1))
    raise last


def gbif_match(name):
    if name in match_cache:
        return match_cache[name]
    d = _get(GBIF_MATCH + "?" + urllib.parse.urlencode({"name": name, "verbose": "true", "strict": "false"}))
    match_cache[name] = d
    time.sleep(SLEEP)
    return d


def gbif_species(key):
    k = str(key)
    if k in species_cache:
        return species_cache[k]
    d = _get(GBIF_SPECIES + k)
    species_cache[k] = d
    time.sleep(SLEEP)
    return d


def gbif_name_usage(name):
    if name in nameusage_cache:
        return nameusage_cache[name]
    d = _get(GBIF_SPECIES + "?" + urllib.parse.urlencode({"name": name, "datasetKey": GBIF_BACKBONE}))
    res = d.get("results", [])
    nameusage_cache[name] = res
    time.sleep(SLEEP)
    return res


def canonical_of(s):
    if not s:
        return None
    m = CANON_RE.match(s.strip())
    return (m.group(1) + " " + m.group(2)) if m else None


def _eq(a, b):
    return (a or "").strip().lower() == (b or "").strip().lower()


def recheck(name):
    """Return dict(status, gbif_accepted_name, match_type, match_confidence, gbif_suggests, note)."""
    m = gbif_match(name)
    mt, status, canon = m.get("matchType"), m.get("status"), m.get("canonicalName")
    key, conf, rank = m.get("usageKey"), m.get("confidence"), m.get("rank")

    # confirmed: exact accepted species whose canonical equals the queried name
    if mt == "EXACT" and status == "ACCEPTED" and rank in SPECIESLIKE and _eq(canon, name):
        return {"status": "confirmed", "gbif_accepted_name": canon, "match_type": mt,
                "match_confidence": conf, "gbif_suggests": None, "note": "GBIF accepts as-is."}

    # synonym via match (resolve accepted name)
    if key and status == "SYNONYM":
        acc = None
        ak = m.get("acceptedUsageKey")
        if ak:
            try:
                acc = gbif_species(ak).get("canonicalName")
            except Exception:
                acc = None
        return {"status": "synonym", "gbif_accepted_name": acc or canon, "match_type": mt,
                "match_confidence": conf, "gbif_suggests": None,
                "note": "GBIF treats the owner name as a synonym of a different accepted name."}

    # fallback: exact backbone name-usage
    try:
        usages = gbif_name_usage(name)
    except Exception:
        usages = []
    exact = [u for u in usages if _eq(u.get("canonicalName"), name) and u.get("rank") in SPECIESLIKE]
    for u in exact:
        if u.get("taxonomicStatus") == "ACCEPTED":
            return {"status": "confirmed", "gbif_accepted_name": u.get("canonicalName"),
                    "match_type": (mt or "") + "+nameusage", "match_confidence": conf,
                    "gbif_suggests": None, "note": "GBIF accepts as-is (name-usage)."}
    accs = []
    for u in exact:
        c = canonical_of(u.get("accepted"))
        if c and c not in accs:
            accs.append(c)
    if accs:
        return {"status": "synonym", "gbif_accepted_name": (accs[0] if len(accs) == 1 else None),
                "candidate_accepted_names": sorted(accs) if len(accs) > 1 else None,
                "match_type": (mt or "") + "+nameusage", "match_confidence": conf, "gbif_suggests": None,
                "note": "Synonym via name-usage%s." % (" (ambiguous)" if len(accs) > 1 else "")}

    # nothing accepted or synonym found
    return {"status": "not_found", "gbif_accepted_name": None, "match_type": mt,
            "match_confidence": conf,
            "gbif_suggests": (canon if mt in ("FUZZY", "HIGHERRANK") and canon else None),
            "note": "No exact accepted GBIF name (match=%s%s)." % (
                mt, "; GBIF suggests '%s'" % canon if mt in ("FUZZY", "HIGHERRANK") and canon else "")}


def main():
    with open(RQ, encoding="utf-8") as f:
        rq = json.load(f)

    targets = []  # (source_list, entry, owner_name)
    for s in rq["synonym_remaps"]:
        if s.get("signoff", {}).get("accepted_outside_gbif_candidates"):
            targets.append(("synonym_remaps", s, s["accepted_name"]))
    for u in rq["unknown_quarantine"]:
        if u.get("status") == "resolved":
            targets.append(("unknown_quarantine", u, u["accepted_name"]))
    for t in rq["typo_flags"]:
        targets.append(("typo_flags", t, t["corrected_name"]))

    print("Pass 2b — re-checking %d owner-supplied names against GBIF..." % len(targets))
    results, counts = [], {"confirmed": 0, "synonym": 0, "not_found": 0}
    for i, (src, entry, name) in enumerate(targets, 1):
        r = recheck(name)
        counts[r["status"]] += 1
        rec = {"authority": AUTHORITY, "query_date": QUERY_DATE, "queried_name": name, **r}
        entry["gbif_recheck"] = rec                                   # alongside sign-off (not altering it)
        results.append({"source": src, "original": entry.get("latin"),
                        "owner_name": name, **r,
                        "authority": AUTHORITY, "query_date": QUERY_DATE})
        if i % 20 == 0 or i == len(targets):
            _save(MATCH_CACHE, match_cache)
            _save(SPECIES_CACHE, species_cache)
            _save(NAMEUSAGE_CACHE, nameusage_cache)
            print("  %d/%d  (confirmed=%d synonym=%d not_found=%d)" %
                  (i, len(targets), counts["confirmed"], counts["synonym"], counts["not_found"]))

    _save(MATCH_CACHE, match_cache)
    _save(SPECIES_CACHE, species_cache)
    _save(NAMEUSAGE_CACHE, nameusage_cache)

    # write gbif_recheck back into the review queue (sign-off untouched)
    with open(RQ, "w", encoding="utf-8") as f:
        json.dump(rq, f, ensure_ascii=False, indent=2)

    disagreements = [r for r in results if r["status"] != "confirmed"]
    doc = {"_meta": {"authority": AUTHORITY, "query_date": QUERY_DATE, "total": len(targets),
                     "counts": counts,
                     "scope": "owner-supplied names (accepted_outside_gbif_candidates + resolved unknowns "
                              "+ typo corrections); re-checked against GBIF as-is.",
                     "note": "No silent correction. Disagreements (synonym/not_found) are flagged for "
                             "owner; owner sign-off is authoritative unless changed."},
            "results": sorted(results, key=lambda r: (r["status"], r["owner_name"])),
            "disagreements": sorted(disagreements, key=lambda r: (r["status"], r["owner_name"]))}
    _save(os.path.join(HERE, "recheck_results.json"), doc)

    # report
    L = ["# Pass-2b Report — GBIF Authority Re-check on Owner-Resolved Names (ADR-013)\n",
         "> Re-checks names the owner supplied (outside GBIF's own candidate list) against GBIF as-is.",
         "> No silent correction — disagreements are flagged; the owner sign-off remains authoritative.\n",
         "## Provenance",
         "| field | value |", "|---|---|",
         "| authority | `%s` |" % AUTHORITY, "| query_date | `%s` |" % QUERY_DATE,
         "| scope | %d owner-supplied names |" % len(targets), "",
         "## Counts",
         "| status | count | pct |", "|---|---:|---:|"]
    for s in ("confirmed", "synonym", "not_found"):
        L.append("| **%s** | %d | %.0f%% |" % (s, counts[s], 100.0 * counts[s] / len(targets)))
    L.append("")
    L.append("## Disagreements — GBIF ≠ owner decision (%d) — the point of this pass" % len(disagreements))
    if not disagreements:
        L.append("_None — every owner-supplied name is confirmed accepted by GBIF._")
    else:
        L.append("| owner name | GBIF says | source |")
        L.append("|---|---|---|")
        for r in sorted(disagreements, key=lambda r: (r["status"], r["owner_name"])):
            if r["status"] == "synonym":
                g = "synonym → **%s**" % (r["gbif_accepted_name"] or ", ".join(r.get("candidate_accepted_names") or []))
            else:
                g = "not found%s" % (" (suggests *%s*)" % r["gbif_suggests"] if r.get("gbif_suggests") else "")
            L.append("| `%s` | %s | %s |" % (r["owner_name"], g, r["source"]))
    L.append("")
    L.append("## Action")
    L.append("Owner reviews the disagreement list. Synonyms may warrant switching the accepted name to")
    L.append("GBIF's; not_found names may be valid trade/pharmacopoeial names GBIF lacks — keep with a")
    L.append("note. No change is made automatically. Pass-2b writes a `gbif_recheck` field alongside each")
    L.append("sign-off in pass2_review_queue.json; the sign-off itself is unchanged.")
    L.append("")
    with open(os.path.join(HERE, "pass2b_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print("\nPASS 2b COMPLETE")
    print("  confirmed=%d  synonym=%d  not_found=%d  (of %d)" %
          (counts["confirmed"], counts["synonym"], counts["not_found"], len(targets)))
    print("  disagreements: %d" % len(disagreements))
    print("  wrote recheck_results.json, pass2b_report.md; added gbif_recheck to review queue")


if __name__ == "__main__":
    main()
