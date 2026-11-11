import test from "node:test";
import assert from "node:assert/strict";
import { detectWorkoutScheduleIntent } from "../llm/workout_schedule_context";

const history = [{ question: "Đổi giúp tôi sang lịch upper/lower 4 buổi", answer: "Đây là lịch tập mình đề xuất (4 buổi/tuần)…" }];

test("a long knowledge question is not a schedule follow-up just because it contains 'thế nào'", () => {
  for (const q of [
    "Progressive overload nên áp dụng thế nào cho bài bench press?",
    "Creatine có cần thiết không, uống thế nào?",
  ]) assert.equal(detectWorkoutScheduleIntent(q, history).enabled, false, q);
});

test("a short elliptical follow-up in a schedule conversation still is one", () => {
  assert.equal(detectWorkoutScheduleIntent("thế thứ 4 thì sao?", history).enabled, true);
});
