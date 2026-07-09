import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectWorkoutScheduleIntent } from '../llm/workout_schedule_context';

const scheduleHistory = [
  {
    question: 'thứ 3 tuần này tập gì',
    answer: 'Theo lịch tập đã lưu, Thứ Ba 2026-06-02 của bạn là Lung + Tay truoc.',
  },
];

describe('workout schedule intent detection', () => {
  it('keeps weekday follow-ups in workout schedule lookup', () => {
    const intent = detectWorkoutScheduleIntent('thứ 5 tuần này thì sao', scheduleHistory);

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, 'specific_weekday');
    assert.equal(intent.inheritedIntent, true);
    assert.equal(intent.parsedDayOfWeek, 4);
  });

  it('does not inherit schedule lookup for injury-risk questions', () => {
    const questions = [
      'vậy nếu tập ngực có gây chấn thương không',
      'nếu tập ngực có bị chấn thương không',
      'tập chân có gây chấn thương không',
      'hôm nay tập ngực có bị chấn thương không',
    ];

    for (const question of questions) {
      const intent = detectWorkoutScheduleIntent(question, scheduleHistory);
      assert.equal(intent.enabled, false, question);
    }
  });

  it('maps one-week schedule requests to weekly schedule lookup, not today', () => {
    const intent = detectWorkoutScheduleIntent('cho tôi lịch tập 1 tuần', scheduleHistory);

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, 'this_week');
    assert.ok(intent.weekStart);
    assert.ok(intent.weekEnd);
    assert.equal(intent.targetDate, undefined);
  });

  it('does not treat new workout-plan creation requests as saved schedule lookup', () => {
    const questions = [
      'hãy tạo cho tôi lịch tập 2 tháng tới khác với lịch hiện tại',
      'tạo cho tôi chương trình tập mới 8 tuần',
      'build a new workout plan for the next 2 months',
    ];

    for (const question of questions) {
      const intent = detectWorkoutScheduleIntent(question, scheduleHistory);
      assert.equal(intent.enabled, false, question);
    }
  });

  it('still parses short schedule follow-ups with a weekday', () => {
    const intent = detectWorkoutScheduleIntent('còn thứ 6 thì sao', scheduleHistory);

    assert.equal(intent.enabled, true);
    assert.equal(intent.target, 'specific_weekday');
    assert.equal(intent.parsedDayOfWeek, 5);
  });
});
