import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentV3 } from "../evaluation/advisory-progress/content-aware-v3";
import { input, answer, observation, cases, hypothesis, readDev } from "./advisory-content-v3.fixtures";
import { repairContentV3Once } from "../evaluation/advisory-progress/content-aware-v3-repair";
import { prepareSourceAblations, AblationModelSourceSchema } from "../evaluation/advisory-progress/source-ablation-v3";
import { loadFrozenV2 } from "../evaluation/advisory-progress/frozen-v2-integrity";
import { pack, repoRoot } from "./advisory-content-v3.fixtures";

test("review P1-1: general wording and decorative quotes cannot soften personal advice", () => {
  for (const text of ["Nói chung, không cần đổi lịch tập.", "Nguyên tắc chung: không cần đổi lịch tập của bạn.", "Bạn nên “giữ nguyên lịch tập” vì sức mạnh đang tăng."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
test("review P1-2: a hedge after the directive cannot cancel the directive", () => {
  for (const text of ["Bạn nên duy trì lịch tập, dù chưa thể kết luận nguyên nhân.", "Hãy nâng mức tạ vì chưa thể kết luận gì khác."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
});
test("review P1-3: free-text unsupported numbers, URL and omitted observations are blocked", () => {
  for (const text of ["Bạn đã nâng thêm 80 kg trong 4 tuần.", "Xem thêm tại https://example.com/..."]) {
    assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  }
  assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "e1RM tăng từ 60 lên 90 kg.", metricAssertion: undefined }] }).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3(input, { ...answer(), claims: [] }).contentGate, "BLOCKED");
});
test("review P1-4: omitted/model-declared metadata cannot bypass server facts", () => {
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  assert.equal(evaluateContentV3(flat, { ...answer(), assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] },
    claims: [{ ...observation(), text: "e1RM tăng rõ rệt.", metricAssertion: undefined }] }).contentGate, "BLOCKED");
  assert.equal(evaluateContentV3(input, { ...answer(), claims: [{ ...observation(), text: "e1RM giảm từ 66 xuống 60 kg.", metricAssertion: undefined }] }).contentGate, "BLOCKED");
});
test("review P1-1/2 controls: local reporting, genuine uncertainty and unrelated clauses", () => {
  for (const text of [
    'Câu trả lời cũ ghi rằng “không cần đổi lịch tập”, nhưng nhận định đó chưa được dữ liệu hỗ trợ.',
    "Chưa đủ căn cứ để kết luận có cần duy trì lịch tập hay không.",
    "Chưa thể xác định người dùng có nên tăng tải tập.",
    "Chưa thể kết luận nên giữ nguyên lịch tập.",
  ]) assert.notEqual(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
  for (const text of [
    'Câu trả lời cũ ghi “chưa rõ”. Bạn nên “giữ nguyên lịch tập”.',
    '“Không cần đổi lịch tập”.',
    'Câu trả lời cũ ghi “không cần đổi lịch tập”, nhưng bạn nên tăng tạ.',
    "Chưa thể xác định nguyên nhân, nhưng hãy nâng mức tạ.",
  ]) assert.equal(evaluateContentV3(input, { ...answer(), rationaleSummary: text }).contentGate, "BLOCKED", text);
});
test("review P1-3: numeric and URL rule IDs are separate; all prose fields are checked", () => {
  const a = answer(); a.claims[0].text = "Bạn đã nâng thêm 80 kg trong 4 tuần.";
  a.missingInformation = [{ key: "other", question: "Đã tập 999 buổi chưa?" }];
  a.rationaleSummary = "Xem thêm https://example.com/fabricated";
  const r = evaluateContentV3(input, a);
  assert.ok(r.contentIssues.some((i) => i.code === "NUMBER_NOT_IN_INPUT" && i.path === "claims.0.text"));
  assert.ok(r.contentIssues.some((i) => i.code === "NUMBER_NOT_IN_INPUT" && i.path === "missingInformation.0.question"));
  assert.ok(r.contentIssues.some((i) => i.code === "UNMAPPED_URL"));
  assert.ok(evaluateContentV3(input, { ...answer(), claims: [] }).contentIssues.some((i) => i.code === "FACTS_NOT_ADDRESSED"));
});
test("review P1-3: input/source numbers and exact source URLs stay allowed", () => {
  const a = { ...answer(), rationaleSummary: `Nghiên cứu năm 2017 và dữ liệu 28 ngày: ${input.sources[1].url}` };
  assert.notEqual(evaluateContentV3(input, a).contentGate, "BLOCKED");
});
test("review P1-3 arithmetic: proven equation, unresolved derivation and false equation differ", () => {
  const i = { ...input, sources: [] };
  const proof = evaluateContentV3(i, { ...answer(), rationaleSummary: "Chênh lệch tính từ dữ liệu: 66 - 60 = 6 kg." });
  assert.notEqual(proof.contentGate, "BLOCKED");
  assert.ok(proof.contentIssues.some((i) => i.code === "DERIVED_NUMBER_ATTRIBUTION_REQUIRES_REVIEW"));
  const unknown = evaluateContentV3(i, { ...answer(), rationaleSummary: "Phép tính cần đối chiếu: 123 + 456 = 579." });
  assert.equal(unknown.contentGate, "FLAGGED_FOR_REVIEW");
  assert.ok(unknown.contentIssues.some((i) => i.code === "NUMERIC_DERIVATION_UNVERIFIED"));
  const wrong = evaluateContentV3(i, { ...answer(), rationaleSummary: "Phép tính kết quả: 66 - 60 = 80 kg." });
  assert.equal(wrong.contentGate, "BLOCKED");
  assert.ok(wrong.contentIssues.some((i) => i.code === "NUMERIC_DERIVATION_CONTRADICTION"));
  const delta = evaluateContentV3(i, { ...answer(), rationaleSummary: "e1RM ước tính tăng thêm 6 kg." });
  assert.notEqual(delta.contentGate, "BLOCKED");
  const laundering = evaluateContentV3(i, { ...answer(), rationaleSummary: "Bạn đã nâng thêm 80 kg. Phép tính chưa kiểm tra: 80 + 123 = 203." });
  assert.equal(laundering.contentGate, "BLOCKED");
  assert.ok(laundering.contentIssues.some((i) => i.code === "NUMBER_NOT_IN_INPUT"));
});
test("review P1-4: missing assertions are flagged; valid endpoints and multi-outcome uncertainty are not invented contradictions", () => {
  const a = { ...answer(), claims: [{ ...observation(), metricAssertion: undefined }] };
  const r = evaluateContentV3(input, a);
  assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW"); assert.ok(r.contentIssues.some((i) => i.code === "MISSING_METRIC_ASSERTION"));
  const pair = evaluateContentV3(input, { ...a, claims: [{ ...a.claims[0], text: "e1RM giảm từ 66 xuống 60 kg." }] });
  assert.ok(pair.contentIssues.some((i) => i.code === "OBSERVATION_ENDPOINT_CONTRADICTION"));
  const omittedBasis: Record<string, unknown> = { ...a }; delete omittedBasis.assessmentBasis;
  assert.equal(evaluateContentV3(input, omittedBasis).contentGate, "BLOCKED");
  const mixed = evaluateContentV3({ ...input, question: "Sức mạnh và kích thước cơ thay đổi thế nào?" }, a);
  assert.equal(mixed.contentGate, "FLAGGED_FOR_REVIEW");
});
test("review P1-4 scope: ambiguous exercise sets are flagged, named exercise uses server scope", () => {
  const flat = cases.find((s) => s.id === "strength-flat")!.input;
  const squat = { ...input.facts[1], id: "F_SQUAT", evidence: { ...input.facts[1].evidence, value: { ...input.facts[1].evidence.value, exercise: "Squat" } } };
  const a = answer(); a.assessment = "NO_OBSERVED_CHANGE"; a.claims[0].text = "e1RM giữ nguyên ở 60 kg.";
  a.claims[0].metricAssertion = { factId: "F_PROGRESS", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 60, changePct: 0 };
  const facts = [...flat.facts, squat];
  const named = evaluateContentV3({ ...flat, question: "Sức mạnh ước tính Bench Press thay đổi thế nào?", facts }, a);
  assert.notEqual(named.contentGate, "BLOCKED");
  const ambiguous = evaluateContentV3({ ...flat, facts }, a);
  assert.equal(ambiguous.contentGate, "FLAGGED_FOR_REVIEW");
  assert.ok(ambiguous.contentIssues.some((i) => i.code === "AMBIGUOUS_STRENGTH_ASSESSMENT_SCOPE"));
});
test("review P2-1: hypertrophy paraphrases remain semantic flags, including negation in another clause", () => {
  for (const text of ["e1RM tăng cho thấy bạn đã tăng cơ.", "Sức mạnh tăng nên cơ bắp phát triển, không có gì đáng ngại.", "e1RM went up, so you built muscle.", "Cơ bắp của bạn không tăng vì e1RM giữ nguyên.", "e1RM tăng cho thấy bạn đã tăng cơ, chưa đủ dữ liệu về dinh dưỡng."]) {
    const r = evaluateContentV3(input, { ...answer(), rationaleSummary: text });
    assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW", text);
    assert.ok(r.contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"), text);
  }
});
test("review P2-1 negative controls: specific measurement-limit negation is not a hypertrophy inference", () => {
  for (const text of ["e1RM tăng không chứng minh tăng cơ.", "e1RM tăng, chưa đủ căn cứ để kết luận tăng cơ.", "Increased e1RM does not prove muscle growth.", "Chưa thể kết luận cơ bắp tăng từ e1RM."]) {
    const r = evaluateContentV3(input, { ...answer(), rationaleSummary: text });
    assert.ok(!r.contentIssues.some((i) => i.code === "POSSIBLE_STRENGTH_TO_HYPERTROPHY_INFERENCE"), text);
  }
});
test("review P2-2: measurement limitation and general principle cannot conceal personal causes", () => {
  for (const c of [
    { claimType: "MEASUREMENT_LIMITATION" as const, text: "Sức mạnh của bạn tăng nhờ chương trình hiện tại hiệu quả.", factIds: ["F_PROGRESS"], evidenceIds: [] },
    { claimType: "GENERAL_PRINCIPLE" as const, text: "ACSM cho thấy bạn tiến bộ nhờ quá tải tăng dần.", factIds: [], evidenceIds: ["ACSM_PROGRESSIVE"] },
  ]) {
    const a = { ...answer(), claims: [observation(), c] }, before = JSON.stringify(a);
    const r = evaluateContentV3(input, a);
    assert.equal(r.contentGate, "FLAGGED_FOR_REVIEW");
    assert.ok(r.contentIssues.some((i) => i.code === "DECLARED_TYPE_TEXT_MISMATCH")); assert.equal(JSON.stringify(a), before);
  }
});
test("review P2-3: measured body weight does not authorize a muscle-size assessment", () => {
  const weight = { id: "F_WEIGHT", evidence: { ...input.facts[0].evidence, domain: "BODY" as const, kind: "LATEST_MEASURED_WEIGHT", value: { weightKg: 70 } } };
  const a = { ...answer(), assessmentBasis: { outcome: "MUSCLE_SIZE" as const, factIds: ["F_WEIGHT"] }, claims: [{ claimType: "OBSERVATION" as const, text: "Cân nặng ghi nhận 70 kg.", factIds: ["F_WEIGHT"], evidenceIds: [] }] };
  const r = evaluateContentV3({ ...input, question: "Kích thước cơ đã tăng chưa?", facts: [weight] }, a);
  // P1-1 upgrade: a known weight-only measurement cannot support muscle progress.
  assert.equal(r.contentGate, "BLOCKED"); assert.ok(r.contentIssues.some((i) => i.code === "WEIGHT_IS_NOT_MUSCLE_SIZE_MEASUREMENT"));
  const unreferenced = evaluateContentV3({ ...input, facts: [...input.facts, weight] }, { ...answer(), assessmentBasis: { outcome: "MUSCLE_SIZE", factIds: ["F_PROGRESS"] } });
  assert.ok(unreferenced.contentIssues.some((i) => i.code === "MUSCLE_OUTCOME_WITHOUT_SUPPORTED_MEASUREMENT"));
});
test("review P3-1: tap and adaptation do not masquerade as load/ta/tai words", () => {
  for (const text of ["Có thể tập luyện liên quan đến thay đổi này.", "Training adaptation is a possibility."]) {
    const r = evaluateContentV3(input, { ...answer(), claims: [observation(), { ...hypothesis(text), missingToConfirm: [{ key: "goal", question: "Mục tiêu của bạn là gì?" }] }] });
    assert.ok(!r.contentIssues.some((i) => i.code === "POSSIBLE_MISSING_CAUSAL_INFORMATION"), text);
  }
});
test("review P3-2: missing-information key mismatch is checked in both directions", () => {
  for (const item of [
    { key: "progression" as const, question: "Bạn có đo kích thước cơ không?" },
    { key: "outcome_measurement" as const, question: "Bạn có lịch sử tải tập qua các tuần không?" },
  ]) assert.ok(evaluateContentV3(input, { ...answer(), missingInformation: [item] }).contentIssues.some((i) => i.code === "POSSIBLE_MISSING_KEY_MISMATCH"));
  for (const item of [
    { key: "program_load_history" as const, question: "Bạn có lịch sử tải tập qua các tuần không?" },
    { key: "outcome_measurement" as const, question: "Bạn có đo kích thước cơ không?" },
  ]) assert.ok(!evaluateContentV3(input, { ...answer(), missingInformation: [item] }).contentIssues.some((i) => i.code === "POSSIBLE_MISSING_KEY_MISMATCH"));
});
test("review P3-3: limitations and generic progression principles are not implicit personal recommendations", () => {
  for (const text of ["Để có tiến bộ, cần tăng dần tải theo mục tiêu. Số buổi hoàn thành không đủ để đánh giá tiến bộ.", "Chưa đủ dữ liệu để kết luận bạn cần điều chỉnh tải."]) {
    const r = evaluateContentV3(input, { ...answer(), rationaleSummary: text });
    assert.ok(!r.contentIssues.some((i) => i.code === "POSSIBLE_IMPLICIT_PERSONAL_RECOMMENDATION"), text);
  }
});
test("review P3-4: all source metadata is outside model input, including arbitrary finding-leaking titles", () => {
  const marker = "REMOVED_FINDING_EQUALS_HYPERTROPHY_ACROSS_CONDITIONS";
  const altered = { ...pack, sources: pack.sources.map((s) => ({ ...s, title: marker, doi: marker, evidenceLevel: marker })) };
  const prepared = prepareSourceAblations(readDev("source-ablation-review-protocol.json"), input, altered, readDev("evidence-claim-map-v2.json"));
  const removed = prepared.find((c) => c.id === "remove-hypertrophy-result")!;
  assert.ok(!JSON.stringify(removed.input).includes(marker)); assert.ok(JSON.stringify(removed.evaluationOnly).includes(marker));
  for (const s of removed.input.sources) {
    assert.equal(AblationModelSourceSchema.safeParse(s).success, true);
    for (const name of ["title", "doi", "url", "locator", "sourceId"]) assert.ok(!JSON.stringify(s).includes(`"${name}"`));
    assert.ok(/^S\d+$/.test(s.id));
  }
});
test("review P3-5: a missing artifact directory is unavailable rather than confirmed", () => {
  const loaded = loadFrozenV2(repoRoot, `${repoRoot}/artifacts/nonexistent-review-fixture`);
  assert.equal(loaded.integrity.status, "ARTIFACT_UNAVAILABLE"); assert.equal(loaded.data, null);
});
test("review P3-6: repair retains original snapshot, initial findings and response diagnostics", async () => {
  const candidate = { ...answer(), rationaleSummary: "Không cần đổi lịch tập." };
  const before = structuredClone(candidate);
  const response = { verdict: "REVISE", issues: ["Removed advice"], revisedAnswer: answer() };
  const r = await repairContentV3Once(input, candidate, async () => response);
  assert.deepEqual(r.initialCandidate, before); candidate.rationaleSummary = "Caller mutated candidate afterwards.";
  assert.deepEqual(r.initialCandidate, before); assert.equal(r.initialReport.contentGate, "BLOCKED");
  assert.deepEqual(r.repairDiagnostics.response, response); assert.deepEqual(r.repairDiagnostics.schemaIssues, []);
  assert.equal(r.finalReport.contentGate, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("review P3-6: failed/malformed repair keeps both diagnostics and original candidate", async () => {
  const candidate = { ...answer(), rationaleSummary: "Không cần đổi lịch tập." };
  const r = await repairContentV3Once(input, candidate, async () => ({ verdict: "REVISE", issues: [], revisedAnswer: null }));
  assert.deepEqual(r.initialCandidate, candidate); assert.ok(r.repairDiagnostics.schemaIssues.length > 0);
  assert.ok(r.initialReport.contentIssues.length > 0); assert.equal(r.finalReport.contentGate, "BLOCKED");
  const thrown = await repairContentV3Once(input, candidate, async () => { throw new Error("private provider details"); });
  assert.deepEqual(thrown.initialCandidate, candidate); assert.equal(thrown.repairDiagnostics.errorKind, "CALLBACK_FAILED");
  assert.ok(!JSON.stringify(thrown).includes("private provider details"));
});
