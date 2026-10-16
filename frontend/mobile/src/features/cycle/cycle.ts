import type { BadgeTone } from "../../components/ui/Badge";
import type { AdaptiveCycleDecision, CycleDecision, CycleReport, TrainingCycle } from "../../services/api";

/**
 * 14B.1 (PG-A1) — the pure half of web's `TrainingCyclePage`: labels, tiers and selection rules.
 * Every label is web's own (which mirrors fitness-service's tables); nothing here decides anything
 * — the decision comes from fitness-service's Decision Engine (`CycleAssessment`), this only names it.
 */

export function formatCycleDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export const TREND_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  PROGRESSING: { label: "Đang tiến triển tốt", tone: "success" },
  PLATEAU: { label: "Chững lại", tone: "warning" },
  DECLINING: { label: "Đang sụt giảm", tone: "danger" },
};

/** The 4 values of the older /complete flow; PROGRESS/DELOAD/REBUILD use ADAPTIVE_DECISION. */
export const LEGACY_DECISION: Partial<Record<CycleDecision, { label: string; tone: BadgeTone }>> = {
  KEEP: { label: "Giữ nguyên lịch tập", tone: "success" },
  ADJUST: { label: "Điều chỉnh lịch tập", tone: "warning" },
  NEW_PLAN: { label: "Đổi sang kế hoạch mới", tone: "danger" },
  INSUFFICIENT_DATA: { label: "Chưa đủ dữ liệu để đánh giá", tone: "neutral" },
};

export const ADAPTIVE_DECISION: Record<AdaptiveCycleDecision, { label: string; tone: BadgeTone }> = {
  KEEP: { label: "Giữ nguyên", tone: "success" },
  PROGRESS: { label: "Tăng tải", tone: "success" },
  ADJUST: { label: "Điều chỉnh nhỏ", tone: "warning" },
  DELOAD: { label: "Giảm tải (deload)", tone: "warning" },
  REBUILD: { label: "Xây lại chương trình", tone: "danger" },
  INSUFFICIENT_DATA: { label: "Chưa đủ dữ liệu", tone: "neutral" },
};

export type NutritionDecision =
  | "KEEP_PLAN"
  | "PROPOSE_ADJUSTMENT"
  | "PROPOSE_DIET_BREAK"
  | "REQUEST_MORE_DATA"
  | "EARLY_REVIEW"
  | "ESCALATE";

export const NUTRITION_DECISION: Record<NutritionDecision, { label: string; tone: BadgeTone }> = {
  KEEP_PLAN: { label: "Giữ nguyên dinh dưỡng", tone: "success" },
  PROPOSE_ADJUSTMENT: { label: "Đề xuất điều chỉnh", tone: "warning" },
  PROPOSE_DIET_BREAK: { label: "Đề xuất nghỉ diet break", tone: "info" },
  REQUEST_MORE_DATA: { label: "Cần thêm dữ liệu", tone: "neutral" },
  EARLY_REVIEW: { label: "Cần xem xét sớm", tone: "danger" },
  ESCALATE: { label: "Cần chuyên gia xem xét", tone: "danger" },
};

/** Only these two nutrition decisions carry something to apply; the rest are just acknowledged. */
export function nutritionHasProposal(decision: string | null | undefined): boolean {
  return decision === "PROPOSE_ADJUSTMENT" || decision === "PROPOSE_DIET_BREAK";
}

/** The decision name for a cycle row, whichever engine produced it. */
export function cycleDecisionLabel(decision: string | null | undefined): string | null {
  if (!decision) return null;
  return (
    LEGACY_DECISION[decision as CycleDecision]?.label ??
    ADAPTIVE_DECISION[decision as AdaptiveCycleDecision]?.label ??
    decision
  );
}

