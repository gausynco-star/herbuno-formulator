// Central rate limiter (ADR-014 Step-2a BLOCKER 2, Step-2b BLOCKER 1). The per-isolate Map in
// security.js is only a cheap first layer. THIS is the authoritative limiter: a Durable Object gives a
// single globally-consistent instance whose state is PERSISTED to `state.storage` — so counters and
// enumeration history survive DO eviction/restart. Storage is the source of truth; the in-memory Maps
// are a read-through cache loaded once (blockConcurrencyWhile) before any request is served.
//
// Keys are a SERVER-DERIVED identifier (IP) — never the caller-supplied session_id.
//
// LimiterState (pure logic + dirty-tracking) is separated from the DO wrapper (storage) so the logic
// can be unit-tested in-process and the persistence can be integration-tested under real workerd.
import { RATE } from './version.js';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const MAX_KEYS = 50_000;
const CLEANUP_EVERY = 5_000;
const STORAGE_BATCH = 128;   // Cloudflare storage.put/delete cap per call

export class LimiterState {
  constructor(cfg = RATE) {
    this.cfg = cfg;
    this.counters = new Map();   // key -> { start, n }
    this.sets = new Map();       // key -> { start, set:Set }
    this.dirty = new Set();      // internal keys mutated since last drain (for persistence)
    this.sinceSweep = 0;
  }

  // hydrate from persisted storage (counterMap: key->{start,n}; setMap: key->{start,members[]})
  hydrate(counterMap, setMap) {
    for (const [k, v] of counterMap) this.counters.set(k, v);
    for (const [k, v] of setMap) this.sets.set(k, { start: v.start, set: new Set(v.members || []) });
  }
  // emit the mutations to persist ('C' counter, 'S' set, 'del' removed), then clear
  drainDirty() {
    const ops = [];
    for (const k of this.dirty) {
      if (this.counters.has(k)) ops.push({ kind: 'C', key: k, value: this.counters.get(k) });
      else if (this.sets.has(k)) { const e = this.sets.get(k); ops.push({ kind: 'S', key: k, value: { start: e.start, members: [...e.set] } }); }
      else ops.push({ kind: 'del', key: k });
    }
    this.dirty.clear();
    return ops;
  }

  _evictIfNeeded(map) {
    if (map.size <= MAX_KEYS) return;
    const drop = Math.ceil(MAX_KEYS * 0.01); let i = 0;
    for (const k of map.keys()) { map.delete(k); this.dirty.add(k); if (++i >= drop) break; }
  }
  _sweep(now) {
    for (const [k, e] of this.counters) if (now - e.start >= DAY) { this.counters.delete(k); this.dirty.add(k); }
    for (const [k, e] of this.sets) if (now - e.start >= HOUR) { this.sets.delete(k); this.dirty.add(k); }
  }
  _bump(key, windowMs, limit, now) {
    let e = this.counters.get(key);
    if (!e || now - e.start >= windowMs) { e = { start: now, n: 0 }; this.counters.set(key, e); this._evictIfNeeded(this.counters); }
    e.n++;
    this.dirty.add(key);
    return e.n <= limit;
  }
  _addToSet(key, member, windowMs, now) {
    let e = this.sets.get(key);
    if (!e || now - e.start >= windowMs) { e = { start: now, set: new Set() }; this.sets.set(key, e); this._evictIfNeeded(this.sets); }
    e.set.add(member);
    this.dirty.add(key);
    return e.set.size;
  }

