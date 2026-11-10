/** Regression (2026-11-10, eval B1-45): a user with a chronic condition always gets a doctor referral. */
import test from "node:test";
import assert from "node:assert/strict";
import { needsMedicalReferralNote, appendMedicalReferralNote } from "../llm/medical-referral";

const Q = "Tôi 52 tuổi, bị loãng xương nhẹ, nên tập những bài nào?";

test("adds the referral when the model forgot it", () => {
  const out = appendMedicalReferralNote(Q, "Bạn nên tập squat không tạ và đẩy tường.");
  assert.match(out, /bác sĩ điều trị/);
  assert.ok(out.startsWith("Bạn nên tập squat"));
});

test("does not duplicate when the model already refers to a doctor", () => {
  const answer = "Hãy hỏi bác sĩ trước khi tập. Squat không tạ là phù hợp.";
  assert.equal(appendMedicalReferralNote(Q, answer), answer);
});

test("only for the user's own condition, not general knowledge or healthy users", () => {
  assert.equal(needsMedicalReferralNote("Loãng xương là gì?", "Là bệnh làm giảm mật độ xương."), false);
  assert.equal(needsMedicalReferralNote("Tôi muốn tăng cơ, nên tập gì?", "Tập squat."), false);
});

test("english answers get the english note", () => {
  const out = appendMedicalReferralNote("I have asthma, what cardio can I do?", "Walking works.", "en");
  assert.match(out, /check with your doctor/);
});
