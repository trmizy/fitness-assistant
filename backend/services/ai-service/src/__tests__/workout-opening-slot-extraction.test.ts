import test from "node:test";
import assert from "node:assert/strict";
import { createWorkoutPlanWorkflow } from "../agent-workflow/workflows/create-workout-plan.workflow";

/** Found by the Phase-5 DEV evaluation set: "Tạo lịch tập 3 buổi mỗi tuần, mỗi buổi 45 phút" re-asked both values. */
const extract = (m: string) => createWorkoutPlanWorkflow.extractFromMessage!(m, {} as never);

test("the opening message's own days/week and minutes are taken, not re-asked", () => {
  assert.deepEqual(extract("Tạo lịch tập 3 buổi mỗi tuần, mỗi buổi 45 phút"), { daysPerWeek: 3, sessionMinutes: 45 });
  assert.deepEqual(extract("tao lich tap 4 buoi/tuan moi buoi 60 phut"), { daysPerWeek: 4, sessionMinutes: 60 });
  assert.deepEqual(extract("lên lịch 5 ngày một tuần, mỗi buổi 1 tiếng"), { daysPerWeek: 5, sessionMinutes: 60 });
});
test("unrelated numbers are never read as a slot", () => {
  assert.deepEqual(extract("Tôi 30 tuổi, nặng 80 kg, tạo lịch tập giúp tôi"), {});
  assert.deepEqual(extract("8 bài tập cho thứ 7"), {});
  assert.deepEqual(extract("8 bài tập cho 1 ngày"), {});
  assert.deepEqual(extract("Tạo lịch tập 9 buổi mỗi tuần"), {}); // out of range -> asked normally
});
