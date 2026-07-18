#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 2 — owner sign-off (auditable, idempotent).

Single source of truth for all Pass-2 human decisions. Applies to
knowledge/pass2/pass2_review_queue.json:

Ambiguous synonyms (20 total):
 - 15 RESOLVED from GBIF candidates (provenance: ChatGPT+owner review).
 -  2 RESOLVED from Herbuno's own catalogue (provenance: Herbuno catalogue) — accepted name may
      lie OUTSIDE the GBIF candidate set; trade synonym kept.
 -  3 held TRADE-AMBIGUOUS (Herbuno does not stock those species; require source/provenance).

Typo flags (23): ALL owner-approved spelling corrections (provenance: GBIF fuzzy match + owner
approval). Correction recorded; source keys are not rewritten here (downstream re-keying).

All decisions stamped resolved_by=owner, date=2026-07-18. authority_results.json (raw GBIF
output) is left unchanged — this is the human decision layer.

Run:  python3 knowledge/pass2/apply_signoff.py
"""

import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.join(HERE, "pass2_review_queue.json")

DATE, RESOLVED_BY = "2026-07-18", "owner"
PROV_GBIF = "ChatGPT+owner review"
PROV_CATALOGUE = "Herbuno catalogue"
PROV_TYPO = "GBIF fuzzy match + owner approval"

# --- ambiguous synonyms resolved from GBIF candidates ---
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

# --- ambiguous synonyms resolved from Herbuno catalogue evidence (accepted name may be OUTSIDE
#     the GBIF candidate set; not validated against candidates) ---
CATALOGUE_RESOLVED = {
    "Orchis latifolia": {"accepted": "Dactylorhiza hatagirea",
                         "note": "Herbuno stocks 'Salam Panja Tuber — Dactylorhiza hatagirea'."},
    "Dolichos biflorus": {"accepted": "Macrotyloma uniflorum",
                          "note": "Herbuno stocks 'Horse Gram — Dolichos biflorus'; Indian horse gram = "
                                  "M. uniflorum; keep Dolichos biflorus as trade synonym."},
}

# --- unknown-quarantine triage (owner) ---
# NON-BOTANICAL: minerals / salts / clays / chemicals / animal / refined (incl. Sat nimbu = citric acid)
UNK_NON_BOTANICAL = [
    "Abhrak bhasm", "Activated charcoal", "Asphaltum punjabianum", "Bentonite clay", "Bura armani",
    "Cuttle fish", "Ferrous sulphate", "Geru mitti", "Hartaal varki", "Kasheesh hara", "Keherwa dana",
    "Potassium carbonate", "Potassium nitrate", "Rajat makshik", "Rock sugar", "Sangesar mahi",
    "Sat nimbu", "Sendha namak",
]
UNK_NON_BOTANICAL_IDENTITY = {"Sat nimbu": "citric acid"}
# GENUS-LEVEL: real traded material identified at genus level (moved OUT of unresolvable)
UNK_GENUS_LEVEL = {
    "Epimedium spp": "Epimedium", "Gossypium spp": "Gossypium", "Jasminum spp": "Jasminum",
    "Morus spp": "Morus", "Tagetes spp": "Tagetes",
}
# UNRESOLVABLE: fragments / blends / too vague (the 5 "spp" have been removed to genus_level)
UNK_UNRESOLVABLE = [
    "Ber patthar", "Chokh wood", "Dhoop wood", "Dooku patti", "Kashmiri kahwa", "Kashmiri patta",
    "Lotus saffron", "Rosa hybrid", "Sabut garam", "Velvety beauty",
]
# RESOLVED from a quarantined unknown (owner)
UNK_RESOLVED = {
    "Rhizoma iridis": {"accepted": "Iris germanica var. florentina",
                       "provenance": "pharmacopoeial name (owner)",
                       "note": "Orris root; pharmacopoeial Latin 'Rhizoma Iridis'."},
}
# COMMON NAMES resolved to binomials from owner botanical knowledge. These were quarantined
# unknowns (no GBIF candidates), so every accepted name is owner-supplied ->
# accepted_outside_gbif_candidates: true (flag for Pass-2b authority re-check).
UNK_COMMON_RESOLVED = {
    "Blue cornflower": "Centaurea cyanus", "Butterfly pea": "Clitoria ternatea",
    "Chakra phul": "Illicium verum", "Desert fagonia": "Fagonia cretica",
    "False daisy": "Eclipta prostrata", "Genda phool": "Tagetes erecta",
    "Gulab patti": "Rosa damascena", "Hedge mustard": "Sisymbrium officinale",
    "Holy basil": "Ocimum tenuiflorum", "Indian barberry": "Berberis aristata",
    "Indian kino": "Pterocarpus marsupium", "Indian kudzu": "Pueraria tuberosa",
    "Ipomea trurpethum": "Operculina turpethum", "Japanese matcha": "Camellia sinensis",
    "Kishmish badi": "Vitis vinifera", "Lal murga": "Celosia cristata",
    "Methi dana": "Trigonella foenum-graecum", "Ochrocarpus longifolius": "Mammea longifolia",
    "Portulaca oleracea-purslane": "Portulaca oleracea", "Psyllium husk": "Plantago ovata",
    "Putra jivak": "Putranjiva roxburghii", "Rose petal": "Rosa damascena",
    "Safed mirch": "Piper nigrum", "Walnut tree": "Juglans regia",
    "Akarkara irani": "Anacyclus pyrethrum", "Anantmool madrasi": "Decalepis hamiltonii",
    "Anthem graveolens": "Anethum graveolens", "Arjuna chaal": "Terminalia arjuna",
    "Bitter gourd": "Momordica charantia",
}
# SPECIES-AMBIGUOUS common name — do not resolve without source/provenance
UNK_SPECIES_AMBIGUOUS = {
    "Thorn apple": {"candidates": ["Datura metel", "Datura stramonium"],
                    "guidance": "Datura metel vs Datura stramonium; requires source/provenance."},
}
# everything else among the 64 -> COMMON_NAME (recognisable, not yet resolved)

# --- still trade-ambiguous: Herbuno does not stock these species ---
TRADE_AMBIGUOUS = {
    "Cinnamomum cassia": "Homonym; Chinese cassia trade material ≠ Neolitsea. Keep controlled identity "
                         "\"Chinese cassia — Cinnamomum cassia/aromaticum\" pending source. "
                         "Herbuno does not stock this species.",
    "Phaseolus trilobus": "Indian Ayurvedic identity = Vigna trilobata (not in GBIF candidates); flag. "
                          "Herbuno does not stock this species.",
    "Salvia haematodes": "Behman Surkh = Salvia pratensis subsp. haematodes; clary sage = S. sclarea; "
                         "require author/commodity. Herbuno does not stock this species.",
}


def main():
    with open(RQ, encoding="utf-8") as f:
        rq = json.load(f)

    syn = {s["latin"]: s for s in rq["synonym_remaps"]}
    all_ambiguous = {k for k, v in syn.items() if v.get("ambiguous") or v.get("signoff")}
    covered = set(RESOLVED) | set(CATALOGUE_RESOLVED) | set(TRADE_AMBIGUOUS)
    assert all_ambiguous == covered, "mismatch: missing %s extra %s" % (
        sorted(all_ambiguous - covered), sorted(covered - all_ambiguous))
    assert len(covered) == 20, "expected 20 ambiguous decisions, got %d" % len(covered)
    for latin, d in RESOLVED.items():
        if not d.get("keep_original"):
            assert d["accepted"] in syn[latin]["candidate_accepted_names"], \
                "%s: %r not a GBIF candidate" % (latin, d["accepted"])

    # RESOLVED (GBIF candidates)
    for latin, d in RESOLVED.items():
        e = syn[latin]
        e.update(accepted_name=d["accepted"], ambiguous=False)
        e.pop("status", None)
        e["signoff"] = {"status": "resolved", "decision": d["accepted"],
                        "resolved_by": RESOLVED_BY, "date": DATE, "provenance": PROV_GBIF}
        e["note"] = "Owner-resolved from GBIF candidates." + (" " + d["note"] if d.get("note") else "")

    # RESOLVED (Herbuno catalogue)
    for latin, d in CATALOGUE_RESOLVED.items():
        e = syn[latin]
        outside = d["accepted"] not in e["candidate_accepted_names"]
        e.update(accepted_name=d["accepted"], ambiguous=False)
        e.pop("status", None)
        e["signoff"] = {"status": "resolved_from_catalogue", "decision": d["accepted"],
                        "resolved_by": RESOLVED_BY, "date": DATE, "provenance": PROV_CATALOGUE,
                        "accepted_outside_gbif_candidates": outside}
        e["note"] = "Owner-resolved from Herbuno catalogue. " + d["note"]

    # TRADE-AMBIGUOUS (held)
    for latin, guidance in TRADE_AMBIGUOUS.items():
        e = syn[latin]
        e.update(accepted_name=None, ambiguous=True, status="trade_ambiguous")
        e["signoff"] = {"status": "trade_ambiguous", "requires": "source/provenance before resolving",
                        "guidance": guidance, "resolved_by": RESOLVED_BY, "date": DATE,
                        "provenance": PROV_CATALOGUE}
        e["note"] = "Trade-ambiguous — NOT auto-resolved; requires source/provenance."

    # TYPO corrections — ALL owner-approved
    for t in rq["typo_flags"]:
        t["corrected_name"] = t["suggested_correction"]
        t["signoff"] = {"status": "corrected", "corrected_to": t["suggested_correction"],
                        "resolved_by": RESOLVED_BY, "date": DATE, "provenance": PROV_TYPO}
        t["note"] = "Owner-approved spelling correction."

    # --- unknown-quarantine triage ---
    unk = {u["latin"]: u for u in rq["unknown_quarantine"]}
    covered_unk = (set(UNK_NON_BOTANICAL) | set(UNK_GENUS_LEVEL) | set(UNK_UNRESOLVABLE)
                   | set(UNK_RESOLVED) | set(UNK_COMMON_RESOLVED) | set(UNK_SPECIES_AMBIGUOUS))
    assert covered_unk <= set(unk), "triage names not in quarantine: %s" % sorted(covered_unk - set(unk))
    triage_counts = {"common_name": 0, "non_botanical": 0, "genus_level": 0, "unresolvable": 0,
                     "resolved": 0, "species_ambiguous": 0}
    for latin, e in unk.items():
        if latin in UNK_RESOLVED:
            d = UNK_RESOLVED[latin]
            e.update(triage_bucket="resolved", status="resolved", accepted_name=d["accepted"])
            e["signoff"] = {"status": "resolved", "decision": d["accepted"], "resolved_by": RESOLVED_BY,
                            "date": DATE, "provenance": d["provenance"]}
            e["note"] = "Owner-resolved from quarantine. " + d["note"]
        elif latin in UNK_COMMON_RESOLVED:
            binom = UNK_COMMON_RESOLVED[latin]
            e.update(triage_bucket="resolved", status="resolved", accepted_name=binom,
                     accepted_outside_gbif_candidates=True)
            e["signoff"] = {"status": "resolved", "decision": binom, "resolved_by": RESOLVED_BY,
                            "date": DATE, "provenance": "owner botanical knowledge",
                            "accepted_outside_gbif_candidates": True}
            e["note"] = "Owner-resolved common name to binomial (owner botanical knowledge)."
        elif latin in UNK_SPECIES_AMBIGUOUS:
            d = UNK_SPECIES_AMBIGUOUS[latin]
            e.update(triage_bucket="species_ambiguous", status="species_ambiguous",
                     accepted_name=None, candidate_accepted_names=d["candidates"])
            e["signoff"] = {"status": "species_ambiguous",
                            "requires": "source/provenance before resolving", "guidance": d["guidance"],
                            "resolved_by": RESOLVED_BY, "date": DATE, "provenance": "owner botanical knowledge"}
            e["note"] = "Species-ambiguous — requires source/provenance."
        elif latin in UNK_GENUS_LEVEL:
            e.update(triage_bucket="genus_level", genus_level=True, identity=UNK_GENUS_LEVEL[latin])
            e["signoff"] = {"status": "genus_level", "resolved_by": RESOLVED_BY, "date": DATE,
                            "provenance": "owner triage"}
            e["note"] = "Real traded material at genus level; genus kept as identity."
        elif latin in UNK_NON_BOTANICAL:
            e.update(triage_bucket="non_botanical")
            if latin in UNK_NON_BOTANICAL_IDENTITY:
                e["identity"] = UNK_NON_BOTANICAL_IDENTITY[latin]
            e["note"] = "Non-botanical (mineral/salt/chemical/animal); not a plant identity."
        elif latin in UNK_UNRESOLVABLE:
            e.update(triage_bucket="unresolvable")
            e["note"] = "Unresolvable: fragment / blend / too vague to identify one species."
        else:
            e.update(triage_bucket="common_name")
            e["note"] = "Recognisable common/vernacular name; likely maps to a Latin binomial (Pass-2b)."
        triage_counts[e["triage_bucket"]] += 1

    rq["_meta"]["owner_signoff"] = {
        "date": DATE, "resolved_by": RESOLVED_BY,
        "ambiguous_total": 20, "resolved_from_gbif": len(RESOLVED),
        "resolved_from_catalogue": len(CATALOGUE_RESOLVED),
        "trade_ambiguous_remaining": len(TRADE_AMBIGUOUS),
        "typos_corrected": len(rq["typo_flags"]),
        "unknown_triage": triage_counts,
        "note": "Decisions applied to synonym_remaps, typo_flags and unknown_quarantine. "
                "authority_results.json (raw GBIF output) left unchanged — human sign-off layer.",
    }

    with open(RQ, "w", encoding="utf-8") as f:
        json.dump(rq, f, ensure_ascii=False, indent=2)

    # --- pass2_signoff.md ---
    L = ["# Pass-2 Owner Sign-off (ADR-013)\n",
         "> Applied %s · resolved_by **%s**.\n" % (DATE, RESOLVED_BY),
         "**%d** ambiguous synonyms resolved from GBIF · **%d** resolved from Herbuno catalogue · "
         "**%d** held trade-ambiguous · **%d** typos corrected.\n" %
         (len(RESOLVED), len(CATALOGUE_RESOLVED), len(TRADE_AMBIGUOUS), len(rq["typo_flags"])),
         "## Ambiguous synonyms resolved — from GBIF candidates",
         "| original | → accepted | note |", "|---|---|---|"]
    for latin, d in sorted(RESOLVED.items()):
        L.append("| `%s` | **%s** | %s |" % (latin, d["accepted"], d.get("note", "")))
    L.append("\n## Ambiguous synonyms resolved — from Herbuno catalogue")
    L.append("| original | → accepted | note |")
    L.append("|---|---|---|")
    for latin, d in sorted(CATALOGUE_RESOLVED.items()):
        L.append("| `%s` | **%s** | %s |" % (latin, d["accepted"], d["note"]))
    L.append("\n## Held trade-ambiguous (Herbuno does not stock — require source/provenance)")
    L.append("| original | candidates (GBIF) | owner guidance |")
    L.append("|---|---|---|")
    for latin, g in sorted(TRADE_AMBIGUOUS.items()):
        L.append("| `%s` | %s | %s |" % (latin, ", ".join(syn[latin]["candidate_accepted_names"]), g))
    L.append("\n## Typo corrections (all owner-approved)")
    L.append("| original | → corrected |")
    L.append("|---|---|")
    for t in sorted(rq["typo_flags"], key=lambda x: x["latin"]):
        L.append("| `%s` | **%s** |" % (t["latin"], t["corrected_name"]))
    L.append("\n## Unknown-quarantine triage (%d)" % len(unk))
    L.append("resolved %d · species_ambiguous %d · genus_level %d · non_botanical %d · unresolvable %d · "
             "common_name %d\n" % (triage_counts["resolved"], triage_counts["species_ambiguous"],
             triage_counts["genus_level"], triage_counts["non_botanical"],
             triage_counts["unresolvable"], triage_counts["common_name"]))
    L.append("### Common names resolved to binomials (owner botanical knowledge; outside GBIF candidates)")
    L.append("| common name | → binomial |")
    L.append("|---|---|")
    for k, v in sorted(UNK_COMMON_RESOLVED.items()):
        L.append("| `%s` | **%s** |" % (k, v))
    L.append("| `Rhizoma iridis` | **%s** (pharmacopoeial) |" % UNK_RESOLVED["Rhizoma iridis"]["accepted"])
    L.append("\n- **Species-ambiguous (held):** `Thorn apple` → Datura metel vs Datura stramonium (require source).")
    L.append("- **Genus-level identities kept:** " +
             ", ".join("`%s`→%s" % (k, v) for k, v in sorted(UNK_GENUS_LEVEL.items())) + ".")
    L.append("- **Non-botanical** (%d, incl. `Sat nimbu`=citric acid) and **unresolvable** (%d) dropped "
             "from the botanical set." % (len(UNK_NON_BOTANICAL), len(UNK_UNRESOLVABLE)))
    L.append("- **Common names still unresolved** (%d): held for a later pass." % triage_counts["common_name"])
    L.append("")
    with open(os.path.join(HERE, "pass2_signoff.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print("Sign-off applied: %d GBIF-resolved, %d catalogue-resolved, %d trade-ambiguous, %d typos corrected." %
          (len(RESOLVED), len(CATALOGUE_RESOLVED), len(TRADE_AMBIGUOUS), len(rq["typo_flags"])))


if __name__ == "__main__":
    main()
