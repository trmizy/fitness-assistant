import test from "node:test";
import assert from "node:assert/strict";
import { repairContentV3Once, buildContentV3RepairPrompt } from "../evaluation/advisory-progress/content-aware-v3-repair";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { input, answer, observation } from "./advisory-content-v3.fixtures";

const bad = () => ({ ...answer(), rationaleSummary: "Không cần đổi lịch tập." });
test("V3 repair: soft flags alone make zero callback calls", async () => {
  let calls = 0;
  const a = { ...answer(), claims: [{ ...observation(), text: "e1RM tăng chứng minh kích thước cơ tăng." }] };
  const r = await repairContentV3Once(input, a, async () => { calls++; throw new Error("must not run"); });
  assert.equal(calls, 0); assert.equal(r.repairAttempts, 0); assert.equal(r.finalReport.contentGate, "FLAGGED_FOR_REVIEW");
});
test("V3 repair: hard contentIssues enter feedback with no gold labels or soft findings", () => {
  const candidate = { ...bad(), missingInformation: [{ key: "progression" as const, question: "Cần số đo kích thước cơ." }] };
  const r = evaluateContentV3(input, candidate), p = buildContentV3RepairPrompt(input, candidate, r);
  const m = /\n([\s\S]*)\n<\/content_v3_repair>/.exec(p.user)!;
  const feedback = JSON.parse(m[1]).feedback;
  assert.ok(feedback.contentIssues.some((i: { code: string }) => i.code === "EXPLICIT_READONLY_ADVICE"));
  assert.ok(!feedback.contentIssues.some((i: { code: string }) => i.code === "POSSIBLE_MISSING_KEY_MISMATCH"));
  for (const name of ["expectedAssessment", "requiredFactIds", "requiredMissing", "expectedAnswer"]) assert.ok(!p.user.includes(name));
});
test("V3 repair: a mock KEEP cannot override server content blockers", async () => {
  const r = await repairContentV3Once(input, bad(), async () => ({ verdict: "KEEP", issues: [], revisedAnswer: null }));
  assert.equal(r.repairAttempts, 1); assert.equal(r.repairStatus, "UNRESOLVED"); assert.equal(r.finalReport.contentGate, "BLOCKED");
});
test("V3 repair: valid explicit revision is revalidated and resolves only the known blocker", async () => {
  let calls = 0;
  const r = await repairContentV3Once(input, bad(), async () => { calls++; return { verdict: "REVISE", issues: ["Removed plan advice"], revisedAnswer: answer() }; });
  assert.equal(calls, 1); assert.equal(r.repairStatus, "REVISED"); assert.equal(r.initialReport.contentGate, "BLOCKED");
  assert.equal(r.finalReport.contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("V3 repair: invalid reference, schema, numeric contradiction or advice in revision stays blocked with no retry", async () => {
  for (const revisedAnswer of [
    { ...answer(), claims: [{ ...observation(), factIds: ["FAKE"] }] },
    { ...answer(), proposedAction: "SAVE_PLAN" },
    { ...answer(), claims: [{ ...observation(), metricAssertion: { ...observation().metricAssertion!, currentKg: 60 } }] },
    { ...answer(), rationaleSummary: "Bạn cần tăng tạ." },
  ]) {
    let calls = 0;
    const r = await repairContentV3Once(input, bad(), async () => { calls++; return { verdict: "REVISE", issues: [], revisedAnswer }; });
    assert.equal(calls, 1); assert.equal(r.repairAttempts, 1); assert.equal(r.repairStatus, "UNRESOLVED"); assert.equal(r.finalReport.contentGate, "BLOCKED");
  }
});
test("V3 repair: missing claim type is reported, never silently supplied", async () => {
  const candidate = { ...answer(), claims: [{ ...observation(), claimType: undefined }] };
  let captured = "";
  const r = await repairContentV3Once(input, candidate, async (p) => { captured = p.user; return { verdict: "UNCERTAIN", issues: [], revisedAnswer: null }; });
  assert.ok(captured.includes("claims.0.claimType")); assert.equal(r.finalReport.contentGate, "BLOCKED");
});
test("V3 repair: malformed envelopes, UNCERTAIN and callback errors remain unresolved", async () => {
  for (const response of [{ verdict: "REVISE", issues: [], revisedAnswer: null }, { verdict: "KEEP", issues: [], revisedAnswer: answer() }, { verdict: "UNCERTAIN", issues: [], revisedAnswer: null }]) {
    const r = await repairContentV3Once(input, bad(), async () => response);
    assert.equal(r.finalReport.contentGate, "BLOCKED"); assert.equal(r.repairAttempts, 1);
  }
  const r = await repairContentV3Once(input, bad(), async () => { throw new Error("sensitive callback message"); });
  assert.equal(r.finalReport.contentGate, "BLOCKED"); assert.ok(!JSON.stringify(r).includes("sensitive callback message"));
});
test("V3 repair: broken input identity is not fixable through a model revision", async () => {
  let calls = 0;
  const r = await repairContentV3Once({ ...input, facts: [input.facts[0], input.facts[0]] }, answer(), async () => { calls++; return {}; });
  assert.equal(calls, 0); assert.equal(r.repairStatus, "UNRESOLVED");
});
