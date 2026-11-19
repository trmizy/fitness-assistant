#!/usr/bin/env node
/**
 * Discovery benchmark (Phase P) - PT search / gym search / legacy GET /gyms through the gateway.
 *
 * Evidence label of a real run: REAL HTTP/API (through the gateway, against the stack it points at).
 * `--dry-run` makes NO network call and prints the plan only.
 *
 * Load generator: `autocannon` is NOT resolvable in this workspace (checked at authoring time), so this
 * script uses Node's built-in fetch + a concurrency pool + process.hrtime.bigint() timers. No dependency added.
 *
 * Usage:
 *   node scripts/perf/discovery-bench.mjs --dry-run
 *   BENCH_EMAIL=... BENCH_PASSWORD=... node scripts/perf/discovery-bench.mjs [--warm 20] [--concurrency 1,10]
 *        [--only <regex on query id>] [--pgss] [--label scale-seed42] [--out <dir>]
 *
 * Env:
 *   BENCH_GATEWAY_URL   default http://127.0.0.1:59100
 *   BENCH_EMAIL / BENCH_PASSWORD   login once (PT search needs a Bearer token; gyms are public). Never printed.
 *   BENCH_MAX_RPM       default 90. Rolling 60 s window cap over ALL requests (login included); 0 = unthrottled.
 *                       The gateway global limiter is 100 req/60 s per IP unless RATE_LIMIT_MAX_REQUESTS was raised.
 *   BENCH_WARM          default 20 (same as --warm)       BENCH_CONCURRENCY default "1,10"
 *   BENCH_GYM_Q         default "Fitness" (brand text)    BENCH_AMENITY default "SWIMMING_POOL" (system amenity slug)
 *   BENCH_PG_USER_URL / BENCH_PG_GYM_URL   only for --pgss (postgres connection strings; never printed)
 *
 * --sqllog (SQL statements per request, no restart / no infra change; SCALE stack ONLY):
 *   BENCH_PG_CONTAINER (default gymcoach-postgres-scale), BENCH_DB_USER (default gymcoach_user_scale),
 *   BENCH_DB_GYM (default gymcoach_gym_scale). Mechanism, all through `docker exec <container> psql` (no URL, no password):
 *     1. refuse unless container name contains "scale", DBs match gymcoach_<svc>_scale and the container publishes :55440;
 *     2. ALTER SYSTEM SET log_min_duration_statement=0 + log_line_prefix='%m [%p] %d %u ' ; pg_reload_conf();
 *     3. per query: marker SELECT -> ONE extra request -> marker SELECT -> `docker logs --since 60s`; count the
 *        `statement:`/`execute` entries between the markers for the target DB (BEGIN/COMMIT/SET... counted apart);
 *     4. ALWAYS (finally + SIGINT/SIGTERM) ALTER SYSTEM RESET of both settings + pg_reload_conf().
 *   `--sqllog-restore` only performs step 4 (use it if a run was killed hard).
 *   Side effects to know: it changes cluster-wide settings of the scale postgres for the duration of the run (RESET also
 *   drops any pre-existing ALTER SYSTEM value of those two settings); bound parameters (incl. GPS) of every statement
 *   land in the scale postgres log while it is on (synthetic data only); other traffic on the stack inflates counts.
 *
 * Honest limits (also written into the report):
 *  - "cold" = the first request of that query in this run. It is NOT a guaranteed cold DB/OS cache; restart
 *    postgres + services first if a true cold number is needed.
 *  - Percentiles use nearest-rank on the warm samples. With N=20, p99 == the maximum sample; use --warm 100+
 *    for a meaningful p99.
 *  - With throttling (BENCH_MAX_RPM>0) a C=10 run still bursts 10 in flight (the window allows it) but then
 *    pauses until the window frees; latency is timed from the moment the request is sent, never including the pause.
 *  - Payload = decoded response body bytes (what the client parses), not wire bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const PROVINCES_JSON = path.join(repoRoot, "backend/services/user-service/prisma/data/vietnam_provinces.json");
const DEFAULT_OUT = path.join(repoRoot, "_warroom/evidence/discovery-scale");

// ---------------------------------------------------------------- CLI / env
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
};
const DRY_RUN = !!flag("dry-run", false);
const WARM = Math.max(1, Number.parseInt(String(flag("warm", process.env.BENCH_WARM ?? "20")), 10) || 20);
const CONCURRENCIES = String(flag("concurrency", process.env.BENCH_CONCURRENCY ?? "1,10"))
  .split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n >= 1);
const ONLY = flag("only", null) ? new RegExp(String(flag("only")), "i") : null;
const USE_PGSS = !!flag("pgss", false);
const USE_SQLLOG = !!flag("sqllog", false);
const SQLLOG_RESTORE_ONLY = !!flag("sqllog-restore", false);
const PG_CONTAINER = process.env.BENCH_PG_CONTAINER || "gymcoach-postgres-scale";
const DB_USER_SVC = process.env.BENCH_DB_USER || "gymcoach_user_scale";
const DB_GYM_SVC = process.env.BENCH_DB_GYM || "gymcoach_gym_scale";
const LABEL = String(flag("label", "run")).replace(/[^\w.-]/g, "_");
const OUT_DIR = path.resolve(String(flag("out", DEFAULT_OUT)));
const BASE = (process.env.BENCH_GATEWAY_URL || "http://127.0.0.1:59100").replace(/\/+$/, "");
const MAX_RPM = Number.parseInt(process.env.BENCH_MAX_RPM ?? "90", 10);
const GYM_Q = process.env.BENCH_GYM_Q || "Fitness";
const AMENITY = process.env.BENCH_AMENITY || "SWIMMING_POOL";

// ---------------------------------------------------------------- geo constants (codes resolved by NAME, never hard-coded)
const HCM = { lat: 10.776, lng: 106.701 };
const HN = { lat: 21.0285, lng: 105.8542 };

function loadGeo() {
  const provinces = JSON.parse(fs.readFileSync(PROVINCES_JSON, "utf8"));
  const prov = (name) => {
    const p = provinces.find((x) => x.name === name);
    if (!p) throw new Error(`Province not found in vietnam_provinces.json: ${name}`);
    return p;
  };
  const ward = (p, name) => {
    const w = p.wards.find((x) => x.name === name);
    if (!w) throw new Error(`Ward not found: ${name} in ${p.name}`);
    return w;
  };
  const hcm = prov("Thành phố Hồ Chí Minh");
  const hn = prov("Thành phố Hà Nội");
  const dn = prov("Thành phố Đà Nẵng");
  const lc = prov("Tỉnh Lai Châu");
  return {
    hcm: hcm.code, hn: hn.code, dn: dn.code, lc: lc.code,
    hcmWard: ward(hcm, "Phường Sài Gòn").code,
    hnWard: ward(hn, "Phường Hoàn Kiếm").code,
  };
}

// ---------------------------------------------------------------- the fixed query list (deterministic)
/**
 * kind: "pt" (POST /profile/pts/search, auth) | "gym" | "legacy" | "brand".
 * thr:  which plan-E threshold set applies: "pt" (p95<=300, p99<=600, payload<=120KB, sql<=8),
 *       "gym10" (p95<=250), or null (INFO only - no threshold in the plan).
 */
