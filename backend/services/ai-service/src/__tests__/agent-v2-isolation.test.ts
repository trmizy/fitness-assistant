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

test("no V1 module imports agent-v2 (only tests may)", () => {
  const offenders = walk(SRC)
    .filter((f) => !f.startsWith(V2) && !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => /from\s+["'][^"']*agent-v2[^"']*["']|require\(\s*["'][^"']*agent-v2/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
});

test("nothing outside agent-v2 reads AI_AGENT_V2", () => {
  const offenders = walk(SRC)
    .filter((f) => !f.startsWith(V2) && !f.includes(`${path.sep}__tests__${path.sep}`))
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
