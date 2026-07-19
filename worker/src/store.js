// Bundle loading + engine cache. THE hot requirement (ADR-014 §0, §4):
//   - fetch the versioned bundles from KV ONCE per isolate,
//   - retain parsed data AND the built indices in module scope for the isolate's lifetime,
//   - never re-fetch or re-index per request.
// KV caching is NOT automatic — this module IS the cache. Fails CLOSED on version mismatch.
//
// BLOCKER 3 fix: isolates serve concurrent requests during awaits, so assigning CACHE only after four
// awaited KV reads + index build lets two cold requests both initialise. A module-scope INIT_PROMISE
// makes initialisation happen exactly once; concurrent callers await the same promise.
import { makeEngine } from './engine.js';
import { checkVersions, DegradedError } from './version.js';

let CACHE = null;
let INIT_PROMISE = null;
let INIT_COUNT = 0; // test hook: how many times indices were actually built
let KV_GETS = 0;    // test hook: how many KV reads were issued

export function __resetStore() { CACHE = null; INIT_PROMISE = null; INIT_COUNT = 0; KV_GETS = 0; }
export function __stats() { return { initCount: INIT_COUNT, kvGets: KV_GETS, cached: !!CACHE }; }

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

async function initialise(env) {
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
  return {
    engine,
    versions: {
      identity_version: manifest.identity_version,
      observed_form_graph_version: manifest.observed_form_graph_version,
      matrix_version: manifest.matrix_version,
    },
    manifest,
  };
}

// Returns { engine, versions, manifest }. Throws DegradedError on load/consistency failure.
// Concurrent cold callers share ONE INIT_PROMISE -> exactly one initialisation per isolate.
export async function getContext(env) {
  if (CACHE) return CACHE;
  if (!INIT_PROMISE) INIT_PROMISE = initialise(env);
  try {
    CACHE = await INIT_PROMISE;
    return CACHE;
  } catch (e) {
    INIT_PROMISE = null; // allow a later request to retry after a transient failure
    throw e;
  }
}
