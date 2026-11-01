import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { devCases } from "../evaluation/ai-coach-dev/fixtures";
import { DevRequestSchema } from "../evaluation/ai-coach-dev/context";
const root = path.resolve(__dirname, "../../../../..");
const protocol = JSON.parse(fs.readFileSync(path.join(root, "data/eval/ai-coach-dev/evaluation-protocol.json"), "utf8"));
test("40 DEV cases are valid, opaque, unlabelled and explicitly not independent held-out", () => {
  const cases = devCases();
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map((c) => c.request.caseId)).size, 40);
  assert.ok(cases.every((c) => /^dev-case-\d+$/.test(c.request.caseId) && c.evaluationOnly.expectedAssessment === null && DevRequestSchema.safeParse(c.request).success));
  assert.equal(protocol.developmentInputs.independentHeldOut, false);
  assert.equal(protocol.developmentInputs.goldLabels, null);
});
test("fact-flip controls hold question constant while authoritative endpoints change", () => {
  const flipped = devCases().filter((c) => c.evaluationOnly.family.startsWith("fact-flip"));
  assert.equal(flipped.length, 3);
  assert.equal(new Set(flipped.map((c) => c.request.question)).size, 1);
  assert.deepEqual(flipped.map((c) => c.request.snapshots[0].facts[1].evidence.value.currentKg), [84, 63, 70]);
  assert.deepEqual(flipped.map((c) => c.request.snapshots[0].facts[1].evidence.value.changePct), [20, -10, 0]);
});
test("independent review and unopened split are future obligations, not fabricated dataset claims", () => {
  assert.equal(protocol.status, "PREPARED_PENDING_INDEPENDENT_REVIEW");
  assert.equal(protocol.independentSetPlan.targetCount, 65);
  assert.equal(protocol.independentSetPlan.reservedUnopenedCount, 20);
  assert.equal(protocol.independentSetPlan.minimumIndependentHeldOut, 20);
  assert.equal(protocol.independentSetPlan.heldOutPrecisionTarget, 35);
  assert.equal(protocol.independentSetPlan.reservedContentStatus, "NOT_SUPPLIED_NOT_CREATED_BY_IMPLEMENTER");
  assert.equal(protocol.independentSetPlan.reviewer, "UNASSIGNED");
  assert.equal(protocol.blindedScoring.coverage.blockedCountsAsCorrect, false);
  assert.equal(protocol.blindedScoring.telemetry.tokens, null);
});
test("source ablation, outage, injection, safety, unit and cross-user review families remain in protocol", () => {
  const families = new Set(protocol.independentSetPlan.caseFamilies);
  for (const required of ["cross-subject-rejection", "source-ablation", "fact-flip", "prompt-injection", "safety", "unit-mismatch", "same-topic-non-support", "conflicting-evidence"]) assert.ok(families.has(required));
  const conditions = new Set(devCases().map((c) => c.evaluationOnly.retrievalCondition));
  for (const condition of ["NORMAL", "NO_MATCH", "UNAVAILABLE", "SOURCE_ABLATION", "SYNTHETIC_CONFLICT_ONLY"]) assert.ok(conditions.has(condition as never));
});
