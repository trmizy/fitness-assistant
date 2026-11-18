// Process ownership for the verification stack (stack.mjs). V1 RC1 (2026-11-12): `down` used to `taskkill /T /F` every PID
// found in .tmp-stack/pids.json — including entries left over from before a reboot, whose PIDs the OS may have handed to an
// unrelated process. A PID alone is never proof of ownership here.
//
// Ownership = ALL of:
//   1. a per-start random token that `up` puts on the child's command line (`--gymini-test-stack-token=<token>`), and
//   2. the OS creation time recorded right after spawn (Win32_Process.CreationDate), and
//   3. the PID.
// A record whose PID is gone, or now belongs to a process without the token / with another creation time, is STALE: it is
// dropped from the file and NOTHING is signalled. Legacy records (bare numbers, no token) cannot be verified and are never
// killed. Orphans (e.g. the real server child of a tsx launcher whose parent already exited) are found by the token alone,
// because only processes started by this stack carry it.
//
// Pure functions only (decisions); the OS calls live in stack.mjs so tests can inject a fake process table.

export const TOKEN_FLAG = "--gymini-test-stack-token=";

export function newToken(rand = Math.random) {
  return `gts-${Date.now().toString(36)}-${Math.floor(rand() * 1e12).toString(36)}`;
}

/** Normalises an OS creation-date value to epoch ms (CIM JSON uses "/Date(1794463409835)/"). */
export function creationMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const m = /Date\((\d+)\)/.exec(String(value));
  if (m) return Number(m[1]);
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/** Reads pids.json content in either format. Legacy `{ name: pid }` entries come back flagged `legacy`. */
export function parseRecords(json) {
  const out = [];
  for (const [name, v] of Object.entries(json ?? {})) {
    if (typeof v === "number") out.push({ name, pid: v, legacy: true });
    else if (v && typeof v === "object" && typeof v.pid === "number") out.push({ name, pid: v.pid, token: v.token ?? null, createdMs: v.createdMs ?? null, legacy: !v.token });
  }
  return out;
}

const hasToken = (proc, token) => Boolean(token) && String(proc?.commandLine ?? "").includes(`${TOKEN_FLAG}${token}`);

/**
 * Decides what `down` may signal.
 * @param records parsed pid records
 * @param processes current OS process table: [{ pid, createdMs, commandLine }]
 * @returns { kill: [{name,pid,reason}], stale: [{name,pid,reason}], legacy: [{name,pid}], orphans: [{pid,token}] }
 */
export function planDown(records, processes, opts = { toleranceMs: 2000 }) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const kill = [], stale = [], legacy = [], orphans = [];
  const tokens = new Set();
  for (const r of records) {
    if (r.legacy) { legacy.push({ name: r.name, pid: r.pid }); continue; }
    tokens.add(r.token);
    const proc = byPid.get(r.pid);
    if (!proc) { stale.push({ name: r.name, pid: r.pid, reason: "process no longer exists" }); continue; }
    if (!hasToken(proc, r.token)) { stale.push({ name: r.name, pid: r.pid, reason: "PID now belongs to a process without this stack's token (PID reused / unrelated)" }); continue; }
    const created = creationMs(proc.createdMs);
    if (r.createdMs != null && created != null && Math.abs(created - r.createdMs) > opts.toleranceMs) {
      stale.push({ name: r.name, pid: r.pid, reason: "creation time differs from the recorded one" }); continue;
    }
    kill.push({ name: r.name, pid: r.pid, reason: "token + creation time match" });
  }
  const killed = new Set(kill.map((k) => k.pid));
  for (const p of processes) {
    if (killed.has(p.pid)) continue;
    for (const t of tokens) if (hasToken(p, t)) { orphans.push({ pid: p.pid, token: t }); break; }
  }
  return { kill, stale, legacy, orphans };
}

/** Record written by `up` right after a successful spawn (written incrementally, so a failed start leaves no untracked child). */
export function makeRecord(pid, token, createdMs) {
  return { pid, token, createdMs: creationMs(createdMs) };
}

// ── Queue preflight (RC1 final verification, 2026-11-12) ────────────────────────────────────────────────────────────────
// BullMQ jobs persist in the test Redis across runs. Jobs left by an earlier run (each persona onboarding / plan draft queues
// one) are resumed by the next `up` and make PAID model calls that no run asked for and no run's ledger attributes. `up`
// therefore counts every pending job (read-only EVAL) and refuses to start while any exist, or while the count cannot be read.
const QUEUE_STATES_LIST = ["wait", "active", "paused"];
const QUEUE_STATES_ZSET = ["delayed", "prioritized", "waiting-children"];
const BACKLOG_LUA = [
  "local n=0",
  ...QUEUE_STATES_LIST.map((s) => `for _,k in ipairs(redis.call('KEYS','bull:*:${s}')) do n=n+redis.call('LLEN',k) end`),
  ...QUEUE_STATES_ZSET.map((s) => `for _,k in ipairs(redis.call('KEYS','bull:*:${s}')) do n=n+redis.call('ZCARD',k) end`),
  "return n",
].join(" ");