export function buildQueries(g) {
  const pt = (id, desc, body, extra = {}) => ({
    id, kind: "pt", desc, method: "POST", url: "/profile/pts/search", auth: true, body: { limit: 20, ...body }, thr: "pt", ...extra,
  });
  const gym = (id, desc, body, extra = {}) => ({
    id, kind: "gym", desc, method: "POST", url: "/gyms/search", auth: false, body: { limit: 20, ...body }, thr: null, ...extra,
  });
  return [
    pt("pt-national-any", "PT national, mode ANY", { scope: "national", mode: "ANY" }),
    pt("pt-national-offline", "PT national, mode OFFLINE", { scope: "national", mode: "OFFLINE" }),
    pt("pt-national-online", "PT national, mode ONLINE", { scope: "national", mode: "ONLINE" }),
    pt("pt-prov-hcm", "PT province HCM", { scope: "province", areaProvince: g.hcm, mode: "ANY" }),
    pt("pt-prov-hn", "PT province Ha Noi", { scope: "province", areaProvince: g.hn, mode: "ANY" }),
    pt("pt-prov-dn", "PT province Da Nang", { scope: "province", areaProvince: g.dn, mode: "ANY" }),
    pt("pt-prov-laichau", "PT province Lai Chau (sparse)", { scope: "province", areaProvince: g.lc, mode: "ANY" }),
    pt("pt-ward-hcm", "PT ward center HCM (Phuong Sai Gon), 10 km", { scope: "near", areaProvince: g.hcm, areaWard: g.hcmWard, radiusKm: 10 }),
    pt("pt-ward-hn", "PT ward center Ha Noi (Phuong Hoan Kiem), 10 km", { scope: "near", areaProvince: g.hn, areaWard: g.hnWard, radiusKm: 10 }),
    pt("pt-gps-hcm-10", "PT GPS HCM 10 km", { ...HCM, scope: "near", radiusKm: 10 }),
    pt("pt-gps-hcm-20", "PT GPS HCM 20 km", { ...HCM, scope: "near", radiusKm: 20 }),
    pt("pt-gps-hcm-50", "PT GPS HCM 50 km", { ...HCM, scope: "near", radiusKm: 50 }),
    pt("pt-gps-hn-10", "PT GPS Ha Noi 10 km", { ...HN, scope: "near", radiusKm: 10 }),
    pt("pt-gps-hn-20", "PT GPS Ha Noi 20 km", { ...HN, scope: "near", radiusKm: 20 }),
    pt("pt-gps-hn-50", "PT GPS Ha Noi 50 km", { ...HN, scope: "near", radiusKm: 50 }),
    pt("pt-filter-spec-price", "PT GPS HCM 20 km + specialty Giảm mỡ + price 150k-500k", { ...HCM, scope: "near", radiusKm: 20, filters: { specialties: ["Giảm mỡ"], minPrice: 150000, maxPrice: 500000 } }),
    pt("pt-sort-rating", "PT GPS HCM 20 km sortBy ratingDesc", { ...HCM, scope: "near", radiusKm: 20, sortBy: "ratingDesc" }),
    pt("pt-sort-price", "PT GPS HCM 20 km sortBy priceAsc", { ...HCM, scope: "near", radiusKm: 20, sortBy: "priceAsc" }),
    pt("pt-sort-distance", "PT GPS HCM 20 km sortBy distance", { ...HCM, scope: "near", radiusKm: 20, sortBy: "distance" }),
    pt("pt-page2", "PT GPS HCM 20 km, 2nd page via cursor (page 1 fetched as unmeasured setup)", { ...HCM, scope: "near", radiusKm: 20 }, { cursorFromPage1: true }),
    gym("gym-national", "Gym national", { scope: "national" }),
    gym("gym-hcm-10km", "Gym GPS HCM 10 km (plan threshold p95<=250)", { ...HCM, scope: "near", radiusKm: 10 }, { thr: "gym10" }),
    gym("gym-prov-hn", "Gym province Ha Noi", { scope: "province", areaProvince: g.hn }),
    gym("gym-q-brand", `Gym text q="${GYM_Q}" national`, { scope: "national", q: GYM_Q }),
    gym("gym-amenity", `Gym national, amenity ${AMENITY}`, { scope: "national", amenityIds: [AMENITY] }),
    gym("gym-sort-rating", "Gym GPS HCM 10 km sort rating", { ...HCM, scope: "near", radiusKm: 10, sort: "rating" }),
    gym("gym-sort-price", "Gym GPS HCM 10 km sort price", { ...HCM, scope: "near", radiusKm: 10, sort: "price" }),
    { id: "gym-legacy-list", kind: "legacy", desc: "Legacy GET /gyms (unpaged; measure + payload only, no behaviour change)", method: "GET", url: "/gyms", auth: false, thr: null },
    { id: "gym-brand-options", kind: "brand", desc: "GET /gyms/brand-options?limit=20", method: "GET", url: "/gyms/brand-options?limit=20", auth: false, thr: null },
  ];
}

