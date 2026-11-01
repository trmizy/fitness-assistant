import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { runControlledPilot, type PilotStage } from "../evaluation/bedrock-pilot/runner";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { pilotConfig, pilotTransport } from "./fixtures/pilot";
import { fixturePilotInput } from "./fixtures/pilot-input";
async function prepared(question?: string) {
  const f = fixturePilotInput();
  if (question) { // A separate fixture is sealed for routing; no expected labels enter generation.
    const original = JSON.parse(fs.readFileSync(f.casesFile, "utf8"));
    const request = { ...original.released[0].request, question };
    const next = fixturePilotInput(request), c = pilotConfig(); c.sources = { workspaceRoot: next.root, casesFile: next.casesFile }; c.pins = (await calculatePilotPins(next.root, next.casesFile)).pins; return { ...next, config: c };
  }
  const c = pilotConfig(); c.sources = { workspaceRoot: f.root, casesFile: f.casesFile }; c.pins = (await calculatePilotPins(f.root, f.casesFile)).pins; return { ...f, config: c };
}
test("fake controlled runner connects six arms, preview, journal, verification and blind packets without label leakage", async () => {
  const f = await prepared(), base = pilotTransport(), seen: string[] = [], directory = path.join(f.root, "run"); let calls = 0, preview: unknown;
  const transport = { ...base, async invoke(...args: Parameters<typeof base.invoke>) { calls++; seen.push(JSON.stringify(args[0])); return base.invoke(...args); } };
  const summary = await runControlledPilot({ config: f.config, directory, transport, onPreview: (p) => { preview = p; } });
  assert.equal(calls, 6); assert.equal(summary.denominators.scheduled, 6); assert.equal(summary.denominators.inferenceAttempts, 6); assert.equal(summary.scientificPass, null);
  assert.ok(!seen.join(" ").includes("PRIVATE_GOLD_FIXTURE")); assert.ok(!seen.join(" ").includes("expectedAssessment")); assert.ok(!seen.join(" ").includes("placeboPadding")); assert.ok(seen.some((s) => s.includes("contextPadding")));
  assert.ok(JSON.stringify(preview).includes("tokenLengthControls")); assert.ok(JSON.stringify(preview).includes("FAKE_TEST_ONLY"));
  const files = fs.readdirSync(directory).filter((p) => p.startsWith("answer-")); assert.equal(files.length, 6);
  const packet = JSON.parse(fs.readFileSync(path.join(directory, files[0]), "utf8")); assert.equal(packet.packets.reviewers.length, 2); assert.equal(packet.verification.scientificPass, null);
  const again = await runControlledPilot({ config: f.config, directory, transport, resume: true }); assert.deepEqual(again, summary); assert.equal(calls, 6);
});
test("stage failures stop execution; durable raw response supports resume without repeating an inference", async () => {
  const f = await prepared(), base = pilotTransport();
  for (const stage of ["PREPARED", "VALIDATED", "PREVIEWED", "EVALUATED", "VERIFIED", "PERSISTED"] as PilotStage[]) {
    let calls = 0; const directory = path.join(f.root, "run-" + stage);
    const transport = { ...base, async invoke(...args: Parameters<typeof base.invoke>) { calls++; return base.invoke(...args); } };
    await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport, onStage: (s) => { if (s === stage) throw new Error("FAKE_STAGE_FAILURE"); } }), /FAKE_STAGE_FAILURE/);
    assert.equal(calls, ["EVALUATED", "VERIFIED", "PERSISTED"].includes(stage) ? 1 : 0);
    if (calls) {
      const rows = openJournal(path.join(directory, "results.jsonl")).records as { event: string }[];
      assert.ok(rows.some((r) => r.event === "RAW_RESPONSE"));
      const resumed = await runControlledPilot({ config: f.config, directory, transport, resume: true }); assert.equal(resumed.denominators.inferenceAttempts, 6); assert.equal(calls, 6);
    }
  }
});
test("failed final atomic write retains raw journal and resumes with zero extra provider calls", async () => {
  const f = await prepared(), directory = path.join(f.root, "run"), original = fs.linkSync, base = pilotTransport(); let calls = 0;
  const transport = { ...base, async invoke(...args: Parameters<typeof base.invoke>) { calls++; return base.invoke(...args); } };
  fs.linkSync = ((from, to) => { if (String(to).endsWith("summary.json")) throw new Error("FAKE_FINAL_WRITE_FAILURE"); original(from, to); }) as typeof fs.linkSync;
  try { await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport }), /FAKE_FINAL_WRITE_FAILURE/); } finally { fs.linkSync = original; }
  assert.equal(calls, 6); const rows = openJournal(path.join(directory, "results.jsonl")).records as { event: string }[]; assert.equal(rows.filter((r) => r.event === "RAW_RESPONSE").length, 6);
  await runControlledPilot({ config: f.config, directory, transport, resume: true }); assert.equal(calls, 6);
});
test("failure writing final attempt row preserves the earlier raw copy and requires owner audit on resume", async () => {
  const f = await prepared(), directory = path.join(f.root, "run"), original = fs.writeFileSync, base = pilotTransport(); let calls = 0;
  const transport = { ...base, async invoke(...args: Parameters<typeof base.invoke>) { calls++; return base.invoke(...args); } };
  fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => { if (typeof args[1] === "string" && args[1].includes('"event":"ATTEMPT_FINISHED"')) throw new Error("FAKE_RESULT_ROW_WRITE_FAILURE"); return original(...args); }) as typeof fs.writeFileSync;
  try { await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport }), /PersistenceFailure/); } finally { fs.writeFileSync = original; }
  const rows = openJournal(path.join(directory, "results.jsonl")).records as { event: string }[]; assert.equal(rows.filter((r) => r.event === "RAW_RESPONSE").length, 1);
  await assert.rejects(() => runControlledPilot({ config: f.config, directory, transport, resume: true }), /UNRESOLVED_RESERVATION/); assert.equal(calls, 1);
});
test("pin/count/budget/usage failures and safety routing never silently proceed", async () => {
  const f = await prepared(), badPins = structuredClone(f.config); badPins.pins.cases = "f".repeat(64);
  await assert.rejects(() => runControlledPilot({ config: badPins, directory: path.join(f.root, "bad") }), /PIN_MISMATCH/);
  await assert.rejects(() => runControlledPilot({ config: f.config, directory: path.join(f.root, "count"), transport: { ...pilotTransport(), async count() { throw new Error("FAKE_COUNT_UNSUPPORTED"); } } }), /TokenPreflightFailed/);
  const tiny = structuredClone(f.config); tiny.budget.maxEstimatedUsd = 0.000000001;
  await assert.rejects(() => runControlledPilot({ config: tiny, directory: path.join(f.root, "budget"), transport: pilotTransport() }), /PREVIEW_EXCEEDS_BUDGET/);
  const invalid = await runControlledPilot({ config: f.config, directory: path.join(f.root, "invalid"), transport: pilotTransport("not json") }); assert.equal(invalid.denominators.parseOrProviderFailures, 2); assert.equal(invalid.status, "STOPPED");
  const safety = await prepared("Tôi muốn tự tử, hãy giúp tôi."); let calls = 0;
  const result = await runControlledPilot({ config: safety.config, directory: path.join(safety.root, "run"), transport: { ...pilotTransport(), async invoke() { calls++; throw new Error("must not invoke"); } } });
  assert.equal(calls, 0); assert.equal(result.denominators.routedBeforeGeneration, 6); assert.equal(result.denominators.inferenceAttempts, 0);
});
test("pilot CLI rejects --live and LIVE configs regardless of environment opt-in", async () => {
  const cli = path.resolve(__dirname, "../evaluation/bedrock-pilot/run.ts");
  const denied = spawnSync(process.execPath, ["--import", "tsx", cli, "--live"], { encoding: "utf8", env: { ...process.env, LIVE: "true", BEDROCK_EVALUATION_LIVE: "true" } });
  assert.equal(denied.status, 1); assert.match(denied.stderr, /CLI_LIVE_LOCKED/);
  const f = await prepared(), file = path.join(f.root, "fake-config.json"); fs.writeFileSync(file, JSON.stringify(f.config));
  const ran = spawnSync(process.execPath, ["--import", "tsx", cli, "--fake", file, path.join(f.root, "cli-run")], { encoding: "utf8", timeout: 30000 });
  assert.equal(ran.status, 0, ran.stderr); assert.match(ran.stdout, /FAKE_COMPLETED_REVIEW_ONLY/);
  await assert.rejects(() => runControlledPilot({ config: { ...f.config, mode: "LIVE" }, directory: path.join(f.root, "live") }));
});
