/**
 * V1 RC1 (2026-11-12) — "tôi muốn đổi món ăn" was answered "Mình chưa thể thay đổi vĩnh viễn bài tập…". Root cause (verified):
 * extractExerciseRevisionKeyword() returns a "keyword" for ANY đổi/thay message ("muon mon an", "uc ga ca"), so the (b4,
 * untouched) permanent-exercise-swap guard fired on food. The domain boundary now decides first. Oracle: hand-labelled.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isFoodDomainSwap } from "../services/fitness-agent.service";

for (const q of ["tôi muốn đổi món ăn", "Đổi món cơm trưa thành bún", "thay ức gà bằng cá", "Đổi bữa sáng sang yến mạch", "Cho tôi đổi thực đơn tối nay"]) {
  test(`food swap is food domain: "${q}"`, () => assert.equal(isFoodDomainSwap(q), true));
}
for (const q of ["Thay bài squat bằng leg press", "Tôi muốn đổi bài deadlift vĩnh viễn", "đổi bài tập chân", "Đổi Bench Press sang chống đẩy", "Thay tạ đòn bằng tạ đơn trong bài row"]) {
  test(`exercise swap stays exercise domain: "${q}"`, () => assert.equal(isFoodDomainSwap(q), false));
}