// ---------------------------------------------------------------- helpers
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function pct(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Rolling 60 s window cap; acquire() resolves when one more request is allowed. */
function makeLimiter(maxRpm) {
  const stamps = [];
  let chain = Promise.resolve();
  const acquire = () => {
    if (!(maxRpm > 0)) return Promise.resolve();
    const next = chain.then(async () => {
      for (;;) {
        const t = Date.now();
        while (stamps.length && t - stamps[0] >= 60_000) stamps.shift();
        if (stamps.length < maxRpm) { stamps.push(t); return; }
        await sleep(stamps[0] + 60_000 - t + 25);
      }
    });
    chain = next.catch(() => {});
    return next;
  };
  return { acquire };
}

// ---------------------------------------------------------------- HTTP
const limiter = makeLimiter(MAX_RPM);
let TOKEN = null;
let requestsSent = 0;

async function oneRequest(q, { cursor } = {}) {
  await limiter.acquire();
  const headers = { Accept: "application/json", "X-Gymini-Client": "perf-bench" };
  if (q.auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  let body;
  if (q.method === "POST") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(cursor ? { ...q.body, cursor } : q.body);
  }
  requestsSent++;
  const t0 = nowMs();
  try {
    const res = await fetch(BASE + q.url, { method: q.method, headers, body, signal: AbortSignal.timeout(30_000) });
    const buf = await res.arrayBuffer();
    const ms = nowMs() - t0;
    return { status: res.status, ms, bytes: buf.byteLength, buf };
  } catch (e) {
    return { status: 0, ms: nowMs() - t0, bytes: 0, err: e?.cause?.code || e?.name || "FETCH_ERROR" };
  }
}

async function login() {
  const email = process.env.BENCH_EMAIL, password = process.env.BENCH_PASSWORD;
  if (!email || !password) return { ok: false, reason: "BENCH_EMAIL/BENCH_PASSWORD not set" };
  await limiter.acquire();
  requestsSent++;
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => ({}));
    const tok = j.accessToken ?? j.data?.accessToken ?? j.tokens?.accessToken;
    if (!res.ok || !tok) return { ok: false, reason: `login failed: HTTP ${res.status}${j.error ? ` (${String(j.error).slice(0, 80)})` : ""}` };
    TOKEN = tok; // never printed or written to disk
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `login error: ${e?.cause?.code || e?.name}` };
  }
}

