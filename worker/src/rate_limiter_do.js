// Central rate limiter (ADR-014 Step-2a BLOCKER 2). The per-isolate Map in security.js is only a cheap
// first layer — it cannot enforce across isolates, and a rotated session_id bypasses it. THIS is the
// authoritative limiter: a Durable Object gives a single globally-consistent instance, so its in-memory
// counters are correct across all isolates/requests.
//
// Keys are a SERVER-DERIVED identifier (IP) — never the caller-supplied session_id. session_id may aid
// UX continuity elsewhere but is untrusted and is never an enforcement key here.
//
// Enforcement logic (LimiterState) is separated from the DO wrapper so it can be unit-tested locally
// without a live Cloudflare Durable Object (creating the live binding is a DEPLOY step).
import { RATE } from './version.js';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const MAX_KEYS = 50_000;         // global cap per structure — bound memory, evict oldest on overflow
const CLEANUP_EVERY = 5_000;     // sweep expired entries every N checks

export class LimiterState {
  constructor(cfg = RATE) {
    this.cfg = cfg;
    this.counters = new Map();   // key -> { start, n }
    this.sets = new Map();       // key -> { start, set }  (unique botanicals + product×role traversal)
    this.sinceSweep = 0;
  }

  _evictIfNeeded(map) {
    if (map.size <= MAX_KEYS) return;
    // Map preserves insertion order: drop the oldest ~1% to make room.
    const drop = Math.ceil(MAX_KEYS * 0.01);
    let i = 0;
    for (const k of map.keys()) { map.delete(k); if (++i >= drop) break; }
  }
  _sweep(now) {
    for (const [k, e] of this.counters) if (now - e.start >= DAY) this.counters.delete(k);
    for (const [k, e] of this.sets) if (now - e.start >= HOUR) this.sets.delete(k);
  }

  _bump(key, windowMs, limit, now) {
    let e = this.counters.get(key);
    if (!e || now - e.start >= windowMs) { e = { start: now, n: 0 }; this.counters.set(key, e); this._evictIfNeeded(this.counters); }
    e.n++;
    return e.n <= limit;
  }
  _addToSet(key, member, windowMs, now) {
    let e = this.sets.get(key);
    if (!e || now - e.start >= windowMs) { e = { start: now, set: new Set() }; this.sets.set(key, e); this._evictIfNeeded(this.sets); }
    e.set.add(member);
    return e.set.size;
  }

  check(key, { botanical, productRole, now } = {}) {
    now = now || Date.now();
    if (++this.sinceSweep >= CLEANUP_EVERY) { this.sinceSweep = 0; this._sweep(now); }
    const cfg = this.cfg;
    if (!this._bump('m:' + key, MIN, cfg.perMin, now)) return { ok: false, reason: 'per_minute', challenge: false };
    if (!this._bump('h:' + key, HOUR, cfg.perHour, now)) return { ok: false, reason: 'per_hour', challenge: false };
    if (!this._bump('d:' + key, DAY, cfg.perDay, now)) return { ok: false, reason: 'per_day', challenge: false };
    if (botanical != null) {
      const n = this._addToSet('b:' + key, String(botanical).toLowerCase().trim(), HOUR, now);
      if (n > cfg.uniqBotanicalsPerHour) return { ok: false, reason: 'unique_botanicals', challenge: false };
    }
    if (productRole != null) {
      const n = this._addToSet('t:' + key, String(productRole), HOUR, now);
      // enumeration/traversal detection -> adaptive escalation (Turnstile widget wired in Step 3)
      if (n > cfg.distinctProductRolePerHour) return { ok: false, reason: 'enumeration', challenge: true };
    }
    return { ok: true, challenge: false };
  }
}

// Durable Object wrapper. In production this class is bound as a DO namespace (see wrangler.toml.example)
// and reached via env.RATE_LIMITER; a single named instance ('global') holds the authoritative state.
export class RateLimiterDurableObject {
  constructor(state, env) { this.state = state; this.limiter = new LimiterState(); }
  async fetch(request) {
    let body;
    try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, reason: 'bad_request' }); }
    const key = typeof body.key === 'string' ? body.key : null;
    if (!key) return jsonResponse(400, { ok: false, reason: 'no_key' });
    const result = this.limiter.check(key, { botanical: body.botanical, productRole: body.productRole, now: body.now });
    return jsonResponse(200, result);
  }
}
function jsonResponse(status, obj) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }); }

// Called by the Worker. Fails CLOSED if the DO namespace is unbound (misconfiguration must not silently
// downgrade to the weak per-isolate layer).
export async function centralRateLimit(env, args) {
  const ns = env.RATE_LIMITER;
  if (!ns || typeof ns.idFromName !== 'function') return { ok: false, reason: 'limiter_unavailable', challenge: false, unavailable: true };
  const stub = ns.get(ns.idFromName('global'));
  const res = await stub.fetch('https://rate-limiter/check', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  return res.json();
}