/** RESP command: EVAL <script> 0 — read-only (KEYS / LLEN / ZCARD only). */
export function buildEval(script = BACKLOG_LUA) {
  const parts = ["EVAL", script, "0"];
  return Buffer.from(`*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join("")}`, "utf8");
}

/** Integer from a complete RESP integer reply (":N\r\n"); anything else (error, partial) → null. */
export function respInteger(buf) {
  const m = /^:(-?\d+)\r\n$/.exec(Buffer.from(buf).toString("utf8"));
  return m ? Number(m[1]) : null;
}

/** Pending BullMQ jobs in the Redis on 127.0.0.1:<port> via one read-only EVAL; null when it cannot be read. */
export async function queueBacklog(port, { timeoutMs = 3000 } = {}) {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    let buf = Buffer.alloc(0);
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(null));
    sock.on("error", () => done(null));
    sock.on("connect", () => sock.write(buildEval()));
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.includes("\r\n")) done(respInteger(buf)); });
  });
}

/** Start decision: only an empty (verified) queue starts, unless the owner explicitly allows resuming old jobs. */
export function queuePreflight(count, { allowQueuedJobs = false } = {}) {
  if (allowQueuedJobs) return { ok: true, count, override: true };
  if (count == null) return { ok: false, count, reason: "cannot read the test Redis job queue — refusing to start (queued jobs would make unattributed paid model calls)" };
  if (count > 0) return { ok: false, count, reason: `${count} queued background job(s) from earlier runs in the test Redis — the ai worker would resume them as paid model calls outside any run's ledger` };
  return { ok: true, count };
}

// ── Provider credentials & caps (RC1 incident follow-up) ─────────────────────────────────────────────────────────────
/** Credentials/keys no stack child may inherit from the launching shell when a paid provider is configured. */
export const STRIP_FROM_CHILDREN = ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SDK_LOAD_CONFIG",
  "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS", "AWS_ENDPOINT_URL", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "BEDROCK_CROSS_ACCOUNT_ROLE_ARN", "BEDROCK_CROSS_ACCOUNT_EXTERNAL_ID", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"];

/**
 * Env for a stack child that must NOT hold real provider credentials. With localBedrock, every credential source the AWS SDK
 * could use is removed (env keys, ~/.aws via AWS_SHARED_CREDENTIALS_FILE/AWS_CONFIG_FILE → non-existent files, container/web
 * identity) and replaced by fake static keys, so the only way to a paid model is the provider gate.
 */
export function buildChildEnv({ base, common, serviceEnv = {}, localBedrock, noAwsDir }) {
  const env = { ...base, ...common };
  if (localBedrock) {
    for (const k of STRIP_FROM_CHILDREN) delete env[k];
    env.AWS_SHARED_CREDENTIALS_FILE = `${noAwsDir}/no-aws-credentials`;
    env.AWS_CONFIG_FILE = `${noAwsDir}/no-aws-config`;
    env.AWS_ACCESS_KEY_ID = "gate-only-not-a-real-key";
    env.AWS_SECRET_ACCESS_KEY = "gate-only-not-a-real-secret";
  }
  const out = { ...env, ...serviceEnv };
  if (localBedrock) for (const k of ["AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_SDK_LOAD_CONFIG"]) delete out[k]; // a serviceEnv may not re-add them
  return out;
}

/** A paid-provider stack may only start with explicit, finite, positive caps — they are the owner's per-run authorisation. */
export function evalCapsPreflight({ localBedrock, maxCalls, maxUsd }) {
  if (!localBedrock) return { ok: true };
  const c = Number(maxCalls), u = Number(maxUsd);
  if (maxCalls == null || maxCalls === "" || !Number.isInteger(c) || c < 0) return { ok: false, reason: "LOCAL_BEDROCK=1 requires EVAL_MAX_PROVIDER_CALLS (integer ≥ 0, the owner-approved provider-call cap)" };
  if (maxUsd == null || maxUsd === "" || !Number.isFinite(u) || u < 0) return { ok: false, reason: "LOCAL_BEDROCK=1 requires EVAL_MAX_USD (number ≥ 0, the owner-approved budget)" };
  return { ok: true, maxCalls: c, maxUsd: u };
}
