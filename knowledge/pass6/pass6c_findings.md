# ADR-013 Pass 6C — identity adjudication inbox (findings awaiting owner + external review)

**What this is.** 6C is the *adjudication* pass: reversing incorrect GBIF merges, adding absent
species, and correcting name→species assignments **in the backbone**. This file collects identity
findings surfaced during live testing that require an owner decision. It is a worklist, **not** a set
of decisions — the backbone edit is the deliverable, and each approved decision is then recorded in
`knowledge/identity/identity_reference_corpus.json`.

**Hard rule.** None of these are patched in the Worker. The resolver reflects the backbone; the
backbone is corrected upstream (rebuild → bump `identity_version` → regenerate Pass 3 + runtime
assets → rerun 6A → 6D against the populated corpus).

**See also.** The generated 6B coverage worklist (`pass6b_coverage.json`, e.g. the `bare_common`
entries and the Citrus merge class) is the deterministic input; the entries below are the
live-test-surfaced subset that already has a concrete reproduction.

## Findings

| Query | Observed resolver behaviour | Concern / expected after 6C | Source |
|---|---|---|---|
| `orange` | Resolves **confidently** to *Citrus aurantium* (bitter orange) | Unqualified "orange" should be *Citrus sinensis* (sweet orange) per commercial dominance, or ambiguous — not bitter orange. Add `orange`/`sweet orange` → *C. sinensis*; remove bare `orange` from *C. aurantium* | Live test R1 |
| `bergamot` | Resolves **confidently** to *Citrus limon* | Should be *Citrus bergamia* | Live test R1/R2 |
| `brahmi` | Resolves **confidently** to *Bacopa monnieri* | Genuinely ambiguous (*Bacopa monnieri* vs *Centella asiatica*); absent from the collision quarantine — should resolve ambiguous | Live test R2 |
| `shankhpushpi` | Resolves **confidently** (to a single species) | Four-way ambiguous (*Convolvulus pluricaulis* / *Evolvulus alsinoides* / *Clitoria ternatea* / *Canscora decussata*) — should resolve ambiguous | Live test R2 |
| `jasmine` | Resolves **ambiguous** to a **genus-level** record *Jasminum* + *Jasminum sambac* | The common name "jasmine" should map to the two commercial *species* (*Jasminum grandiflorum* + *Jasminum sambac*), not the bare genus. The candidate list currently shows "Jasminum" | Live test R2 |

## Notes

- `brahmi` / `shankhpushpi` resolving confidently is the higher-risk class (a confident *wrong* pick),
  vs `jasmine` which is already ambiguous but names the genus instead of a species.
- Every approved decision above is written into the reference corpus **immediately** (tier 1/2 as
  appropriate), so the resolution is never re-litigated.
