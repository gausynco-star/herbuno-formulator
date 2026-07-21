// Version contract + tunables (ADR-014 §3). One place to change limits/TTLs.

// v2 (ADR-014 Step 3): request adds optional `candidate_format`; response adds `candidate_assessment`,
// `reasoning_checks`, `reasoning_basis`, and issues NO specification_token for ambiguous/unrecognised.
// v3 (messaging taxonomy): response replaces `specification`/`explanation`/`guidance_label` with a single
// `message` block { category, header, body, why, technical_status } driven by the public message-category
// map. Shape change => bump so an un-upgraded client fails closed instead of mis-rendering.
export const API_SCHEMA_VERSION = 3;      // bump when the request/response shape changes; clients reject mismatches
export const TOKEN_VERSION = 1;           // specification_token schema version (validated on verify)
export const TOKEN_TTL_SEC = 300;         // specification_token lifetime (short-lived)
export const IAT_SKEW_SEC = 60;           // allowed clock skew when validating token iat
export const FRESH_WINDOW_MS = 60_000;    // App Proxy timestamp freshness window (replay resistance)
export const MAX_BODY_BYTES = 2048;       // request body cap (product/role/botanical/session are tiny)
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // session_id is UNTRUSTED — bounded length/charset

// Exact routes (matched with ===, never endsWith).
export const ROUTES = { SPEC: '/apps/formulator/specification', PROC: '/apps/formulator/procurement' };

// candidate_format allow-list (ADR-014 Step 3). UI labels map to these codes client-side; the label is
// NEVER the contract. 'Other' is never sent (free text in the enquiry only) and any code outside this set
// is rejected server-side. SE is accepted here but returns a LOCKED "application review" response (assay
// overlay, not a base physical format) — it is never assessed as a base format (engine.assessCandidate).
export const FORMAT_CODES = new Set(['MP', 'RE', 'SE', 'WL', 'OE', 'WD']);

// Starting rate limits (ADR-014 §2 — tune from telemetry later; NOT permanent).
// distinctProductRolePerHour is the enumeration/traversal ceiling per server-derived key. STARTING
// value 12: with only 129 cells a ceiling of 50 let one IP reconstruct the whole selected-output layer
// in <5h; 12/hour makes that cost meaningful (Step-2b FIX 3). Tune from telemetry.
// The fine-grained limits below are keyed on the SHOPPER IP (X-Forwarded-For). `transport` is a SECOND,
// coarser backstop keyed on the NON-SPOOFABLE transport IP (CF-Connecting-IP = Shopify's shared egress),
// checked on every request. It bounds aggregate abuse when the shopper key is rotated, straddled, or
// malformed into the fallback (Step-2b review). Because many unrelated shoppers legitimately share one
// Shopify egress, it is deliberately MUCH higher than the per-shopper limits — a shared-fate ceiling, so
// too-low a value throttles innocent co-tenants. STARTING values only; MUST be sized from the real egress
// fan-out (confirm on the dev theme). Set `transport: null` to disable the backstop.
// distinctCandidateFormatsPerCellPerHour (ADR-014 Step 3): a candidate_format query is a slow
// ladder-enumeration vector — repeat one Product×Role cell across the format codes and you have that
// cell's ladder. Enforced as a persisted SET of distinct candidate formats keyed on
// shopper×hour×product×role (NOT per-format counters): repeats of one format keep the set at size 1
// (legitimate re-checking); a 4th DISTINCT format for that cell is rate-limited. Ordinary counters and
// the distinctProductRolePerHour traversal set still increment on every request regardless. STARTING 3.
export const RATE = {
  perMin: 10, perHour: 60, perDay: 150, uniqBotanicalsPerHour: 30, distinctProductRolePerHour: 12,
  distinctCandidateFormatsPerCellPerHour: 3,
  transport: { perMin: 120, perHour: 1200, perDay: 6000 },
};

// Honest degraded-state message (ADR-014 §"Degraded state"). Never serve a partial/guessed result.
export const DEGRADED_MESSAGE =
  'HerbIQ Formulator is temporarily unable to generate the technical specification. Your selections ' +
  'have been preserved; please retry shortly or send them to Herbuno for review.';

export class DegradedError extends Error {
  constructor(reason) { super(reason); this.name = 'DegradedError'; this.reason = reason; }
}

// Cross-bundle version consistency. Fail CLOSED: a mixed snapshot must never be served (ADR-014 §4).
// Requires the form graph to have been built against the same identity_version as the identity index,
// and every bundle's self-declared version to match the manifest + the expected api schema.
export function checkVersions(manifest, identity, formgraph, matrix) {
  if (!manifest || !identity || !formgraph || !matrix) return { ok: false, reason: 'missing_bundle' };
  if (manifest.api_schema_version !== API_SCHEMA_VERSION)
    return { ok: false, reason: `api_schema ${manifest.api_schema_version} != expected ${API_SCHEMA_VERSION}` };
  if (identity.identity_version !== manifest.identity_version)
    return { ok: false, reason: `identity_version ${identity.identity_version} != manifest ${manifest.identity_version}` };
  if (formgraph.observed_form_graph_version !== manifest.observed_form_graph_version)
    return { ok: false, reason: `form_graph_version ${formgraph.observed_form_graph_version} != manifest ${manifest.observed_form_graph_version}` };
  if (formgraph.built_against_identity_version !== manifest.identity_version)
    return { ok: false, reason: `form_graph built against ${formgraph.built_against_identity_version} != identity ${manifest.identity_version}` };
  if (matrix.matrix_version !== manifest.matrix_version)
    return { ok: false, reason: `matrix_version ${matrix.matrix_version} != manifest ${manifest.matrix_version}` };
  // phase map is the third authored data layer (ADR-014 Step 3): the matrix bundle's embedded
  // phase_map_version must match the manifest, so a mixed snapshot can never be served.
  if ((matrix.data && matrix.data.phase_map_version) !== manifest.phase_map_version)
    return { ok: false, reason: `phase_map_version ${matrix.data && matrix.data.phase_map_version} != manifest ${manifest.phase_map_version}` };
  return { ok: true };
}

export function versionBlock(v) {
  return {
    api_schema_version: API_SCHEMA_VERSION,
    matrix_version: v.matrix_version,
    identity_version: v.identity_version,
    observed_form_graph_version: v.observed_form_graph_version,
    phase_map_version: v.phase_map_version,
    response_generated_at: new Date().toISOString(),
  };
}
