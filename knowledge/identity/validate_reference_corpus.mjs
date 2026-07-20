// ADR-013 — validator for the identity reference corpus. Two jobs:
//   (A) STRUCTURE — validate identity_reference_corpus.json against identity_reference_corpus.schema.json
//       (the schema is the source of truth for the locked identity_status enum + required fields).
//   (B) REGRESSION — run every authored entry through the LIVE resolver (worker/src/engine.js) and check
//       the actual behaviour matches expected. Enforces the two locked rules:
//         1. a policy_dependent entry is a FAILURE if the resolver returns a confident answer (never skipped);
//         2. policy_dependent entries must resolve ambiguous (with candidates), never a pick.
// The corpus ships EMPTY, so (B) runs 0 checks today — but the machinery is in place for every 6C entry.
// Exits non-zero on any structural error or regression failure (this is a release gate).
//
// Run: node knowledge/identity/validate_reference_corpus.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, buildIndices, resolve, statusOf } from '../../worker/src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const corpusPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, 'identity_reference_corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(HERE, 'identity_reference_corpus.schema.json'), 'utf8'));
const backbone = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/identity/botanical_identity.json'), 'utf8'));
const { exact, common } = buildIndices(backbone.identities);
const byId = new Map(backbone.identities.map(r => [r.canonical_id, r]));
const byAccepted = new Map(backbone.identities.filter(r => r.authority_accepted_name).map(r => [norm(r.authority_accepted_name), r]));

const STATUS = new Set(schema.$defs.identity_status.enum);          // locked enum, from the schema
const ENTRY_KEYS = new Set(Object.keys(schema.$defs.entry.properties));
const BASE_REQUIRED = schema.$defs.entry.required;
const TIER3_EXTRA = ['incident_date', 'incident_summary', 'introduced_in_identity_version', 'regression_reason'];
const SIGNOFF_STATUS = new Set(schema.$defs.entry.properties.owner_signoff.properties.status.enum);

const errors = [], regressionFailures = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// ---- (A) structure ----
if (corpus._meta?.artifact !== 'identity_reference_corpus') err('_meta.artifact', 'must be "identity_reference_corpus"');
if (corpus._meta?.schema_version !== '1') err('_meta.schema_version', 'must be "1"');
if (typeof corpus._meta?.identity_version !== 'string') err('_meta.identity_version', 'missing');
if (typeof corpus._meta?.owner !== 'string') err('_meta.owner', 'missing');
for (const t of ['tier_1', 'tier_2', 'tier_3']) if (typeof corpus._meta?.update_rules?.[t] !== 'string') err('_meta.update_rules.' + t, 'missing');
for (const arr of ['tier_1_core_regression', 'tier_2_commercial_canon', 'tier_3_edge_cases']) if (!Array.isArray(corpus[arr])) err(arr, 'must be an array');
if (corpus._meta && corpus._meta.identity_version !== backbone._meta.identity_version)
  err('_meta.identity_version', `corpus ${corpus._meta.identity_version} != backbone ${backbone._meta.identity_version} (re-validate after every identity_version bump)`);

function validateEntry(e, where, isTier3) {
  for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) err(where, `unexpected field "${k}"`);
  for (const k of BASE_REQUIRED) if (!(k in e)) err(where, `missing required field "${k}"`);
  if (isTier3) for (const k of TIER3_EXTRA) if (!(k in e)) err(where, `tier 3 requires "${k}"`);
  if (typeof e.query !== 'string' || !e.query.trim()) err(where, 'query must be a non-empty string');
  if (e.expected && !STATUS.has(e.expected.identity_status)) err(where, `expected.identity_status "${e.expected?.identity_status}" not in locked enum`);
  if (e.owner_signoff && !SIGNOFF_STATUS.has(e.owner_signoff.status)) err(where, `owner_signoff.status "${e.owner_signoff.status}" invalid`);
  if (typeof e.query === 'string' && typeof e.normalised_query === 'string' && e.normalised_query !== norm(e.query))
    err(where, `normalised_query "${e.normalised_query}" != norm(query) "${norm(e.query)}"`);
  if (e.expected?.identity_status === 'policy_dependent' && typeof e.resolver_behaviour_on_undecided !== 'string')
    err(where, 'policy_dependent entry requires resolver_behaviour_on_undecided');
}

// ---- (B) resolver regression ----
function regress(e, where) {
  if (!e.expected || typeof e.query !== 'string') return;
  const res = resolve(null, e.query, exact, common);
  const st = statusOf(res);
  const rec = res.canonical_id ? byId.get(res.canonical_id) : null;
  const exp = e.expected.identity_status;
  const fail = (msg) => regressionFailures.push(`${where} [${e.query}]: ${msg}`);
  const idMatches = (want) => want == null || res.canonical_id === want || (rec && norm(rec.authority_accepted_name || '') === norm(want));
  switch (exp) {
    case 'resolved':
      if (st !== 'resolved') fail(`expected resolved, got ${st}`);
      else if (!idMatches(e.expected.accepted_identity)) fail(`resolved to ${res.canonical_id}, expected ${e.expected.accepted_identity}`);
      break;
    case 'ambiguous': if (st !== 'ambiguous') fail(`expected ambiguous, got ${st}${res.canonical_id ? ':' + res.canonical_id : ''}`); break;
    case 'unrecognised': if (st !== 'unrecognised') fail(`expected unrecognised, got ${st}`); break;
    case 'genus_level':
      if (st !== 'resolved' || (rec && rec.resolution_status !== 'genus_level')) fail(`expected genus_level, got ${st}/${rec?.resolution_status}`); break;
    case 'missing_species':
      // The species is not in the backbone: the resolver must NOT confidently resolve it to a substitute.
      if (st === 'resolved') fail(`expected missing_species (no confident identity), but resolved to ${res.canonical_id}`); break;
    case 'policy_dependent':
      // RULE 1 — a confident answer while the policy is undecided is a FAILURE, never skipped.
      if (st === 'resolved') fail(`RULE 1 violation: policy_dependent must NOT resolve confidently, but resolved to ${res.canonical_id}`); break;
  }
}

let n = 0;
for (const [arr, tier3] of [['tier_1_core_regression', false], ['tier_2_commercial_canon', false], ['tier_3_edge_cases', true]]) {
  (corpus[arr] || []).forEach((e, i) => { const where = `${arr}[${i}]`; validateEntry(e, where, tier3); regress(e, where); n++; });
}

// ---- report ----
const counts = { tier_1: (corpus.tier_1_core_regression || []).length, tier_2: (corpus.tier_2_commercial_canon || []).length, tier_3: (corpus.tier_3_edge_cases || []).length };
console.log('ADR-013 identity reference corpus — validation');
console.log(`  schema_version ${corpus._meta?.schema_version} · identity_version ${corpus._meta?.identity_version} · entries: tier1 ${counts.tier_1}, tier2 ${counts.tier_2}, tier3 ${counts.tier_3} (total ${n})`);
console.log(`  structural errors: ${errors.length}`);
errors.slice(0, 50).forEach(e => console.log('    ✗ ' + e));
console.log(`  resolver regression failures: ${regressionFailures.length}`);
regressionFailures.slice(0, 50).forEach(f => console.log('    ✗ ' + f));
const okAll = errors.length === 0 && regressionFailures.length === 0;
console.log(okAll ? '\nOK — corpus valid.' : '\nFAIL — fix the above before release.');
process.exit(okAll ? 0 : 1);
