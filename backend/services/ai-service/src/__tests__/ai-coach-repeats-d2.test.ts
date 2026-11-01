import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { attemptIdentity } from "../evaluation/bedrock-pilot/design";
import { approvedConfigurationHash } from "../evaluation/bedrock-pilot/config";
import { openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { pilotConfig, pilotTransport } from "./fixtures/pilot";
import { devCases } from "../evaluation/ai-coach-dev/fixtures";
async function setup() {
  const a = fixturePilotInput(), b = fixturePilotInput(devCases()[1].request, "case-pilot-second");
  const x = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), y = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) x[key].push(...y[key]); fs.writeFileSync(a.casesFile, JSON.stringify(x));
  const config = pilotConfig(); config.sources = { workspaceRoot: a.root, casesFile: a.casesFile }; config.design = { repeats: 3, arms: ["FLAT_LAYOUT", "LAYERED"], policies: ["MINIMAL"] };
  config.pins = (await calculatePilotPins(a.root, a.casesFile, config.design)).pins;
  return { ...a, config };
}
test("D2 attempt identity is deterministic, repeat/config scoped, and rejects invalid repeat indices", () => {
  const base = { caseKey: "case-test", arm: "LAYERED", policy: "MINIMAL", repeatIndex: 0, configHash: "a".repeat(64), promptHash: "b".repeat(64) };
  assert.equal(attemptIdentity(base), attemptIdentity(base)); assert.notEqual(attemptIdentity(base), attemptIdentity({ ...base, repeatIndex: 1 })); assert.notEqual(attemptIdentity(base), attemptIdentity({ ...base, configHash: "c".repeat(64) }));
  for (const repeatIndex of [-1, 0.5, 50, NaN]) assert.throws(() => attemptIdentity({ ...base, repeatIndex }));
});
test("D2 two cases by two arms by three repeats survive partial completion/resume without duplicates", async () => {
  const f = await setup(), directory = path.join(f.root, "run"), base = pilotTransport(); let calls = 0, evaluated = 0;
  const transport = { ...base, async invoke(...args: Parameters<typeof base.invoke>) { calls++; assert.ok(!JSON.stringify(args[0]).includes("repeatIndex")); return base.invoke(...args); } };
  await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport, onStage(stage) { if (stage === "EVALUATED" && ++evaluated === 3) throw new Error("PARTIAL_FIXTURE_STOP"); } }), /PARTIAL_FIXTURE_STOP/);
  assert.equal(calls, 3);
  const summary = await runControlledPilot({ config: f.config, directory, transport, resume: true }); assert.equal(calls, 12); assert.equal(summary.denominators.inferenceAttempts, 12);
  const rows = fs.readdirSync(directory).filter((n) => n.startsWith("answer-")).map((n) => JSON.parse(fs.readFileSync(path.join(directory, n), "utf8")));
  assert.equal(rows.length, 12); assert.equal(new Set(rows.map((r) => r.attemptKey)).size, 12); assert.deepEqual([...new Set(rows.map((r) => r.repeatIndex))].sort(), [0, 1, 2]);
  assert.ok(rows.every((r) => r.configHash === approvedConfigurationHash(f.config)));
  await runControlledPilot({ config: f.config, directory, transport, resume: true }); assert.equal(calls, 12);
  const changed = structuredClone(f.config); changed.design!.policies = ["MINIMAL", "FULL"]; changed.pins = (await calculatePilotPins(f.root, f.casesFile, changed.design)).pins;
  assert.equal(changed.pins.promptHashes.length, 24);
  await assert.rejects(() => runControlledPilot({ config: changed, directory, transport, resume: true }), /BINDING_MISMATCH/);
});
test("D2 preflight rejects insufficient repeat budget and duplicate reserved identity cannot invoke again", async () => {
  const f = await setup(), small = structuredClone(f.config); small.budget.maxCalls = 11;
  await assert.rejects(() => runControlledPilot({ config: small, directory: path.join(f.root, "too-small"), transport: pilotTransport() }), /PREVIEW_EXCEEDS_BUDGET/);
  const calc = await calculatePilotPins(f.root, f.casesFile, f.config.design), row = calc.preparation.rows[0], c = structuredClone(f.config); c.budget.maxCalls = 2;
  const s = openEvaluationSession(c, path.join(f.root, "limited"), pilotTransport());
  const key = (repeatIndex: number) => attemptIdentity({ caseKey: row.caseKey, arm: row.arm, policy: row.policy, repeatIndex, configHash: approvedConfigurationHash(c), promptHash: row.promptHash });
  await s.evaluate(row.prompt, key(0)); await assert.rejects(() => s.evaluate(row.prompt, key(0)), /ALREADY_RESERVED/); await s.evaluate(row.prompt, key(1)); await assert.rejects(() => s.evaluate(row.prompt, key(2)), /BudgetStopped/); await s.close();
  const resumed = openEvaluationSession(c, path.join(f.root, "limited"), pilotTransport(), { resume: true }); assert.equal(resumed.state().inferenceCalls, 2); await assert.rejects(() => resumed.evaluate(row.prompt, key(2)), /BudgetStopped/); await resumed.close();
  const bad = structuredClone(f.config); bad.pins.promptHashes[0] = "e".repeat(64); await assert.rejects(() => runControlledPilot({ config: bad, directory: path.join(f.root, "bad") }), /PIN_MISMATCH/);
});
test("D2 process crash retains repeat reservation and lock instead of giving a restarted run fresh budget", async () => {
  const f = await setup(), directory = path.join(f.root, "run"), args = path.join(f.root, "crash-args.json"); fs.writeFileSync(args, JSON.stringify({ config: f.config, directory }));
  const crashed = spawnSync(process.execPath, ["--import", "tsx", path.join(__dirname, "fixtures/pilot-repeat-child.ts"), args], { encoding: "utf8", timeout: 30000 }); assert.equal(crashed.status, 76, crashed.stderr);
  const ledgerFile = fs.readdirSync(path.join(f.root, "fixture-ledger")).find((p) => p.endsWith(".jsonl"))!;
  const records = openJournal(path.join(f.root, "fixture-ledger", ledgerFile)).records as { state: { inferenceCalls: number; attemptKeys: string[] } }[];
  assert.equal(records.at(-1)!.state.inferenceCalls, 1); assert.equal(records.at(-1)!.state.attemptKeys.length, 1);
  await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport: pilotTransport(), resume: true }), /LOCK_UNAVAILABLE/);
});
