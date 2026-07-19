// Bundle loading + engine cache. THE hot requirement (ADR-014 §0, §4):
//   - fetch the versioned bundles from KV ONCE per isolate,
//   - retain parsed data AND the built indices in module scope for the isolate's lifetime,
//   - never re-fetch or re-index per request.
// KV caching is NOT automatic — this module IS the cache. Fails CLOSED on version mismatch.
import { makeEngine } from './engine.js';
import { checkVersions, DegradedError } from './version.js';

// module scope => shared across requests on the same isolate, rebuilt only on a fresh isolate
let CACHE = null;
let INIT_COUNT = 0; // test hook: how many times indices were built
let KV_GETS = 0;    // test hook: how many KV reads were issued

export function __resetStore() { CACHE = null; INIT_COUNT = 0; KV_GETS = 0; }
export function __stats() { return { initCount: INIT_COUNT, kvGets: KV_GETS, cached: !!CACHE }; }

// KV key scheme (see README): a pointer key names the current versions; bundles are stored under
// version-stamped keys, so an identity_version bump = write new bundles + update the pointer, no
// Worker redeploy.
const KEY = {
  manifest: 'manifest:current',
  identity: (v) => 'identity:' + v,
  formgraph: (v) => 'formgraph:' + v,
  matrix: (v) => 'matrix:' + v,
};

async function kvGetJson(kv, key) {
  KV_GETS++;
  const raw = await kv.get(key);
  if (raw == null) throw new DegradedError('missing_key:' + key);
  try { return JSON.parse(raw); } catch { throw new DegradedError('bad_json:' + key); }
}

// Returns { engine, versions, manifest }. Throws DegradedError on any load/consistency failure.
export async function getContext(env) {
  if (CACHE) return CACHE;
  const kv = env.HB_KV;
  if (!kv || typeof kv.get !== 'function') throw new DegradedError('kv_unavailable');

  const manifest = await kvGetJson(kv, KEY.manifest);
  const identity = await kvGetJson(kv, KEY.identity(manifest.identity_version));
  const formgraph = await kvGetJson(kv, KEY.formgraph(manifest.observed_form_graph_version));
  const matrix = await kvGetJson(kv, KEY.matrix(manifest.matrix_version));

  const vc = checkVersions(manifest, identity, formgraph, matrix);
  if (!vc.ok) throw new DegradedError('version_mismatch:' + vc.reason);

  const engine = makeEngine(identity, formgraph, matrix); // builds indices ONCE
  INIT_COUNT++;
  CACHE = {
    engine,
    versions: {
      identity_version: manifest.identity_version,
      observed_form_graph_version: manifest.observed_form_graph_version,
      matrix_version: manifest.matrix_version,
    },
    manifest,
  };
  return CACHE;
}
