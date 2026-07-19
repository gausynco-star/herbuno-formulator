// Version contract + tunables (ADR-014 §3). One place to change limits/TTLs.

export const API_SCHEMA_VERSION = 1;      // bump when the response shape changes; clients reject mismatches
export const TOKEN_TTL_SEC = 300;         // specification_token lifetime (short-lived)
export const FRESH_WINDOW_MS = 60_000;    // App Proxy timestamp freshness window (replay resistance)

// Starting rate limits (ADR-014 §2 — tune from telemetry later; NOT permanent).
export const RATE = { perMin: 10, perHour: 60, perDay: 150, uniqBotanicalsPerHour: 30 };

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
  return { ok: true };
}

export function versionBlock(v) {
  return {
    api_schema_version: API_SCHEMA_VERSION,
    matrix_version: v.matrix_version,
    identity_version: v.identity_version,
    observed_form_graph_version: v.observed_form_graph_version,
    response_generated_at: new Date().toISOString(),
  };
}