/** Run `total` requests with at most `c` in flight; returns samples. */
async function runPool(q, total, c, cursor) {
  const samples = new Array(total);
  let next = 0;
  const wall0 = nowMs();
  await Promise.all(Array.from({ length: Math.min(c, total) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const r = await oneRequest(q, { cursor });
      samples[i] = { status: r.status, ms: r.ms, bytes: r.bytes };
    }
  }));
  return { samples, wallMs: nowMs() - wall0 };
}

function summarize(samples, wallMs) {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const lat = ok.map((s) => s.ms).sort((a, b) => a - b);
  const hist = {};
  for (const s of samples) hist[s.status] = (hist[s.status] || 0) + 1;
  const bytes = ok.map((s) => s.bytes);
  return {
    requests: samples.length,
    ok2xx: ok.length,
    statusHistogram: hist,
    count429: hist[429] || 0,
    count503: hist[503] || 0,
    countOtherErr: samples.filter((s) => !(s.status >= 200 && s.status < 300) && s.status !== 429 && s.status !== 503).length,
    latencyMs: lat.length ? { min: r1(lat[0]), p50: r1(pct(lat, 50)), p95: r1(pct(lat, 95)), p99: r1(pct(lat, 99)), max: r1(lat[lat.length - 1]), mean: r1(lat.reduce((a, b) => a + b, 0) / lat.length) } : null,
    payloadKB: bytes.length ? { avg: r2(bytes.reduce((a, b) => a + b, 0) / bytes.length / 1024), max: r2(Math.max(...bytes) / 1024) } : null,
    throughputRps: r2(samples.length / (wallMs / 1000)),
  };
}

// ---------------------------------------------------------------- verdicts (plan section E)
export const THRESHOLDS = Object.freeze({
  pt: { p95: 300, p99: 600, payloadKB: 120, sql: 8 },
  gym10: { p95: 250 },
});

function verdict(q, s, sqlCalls) {
  const out = { checks: [], overall: "INFO" };
  if (!q.thr) return out;
  if (s.count429 > 0) { out.overall = "INVALID (429 throttled - not a service measurement)"; return out; }
  const t = THRESHOLDS[q.thr];
  const L = s.latencyMs;
  const add = (name, limit, val, unit) => out.checks.push({ name, limit, value: val, unit, result: val == null ? "NO DATA" : val <= limit ? "PASS" : "FAIL" });
  add("p95", t.p95, L?.p95 ?? null, "ms");
  if (t.p99) add("p99", t.p99, L?.p99 ?? null, "ms");
  if (t.payloadKB) add("payload max", t.payloadKB, s.payloadKB?.max ?? null, "KB");
  if (t.sql) out.checks.push(sqlCalls == null
    ? { name: "SQL/request", limit: t.sql, value: null, unit: "stmts", result: "NOT MEASURED" }
    : { name: "SQL/request", limit: t.sql, value: sqlCalls, unit: "stmts", result: sqlCalls <= t.sql ? "PASS" : "FAIL" });
  const errs = s.requests - s.ok2xx;
  if (errs > 0) out.checks.push({ name: "non-2xx", limit: 0, value: errs, unit: "req", result: "FAIL" });
  out.overall = out.checks.some((c) => c.result === "FAIL" || c.result === "NO DATA") ? "FAIL"
    : out.checks.some((c) => c.result === "NOT MEASURED") ? "PASS (SQL count not measured)" : "PASS";
  return out;
}

