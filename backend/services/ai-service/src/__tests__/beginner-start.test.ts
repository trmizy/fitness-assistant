import test from "node:test";
import assert from "node:assert/strict";
import { isBeginnerStartQuestion, buildBeginnerStartAnswer } from "../services/beginner-start";

/** Found by the persona journey evaluation: a newcomer's first question was answered as "no saved schedule for today". */
test("a newcomer asking where to start is recognised (with and without diacritics)", () => {
  for (const q of [
    "Tôi mới đăng ký app, chưa biết tập gì cả. Tôi nên bắt đầu từ đâu?",
    "mình mới tập, nên bắt đầu như thế nào",
    "toi chua biet tap gi, huong dan toi voi",
    "Người mới thì nên làm gì đầu tiên?",
    "Lần đầu đi tập tôi cần chuẩn bị gì?",
  ]) assert.equal(isBeginnerStartQuestion(q), true, q);
});

test("ordinary questions and concrete requests are NOT taken for the starter guide", () => {
  for (const q of [
    "Hôm nay tôi tập gì?",
    "Tôi chưa có lịch tập hôm nay à?",
    "Tạo lịch tập cho tôi",
    "Tôi mới đăng ký, hãy lập lộ trình cho tôi",
    "Squat đúng kỹ thuật thế nào?",
    "Tôi tập 8 năm rồi, nên chia chu kỳ thế nào?",
    "123",
  ]) assert.equal(isBeginnerStartQuestion(q), false, q);
});

test("the starter answer is profile-aware, names the real next steps and never claims anything was saved", () => {
  const a = buildBeginnerStartAnswer({ goal: "WEIGHT_LOSS" });
  assert.match(a, /giảm mỡ/);
  for (const step of [/Lập lộ trình/, /Tạo lịch tập/, /Tạo thực đơn/, /huấn luyện viên/]) assert.match(a, step);
  assert.match(a, /chỉ lưu khi bạn xác nhận/);
  assert.doesNotMatch(a, /đã lưu|đã tạo/i);
  assert.doesNotMatch(buildBeginnerStartAnswer(null), /undefined|null/);
});
