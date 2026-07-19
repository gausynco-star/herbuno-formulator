#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADR-013 Pass 3 (REVISED) — multi-supplier OBSERVED commercial-form discovery.

Maps supplier rows onto the FROZEN identity backbone and consolidates the distinct commercial
forms OBSERVED per botanical. Evidence-backed form discovery — NOT a market survey. No prevalence
language anywhere. Supplier counts are evidence metadata only.

INTERNAL ONLY: observed_form_graph.json / supplier_registry.md carry supplier identity + counts +
provenance. Any storefront-facing derivative MUST strip supplier identity/counts/location and expose
only "observed in reviewed sources" as a boolean (see _meta.storefront_contract).

Never edits the frozen backbone. Stamps identity_version it was built against.
Run:  python3 knowledge/pass3/build_pass3.py
"""

import csv, hashlib, json, os, re
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, "..")
HOME = os.path.expanduser("~")
BACKBONE = os.path.join(K, "identity", "botanical_identity.json")
TAXONOMY = os.path.join(K, "taxonomy", "format_codes.json")
BUILD_DATE = "2026-07-18"

# ---------------------------------------------------------------------------
# Supplier registry + per-supplier Type maps / out-of-scope sets
# ---------------------------------------------------------------------------
DL = os.path.join(HOME, "Downloads")

# Source families group entities whose observations are CORRELATED (not independent evidence).
# Herbuno shares thewholesaler's family: Herbuno's product LISTINGS were substantially built from
# thewholesaler's catalogue, so their form observations correlate. This is CATALOGUE DERIVATION,
# NOT supply dependency — Herbuno sources independently from its own suppliers. Corroboration must
# be counted per independent source family, never per entity, where entities share a family.
SOURCE_FAMILIES = {
    "sf_thewholesaler": {"label": "thewholesaler catalogue family",
        "members": ["ent_thewholesaler", "ent_herbuno"],
        "note": "Herbuno's listings were substantially catalogue-derived from thewholesaler; their form "
                "observations are correlated. CATALOGUE DERIVATION, not supply dependency — Herbuno "
                "sources independently from its own suppliers."},
    "sf_medikonda": {"label": "medikonda", "members": ["ent_medikonda"], "note": ""},
    "sf_bulknaturals": {"label": "bulknaturalswholesale", "members": ["ent_bulknaturals"], "note": ""},
    "sf_hiyaindia": {"label": "hiyaindia", "members": ["ent_hiyaindia"], "note": ""},
}
FAMILY_OF = {ent: fid for fid, fam in SOURCE_FAMILIES.items() for ent in fam["members"]}

SUPPLIERS = [
    {"supplier_id": "thewholesaler.eu", "entity_id": "ent_thewholesaler", "domain": "thewholesaler.eu",
     "region": "EU distributor (India-sourced)", "public": True, "snapshot_date": "2026-06-13",
     "file": os.path.join(DL, "allProducts[thewholesaler.eu]-2026-06-13T07-55-02.890Z.csv"),
     "bias": "Ayurvedic/Indian botanical extracts & powders; e-commerce distributor.",
     "note": "Same independent entity as thewholesaler.in / wholesalerco.com (mirrors/snapshots not ingested separately). Pass-1 source.",
     "TYPE_MAP": {
         "Extract Powder": "RE", "Herbal Powder": "MP", "Fruit Powder": "MP", "Vegetable Powder": "MP",
         "Spice Powder": "MP", "Water Soluble Extract": "WL", "Oil Soluble Extract": "OE",
         "Propylene Glycol Extract": "WL-glycol", "Glycerin Extract": "WL-glycerin",
         "Extract Paste": "RE-paste", "Oleoresin": "OLR", "Hydrosol": "HYD", "Infused Oil": "CO",
         "Carrier Oil": "CO", "Herb,Cut": "TC", "Tea & Infusions": "TC", "Dried Flowers, Cut": "TC",
         "Whole Herb": "WD", "Whole Spice": "WD", "Seeds": "WD", "Seed": "WD", "Root": "WD",
         "Dried Fruits": "WD", "Dried Flowers, Whole": "WD"},
     "OUT_OF_SCOPE_SUBSTR": ["essential oil", "herbs & spices", "incense", "polyphenol", "saponin",
         "flavonoid", "alkaloid", "carotenoid", "triterpene", "polysaccharide", "vitamin", "isoflavone",
         "diterpene", "phenylpropanoid", "tcm", "ayurvedic /", "western herb", "chinese /", "cosmetic active",
         "fruit active", "dairy", "coffee", "dates", "cereal", "nuts", "gum and resin", "flakes",
         "dried vegetables", "shilajit", "resin", "tea"]},

    {"supplier_id": "medikonda.com", "entity_id": "ent_medikonda", "domain": "medikonda.com",
     "region": "US", "public": True, "snapshot_date": "2026-07-17",
     "file": os.path.join(DL, "allProducts[www.medikonda.com]-2026-07-17T19-08-17.804Z.csv"),
     "bias": "US e-commerce; broad category vocabulary (Powders/Extracts/Oils); many finished-dosage & non-botanical SKUs.",
     "note": "",
     "TYPE_MAP": {"Powders": "MP", "Extracts": "RE", "Freeze-Dried": "FD", "Seeds": "WD", "Oils": "CO",
                  "Mushrooms": {"base": "MP", "ingredient_class": "mushroom"}},
     "OUT_OF_SCOPE_SUBSTR": ["capsule", "tablet", "cosmetic", "essential", "probiotic", "baking",
         "bio-active", "enzyme", "juice", "b2b", "supplement", "vitamin", "amino", "protein", "sweetener",
         "beverage", "spice blend", "salt", "clay", "butter", "wax", "gift"]},

    {"supplier_id": "bulknaturalswholesale.com", "entity_id": "ent_bulknaturals",
     "domain": "bulknaturalswholesale.com", "region": "US", "public": True, "snapshot_date": "2026-07-17",
     "file": os.path.join(DL, "allProducts[www.bulknaturalswholesale.com]-2026-07-17T19-07-07.210Z.csv"),
     "bias": "US cosmetic-ingredient wholesaler; carrier oils/butters/actives/fragrance-heavy; few classical botanical forms.",
     "note": "",
     "TYPE_MAP": {"Carrier oil": "CO", "Botanical extracts": "RE", "Botanical extract powders": "RE",
                  "Liquid Botanical Extracts": "WL", "Floral water/ Hydrosol": "HYD"},
     "OUT_OF_SCOPE_SUBSTR": ["essential oil", "fragrance", "butter", "hair", "skin care", "health & beauty",
         "clay", "colorant", "raw material", "active", "antioxidant", "peptide", "acid", "wax", "emulsif",
         "surfactant", "preservative", "vitamin", "mineral", "salt", "soap", "cosmetic", "beauty"]},

    {"supplier_id": "hiyaindia.in", "entity_id": "ent_hiyaindia", "domain": "hiyaindia.in",
     "region": "India", "public": True, "snapshot_date": "2026-07-15",
     "file": os.path.join(DL, "allProducts[hiyaindia.in]-2026-07-15T12-40-42.056Z.csv"),
     "bias": "India e-commerce; fragrance/aroma-diffuser oil dominant; some water/oil-soluble extracts & carrier oils.",
     "note": "",
     "TYPE_MAP": {"Extract Oil": "OE", "Oil Soluble Extract": "OE", "Water Soluble Extract": "WL",
                  "Carrier Oil": "CO"},
     "OUT_OF_SCOPE_SUBSTR": ["fragrance", "aroma", "diffuser", "essential oil"]},

    {"supplier_id": "herbuno.own", "entity_id": "ent_herbuno", "domain": "herbuno.com",
     "region": "own (US body)", "public": True, "snapshot_date": "unknown (sanitized export)",
     "file": os.path.join(HOME, "Downloads", "For Herbuno.US ", "herbuno_US_body_sanitized_FINAL.csv"),
     "bias": "Herbuno's OWN catalogue. Dual role: (a) taxonomy authority [handled by taxonomy asset], (b) ONE market observation source. Only real product rows count as observations.",
     "note": "Taxonomy-authority role does NOT auto-create observations; only real Herbuno product rows are observations.",
     "TYPE_MAP": {
         "Ingredients > Botanical Extracts > Powder": "RE",
         "Ingredients > Botanical Extracts > liquid": "WL",
         "Standardised Extract": {"base": "RE", "overlays": ["SE"], "physical_behaviour_status": "unconfirmed"},
         "Oil Soluble Extract": "OE",
         "Ingredients > Nutraceuticals > Powder": "IC",
         "Ingredients > Food Powders": "MP",
         "Carrier Oil": "CO",
         "Beverages > Tea & Tisanes": "TC",
         "Ingredients > Dehydrated > Herbs & Spices": "WD",
         "Ingredients > Dehydrated > Mushrooms": {"base": "WD", "ingredient_class": "mushroom"},
         "Ingredients > Dehydrated > Fruits": "WD",
         "Ingredients > Dehydrated > Vegetables": "WD"},
     "OUT_OF_SCOPE_SUBSTR": []},
]

# ---------------------------------------------------------------------------
# Normalisation + resolution indices from the FROZEN backbone
# ---------------------------------------------------------------------------
def norm(s):
    s = (s or "").lower().replace("×", "x").strip()
    s = re.sub(r"[^a-z0-9\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

FORM_WORDS = {"extract", "powder", "powdered", "oil", "soluble", "water", "glycerin", "glycol",
    "infused", "carrier", "essential", "oleoresin", "hydrosol", "paste", "dried", "freeze",
    "cut", "whole", "isolate", "standardized", "standardised", "organic", "natural", "pure",
    "concentrate", "concentrated", "liquid", "gum", "co2", "virgin", "refined", "fine", "bulk",
    "wholesale", "premium", "ground", "raw", "for", "personal", "care"}
PART_WORDS = {"root": "root", "roots": "root", "leaf": "leaf", "leaves": "leaf", "seed": "seed",
    "seeds": "seed", "bark": "bark", "flower": "flower", "flowers": "flower", "phool": "flower",
    "phul": "flower", "fruit": "fruit", "fruits": "fruit", "berry": "fruit", "rhizome": "rhizome",
    "peel": "peel", "pericarp": "peel", "rind": "peel", "aerial": "aerial", "herb": "aerial",
    "wood": "wood", "bud": "bud", "buds": "bud", "stem": "stem", "tuber": "tuber", "husk": "husk",
    "pod": "pod", "pods": "pod", "shell": "shell", "resin": "resin", "gum": "gum", "nut": "seed"}


# FIX 2 — plant-part words (English + Hindi/vernacular) stripped from backbone common_names at
# index time so a bare vernacular ("Neem" ) matches a part-suffixed record key ("Neem Bark").
# Frozen backbone is untouched; this is index-time only.
STRIP_WORDS = set(PART_WORDS) | FORM_WORDS | {
    "chaal", "chhal", "patta", "patti", "phool", "phul", "beej", "mool", "chilka", "dana", "sabut",
    "gutli", "booti", "buti", "whole", "cut", "big", "small", "kg", "gm"}
DERIVED_COMMON_KEYS = set()   # norm keys added by part-stripping (provenance: derived, second-class)
COMMON_INDEX_QUARANTINE = []  # part-stripped keys that collide across identities (NOT indexed)

# FIX 2b — owner-adjudicated collision resolutions (ADR-013 trade-usage adjudication).
# When a part-stripped common key collides across >1 identity, the owner may designate the ONE
# identity the bare vernacular resolves to. Both identities keep their own full common_names; only
# the ambiguous stripped key is pinned. Anything not listed here stays quarantined (no silent merge).
COLLISION_RESOLUTIONS = {
    "apple": "malus-domestica", "atish": "aconitum-heterophyllum", "basil": "ocimum-basilicum",
    "chitrak": "plumbago-zeylanica", "hibiscus": "hibiscus-sabdariffa",
    "lavender": "lavandula-angustifolia", "rasna": "pluchea-lanceolata",
    "tea": "camellia-sinensis", "valerian": "valeriana-officinalis",
}
COLLISION_RESOLUTIONS_APPLIED = []  # {stripped_key, resolved_to, over: [all colliding cids]}


def _part_strip(name):
    s = re.sub(r"\([^)]*\)", " ", name)                       # drop parenthetical assay/marker
    toks = [t for t in re.split(r"[^A-Za-z]+", s) if t and t.lower() not in STRIP_WORDS]
    return " ".join(toks)


def build_indices(backbone):
    exact = {}   # normname -> (rank, method, canonical_id)
    common = defaultdict(set)  # normname -> {canonical_id}
    METHODS = [("accepted_name", 0, "accepted_name_exact"),
               ("original_parsed_names", 1, "original_parsed_name_exact"),
               ("scientific_synonyms", 2, "scientific_synonym_exact"),
               ("trade_synonyms", 3, "trade_synonym_exact")]
    for r in backbone["identities"]:
        cid = r["canonical_id"]
        for field, rank, method in METHODS:
            vals = r.get(field)
            vals = [vals] if isinstance(vals, str) else (vals or [])
            for v in vals:
                n = norm(v)
                if n and (n not in exact or rank < exact[n][0]):
                    exact[n] = (rank, method, cid)
        for c in r.get("common_names", []):
            n = norm(c)
            if n:
                common[n].add(cid)

    # ---- FIX 2: derived part-stripped common keys (collision-guarded, provenance-tagged) ----
    DERIVED_COMMON_KEYS.clear(); COMMON_INDEX_QUARANTINE.clear(); COLLISION_RESOLUTIONS_APPLIED.clear()
    derived_map = defaultdict(set)
    for r in backbone["identities"]:
        for c in r.get("common_names", []):
            k = norm(_part_strip(c))
            if k and k != norm(c) and len(k) >= 3:
                derived_map[k].add(r["canonical_id"])
    for k, cids in sorted(derived_map.items()):
        allc = set(cids) | set(common.get(k, set()))
        if len(allc) == 1:
            if k not in common:                                # add only if not already a real key
                common[k].add(next(iter(allc)))
                DERIVED_COMMON_KEYS.add(k)
        else:                                                  # collision
            res = COLLISION_RESOLUTIONS.get(k)
            if res and res in allc:                             # owner-adjudicated: pin to one identity
                common[k] = {res}
                DERIVED_COMMON_KEYS.add(k)
                COLLISION_RESOLUTIONS_APPLIED.append({"stripped_key": k, "resolved_to": res,
                    "over": sorted(allc)})
            else:                                              # unresolved -> quarantine, never merge
                COMMON_INDEX_QUARANTINE.append({"stripped_key": k, "canonical_ids": sorted(allc),
                    "reason": "part-stripped common name maps to >1 identity; not indexed (no silent merge)"})
    return exact, common


BINOM = re.compile(r"\b([A-Z][a-z]+)\s+([A-Za-z][a-z]{2,}(?:-[a-z]+)?)\b")


def title_candidates(title):
    """Ordered (kind, string): binomials, parentheticals, common-core."""
    cands = []
    t = title.strip()
    for m in BINOM.finditer(t):
        g, s = m.group(1), m.group(2)
        cands.append(("binomial", g.capitalize() + " " + s.lower()))
    for m in re.finditer(r"\(([^)]+)\)", t):
        cands.append(("common", m.group(1)))
    # common-core: drop pipe-segments, parens, pack sizes, form/part words
    core = re.split(r"[|]", t)[0]
    core = re.sub(r"\([^)]*\)", " ", core)
    core = re.sub(r"\b\d+(\.\d+)?\s*(ml|l|g|kg|gm|mg|oz|lb|%|:1)\b", " ", core, flags=re.I)
    core = re.sub(r"\b\d+\s*(x|×)\s*\d+\b", " ", core, flags=re.I)
    core = re.sub(r"[-–—].*$", " ", core)  # drop trailing " - descriptor"
    toks = [w for w in re.split(r"[^A-Za-z]+", core)
            if w and w.lower() not in FORM_WORDS and w.lower() not in PART_WORDS]
    if toks:
        cands.append(("common", " ".join(toks)))
        if len(toks) >= 2:
            cands.append(("common", " ".join(toks[:2])))
        cands.append(("common", toks[0]))
    return cands


def resolve(title, exact, common):
    cands = title_candidates(title)
    hits = []
    for _, s in cands:
        n = norm(s)
        if n in exact:
            hits.append(exact[n])
    if hits:
        rank, method, cid = min(hits, key=lambda h: h[0])
        return {"match_method": method, "canonical_id": cid, "raw": title}
    uniq, amb = set(), []
    for _, s in cands:
        n = norm(s)
        if n in common:
            ids = common[n]
            if len(ids) == 1:
                uniq.add(next(iter(ids)))
            elif len(ids) > 1:
                amb.append({"name": s, "candidates": sorted(ids)})
    if len(uniq) == 1:
        return {"match_method": "common_name_exact_unique", "canonical_id": next(iter(uniq)), "raw": title}
    if len(uniq) > 1:
        return {"match_method": "ambiguous_exact", "canonical_id": None, "raw": title,
                "candidates": sorted(uniq)}
    if amb:
        return {"match_method": "ambiguous_exact", "canonical_id": None, "raw": title,
                "candidates": amb[0]["candidates"], "ambiguous_name": amb[0]["name"]}
    return {"match_method": "unresolved", "canonical_id": None, "raw": title}


def plant_part(title):
    t = title.lower()
    for w, npart in PART_WORDS.items():
        if re.search(r"\b" + re.escape(w) + r"\b", t):
            return {"raw": w, "normalized": npart, "confidence": "high"}
    return {"raw": None, "normalized": "unspecified", "confidence": "none"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


# title-overlay rules (deterministic, logged, secondary — never override Type base)
ASSAY = re.compile(r"(\d+(?:\.\d+)?\s*%)", re.I)
STD = re.compile(r"standardi[sz]ed|standardi[sz]ation", re.I)
ISOLATE = re.compile(r"isolate|high[- ]purity", re.I)
FREEZE = re.compile(r"freeze[- ]dried", re.I)


def normalize_format(typ, title, tmap):
    """-> dict(base, overlays, ingredient_class, standardisation, physical_behaviour_status,
             normalization_method, rules[], review_flags[]) or None if unmapped/out-of-scope."""
    spec = tmap.get(typ)
    if spec is None:
        return None
    base = spec if isinstance(spec, str) else spec.get("base")
    overlays = list(spec.get("overlays", [])) if isinstance(spec, dict) else []
    ing = spec.get("ingredient_class") if isinstance(spec, dict) else None
    pbs = spec.get("physical_behaviour_status") if isinstance(spec, dict) else None
    rules, flags = [], []
    method = "type_map"
    std = None
    # secondary title overlays
    if STD.search(title) and "SE" not in overlays:
        overlays.append("SE"); rules.append("TITLE-SE-01"); method = "type_map_plus_title_overlay"
    if ASSAY.search(title) and "SE" in overlays and not std:
        std = {"assay": ASSAY.search(title).group(1), "marker": None, "method": None}
    if ISOLATE.search(title):
        flags.append("possible_isolate_IC"); rules.append("TITLE-IC-01")
        method = "manual_review"  # Type vs title conflict -> route to review, base unchanged
    if FREEZE.search(title):
        if base in ("RE", "SD", "WL", "OE", "RE-paste"):  # freeze-dried EXTRACT: keep extract base + note
            flags.append("freeze_dried_extract"); rules.append("TITLE-FD-01"); method = "manual_review"
        elif base in ("MP", "WD"):  # freeze-dried whole material -> FD base
            base = "FD"; rules.append("TITLE-FD-02"); method = "type_map_plus_title_overlay"
    return {"base": base, "overlays": sorted(set(overlays)), "ingredient_class": ing,
            "standardisation": std, "physical_behaviour_status": pbs,
            "normalization_method": method, "rules": rules, "review_flags": flags}


def main():
    backbone = json.load(open(BACKBONE, encoding="utf-8"))
    id_version = backbone["_meta"]["identity_version"]
    id_schema = backbone["_meta"]["identity_schema_version"]
    tax = json.load(open(TAXONOMY, encoding="utf-8"))
    tax_version = tax["_meta"]["format_taxonomy_version"]
    # schema v2: display name (trade-primary where set) + strictly-taxonomic authority name, per identity
    names_of = {r["canonical_id"]: {
        "canonical_display_name": r.get("canonical_display_name", r.get("accepted_name")),
        "authority_accepted_name": r.get("authority_accepted_name", r.get("accepted_name"))}
        for r in backbone["identities"]}
    exact, common = build_indices(backbone)

    QUAL = {"min_identity": 0.70, "min_taxonomy": 0.80}
    registry, per_supplier_metrics = [], []
    unmapped_by_supplier = {}
    review_queue, unresolved_rows = [], []
    # observations kept for graph, keyed for dedup
    obs_by_key = defaultdict(list)   # (entity, cid, part, base, overlaytuple) -> [obs...]
    common_name_targets = defaultdict(set)  # normalized common string -> {cid} across suppliers (identity_disagreement)

    for sup in SUPPLIERS:
        f = sup["file"]
        if not os.path.exists(f):
            registry.append({**{k: sup[k] for k in ("supplier_id", "entity_id", "domain", "region")},
                             "present": False}); continue
        digest = sha256(f)
        tmap, oos = sup["TYPE_MAP"], sup["OUT_OF_SCOPE_SUBSTR"]
        rows = rows_with_type = mapped = in_scope_gap = out_scope = 0
        resolved = 0
        mm_counts = Counter()
        unmapped = Counter()
        unmapped_scope = {}
        sup_obs = []
        with open(f, newline="", encoding="utf-8-sig") as fh:
            r = csv.DictReader(fh)
            tcol = next((c for c in r.fieldnames if c and c.strip().lower() == "type"), "Type")
            for row in r:
                rows += 1
                typ = (row.get(tcol) or "").strip()
                title = (row.get("Title") or "").strip()
                if not typ or not title:
                    continue
                rows_with_type += 1
                fmt = normalize_format(typ, title, tmap)
                if fmt is None:
                    unmapped[typ] += 1
                    tl = typ.lower()
                    is_oos = any(sub in tl for sub in oos)
                    unmapped_scope[typ] = "out_of_scope" if is_oos else "in_scope_gap"
                    if is_oos:
                        out_scope += 1
                    else:
                        in_scope_gap += 1
                    continue
                mapped += 1
                res = resolve(title, exact, common)
                mm_counts[res["match_method"]] += 1
                part = plant_part(title)
                if res["match_method"] == "ambiguous_exact":
                    review_queue.append({"type": "ambiguous_common_name", "supplier_id": sup["supplier_id"],
                                         "raw_title": title, "raw_type": typ,
                                         "candidates": res.get("candidates"),
                                         "ambiguous_name": res.get("ambiguous_name"),
                                         "requires_owner_review": True})
                    continue
                if res["match_method"] == "unresolved":
                    unresolved_rows.append({"supplier_id": sup["supplier_id"], "raw_title": title,
                                            "raw_type": typ, "mapped_base": fmt["base"]})
                    continue
                resolved += 1
                cid = res["canonical_id"]
                if res["match_method"] == "common_name_exact_unique":
                    for _, s in title_candidates(title):
                        n = norm(s)
                        if n in common and len(common[n]) == 1 and next(iter(common[n])) == cid:
                            common_name_targets[n].add(cid)
                ob = {"canonical_id": cid,
                      "supplier_id": sup["supplier_id"], "entity_id": sup["entity_id"],
                      "raw_title": title, "raw_type": typ, "base_format_code": fmt["base"],
                      "overlays": fmt["overlays"], "ingredient_class": fmt["ingredient_class"],
                      "standardisation": fmt["standardisation"],
                      "physical_behaviour_status": fmt["physical_behaviour_status"],
                      "match_method": res["match_method"], "raw_plant_part": part["raw"],
                      "normalized_plant_part": part["normalized"], "plant_part_confidence": part["confidence"],
                      "normalization_method": fmt["normalization_method"], "rules": fmt["rules"],
                      "review_flags": fmt["review_flags"], "source_file": os.path.basename(f)}
                sup_obs.append(ob)
                if fmt["review_flags"]:
                    review_queue.append({"type": "form_normalization_disagreement",
                                         "supplier_id": sup["supplier_id"], "raw_title": title,
                                         "raw_type": typ, "flags": fmt["review_flags"],
                                         "why_flagged": "Title indicates a form/assay state that conflicts with the mapped Type base.",
                                         "requires_owner_review": True})

        tax_rate = mapped / (mapped + in_scope_gap) if (mapped + in_scope_gap) else 1.0
        id_rate = resolved / mapped if mapped else 0.0
        passes = (id_rate >= QUAL["min_identity"]) and (tax_rate >= QUAL["min_taxonomy"])
        # commit observations only if the supplier passes the gate (else logged, not in graph)
        if passes:
            for ob in sup_obs:
                key = (ob["entity_id"], ob["canonical_id"], ob["normalized_plant_part"],
                       ob["base_format_code"], tuple(sorted(ob["overlays"])))
                obs_by_key[key].append(ob)
        unmapped_by_supplier[sup["supplier_id"]] = {
            "_meta": {"supplier_id": sup["supplier_id"], "snapshot_date": sup["snapshot_date"]},
            "unmapped_types": [{"type": t, "count": unmapped[t], "scope": unmapped_scope[t]}
                               for t in sorted(unmapped, key=lambda x: -unmapped[x])]}
        registry.append({
            "supplier_id": sup["supplier_id"], "independent_entity_id": sup["entity_id"],
            "source_family_id": FAMILY_OF.get(sup["entity_id"]),
            "domain": sup["domain"], "region": sup["region"], "public": sup["public"],
            "snapshot_date": sup["snapshot_date"], "file": os.path.basename(f), "sha256": digest,
            "row_count": rows, "rows_with_type": rows_with_type, "rows_processed": mapped,
            "taxonomy_coverage_rate": round(tax_rate, 3), "identity_resolution_rate": round(id_rate, 3),
            "counts_toward_graph": passes, "known_catalogue_bias": sup["bias"], "notes": sup["note"]})
        per_supplier_metrics.append({"supplier_id": sup["supplier_id"], "rows": rows,
            "rows_with_type": rows_with_type, "mapped": mapped, "in_scope_gap": in_scope_gap,
            "out_of_scope": out_scope, "resolved": resolved, "match_methods": dict(mm_counts),
            "identity_resolution_rate": round(id_rate, 3), "taxonomy_mapping_rate": round(tax_rate, 3),
            "counts_toward_graph": passes})

    # ---- dedup + build graph ----
    entities_by_identity = defaultdict(set)
    families_by_identity = defaultdict(set)
    graph = {}
    dup_collapsed = 0
    for key, obs in obs_by_key.items():
        entity, cid, part, base, ov = key
        dup_collapsed += len(obs) - 1
        entities_by_identity[cid].add(entity)
        families_by_identity[cid].add(FAMILY_OF.get(entity, entity))
        sig = base + ("+" + "+".join(ov) if ov else "")
        nm = names_of.get(cid, {})
        node = graph.setdefault(cid, {"canonical_display_name": nm.get("canonical_display_name"),
            "authority_accepted_name": nm.get("authority_accepted_name"), "plant_parts": {}})
        pp = node["plant_parts"].setdefault(part, {"forms": {}})
        form = pp["forms"].get(sig)
        if not form:
            form = pp["forms"][sig] = {"base_format_code": base, "overlays": list(ov),
                "ingredient_class": obs[0]["ingredient_class"],
                "observation_status": "observed_in_reviewed_sources",
                "supplier_observation_count": 0, "observations": []}
        form["observations"].extend(obs)
        form["supplier_observation_count"] = len({o["entity_id"] for o in form["observations"]})
        # honest independence: distinct source families (entities sharing a family are correlated)
        form["independent_source_family_count"] = len(
            {FAMILY_OF.get(o["entity_id"], o["entity_id"]) for o in form["observations"]})
    # mixed plant parts flag
    for cid, node in graph.items():
        node["mixed_plant_parts"] = len([p for p in node["plant_parts"] if p != "unspecified"]) > 1

    # identity_disagreement: a common/trade string that different entities used for different species
    for n, cids in common_name_targets.items():
        if len(cids) > 1:
            review_queue.append({"type": "identity_disagreement", "disagreement_type": "identity_disagreement",
                "severity": "high", "raw_values": [n], "canonical_ids": sorted(cids),
                "why_flagged": "Same common/trade string resolved to >1 canonical identity across sources.",
                "requires_owner_review": True})

    # ---- outputs ----
    supplier_registry_meta = [{k: r.get(k) for k in ("supplier_id", "independent_entity_id",
        "source_family_id", "domain", "region", "public", "snapshot_date", "sha256",
        "counts_toward_graph")} for r in registry if r.get("sha256")]
    n_entities = len({r["independent_entity_id"] for r in registry if r.get("counts_toward_graph")})
    n_families = len({FAMILY_OF.get(r["independent_entity_id"]) for r in registry if r.get("counts_toward_graph")})
    identities_observed = len(graph)
    observed_by_2plus = sum(1 for cid in graph if len(entities_by_identity[cid]) >= 2)
    observed_by_2plus_families = sum(1 for cid in graph if len(families_by_identity[cid]) >= 2)
    combos = sum(len(pp["forms"]) for node in graph.values() for pp in node["plant_parts"].values())

    graph_doc = {"_meta": {
        "artifact": "ADR-013 Pass-3 observed commercial-form graph (form discovery, NO prevalence)",
        "visibility": "INTERNAL_ONLY",
        "identity_version": id_version, "identity_schema_version": id_schema,
        "format_taxonomy_version": tax_version, "build_date": BUILD_DATE,
        "scope_note": "Records which commercial forms have been OBSERVED for each botanical, and where. "
                      "Never how common a form is. Supplier counts are evidence metadata only, never a "
                      "qualitative label. Absence != nonexistence.",
        "storefront_contract": "Any storefront/runtime asset derived from this file MUST strip supplier "
                               "identity, supplier_observation_count, and location. Expose only "
                               "'observed in reviewed sources' as a boolean — never who, how many, or where.",
        "basket_skew": "e-commerce-heavy basket; light on bulk manufacturers (India/China) and EU "
                       "distributors; private catalogues inaccessible. Observations are a floor, not a census.",
        "source_families": SOURCE_FAMILIES,
        "independence_note": "Corroboration is counted per INDEPENDENT SOURCE FAMILY, not per entity. "
                             "thewholesaler and Herbuno share source family 'sf_thewholesaler' (Herbuno's "
                             "listings were catalogue-derived from thewholesaler) — their agreement is "
                             "correlated, NOT independent evidence. Use independent_source_family_count, "
                             "not supplier_observation_count, to judge corroboration. This is catalogue "
                             "derivation, not supply dependency.",
        "independent_source_families_contributing": n_families,
        "supplier_registry": supplier_registry_meta,
        "identities_observed": identities_observed}, "identities": graph}
    json.dump(graph_doc, open(os.path.join(HERE, "observed_form_graph.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump({"_meta": {"build_date": BUILD_DATE, "count": len(review_queue),
                         "by_type": dict(Counter(x.get("disagreement_type", x.get("type")) for x in review_queue))},
               "entries": review_queue},
              open(os.path.join(HERE, "pass3_review_queue.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"_meta": {"build_date": BUILD_DATE, "count": len(unresolved_rows),
                         "note": "Supplier rows with a mapped botanical format but no canonical identity match. Kept, not discarded."},
               "rows": unresolved_rows},
              open(os.path.join(HERE, "unresolved_supplier_rows.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    for sid, doc in unmapped_by_supplier.items():
        safe = re.sub(r"[^a-z0-9]+", "_", sid.lower())
        json.dump(doc, open(os.path.join(HERE, "unmapped_types_%s.json" % safe), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)

    _write_registry_md(registry)
    _write_report_md(per_supplier_metrics, registry, n_entities, n_families, identities_observed,
                     observed_by_2plus, observed_by_2plus_families, combos, len(review_queue),
                     len(unresolved_rows), dup_collapsed, id_version)

    print("PASS 3 COMPLETE  (identity_version %s, taxonomy %s)" % (id_version, tax_version))
    print("  contributing: %d entities across %d INDEPENDENT source families" % (n_entities, n_families))
    print("  identities observed: %d  (by >=2 entities: %d ; by >=2 INDEPENDENT families: %d)" %
          (identities_observed, observed_by_2plus, observed_by_2plus_families))
    print("  botanical x part x form combos observed: %d" % combos)
    print("  duplicates collapsed: %d  | review queue: %d  | unresolved rows: %d" %
          (dup_collapsed, len(review_queue), len(unresolved_rows)))
    print("\n  per-supplier (id_rate / tax_rate / gate):")
    for m in per_supplier_metrics:
        print("    %-28s id=%.0f%%  tax=%.0f%%  %s" % (m["supplier_id"], m["identity_resolution_rate"]*100,
              m["taxonomy_mapping_rate"]*100, "PASS" if m["counts_toward_graph"] else "FLAGGED (excluded from graph)"))


def _write_registry_md(registry):
    L = ["# Pass-3 Supplier Registry — INTERNAL ONLY (ADR-013)\n",
         "> **INTERNAL.** Supplier identity, counts and provenance are internal. Storefront assets must",
         "> strip all of this and expose only 'observed in reviewed sources'.\n",
         "| supplier_id | entity | source_family | domain | region | public | snapshot | rows | with_type | processed | tax_rate | id_rate | in_graph | bias |",
         "|---|---|---|---|---|---|---|--:|--:|--:|--:|--:|---|---|"]
    for r in registry:
        if not r.get("sha256"):
            continue
        L.append("| %s | %s | %s | %s | %s | %s | %s | %d | %d | %d | %.0f%% | %.0f%% | %s | %s |" % (
            r["supplier_id"], r["independent_entity_id"], r.get("source_family_id"), r["domain"],
            r["region"], r["public"], r["snapshot_date"], r["row_count"], r["rows_with_type"],
            r["rows_processed"], r["taxonomy_coverage_rate"]*100, r["identity_resolution_rate"]*100,
            "yes" if r["counts_toward_graph"] else "**no**", r["known_catalogue_bias"]))
    L.append("\n> **Source families:** `sf_thewholesaler` = {thewholesaler, Herbuno} — Herbuno's listings were")
    L.append("> catalogue-derived from thewholesaler, so their observations are CORRELATED (not independent")
    L.append("> evidence). Catalogue derivation, NOT supply dependency — Herbuno sources independently.")
    L.append("\n### sha256")
    for r in registry:
        if r.get("sha256"):
            L.append("- `%s` — `%s` (%s)" % (r["supplier_id"], r["sha256"], r["file"]))
    L.append("")
    open(os.path.join(HERE, "supplier_registry.md"), "w", encoding="utf-8").write("\n".join(L))


def _write_report_md(metrics, registry, n_entities, n_families, ids_obs, obs2, obs2fam, combos, nrev,
                     nunres, dups, id_version):
    L = ["# Pass-3 Report — Observed Commercial-Form Discovery (ADR-013)\n",
         "> Form DISCOVERY, not a market survey. No prevalence/availability language. Built against",
         "> identity_version `%s`. Supplier detail is INTERNAL (see supplier_registry.md).\n" % id_version,
         "## Per-supplier",
         "| supplier | rows | with_type | mapped | in-scope gap | out-of-scope | resolved | id_rate | tax_rate | gate |",
         "|---|--:|--:|--:|--:|--:|--:|--:|--:|---|"]
    for m in metrics:
        L.append("| %s | %d | %d | %d | %d | %d | %d | %.0f%% | %.0f%% | %s |" % (
            m["supplier_id"], m["rows"], m["rows_with_type"], m["mapped"], m["in_scope_gap"],
            m["out_of_scope"], m["resolved"], m["identity_resolution_rate"]*100,
            m["taxonomy_mapping_rate"]*100, "PASS" if m["counts_toward_graph"] else "FLAGGED"))
    L.append("\n### match methods (contributing suppliers)")
    for m in metrics:
        if m["counts_toward_graph"]:
            L.append("- **%s**: %s" % (m["supplier_id"], ", ".join("%s=%d" % (k, v) for k, v in sorted(m["match_methods"].items()))))
    L.append("\n## Global (observed only — NO observed-vs-not tally)")
    L.append("| metric | value |")
    L.append("|---|--:|")
    L.append("| entities contributing | %d |" % n_entities)
    L.append("| **independent source families contributing** | **%d** |" % n_families)
    L.append("| identities observed | %d |" % ids_obs)
    L.append("| identities observed by ≥2 entities | %d |" % obs2)
    L.append("| **identities observed by ≥2 INDEPENDENT source families** | **%d** |" % obs2fam)
    L.append("| botanical × part × form combinations observed | %d |" % combos)
    L.append("| duplicates collapsed (entity×id×part×form) | %d |" % dups)
    L.append("| review-queue entries (ambiguous + disagreements) | %d |" % nrev)
    L.append("| unresolved supplier rows (kept) | %d |" % nunres)
    L.append("")
    L.append("## Source-family correlation (independence caveat)")
    L.append("thewholesaler and Herbuno share source family `sf_thewholesaler`: **Herbuno's product")
    L.append("listings were substantially catalogue-derived from thewholesaler**, so their form")
    L.append("observations are **correlated, not independent evidence**. This is **catalogue derivation,")
    L.append("NOT supply dependency** — Herbuno sources independently from its own suppliers. Judge")
    L.append("corroboration by `independent_source_family_count`, never by entity count.")
    L.append("With the current basket, only **%d independent source family** contributes to the graph, so "
             "**%d identities are corroborated across ≥2 independent families** — the entity-level figure "
             "(%d) overstates corroboration." % (n_families, obs2fam, obs2))
    L.append("")
    L.append("## Quality gate")
    flagged = [m["supplier_id"] for m in metrics if not m["counts_toward_graph"]]
    L.append("Threshold: identity resolution >=70%% AND taxonomy mapping >=80%%. "
             "Flagged (excluded from graph, committed as incomplete ingestion): %s.\n" %
             (", ".join(flagged) if flagged else "none"))
    L.append("## Basket-skew limitation (stated, not hidden)")
    L.append("The reviewed basket is **e-commerce-heavy**: Ayurvedic/Indian distributors + US cosmetic-")
    L.append("ingredient and fragrance shops. It is **light on bulk manufacturers** (India/China) and EU")
    L.append("distributors, and **private catalogues are inaccessible**. Non-observation therefore never")
    L.append("implies unavailability — it means *not seen in these sources*. Observation counts are a floor.")
    L.append("")
    L.append("## Honesty")
    L.append("- Supplier label ≠ physical fact: outputs state only that a supplier *offers* a form under a")
    L.append("  stated label; no behaviour/solubility is asserted.")
    L.append("- No prevalence, market-share or rarity language anywhere.")
    L.append("- The frozen identity backbone was not modified.")
    L.append("")
    open(os.path.join(HERE, "pass3_report.md"), "w", encoding="utf-8").write("\n".join(L))


if __name__ == "__main__":
    main()
