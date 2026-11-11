import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectWorkoutScheduleIntent } from "../llm/workout_schedule_context";

const scheduleHistory = [
  {
    question: "thứ 3 tuần này tập gì",
    answer:
      "Theo lịch tập đã lưu, Thứ Ba 2026-06-02 của bạn là Lung + Tay truoc.",
  },
];

describe("workout schedule intent detection", () => {
  it("keeps weekday follow-ups in workout schedule lookup", () => {
    const intent = detectWorkoutScheduleIntent(
      "thứ 5 tuần này thì sao",
      scheduleHistory,
    );

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, "specific_weekday");
    assert.equal(intent.inheritedIntent, true);
    assert.equal(intent.parsedDayOfWeek, 4);
  });

  it("does not inherit schedule lookup for injury-risk questions", () => {
    const questions = [
      "vậy nếu tập ngực có gây chấn thương không",
      "nếu tập ngực có bị chấn thương không",
      "tập chân có gây chấn thương không",
      "hôm nay tập ngực có bị chấn thương không",
    ];

    for (const question of questions) {
      const intent = detectWorkoutScheduleIntent(question, scheduleHistory);
      assert.equal(intent.enabled, false, question);
    }
  });

  it("maps one-week schedule requests to weekly schedule lookup, not today", () => {
    const intent = detectWorkoutScheduleIntent(
      "cho tôi lịch tập 1 tuần",
      scheduleHistory,
    );

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, "this_week");
    assert.ok(intent.weekStart);
    assert.ok(intent.weekEnd);
    assert.equal(intent.targetDate, undefined);
  });

  it("does not treat new workout-plan creation requests as saved schedule lookup", () => {
    const questions = [
      "hãy tạo cho tôi lịch tập 2 tháng tới khác với lịch hiện tại",
      "tạo cho tôi chương trình tập mới 8 tuần",
      "build a new workout plan for the next 2 months",
    ];

    for (const question of questions) {
      const intent = detectWorkoutScheduleIntent(question, scheduleHistory);
      assert.equal(intent.enabled, false, question);
    }
  });

  it("still parses short schedule follow-ups with a weekday", () => {
    const intent = detectWorkoutScheduleIntent(
      "còn thứ 6 thì sao",
      scheduleHistory,
    );

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, "specific_weekday");
    assert.equal(intent.parsedDayOfWeek, 5);
  });
});

// Regression (2026-11-10, eval B1-14 / B1-20 / B1-46): coaching questions that merely contain "tập gì"/"tuần này" were
// answered with the user's saved schedule instead of by the coach.
describe("workout schedule intent: advice questions are not lookups", () => {
  it("does not treat advice questions as a saved-schedule lookup", () => {
    for (const q of [
      "Tuần này tôi bận quá, chỉ tập được 2 buổi thì nên tập gì?",
      "Tôi chưa hít xà được cái nào, tập gì để làm được?",
      "Tôi hay bỏ tập giữa chừng sau vài tuần, làm sao để duy trì thói quen tập?",
    ]) {
      assert.equal(detectWorkoutScheduleIntent(q).enabled, false, q);
    }
  });

  it("still looks up the schedule for genuine schedule questions", () => {
    for (const q of ["hôm nay tôi tập gì", "tuần này tôi tập gì", "ngày mai tập gì", "lịch tập thứ 4 của tôi"]) {
      assert.equal(detectWorkoutScheduleIntent(q).enabled, true, q);
    }
  });
});

// Regression (2026-11-11, eval B2-13 / B2-23): "tuần sau"/"tập gì cho đỡ" are not requests for the saved schedule.
describe("workout schedule intent: more advice shapes", () => {
  it("does not treat a trip plan or a pain question as a saved-schedule lookup", () => {
    for (const q of [
      "Tuần sau tôi đi công tác 5 ngày, khách sạn không có phòng gym thì tập gì?",
      "Tôi bị đau lưng dưới khi ngồi lâu, tập gì cho đỡ?",
    ]) {
      assert.equal(detectWorkoutScheduleIntent(q).enabled, false, q);
    }
  });
  it("keeps real lookups that mention the week", () => {
    for (const q of ["tuần này tôi tập gì", "tuần sau tôi tập gì", "lịch tập tuần này của tôi"]) {
      assert.equal(detectWorkoutScheduleIntent(q).enabled, true, q);
    }
  });
});

// Regression (2026-11-11, eval B3): number ranges with units are not dates; coaching framing beats today/tomorrow.
describe("workout schedule intent: dates and coaching framing", () => {
  it("does not read '1-2 kg' as a date", () => {
    const i = detectWorkoutScheduleIntent("Tại sao cân nặng của tôi dao động 1-2 kg mỗi ngày dù ăn gần như nhau?");
    assert.equal(i.enabled, false);
    assert.equal(i.parsedDate, undefined);
    assert.equal(detectWorkoutScheduleIntent("tập 3-4 buổi một tuần được không").parsedDate, undefined);
    assert.equal(detectWorkoutScheduleIntent("lịch tập ngày 12/11").parsedDate?.slice(5), "11-12");
  });
  it("treats tired / own-condition / constraint messages as coaching, not lookups", () => {
    for (const q of [
      "Hôm nay em mệt, đổi sang bài dễ hơn được không?",
      "Tôi bị tiểu đường type 2, nên tập gì và ăn gì?",
      "Vậy em nên tập gì trong hai ngày đó?",
    ]) assert.equal(detectWorkoutScheduleIntent(q).enabled, false, q);
  });
  it("still looks up plain schedule questions", () => {
    for (const q of ["hôm nay tôi tập gì", "ngày mai tập gì", "thứ 5 tập gì", "lịch tập của tôi hôm nay"]) {
      assert.equal(detectWorkoutScheduleIntent(q).enabled, true, q);
    }
  });
});
