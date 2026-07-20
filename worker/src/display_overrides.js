// PRESENTATION-ONLY display-name overrides (ADR-014 Step 3). Authored, versioned data — bundled with the
// Worker (NOT KV, so changing it needs no KV re-upload). It is NOT identity truth: it does NOT touch
// resolution, matching, the specification_token, or the frozen identity backbone — it only overrides the
// LABEL shown on the result card. Resolution order in engine.displayName(): 1) this override, 2) common-name
// heuristic, 3) canonical_display_name fallback. Keyed by canonical_id.
//
// Lives here (worker/src/) rather than matrix/ because the Worker runtime (workerd/Miniflare) cannot import
// a module outside the Worker's module root, nor a static JSON module portably. It is still owner-authored
// data — edit `overrides` and redeploy the Worker (no rebuild, no KV re-upload).
export default {
  _meta: {
    artifact: 'display_name_overrides',
    display_overrides_version: '2026-07-20.1',
    adr: 'ADR-014 Step 3',
    purpose: 'PRESENTATION-ONLY storefront display names, keyed by canonical_id. NOT identity truth.',
    keyed_by: 'canonical_id',
    owner_authored: true,
  },
  overrides: {
    'camellia-sinensis': 'Tea',
    'aloe-vera': 'Aloe Vera',
    'terminalia-chebula': 'Haritaki',
    'glycyrrhiza-glabra': 'Licorice',
  },
};
