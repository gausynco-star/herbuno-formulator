# knowledge/identity/ — FROZEN identity backbone

**`botanical_identity.json` is FROZEN.** It is the single canonical identity artifact that Pass 3
(and everything after) joins against. Freezing it is what makes downstream joins reproducible.

## The rule

- **Nothing edits `botanical_identity.json` directly once Pass 3 has started.** No in-place edits,
  no hand-patches, no "quick fix" to a single record.
- Corrections flow **upstream, then rebuild**: fix upstream in the applicable Pass-2
  authority/adjudication source (`pass2`, `pass2b`, `pass2c`, or `pass2d`), rebuild the backbone, and
  bump `identity_version`. Concretely:
  1. Fix the identity in the applicable **Pass-2 source** — `knowledge/pass2/` (authority + review
     queue / sign-off), `knowledge/pass2b/`, `knowledge/pass2c/`, or `knowledge/pass2d/`.
  2. Re-run `build_identity.py` to **rebuild** the backbone.
  3. **Bump `identity_version`** (`IDENTITY_VERSION` in `build_identity.py`).
- This guarantees every identity change has a Pass-2 audit trail and a new version — never a silent
  drift in the frozen file.

## Versioning

`_meta` carries the immutable stamp:

| field | meaning |
|---|---|
| `identity_version` | date-stamped version of this backbone (e.g. `2026-07-18`). Bumps on every rebuild. |
| `identity_schema_version` | integer; bumps only when the record shape changes. Currently `2`. |
| `frozen` | `true` — signals the no-in-place-edit contract. |

## Naming fields (schema v2)

Botanical trade names and taxonomic authority names sometimes disagree (e.g. garden pea is
commercially **Pisum sativum** but GBIF's current accepted name is **Lathyrus oleraceus**). Pre-v2,
`accepted_name` held the trade name for those exceptions and the authority name everywhere else — so
the field meant two different things. v2 splits them into three explicit fields on **every** record:

| field | meaning |
|---|---|
| `authority_accepted_name` | The taxonomic authority (GBIF) accepted name. **Strictly taxonomic.** `null` for `trade_ambiguous` records (see `candidate_accepted_names`). |
| `trade_primary_name` | The commercially entrenched name where it differs from the authority name and the tool shows it instead. `null` when display == authority. |
| `canonical_display_name` | **What the tool displays**: `trade_primary_name` if set, else the authority name. `null` for `trade_ambiguous`. |
| `accepted_name` | **Strictly taxonomic, `== authority_accepted_name`.** Retained only as the resolver/index key. New consumers should read the three fields above. |

**The trade-primary exceptions** (accepted_name = authority; display = trade name) are listed in
`_meta.schema.trade_primary_exceptions`. For each, the trade name stays a resolvable
`scientific_synonym`, so a query for either name resolves to the same identity.

- **Display** → `canonical_display_name`
- **Taxonomy** → `authority_accepted_name` (≡ `accepted_name`)
- **Join** → `original_parsed_names` / synonyms (never the display name)

## canonical_id is IMMUTABLE

**`canonical_id` is a stable identifier and is NOT guaranteed to mirror the current accepted name.**
When a name is adopted from the authority, the `canonical_id` is deliberately **not** re-slugged, so
it can lag the taxonomy — e.g. `astragalus-membranaceus` now resolves to an identity whose
`accepted_name` is **Astragalus mongholicus**. Treat `canonical_id` as an opaque key:

- **Do** join and reference identities by `canonical_id` (it is stable across rebuilds/renames).
- **Do NOT** parse a `canonical_id` string to infer the species, and do NOT assume it equals
  `slug(accepted_name)`. To display or reason about the name, read the naming fields above.

## Downstream contract

**Every downstream artifact (Pass 3 outputs and later) MUST record the `identity_version` it was
built against.** If the backbone is rebuilt to a new version, downstream artifacts are stale until
re-joined against the new version.

## Files

- `botanical_identity.json` — the frozen backbone (identity records; count in `_meta.identity_records`). **Do not edit by hand.**
- `botanical_identity.md` — human-readable summary.
- `excluded.json` — Pass-1 keys excluded from the backbone (non_botanical + unresolvable), with reason.
- `build_identity.py` — the generator. The **only** way to (re)produce `botanical_identity.json`.
