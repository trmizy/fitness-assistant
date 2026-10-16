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
const common = {
  NODE_ENV: "development", TZ: "Asia/Ho_Chi_Minh", JWT_SECRET: JWT, INTERNAL_SERVICE_SECRET: SECRET, INTERNAL_API_SECRET: SECRET,
  REDIS_HOST: "localhost", REDIS_PORT: "56379", REDIS_URL: "redis://localhost:56379",
  AUTH_SERVICE_URL: `http://localhost:${p(3001)}`, USER_SERVICE_URL: `http://localhost:${p(3004)}`, FITNESS_SERVICE_URL: `http://localhost:${p(3002)}`,
  AI_SERVICE_URL: `http://localhost:${p(3003)}`, CHAT_SERVICE_URL: `http://localhost:${p(3005)}`, GYM_SERVICE_URL: `http://localhost:${p(3006)}`, PAYMENT_SERVICE_URL: `http://localhost:${p(3007)}`,
  REQUIRE_CONTRACT_ESIGN: "false", CORS_ORIGIN: "http://localhost:5173",
};
const services = [
  { name: "auth", cwd: "backend/services/auth-service", port: p(3001), env: { PORT: String(p(3001)), DATABASE_URL: `${PG}/gymcoach_auth_test?schema=public`, AUTH_DATABASE_URL: `${PG}/gymcoach_auth_test?schema=public`, JWT_ACCESS_EXPIRY: "3h", JWT_REFRESH_EXPIRY: "7d" } },
  { name: "user", cwd: "backend/services/user-service", port: p(3004), env: { PORT: String(p(3004)), DATABASE_URL: `${PG}/gymcoach_user_test?schema=public`, USER_DATABASE_URL: `${PG}/gymcoach_user_test?schema=public` } },
  { name: "fitness", cwd: "backend/services/fitness-service", port: p(3002), env: { PORT: String(p(3002)), DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public`, FITNESS_DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public` } },
  { name: "ai", cwd: "backend/services/ai-service", port: p(3003), env: {
    PORT: String(p(3003)), DATABASE_URL: `${PG}/gymcoach_ai_test?schema=public`, AI_DATABASE_URL: `${PG}/gymcoach_ai_test?schema=public`, QDRANT_HOST: "localhost", QDRANT_PORT: "6333",
    LLM_PROVIDER: "ollama", LLM_MODEL: MODEL, LLM_BASE_URL: LLM, OLLAMA_BASE_URL: LLM, EMBEDDING_PROVIDER: "ollama", EMBEDDING_MODEL: "nomic-embed-text", EMBEDDING_DIMENSIONS: "768",
    LLM_TIMEOUT_MS: "170000", EMBEDDING_TIMEOUT_MS: "120000", LLM_NUM_CTX: "8192", LLM_JSON_NUM_CTX: "8192", ENABLE_TOOL_CALLING: "false",
    AI_ASK_RATE_LIMIT_MAX: "1000", AI_EXPENSIVE_RATE_LIMIT_MAX: "1000" } },
  { name: "gateway", cwd: "backend/gateway", port: p(3000), env: { PORT: String(p(3000)), NODE_PATH: path.join(root, ".tmp-stack/deps/node_modules"), AI_ASK_RATE_LIMIT_MAX_REQUESTS: "1000", PARTNER_APPLICATION_START_RATE_MAX: "1000", PARTNER_APPLICATION_RATE_MAX: "1000" } },
];
if (process.argv.includes("--web")) services.push({ name: "web", cwd: "frontend/web", port: 15173, cmd: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "15173"], env: { VITE_API_URL: `http://localhost:${p(3000)}` } });

const readPids = () => (fs.existsSync(pidFile) ? JSON.parse(fs.readFileSync(pidFile, "utf8")) : {});
const alive = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return r.status < 500; } catch { return false; } };
const cmd = process.argv[2] || "status";

if (cmd === "up") {
  fs.mkdirSync(dir, { recursive: true });
  const pids = readPids();
  for (const s of services) {
    if (await alive(s.port) && s.name !== "web") { console.log(`${s.name}: already up on ${s.port}`); continue; }
    const out = fs.openSync(path.join(dir, `${s.name}.log`), "a");
    const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
    const args = s.cmd ? s.cmd : [tsx, "src/server.ts"];
    const child = spawn(process.execPath, args, { cwd: path.join(root, s.cwd), env: { ...process.env, ...common, ...s.env }, stdio: ["ignore", out, out], detached: true, windowsHide: true });
    child.unref();
    pids[s.name] = child.pid;
    console.log(`${s.name}: started pid ${child.pid} -> :${s.port}`);
  }
  fs.writeFileSync(pidFile, JSON.stringify(pids));
  for (const s of services) {
    let ok = false;
    for (let i = 0; i < 60 && !ok; i += 1) { ok = await alive(s.port); if (!ok) await new Promise((r) => setTimeout(r, 2000)); }
    console.log(`${s.name}: ${ok ? "HEALTHY" : "NOT HEALTHY (see .tmp-stack/" + s.name + ".log)"}`);
  }
} else if (cmd === "down") {
  const pids = readPids();
  for (const [name, pid] of Object.entries(pids)) { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); console.log(`${name}: stopped ${pid}`); }
  fs.rmSync(pidFile, { force: true });
} else {
  for (const s of services) console.log(`${s.name}: ${(await alive(s.port)) ? "UP" : "DOWN"} :${s.port}`);
}
