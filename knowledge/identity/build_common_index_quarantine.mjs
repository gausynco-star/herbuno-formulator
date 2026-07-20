// Regenerates knowledge/identity/common_index_quarantine.json from the CURRENT frozen backbone + the
// resolver's own collision resolutions (single source of truth: worker/src/engine.js). Re-run whenever
// identity_version changes so the artifact's stamp + collision set stay consistent with the backbone
// (ADR-013 / Pass 6A §5). It documents the part-stripped common-name keys that map to >1 identity:
// owner-adjudicated keys are pinned (resolutions); the rest stay unindexed (no silent merge). Does NOT
// edit the frozen backbone.
//
// Run: node knowledge/identity/build_common_index_quarantine.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, partStrip, COLLISION_RESOLUTIONS } from '../../worker/src/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const backbone = JSON.parse(fs.readFileSync(P('knowledge/identity/botanical_identity.json'), 'utf8'));
const identities = backbone.identities;
const nameById = new Map(identities.map(r => [r.canonical_id, r.authority_accepted_name || r.accepted_name || null]));

// Mirror buildIndices() in engine.js exactly: raw common index, then part-stripped derived keys.
const common = new Map();
for (const r of identities) for (const c of (r.common_names || [])) { const n = norm(c); if (n) { if (!common.has(n)) common.set(n, new Set()); common.get(n).add(r.canonical_id); } }
const derived = new Map();
for (const r of identities) for (const c of (r.common_names || [])) { const k = norm(partStrip(c)); if (k && k !== norm(c) && k.length >= 3) { if (!derived.has(k)) derived.set(k, new Set()); derived.get(k).add(r.canonical_id); } }

const resolutions = [], quarantine = []; let uniqueIndexed = 0;
for (const [k, cids] of derived) {
  const allc = new Set(cids); if (common.has(k)) for (const x of common.get(k)) allc.add(x);
  if (allc.size === 1) { if (!common.has(k)) uniqueIndexed++; continue; } // collapses to one identity; count only NEW keys (a part-strip that adds a key not already a raw common) — historical derived_keys_indexed metric
  const res = COLLISION_RESOLUTIONS[k];
  if (res && allc.has(res)) resolutions.push({ stripped_key: k, resolved_to: res, over: [...allc].sort(), resolved_to_name: nameById.get(res) || null });
  else quarantine.push({ stripped_key: k, canonical_ids: [...allc].sort(), reason: 'part-stripped common name maps to >1 identity; not indexed (no silent merge)' });
}
resolutions.sort((a, b) => a.stripped_key.localeCompare(b.stripped_key));
quarantine.sort((a, b) => a.stripped_key.localeCompare(b.stripped_key));

const out = {
  _meta: {
    artifact: 'Common-index part-stripping collision quarantine + owner resolutions (Fix 2b)',
    identity_version: backbone._meta.identity_version,
    derived_keys_indexed: uniqueIndexed + resolutions.length,   // unique-collapsed + owner-resolved are indexed; quarantined are not
    collisions_quarantined: quarantine.length,
    collisions_resolved: resolutions.length,
    generated_by: 'knowledge/identity/build_common_index_quarantine.mjs (recomputed from the current backbone + resolver COLLISION_RESOLUTIONS)',
    note: 'Part-stripped common-name keys mapping to >1 identity. Owner-adjudicated keys are pinned to one identity (resolutions); the rest stay unindexed (no silent merge).',
  },
  resolutions,
  quarantine,
};
fs.writeFileSync(P('knowledge/identity/common_index_quarantine.json'), JSON.stringify(out, null, 1) + '\n');
console.log('regenerated common_index_quarantine.json @ identity_version', out._meta.identity_version);
console.log('derived_keys_indexed', out._meta.derived_keys_indexed, '| resolved', resolutions.length, '| quarantined', quarantine.length);