/** confidenceScore is a heuristic (data quality × decision strength), never a probability — shown as a tier. */
export function confidenceTier(score: number): "Cao" | "Trung bình" | "Thấp" {
  if (score >= 0.7) return "Cao";
  if (score >= 0.4) return "Trung bình";
  return "Thấp";
}

export const CONFIDENCE_TIER_LABEL: Record<string, string> = { HIGH: "Cao", MEDIUM: "Trung bình", LOW: "Thấp" };

export function fieldTrendLabel(
  trend: { direction: "up" | "flat" | "down"; changePerWeek: number | null } | null | undefined,
): string {
  if (!trend) return "Chưa đủ dữ liệu";
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→";
  const rate = trend.changePerWeek != null ? ` (${trend.changePerWeek > 0 ? "+" : ""}${trend.changePerWeek}/tuần)` : "";
  return `${arrow}${rate}`;
}

export function rpeTrendLabel(trend: string | null | undefined): string {
  return trend === "increasing" ? "↑ tăng" : trend === "decreasing" ? "↓ giảm" : "→ ổn định";
}

export const pct = (ratio: number | null | undefined) => (ratio == null ? null : Math.round(ratio * 100));

export const FEEDBACK_SENTIMENT: Record<string, { label: string; tone: BadgeTone }> = {
  positive: { label: "Tích cực", tone: "success" },
  negative: { label: "Tiêu cực", tone: "danger" },
  neutral: { label: "Trung tính", tone: "neutral" },
  mixed: { label: "Lẫn lộn", tone: "warning" },
  insufficient_feedback: { label: "Chưa đủ dữ liệu", tone: "neutral" },
};

export const FEEDBACK_FLAG: Record<string, string> = {
  HIGH_PAIN_REPORTED: "Có báo cáo đau nhiều (≥7/10)",
  EXERCISE_SPECIFIC_PAIN_REPORTS: "Có bài tập gây đau cụ thể",
  REPEATED_EQUIPMENT_UNAVAILABLE: "Thiếu dụng cụ lặp lại nhiều lần",
  REPEATED_SCHEDULE_CONFLICT: "Bỏ buổi do lịch bận nhiều lần",
  SKIPPING_DUE_TO_DIFFICULTY: "Bỏ buổi vì bài tập quá khó",
  REPEATED_BOREDOM_REPORTS: "Phản hồi nhàm chán lặp lại",
  REPEATED_MOTIVATION_SKIPS: "Bỏ buổi do thiếu động lực nhiều lần",
};

export const REPORT_FLAG: Record<string, string> = {
  PROTEIN_BELOW_TARGET: "Nạp protein trung bình thấp hơn mục tiêu cá nhân",
  PROTEIN_BELOW_EVIDENCE_RANGE: "Protein trung bình dưới ngưỡng khoa học cho tăng cơ (1.6–2.2g/kg thể trọng)",
  FREQUENT_SKIPPED_MEALS: "Bỏ bữa khá thường xuyên",
  FREQUENT_MISSED_SESSIONS: "Bỏ lỡ nhiều buổi tập hơn số buổi hoàn thành",
  PAIN_REPORTED: "Có buổi tập ghi nhận đau đáng kể (≥5/10)",
  HIGH_TRAINING_MONOTONY: "Lịch tập thiếu biến thiên (training monotony ≥2.0) — có thể tăng nguy cơ quá tải",
  RAPID_VOLUME_INCREASE: "Khối lượng tập tăng đột ngột (>50%) giữa 2 tuần liên tiếp",
};