// ---------------------------------------------------------------- optional pg_stat_statements (SQL statements per request)
async function openPgss() {
  const info = { available: false, reason: null, clients: {} };
  let pg;
  try { pg = (await import("pg")).default; } catch { info.reason = "module 'pg' not resolvable"; return { info }; }
  const urls = { user: process.env.BENCH_PG_USER_URL, gym: process.env.BENCH_PG_GYM_URL };
  if (!urls.user && !urls.gym) { info.reason = "BENCH_PG_USER_URL / BENCH_PG_GYM_URL not set"; return { info }; }
  const clients = {};
  for (const [k, url] of Object.entries(urls)) {
    if (!url) continue;
    const c = new pg.Client({ connectionString: url });
    try {
      await c.connect();
      const ext = await c.query("SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'");
      const lib = (await c.query("SHOW shared_preload_libraries")).rows[0].shared_preload_libraries;
      if (!ext.rowCount || !String(lib).includes("pg_stat_statements")) {
        info.clients[k] = `NOT ENABLED (extension installed=${!!ext.rowCount}, in shared_preload_libraries=${String(lib).includes("pg_stat_statements")})`;
        await c.end(); continue;
      }
      clients[k] = c; info.clients[k] = "enabled";
    } catch (e) { info.clients[k] = `connect failed: ${e?.code || e?.name}`; try { await c.end(); } catch { /* ignore */ } }
  }
  info.available = Object.keys(clients).length > 0;
  if (!info.available) info.reason = "pg_stat_statements not usable on any configured DB";
  return { info, clients };
}
const CONTROL_RE = /^\s*(BEGIN|COMMIT|ROLLBACK|SET|SHOW|DEALLOCATE|SAVEPOINT|RELEASE|START TRANSACTION)\b/i;
async function pgssSnapshot(c) {
  const r = await c.query(`SELECT queryid::text AS id, query, calls::bigint AS calls FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT ILIKE '%pg_stat_statements%'`);
  return new Map(r.rows.map((x) => [x.id, { q: x.query, calls: Number(x.calls) }]));
}
function pgssDiff(before, after) {
  let total = 0, data = 0;
  for (const [id, a] of after) {
    const d = a.calls - (before.get(id)?.calls || 0);
    if (d > 0) { total += d; if (!CONTROL_RE.test(a.q)) data += d; }
  }
  return { total, dataStatements: data };
}

// ---------------------------------------------------------------- optional --sqllog (SQL statements per request via temporary statement logging)
/** Pure guard: scale stack only. `publishedPort` (output of `docker port <c> 5432`) is checked on real runs. */
export function assertScaleSqlLogTarget({ container, dbs, publishedPort }) {
  const errs = [];
  if (!/^[\w.-]+$/.test(container) || !/scale/i.test(container)) errs.push(`container "${container}" is not a scale container (name must contain "scale")`);
  for (const db of dbs) if (!/^gymcoach_[a-z]+_scale$/.test(db)) errs.push(`database "${db}" is not a gymcoach_<svc>_scale database`);
  if (publishedPort !== undefined && !/(^|:)55440\s*$/m.test(publishedPort)) errs.push(`container does not publish port 55440 (got "${String(publishedPort).trim()}")`);
  if (errs.length) throw new Error(`--sqllog refused (scale stack only): ${errs.join("; ")}`);
}

function docker(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}
/** Runs SQL through psql inside the scale container (identity from the container's own env; nothing secret passes through here). */
function containerPsql(db, sql) {
  const r = docker(["exec", "-i", PG_CONTAINER, "sh", "-c", `psql -U "$POSTGRES_USER" -d ${db} -At -v ON_ERROR_STOP=1`], sql);
  if (r.status !== 0) throw new Error(`psql on ${db} failed: ${(r.stderr || "").trim().slice(0, 200)}`);
  return r.stdout;
}

const LOG_ENTRY_RE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)? \S+ \[(\d+)\] (\S*) (\S*) LOG:  duration: [\d.]+ ms  (?:statement|execute [^:]*): (.*)$/;
/** Statement executions only (simple `statement:` + extended `execute`); parse/bind/DETAIL lines are ignored. */
export function parseLogEntries(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LOG_ENTRY_RE.exec(line);
    if (m) out.push({ pid: m[1], db: m[2], user: m[3], sql: m[4] });
  }
  return out;
}
/** Counts entries strictly between the two markers for `db`, excluding the marker sessions' own pids. */
export function countBetweenMarkers(entries, beginTag, endTag, db) {
  const bi = entries.findIndex((e) => e.sql.includes(beginTag));
  const ei = entries.findIndex((e) => e.sql.includes(endTag));
  if (bi < 0 || ei < 0 || ei < bi) return null;
  const adminPids = new Set([entries[bi].pid, entries[ei].pid]);
  const mine = entries.slice(bi + 1, ei).filter((e) => e.db === db && !adminPids.has(e.pid) && !e.sql.includes("bench_marker"));
  const data = mine.filter((e) => !CONTROL_RE.test(e.sql));
  return { total: mine.length, dataStatements: data.length, sample: data.slice(0, 12).map((e) => e.sql.replace(/\s+/g, " ").slice(0, 100)) };
}

