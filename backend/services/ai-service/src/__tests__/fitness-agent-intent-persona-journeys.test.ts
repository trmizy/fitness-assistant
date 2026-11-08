import test from "node:test";
import assert from "node:assert/strict";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

/** Found by the persona journey evaluation (veteran + intermediate personas). */
test("a PLANNING question about cycles is not an assessment of the user's own cycle", () => {
  assert.notEqual(parseFitnessAgentIntent("Tôi tập 8 năm, đang chuẩn bị thi đấu powerlifting 12 tuần nữa. Nên chia chu kỳ thế nào?").kind, "EVALUATE");
  assert.notEqual(parseFitnessAgentIntent("Nên lập chu kỳ peaking thế nào cho cuộc thi?").kind, "EVALUATE");
});
test("assessing the user's own cycle still evaluates", () => {
  assert.equal(parseFitnessAgentIntent("Đánh giá chu kỳ tập của tôi").kind, "EVALUATE");
  assert.equal(parseFitnessAgentIntent("Chu kỳ hiện tại của tôi thế nào?").kind, "EVALUATE");
});
test("'đổi sang lịch … 4 buổi' is a request for a new workout schedule", () => {
  assert.equal(parseFitnessAgentIntent("Đổi giúp tôi sang lịch upper/lower 4 buổi một tuần, mỗi buổi 60 phút").kind, "CREATE_WORKOUT_PLAN");
  assert.equal(parseFitnessAgentIntent("chuyển sang lịch push pull legs 3 buổi").kind, "CREATE_WORKOUT_PLAN");
});
