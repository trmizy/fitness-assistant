/**
 * 14B.2 — coach-side rules (web ClientFitnessSummaryCard / ClientProgressCard / PTClientDetail /
 * AssignPlanModal), pinned.
 *
 * Chạy: npx tsx --test src/features/__tests__/ptCoach.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attentionItems,
  canPtActOnNutrition,
  canTriggerDietBreak,
  parseModifyGoal,
  weightTrend,
} from "../pt/coachClient";
import {
  daysFromAiDraft,
  emptyDay,
  nextFreeWeekday,
  planDraftError,
  planDraftPayload,
  removeDayAt,
  type DraftDay,
} from "../pt/planDraft";
import type { CoachClientSummary } from "../../services/api";

const summary = (over: any = {}): CoachClientSummary =>
  ({
    activeCycle: { id: "c1" },
    cycleSummary: null,
    feedbackSummary: null,
    priorDecisions: [],
    nutrition: { activeGoal: { calories: 2000 }, latestNutritionDecision: null, consistency: null },
    ...over,
  }) as unknown as CoachClientSummary;

describe("attentionItems", () => {
  it("lists only what the fetched data shows", () => {
    assert.deepEqual(attentionItems(null, summary()), []);
    const items = attentionItems(
      { activeRoadmap: { trainingReadiness: { status: "NEEDS_GENERATION" } }, pendingDraft: { id: "d" } },
      summary({
        cycleSummary: { adherence: { completed: 0, total: 3, percent: 0 } },
        nutrition: { activeGoal: {}, consistency: { status: "MACRO_MISMATCH" }, latestNutritionDecision: { canPtAct: true } },
      }),
    );
    assert.deepEqual(items, [
      "Chu kỳ mới chưa có lịch tập",
      "Đang chờ khách hàng duyệt lộ trình đề xuất",
      "Kế hoạch dinh dưỡng đã lệch mục tiêu hiện tại",
      "Có đề xuất dinh dưỡng từ AI đang chờ PT xem xét",
      "Tuân thủ tập luyện đang thấp",
    ]);
  });

  it("low adherence needs at least 3 scheduled sessions and a real percent", () => {
    const at = (adherence: any) => attentionItems(null, summary({ cycleSummary: { adherence } }));
    assert.deepEqual(at({ completed: 0, total: 2, percent: 0 }), []);
    assert.deepEqual(at({ completed: 0, total: 5, percent: null }), []);
    assert.deepEqual(at({ completed: 3, total: 5, percent: 60 }), []);
  });
});

describe("nutrition actions", () => {
  it("approve/modify/reject only for a pending proposal on an active cycle", () => {
    const pending = { nutrition: { activeGoal: {}, latestNutritionDecision: { canPtAct: true } } };
    assert.equal(canPtActOnNutrition(summary(pending)), true);
    assert.equal(canPtActOnNutrition(summary({ ...pending, activeCycle: null })), false);
    assert.equal(canPtActOnNutrition(summary()), false);
  });

  it("diet-break trigger needs a cycle and a goal, and nothing pending (web forgot the cycle)", () => {
    assert.equal(canTriggerDietBreak(summary()), true);
    assert.equal(canTriggerDietBreak(summary({ activeCycle: null })), false);
    assert.equal(canTriggerDietBreak(summary({ nutrition: { activeGoal: null } })), false);
    assert.equal(canTriggerDietBreak(summary({ nutrition: { activeGoal: {}, latestNutritionDecision: { canPtAct: true } } })), false);
  });

  it("modify form: rounds calories, rejects empty or non-positive fields", () => {
    assert.deepEqual(parseModifyGoal({ calories: "2100.6", protein: "150", carbs: "200,5", fat: "65" }), {
      ok: true,
      goal: { calories: 2101, protein: 150, carbs: 200.5, fat: 65 },
    });
    assert.equal(parseModifyGoal({ calories: "", protein: "150", carbs: "200", fat: "65" }).ok, false);
    assert.equal(parseModifyGoal({ calories: "2000", protein: "0", carbs: "200", fat: "65" }).ok, false);
  });
});

describe("weightTrend", () => {
  it("newest minus oldest over the recent entries (real john.doe data: 71.3 after 88.7)", () => {
    const p = { latest: null, recent: [{ weight: 71.3 }, { weight: 88.7 }] } as any;
    assert.deepEqual(weightTrend(p), { down: true, text: "Giảm 17.4 kg qua 2 lần đo gần nhất" });
    assert.equal(weightTrend({ latest: null, recent: [{ weight: 70 }] } as any), null);
  });
});

describe("planDraft", () => {
  const ex = { exerciseId: "e1", name: "Squat", sets: 3, reps: 10, restSeconds: 90 };

  it("weekdays: Monday first, each used once; removing renumbers", () => {
    const days: DraftDay[] = [emptyDay(1, 1), emptyDay(2, 2)];
    assert.equal(nextFreeWeekday(days), 3);
    assert.equal(nextFreeWeekday([1, 2, 3, 4, 5, 6].map((w, i) => emptyDay(i + 1, w))), 0);
    assert.deepEqual(removeDayAt([emptyDay(1, 1), emptyDay(2, 3), emptyDay(3, 5)], 0).map((d) => [d.dayNumber, d.weekday]), [
      [1, 3],
      [2, 5],
    ]);
    assert.equal(removeDayAt([emptyDay(1, 1)], 0).length, 1);
  });

  it("errors match what both endpoints refuse", () => {
    assert.equal(planDraftError(" ", [{ ...emptyDay(1, 1), exercises: [ex] }]), "Đặt tên cho kế hoạch.");
    assert.equal(planDraftError("A", [emptyDay(1, 1)]), "Mỗi buổi cần ít nhất một bài tập.");
    assert.equal(
      planDraftError("A", [{ ...emptyDay(1, 1), exercises: [ex] }, { ...emptyDay(2, 1), exercises: [ex] }]),
      "Mỗi buổi phải chọn một ngày trong tuần khác nhau.",
    );
    assert.equal(planDraftError("A", [{ ...emptyDay(1, 1), exercises: [ex] }]), null);
  });

  it("payload: 1-based order, weekdays, clamped weeks, blank goal left out", () => {
    const p = planDraftPayload({
      name: " Kế hoạch ",
      goal: "  ",
      durationWeeks: "",
      defaultWeeks: 4,
      startDate: "2026-10-05",
      days: [{ dayNumber: 1, title: " ", weekday: 6, exercises: [ex, { ...ex, exerciseId: "e2" }] }],
    });
    assert.equal(p.name, "Kế hoạch");
    assert.equal(p.goal, undefined);
    assert.equal(p.durationWeeks, 4);
    assert.deepEqual(p.selectedWeekdays, [6]);
    assert.equal(p.days[0].title, "Buổi 1");
    assert.deepEqual(p.days[0].exercises.map((e) => e.order), [1, 2]);
    assert.equal(planDraftPayload({ name: "x", durationWeeks: "99", defaultWeeks: 4, startDate: "", days: [] }).durationWeeks, 52);
  });

  it("AI draft keeps chosen weekdays and never duplicates one", () => {
    const prev = [emptyDay(1, 2), emptyDay(2, 2 /* stale duplicate */)];
    const out = daysFromAiDraft(prev, [
      { title: "A", exercises: [{ exerciseId: "e1", exerciseName: "Squat", sets: 4, reps: 6 }] },
      { title: "", exercises: [] },
      { exercises: [] },
    ]);
    assert.deepEqual(out.map((d) => d.weekday), [2, 1, 3]);
    assert.deepEqual(out.map((d) => d.title), ["A", "Buổi 2", "Buổi 3"]);
    assert.deepEqual(out[0].exercises[0], { exerciseId: "e1", name: "Squat", sets: 4, reps: 6, restSeconds: 90 });
  });
});
