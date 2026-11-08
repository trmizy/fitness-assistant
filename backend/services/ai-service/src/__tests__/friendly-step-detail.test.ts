import test from "node:test";
import assert from "node:assert/strict";
import { friendlyStepDetail } from "../services/friendly-step-detail";

/** Reviewer feedback (persona playground v2): the bundle result card showed raw English/internal backend text. */
test("known internal messages become plain Vietnamese with the next step", () => {
  const legacy = friendlyStepDetail("roadmap", "An active legacy cycle already exists; close it before activating a roadmap phase")!;
  assert.match(legacy, /chu kỳ tập cũ/); assert.match(legacy, /Xác nhận lại/);
  assert.doesNotMatch(legacy, /legacy|activating/i);
  assert.match(friendlyStepDetail("nutrition", "already_initialized")!, /đã có sẵn/);
  assert.match(friendlyStepDetail("workout", "Không có chương trình tập phù hợp để áp dụng")!, /Tạo lịch tập cho tôi/);
});
test("any other English-only backend text is replaced by a neutral retry hint; Vietnamese text is kept", () => {
  assert.match(friendlyStepDetail("roadmap", "Request failed with status code 500")!, /thử xác nhận lại/);
  assert.equal(friendlyStepDetail("nutrition", "Chưa tạo được mục tiêu dinh dưỡng vì thiếu dữ liệu hồ sơ (activityLevel)."), "Chưa tạo được mục tiêu dinh dưỡng vì thiếu dữ liệu hồ sơ (activityLevel).");
  assert.equal(friendlyStepDetail("roadmap", undefined), undefined);
});
