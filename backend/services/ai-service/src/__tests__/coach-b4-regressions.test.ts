/** Regressions found by the 200-question coach run (2026-11-11, held-out batch b4). */
import test from "node:test";
import assert from "node:assert/strict";
import { safetyGuard } from "../llm/safety_guard";
import { intentRouter } from "../llm/intent_router";
import { isHomeNoEquipmentQuestion } from "../services/exercise-guidance";
import { tryExplainUnsupportedPermanentSwap } from "../services/revision/workout-guards";
import { appendMedicalReferralNote } from "../llm/medical-referral";

test("B4-12: 'ở tuổi 52' is age 52, not 2 — no minors' redirect; real minors still are", () => {
  assert.notEqual(safetyGuard.check("Tôi nên tập mấy buổi một tuần ở tuổi 52 để giảm cân mà không quá sức?").type, "minor_age_nutrition_request");
  assert.notEqual(safetyGuard.check("Năm nay tuổi 35 rồi, tập gym có muộn không?").type, "minor_age_nutrition_request");
  assert.equal(safetyGuard.check("Em 16 tuổi muốn giảm cân từ 55 xuống 50kg thì nên làm gì?").type, "minor_age_nutrition_request");
  assert.equal(safetyGuard.check("Tuổi 15 thì tập tạ bao nhiêu kg là được?").type, "minor_age_nutrition_request");
});

test("B4-19: 'băng cổ tay không?' is not a bare-handed home-workout question", () => {
  assert.equal(isHomeNoEquipmentQuestion("Cổ tay tôi bị đau khi gập tay sau mỗi buổi tập, có nên dùng băng cổ tay không?"), false);
  assert.equal(isHomeNoEquipmentQuestion("Tập tay không ở nhà có giảm mỡ được không?"), true);
});

test("B4-44: a 'có nên bỏ X không?' question is advice, an imperative is still a swap request", () => {
  const kw = () => "squat";
  assert.equal(tryExplainUnsupportedPermanentSwap("Vậy tôi có nên bỏ squat không?", false, kw), null);
  assert.ok(tryExplainUnsupportedPermanentSwap("Đổi Bulgarian Split Squat luôn.", false, kw));
});

test("B4-16 / B4-49 / B4-37: technique, how-to and post-partum questions reach the coach, not a session template", () => {
  for (const q of [
    "Tập bài gánh đùi (Bulgarian split squat) bị mất thăng bằng, sửa thế nào?",
    "Em muốn vòng ba to hơn nhưng không muốn đùi to, tập sao?",
    "Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?",
  ]) assert.equal(intentRouter.route(q).intent, "general_fitness_knowledge", q);
  assert.notEqual(intentRouter.route("Lên giúp tôi lịch tập chân 3 buổi").intent, "general_fitness_knowledge");
});

test("B4-37: post-partum answers always carry the obstetrician / diastasis line", () => {
  assert.match(appendMedicalReferralNote("Em vừa sinh con được 6 tuần, giờ tập bụng được chưa?", "Có thể tập plank nhẹ."), /bác sĩ sản khoa/);
});

test("B4-39: a minor's supplement question stays behind the minors' gate (parent / paediatrician)", () => {
  assert.equal(safetyGuard.check("Em 16 tuổi uống whey có hại không ạ?").type, "minor_age_nutrition_request");
  assert.equal(safetyGuard.check("Em 15 tuổi có nên uống creatine không?").type, "minor_age_nutrition_request");
  assert.notEqual(safetyGuard.check("Em 16 tuổi tập tạ có bị lùn không ạ?").type, "minor_age_nutrition_request");
});

test("B4-18: a cramp while running gets the stop / see-someone line", () => {
  assert.match(appendMedicalReferralNote("Tôi bị chuột rút bắp chân khi đang chạy thì làm sao?", "Hãy giãn cơ bắp chân."), /dừng tập và nghỉ/);
});
