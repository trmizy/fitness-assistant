// node --test test/ai-chat-full-verification/stack-process.test.mjs — pure decisions over a FAKE process table; nothing is
// spawned or signalled. Oracle: hand-written ownership expectations.
import test from "node:test";
import assert from "node:assert/strict";
import { planDown, parseRecords, makeRecord, creationMs, TOKEN_FLAG } from "./stack-process.mjs";

const T = "gts-abc-123";
const ours = (pid, created, extra = "") => ({ pid, createdMs: `/Date(${created})/`, commandLine: `node tsx/dist/cli.mjs src/server.ts ${TOKEN_FLAG}${T}${extra}` });
const rec = (name, pid, created) => [name, makeRecord(pid, T, created)];

test("valid test-stack process (PID + token + creation time match) is the only thing killed", () => {
  const records = parseRecords(Object.fromEntries([rec("ai", 100, 1_000_000)]));
  const plan = planDown(records, [ours(100, 1_000_000), { pid: 200, createdMs: 5, commandLine: "C:\\Windows\\explorer.exe" }]);
  assert.deepEqual(plan.kill.map((k) => k.pid), [100]);
  assert.deepEqual(plan.orphans, []);
});

test("PID that has exited → stale record, nothing signalled", () => {
  const plan = planDown(parseRecords(Object.fromEntries([rec("ai", 100, 1_000_000)])), []);
  assert.deepEqual(plan.kill, []);
  assert.equal(plan.stale[0].reason, "process no longer exists");
});

