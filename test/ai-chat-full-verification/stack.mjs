// Brings up the REAL application services (auth, user, fitness, ai(+BullMQ worker), gateway, optional web) as host processes
// against the ISOLATED test databases (postgres-test :55433, redis-test :56379). No stubs: real JWT auth, real HTTP between services.
// Ports are the real service ports +10000 (gateway :13000, auth :13001, fitness :13002, ai :13003, user :13004, ...) -
// the real dev Docker containers run on the un-offset ports on this host, and this harness cannot tell them apart
// from its own stack by a /health probe alone. Set GATEWAY_URL=http://localhost:13000 for lib.mjs/harness.mjs callers.
// Usage (repo root):
//   node test/ai-chat-full-verification/stack.mjs up [--web]     start (idempotent; logs in .tmp-stack/*.log, pids in .tmp-stack/pids.json)
//   node test/ai-chat-full-verification/stack.mjs down          stop everything it started
//   node test/ai-chat-full-verification/stack.mjs status
// Model: the configured Ollama-compatible endpoint on :11435 (SSH tunnel) unless LLM_BASE_URL is overridden.
import { spawn, spawnSync } from "node:child_process";
import { TOKEN_FLAG, buildChildEnv, creationMs, evalCapsPreflight, makeRecord, newToken, parseRecords, planDown, queueBacklog, queuePreflight } from "./stack-process.mjs";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, ".tmp-stack");
const pidFile = path.join(dir, "pids.json");
const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
export const SECRET = "test_internal_service_secret_32_chars_minimum";
const JWT = "test_jwt_secret_for_ai_chat_verification_only_32+chars";
const LLM = process.env.LLM_BASE_URL || "http://127.0.0.1:11435";
const MODEL = process.env.LLM_MODEL || "qwen3:30b-a3b-instruct-2507-q4_K_M";
// Phase 3 R2 (N/A item, infra safety) — offset by +10000 from the real
// service ports. The un-offset ports (3000-3004) are the actual dev Docker
// containers on this host; this harness's own "already up" health probe
// can't distinguish them from its own host-process stack, and briefly got a
// real 500 from the DEV gateway before this was caught (no data was written
// - verified against the dev DB). Never reuse 3000-3007 here again.
const PORT_OFFSET = Number(process.env.VERIFICATION_STACK_PORT_OFFSET ?? 10000);
const p = (n) => n + PORT_OFFSET;
const REDIS_PORT = Number(process.env.VERIFICATION_REDIS_PORT ?? 56379);
const common = {
  NODE_ENV: "development", TZ: "Asia/Ho_Chi_Minh", JWT_SECRET: JWT, INTERNAL_SERVICE_SECRET: SECRET, INTERNAL_API_SECRET: SECRET,
  // VERIFICATION_REDIS_PORT (RC1 incident follow-up): point a run at its OWN fresh Redis (option A in the incident report)
  // instead of the shared test Redis, so jobs left by earlier runs or DB tests can never be consumed. The ai-service reads only
  // REDIS_HOST/REDIS_PORT (no DB index / queue prefix), so a separate instance is the only isolation that needs no runtime change.
  REDIS_HOST: "localhost", REDIS_PORT: String(REDIS_PORT), REDIS_URL: `redis://localhost:${REDIS_PORT}`,
  AUTH_SERVICE_URL: `http://localhost:${p(3001)}`, USER_SERVICE_URL: `http://localhost:${p(3004)}`, FITNESS_SERVICE_URL: `http://localhost:${p(3002)}`,
  AI_SERVICE_URL: `http://localhost:${p(3003)}`, CHAT_SERVICE_URL: `http://localhost:${p(3005)}`, GYM_SERVICE_URL: `http://localhost:${p(3006)}`, PAYMENT_SERVICE_URL: `http://localhost:${p(3007)}`,
  REQUIRE_CONTRACT_ESIGN: "false", CORS_ORIGIN: "http://localhost:5173",
};
// LOCAL_BEDROCK=1 (opt-in, default off): the ai service uses Nova Pro for chat and Cohere for embeddings through the AWS CLI
// profile (default `divuzha`; nothing secret is set here — the SDK reads the profile), with vectors in a SEPARATE Qdrant on
// :6334 (1024 dims) so the 768-dim nomic collections on :6333 are never touched. Set it up with scripts/dev/local-bedrock.ps1.
//
// Provider gate (RC1 incident follow-up, provider-gate.mjs): with LOCAL_BEDROCK=1 the ai-service NEVER gets real AWS
// credentials. Its Bedrock Runtime client is pointed at the gate (AWS_ENDPOINT_URL_BEDROCK_RUNTIME) with fake credentials;
// the gate alone reads the AWS profile, reserves every HTTP attempt before the network and refuses past the caps.
// EVAL_MAX_PROVIDER_CALLS and EVAL_MAX_USD are REQUIRED (no default): the caps are the owner's per-run authorisation.
const LOCAL_BEDROCK = process.env.LOCAL_BEDROCK === "1";
const GATE_PORT = p(3090);
const bedrockEnv = LOCAL_BEDROCK ? {
  LLM_PROVIDER: "bedrock", BEDROCK_CHAT_MODEL: process.env.BEDROCK_CHAT_MODEL || "apac.amazon.nova-pro-v1:0",
  BEDROCK_REGION: "ap-southeast-1", AWS_REGION: "ap-southeast-1",
  AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${GATE_PORT}`,
  AWS_ACCESS_KEY_ID: "gate-only-not-a-real-key", AWS_SECRET_ACCESS_KEY: "gate-only-not-a-real-secret",
  EMBEDDING_PROVIDER: "bedrock", BEDROCK_EMBEDDING_MODEL: "cohere.embed-multilingual-v3", KNOWLEDGE_VECTOR_SIZE: "1024", EMBEDDING_DIMENSIONS: "1024",
  QDRANT_PORT: "6340", LLM_TIMEOUT_MS: "90000",
} : {};
const EVAL_CAPS = { maxCalls: process.env.EVAL_MAX_PROVIDER_CALLS, maxUsd: process.env.EVAL_MAX_USD };
// The gate is the only child that sees the real AWS profile; every other child gets buildChildEnv (credentials stripped).
const gateService = { name: "provider-gate", cwd: ".", port: GATE_PORT,
  cmd: ["test/ai-chat-full-verification/provider-gate.mjs", "--port", String(GATE_PORT), "--max-calls", String(EVAL_CAPS.maxCalls), "--max-usd", String(EVAL_CAPS.maxUsd),
    "--ledger", path.join(dir, "provider-gate.jsonl"), "--region", "ap-southeast-1", "--ai-service-dir", "backend/services/ai-service"],
  realCredentials: true, env: { AWS_PROFILE: process.env.AWS_PROFILE || "divuzha", AWS_SDK_LOAD_CONFIG: "1" } };
const services = [
  { name: "auth", cwd: "backend/services/auth-service", port: p(3001), env: { PORT: String(p(3001)), DATABASE_URL: `${PG}/gymcoach_auth_test?schema=public`, AUTH_DATABASE_URL: `${PG}/gymcoach_auth_test?schema=public`, JWT_ACCESS_EXPIRY: "3h", JWT_REFRESH_EXPIRY: "7d" } },
  { name: "user", cwd: "backend/services/user-service", port: p(3004), env: { PORT: String(p(3004)), DATABASE_URL: `${PG}/gymcoach_user_test?schema=public`, USER_DATABASE_URL: `${PG}/gymcoach_user_test?schema=public` } },
  { name: "fitness", cwd: "backend/services/fitness-service", port: p(3002), env: { PORT: String(p(3002)), DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public`, FITNESS_DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public` } },
  { name: "ai", cwd: "backend/services/ai-service", port: p(3003), env: {
    PORT: String(p(3003)), DATABASE_URL: `${PG}/gymcoach_ai_test?schema=public`, AI_DATABASE_URL: `${PG}/gymcoach_ai_test?schema=public`, QDRANT_HOST: "localhost", QDRANT_PORT: "6333",
    LLM_PROVIDER: process.env.LLM_PROVIDER_OVERRIDE || "ollama", LLM_MODEL: MODEL, LLM_BASE_URL: LLM, OLLAMA_BASE_URL: LLM, EMBEDDING_PROVIDER: "ollama", EMBEDDING_MODEL: "nomic-embed-text", EMBEDDING_DIMENSIONS: "768",
    LLM_TIMEOUT_MS: "170000", EMBEDDING_TIMEOUT_MS: "120000", LLM_NUM_CTX: "8192", LLM_JSON_NUM_CTX: "8192", ENABLE_TOOL_CALLING: "false",
    AI_ASK_RATE_LIMIT_MAX: "1000", AI_EXPENSIVE_RATE_LIMIT_MAX: "1000", ...bedrockEnv } },
  { name: "gateway", cwd: "backend/gateway", port: p(3000), env: { PORT: String(p(3000)), NODE_PATH: path.join(root, ".tmp-stack/deps/node_modules"), AI_ASK_RATE_LIMIT_MAX_REQUESTS: "1000", AUTH_RATE_LIMIT_MAX_REQUESTS: "1000" /* isolated :13000 gateway only: each eval run registers 6 personas, which exhausted the 20/15min default; the default and AWS are unchanged */, PARTNER_APPLICATION_START_RATE_MAX: "1000", PARTNER_APPLICATION_RATE_MAX: "1000" } },
];
if (LOCAL_BEDROCK) services.unshift(gateService); // first: nothing may reach a provider before the gate is up
if (process.argv.includes("--web")) services.push({ name: "web", cwd: "frontend/web", port: 15173, cmd: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "15173"], env: { VITE_API_URL: `http://localhost:${p(3000)}` } });

// A corrupt pids.json means "no verifiable records" — never a reason to crash mid-down or to guess.
const readPids = () => {
  if (!fs.existsSync(pidFile)) return {};
  try { return JSON.parse(fs.readFileSync(pidFile, "utf8")); } catch { console.log("pids.json is not valid JSON — treated as no records (nothing signalled)"); return {}; }
};
const alive = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return r.status < 500; } catch { return false; } };
const cmd = process.argv[2] || "status";

