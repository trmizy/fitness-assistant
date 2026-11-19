/**
 * V1 RC1 (2026-11-12) — H-05 / H-06 (REAL HTTP/API, Nova Pro rc-verify-v1b): "Bạn có thể tạo lịch 4 buổi cho tôi không?" and
 * "Hãy đổi lịch của tôi lên 4 buổi." reached the create-workout workflow correctly, which then asked "Bạn muốn tập mấy buổi
 * mỗi tuần?" — the opening-message extractor only accepted "N buổi … tuần". Oracle: hand-labelled slot values.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkoutPlanWorkflow } from "../agent-workflow/workflows/create-workout-plan.workflow";

const ex = (m: string) => (createWorkoutPlanWorkflow as any).extractFromMessage(m) as { daysPerWeek?: number; sessionMinutes?: number };

const DAYS: Array<[string, number]> = [
  ["Bạn có thể tạo lịch 4 buổi cho tôi không?", 4], // H-05
  ["Hãy đổi lịch của tôi lên 4 buổi.", 4], // H-06
  ["Tạo lịch 4 buổi cho tôi", 4],
  ["Lên lịch tập 4 buổi/tuần giúp tôi", 4],
  ["Tôi muốn tập bốn buổi mỗi tuần, lên lịch giúp tôi", 4],
  ["Tôi muốn lịch 3 ngày", 3],
  ["Tạo lịch tập 3 buổi mỗi tuần, mỗi buổi 45 phút", 3], // existing behaviour kept
  ["Lên lịch tập năm buổi một tuần cho tôi", 5],
];
for (const [m, n] of DAYS) test(`days per week from the opening message: "${m}" -> ${n}`, () => assert.equal(ex(m).daysPerWeek, n));

const NOT_DAYS = [
  "Tạo lịch tập cho tôi, mỗi bài 4 hiệp", // sets, not sessions
  "Tạo lịch tập cho tôi, mỗi buổi 45 phút", // minutes
  "Em 16 tuổi, tạo lịch tập cho em", // age
  "Tạo lịch tập, tôi muốn nghỉ 2 ngày giữa các buổi", // rest days
  "Tạo lịch tập 8 bài cho thứ 7", // exercises / weekday
  "Tạo lịch tập cho tôi. Nếu tập 6 buổi thì có ổn không?", // a hypothetical is not the user's choice
];
for (const m of NOT_DAYS) test(`no days-per-week read from: "${m}"`, () => assert.equal(ex(m).daysPerWeek, undefined));

test("a polite condition is not a hypothetical: 'Lên lịch tập cho tôi, nếu được thì 4 buổi' -> 4", () => {
  assert.equal(ex("Lên lịch tập cho tôi, nếu được thì 4 buổi").daysPerWeek, 4);
});

test("minutes still extracted, never confused with sessions", () => {
  const r = ex("Tạo lịch 4 buổi, mỗi buổi 45 phút");
  assert.deepEqual([r.daysPerWeek, r.sessionMinutes], [4, 45]);
});
