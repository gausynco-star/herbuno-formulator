#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 — Frozen identity backbone for Pass 3.

Consolidates pass1 + pass2 + pass2b + all owner sign-offs into ONE canonical artifact:
one record per resolved botanical identity, keyed by a stable canonical_id. Pass 3
(multi-supplier consensus + form availability) joins against this by original_parsed_names.

Every one of the 641 Pass-1 keys is dispositioned:
  464 accepted · 87 synonym-resolved · 3 trade_ambiguous · 23 typo-corrected ·
  30 owner-resolved(unknown) · 5 genus_level · 1 species_ambiguous · 28 excluded.
Keys sharing a final accepted name merge into one identity. Non-botanical (18) and
unresolvable (10) go to excluded.json with a reason.

Trinomials are parsed into accepted_rank + infraspecific_epithet (GBIF rank where available).

Outputs -> knowledge/identity/: botanical_identity.json, botanical_identity.md, excluded.json
Reuses pass2/pass2b GBIF match caches; new lookups cached under .cache/.

Run:  python3 knowledge/identity/build_identity.py
"""

import json, os, re, time, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
P1 = os.path.join(K, "pass1", "botanical_candidates.json")
AUTH = os.path.join(K, "pass2", "authority_results.json")
RQ = os.path.join(K, "pass2", "pass2_review_queue.json")
CACHE = os.path.join(HERE, ".cache", "gbif_match.json")
READ_CACHES = [os.path.join(K, "pass2", ".cache", "gbif_match.json"),
               os.path.join(K, "pass2b", ".cache", "gbif_match.json")]
QUERY_DATE = "2026-07-18"
# Immutable freeze stamp. Bump identity_version on any rebuild (Pass 2 correction -> rebuild ->
# new version). Downstream artifacts (Pass 3+) MUST record which identity_version they built against.
IDENTITY_VERSION = "2026-07-19.4"  # schema v2: authority/trade-primary/display naming split (prior versions in git history)
IDENTITY_SCHEMA_VERSION = 2        # v2: added authority_accepted_name / trade_primary_name / canonical_display_name

# Confirmed duplicate-record merges (absorb -> keep). Encoded explicitly so a rebuild never
# auto-merges anything new. Genus-level records with >1 species (jasminum/gossypium/tagetes) are
# deliberately NOT merged — that would assert a species the supplier never stated.
RECORD_MERGES = [
    ("senna-alexandrina-alexandrina", "senna-alexandrina", "autonym trinomial -> binomial"),
    ("morus", "morus-alba", "genus-level record -> single species (Morus alba)"),
    ("eclipta-alba", "eclipta-prostrata", "synonym: Eclipta alba = synonym of Eclipta prostrata (owner-stated)"),
    ("nyctanthes-arbor", "nyctanthes-arbor-tristis", "truncated epithet -> full (arbor -> arbor-tristis)"),
    # ADR-013 trade-usage adjudication:
    ("butea-frondosa", "butea-monosperma", "Butea frondosa = synonym of Butea monosperma (Palash)"),
    # nageia-nagi is a GBIF fuzzy-match error: 'Myrica nagi' -> conifer 'Nageia nagi'. Myrica nagi is
    # a synonym of Morella esculenta (Kaiphal). drop_absorbed_accepted: 'Nageia nagi' is NOT a synonym
    # of Morella esculenta and must not be carried in; only 'Myrica nagi'/'Kaiphal' are absorbed.
    ("nageia-nagi", "morella-esculenta",
     "GBIF fuzzy-match error: Myrica nagi is a synonym of Morella esculenta (Kaiphal), not Nageia nagi",
     {"drop_absorbed_accepted": True}),
]
# ---- ADR-013 trade-usage adjudication of the common-name-round GBIF disagreements ----
# A1+A4: ADOPT GBIF's accepted name; owner/trade binomial retained as a scientific_synonym.
#        (canonical_id stays stable across the rename — downstream joins by parsed name/synonym.)
GBIF_ADOPT = {
    "Astragalus membranaceus": "Astragalus mongholicus",
    "Cymbopogon martinii": "Cymbopogon martini",
    "Desmodium adscendens": "Grona adscendens",
    "Drynaria fortunei": "Drynaria roosii",
    "Guarea rusbyi": "Guarea guidonia",
    "Maytenus krukovii": "Monteverdia krukovii",
    "Ocotea quixos": "Mespilodaphne quixos",
    "Stereospermum suaveolens": "Stereospermum chelonoides",
    # spelling / gender fixes
    "Handroanthus impetiginosus": "Handroanthus impetiginosum",
    "Leonurus cardiacus": "Leonurus cardiaca",
    "Marsdenia condurango": "Marsdenia cundurango",
    "Polypodium leucotomos": "Polypodium leucatomos",
}
# A2: KEEP trade-primary as accepted; record GBIF's name as an authority scientific_synonym.
GBIF_KEEP_SYNONYM = {
    "Coleus forskohlii": "Coleus hadiensis",
    "Crambe abyssinica": "Crambe hispanica abyssinica",
    "Grindelia robusta": "Grindelia hirsutula",
    "Lens culinaris": "Vicia lens",
    "Meconopsis betonicifolia": "Cathcartia betonicifolia",
    "Pfaffia paniculata": "Hebanthe erianthos",
    "Pisum sativum": "Lathyrus oleraceus",
    "Rhaponticum carthamoides": "Leuzea carthamoides carthamoides",
    "Sceletium tortuosum": "Mesembryanthemum tortuosum",
}
# A3: Solanum indicum -> trade_ambiguous (Brihati = S. violaceum, NOT S. melongena/brinjal).
SOLANUM_INDICUM_AMBIGUOUS = {
    "accepted_name": "Solanum indicum", "candidate_accepted_names": ["Solanum violaceum"],
    "note": "GBIF synonymises S. indicum to S. melongena/violaceum. Brihati (trade) = S. violaceum, "
            "NOT S. melongena (brinjal). Held trade_ambiguous pending source/provenance."}
# B1: bare 'Skullcap' -> American skullcap; Chinese skullcap (S. baicalensis) stays distinct.
ADJUDICATION_COMMON = {
    "Scutellaria lateriflora": {"common_names": ["Skullcap"],
        "note": "Bare 'Skullcap' resolved to American skullcap (Western herbalism). Chinese skullcap "
                "= Scutellaria baicalensis, kept distinct as 'Chinese Skullcap'."}}
# C: spurious supplier common names to strike from a specific identity (data errors).
COMMON_NAME_CORRECTIONS = {
    "curcuma-zedoaria": {"remove": ["Lemongrass"],
        "reason": "spurious supplier label; Curcuma zedoaria (Kachur/White Turmeric/Zedoary) is not "
                  "lemongrass. Lemongrass = Cymbopogon citratus."}}
# Free-text provenance notes stamped onto specific identities.
IDENTITY_NOTES = {
    "vanda-tessellata": "Regional 'Rasna' substitute (S. India); primary Rasna = Pluchea lanceolata. "
                        "Kept distinct — 'Rasna' (bare) resolves to P. lanceolata.",
    "valeriana-jatamansi": "Indian valerian / Tagar; distinct from Valeriana officinalis. 'Valerian' "
                           "(bare) resolves to V. officinalis."}
ADJUDICATION_DATE = "2026-07-19"

AUTHORITY = "GBIF backbone (species/match v1)"
GBIF_MATCH = "https://api.gbif.org/v1/species/match"
SPECIESLIKE = ("SPECIES", "SUBSPECIES", "VARIETY", "FORM")


def _load(p, d):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return d


def _save(p, o):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False, indent=2)


# merged read cache (pass2 + pass2b) + local write cache
match_cache = {}
for rc in READ_CACHES:
    match_cache.update(_load(rc, {}))
_local = _load(CACHE, {})
match_cache.update(_local)


def gbif_match(name):
    if name in match_cache:
        return match_cache[name]
    url = GBIF_MATCH + "?" + urllib.parse.urlencode({"name": name, "verbose": "false", "strict": "false"})
    for a in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "herbuno-formulator/ADR-013-identity (hello@herbuno.com)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.loads(r.read().decode("utf-8"))
                break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            time.sleep(0.4 * (a + 1))
    else:
        d = {}
    match_cache[name] = d
    _local[name] = d
    time.sleep(0.03)
    return d


RANK_MARKERS = {"var.", "subsp.", "ssp.", "f.", "forma", "cv.", "×"}


def parse_name(name):
    """(genus, species, infraspecific_epithet, rank_guess). Handles ×hybrid & hyphenated epithets."""
    toks = [t for t in name.replace("×", " ").split() if t and t not in RANK_MARKERS]
    genus = toks[0] if toks else None
    species = toks[1] if len(toks) >= 2 else None
    infra = toks[2] if len(toks) >= 3 else None
    rank = "GENUS" if len(toks) == 1 else "SPECIES" if len(toks) == 2 else "INFRASPECIFIC"
    return genus, species, infra, rank


def gbif_info(accepted_name):
    """Return (usage_key, rank) from GBIF for an accepted name (rank precise for infraspecifics)."""
    if not accepted_name:
        return None, None
    m = gbif_match(accepted_name)
    key = m.get("usageKey")
    rank = m.get("rank") if m.get("rank") in SPECIESLIKE + ("GENUS",) else None
    # only trust the key if GBIF matched the same canonical (avoid fuzzy drift)
    if m.get("matchType") == "NONE":
        return None, None
    return key, rank


def slug(name, used):
    s = name.lower().replace("×", "x-")
    s = re.sub(r"\b(var|subsp|ssp|f|cv|forma)\.?\b", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    base, i = s, 2
    while s in used:
        s = "%s-%d" % (base, i)
        i += 1
    used.add(s)
    return s


# English/vernacular last-tokens that make a "Genus species"-shaped string NOT a Latin binomial
# (e.g. "Rose petal", "Holy basil"). None of these are real Latin species epithets.
VERNACULAR_STOP = {
    "petal", "basil", "gourd", "daisy", "mustard", "cornflower", "pea", "apple", "tree",
    "barberry", "kino", "kudzu", "matcha", "husk", "jivak", "iridis", "patti", "phool", "phul",
    "mirch", "chaal", "dana", "badi", "murga", "irani", "madrasi", "fagonia", "wood", "kahwa",
}


def is_scientific(s):
    """A Latin binomial (Genus species...), excluding vernacular 'Genus word' strings."""
    if not re.match(r"^[A-Z][a-z]+(?:[- ][a-z]+)* [a-z]", s or ""):
        return False
    return s.split()[-1].lower() not in VERNACULAR_STOP


def main():
    p1 = _load(P1, {}).get("botanicals", {})
    auth = _load(AUTH, {})["results"]
    rq = _load(RQ, {})
    sr = {s["latin"]: s for s in rq["synonym_remaps"]}
    ty = {t["latin"]: t for t in rq["typo_flags"]}
    unk = {u["latin"]: u for u in rq["unknown_quarantine"]}

    # ---- disposition per Pass-1 key ----
    # groups[group_key] = list of member dicts; excluded = list
    groups = {}
    excluded = []
    RANK = {"accepted": 0, "synonym-resolved": 1, "owner-resolved": 2, "typo-corrected": 3,
            "genus_level": 4, "species_ambiguous": 5, "trade_ambiguous": 6}

    def add(group, member):
        groups.setdefault(group, []).append(member)

    for key in sorted(auth):
        st = auth[key]["status"]
        if st == "accepted":
            acc = auth[key].get("accepted_name") or key
            add(acc, {"key": key, "status": "accepted", "accepted_name": acc,
                      "resolved_by": "GBIF", "review_date": None,
                      "usage_key": auth[key].get("gbif_usage_key"), "trade": []})
        elif st == "synonym":
            e = sr[key]
            so = (e.get("signoff") or {}).get("status")
            if so == "trade_ambiguous":
                add("AMB::" + key, {"key": key, "status": "trade_ambiguous", "accepted_name": None,
                                    "candidates": e.get("candidate_accepted_names"),
                                    "resolved_by": "owner", "review_date": QUERY_DATE,
                                    "guidance": (e.get("signoff") or {}).get("guidance"), "trade": []})
            else:
                acc = e.get("accepted_name")
                rs = "owner-resolved" if so == "resolved_from_catalogue" else "synonym-resolved"
                rb = "owner" if so in ("resolved", "resolved_from_catalogue") else "GBIF"
                rv = QUERY_DATE if rb == "owner" else None
                trade = [key] if so == "resolved_from_catalogue" else []
                add(acc, {"key": key, "status": rs, "accepted_name": acc, "resolved_by": rb,
                          "review_date": rv, "trade": trade})
        elif st == "typo":
            e = ty[key]
            adopted = e.get("gbif_adopted")
            acc = adopted["accepted_name"] if adopted else e.get("corrected_name")
            add(acc, {"key": key, "status": "typo-corrected", "accepted_name": acc,
                      "corrected_name": e.get("corrected_name"), "resolved_by": "owner",
                      "review_date": QUERY_DATE, "trade": e.get("trade_synonyms", [])})
        else:  # unknown
            e = unk[key]
            b = e.get("triage_bucket")
            if b in ("non_botanical", "unresolvable"):
                excluded.append({"parsed_name": key, "bucket": b, "identity": e.get("identity"),
                                 "reason": e.get("note")})
            elif b == "genus_level":
                g = e.get("identity")
                add(g, {"key": key, "status": "genus_level", "accepted_name": g,
                        "resolved_by": "owner", "review_date": QUERY_DATE, "genus_rank": True, "trade": []})
            elif b == "species_ambiguous":
                add("AMB::" + key, {"key": key, "status": "species_ambiguous", "accepted_name": None,
                                    "candidates": e.get("candidate_accepted_names"),
                                    "resolved_by": "owner", "review_date": QUERY_DATE,
                                    "guidance": (e.get("signoff") or {}).get("guidance"), "trade": []})
            else:  # resolved
                adopted = e.get("gbif_adopted")
                acc = adopted["accepted_name"] if adopted else e.get("accepted_name")
                add(acc, {"key": key, "status": "owner-resolved", "accepted_name": acc,
                          "resolved_by": "owner", "review_date": QUERY_DATE,
                          "trade": e.get("trade_synonyms", [])})

    # ---- build one record per group ----
    used_ids = set()
    records = []
    for group, members in sorted(groups.items()):
        amb = group.startswith("AMB::")
        rep = min(members, key=lambda m: RANK[m["status"]])
        res_status = rep["status"]
        accepted_name = None if amb else group
        genus_rank = any(m.get("genus_rank") for m in members)

        # aliases across members
        keys = sorted({m["key"] for m in members})
        trade = sorted({t for m in members for t in (m.get("trade") or [])})
        corrected = sorted({m.get("corrected_name") for m in members if m.get("corrected_name")})
        p1_commons = sorted({c for k in keys for c in p1.get(k, {}).get("common_names", [])})

        sci_syn, common, trade_syn = [], [], sorted(set(trade))
        alias_pool = set(keys) | set(corrected)
        for a in sorted(alias_pool):
            if accepted_name and a == accepted_name:
                continue
            if a in trade_syn:
                continue
            (sci_syn if is_scientific(a) else common).append(a)
        # vernacular common names from pass-1 (dedup vs sci/trade)
        for c in p1_commons:
            if c not in common and c not in sci_syn and c not in trade_syn:
                common.append(c)
        common = sorted(set(common))
        sci_syn = sorted(set(sci_syn))

        rec = {
            "canonical_id": slug(group.replace("AMB::", "") if amb else group, used_ids),
            "accepted_name": accepted_name,
            "accepted_rank": None, "genus": None, "species": None, "infraspecific_epithet": None,
            "gbif_usage_key": None,
            "original_parsed_names": keys,
            "scientific_synonyms": sci_syn,
            "trade_synonyms": trade_syn,
            "common_names": common,
            "resolution_status": res_status,
            "provenance": {
                "authority": AUTHORITY, "query_date": QUERY_DATE,
                "resolved_by": rep["resolved_by"], "review_date": rep["review_date"],
            },
        }

        if amb:
            rec["ambiguity_flag"] = True
            rec["candidate_accepted_names"] = sorted(rep.get("candidates") or [])
            if rep.get("guidance"):
                rec["provenance"]["guidance"] = rep["guidance"]
        else:
            g, sp, inf, rank_guess = parse_name(accepted_name)
            key, gbif_rank = gbif_info(accepted_name)
            if genus_rank:
                rank_guess, sp, inf = "GENUS", None, None
            rec["genus"], rec["species"], rec["infraspecific_epithet"] = g, sp, inf
            rec["accepted_rank"] = gbif_rank or rank_guess
            rec["gbif_usage_key"] = key
        records.append(rec)

    # Pass-1 accounting is fixed at 641 BEFORE any Pass-2c enrichment is merged in.
    pass1_key_total = sum(len(r["original_parsed_names"]) for r in records) + len(excluded)

    # ---- ADR-013: merge backbone-enrichment deltas (accepted + single-accepted synonym) ----
    DELTA_SOURCES = [("pass2c_delta", os.path.join(HERE, "..", "pass2c", "delta_authority_results.json")),
                     ("pass2d_delta", os.path.join(HERE, "..", "pass2d", "delta_authority_results.json"))]
    delta_added = delta_merged = 0
    delta_by_source = {}
    by_acc = {r["accepted_name"].lower(): r for r in records if r["accepted_name"]}
    for source, DELTA in DELTA_SOURCES:
        if not os.path.exists(DELTA):
            continue
        added = merged = 0
        for e in json.load(open(DELTA, encoding="utf-8")).get("enrichment", []):
            acc, pnames = e["accepted_name"], e["parsed_names"]
            ex = by_acc.get(acc.lower())
            if ex:
                cur = set(ex["original_parsed_names"])
                for p in pnames:
                    if p not in cur:
                        ex["original_parsed_names"].append(p)
                        if is_scientific(p) and p != acc and p not in ex["scientific_synonyms"]:
                            ex["scientific_synonyms"].append(p)
                ex["original_parsed_names"].sort(); ex["scientific_synonyms"].sort()
                ex["provenance"].setdefault("enriched_by", []).append(source)
                merged += 1
                continue
            g, sp, inf, rank_guess = parse_name(acc)
            key, gbif_rank = gbif_info(acc)
            rec = {"canonical_id": slug(acc, used_ids), "accepted_name": acc,
                   "accepted_rank": gbif_rank or rank_guess, "genus": g, "species": sp,
                   "infraspecific_epithet": inf, "gbif_usage_key": key,
                   "original_parsed_names": sorted(set(pnames)),
                   "scientific_synonyms": sorted({p for p in pnames if is_scientific(p) and p != acc}),
                   "trade_synonyms": [], "common_names": [],
                   "resolution_status": "delta-accepted" if e["via"] == "accepted" else "delta-synonym-resolved",
                   "provenance": {"authority": AUTHORITY, "query_date": QUERY_DATE, "resolved_by": "GBIF",
                                  "review_date": None, "source": source}}
            by_acc[acc.lower()] = rec
            records.append(rec)
            added += 1
        delta_by_source[source] = {"new_identities": added, "merged_into_existing": merged}
        delta_added += added; delta_merged += merged
        print("  %s: +%d new identities, %d merged into existing" % (source, added, merged))

    # ---- ADR-013: merge confirmed duplicate records (absorb -> keep) ----
    idx = {r["canonical_id"]: r for r in records}
    merged_report, drop = [], set()
    for entry in RECORD_MERGES:
        a, k, why = entry[0], entry[1], entry[2]
        opts = entry[3] if len(entry) > 3 else {}
        ra, rk = idx.get(a), idx.get(k)
        if not ra or not rk:
            merged_report.append({"absorbed_id": a, "kept_id": k, "reason": why, "status": "SKIPPED (record missing)"})
            continue
        before = {f: set(rk.get(f) or []) for f in ("original_parsed_names", "scientific_synonyms",
                                                    "trade_synonyms", "common_names")}
        for f in ("original_parsed_names", "trade_synonyms", "common_names"):
            rk[f] = sorted(set(rk.get(f) or []) | set(ra.get(f) or []))
        extra_sci = set(ra.get("scientific_synonyms") or [])
        # A misresolution merge (drop_absorbed_accepted) discards the absorbed accepted_name — it was
        # a wrong name, not a synonym of the kept identity — carrying only its parsed/synonym aliases.
        if ra.get("accepted_name") and is_scientific(ra["accepted_name"]) and not opts.get("drop_absorbed_accepted"):
            extra_sci.add(ra["accepted_name"])                 # absorbed binomial becomes a synonym
        rk["scientific_synonyms"] = sorted((set(rk.get("scientific_synonyms") or []) | extra_sci) - {rk["accepted_name"]})
        rk.setdefault("provenance", {}).setdefault("merged_records", []).append(
            {"absorbed_id": a, "absorbed_accepted_name": ra.get("accepted_name"), "reason": why})
        merged_report.append({"absorbed_id": a, "absorbed_name": ra.get("accepted_name"),
            "kept_id": k, "kept_name": rk.get("accepted_name"), "reason": why, "status": "merged",
            "original_parsed_names_added": sorted(set(rk["original_parsed_names"]) - before["original_parsed_names"]),
            "scientific_synonyms_added": sorted(set(rk["scientific_synonyms"]) - before["scientific_synonyms"]),
            "common_names_added": sorted(set(rk["common_names"]) - before["common_names"])})
        drop.add(a)
    records = [r for r in records if r["canonical_id"] not in drop]
    if merged_report:
        print("  record merges: %d applied" % len(drop))
        for m in merged_report:
            print("    %s -> %s [%s]" % (m["absorbed_id"], m["kept_id"], m.get("status", "merged")))

    # ---- ADR-013: owner common-name mapping round (adds common_names / new identities) ----
    CN = os.path.join(HERE, "..", "sources", "common_name_resolved_mappings.json")
    cn_added = cn_merged = 0
    if os.path.exists(CN):
        by_acc = {r["accepted_name"].lower(): r for r in records if r["accepted_name"]}
        for binom, m in json.load(open(CN, encoding="utf-8"))["mappings"].items():
            ex = by_acc.get(binom.lower())
            if ex:
                cur = set(ex.get("common_names") or [])
                ex["common_names"] = sorted(cur | set(m["common_names"]))
                ex["provenance"]["accepted_outside_gbif_candidates"] = True
                ex["provenance"]["owner_common_mapping"] = True
                ex["provenance"]["gbif_recheck"] = m["gbif_recheck"]
                cn_merged += 1
            else:
                g, sp, inf, rank_guess = parse_name(binom)
                key, gbif_rank = gbif_info(binom)
                rec = {"canonical_id": slug(binom, used_ids), "accepted_name": binom,
                       "accepted_rank": gbif_rank or rank_guess, "genus": g, "species": sp,
                       "infraspecific_epithet": inf, "gbif_usage_key": key,
                       "original_parsed_names": [binom], "scientific_synonyms": [], "trade_synonyms": [],
                       "common_names": sorted(m["common_names"]),
                       "resolution_status": "owner-common-mapped",
                       "provenance": {"authority": "owner", "resolved_by": "owner", "query_date": m["date"],
                                      "review_date": m["date"], "provenance_note": m["provenance"],
                                      "accepted_outside_gbif_candidates": True,
                                      "gbif_recheck": m["gbif_recheck"], "source": "owner_common_mapping"}}
                by_acc[binom.lower()] = rec
                records.append(rec)
                cn_added += 1
        print("  common-name mappings: +%d new identities, %d common-name sets merged" % (cn_added, cn_merged))

    # ---- ADR-013: trade-usage adjudication (GBIF adoptions / kept-synonyms / ambiguity / collisions) ----
    by_acc = {r["accepted_name"].lower(): r for r in records if r["accepted_name"]}
    adj = {"gbif_adopted": [], "gbif_kept_synonym": [], "trade_ambiguous": [], "common_added": [],
           "common_removed": [], "notes": [], "not_found": []}

    def _sci_add(rec, name):
        if name and name != rec["accepted_name"] and name not in rec["scientific_synonyms"]:
            rec["scientific_synonyms"] = sorted(rec["scientific_synonyms"] + [name])

    # A1+A4 — adopt GBIF accepted name; keep owner binomial as scientific_synonym; canonical_id stable.
    for owner, gbif in GBIF_ADOPT.items():
        rec = by_acc.get(owner.lower())
        if not rec:
            adj["not_found"].append(("gbif_adopt", owner)); continue
        rec["accepted_name"] = gbif
        _sci_add(rec, owner)
        g, sp, inf, rank_guess = parse_name(gbif)
        key, gbif_rank = gbif_info(gbif)
        rec["genus"], rec["species"], rec["infraspecific_epithet"] = g, sp, inf
        rec["accepted_rank"] = gbif_rank or rank_guess
        rec["gbif_usage_key"] = key
        rec["provenance"]["gbif_adopted_from"] = owner
        rec["provenance"]["adjudication"] = "adopt_gbif_accepted"
        rec["provenance"]["review_date"] = ADJUDICATION_DATE
        by_acc[gbif.lower()] = rec
        adj["gbif_adopted"].append((owner, gbif))

    # A2 — keep trade-primary accepted; record GBIF name as an authority synonym.
    for owner, gbif in GBIF_KEEP_SYNONYM.items():
        rec = by_acc.get(owner.lower())
        if not rec:
            adj["not_found"].append(("gbif_keep", owner)); continue
        _sci_add(rec, gbif)
        rec["provenance"]["gbif_authority_synonym"] = gbif
        rec["provenance"]["adjudication"] = "keep_trade_primary"
        rec["provenance"]["review_date"] = ADJUDICATION_DATE
        adj["gbif_kept_synonym"].append((owner, gbif))

    # A3 — Solanum indicum -> trade_ambiguous.
    rec = by_acc.get(SOLANUM_INDICUM_AMBIGUOUS["accepted_name"].lower())
    if rec:
        rec["accepted_name"] = None
        rec["accepted_rank"] = rec["genus"] = rec["species"] = rec["infraspecific_epithet"] = None
        rec["gbif_usage_key"] = None
        rec["resolution_status"] = "trade_ambiguous"
        rec["ambiguity_flag"] = True
        rec["candidate_accepted_names"] = SOLANUM_INDICUM_AMBIGUOUS["candidate_accepted_names"]
        rec["provenance"]["adjudication"] = "trade_ambiguous"
        rec["provenance"]["guidance"] = SOLANUM_INDICUM_AMBIGUOUS["note"]
        rec["provenance"]["review_date"] = ADJUDICATION_DATE
        adj["trade_ambiguous"].append("Solanum indicum")
    else:
        adj["not_found"].append(("trade_ambiguous", "Solanum indicum"))

    # B1 — owner-adjudicated common-name additions (create identity if absent).
    by_acc = {r["accepted_name"].lower(): r for r in records if r["accepted_name"]}
    for binom, spec in ADJUDICATION_COMMON.items():
        rec = by_acc.get(binom.lower())
        if rec:
            rec["common_names"] = sorted(set(rec["common_names"]) | set(spec["common_names"]))
            rec["provenance"]["note"] = spec["note"]
            rec["provenance"]["review_date"] = ADJUDICATION_DATE
        else:
            g, sp, inf, rank_guess = parse_name(binom)
            key, gbif_rank = gbif_info(binom)
            rec = {"canonical_id": slug(binom, used_ids), "accepted_name": binom,
                   "accepted_rank": gbif_rank or rank_guess, "genus": g, "species": sp,
                   "infraspecific_epithet": inf, "gbif_usage_key": key,
                   "original_parsed_names": [binom], "scientific_synonyms": [], "trade_synonyms": [],
                   "common_names": sorted(spec["common_names"]),
                   "resolution_status": "owner-common-mapped",
                   "provenance": {"authority": "owner", "resolved_by": "owner", "query_date": ADJUDICATION_DATE,
                                  "review_date": ADJUDICATION_DATE, "adjudication": "owner_common_resolution",
                                  "note": spec["note"], "source": "trade_usage_adjudication"}}
            by_acc[binom.lower()] = rec
            records.append(rec)
        adj["common_added"].append((binom, spec["common_names"]))

    # C — strike spurious supplier common names (data errors); stamp free-text identity notes.
    idx2 = {r["canonical_id"]: r for r in records}
    for cid, spec in COMMON_NAME_CORRECTIONS.items():
        rec = idx2.get(cid)
        if not rec:
            adj["not_found"].append(("common_correction", cid)); continue
        removed = [c for c in rec["common_names"] if c in set(spec["remove"])]
        rec["common_names"] = [c for c in rec["common_names"] if c not in set(spec["remove"])]
        rec["provenance"].setdefault("common_name_corrections", []).append(
            {"removed": removed, "reason": spec["reason"], "date": ADJUDICATION_DATE})
        adj["common_removed"].append((cid, removed))
    for cid, note in IDENTITY_NOTES.items():
        rec = idx2.get(cid)
        if rec:
            rec["provenance"]["note"] = note
            adj["notes"].append(cid)
        else:
            adj["not_found"].append(("identity_note", cid))

    print("  adjudication: %d GBIF adopted, %d kept-synonym, %d ->trade_ambiguous, %d common added, "
          "%d common removed, %d notes" % (len(adj["gbif_adopted"]), len(adj["gbif_kept_synonym"]),
          len(adj["trade_ambiguous"]), len(adj["common_added"]), len(adj["common_removed"]), len(adj["notes"])))
    if adj["not_found"]:
        print("  !! adjudication targets NOT FOUND:", adj["not_found"])

    # ---- ADR-013 schema v2: separate authority vs trade-primary vs display naming ----
    # accepted_name is now STRICTLY taxonomic (== authority_accepted_name). For the 9 trade-primary
    # exceptions the authority name differed from the commercially entrenched name and accepted_name
    # held the trade name — the field meant two things. Fix: flip accepted_name to the authority name,
    # keep the trade name as a scientific_synonym (still resolvable), and show the trade name via
    # canonical_display_name. canonical_id is IMMUTABLE and unchanged by any of this.
    trade_primary_of = {}
    for r in records:
        auth = r.get("provenance", {}).get("gbif_authority_synonym")
        if auth and r["accepted_name"] and r["accepted_name"] != auth:
            trade = r["accepted_name"]
            r["accepted_name"] = auth
            syn = set(r["scientific_synonyms"]) - {auth}
            if is_scientific(trade):
                syn.add(trade)                        # trade name remains a resolvable synonym
            r["scientific_synonyms"] = sorted(syn)
            g, sp, inf, rank_guess = parse_name(auth)
            key, gbif_rank = gbif_info(auth)
            r["genus"], r["species"], r["infraspecific_epithet"] = g, sp, inf
            r["accepted_rank"] = gbif_rank or rank_guess
            r["gbif_usage_key"] = key
            r["provenance"]["accepted_name_semantics"] = "authority (adopted); trade name shown via canonical_display_name"
            trade_primary_of[r["canonical_id"]] = trade

    # ---- ADR-013 schema v2: dedup identities that converged on one accepted_name ----
    # The common-name mapping round can create a fresh record for a binomial that a delta had already
    # resolved to a DIFFERENT accepted_name (owner 'Pisum sativum' vs delta-accepted 'Lathyrus
    # oleraceus'); after the authority flip both carry the same accepted_name. Two records with the
    # same accepted_name are the same identity -> merge. Keep the pre-existing (non-owner-common-mapped)
    # record's canonical_id for stability; carry the trade-primary designation onto the survivor.
    acc_groups = {}
    for r in records:
        if r["accepted_name"]:
            acc_groups.setdefault(r["accepted_name"], []).append(r)
    schema_dupes, drop2 = [], set()
    for acc, grp in acc_groups.items():
        if len(grp) < 2:
            continue
        grp = sorted(grp, key=lambda r: (r["provenance"].get("source") == "owner_common_mapping", r["canonical_id"]))
        keep = grp[0]
        for r in grp[1:]:
            for f in ("original_parsed_names", "scientific_synonyms", "trade_synonyms", "common_names"):
                keep[f] = sorted(set(keep.get(f) or []) | set(r.get(f) or []))
            keep["scientific_synonyms"] = sorted(set(keep["scientific_synonyms"]) - {keep["accepted_name"]})
            if r["canonical_id"] in trade_primary_of and keep["canonical_id"] not in trade_primary_of:
                trade_primary_of[keep["canonical_id"]] = trade_primary_of[r["canonical_id"]]
            for pk in ("owner_common_mapping", "accepted_outside_gbif_candidates", "gbif_authority_synonym",
                       "adjudication", "gbif_recheck"):
                if pk in r["provenance"] and pk not in keep["provenance"]:
                    keep["provenance"][pk] = r["provenance"][pk]
            keep["provenance"].setdefault("merged_records", []).append(
                {"absorbed_id": r["canonical_id"], "absorbed_source": r["provenance"].get("source"),
                 "reason": "converged on accepted_name '%s' after authority adjudication" % acc})
            trade_primary_of.pop(r["canonical_id"], None)
            drop2.add(r["canonical_id"])
            schema_dupes.append({"absorbed": r["canonical_id"], "kept": keep["canonical_id"], "accepted_name": acc})
    records = [r for r in records if r["canonical_id"] not in drop2]
    if schema_dupes:
        print("  schema v2 dedup: merged %d converged duplicate(s):" % len(schema_dupes))
        for d in schema_dupes:
            print("    %s -> %s [%s]" % (d["absorbed"], d["kept"], d["accepted_name"]))

    records.sort(key=lambda r: (r["accepted_name"] or "~" + r["canonical_id"]))

    # Add the three explicit naming fields to EVERY record, right after accepted_name.
    #   authority_accepted_name  == accepted_name (strictly taxonomic; None if trade_ambiguous)
    #   trade_primary_name       == entrenched trade name where it differs from authority, else None
    #   canonical_display_name   == what the tool shows: trade_primary_name if set, else the authority name
    def _with_naming(r):
        acc = r["accepted_name"]
        trade = trade_primary_of.get(r["canonical_id"])
        out = {}
        for k, v in r.items():
            out[k] = v
            if k == "accepted_name":
                out["authority_accepted_name"] = acc
                out["trade_primary_name"] = trade
                out["canonical_display_name"] = trade or acc
        return out
    records = [_with_naming(r) for r in records]
    naming_exceptions = sorted(r["canonical_id"] for r in records if r["trade_primary_name"])
    print("  schema v2 naming: %d trade-primary exceptions (display=trade, accepted_name=authority):" % len(naming_exceptions))
    for r in records:
        if r["trade_primary_name"]:
            print("    %-26s display=%-26s authority=%s" % (r["canonical_id"], r["trade_primary_name"], r["authority_accepted_name"]))
    _save(CACHE, _local)

    # ---- write outputs ----
    from collections import Counter
    status_counts = Counter(r["resolution_status"] for r in records)
    trinomials = sorted(r["accepted_name"] for r in records if r["infraspecific_epithet"])
    key_total = pass1_key_total  # Pass-1 accounting stays 641; enrichment tracked separately

    doc = {"_meta": {
        "artifact": "ADR-013 frozen identity backbone (Pass-3 join target)",
        "identity_version": IDENTITY_VERSION,
        "identity_schema_version": IDENTITY_SCHEMA_VERSION,
        "frozen": True,
        "built": QUERY_DATE, "authority": AUTHORITY,
        "identity_records": len(records), "excluded": len(excluded),
        "pass1_keys_accounted": key_total,
        "schema": {
            "version": IDENTITY_SCHEMA_VERSION,
            "naming_fields": {
                "authority_accepted_name": "The taxonomic authority (GBIF) accepted name. Strictly taxonomic. "
                                           "None for trade_ambiguous records (see candidate_accepted_names).",
                "trade_primary_name": "The commercially entrenched name where it differs from the authority "
                                      "name and the tool shows it instead. Null when display == authority.",
                "canonical_display_name": "What the tool displays: trade_primary_name if set, else the "
                                          "authority name. None for trade_ambiguous.",
                "accepted_name": "STRICTLY TAXONOMIC, == authority_accepted_name. (Was overloaded pre-v2: it "
                                 "held the trade name for the trade-primary exceptions. Now unambiguous. "
                                 "Retained as the resolver/index key.)",
            },
            "trade_primary_exceptions": naming_exceptions,
            "converged_duplicates_merged": schema_dupes,
            "canonical_id_contract": "canonical_id is an IMMUTABLE identifier and is NOT guaranteed to mirror "
                                     "the current accepted_name (e.g. astragalus-membranaceus now resolves to "
                                     "Astragalus mongholicus). Join by original_parsed_names/synonyms, never by "
                                     "parsing the canonical_id string.",
        },
        "delta_enrichment": {"total_new": delta_added, "total_merged": delta_merged, "by_source": delta_by_source},
        "common_name_mappings": {"new_identities": cn_added, "merged_into_existing": cn_merged,
                                 "source": "knowledge/sources/common_name_resolved_mappings.json (owner)"},
        "trade_usage_adjudication": {
            "date": ADJUDICATION_DATE,
            "gbif_adopted": [{"from": o, "to": g} for o, g in adj["gbif_adopted"]],
            "gbif_kept_synonym": [{"accepted": o, "authority_synonym": g} for o, g in adj["gbif_kept_synonym"]],
            "trade_ambiguous": adj["trade_ambiguous"],
            "common_added": [{"accepted": b, "common_names": c} for b, c in adj["common_added"]],
            "common_removed": [{"canonical_id": c, "removed": r} for c, r in adj["common_removed"]],
            "identity_notes": adj["notes"], "targets_not_found": adj["not_found"],
            "note": "Owner adjudication of the common-name-round GBIF disagreements + collision quarantine. "
                    "No silent correction; every change is owner-signed."},
        "record_merges": merged_report,
        "resolution_status_counts": dict(status_counts),
        "freeze_policy": "FROZEN. Do NOT edit botanical_identity.json in place once Pass 3 has started. "
                         "Corrections flow: fix in Pass 2 (review queue / sign-off) -> rebuild this "
                         "backbone -> bump identity_version. Never in-place edits. See README.md.",
        "downstream_contract": "Every downstream artifact (Pass 3+) MUST record the identity_version "
                               "it was built against.",
        "note": "One record per resolved botanical identity. Join Pass-3 supplier/form data via "
                "original_parsed_names. accepted_name is authoritative; owner sign-off overrides GBIF "
                "where recorded. Non-botanical/unresolvable are in excluded.json.",
    }, "identities": records}
    _save(os.path.join(HERE, "botanical_identity.json"), doc)

    exc_doc = {"_meta": {"built": QUERY_DATE, "count": len(excluded),
                         "note": "Pass-1 keys excluded from the botanical backbone: not plants "
                                 "(non_botanical) or not identifiable to one taxon (unresolvable)."},
               "excluded": sorted(excluded, key=lambda e: (e["bucket"], e["parsed_name"]))}
    _save(os.path.join(HERE, "excluded.json"), exc_doc)

    L = ["# Frozen Identity Backbone — ADR-013 (Pass-3 join target)\n",
         "> **🔒 FROZEN — identity_version `%s`, schema v%d.** Do NOT edit `botanical_identity.json` in"
         % (IDENTITY_VERSION, IDENTITY_SCHEMA_VERSION),
         "> place once Pass 3 has started. Corrections: fix in Pass 2 → rebuild → bump identity_version.",
         "> Every downstream (Pass 3+) artifact must record the identity_version it built against. See README.md.\n",
         "> One record per resolved botanical identity. Pass 3 joins supplier/form data via",
         "> `original_parsed_names`. `accepted_name` authoritative; owner sign-off overrides GBIF where set.\n",
         "## Totals",
         "| metric | value |", "|---|---:|",
         "| identity records | **%d** |" % len(records),
         "| excluded (non_botanical + unresolvable) | %d |" % len(excluded),
         "| Pass-1 keys accounted for | %d / 641 |" % key_total,
         "| trinomials (infraspecific) | %d |" % len(trinomials), "",
         "## Records by resolution_status",
         "| status | count |", "|---|---:|"]
    for s, n in sorted(status_counts.items(), key=lambda kv: -kv[1]):
        L.append("| %s | %d |" % (s, n))
    L.append("")
    L.append("## Trinomials parsed (accepted_name → rank · infraspecific epithet)")
    L.append("| accepted_name | rank | infraspecific |")
    L.append("|---|---|---|")
    for r in records:
        if r["infraspecific_epithet"]:
            L.append("| `%s` | %s | %s |" % (r["accepted_name"], r["accepted_rank"], r["infraspecific_epithet"]))
    L.append("")
    L.append("## Excluded (%d)" % len(excluded))
    L.append("non_botanical %d · unresolvable %d — see excluded.json." %
             (sum(1 for e in excluded if e["bucket"] == "non_botanical"),
              sum(1 for e in excluded if e["bucket"] == "unresolvable")))
    L.append("")
    with open(os.path.join(HERE, "botanical_identity.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print("IDENTITY BACKBONE BUILT")
    print("  identity records: %d   excluded: %d   pass-1 keys accounted: %d/641" %
          (len(records), len(excluded), key_total))
    print("  by status:", dict(status_counts))
    print("  trinomials (%d):" % len(trinomials))
    for t in trinomials:
        r = next(x for x in records if x["accepted_name"] == t)
        print("     %-34s rank=%-12s infra=%s" % (t, r["accepted_rank"], r["infraspecific_epithet"]))
    assert key_total == 641, "key accounting mismatch: %d != 641" % key_total


if __name__ == "__main__":
    main()
