/**
 * V2 isolation guard (feature/ai-v2-agent, P0/P1): with AI_AGENT_V2 OFF (the default) V1 must be byte-for-byte the same
 * runtime. Statically: no V1 module imports src/agent-v2, nothing outside src/agent-v2 reads the flag, and the V2 modules
 * register no routes, workers or queues and write nothing at import time.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const V2 = path.join(SRC, "agent-v2");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "generated", "dist"].includes(e.name)) walk(p, out); }
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// M7-P1 (owner-approved governance exception, LOCAL INTEGRATION ONLY): exactly these two V1-side files may reach
// agent-v2 — the flag-gated route (dynamic import() only, after the flag check) and the composition root it loads lazily.
// M7-P3: + the Redis session store adapter (session contract types only).
const INTEGRATION_ALLOWLIST = new Set([path.join("routes", "ai-v2.routes.ts"), path.join("agent-v2-integration", "multi-agent-runtime.ts"), path.join("agent-v2-integration", "redis-session-store.ts"), path.join("agent-v2-integration", "dynamodb-session-store.ts")]);
const STATIC_V2_IMPORT = /from\s+["'][^"']*agent-v2[^"']*["']|require\(\s*["'][^"']*agent-v2/;
const ANY_V2_IMPORT = /from\s+["'][^"']*agent-v2[^"']*["']|require\(\s*["'][^"']*agent-v2|import\(\s*["'][^"']*agent-v2/;

test("no V1 module imports agent-v2 (only tests and the two allowlisted integration files may)", () => {
  const offenders = walk(SRC)
    .filter((f) => !f.startsWith(V2 + path.sep) && !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => !INTEGRATION_ALLOWLIST.has(path.relative(SRC, f)))
    .filter((f) => ANY_V2_IMPORT.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
});

test("M7-P1 integration boundary: the route reaches agent-v2 only by dynamic import(); nothing imports the composition root statically", () => {
  const route = fs.readFileSync(path.join(SRC, "routes", "ai-v2.routes.ts"), "utf8");
  assert.doesNotMatch(route, STATIC_V2_IMPORT, "ai-v2.routes.ts must not import agent-v2 statically (flag OFF loads nothing)");
  assert.match(route, /import\(\s*["']\.\.\/agent-v2\/flag["']\)/);
  assert.match(route, /import\(\s*["']\.\.\/agent-v2-integration\/multi-agent-runtime["']\)/);
  // flag gate is the FIRST handler of the route; then requireAuth, then the end-user check
  assert.match(route, /router\.post\("\/ask",\s*v2FlagGate,\s*requireAuth,\s*requireVerifiedEndUser,/);
  const staticRoot = walk(SRC)
    .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => /from\s+["'][^"']*agent-v2-integration[^"']*["']|require\(\s*["'][^"']*agent-v2-integration/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(staticRoot.map((f) => path.relative(SRC, f)), []);
  // app.ts only mounts the route module (no agent-v2 import of its own)
  const appSrc = fs.readFileSync(path.join(SRC, "app.ts"), "utf8");
  assert.doesNotMatch(appSrc, ANY_V2_IMPORT);
  assert.match(appSrc, /app\.use\("\/ai\/v2", aiV2Routes\);\s*\n\s*app\.use\("\/ai", aiRoutes\);/);
});

test("nothing outside agent-v2 reads AI_AGENT_V2", () => {
  const offenders = walk(SRC)
    .filter((f) => !f.startsWith(V2 + path.sep) && !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => fs.readFileSync(f, "utf8").includes("AI_AGENT_V2"));
  assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
});

test("agent-v2 registers no routes, workers, queues or schedulers and does no writes at import time", () => {
  for (const f of walk(V2)) {
    const src = fs.readFileSync(f, "utf8");
    for (const forbidden of [
      /express\b|Router\(|app\.(get|post|use)\(/,           // no routes
      /new Worker\(|new Queue\(|bullmq/,                     // no workers / queues
      /setInterval\(/,                                       // no schedulers
      /prisma/i,                                             // no database client
      /\b\w+\.\w+\.(create|update|upsert|delete)(Many)?\(/,  // no ORM-style writes (client.model.create(...))
      /requestService|axios|fetch\(/,                        // no own HTTP: domain access only through the V1 tools
    ]) {
      assert.doesNotMatch(src, forbidden, `${path.relative(SRC, f)} ${forbidden}`);
    }
  }
});

test("V2 WRITE contracts have no handler and the pilot policy never lists them", async () => {
  const { TRAINING_TOOL_CONTRACTS, TRAINING_AGENT_PILOT_POLICY } = await import("../agent-v2/training-tools");
  for (const c of TRAINING_TOOL_CONTRACTS.filter((x) => x.kind === "WRITE")) {
    assert.equal(c.handler, null, c.id);
    assert.ok(!TRAINING_AGENT_PILOT_POLICY.allowedTools.includes(c.id), c.id);
  }
  assert.ok(Object.isFrozen(TRAINING_AGENT_PILOT_POLICY) && Object.isFrozen(TRAINING_AGENT_PILOT_POLICY.allowedTools), "policy cannot be widened at runtime");
});
