import type { BadgeTone } from "../../components/ui/Badge";
import type { CoachClientProgress, CoachClientSummary } from "../../services/api";

/**
 * 14B.2 (PG-A5) — the pure half of web's `ClientFitnessSummaryCard`, `ClientProgressCard` and the
 * "Cần chú ý" list of `PTClientDetail`. Labels are web's. Every value shown comes from
 * `/coach/clients/:id/summary|progress`; nothing here scores or decides — `CycleAssessment` owns
 * adaptation decisions and `NutritionGoal` owns calories, the coach only acts through the audited
 * approve / modify / reject / trigger endpoints.
 */

export const PT_DECISION_LABEL: Record<string, string> = {
  KEEP: "Giữ nguyên",
  PROGRESS: "Tăng tải",
  ADJUST: "Điều chỉnh",
  DELOAD: "Giảm tải",
  REBUILD: "Xây lại",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};

export const PT_NUTRITION_DECISION_LABEL: Record<string, string> = {
  KEEP_PLAN: "Giữ nguyên",
  PROPOSE_ADJUSTMENT: "Đề xuất điều chỉnh",
  PROPOSE_DIET_BREAK: "Đề xuất nghỉ diet break",
  REQUEST_MORE_DATA: "Cần thêm dữ liệu",
  EARLY_REVIEW: "Đánh giá sớm",
  ESCALATE: "Cần chuyên gia",
};

export const NUTRITION_TRIGGER_LABEL: Record<string, string> = {
  ONBOARDING: "Tự động (onboarding)",
  MANUAL: "Người dùng tự đặt",
  AI_ADAPTIVE: "AI điều chỉnh",
  PT: "PT thiết lập",
};

export const NUTRITION_USER_DECISION_LABEL: Record<string, string> = {
  PENDING: "chưa xem xét",
  ACCEPTED: "đã chấp nhận",
  REJECTED: "đã từ chối",
  MODIFIED_BY_PT: "đã được PT điều chỉnh",
};

export const CONSISTENCY_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  MATCHED: { label: "Khớp mục tiêu", tone: "success" },
  STALE_GOAL_CHANGED: { label: "Mục tiêu đã đổi — thực đơn cũ", tone: "warning" },
  MACRO_MISMATCH: { label: "Lệch mục tiêu", tone: "warning" },
  NO_ACTIVE_GOAL: { label: "Chưa có mục tiêu", tone: "neutral" },
  NO_ACTIVE_PROGRAM: { label: "Chưa có thực đơn", tone: "neutral" },
  LOW_CONFIDENCE: { label: "Chưa đủ dữ liệu so sánh", tone: "neutral" },
};

export const labelOr = (map: Record<string, string>, key: string | null | undefined, fallback = "—") =>
  key ? (map[key] ?? key) : fallback;

/**
 * Web's "Cần chú ý" list: derived only from data the screen already fetched (roadmap readiness,
 * pending draft, nutrition consistency, a pending AI proposal, low adherence). No new scoring.
 */
export function attentionItems(
  roadmap: { activeRoadmap?: { trainingReadiness?: { status?: string } | null } | null; pendingDraft?: unknown } | null | undefined,
  summary: CoachClientSummary | null | undefined,
): string[] {
  const items: string[] = [];
  if (roadmap?.activeRoadmap?.trainingReadiness?.status === "NEEDS_GENERATION") items.push("Chu kỳ mới chưa có lịch tập");
  if (roadmap?.pendingDraft) items.push("Đang chờ khách hàng duyệt lộ trình đề xuất");
  const consistency = summary?.nutrition?.consistency?.status;
  if (consistency === "MACRO_MISMATCH" || consistency === "STALE_GOAL_CHANGED") {
    items.push("Kế hoạch dinh dưỡng đã lệch mục tiêu hiện tại");
  }
  if (summary?.nutrition?.latestNutritionDecision?.canPtAct) items.push("Có đề xuất dinh dưỡng từ AI đang chờ PT xem xét");
  const adherence = summary?.cycleSummary?.adherence;
  if (adherence && adherence.total >= 3 && adherence.percent != null && adherence.percent < 50) {
    items.push("Tuân thủ tập luyện đang thấp");
  }
  return items;
}

/** A coach may approve / modify / reject only a real, still-pending proposal on the active cycle. */
export function canPtActOnNutrition(summary: CoachClientSummary | null | undefined): boolean {
  return !!summary?.activeCycle?.id && !!summary?.nutrition?.latestNutritionDecision?.canPtAct;
}

/**
 * Web offers "Đề xuất diet break" whenever a goal exists and nothing is pending — even with no
 * active cycle, which then posts to `/cycles/undefined/...`. The trigger is per cycle, so it also
 * needs one. The server still decides eligibility (weight-loss cycle, maintenance above goal…).
 */
export function canTriggerDietBreak(summary: CoachClientSummary | null | undefined): boolean {
  return !!summary?.activeCycle?.id && !!summary?.nutrition?.activeGoal && !canPtActOnNutrition(summary);
}

/** Web's progress line: newest minus oldest of the recent entries (server returns newest first). */
export function weightTrend(progress: CoachClientProgress | null | undefined): { text: string; down: boolean } | null {
  const recent = progress?.recent ?? [];
  if (recent.length < 2) return null;
  const delta = recent[0].weight - recent[recent.length - 1].weight;
  return {
    down: delta < 0,
    text: `${delta < 0 ? "Giảm" : "Tăng"} ${Math.abs(delta).toFixed(1)} kg qua ${recent.length} lần đo gần nhất`,
  };
}

export interface ModifyGoalForm {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

/**
 * The coach's explicit calorie/macro patch (web's ModifyNutritionSheet). Web sends whatever was
 * typed; here an empty or non-positive field is caught before the request — the server still
 * validates macro consistency and the safety floor.
 */
export function parseModifyGoal(form: ModifyGoalForm):
  | { ok: true; goal: { calories: number; protein: number; carbs: number; fat: number } }
  | { ok: false; error: string } {
  const n = (v: string) => Number(v.replace(",", "."));
  const goal = { calories: Math.round(n(form.calories)), protein: n(form.protein), carbs: n(form.carbs), fat: n(form.fat) };
  if (Object.values(goal).some((v) => !Number.isFinite(v) || v <= 0)) {
    return { ok: false, error: "Nhập đủ calo, đạm, tinh bột và chất béo (số dương)." };
  }
  return { ok: true, goal };
}
