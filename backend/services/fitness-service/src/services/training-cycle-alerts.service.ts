import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { InBodyEntrySnapshot } from "../clients/user.client";
import type { AdherenceMetric, RpeTrend } from "./training-cycle-metrics.service";

export interface CycleAlert {
  code: string;
  severity: "info" | "warning";
  message: string;
  createdAt: string;
}

/**
 * Early-warning rules — run whenever a new InBody entry lands or at the end
 * of a tracking week. All thresholds come from cycle-thresholds.config.ts,
 * never hard-coded here.
 */
export function evaluateAlerts(params: {
  goal: string | null;
  inBodySeries: InBodyEntrySnapshot[];
  adherence: AdherenceMetric;
  rpeTrend: RpeTrend;
  weekOfCycle: number;
}): CycleAlert[] {
  const { goal, inBodySeries, adherence, rpeTrend, weekOfCycle } = params;
  const t = cycleThresholds.alerts;
  const alerts: CycleAlert[] = [];
  const now = new Date().toISOString();

  // Rule: bulk goal, weight dropped on N consecutive measurements → likely calorie deficit
  if (goal === "MUSCLE_GAIN" && inBodySeries.length >= t.bulkWeightLossConsecutiveEntries + 1) {
    const recent = inBodySeries.slice(-(t.bulkWeightLossConsecutiveEntries + 1));
    let allDropping = true;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].weight >= recent[i - 1].weight) {
        allDropping = false;
        break;
      }
    }
    if (allDropping) {
      alerts.push({
        code: "BULK_WEIGHT_DROPPING",
        severity: "warning",
        message: `Cân nặng giảm ở ${t.bulkWeightLossConsecutiveEntries} lần đo liên tiếp trong khi mục tiêu là tăng cơ — có thể đang thiếu calo so với mục tiêu.`,
        createdAt: now,
      });
    }
  }

  // Rule: cut goal, body fat % not dropping after N weeks
  if (goal === "WEIGHT_LOSS" && weekOfCycle >= t.cutStalledWeeks && inBodySeries.length >= 2) {
    const first = inBodySeries[0];
    const last = inBodySeries[inBodySeries.length - 1];
    if (first.bodyFatPct != null && last.bodyFatPct != null && last.bodyFatPct >= first.bodyFatPct) {
      alerts.push({
        code: "CUT_PBF_STALLED",
        severity: "warning",
        message: `Tỉ lệ mỡ cơ thể không giảm sau ${t.cutStalledWeeks} tuần — nên xem lại mức deficit calo.`,
        createdAt: now,
      });
    }
  }

  // Rule: RPE trending up for N consecutive weeks → accumulated fatigue
  if (rpeTrend.trend === "increasing" && rpeTrend.weeklyAvg.length >= t.fatigueRpeIncreaseWeeks) {
    alerts.push({
      code: "FATIGUE_RPE_RISING",
      severity: "warning",
      message: `RPE trung bình tăng dần trong ${t.fatigueRpeIncreaseWeeks} tuần liên tiếp — cân nhắc giảm tải hoặc thêm nghỉ ngơi.`,
      createdAt: now,
    });
  }

  // Rule: adherence low by week 2 — null (no scheduled sessions at all) is
  // absence of data, not evidence of low adherence, so it must never fire
  // this alert (same principle as classifyAdherence's null handling).
  if (weekOfCycle >= 2 && adherence.percent != null && adherence.percent < t.lowAdherencePctAtWeek2) {
    alerts.push({
      code: "LOW_ADHERENCE",
      severity: "warning",
      message: `Tỉ lệ tuân thủ lịch tập chỉ ${adherence.percent}% ở tuần ${weekOfCycle} — lịch tập hiện tại có thể chưa hợp với thời gian biểu.`,
      createdAt: now,
    });
  }

  return alerts;
}
