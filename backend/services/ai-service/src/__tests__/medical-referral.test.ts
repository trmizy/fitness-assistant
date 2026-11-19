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

// B2-50: the condition was stated on an earlier turn, the current question does not repeat it.
test("remembers a condition the user stated on an earlier turn", () => {
  const out = appendMedicalReferralNote("Thế tôi có nên tập squat không?", "Squat tốt cho xương.", "vi", ["Tôi bị loãng xương nhẹ."]);
  assert.match(out, /bác sĩ điều trị/);
  assert.equal(appendMedicalReferralNote("Thế tôi có nên tập squat không?", "Squat tốt cho xương.", "vi", ["Tôi muốn tăng cơ."]), "Squat tốt cho xương.");
});

// B2-43: elevated-risk group gets a softer, conditional line.
test("post-menopause questions get the conditional referral line", () => {
  const out = appendMedicalReferralNote("Phụ nữ sau mãn kinh nên ưu tiên tập gì để giữ xương chắc?", "Tập kháng lực.");
  assert.match(out, /Nếu bạn đã được chẩn đoán loãng xương/);
  assert.equal(needsMedicalReferralNote("Phụ nữ sau mãn kinh nên tập gì?", "Hãy hỏi bác sĩ trước."), false);
});

// B2-23 / B2-27: own pain or injury answered without any "see someone if it gets worse".
test("own pain or injury gets the red-flag line when the model gave none", () => {
  for (const q of ["Tôi bị đau lưng dưới khi ngồi lâu, tập gì cho đỡ?", "Hôm qua tôi bị bong gân cổ chân, có tập chân được không?"]) {
    assert.match(appendMedicalReferralNote(q, "Hãy tập Hip Bridge."), /vật lý trị liệu/, q);
  }
});

test("general injury questions and answers that already refer are untouched", () => {
  assert.equal(needsMedicalReferralNote("Tập chân có gây chấn thương không?", "Không nếu đúng kỹ thuật."), false);
  assert.equal(needsMedicalReferralNote("Nếu tập ngực có bị chấn thương không?", "Ít khi."), false);
  assert.equal(needsMedicalReferralNote("Tôi bị đau lưng, tập gì?", "Hãy gặp bác sĩ nếu đau tăng."), false);
});

// B3-41: people around 60+ get the conditional check-up line.
test("people aged 60+ get the conditional check-up line; younger ones do not", () => {
  assert.match(appendMedicalReferralNote("Tôi sắp 60 tuổi, tập tạ có an toàn không?", "Có, hãy bắt đầu nhẹ."), /hỏi bác sĩ/);
  assert.equal(needsMedicalReferralNote("Tôi 52 tuổi, tập tạ có an toàn không?", "Có."), false);
});
