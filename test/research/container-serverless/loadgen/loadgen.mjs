#!/usr/bin/env node
// Open-loop (constant arrival rate) HTTP load generator — Node 22, no deps.
//
// Requests are issued on a fixed schedule regardless of how slowly earlier
// ones complete, so slow responses cannot throttle the offered load
// (avoids coordinated omission). Every request is written as one CSV row.
//
// Usage:
//   node loadgen.mjs --base https://... --arm lambda --workload read \
//        --profile steps --rep 1 --out results/run.csv [--max-rate 400]
//
// Profiles (see PROFILES below): smoke, steps, spike, burst.
import { createWriteStream, existsSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "true" : arr[i + 1]]);
    return acc;
  }, []),
);
const BASE = (args.base || "").replace(/\/$/, "");
const ARM = args.arm || "unknown";
const WORKLOAD = args.workload || "read";
const PROFILE = args.profile || "smoke";
const REP = Number(args.rep || 1);
const OUT = args.out || `results/${ARM}-${WORKLOAD}-${PROFILE}-r${REP}.csv`;
const MAX_RATE = Number(args["max-rate"] || 400);
const TIMEOUT_MS = Number(args.timeout || 30000); // = Lambda timeout and API GW hard limit
const MAX_IN_FLIGHT = Number(args["max-in-flight"] || 4000);
const STEP_S = Number(args["step-seconds"] || 120);
// Safety stop: abort the remaining phases if >ABORT_ERR of the requests that
// completed in the last 10 s failed (protects the shared DEV database).
const ABORT_ERR = Number(args["abort-error-rate"] || 0.5);
if (!BASE) throw new Error("--base is required");
if (existsSync(OUT)) throw new Error(`refusing to overwrite ${OUT}`);

// Node's built-in fetch keeps connections alive with an unbounded pool;
// both arms use the same client settings.

// Phases: [label, ratePerSecond, durationSeconds]
const PROFILES = {
  smoke: [["smoke", 2, 20]],
  // Stepped load: each level held long enough for p99 to settle.
  steps: [
    ["warmup", 10, 60],
    ...[10, 25, 50, 100, 200, 400, 800]
      .filter((r) => r <= MAX_RATE)
      .map((r) => [`step-${r}`, r, STEP_S]),
  ],
  // Sudden jump from low to high load and back.
  spike: [
    ["base", 10, 60],
    ["spike", Math.min(MAX_RATE, 300), 60],
    ["recover", 10, 60],
  ],
  // Cold-start probe: one simultaneous burst after an idle period.
  burst: [["burst", Number(args["burst-size"] || 50), 1]],
  // Single constant level, e.g. --rate 200 --duration 120
  custom: [[`const-${args.rate}`, Number(args.rate || 10), Number(args.duration || 60)]],
};
const phases = PROFILES[PROFILE];
if (!phases) throw new Error(`unknown profile ${PROFILE}`);

// ---- workloads -------------------------------------------------------------
// overhead: GET /equipment/me without a token -> 401 from the auth middleware,
//           before any DB or downstream call: measures the platform path only.
// read:     public catalogue reads that hit PostgreSQL (no Redis on either arm).
let exerciseIds = [];
async function loadIds() {
  const r = await fetch(`${BASE}/exercises?limit=100&page=1`);
  const body = await r.json();
  // exerciseService.listExercises -> { data: { exercises, pagination } }
  const list = body?.data?.exercises || body?.exercises || [];
  exerciseIds = list.map((e) => e.id).filter(Boolean);
  if (!exerciseIds.length) throw new Error("could not load exercise ids for the read workload");
}
const WORKLOADS = {
  overhead: [{ w: 1, name: "equipment-me-401", expect: 401, path: () => "/equipment/me" }],
  read: [
    { w: 5, name: "exercise-list", expect: 200, path: () => `/exercises?limit=20&page=${1 + Math.floor(Math.random() * 10)}` },
    { w: 3, name: "exercise-detail", expect: 200, path: () => `/exercises/${exerciseIds[Math.floor(Math.random() * exerciseIds.length)]}` },
    { w: 2, name: "filter-options", expect: 200, path: () => "/exercises/filter-options" },
  ],
};
const mix = WORKLOADS[WORKLOAD];
if (!mix) throw new Error(`unknown workload ${WORKLOAD}`);
const totalW = mix.reduce((s, m) => s + m.w, 0);
function pickEndpoint() {
  let x = Math.random() * totalW;
  for (const m of mix) if ((x -= m.w) < 0) return m;
  return mix[mix.length - 1];
}

// ---- run -------------------------------------------------------------------
const out = createWriteStream(OUT);
out.write("arm,workload,profile,rep,phase,rate,seq,endpoint,sched_ms,start_ms,end_ms,latency_ms,latency_sched_ms,status,ok,bytes,error\n");
let inFlight = 0, seq = 0, dropped = 0, aborted = null;
let winN = 0, winBad = 0;
const win = setInterval(() => {
  if (winN >= 20 && winBad / winN > ABORT_ERR && !aborted) {
    aborted = `error rate ${(winBad / winN).toFixed(2)} in last 10 s`;
    console.error(`ABORT: ${aborted}`);
  }
  winN = 0; winBad = 0;
}, 10000);

async function fire(phase, rate, schedMs) {
  const ep = pickEndpoint();
  const id = seq++;
  if (inFlight >= MAX_IN_FLIGHT) {
    dropped++;
    out.write(`${ARM},${WORKLOAD},${PROFILE},${REP},${phase},${rate},${id},${ep.name},${schedMs.toFixed(1)},,,,,0,0,0,client_overload\n`);
    return;
  }
  inFlight++;
  const start = performance.timeOrigin + performance.now();
  let status = 0, bytes = 0, err = "";
  try {
    const res = await fetch(BASE + ep.path(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    bytes = (await res.arrayBuffer()).byteLength;
  } catch (e) {
    err = (e?.name === "TimeoutError" ? "timeout" : (e?.cause?.code || e?.name || "error")).replace(/,/g, ";");
  }
  const end = performance.timeOrigin + performance.now();
  inFlight--;
  const ok = status === ep.expect ? 1 : 0;
  winN++; if (!ok) winBad++;
  out.write(`${ARM},${WORKLOAD},${PROFILE},${REP},${phase},${rate},${id},${ep.name},${schedMs.toFixed(1)},${start.toFixed(1)},${end.toFixed(1)},${(end - start).toFixed(2)},${(end - schedMs).toFixed(2)},${status},${ok},${bytes},${err}\n`);
}

async function runPhase([label, rate, seconds]) {
  const total = Math.round(rate * seconds);
  const t0 = performance.timeOrigin + performance.now() + 50;
  const pending = [];
  let sent = 0;
  console.error(`[${new Date().toISOString()}] ${ARM} ${label}: ${rate} req/s for ${seconds}s (${total} requests)`);
  while (sent < total && !aborted) {
    const now = performance.timeOrigin + performance.now();
    const due = Math.min(total, Math.floor(((now - t0) / 1000) * rate) + 1);
    while (sent < due) {
      pending.push(fire(label, rate, t0 + (sent * 1000) / rate));
      sent++;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  await Promise.all(pending);
}

if (WORKLOAD === "read") await loadIds();
const started = new Date().toISOString();
for (const ph of phases) {
  if (aborted) break;
  await runPhase(ph);
}
clearInterval(win);
await new Promise((r) => out.end(r));
console.error(JSON.stringify({ arm: ARM, workload: WORKLOAD, profile: PROFILE, rep: REP, started, finished: new Date().toISOString(), requests: seq, dropped, aborted, out: OUT }));
