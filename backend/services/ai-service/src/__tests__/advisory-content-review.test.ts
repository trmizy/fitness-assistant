import test from "node:test";
import assert from "node:assert/strict";
import type { Answer } from "../evaluation/advisory-progress/experiment";
import { answerTextUnits, screenReadonlyAdvice } from "../evaluation/advisory-progress/content-review";

const answer = (): Answer => ({
  assessment: "OBSERVED_PROGRESS", observations: [{ text: "e1RM ước tính tăng từ 60 lên 66 kg.", factIds: ["F_PROGRESS"] }],
  hypotheses: [], missingInformation: [], rationaleSummary: "Dữ liệu cho thấy sức mạnh ước tính tăng.", proposedAction: null,
});

test("observed V2 plan advice is flagged even with proposedAction null", () => {
  const candidate = { ...answer(), rationaleSummary: "Dữ liệu cho thấy sức mạnh ước tính tăng, không cần đổi lịch." };
  const result = screenReadonlyAdvice(candidate);
  assert.equal(result.status, "FLAGGED_FOR_REVIEW");
  assert.ok(result.signals.some((signal) => signal.path === "rationaleSummary" && signal.ruleId === "no_change_needed"));
});
test("the screen examines observations, hypotheses and questions, not just rationale", () => {
  const candidate = answer();
  candidate.observations[0].text += " Nên đổi lịch tập.";
  candidate.hypotheses = [{ text: "Bạn cần tăng tạ.", evidenceIds: ["ACSM_PROGRESSIVE"], needsConfirmation: true }];
  candidate.missingInformation = [{ key: "other", question: "Hãy giữ nguyên chương trình." }];
  const paths = screenReadonlyAdvice(candidate).signals.map((signal) => signal.path);
  assert.ok(paths.includes("observations.0.text"));
  assert.ok(paths.includes("hypotheses.0.text"));
  assert.ok(paths.includes("missingInformation.0.question"));
});
test("a source ID and needsConfirmation flag do not authorize personal advice", () => {
  const candidate = { ...answer(), hypotheses: [{ text: "Không cần điều chỉnh chương trình.", evidenceIds: ["ACSM_PROGRESSIVE"], needsConfirmation: true as const }] };
  assert.equal(screenReadonlyAdvice(candidate).status, "FLAGGED_FOR_REVIEW");
});
test("insufficient-basis phrasing is distinguished from making a plan decision", () => {
  for (const text of [
    "Chưa đủ dữ liệu để kết luận nên giữ nguyên lịch tập.",
    "Chưa đủ căn cứ để nói không cần đổi lịch.",
    "Chưa thể kết luận nên giữ nguyên hay điều chỉnh lịch tập.",
  ]) assert.equal(screenReadonlyAdvice({ ...answer(), rationaleSummary: text }).signals.length, 0, text);
});
test("earlier uncertainty in another sentence does not excuse an unsupported recommendation", () => {
  const result = screenReadonlyAdvice({ ...answer(), rationaleSummary: "Chưa đủ dữ liệu để kết luận. Không cần đổi lịch." });
  assert.equal(result.status, "FLAGGED_FOR_REVIEW");
  assert.equal(screenReadonlyAdvice({ ...answer(), rationaleSummary: "Chưa thể kết luận; hãy đổi lịch tập." }).status, "FLAGGED_FOR_REVIEW");
});
test("a genuine question about a plan is not automatically a recommendation", () => {
  const candidate = { ...answer(), missingInformation: [{ key: "other" as const, question: "Bạn có cần đổi lịch không?" }] };
  assert.equal(screenReadonlyAdvice(candidate).signals.length, 0);
});
test("unaccented and English advice variants are screened without claiming full coverage", () => {
  for (const text of ["Khong can doi lich tap.", "Nên giảm mức tạ.", "No need to change your plan.", "You should keep your schedule."]) {
    assert.equal(screenReadonlyAdvice({ ...answer(), rationaleSummary: text }).status, "FLAGGED_FOR_REVIEW", text);
  }
  assert.equal(screenReadonlyAdvice(answer()).status, "NO_RULE_MATCH_NOT_CONTENT_PASS");
});
test("all text units are enumerated for review with stable field paths", () => {
  const candidate = answer();
  candidate.hypotheses = [{ text: "Giới hạn phép đo", evidenceIds: ["LOAD_OUTCOME_SPECIFICITY"], needsConfirmation: true }];
  candidate.missingInformation = [{ key: "outcome_measurement", question: "Bạn có số đo kích thước cơ không?" }];
  assert.deepEqual(answerTextUnits(candidate).map((unit) => unit.path), ["observations.0.text", "hypotheses.0.text", "missingInformation.0.question", "rationaleSummary"]);
});
