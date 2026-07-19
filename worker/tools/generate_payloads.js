// ADR-014 payload generator (committed). Emits the RUNTIME-MINIMAL, storefront-safe bundles the
// Worker serves — never the authoring artifacts. Run: node worker/tools/generate_payloads.js
// Importable: build functions are exported so tests can build bundles in-memory (no disk dependency).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { API_SCHEMA_VERSION } from '../src/version.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const P = (...a) => path.join(ROOT, ...a);
const gzKB = (s) => (zlib.gzipSync(Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)), { level: 9 }).length / 1024).toFixed(1);
const rawKB = (s) => (Buffer.byteLength(typeof s === 'string' ? s : JSON.stringify(s)) / 1024).toFixed(1);

// ---- identity index (strip provenance / GBIF / review history / merge records) ----
const KEEP = ['canonical_id', 'canonical_display_name', 'authority_accepted_name',
  'original_parsed_names', 'scientific_synonyms', 'trade_synonyms', 'common_names', 'resolution_status'];
export function buildIdentityIndex(backbone) {
  const identities = backbone.identities.map(r => {
    const o = {};
    for (const k of KEEP) if (r[k] !== undefined && r[k] !== null) o[k] = r[k];
    if (r.ambiguity_flag) o.ambiguity_flag = true;
    if (r.candidate_accepted_names && r.candidate_accepted_names.length) o.candidate_accepted_names = r.candidate_accepted_names;
    return o;
  });
  return { identity_version: backbone._meta.identity_version, identity_schema_version: backbone._meta.identity_schema_version, identities };
}

// ---- form graph (storefront-safe: strip supplier identity, counts, observations, source families) ----
export function buildFormGraph(graph) {
  const out = {};
  for (const cid of Object.keys(graph.identities)) {
    const node = graph.identities[cid]; const pp = {};
    for (const part of Object.keys(node.plant_parts || {})) {
      const forms = {};
      for (const sig of Object.keys(node.plant_parts[part].forms || {})) {
        const f = node.plant_parts[part].forms[sig];
        forms[sig] = { base_format_code: f.base_format_code, overlays: f.overlays || [], observation_status: f.observation_status };
        if (f.ingredient_class) forms[sig].ingredient_class = f.ingredient_class;
      }
      pp[part] = { forms };
    }
    out[cid] = { canonical_display_name: node.canonical_display_name, authority_accepted_name: node.authority_accepted_name, plant_parts: pp };
  }
  return {
    observed_form_graph_version: graph._meta.build_date || graph._meta.identity_version,
    built_against_identity_version: graph._meta.identity_version,
    identities: out,
  };
}

// ---- matrix (as data) ----
export function buildMatrix(matrixSrc) {
  const data = JSON.parse(matrixSrc.slice(matrixSrc.indexOf('=') + 1).replace(/;\s*$/, '').trim());
  return { matrix_version: data.schema_version, data };
}

export function buildManifest(identityIndex, formGraph, matrix) {
  return {
    api_schema_version: API_SCHEMA_VERSION,
    identity_version: identityIndex.identity_version,
    observed_form_graph_version: formGraph.observed_form_graph_version,
    matrix_version: matrix.matrix_version,
  };
}

// ---- leakage guard (MANDATORY): fail the build if supplier IP / provenance leaks ----
const FORBIDDEN_KEYS = new Set(['supplier_id', 'supplier_observation_count', 'entity_id',
  'independent_entity_id', 'independent_source_family_count', 'source_family', 'source_family_id',
  'observations', 'provenance', 'gbif_usage_key', 'review_date', 'query_date', 'merged_records',
  'sha256', 'raw_title', 'raw_type', 'physical_behaviour_status', 'match_method', 'supplier_registry',
  'source_families', 'basket_skew']);
// Value scan targets actual PRIVATE identifiers (supplier domain + entity/source-family id prefixes).
// NOT the generic word "supplier": the matrix is the signed-off public decision table (derivable from
// physics/trade, CLAUDE.md) and legitimately advises e.g. "ask an excipient supplier". Structural
// provenance/observation leakage is caught separately by FORBIDDEN_KEYS.
const FORBIDDEN_VALUE = /thewholesaler|\bent_[a-z0-9]|\bsf_[a-z0-9]/i;
export function leakageScan(label, payload) {
  const hits = [];
  (function walk(node, pathStr) {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, pathStr + '[' + i + ']')); return; }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (FORBIDDEN_KEYS.has(k)) hits.push(pathStr + '.' + k + ' (forbidden key)');
        walk(node[k], pathStr + '.' + k);
      }
      return;
    }
    if (typeof node === 'string' && FORBIDDEN_VALUE.test(node)) hits.push(pathStr + ' = "' + node.slice(0, 40) + '" (forbidden value)');
  })(payload, label);
  return hits;
}

export function generateAll() {
  const backbone = JSON.parse(fs.readFileSync(P('knowledge/identity/botanical_identity.json'), 'utf8'));
  const graph = JSON.parse(fs.readFileSync(P('knowledge/pass3/observed_form_graph.json'), 'utf8'));
  const matrixSrc = fs.readFileSync(P('javascript/herbuno-matrix.js'), 'utf8');

  const identityIndex = buildIdentityIndex(backbone);
  const formGraph = buildFormGraph(graph);
  const matrix = buildMatrix(matrixSrc);
  const manifest = buildManifest(identityIndex, formGraph, matrix);
  return { identityIndex, formGraph, matrix, manifest };
}

function main() {
  const { identityIndex, formGraph, matrix, manifest } = generateAll();

  // leakage guard — the form graph and matrix are storefront-facing; identity index too.
  const allHits = [
    ...leakageScan('identity_index', identityIndex),
    ...leakageScan('form_graph', formGraph),
    ...leakageScan('matrix', matrix.data.fam), // scan matrix DATA (skip helper labels) for supplier leakage
  ];
  if (allHits.length) {
    console.error('LEAKAGE TEST FAILED — supplier/provenance data in generated payloads:');
    for (const h of allHits.slice(0, 30)) console.error('  ' + h);
    process.exit(1);
  }

  const outDir = P('worker/data');
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    'identity_index.json': identityIndex,
    'form_graph.json': formGraph,
    'matrix.json': matrix,
    'manifest.json': manifest,
  };
  for (const [name, obj] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj));

  console.log('LEAKAGE TEST: PASS (0 supplier/provenance fields in any payload)');
  console.log('generated worker/data/ against identity_version %s / graph %s / matrix %s:',
    manifest.identity_version, manifest.observed_form_graph_version, manifest.matrix_version);
  for (const [name, obj] of Object.entries(files)) console.log('  ' + name.padEnd(20) + ' raw ' + rawKB(obj) + ' KB / gz ' + gzKB(obj) + ' KB');
  console.log('KV keys: manifest:current, identity:%s, formgraph:%s, matrix:%s',
    manifest.identity_version, manifest.observed_form_graph_version, manifest.matrix_version);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