function sqllogRestore() {
  try {
    containerPsql(DB_USER_SVC, "ALTER SYSTEM RESET log_min_duration_statement;\nALTER SYSTEM RESET log_line_prefix;\nSELECT pg_reload_conf();");
    console.log("[bench] sqllog: statement logging RESET + reloaded");
    return true;
  } catch (e) {
    console.error(`[bench] sqllog: RESTORE FAILED - run 'node scripts/perf/discovery-bench.mjs --sqllog-restore' (${e.message})`);
    return false;
  }
}
async function sqllogSetup() {
  const port = docker(["port", PG_CONTAINER, "5432"]);
  if (port.status !== 0) throw new Error(`docker port ${PG_CONTAINER} failed: ${(port.stderr || "").trim().slice(0, 160)}`);
  assertScaleSqlLogTarget({ container: PG_CONTAINER, dbs: [DB_USER_SVC, DB_GYM_SVC], publishedPort: port.stdout });
  containerPsql(DB_USER_SVC, "ALTER SYSTEM SET log_min_duration_statement = 0;\nALTER SYSTEM SET log_line_prefix = '%m [%p] %d %u ';\nSELECT pg_reload_conf();");
  await sleep(1200);
  const shown = containerPsql(DB_USER_SVC, "SHOW log_min_duration_statement;\nSHOW log_line_prefix;").trim().split(/\r?\n/);
  if (shown[0] !== "0" || !String(shown[1]).includes("%d")) { sqllogRestore(); throw new Error(`statement logging did not take effect (got ${JSON.stringify(shown)})`); }
}
let sqllogSeq = 0;
async function sqllogMeasure(q, fire) {
  const db = q.kind === "pt" ? DB_USER_SVC : DB_GYM_SVC;
  const id = `${Date.now()}_${sqllogSeq++}`;
  const b = `bench_marker_B_${id}`, e = `bench_marker_E_${id}`;
  containerPsql(DB_USER_SVC, `SELECT '${b}';`);
  await fire();
  await sleep(500);
  containerPsql(DB_USER_SVC, `SELECT '${e}';`);
  const r = docker(["logs", "--since", "60s", PG_CONTAINER]);
  return countBetweenMarkers(parseLogEntries(`${r.stdout}\n${r.stderr}`), b, e, db);
}

