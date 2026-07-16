# Workflow — how we iterate without shuttling files by hand

Three parties: **Krantik** (owner / decision logic), **the developer**, and **Claude**
(chat for design + review; Claude Code for direct repo edits).

## Branch / commit convention

- `main` = deployed / deployable. Never commit straight to `main`.
- Work on a branch: `feat/…`, `fix/…`, `chore/…` (e.g. `feat/stage1-decouple`).
- Open a PR into `main`. Keep the PR description tied to a decision record when logic changes.
- A logic change (matrix tiers, gate rules, ladder order) requires a matching **decision record**
  in `docs/decision-records/` and owner sign-off before merge.

## Who does what

- **Design / review / proposals** → Claude in chat. Produces reviewable artifacts (workbooks,
  audits) and, once signed off, the updated `theme-assets/` files.
- **Applying changes to the repo** → Claude Code (run by Krantik or the developer) reads/writes
  the files directly and commits. No copy-paste.
- **Deploy to Shopify** → upload changed `theme-assets/` to the theme; hard-refresh; dev-theme test.

## Guardrails (see CLAUDE.md for the full list)

- Never override a signed-off `fmt` cell; matrix edits ADD only; run the parity guard every time.
- `node --check` both JS assets and pass the dry-run harness before any PR that touches them.
- No buyer data in the repo.

## Typical loop

1. Krantik states a decision (or approves a proposal) in chat.
2. Claude produces the updated file(s) + a validation run.
3. Claude Code (or the developer) commits them on a branch and opens a PR.
4. Krantik reviews the diff, merges.
5. Changed `theme-assets/` uploaded to Shopify; dev-theme test; production.
