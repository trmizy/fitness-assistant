import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { answer, input, cases, observation } from "./advisory-content-v3.fixtures";

for (const text of [
  "Chưa thể xác định nguyên nhân nên bạn nên giữ nguyên lịch tập.",
  "Chưa thể kết luận nguyên nhân và bạn nên duy trì lịch tập.",
  "Chưa thể kết luận nguyên nhân, vì vậy hãy giữ nguyên lịch tập.",
]) test(`R-1 independent directive: ${text}`, () => {
  assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED");
});
for (const text of ["Chưa thể kết luận nên giữ nguyên lịch tập.", "Chưa đủ căn cứ để xác định có cần đổi lịch tập hay không."]) test(`R-1 uncertainty control: ${text}`, () => {
  assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED");
});
test("R-1 raw lexical coverage: old V2 hedge suppression cannot hide independent plan directives", () => {
  for (const text of [
    "Chưa thể kết luận nguyên nhân nên giữ nguyên lịch tập.",
    "Chưa thể xác định nguyên nhân và nên đổi lịch tập.",
    "Cannot conclude the cause and you should keep your plan.",
  ]) assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  for (const text of ["Chưa thể kết luận nên đổi lịch tập.", "Cannot conclude you should keep your plan."]) {
    assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
for (const withAssertion of [true, false]) test(`R-2 neutral question and flat metric, assertion=${withAssertion}`, () => {
  const flat = { ...cases.find((s) => s.id === "strength-flat")!.input, question: "Tôi có tiến bộ chưa?" };
  const a = answer(); a.assessmentBasis = { outcome: "UNSPECIFIED", factIds: [] };
  a.claims = [{ ...observation(), text: "Dữ liệu hiện tại đã được ghi nhận.", metricAssertion: withAssertion
    ? { factId: "F_PROGRESS", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 60, changePct: 0 } : undefined }];
  a.rationaleSummary = "Đánh giá dựa trên dữ liệu đã được cung cấp.";
  const r = evaluateContentV3(flat, a);
  assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === "ASSESSMENT_CONTRADICTS_SERVER_FACTS"));
});
for (const text of ["e1RM ước tính tăng 12 kg.", "e1RM ước tính tăng 10 kg.", "Bạn đã nâng thêm 28 kg."]) test(`R-3 known number is wrong kg delta: ${text}`, () => {
  const r = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text }] });
  assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_CONTRADICTION"));
});
test("R-4 natural estimated-strength delta is permitted", () => {
  const r = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "Sức mạnh ước tính của bạn tăng 6 kg." }] });
  assert.equal(r.contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
for (const text of ["Bạn có đo kích thước cơ hoặc sức mạnh thực tế không?", "Cần phân biệt thước đo sức mạnh với kích thước cơ.", "Tăng sức mạnh không bằng tăng kích thước cơ."]) test(`R-5 measurement limitation control: ${text}`, () => {
  const a = answer();
  if (text.endsWith("?")) a.missingInformation = [{ key: "outcome_measurement", question: text }];
  else a.claims.push({ claimType: "MEASUREMENT_LIMITATION", text, factIds: ["F_PROGRESS"], evidenceIds: [] });
  assert.ok(!evaluateContentV3(input, a).contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"));
});
for (const text of ["Khối lượng cơ đã tăng vì e1RM tăng.", "You gained muscles because your strength increased.", "Chưa thể kết luận gì về dinh dưỡng nên cơ bắp chắc chắn đã tăng vì e1RM tăng."]) test(`R-6 hypertrophy lexicon/scope: ${text}`, () => {
  const r = evaluateContentV3(input, { ...answer(), rationaleSummary: text });
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(r.contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"));
});
for (const text of ["Đừng đổi lịch tập của bạn.", "Bạn nên tiếp tục chương trình hiện tại."]) test(`R-6 direct personal recommendation: ${text}`, () => {
  assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED");
});

test("R-2 outcome controls: neutral question with another outcome stays ambiguous", () => {
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  const weight = { id: "F_WEIGHT", evidence: { ...flat.facts[0].evidence, domain: "BODY" as const, kind: "LATEST_MEASURED_WEIGHT", value: { weightKg: 70 } } };
  const a = answer(); a.assessmentBasis = { outcome: "UNSPECIFIED", factIds: ["F_PROGRESS"] };
  a.claims = [{ ...observation(), text: "e1RM ghi nhận 60 kg.", metricAssertion: { factId: "F_PROGRESS", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 60, changePct: 0 } }];
  a.rationaleSummary = "Cần đối chiếu outcome được yêu cầu trước khi kết luận.";
  const r = evaluateContentV3({ ...flat, question: "Tôi có tiến bộ chưa?", facts: [...flat.facts, weight] }, a);
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(r.contentIssues.some((i) => i.code === "AMBIGUOUS_STRENGTH_ASSESSMENT_SCOPE"));
});
test("R-2 exercise controls: references do not override a named flat exercise, generic multi-exercise remains flagged", () => {
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  const squat = { ...input.facts[1], id: "F_SQUAT", evidence: { ...input.facts[1].evidence, value: { ...input.facts[1].evidence.value, exercise: "Squat" } } };
  const a = answer(); a.claims[0].factIds = ["F_SQUAT"]; a.claims[0].metricAssertion!.factId = "F_SQUAT";
  a.assessmentBasis = { outcome: "UNSPECIFIED", factIds: ["F_SQUAT"] };
  const i = { ...flat, facts: [...flat.facts, squat] };
  const named = evaluateContentV3({ ...i, question: "Bench Press của tôi có tiến bộ chưa?" }, a);
  assert.equal(named.contentGate, "BLOCKED"); assert.ok(named.contentIssues.some((i) => i.code === "ASSESSMENT_CONTRADICTS_SERVER_FACTS"));
  assert.equal(evaluateContentV3({ ...i, question: "Tôi có tiến bộ chưa?" }, a).contentGate, "FLAGGED_FOR_REVIEW");
});
test("R-3/4 delta controls: magnitude and sign must both match the estimated metric", () => {
  for (const text of ["Sức mạnh ước tính của bạn tăng 12 kg.", "Sức mạnh ước tính của bạn giảm 6 kg.", "e1RM ước tính giảm 10 kg."]) {
    const r = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text }] });
    assert.equal(r.contentGate, "BLOCKED", text); assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_CONTRADICTION"), text);
  }
  const down = { ...input, facts: input.facts.map((f) => f.id === "F_PROGRESS" ? { ...f, evidence: { ...f.evidence, value: { ...f.evidence.value, currentKg: 54, changePct: -10 } } } : f) };
  const a = answer(); a.assessment = "INSUFFICIENT_DATA"; a.rationaleSummary = "Dữ liệu mô tả thay đổi ở chỉ số sức mạnh ước tính.";
  a.claims[0].text = "Sức mạnh ước tính của bạn giảm 6 kg."; a.claims[0].metricAssertion!.currentKg = 54; a.claims[0].metricAssertion!.changePct = -10;
  assert.equal(evaluateContentV3(down, a).contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("R-3 attribution controls: ambiguous deltas flag; exact estimate delta is not proof of actual lifted load", () => {
  const squat = { ...input.facts[1], id: "F_SQUAT", evidence: { ...input.facts[1].evidence, value: { ...input.facts[1].evidence.value, exercise: "Squat", currentKg: 70 } } };
  const ambiguous = answer(); ambiguous.claims[0].factIds = ["F_PROGRESS", "F_SQUAT"];
  ambiguous.claims[0].text = "Sức mạnh ước tính của bạn tăng 6 kg.";
  const r = evaluateContentV3({ ...input, facts: [...input.facts, squat] }, ambiguous);
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_UNVERIFIED"));
  const bare = evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "Bạn đã nâng thêm 6 kg." }] });
  assert.equal(bare.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(bare.contentIssues.some((i) => i.code === "ACTUAL_LOAD_CHANGE_NOT_ESTABLISHED_BY_E1RM"));
});
test("R-3 occurrence controls: a verified delta cannot authorize another number or another metric's delta", () => {
  const squat = { ...input.facts[1], id: "F_SQUAT", evidence: { ...input.facts[1].evidence, value: { ...input.facts[1].evidence.value, exercise: "Squat", currentKg: 70 } } };
  const wrong = answer(); wrong.claims[0].text = "e1RM ước tính Squat tăng 6 kg.";
  // New P2 scope: an exact server-known canonical exercise conflicts with the cited fact.
  const r = evaluateContentV3({ ...input, facts: [...input.facts, squat] }, wrong);
  assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_UNVERIFIED"));
  wrong.claims[0].factIds = ["F_SQUAT"]; wrong.claims[0].metricAssertion = { factId: "F_SQUAT", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 70, changePct: 10 };
  const named = evaluateContentV3({ ...input, facts: [...input.facts, squat] }, wrong);
  assert.equal(named.contentGate, "BLOCKED"); assert.ok(named.contentIssues.some((i) => i.code === "OBSERVATION_DELTA_CONTRADICTION"));
  const elsewhere = evaluateContentV3(input, { ...answer(), rationaleSummary: "Sức mạnh ước tính của bạn tăng 6 kg. Bạn đã tập 999 buổi." });
  assert.equal(elsewhere.contentGate, "BLOCKED"); assert.ok(elsewhere.contentIssues.some((i) => i.code === "NUMBER_NOT_IN_INPUT"));
});
test("R-5 true-positive controls: question path or a descriptive contrast cannot shelter a positive inference", () => {
  for (const text of ["Bạn có đo e1RM để chứng minh tăng cơ không?", "Cần phân biệt các thước đo, nhưng e1RM tăng chứng minh cơ bắp tăng."]) {
    const r = evaluateContentV3(input, { ...answer(), missingInformation: [{ key: "outcome_measurement", question: text }] });
    assert.ok(r.contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"), text);
  }
});
test("R-6 recommendation controls: reported/rejected advice and uncertainty are not direct recommendations", () => {
  for (const text of [
    'Câu trả lời cũ ghi “Đừng đổi lịch tập của bạn”, nhưng nhận định đó chưa được hỗ trợ.',
    'Câu trả lời cũ ghi “Bạn nên tiếp tục chương trình hiện tại”, nhưng lời khuyên đó không có căn cứ.',
    "Chưa đủ căn cứ để khuyên đừng đổi lịch tập của bạn.",
    "Chưa thể kết luận bạn nên tiếp tục chương trình hiện tại.",
    "Nguyên tắc chung mô tả việc tiến triển tập luyện theo mục tiêu.",
  ]) assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
});
test("R-7 policy stays conservative for normative population language", () => {
  for (const text of ["Nguyên tắc chung: nên tăng tải theo mục tiêu.", "Người tập thường nên tăng dần tải."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