test("PID reused by the OS for an unrelated process (no token) → never killed", () => {
  const plan = planDown(parseRecords(Object.fromEntries([rec("web", 26948, 1_000_000)])), [{ pid: 26948, createdMs: "/Date(9000000)/", commandLine: "C:\\Program Files\\Some\\editor.exe" }]);
  assert.deepEqual(plan.kill, []);
  assert.match(plan.stale[0].reason, /without this stack's token/);
});

test("same PID carrying the token but a different creation time → stale (defence in depth), not killed", () => {
  const plan = planDown(parseRecords(Object.fromEntries([rec("ai", 100, 1_000_000)])), [ours(100, 1_000_000 + 60_000)]);
  assert.deepEqual(plan.kill, []);
  assert.match(plan.stale[0].reason, /creation time/);
});

test("legacy pids.json ({ name: pid }) cannot be verified → reported, never killed", () => {
  const records = parseRecords({ auth: 28524, web: 26948 });
  const plan = planDown(records, [{ pid: 28524, createdMs: 1, commandLine: "anything" }]);
  assert.deepEqual(plan.kill, []);
  assert.deepEqual(plan.legacy.map((l) => l.name), ["auth", "web"]);
});

test("start failed half-way: only the recorded, verified children are killed; an orphaned server child with the token is found", () => {
  // up spawned auth (recorded) then crashed before recording user; auth's tsx launcher exited but its server child lives on
  const records = parseRecords(Object.fromEntries([rec("auth", 300, 2_000_000)]));
  const plan = planDown(records, [ours(301, 2_000_500, " (server child)"), { pid: 400, createdMs: 1, commandLine: "node gateway-of-someone-else.js" }]);
  assert.deepEqual(plan.kill, []);
  assert.equal(plan.stale[0].pid, 300);
  assert.deepEqual(plan.orphans.map((o) => o.pid), [301], "the token identifies our orphan; the unrelated node process is untouched");
});

test("down twice in a row: the second call has no records and signals nothing", () => {
  const first = planDown(parseRecords(Object.fromEntries([rec("ai", 100, 1_000_000)])), [ours(100, 1_000_000)]);
  assert.equal(first.kill.length, 1);
  const second = planDown(parseRecords({}), [ours(100, 1_000_000)]);
  assert.deepEqual(second, { kill: [], stale: [], legacy: [], orphans: [] }, "without records there is no token, so nothing is ours to kill");
});

test("creation-date parsing accepts CIM JSON, ISO and epoch", () => {
  assert.equal(creationMs("/Date(1794463409835)/"), 1794463409835);
  assert.equal(creationMs(1794463409835), 1794463409835);
  assert.equal(creationMs("2026-11-12T06:00:00.000Z"), Date.parse("2026-11-12T06:00:00.000Z"));
  assert.equal(creationMs(null), null);
});

// RC1 final verification (2026-11-12, BACKEND INTEGRATION read-only): the test Redis still held 49 waiting + 1 active
// BullMQ ai-tasks jobs from earlier runs; every `up` let the worker resume them (paid Nova calls the run's ledger never
// attributed — one ran before the runner started, one was cut off by `down`). `up` must refuse while that backlog exists.
test("RC1 repro: up refuses to start while queued model jobs from earlier runs exist; unknown state also refuses", async () => {
  const { respInteger, queuePreflight, buildEval } = await import("./stack-process.mjs");
  assert.equal(respInteger(Buffer.from(":50\r\n")), 50);
  assert.equal(respInteger(Buffer.from(":0\r\n")), 0);
  assert.equal(respInteger(Buffer.from("-NOSCRIPT x\r\n")), null);
  assert.equal(respInteger(Buffer.from(":5")), null, "incomplete reply is not a count");
  assert.deepEqual(queuePreflight(0), { ok: true, count: 0 });
  const busy = queuePreflight(50);
  assert.equal(busy.ok, false);
  assert.match(busy.reason, /50 queued/);
  assert.equal(queuePreflight(null).ok, false, "cannot verify → refuse (fail closed)");
  assert.equal(queuePreflight(50, { allowQueuedJobs: true }).ok, true, "explicit owner override");
  const cmd = buildEval().toString("utf8");
  assert.match(cmd, /^\*3\r\n\$4\r\nEVAL\r\n/);
  for (const k of ["wait", "active", "paused", "delayed", "prioritized", "waiting-children"]) assert.ok(cmd.includes(`:${k}`), k);
  assert.doesNotMatch(cmd, /\b(DEL|FLUSHALL|FLUSHDB|UNLINK|LREM|ZREM|SET|EXPIRE)\b/i, "read-only");
});

test("RC1 incident: with a paid provider, no stack child inherits real credentials — only fake keys and no ~/.aws", async () => {
  const { buildChildEnv, STRIP_FROM_CHILDREN } = await import("./stack-process.mjs");
  const base = { PATH: "x", AWS_PROFILE: "divuzha", AWS_ACCESS_KEY_ID: "AKIAREAL", AWS_SECRET_ACCESS_KEY: "real", AWS_SESSION_TOKEN: "tok", ANTHROPIC_API_KEY: "sk-real", BEDROCK_CROSS_ACCOUNT_ROLE_ARN: "arn:x" };
  const env = buildChildEnv({ base, common: { REDIS_PORT: "56380" }, serviceEnv: { PORT: "13003", AWS_PROFILE: "sneaky" }, localBedrock: true, noAwsDir: "/tmp/none" });
  for (const k of ["AWS_PROFILE", "AWS_SESSION_TOKEN", "ANTHROPIC_API_KEY", "BEDROCK_CROSS_ACCOUNT_ROLE_ARN"]) assert.equal(env[k], undefined, k);
  assert.equal(env.AWS_ACCESS_KEY_ID, "gate-only-not-a-real-key");
  assert.match(env.AWS_SHARED_CREDENTIALS_FILE, /no-aws-credentials$/);
  assert.equal(env.PATH, "x"); assert.equal(env.REDIS_PORT, "56380"); assert.equal(env.PORT, "13003");
  assert.ok(STRIP_FROM_CHILDREN.includes("AWS_CONTAINER_CREDENTIALS_FULL_URI"));
  const local = buildChildEnv({ base, common: {}, serviceEnv: {}, localBedrock: false, noAwsDir: "/tmp/none" });
  assert.equal(local.AWS_PROFILE, "divuzha", "without a paid provider nothing is changed");
});

test("RC1 incident: a paid-provider stack refuses to start without explicit owner caps", async () => {
  const { evalCapsPreflight } = await import("./stack-process.mjs");
  assert.equal(evalCapsPreflight({ localBedrock: false }).ok, true);
  assert.equal(evalCapsPreflight({ localBedrock: true }).ok, false);
  assert.equal(evalCapsPreflight({ localBedrock: true, maxCalls: "40" }).ok, false, "USD cap also required");
  assert.equal(evalCapsPreflight({ localBedrock: true, maxCalls: "40.5", maxUsd: "0.2" }).ok, false);
  assert.equal(evalCapsPreflight({ localBedrock: true, maxCalls: "abc", maxUsd: "0.2" }).ok, false);
  assert.deepEqual(evalCapsPreflight({ localBedrock: true, maxCalls: "40", maxUsd: "0.20" }), { ok: true, maxCalls: 40, maxUsd: 0.2 });
});
