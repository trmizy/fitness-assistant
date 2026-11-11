import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AnswerSchema, EvidencePackSchema, VerificationSchema, buildAdvisoryPrompt, checkAnswer, type Answer } from "../evaluation/advisory-progress/experiment";
import { scenarios, scoreScenario } from "../evaluation/advisory-progress/scenarios";

const pack = EvidencePackSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../data/eval/advisory-progress-dev/evidence-pack.json"), "utf8")));
const cases = scenarios(pack.sources);
function answer(): Answer {
  return { assessment: "OBSERVED_PROGRESS", observations: [{ text: "e1RM ước tính tăng từ 60 lên 66 kg.", factIds: ["F_PROGRESS"] }, { text: "Hoàn thành 10 trên 12 buổi.", factIds: ["F_ADHERENCE"] }],
    hypotheses: [], missingInformation: [], rationaleSummary: "Có thay đổi ở chỉ số sức mạnh ước tính, chưa xác định nguyên nhân hoặc thay đổi kích thước cơ.", proposedAction: null };
}

test("source pack carries original excerpts, locators and honest review authority", () => {
  assert.equal(pack.sources.length, 2);
  assert.ok(pack.sources.every((source) => source.originalExcerpt.split(/\s+/).length <= 25 && source.locator && !source.humanReviewed));
  assert.equal(EvidencePackSchema.safeParse({ ...pack, sources: [pack.sources[0], pack.sources[0]] }).success, false);
});
test("structured contract rejects persisted actions and unlabelled hypotheses", () => {
  assert.equal(AnswerSchema.safeParse(answer()).success, true);
  assert.equal(AnswerSchema.safeParse({ ...answer(), proposedAction: "SAVE_PLAN" }).success, false);
  assert.equal(AnswerSchema.safeParse({ ...answer(), hypotheses: [{ text: "Cause", evidenceIds: ["ACSM_PROGRESSIVE"], needsConfirmation: false }] }).success, false);
});
test("verifier cannot claim KEEP while replacing the answer", () => {
  assert.equal(VerificationSchema.safeParse({ verdict: "KEEP", issues: [], revisedAnswer: answer() }).success, false);
  assert.equal(VerificationSchema.safeParse({ verdict: "REVISE", issues: [], revisedAnswer: null }).success, false);
});
test("linkage checker rejects unknown IDs, invented numbers and injection canary", () => {
  const input = cases.find((scenario) => scenario.id === "strength-increasing")!.input;
  assert.deepEqual(checkAnswer(input, answer()), []);
  const forged = { ...answer(), observations: [{ text: "PWNED 999 kg", factIds: ["OTHER_USER_FACT"] }], hypotheses: [{ text: "Claim", evidenceIds: ["FAKE_SOURCE"], needsConfirmation: true as const }] };
  const issues = checkAnswer(input, forged);
  assert.ok(issues.includes("unknown_fact:OTHER_USER_FACT"));
  assert.ok(issues.includes("unknown_source:FAKE_SOURCE"));
  assert.ok(issues.includes("number_not_in_input:999"));
  assert.ok(issues.includes("injection_canary"));
});
test("no-evidence scenario can describe facts but cannot invent scientific support", () => {
  const scenario = cases.find((scenario) => scenario.id === "no-external-evidence")!;
  assert.deepEqual(checkAnswer(scenario.input, answer()), []);
  assert.ok(checkAnswer(scenario.input, { ...answer(), hypotheses: [{ text: "Claim", evidenceIds: ["ACSM_PROGRESSIVE"], needsConfirmation: true }] }).includes("hypothesis_without_sources"));
});
test("few-shot treatment changes instructions, not question or evidence", () => {
  const input = cases[0].input;
  const a = buildAdvisoryPrompt(input, "A"), b = buildAdvisoryPrompt(input, "B"), c = buildAdvisoryPrompt(input, "C");
  assert.equal(a.user, b.user); assert.equal(a.system, c.system);
  assert.notEqual(a.system, b.system);
  assert.ok(!a.system.includes("EXAMPLE_F1")); assert.ok(b.system.includes("EXAMPLE_F1"));
  assert.ok(!a.user.includes("expectedAssessment"));
});
test("counterfactual facts must change expected assessment and cannot pass by copying prior output", () => {
  const increasing = cases.find((scenario) => scenario.id === "strength-increasing")!;
  const flat = cases.find((scenario) => scenario.id === "strength-flat")!;
  assert.equal(increasing.input.question, flat.input.question);
  assert.equal(scoreScenario(increasing, answer()).assessmentMatch, true);
  assert.equal(scoreScenario(flat, answer()).assessmentMatch, false);
  assert.equal(scoreScenario(cases[0], { ...answer(), assessment: "INSUFFICIENT_DATA", missingInformation: [] }).requiredQuestionsPresent, false);
});
test("rubric requires relevant outcome facts without forcing irrelevant attendance repetition", () => {
  const scenario = cases.find((item) => item.id === "strength-increasing")!;
  const focused = { ...answer(), observations: [answer().observations[0]] };
  assert.equal(scoreScenario(scenario, focused).requiredFactsAddressed, true);
  assert.equal(scoreScenario(scenario, { ...focused, observations: [answer().observations[1]] }).requiredFactsAddressed, false);
});
