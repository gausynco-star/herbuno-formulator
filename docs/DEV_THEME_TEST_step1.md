# Dev-Theme Test Runbook — ADR-012 Step 1 (catalogue-free Path A, spec object, Stage-1/Stage-2 split)

Run on a **duplicated preview theme** (real store, real `/products.json`, not customer-facing).
Re-upload `blend-builder.js` → **hard-refresh (Cmd+Shift+R)** before each pass. Quick mode only
(Step 1 didn't touch Build mode).

## THE headline check
- [ ] **Does Stage 2 feel like a separate procurement section, not an extension of the technical
      verdict?** Visually distinct panel, different language, clearly "Herbuno catalogue / sourcing"
      — not a continuation of the Stage-1 result. *This is the whole point of ADR-012. If it reads
      as one continuous verdict, the separation has failed even if the code is correct.*

## Core Stage-1 / Stage-2 flows
- [ ] **Stocked botanical + exact format match** → Stage 1 result + spec card; "Check Herbuno
      availability" reveals Stage 2; exact match shown with Add-to-cart / sample.
- [ ] **Stocked botanical + only an alternative format in stock** → Stage 2 offers the alternative,
      labelled as an alternative (not as the exact spec).
- [ ] **Unstocked botanical** (type a real botanical Herbuno doesn't sell) → **full Stage-1 result +
      spec object still render**; Stage 2 shows "no match → Ask Herbuno to source this specification."
      *(The independence gate, live.)*
- [ ] **Made-up botanical** (e.g. "Zzyzx fictus") → Stage 1 still returns a complete result; Stage 2
      no-match/source. No crash, no blank.
- [ ] **Conditional form selected** → picking a conditional chip flips the spec card status to
      "Conditional fit" and updates the carried specification.
- [ ] **IC/LP application-review route** → renders the ⚙ "Application review needed" state; excluded
      from cart/costing; routes to specialist, not a fabricated tier.

## State & navigation
- [ ] **Back from Stage 2 to Stage 1** works and preserves the Stage-1 result.
- [ ] **Change product** → old specification clears; Stage resets to spec (not procurement).
- [ ] **Change role** → same: spec clears, Stage 2 hidden again.
- [ ] **Change botanical** after reaching Stage 2 → resets to Stage 1 spec view.
- [ ] Botanical **autocomplete** suggests Latin binomials, does NOT surface Herbuno SKUs (no
      catalogue bias in the input).

## Catalogue behaviour (Stage 2 only)
- [ ] Real `/products.json` matching returns expected SKUs for a stocked botanical.
- [ ] **Cold/slow catalogue** → the "Checking the Herbuno catalogue…" state shows; **no false
      "no match" flashes** before the catalogue loads.
- [ ] **Failed catalogue load** (simulate offline / block products.json) → graceful state, Stage 1
      still fully usable, no crash.
- [ ] Add-to-cart adds the picked SKU with correct attributes.
- [ ] RFQ / "Send this specification to Herbuno" submits and lands in the contact inbox.

## Labels & honesty (ADR-012 §6/§7)
- [ ] Status labels only: **Best physical fit / Conditional fit / Application review needed / Not
      suitable for this role / Catalogue match found.**
- [ ] **No "Compliant / Approved / Safe / Validated"** anywhere.
- [ ] Sourcing CTA is explicit and disclosed ("Send this specification to Herbuno" / "Ask Herbuno to
      source this format") — never styled to look like a scientific verdict.

## Mobile
- [ ] Mobile layout: intake, spec card, and the Stage-1→Stage-2 transition are usable and legible on
      a phone width.
- [ ] The Stage-2 panel is still visibly distinct from Stage-1 on mobile (the separation can't rely
      only on side-by-side desktop layout).

## CDN / deploy hygiene
- [ ] Hard-refresh picks up the new `blend-builder.js` (confirm the new two-stage flow is actually
      what's rendering, not a cached old build).

---

**Pass bar for production:** the headline check + all Core flows + the independence (unstocked/made-up)
cases + no banned labels. Mobile and cold-catalogue are important but can be follow-up fixes if minor.
Note any visual roughness for the separate CSS overhaul rather than fixing inline here.