/** "Cách tính" text for each computed tile — web shows these on every stat (none is a lab measurement). */
export const FORMULA = {
  adherence:
    "Số buổi có trạng thái Hoàn thành ÷ tổng số buổi đã lên lịch trong chu kỳ tính đến hiện tại (hoặc đến ngày kết thúc nếu chu kỳ đã đóng). Không tính buổi trong tương lai chưa tới hạn. Hiển thị 'Chưa có dữ liệu' khi chưa có buổi nào được lên lịch — không phải 0%.",
  workoutsPerWeek: "Tổng số buổi đã hoàn thành ÷ số tuần đã trôi qua kể từ ngày bắt đầu chu kỳ.",
  strength:
    "Điểm tổng hợp (không phải số đo lâm sàng) từ % thay đổi e1RM ước tính của từng bài giữa tuần đầu và tuần cuối có dữ liệu: -20% -> 0%, 0% -> 50%, +20% -> 100% (giới hạn 0-100%). Bài tập được đánh dấu ưu tiên tính gấp đôi trọng số. Đây là chỉ số thiết kế để hỗ trợ theo dõi xu hướng, không phải kết luận y khoa.",
  dataQuality:
    "Kết hợp mức độ đầy đủ của nhật ký tập (trọng số 50%), số lần đo InBody có thể so sánh được (35%), và mức đầy đủ của phản hồi cảm nhận buổi tập RPE/đau (15%). Càng thấp nghĩa là kết luận của AI càng cần được xem là tham khảo, chưa chắc chắn.",
  feedbackCount:
    "Số buổi có bản ghi phản hồi thật (không tính buổi bị bỏ qua đánh dấu 'không phản hồi') ÷ tổng số buổi đã hoàn thành/bỏ qua/hủy trong chu kỳ.",
  avgRating: "Trung bình cộng sessionRating (1-5) của các buổi có phản hồi.",
  avgPain: "Trung bình cộng painScore (0-10) của các buổi có phản hồi.",
  feedbackQuality:
    "feedbackCompletionRate × min(1, số buổi phản hồi ÷ 3). Thấp nghĩa là các kết luận dựa trên phản hồi này còn ít tin cậy.",
} as const;

/**
 * Which cycle the page is about (web's rule): the ACTIVE one, else the newest closed one
 * (COMPLETED/ANALYZED). The stale "start next cycle" proposal only shows with no active cycle.
 */
export function pickRelevantCycle(cycles: TrainingCycle[]): {
  active: TrainingCycle | null;
  recentClosed: TrainingCycle | null;
  relevantId: string | null;
  history: TrainingCycle[];
} {
  const active = cycles.find((c) => c.status === "ACTIVE") ?? null;
  const recentClosed = cycles.find((c) => c.status === "COMPLETED" || c.status === "ANALYZED") ?? null;
  return {
    active,
    recentClosed,
    relevantId: active?.id ?? recentClosed?.id ?? null,
    history: cycles.filter((c) => c.status !== "ACTIVE"),
  };
}

export function elapsedPercent(cycle: Pick<TrainingCycle, "startDate" | "durationDays">, now = Date.now()): number {
  const days = Math.floor((now - new Date(cycle.startDate).getTime()) / 86_400_000);
  return Math.max(0, Math.min(100, Math.round((days / Math.max(1, cycle.durationDays)) * 100)));
}

/** Web: the legacy "analysing" spinner gets an escape hatch after 2 minutes. */
export const LEGACY_ANALYSIS_STUCK_MS = 2 * 60 * 1000;

/** One line per exercise, using whichever metric that exercise's logging mode supports — never a blended number. */
export function plannedVsActualLine(ex: CycleReport["plannedVsActual"]["byExercise"][number]): string | null {
  if (ex.plannedVolumeKg != null) return `${Math.round(ex.actualVolumeKg ?? 0)} / ${Math.round(ex.plannedVolumeKg)} kg`;
  if (ex.plannedReps != null) return `${ex.actualReps ?? 0} / ${ex.plannedReps} reps`;
  if (ex.plannedDurationSeconds != null) return `${ex.actualDurationSeconds ?? 0} / ${ex.plannedDurationSeconds}s`;
  if (ex.actualDistanceMeters != null) return `${Math.round(ex.actualDistanceMeters)}m (chưa có mục tiêu quãng đường)`;
  return null;
}