  check(key, { botanical, productRole, now, transportKey, candidateFormat } = {}) {
    now = now || Date.now();
    if (++this.sinceSweep >= CLEANUP_EVERY) { this.sinceSweep = 0; this._sweep(now); }
    const cfg = this.cfg;
    // Coarse transport backstop on the non-spoofable egress IP: checked FIRST so aggregate abuse is
    // bounded even when the shopper key is rotated / straddled / malformed to the fallback. Disabled if
    // cfg.transport is null or no transportKey supplied. Distinct 't*:' namespace from the shopper keys.
    if (transportKey != null && cfg.transport) {
      const t = cfg.transport;
      if (!this._bump('tm:' + transportKey, MIN, t.perMin, now)) return { ok: false, reason: 'transport_per_minute', challenge: false };
      if (!this._bump('th:' + transportKey, HOUR, t.perHour, now)) return { ok: false, reason: 'transport_per_hour', challenge: false };
      if (!this._bump('td:' + transportKey, DAY, t.perDay, now)) return { ok: false, reason: 'transport_per_day', challenge: false };
    }
    if (!this._bump('m:' + key, MIN, cfg.perMin, now)) return { ok: false, reason: 'per_minute', challenge: false };
    if (!this._bump('h:' + key, HOUR, cfg.perHour, now)) return { ok: false, reason: 'per_hour', challenge: false };
    if (!this._bump('d:' + key, DAY, cfg.perDay, now)) return { ok: false, reason: 'per_day', challenge: false };
    if (botanical != null) {
      const n = this._addToSet('b:' + key, String(botanical).toLowerCase().trim(), HOUR, now);
      if (n > cfg.uniqBotanicalsPerHour) return { ok: false, reason: 'unique_botanicals', challenge: false };
    }
    if (productRole != null) {
      const n = this._addToSet('t:' + key, String(productRole), HOUR, now);
      if (n > cfg.distinctProductRolePerHour) return { ok: false, reason: 'enumeration', challenge: true };
    }
    // candidate_format enumeration guard (ADR-014 Step 3): a SET of the DISTINCT candidate formats queried
    // for this shopper×hour×product×role. Repeats of one format keep size at 1 (legitimate re-checking); a
    // 4th DISTINCT format for the cell trips. Separate from ordinary/botanical/traversal limits above, all
    // of which have already incremented for this request.
    if (candidateFormat != null && productRole != null) {
      const n = this._addToSet('cf:' + key + '|' + productRole, String(candidateFormat), HOUR, now);
      if (n > cfg.distinctCandidateFormatsPerCellPerHour) return { ok: false, reason: 'candidate_enumeration', challenge: false };
    }
    return { ok: true, challenge: false };
  }
}

const jr = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
async function batchPut(storage, puts) { const ks = Object.keys(puts); for (let i = 0; i < ks.length; i += STORAGE_BATCH) { const c = {}; for (const k of ks.slice(i, i + STORAGE_BATCH)) c[k] = puts[k]; await storage.put(c); } }
async function batchDelete(storage, dels) { for (let i = 0; i < dels.length; i += STORAGE_BATCH) await storage.delete(dels.slice(i, i + STORAGE_BATCH)); }

// Durable Object. Bound as env.RATE_LIMITER (see wrangler.toml.example); a single named instance
// ('global') holds the authoritative, PERSISTED state.
export class RateLimiterDurableObject {
  constructor(state, env) {
    this.state = state;
    this.limiter = new LimiterState();
    // Load persisted state BEFORE any request is processed — otherwise startup races (Step-2b BLOCKER 1).
    this.ready = state.blockConcurrencyWhile(async () => {
      const cMap = new Map(), sMap = new Map();
      for (const [sk, v] of await state.storage.list({ prefix: 'C:' })) cMap.set(sk.slice(2), v);
      for (const [sk, v] of await state.storage.list({ prefix: 'S:' })) sMap.set(sk.slice(2), v);
      this.limiter.hydrate(cMap, sMap);
    });
  }

  async fetch(request) {
    await this.ready;   // redundant under real workerd (blockConcurrencyWhile gates), safe for fakes
    let body;
    try { body = await request.json(); } catch { return jr(400, { ok: false, reason: 'bad_request' }); }

    // internal introspection for tests — NEVER routed through the public Worker (the Worker only ever
    // sends {key, botanical, productRole, now}), so it is not reachable by external callers.
    if (body.action === 'stat') {
      const c = this.limiter.counters.get(body.key);
      const s = this.limiter.sets.get(body.key);
      return jr(200, { count: c ? c.n : 0, setSize: s ? s.set.size : 0 });
    }

    const key = typeof body.key === 'string' ? body.key : null;
    if (!key) return jr(400, { ok: false, reason: 'no_key' });
    const result = this.limiter.check(key, { botanical: body.botanical, productRole: body.productRole, now: body.now, transportKey: body.transportKey, candidateFormat: body.candidateFormat });

    // Atomic persistence via the DO's single-threaded request path. Storage is the source of truth.
    const ops = this.limiter.drainDirty();
    const puts = {}; const dels = [];
    for (const op of ops) {
      if (op.kind === 'C') puts['C:' + op.key] = op.value;
      else if (op.kind === 'S') puts['S:' + op.key] = op.value;
      else { dels.push('C:' + op.key, 'S:' + op.key); }
    }
    if (Object.keys(puts).length) await batchPut(this.state.storage, puts);
    if (dels.length) await batchDelete(this.state.storage, dels);
    return jr(200, result);
  }
}

// Called by the Worker. Fails CLOSED if the DO namespace is unbound (must not downgrade to the weak
// per-isolate layer).
export async function centralRateLimit(env, args) {
  const ns = env.RATE_LIMITER;
  if (!ns || typeof ns.idFromName !== 'function') return { ok: false, reason: 'limiter_unavailable', challenge: false, unavailable: true };
  const stub = ns.get(ns.idFromName('global'));
  const res = await stub.fetch('https://rate-limiter/check', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  return res.json();
}
