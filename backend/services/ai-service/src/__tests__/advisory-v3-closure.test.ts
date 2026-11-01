import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { answer, observation, input } from "./advisory-content-v3.fixtures";

test("closure R-A: percent/kg changes are checked semantically against endpoints", () => {
  for (const text of ["e1RM ước tính tăng 12%.", "e1RM cao hơn trước 12 kg.", "e1RM chênh lệch 28 kg."]) {
    const r = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text }] });
    assert.equal(r.contentGate, "BLOCKED", text); assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_CONTRADICTION"));
  }
  for (const text of ["e1RM ước tính tăng 10%.", "e1RM cao hơn trước 6 kg."]) assert.notEqual(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text }] }).contentGate, "BLOCKED");
});
test("closure R-A: structured delta is checked independently of prose grammar", () => {
  const a = { ...answer(), claims: [{ ...observation(), text: "Chênh lệch được khai báo trong trường có cấu trúc.", deltaAssertion: { factId: "F_PROGRESS", unit: "PERCENT", change: 28 } }] };
  assert.equal(evaluateContentV3(input, a).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3(input, { ...a, claims: [{ ...a.claims[0], deltaAssertion: { ...a.claims[0].deltaAssertion, change: 10 } }] }).contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("closure R-B: non-strength question keywords cannot silently bypass assessment", () => {
  for (const question of ["Tôi tiến bộ về dinh dưỡng chưa?", "Cân nặng và tiến bộ của tôi thế nào?", "Calo hiện tại có cho thấy tiến bộ không?"]) {
    const r = evaluateContentV3({ ...input, question }, answer());
    assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW", question); assert.ok(r.contentIssues.some((i) => i.code === "ASSESSMENT_OUTCOME_AMBIGUITY"));
  }
});
test("closure R-C: accented measurement verb is not a causal connector", () => {
  for (const text of ["Bạn đã đo sức mạnh và kích thước cơ chưa?", "Chưa đo sức mạnh nên chưa đủ dữ liệu để kết luận."]) {
    const r = evaluateContentV3(input, { ...answer(), missingInformation: [{ key: "outcome_measurement", question: text }] });
    assert.ok(!r.contentIssues.some((i) => i.code === "POSSIBLE_PERSONAL_CAUSAL_ATTRIBUTION"), text);
  }
  assert.ok(evaluateContentV3(input, { ...answer(), rationaleSummary: "Sức mạnh tăng do tải tập tăng." }).contentIssues.some((i) => i.code === "POSSIBLE_PERSONAL_CAUSAL_ATTRIBUTION"));
});
test("closure R-D: explicit personal prescriptions cover sets, frequency and food", () => {
  for (const text of ["Bạn nên tăng số hiệp.", "Hãy tập thêm 4 buổi mỗi tuần.", "Bạn cần ăn thêm protein.", "You should reduce your calories."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
  for (const text of ["Chưa đủ căn cứ để khuyên bạn nên tăng số hiệp.", 'Câu trả lời cũ ghi “Bạn cần ăn thêm protein”, nhưng chưa được hỗ trợ.']) assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: "Có thể cần tăng số hiệp." }).contentGate, "FLAGGED_FOR_REVIEW");
});
test("closure R-A: undefined percent and ambiguous references do not become contradictions", () => {
  const zero = { ...input, facts: input.facts.map((f) => f.id === "F_PROGRESS" ? { ...f, evidence: { ...f.evidence, value: { ...f.evidence.value, baselineKg: 0 } } } : f) };
  const r = evaluateContentV3(zero, { ...answer(), claims: [{ ...observation(), metricAssertion: undefined, text: "e1RM tăng 12%." }] });
  assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_UNVERIFIED"));
  assert.ok(!r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_CONTRADICTION"));
});
