# knowledge/identity/ — FROZEN identity backbone

**`botanical_identity.json` is FROZEN.** It is the single canonical identity artifact that Pass 3
(and everything after) joins against. Freezing it is what makes downstream joins reproducible.

## The rule

- **Nothing edits `botanical_identity.json` directly once Pass 3 has started.** No in-place edits,
  no hand-patches, no "quick fix" to a single record.
- Corrections flow **upstream, then rebuild**:
  1. Fix the identity in **Pass 2** (`knowledge/pass2/` review queue / sign-off, or `knowledge/pass2b/`).
  2. Re-run `build_identity.py` to **rebuild** the backbone.
  3. **Bump `identity_version`** (`IDENTITY_VERSION` in `build_identity.py`).
- This guarantees every identity change has a Pass-2 audit trail and a new version — never a silent
  drift in the frozen file.

## Versioning

`_meta` carries the immutable stamp:

| field | meaning |
|---|---|
| `identity_version` | date-stamped version of this backbone (e.g. `2026-07-18`). Bumps on every rebuild. |
| `identity_schema_version` | integer; bumps only when the record shape changes. Currently `1`. |
| `frozen` | `true` — signals the no-in-place-edit contract. |

## Downstream contract

**Every downstream artifact (Pass 3 outputs and later) MUST record the `identity_version` it was
built against.** If the backbone is rebuilt to a new version, downstream artifacts are stale until
re-joined against the new version.

## Files

- `botanical_identity.json` — the frozen backbone (564 identity records). **Do not edit by hand.**
- `botanical_identity.md` — human-readable summary.
- `excluded.json` — Pass-1 keys excluded from the backbone (non_botanical + unresolvable), with reason.
- `build_identity.py` — the generator. The **only** way to (re)produce `botanical_identity.json`.