// Process ownership (stack-process.mjs, V1 RC1 2026-11-12): a PID is never killed just because it is in pids.json.
/** Current node.exe processes with OS creation time + command line (Windows CIM). Empty on failure → nothing is killed. */
function osProcesses() {
  const ps = spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
  try {
    const raw = JSON.parse(ps.stdout || "[]");
    return (Array.isArray(raw) ? raw : [raw]).map((p) => ({ pid: p.ProcessId, createdMs: creationMs(p.CreationDate), commandLine: p.CommandLine ?? "" }));
  } catch { return []; }
}
const ownedNow = () => planDown(parseRecords(readPids()), osProcesses());

if (cmd === "up") {
  // Queue preflight (RC1 2026-11-12): never let the worker resume old jobs as paid, unattributed model calls.
  const pre = queuePreflight(await queueBacklog(REDIS_PORT), { allowQueuedJobs: process.argv.includes("--allow-queued-jobs") });
  if (!pre.ok) {
    console.log(`REFUSED: ${pre.reason}. Nothing was started. Clear the TEST queue (owner decision) or pass --allow-queued-jobs.`);
    process.exit(2);
  }
  console.log(`queue preflight (redis :${REDIS_PORT}): ${pre.count} pending job(s)${pre.override ? " — resumed by explicit --allow-queued-jobs" : ""}`);
  const caps = evalCapsPreflight({ localBedrock: LOCAL_BEDROCK, ...EVAL_CAPS });
  if (!caps.ok) { console.log(`REFUSED: ${caps.reason}. Nothing was started.`); process.exit(2); }
  if (LOCAL_BEDROCK) console.log(`provider gate: :${GATE_PORT}, cap ${caps.maxCalls} provider calls / ${caps.maxUsd} for this stack's whole lifetime`);
  fs.mkdirSync(dir, { recursive: true });
  // Keep only records still verified as ours; stale / legacy ones are dropped (never merged blindly into the new file).
  const prev = ownedNow();
  for (const s of [...prev.stale, ...prev.legacy]) console.log(`${s.name}: dropping unverifiable/stale pid record ${s.pid}${s.reason ? ` (${s.reason})` : ""} — not signalled`);
  const kept = readPids();
  const pids = Object.fromEntries(prev.kill.map((k) => [k.name, kept[k.name]]));
  fs.writeFileSync(pidFile, JSON.stringify(pids));
  for (const s of services) {
    if (await alive(s.port) && s.name !== "web") { console.log(`${s.name}: already up on ${s.port}${pids[s.name] ? "" : " (NOT started by this stack — left alone)"}`); continue; }
    const out = fs.openSync(path.join(dir, `${s.name}.log`), "a");
    const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
    const token = newToken();
    const args = [...(s.cmd ? s.cmd : [tsx, "src/server.ts"]), `${TOKEN_FLAG}${token}`];
    const child = spawn(process.execPath, args, { cwd: path.join(root, s.cwd), env: s.realCredentials ? { ...process.env, ...s.env } : buildChildEnv({ base: process.env, common, serviceEnv: s.env, localBedrock: LOCAL_BEDROCK, noAwsDir: dir }), stdio: ["ignore", out, out], detached: true, windowsHide: true });
    child.unref();
    const createdMs = osProcesses().find((p) => p.pid === child.pid)?.createdMs ?? null;
    pids[s.name] = makeRecord(child.pid, token, createdMs);
    fs.writeFileSync(pidFile, JSON.stringify(pids)); // incremental: a start that fails half-way leaves no untracked child
    console.log(`${s.name}: started pid ${child.pid} -> :${s.port}`);
  }
  for (const s of services) {
    let ok = false;
    for (let i = 0; i < 60 && !ok; i += 1) { ok = await alive(s.port); if (!ok) await new Promise((r) => setTimeout(r, 2000)); }
    console.log(`${s.name}: ${ok ? "HEALTHY" : "NOT HEALTHY (see .tmp-stack/" + s.name + ".log)"}`);
  }
} else if (cmd === "down") {
  const plan = ownedNow();
  for (const k of plan.kill) { spawnSync("taskkill", ["/PID", String(k.pid), "/T", "/F"], { stdio: "ignore" }); console.log(`${k.name}: stopped ${k.pid} (${k.reason})`); }
  for (const o of plan.orphans) { spawnSync("taskkill", ["/PID", String(o.pid), "/F"], { stdio: "ignore" }); console.log(`orphan: stopped ${o.pid} (carries this stack's token)`); }
  for (const s of plan.stale) console.log(`${s.name}: NOT signalled pid ${s.pid} — ${s.reason}`);
  for (const l of plan.legacy) console.log(`${l.name}: NOT signalled pid ${l.pid} — legacy record without ownership token; check it manually if still needed`);
  fs.rmSync(pidFile, { force: true });
} else {
  for (const s of services) console.log(`${s.name}: ${(await alive(s.port)) ? "UP" : "DOWN"} :${s.port}`);
}
