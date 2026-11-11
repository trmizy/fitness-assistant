import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectionGoal, buildDirectionAnswer, parseDirectionChoice, questionForDirectionChoice } from "../services/training-direction";
import { createWorkoutPlanWorkflow } from "../agent-workflow/workflows/create-workout-plan.workflow";

/** Reviewer feedback (persona playground v2): a "what should I do / how do I train" question got a generated schedule instead of directions. */
test("direction questions are recognised with the right goal", () => {
  assert.equal(detectDirectionGoal("tôi đã biết tập và tôi đang muốn giảm cân bây giờ nên làm gì"), "fat_loss");
  assert.equal(detectDirectionGoal("vậy tôi muốn vừa giảm cân vừa tăng cơ thì tập như thế nào"), "recomp");
  assert.equal(detectDirectionGoal("toi muon tang co nen bat dau the nao"), "muscle_gain");
  assert.equal(detectDirectionGoal("Tôi muốn giảm mỡ bụng, nên làm gì?"), "fat_loss");
});

test("build/nutrition/measurement requests are NOT direction questions", () => {
  for (const q of [
    "Tạo lịch tập giảm cân cho tôi",
    "Tôi muốn giảm cân nên ăn gì?",
    "Lập lộ trình giảm cân 12 tuần",
    "Tôi muốn giảm 5kg trong 8 tuần thì nên làm gì",
    "Hôm nay tôi tập gì?",
    "Squat đúng kỹ thuật thế nào?",
  ]) assert.equal(detectDirectionGoal(q), null, q);
});

test("the guide offers TWO directions, adapts to the person, and asks before building anything", () => {
  for (const g of ["fat_loss", "recomp", "muscle_gain"] as const) {
    const a = buildDirectionAnswer(g, { rawText: "nên làm gì", experienceLevel: "BEGINNER" });
    assert.match(a, /Hướng A/); assert.match(a, /Hướng B/);
    assert.match(a, /Người bận/); assert.match(a, /lớn tuổi/);
    assert.match(a, /có muốn mình tạo lịch tập/);
    assert.match(a, /chỉ lưu khi bạn xác nhận/);
    assert.doesNotMatch(a, /\| Ngày \|/); // no generated schedule table
  }
});

test("a stated experience changes the advice (already trains vs beginner)", () => {
  const exp = buildDirectionAnswer("fat_loss", { rawText: "tôi đã biết tập, nên làm gì để giảm cân", experienceLevel: "BEGINNER" });
  const beg = buildDirectionAnswer("fat_loss", { rawText: "nên làm gì để giảm cân", experienceLevel: "BEGINNER" });
  assert.match(exp, /đã biết tập/);
  assert.notEqual(exp, beg);
});

test("'Hướng A, 4 buổi, 60 phút' continues into the create-schedule flow", () => {
  assert.deepEqual(parseDirectionChoice("Hướng A, 4 buổi, 60 phút"), { option: "A", daysPerWeek: 4, sessionMinutes: 60 });
  assert.deepEqual(parseDirectionChoice("chọn hướng B"), { option: "B" });
  assert.equal(parseDirectionChoice("hướng đi nào tốt hơn cho người mới tập luyện lâu năm như tôi"), null);
  assert.equal(questionForDirectionChoice({ daysPerWeek: 4, sessionMinutes: 60 }), "Tạo lịch tập cho tôi, 4 buổi mỗi tuần, mỗi buổi 60 phút");
});

test("'120p' (abbreviated minutes) in the opening message is read, not dropped for the 60-minute default", () => {
  const extract = (m: string) => createWorkoutPlanWorkflow.extractFromMessage!(m, {} as never);
  assert.deepEqual(extract("tạo lịch tập mỗi buổi 120p"), { sessionMinutes: 120 });
  assert.deepEqual(extract("lịch tập 5 buổi mỗi tuần, mỗi buổi 90p"), { daysPerWeek: 5, sessionMinutes: 90 });
});
