# UI State Tests

Behaviours that only a real browser on a dev theme can confirm. The dry-run cannot prove these —
run them on a Shopify dev/preview theme before production.

## Dev-theme checks (require live Shopify)
- [ ] Real `/products.json` matching returns the expected SKUs per search.
- [ ] `N/A` roles are hidden in the live DOM.
- [ ] RFQ submits and lands in the contact inbox.
- [ ] Add-to-cart adds the picked SKU(s) with the right attributes.
- [ ] IC/LP "application review" state renders correctly in a real browser (⚙ + Ask-a-specialist).
- [ ] Best-fit column and "· selected: <format>" label render correctly.
- [ ] CDN hard-refresh picks up the new asset versions.

## Mode & state
- [ ] Quick mode: selecting a product then role shows Best fit / Possible / Usually unsuitable bands.
- [ ] Quick mode: after picking a SKU, the dropdown does not reopen over the result.
- [ ] Build mode: multiple rows share state; per-row %; toggling role updates the ladder.
- [ ] Quick → Build transfer preserves product / role / sku / pct / batch.
- [ ] Mode flag persists (sessionStorage) across reloads.

## Tier rendering
- [ ] `ok` → ✓ green · `warn` → ⚠ amber (+ caveat) · `avoid` → ⛔ (+ reason) · `unknown` → ? neutral
      · `review` (IC/LP) → ⚙ neutral.
- [ ] Costing and cart exclude `unknown` and `review` picks.

## Privacy (ADR / spec §12)
- [ ] Buyer formulations are fragment-encoded (`#f=`) for sharing and never posted to server logs.
- [ ] No buyer/pricing/supplier data appears in any rendered output or committed file.

## Sourcing prompts
- [ ] "We don't stock X as a <best-fit>" appears only when a genuine `ok` best-fit exists;
      otherwise "no confirmed best-fit format for this role".
- [ ] "Ask us to source it" / "Ask a sourcing specialist" buttons carry the right context.