// ---------------------------------------------------------------- report
function renderMarkdown(rep) {
  const L = [];
  L.push(`# Discovery benchmark - ${rep.meta.label}`, "");
  L.push(`Evidence label: **REAL HTTP/API** (gateway ${rep.meta.gateway}). Started ${rep.meta.startedAt}, finished ${rep.meta.finishedAt}.`);
  L.push(`Warm N=${rep.meta.warm}, concurrency=${rep.meta.concurrencies.join(",")}, BENCH_MAX_RPM=${rep.meta.maxRpm}, requests sent=${rep.meta.requestsSent}, load generator: ${rep.meta.loadGenerator}.`);
  L.push("Thresholds (plan section E): PT list p95<=300 ms, p99<=600 ms, payload<=120 KB, SQL/request<=8; gym 10 km p95<=250 ms. Other rows are INFO (no plan threshold).", "");
  L.push(`SQL-per-request: ${rep.meta.sqlMeasurement}`, "");
  if (rep.meta.warm < 100) L.push(`> Note: N=${rep.meta.warm} -> p99 equals the max sample (not a statistically meaningful p99). Re-run with --warm 100+ before certifying p99.`, "");
  for (const cRun of rep.runs) {
    L.push(`## Concurrency ${cRun.concurrency}`, "");
    L.push("| Query | cold ms | p50 | p95 | p99 | max | payload KB (avg/max) | status | 429 | 503 | SQL | verdict |");
    L.push("|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|");
    for (const r of cRun.results) {
      if (r.skipped) { L.push(`| ${r.id} | - | - | - | - | - | - | SKIPPED: ${r.skipped} | - | - | - | SKIPPED |`); continue; }
      const m = r.warm.latencyMs || {};
      const pl = r.warm.payloadKB ? `${r.warm.payloadKB.avg}/${r.warm.payloadKB.max}` : "-";
      const hist = Object.entries(r.warm.statusHistogram).map(([k, v]) => `${k}x${v}`).join(" ");
      const sql = r.sqlPerRequest == null ? "n/m" : `${r.sqlPerRequest.dataStatements} (+${r.sqlPerRequest.total - r.sqlPerRequest.dataStatements} ctl)`;
      const fails = r.verdict.checks.filter((c) => c.result !== "PASS").map((c) => `${c.name} ${c.value ?? "?"}${c.unit}>${c.limit}`).join("; ");
      L.push(`| ${r.id} | ${r.cold ? r1(r.cold.ms) : "-"} | ${m.p50 ?? "-"} | ${m.p95 ?? "-"} | ${m.p99 ?? "-"} | ${m.max ?? "-"} | ${pl} | ${hist} | ${r.warm.count429} | ${r.warm.count503} | ${sql} | ${r.verdict.overall}${fails ? ` (${fails})` : ""} |`);
    }
    L.push("");
  }
  L.push("Legend: `n/m` = SQL count not measured; `ctl` = BEGIN/COMMIT/SET control statements counted separately (the <=8 limit is applied to data statements). Cold = first request of the query in this run (not a guaranteed cold cache).");
  const lg = rep.runs.flatMap((r) => r.results).find((r) => r.id === "gym-legacy-list" && r.warm);
  if (lg) L.push("", `Legacy GET /gyms payload: avg ${lg.warm.payloadKB?.avg ?? "-"} KB, max ${lg.warm.payloadKB?.max ?? "-"} KB (reported only, no threshold).`);
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------- main
async function main() {
  const geo = loadGeo();
  let queries = buildQueries(geo);
  if (ONLY) queries = queries.filter((q) => ONLY.test(q.id));
  if (USE_SQLLOG && USE_PGSS) throw new Error("--sqllog and --pgss are mutually exclusive");
  if (SQLLOG_RESTORE_ONLY) {
    assertScaleSqlLogTarget({ container: PG_CONTAINER, dbs: [DB_USER_SVC, DB_GYM_SVC] });
    process.exitCode = sqllogRestore() ? 0 : 1;
    return;
  }

  if (DRY_RUN) {
    const total = queries.length * (WARM + 1 + (CONCURRENCIES.length - 1) * WARM) + queries.filter((q) => q.cursorFromPage1).length + 1 + (USE_SQLLOG || USE_PGSS ? queries.length : 0);
    console.log(`DRY RUN - no network. Gateway=${BASE} warm=${WARM} concurrency=${CONCURRENCIES.join(",")} maxRpm=${MAX_RPM} pgss=${USE_PGSS} sqllog=${USE_SQLLOG}`);
    if (USE_SQLLOG) {
      try {
        assertScaleSqlLogTarget({ container: PG_CONTAINER, dbs: [DB_USER_SVC, DB_GYM_SVC] });
        console.log(`sqllog plan: container=${PG_CONTAINER} userDb=${DB_USER_SVC} gymDb=${DB_GYM_SVC} (name/db guard OK; the 55440 port check runs on a real run). Per query: marker -> 1 extra request -> marker -> docker logs --since 60s; ALTER SYSTEM log_min_duration_statement=0 + log_line_prefix, ALWAYS reset in finally.`);
      } catch (e) { console.log(`sqllog plan: ${e.message}`); }
    }
    console.log(`Resolved geo: ${JSON.stringify(geo)}`);
    console.log(`${queries.length} queries:`);
    queries.forEach((q, i) => {
      const body = q.body ? ` ${JSON.stringify(q.body)}` : "";
      console.log(`${String(i + 1).padStart(2)}. [${q.kind}${q.auth ? ",auth" : ""}${q.thr ? `,thr=${q.thr}` : ",info"}] ${q.id}: ${q.method} ${q.url}${body}${q.cursorFromPage1 ? "  (+cursor from page-1 setup)" : ""}`);
    });
    const est = MAX_RPM > 0 ? ` -> >= ${Math.ceil(total / MAX_RPM)} min at ${MAX_RPM} rpm` : "";
    console.log(`Estimated requests (incl. login/setup): ~${total}${est}`);
    return;
  }

  const startedAt = new Date().toISOString();
  const needAuth = queries.some((q) => q.auth);
  let authNote = "not needed";
  if (needAuth) {
    const l = await login();
    authNote = l.ok ? "logged in once (token held in memory only)" : l.reason;
    if (!l.ok) console.warn(`[bench] WARNING: ${l.reason}; PT queries will be SKIPPED.`);
  }
  let pgss = { info: { available: false, reason: "not requested (--pgss absent)", clients: {} } };
  if (USE_PGSS) pgss = await openPgss();
  let sqllogOn = false;
  if (USE_SQLLOG) {
    await sqllogSetup();
    sqllogOn = true;
    const bail = (code) => () => { sqllogRestore(); process.exit(code); };
    process.on("SIGINT", bail(130));
    process.on("SIGTERM", bail(143));
  }

  const runs = [];
  try {
  const coldByQuery = new Map();
  const cursorByQuery = new Map();
  for (const c of CONCURRENCIES) {
    const results = [];
    for (const q of queries) {
      if (q.auth && !TOKEN) { results.push({ id: q.id, skipped: `no auth (${authNote})` }); continue; }
      let cursor;
      if (q.cursorFromPage1) {
        // One page-1 cursor per concurrency level: epochs are kept ~30 min, and a whole c=1 pass can outlive one.
        const ck = `${q.id}@c${c}`;
        if (!cursorByQuery.has(ck)) {
          const p1 = await oneRequest(q);
          let nc = null;
          try { nc = JSON.parse(Buffer.from(p1.buf).toString("utf8")).nextCursor ?? null; } catch { /* keep null */ }
          cursorByQuery.set(ck, nc);
          if (!nc) cursorByQuery.set(`${ck}:why`, `page 1 gave HTTP ${p1.status} and no nextCursor`);
        }
        cursor = cursorByQuery.get(ck);
        if (!cursor) { results.push({ id: q.id, skipped: cursorByQuery.get(`${ck}:why`) }); continue; }
      }
      let cold = coldByQuery.get(q.id) ?? null;
      if (!cold) {
        const r = await oneRequest(q, { cursor });
        cold = { status: r.status, ms: r.ms, bytes: r.bytes };
        coldByQuery.set(q.id, cold);
      }
      const { samples, wallMs } = await runPool(q, WARM, c, cursor);
      const warm = summarize(samples, wallMs);
      let sqlPerRequest = null;
      if (sqllogOn && c === CONCURRENCIES[0]) {
        try { sqlPerRequest = await sqllogMeasure(q, () => oneRequest(q, { cursor })); } catch (e) { console.warn(`[bench] sqllog measure failed for ${q.id}: ${e.message}`); }
      } else if (pgss.info.available && c === CONCURRENCIES[0]) {
        const cl = pgss.clients?.[q.kind === "pt" ? "user" : "gym"];
        if (cl) {
          try {
            const before = await pgssSnapshot(cl);
            await oneRequest(q, { cursor });
            await sleep(300); // pg_stat_statements updates at statement end; allow trailing statements
            sqlPerRequest = pgssDiff(before, await pgssSnapshot(cl));
          } catch { sqlPerRequest = null; }
        }
      }
      results.push({ id: q.id, desc: q.desc, kind: q.kind, request: { method: q.method, url: q.url, body: q.body }, cold, warm, sqlPerRequest, verdict: verdict(q, warm, sqlPerRequest?.dataStatements ?? null) });
      console.log(`[bench] c=${c} ${q.id}: p95=${warm.latencyMs?.p95 ?? "-"}ms status=${JSON.stringify(warm.statusHistogram)} -> ${results.at(-1).verdict.overall}`);
    }
    runs.push({ concurrency: c, results });
  }
  } finally {
    if (sqllogOn) sqllogRestore();
  }
  if (pgss.clients) for (const cl of Object.values(pgss.clients)) { try { await cl.end(); } catch { /* ignore */ } }

  const sqlMeasurement = sqllogOn
    ? `measured with temporary statement logging on ${PG_CONTAINER} (log_min_duration_statement=0; marker SELECTs around ONE extra sequential request per query after the warm loop, first concurrency level only; counted: statement/execute entries of the target DB between the markers; BEGIN/COMMIT/SET reported as ctl; settings RESET afterwards). Counts include any other traffic on that DB inside the window - run on a quiet stack. Per-query statement samples are in the JSON (sqlPerRequest.sample).`
    : pgss.info.available
    ? `measured with pg_stat_statements (snapshot diff around ONE extra sequential request after the warm loop, first concurrency level only; DB status: ${JSON.stringify(pgss.info.clients)}). Counts include any other traffic on that DB during the sample - run on a quiet stack. gym-service search may also call user-service (ward centroid); that is not counted on the gym DB.`
    : `NOT MEASURED - ${pgss.info.reason}${Object.keys(pgss.info.clients || {}).length ? ` ${JSON.stringify(pgss.info.clients)}` : ""}. To measure: enable pg_stat_statements (shared_preload_libraries + CREATE EXTENSION) on the target DB and re-run with --pgss and BENCH_PG_USER_URL/BENCH_PG_GYM_URL.`;
  const report = {
    meta: {
      label: LABEL, gateway: BASE, startedAt, finishedAt: new Date().toISOString(), node: process.version, warm: WARM, concurrencies: CONCURRENCIES, maxRpm: MAX_RPM,
      requestsSent, auth: authNote, loadGenerator: "node fetch + hrtime (autocannon not resolvable in workspace)", sqlMeasurement, thresholds: THRESHOLDS,
      evidenceLabel: "REAL HTTP/API", coldNote: "cold = first request of the query in this run, not a guaranteed cold cache",
    },
    runs,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const base = path.join(OUT_DIR, `discovery-bench-${LABEL}-${stamp}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${base}.md`, renderMarkdown(report));
  console.log(`[bench] wrote ${base}.json and .md`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`[bench] FATAL: ${e?.message || e}`); process.exit(1); });
}
