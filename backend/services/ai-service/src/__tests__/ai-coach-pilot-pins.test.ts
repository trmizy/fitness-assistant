import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculatePilotPins, verifySessionPins, assertVerifiedPins, implementationRoot } from "../evaluation/bedrock-pilot/pins";
import { SessionConfigSchema } from "../evaluation/bedrock-pilot/config";
import { inferenceTarget, openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { BEDROCK_REGION } from "../services/bedrock.client";
import { pilotConfig, pilotPrompt, pilotTransport } from "./fixtures/pilot";
import { fixturePilotInput } from "./fixtures/pilot-input";

test("pins are recomputed from actual git/code/corpus/case files and prepared prompts", async () => {
  const f = fixturePilotInput(), calculated = await calculatePilotPins(f.root, f.casesFile), config = pilotConfig();
  config.sources = { workspaceRoot: f.root, casesFile: f.casesFile }; config.pins = calculated.pins;
  assert.equal(calculated.dirty, false); const receipt = await verifySessionPins(config); assert.doesNotThrow(() => assertVerifiedPins(config, receipt));
  for (const field of ["commit", "code", "corpus", "cases", "promptHashes"] as const) {
    const bad = structuredClone(config); if (field === "promptHashes") bad.pins[field] = ["f".repeat(64)]; else bad.pins[field] = "f".repeat(field === "commit" ? 40 : 64);
    await assert.rejects(() => verifySessionPins(bad), (e: unknown) => (e as { code: string }).code === "PIN_MISMATCH");
  }
  assert.throws(() => assertVerifiedPins(config, { status: "VERIFIED_FROM_FILES" }), /VERIFIED_INPUTS_REQUIRED/);
  fs.appendFileSync(f.casesFile, " "); assert.throws(() => assertVerifiedPins(config, receipt), /PIN_MISMATCH/);
});
test("file drift after verification blocks session admission; zero hashes and dirty live tree fail closed", async () => {
  const f = fixturePilotInput(), c = pilotConfig(); c.sources = { workspaceRoot: f.root, casesFile: f.casesFile }; c.pins = (await calculatePilotPins(f.root, f.casesFile)).pins;
  const receipt = await verifySessionPins(c);
  fs.appendFileSync(path.join(f.root, "backend/services/ai-service/src/fixture.ts"), "// changed\n");
  assert.throws(() => openEvaluationSession(c, path.join(f.root, "run"), pilotTransport(), { verifiedPins: receipt }), /PIN_MISMATCH/);
  for (const field of ["code", "corpus", "cases"] as const) assert.equal(SessionConfigSchema.safeParse({ ...c, pins: { ...c.pins, [field]: "0".repeat(64) } }).success, false);
  const live = pilotConfig(); live.mode = "LIVE"; live.sources = { workspaceRoot: implementationRoot, casesFile: f.casesFile };
  await assert.rejects(() => verifySessionPins(live), /WORKING_TREE_DIRTY|PIN_MISMATCH/);
});
test("CountTokens and Converse share target identity; unsupported live profiles and wrong regions reject", async () => {
  for (const profile of [null, "test-fixture-profile"]) {
    const c = pilotConfig(); c.inferenceProfile = profile; c.pricing.inferenceProfile = profile;
    const seen: unknown[] = [], base = pilotTransport();
    const folder = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gymini-target-"));
    const s = openEvaluationSession(c, path.join(folder, "run"), { kind: "FAKE", async count(input, signal) { seen.push(input.modelId); return base.count(input, signal); }, async invoke(input, signal) { seen.push(input.modelId); return base.invoke(input, signal); } });
    await s.previewTokenCounts([pilotPrompt]); await s.evaluate(pilotPrompt); await s.close();
    assert.deepEqual(seen, [profile ?? c.modelId, profile ?? c.modelId]); assert.equal(s.target.identifier, seen[0]);
  }
  const c = pilotConfig(); c.mode = "LIVE"; c.region = BEDROCK_REGION; c.inferenceProfile = "unverified-profile";
  assert.throws(() => inferenceTarget(c), /PROFILE_UNSUPPORTED/);
  c.inferenceProfile = null; c.region = "wrong-region"; assert.throws(() => inferenceTarget(c), /ClientRegionMismatch/);
  const f = fixturePilotInput(), s = openEvaluationSession(pilotConfig(), path.join(f.root, "run"), { ...pilotTransport(), async count() { throw new Error("CountTokens unsupported"); } });
  await assert.rejects(() => s.previewTokenCounts([pilotPrompt]), /TokenPreflightFailed/); assert.equal(s.state().inferenceCalls, 0); await s.close();
});
