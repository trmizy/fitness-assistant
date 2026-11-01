import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentV3, reviewLegacyV2 } from "../evaluation/advisory-progress/content-aware-v3";
import { AnswerV3Schema, ClaimTypeSchema } from "../evaluation/advisory-progress/content-aware-v3-schema";
import { buildContentV3Prompt } from "../evaluation/advisory-progress/content-aware-v3-repair";
import { input, answer, observation, hypothesis, cases } from "./advisory-content-v3.fixtures";

test("V3: original rationale advice is BLOCKED despite explicit null action", () => {
  const a = { ...answer(), rationaleSummary: "Dữ liệu cho thấy sức mạnh ước tính tăng, không cần đổi lịch." };
  assert.equal(a.proposedAction, null);
  const r = evaluateContentV3(input, a);
  assert.equal(r.contentGate, "BLOCKED");
  assert.ok(r.contentIssues.some((i) => i.path === "rationaleSummary" && i.severity === "HARD"));
});
test("V3: source and needsConfirmation do not authorize load advice in a hypothesis", () => {
  const r = evaluateContentV3(input, { ...answer(), claims: [hypothesis("Bạn cần tăng tạ để tiến bộ.")] });
  assert.equal(r.contentGate, "BLOCKED");
});
test("V3: narrow recommendation paraphrases (fixtures, not exhaustive language coverage)", () => {
  for (const text of ["Bạn nên duy trì lịch hiện tại.", "Cứ tiếp tục giữ nguyên kế hoạch.", "Hay nang muc ta.", "Nên giảm tải tập.", "You should increase your load.", "Keep your current routine.", "No need to change your plan."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
test("V3: insufficient basis, genuine questions and explicitly reported quotes are not hard-blocked", () => {
  for (const text of ["Chưa đủ căn cứ kết luận có cần đổi lịch.", "Chưa đủ căn cứ để nói không cần đổi lịch.", "Chưa thể kết luận nên giữ nguyên lịch tập.", 'Câu trả lời cũ ghi “không cần đổi lịch”.', "Bạn có đang giữ nguyên lịch tập không?"]) {
    assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
test("V3: uncertainty or quotation elsewhere cannot excuse a separate directive", () => {
  for (const text of ["Chưa thể kết luận; hãy tăng tạ.", "Chưa đủ căn cứ để kết luận, nhưng không cần đổi lịch.", 'Trích dẫn “không cần đổi lịch”. Bạn nên tăng tạ.']) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
test("V3: every prose surface including confirmation questions is screened", () => {
  const probes = [
    { ...answer(), claims: [{ ...observation(), text: "Hãy đổi lịch tập." }] },
    { ...answer(), claims: [{ ...hypothesis(), missingToConfirm: [{ key: "other" as const, question: "Bạn cần tăng tạ." }] }] },
    { ...answer(), missingInformation: [{ key: "other" as const, question: "Hãy giữ nguyên chương trình." }] },
  ];
  for (const a of probes) assert.equal(evaluateContentV3(input, a).contentGate, "BLOCKED");
});
test("V3: missing/invalid declared types and V2-shaped output cannot be accepted as V3", () => {
  for (const claimType of [undefined, "CAUSAL_FACT"]) assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), claimType }] }).contentGate, "BLOCKED");
  assert.equal(AnswerV3Schema.safeParse({ ...answer(), observations: [] }).success, false);
  assert.equal(ClaimTypeSchema.options.length, 5);
});
test("V3: personal recommendation is representable but forbidden even if text is benign", () => {
  const a = { ...answer(), claims: [{ claimType: "PERSONAL_RECOMMENDATION" as const, text: "Xem dữ liệu quan sát.", factIds: [], evidenceIds: [] }] };
  assert.equal(AnswerV3Schema.safeParse(a).success, true);
  assert.ok(evaluateContentV3(input, a).contentIssues.some((i) => i.code === "PERSONAL_RECOMMENDATION_FORBIDDEN"));
});
test("V3: non-null action and undeclared mutation fields are blocked", () => {
  for (const a of [{ ...answer(), proposedAction: "SAVE_PLAN" }, { ...answer(), toolCall: { name: "SAVE_PLAN" } }]) assert.equal(evaluateContentV3(input, a).contentGate, "BLOCKED");
});
test("V3: wrong fact/source namespaces are distinct from nonexistent IDs", () => {
  const probes = [
    { claim: { ...observation(), factIds: ["ACSM_PROGRESSIVE"] }, code: "WRONG_REFERENCE_NAMESPACE" },
    { claim: { ...hypothesis(), evidenceIds: ["F_PROGRESS"] }, code: "WRONG_REFERENCE_NAMESPACE" },
    { claim: { ...observation(), factIds: ["F_NONEXISTENT"] }, code: "UNKNOWN_REFERENCE" },
    { claim: { ...hypothesis(), evidenceIds: ["FAKE_SOURCE"] }, code: "UNKNOWN_REFERENCE" },
  ];
  for (const p of probes) {
    const r = evaluateContentV3(input, { ...answer(), claims: [p.claim] });
    assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === p.code));
  }
});
test("V3: duplicates/collisions in input and duplicate output references are rejected", () => {
  assert.equal(evaluateContentV3({ ...input, facts: [input.facts[0], input.facts[0]] }, answer()).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3({ ...input, sources: [{ ...input.sources[0], id: "F_PROGRESS" }] }, answer()).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), factIds: ["F_PROGRESS", "F_PROGRESS"] }] }).contentGate, "BLOCKED");
});
test("V3: deterministic numeric contradiction uses the cited fact, not number occurrence elsewhere", () => {
  const a = answer(); a.claims[0].metricAssertion!.currentKg = 60; // Exists in input, wrong current value.
  const r = evaluateContentV3(input, a);
  assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === "FACT_VALUE_CONTRADICTION"));
});
test("V3: structured direct 1RM assertion contradicts estimated fact; prose is only a review signal", () => {
  const a = answer(); a.claims[0].metricAssertion!.measurement = "DIRECT_1RM";
  assert.equal(evaluateContentV3(input, a).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "1RM đo trực tiếp tăng từ 60 lên 66 kg.", metricAssertion: undefined }] }).contentGate, "FLAGGED_FOR_REVIEW");
});
test("V3: structured assessment cannot contradict its estimated-strength basis", () => {
  assert.equal(evaluateContentV3(input, { ...answer(), assessment: "NO_OBSERVED_CHANGE" }).contentGate, "BLOCKED");
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  assert.ok(evaluateContentV3(flat, answer()).contentIssues.some((i) => i.code === "ASSESSMENT_CONTRADICTS_SERVER_FACTS"));
});
test("V3 heuristic: increasing e1RM does not establish hypertrophy; declared type is not trusted", () => {
  const r = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "e1RM tăng chứng minh kích thước cơ tăng." }] });
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW");
  assert.ok(r.contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"));
});
test("V3 heuristic: flat e1RM does not establish unchanged muscle size", () => {
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  const a = answer(); a.assessment = "NO_OBSERVED_CHANGE"; a.claims = [{ ...observation(), metricAssertion: undefined, text: "Kích thước cơ không thay đổi vì e1RM giữ nguyên." }];
  assert.equal(evaluateContentV3(flat, a).contentGate, "FLAGGED_FOR_REVIEW");
});
test("V3: population principles and measurement limitations are not forced into hypotheses", () => {
  const a = answer(); a.claims.push({ claimType: "GENERAL_PRINCIPLE", text: "Tài liệu mô tả tiến triển tập kháng lực theo mục tiêu.", factIds: [], evidenceIds: ["ACSM_PROGRESSIVE"] },
    { claimType: "MEASUREMENT_LIMITATION", text: "Chưa có số đo kích thước cơ; không thể kết luận thay đổi kích thước cơ.", factIds: ["F_PROGRESS"], evidenceIds: [] });
  assert.equal(AnswerV3Schema.safeParse(a).success, true);
  assert.equal(evaluateContentV3(input, a).contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("V3: personal causal hypothesis requires confirmation, facts, sources and missing information", () => {
  for (const change of [{ needsConfirmation: undefined }, { needsConfirmation: false }, { factIds: [] }, { evidenceIds: [] }, { missingToConfirm: [] }]) {
    assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...hypothesis(), ...change }] }).contentGate, "BLOCKED");
  }
  const a = { ...answer(), claims: [{ ...hypothesis(), missingToConfirm: [{ key: "goal" as const, question: "Mục tiêu của bạn là gì?" }] }] };
  assert.ok(evaluateContentV3(input, a).contentIssues.some((i) => i.code === "POSSIBLE_MISSING_CAUSAL_INFORMATION"));
});
test("V3 heuristic: principle labelled text that explains personal cause needs review", () => {
  const a = { ...answer(), claims: [observation(), { claimType: "GENERAL_PRINCIPLE" as const, text: "Sức mạnh của bạn tăng do tăng tải tập.", factIds: [], evidenceIds: ["ACSM_PROGRESSIVE"] }] };
  const r = evaluateContentV3(input, a);
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(r.contentIssues.some((i) => i.code === "DECLARED_TYPE_TEXT_MISMATCH"));
});
test("V3 heuristic: missing key mismatch and non-question are soft findings", () => {
  const r = evaluateContentV3(input, { ...answer(), missingInformation: [{ key: "progression", question: "Cần đo kích thước cơ." }] });
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW");
  assert.ok(r.contentIssues.some((i) => i.code === "POSSIBLE_MISSING_KEY_MISMATCH"));
  assert.ok(r.contentIssues.some((i) => i.code === "QUESTION_NOT_CLEARLY_INTERROGATIVE"));
});
test("V3: absent external sources retain observations, prohibit invented source-based claims", () => {
  const i = { ...input, sources: [] };
  assert.equal(evaluateContentV3(i, answer()).contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
  assert.equal(evaluateContentV3(i, { ...answer(), claims: [hypothesis()] }).contentGate, "BLOCKED");
});
test("V3: prompt identifies roles and references without V2 gold rules or hidden CoT request", () => {
  const p = buildContentV3Prompt(input);
  assert.ok(p.system.includes("MEASUREMENT_LIMITATION")); assert.ok(p.system.includes("ALLOWED_FACT_IDS="));
  assert.ok(!p.system.includes("Nếu câu hỏi về sức mạnh"));
  assert.ok(!p.user.includes("expectedAssessment")); assert.ok(!p.user.includes("requiredMissing"));
});
test("V3: content gate remains independent of V2 contractPass and does not mutate legacy output", () => {
  const legacy = { finalCandidate: { assessment: "OBSERVED_PROGRESS", observations: [{ text: "e1RM tăng.", factIds: ["F_PROGRESS"] }], hypotheses: [], missingInformation: [], rationaleSummary: "Không cần đổi lịch tập.", proposedAction: null }, contractPass: true };
  const before = JSON.stringify(legacy), r = reviewLegacyV2(input, legacy);
  assert.equal(r.originalContractPass, true); assert.equal(r.contentGate, "BLOCKED");
  assert.equal(JSON.stringify(legacy), before); assert.ok(!("contentPass" in r));
});
test("V3 known limitation: an unrecognized paraphrase is not a content approval", () => {
  const r = evaluateContentV3(input, { ...answer(), rationaleSummary: "Phương án hiện tại xứng đáng được tiếp tục." });
  assert.equal(r.contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
  assert.match(r.limitation, /cannot prove/);
});
test("V3 known limitation: a real source ID with arbitrary unsupported prose is not automatically entailed", () => {
  const a = { ...answer(), claims: [observation(), { claimType: "GENERAL_PRINCIPLE" as const, text: "Tài liệu này xác nhận mọi chương trình đều tối ưu.", factIds: [], evidenceIds: ["ACSM_PROGRESSIVE"] }] };
  const r = evaluateContentV3(input, a);
  assert.equal(r.contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
  assert.match(r.limitation, /cannot prove claim-to-evidence entailment/);
});
