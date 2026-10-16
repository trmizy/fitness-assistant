import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTIVE_DECISION,
  confidenceTier,
  cycleDecisionLabel,
  elapsedPercent,
  fieldTrendLabel,
  formatCycleDate,
  nutritionHasProposal,
  pickRelevantCycle,
  plannedVsActualLine,
} from "../cycle/cycle";
import type { TrainingCycle } from "../../services/api";

/**
 * 14B.1 — the rules web's TrainingCyclePage applies, pinned so the phone cannot drift from them.
 *
 * Chạy: npx tsx --test src/features/__tests__/cycle.test.ts
 */

const cycle = (id: string, status: TrainingCycle["status"]) => ({ id, status }) as TrainingCycle;

describe("pickRelevantCycle (web's page-level selection)", () => {
  it("the active cycle wins; history excludes it but keeps closed and cancelled ones", () => {
    const r = pickRelevantCycle([cycle("a", "ACTIVE"), cycle("b", "ANALYZED"), cycle("c", "CANCELLED")]);
    assert.equal(r.active?.id, "a");
    assert.equal(r.recentClosed?.id, "b");
    assert.equal(r.relevantId, "a");
    assert.deepEqual(r.history.map((c) => c.id), ["b", "c"]);
  });

  it("without an active cycle the newest COMPLETED/ANALYZED one is relevant; a cancelled one never is", () => {
    assert.equal(pickRelevantCycle([cycle("c", "CANCELLED"), cycle("d", "COMPLETED")]).relevantId, "d");
    assert.equal(pickRelevantCycle([cycle("c", "CANCELLED")]).relevantId, null);
    assert.equal(pickRelevantCycle([]).relevantId, null);
  });
});

describe("labels", () => {
  it("confidence is a tier, never a percentage", () => {
    assert.equal(confidenceTier(0.7), "Cao");
    assert.equal(confidenceTier(0.69), "Trung bình");
    assert.equal(confidenceTier(0.4), "Trung bình");
    assert.equal(confidenceTier(0.39), "Thấp");
  });

  it("names a decision from either engine; unknown values pass through", () => {
    assert.equal(cycleDecisionLabel("NEW_PLAN"), "Đổi sang kế hoạch mới");
    assert.equal(cycleDecisionLabel("DELOAD"), ADAPTIVE_DECISION.DELOAD.label);
    assert.equal(cycleDecisionLabel("KEEP"), "Giữ nguyên lịch tập");
    assert.equal(cycleDecisionLabel("SOMETHING_NEW"), "SOMETHING_NEW");
    assert.equal(cycleDecisionLabel(null), null);
  });

  it("field trends: arrow plus signed weekly rate, or 'not enough data'", () => {
    assert.equal(fieldTrendLabel({ direction: "up", changePerWeek: 0.4 }), "↑ (+0.4/tuần)");
    assert.equal(fieldTrendLabel({ direction: "down", changePerWeek: -0.2 }), "↓ (-0.2/tuần)");
    assert.equal(fieldTrendLabel({ direction: "flat", changePerWeek: null }), "→");
    assert.equal(fieldTrendLabel(null), "Chưa đủ dữ liệu");
  });

  it("only adjustment and diet-break proposals carry something to apply", () => {
    assert.equal(nutritionHasProposal("PROPOSE_ADJUSTMENT"), true);
    assert.equal(nutritionHasProposal("PROPOSE_DIET_BREAK"), true);
    for (const d of ["KEEP_PLAN", "REQUEST_MORE_DATA", "EARLY_REVIEW", "ESCALATE", null]) {
      assert.equal(nutritionHasProposal(d), false);
    }
  });

  it("formats dates dd/mm/yyyy and tolerates missing ones", () => {
    assert.equal(formatCycleDate("2026-10-03T00:00:00"), "03/10/2026");
    assert.equal(formatCycleDate(null), "—");
    assert.equal(formatCycleDate("not a date"), "—");
  });
});

describe("elapsedPercent", () => {
  const start = new Date("2026-10-01T00:00:00").getTime();
  it("is day-grained and clamped to 0..100", () => {
    const c = { startDate: "2026-10-01T00:00:00", durationDays: 28 };
    assert.equal(elapsedPercent(c, start + 7 * 86_400_000), 25);
    assert.equal(elapsedPercent(c, start + 7 * 86_400_000 - 1), 21); // 6 full days
    assert.equal(elapsedPercent(c, start + 60 * 86_400_000), 100);
    assert.equal(elapsedPercent(c, start - 86_400_000), 0);
  });
});

describe("plannedVsActualLine (one metric per logging mode, never blended)", () => {
  const base = {
    exerciseId: "e",
    exerciseName: "Squat",
    loggingMode: "WEIGHT_REPS",
    sessionsPlanned: 4,
    plannedVolumeKg: null,
    actualVolumeKg: null,
    plannedReps: null,
    actualReps: null,
    plannedDurationSeconds: null,
    actualDurationSeconds: null,
    actualDistanceMeters: null,
  };
  it("prefers volume, then reps, then duration, then distance", () => {
    assert.equal(plannedVsActualLine({ ...base, plannedVolumeKg: 2400.4, actualVolumeKg: 1999.6, plannedReps: 40 }), "2000 / 2400 kg");
    assert.equal(plannedVsActualLine({ ...base, plannedReps: 40, actualReps: null }), "0 / 40 reps");
    assert.equal(plannedVsActualLine({ ...base, plannedDurationSeconds: 600, actualDurationSeconds: 540 }), "540 / 600s");
    assert.equal(plannedVsActualLine({ ...base, actualDistanceMeters: 5012.7 }), "5013m (chưa có mục tiêu quãng đường)");
    assert.equal(plannedVsActualLine(base), null);
  });
});
