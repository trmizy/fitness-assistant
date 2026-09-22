/**
 * WB-11 — pure parts of the FitnessRoadmap journey + guided wizard, ported from web's
 * `RoadmapJourneyPage.tsx` / `GuidedRoadmapWizard.tsx`.
 *
 * The roadmap is orchestration only. Calories/macros stay on NutritionGoal, the measured body on
 * InBody, adaptation decisions on CycleAssessment; every forecast number here is a SCENARIO the
 * server computed and is always labelled as an estimate. Only the client activates / advances /
 * rebuilds / archives their own roadmap — the server enforces it; these helpers only shape data.
 */
import type {
  FitnessDiagnosisInput,
  FitnessRoadmapProjection,
  PhaseForecastResult,
  RoadmapPhaseType,
  RoadmapPhaseWithCycles,
  StrategyBucket,
} from "../../services/api";

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type ActivityLevel = "SEDENTARY" | "LIGHTLY_ACTIVE" | "MODERATELY_ACTIVE" | "VERY_ACTIVE" | "EXTREMELY_ACTIVE";
export type BodyFatMethod = "manual" | "visual_reference" | "inbody";
export type GoalKey = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";

export const ACTIVITY_OPTIONS: { key: ActivityLevel; label: string; hint: string }[] = [
  { key: "SEDENTARY", label: "Ít vận động", hint: "Công việc bàn giấy, gần như không tập" },
  { key: "LIGHTLY_ACTIVE", label: "Vận động nhẹ", hint: "Tập 1-3 buổi/tuần" },
  { key: "MODERATELY_ACTIVE", label: "Vận động vừa", hint: "Tập 3-5 buổi/tuần" },
  { key: "VERY_ACTIVE", label: "Năng động", hint: "Tập 6-7 buổi/tuần" },
  { key: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động", hint: "Vận động viên, lao động chân tay nặng" },
];

export const GOAL_OPTIONS: { key: GoalKey; label: string; emoji: string; desc: string }[] = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥", desc: "Giảm tỷ lệ mỡ cơ thể, giữ khối cơ" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪", desc: "Tăng khối cơ có kiểm soát" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️", desc: "Giữ ổn định hình thể hiện tại" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao", emoji: "🏆", desc: "Ưu tiên sức mạnh/hiệu suất tập luyện" },
];

export const VISUAL_REFERENCE_OPTIONS = [
  { pct: 12, label: "Săn chắc, thấy rõ cơ bụng", desc: "~10-14%" },
  { pct: 18, label: "Thon gọn, cơ bắp mờ", desc: "~16-20%" },
  { pct: 25, label: "Trung bình, chưa rõ cơ bắp", desc: "~23-27%" },
  { pct: 32, label: "Đầy đặn, tích mỡ rõ", desc: "~30-35%" },
];

export const PHASE_TYPE_LABEL: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Giảm mỡ",
  DIET_BREAK: "Nghỉ giữa kỳ",
  MAINTENANCE: "Duy trì",
  LEAN_GAIN: "Tăng cơ nạc",
  MINI_CUT: "Cắt ngắn",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
  PERFORMANCE: "Hiệu suất",
  RECOVERY: "Hồi phục",
};

export const PHASE_STATUS_LABEL: Record<RoadmapPhaseWithCycles["status"], { label: string; tone: "neutral" | "success" | "info" | "danger" }> = {
  PLANNED: { label: "Sắp tới", tone: "neutral" },
  ACTIVE: { label: "Đang diễn ra", tone: "success" },
  COMPLETED: { label: "Đã hoàn thành", tone: "info" },
  SKIPPED: { label: "Đã bỏ qua (thay đổi lộ trình)", tone: "neutral" },
  CANCELLED: { label: "Đã huỷ", tone: "danger" },
};

export const ROADMAP_STATUS_LABEL: Record<FitnessRoadmapProjection["roadmap"]["status"], string> = {
  DRAFT: "Bản nháp",
  ACTIVE: "Đang thực hiện",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã huỷ",
  ARCHIVED: "Đã lưu trữ",
};

export const CREATOR_ROLE_LABEL: Record<FitnessRoadmapProjection["roadmap"]["createdByRole"], string> = {
  CLIENT: "Bạn tạo",
  PT: "Được PT đề xuất",
  AI: "AI đề xuất",
  SYSTEM: "Hệ thống tạo",
};

export const STRATEGY_BUCKET_LABEL: Record<StrategyBucket, string> = {
  CUT: "Giảm mỡ",
  BUILD: "Tăng cơ / Hiệu suất",
  STABILIZE: "Chuyển tiếp / Duy trì",
};

export const ASSESSMENT_DECISION_LABEL: Record<string, string> = {
  KEEP: "Giữ nguyên",
  PROGRESS: "Tăng tải",
  ADJUST: "Điều chỉnh nhỏ",
  DELOAD: "Giảm tải (deload)",
  REBUILD: "Xây lại chương trình",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};

export const RECONCILIATION_STATUS_LABEL: Record<string, string> = {
  ON_TRACK: "Đang đúng tiến độ",
  AHEAD_OF_FORECAST: "Nhanh hơn dự kiến",
  BEHIND_FORECAST: "Tiến độ chậm hơn kịch bản ban đầu",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu để đánh giá",
};
export const CONFIDENCE_TIER_LABEL: Record<string, string> = { HIGH: "Cao", MEDIUM: "Trung bình", LOW: "Thấp" };
export const MUSCULARITY_LABEL: Record<string, string> = { LOW: "Nhẹ", MODERATE: "Vừa", HIGH: "Rõ nét" };
export const LEANNESS_LABEL: Record<string, string> = {
  MODERATE: "Cân đối",
  LEAN_APPEARANCE: "Gọn, rõ nét",
  VERY_LEAN_APPEARANCE: "Rất rõ nét (cần chuyên gia tư vấn)",
};
export const FOCUS_LABELS: Record<string, string> = {
  SHOULDERS: "Vai",
  CHEST: "Ngực",
  BACK: "Lưng",
  ARMS: "Tay",
  LEGS: "Chân",
  GLUTES: "Mông",
  GENERAL: "Toàn thân",
};

export const ADAPTIVE_NOTE =
  "Lộ trình này không cố định — sau mỗi chu kỳ tập luyện, Gymini sẽ đánh giá lại dữ liệu thực tế và có thể điều chỉnh giai đoạn, thời lượng, tập luyện và dinh dưỡng của bạn.";

// ── Formatting ────────────────────────────────────────────────────────────

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
export const fmtKcal = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} kcal`;
export const fmtKg = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg`;
export const fmtPct = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

export function trendLabel(
  trend: { direction: "up" | "flat" | "down"; changePerWeek: number | null } | null | undefined,
  unit: string,
): string | null {
  if (!trend || trend.changePerWeek == null) return null;
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→";
  return `${arrow} ${Math.abs(trend.changePerWeek).toFixed(1)}${unit}/tuần`;
}

export function deficitLabel(f: Pick<PhaseForecastResult, "projectedDeficitOrSurplusPercent">): string | null {
  const p = f.projectedDeficitOrSurplusPercent;
  if (p == null) return null;
  if (p < 0) return `Thâm hụt ~${Math.round(Math.abs(p) * 100)}%`;
  if (p > 0) return `Thặng dư ~${Math.round(p * 100)}%`;
  return "Mức duy trì";
}

// ── Journey readiness (web's getPhaseReadiness) ───────────────────────────

export type PhaseReadiness =
  | { kind: "ACTIVE_CYCLE" }
  | { kind: "PENDING_REBUILD" }
  | { kind: "ANALYZING" }
  | { kind: "INSUFFICIENT_DATA"; lastDecision: string }
  | { kind: "READY_TO_ADVANCE"; lastDecision: string }
  | { kind: "CYCLE_CANCELLED" }
  | { kind: "NO_CYCLE_YET" };

export function getPhaseReadiness(
  phase: RoadmapPhaseWithCycles,
  pendingRebuild: FitnessRoadmapProjection["pendingRebuild"],
): PhaseReadiness {
  if (phase.trainingCycles.some((c) => c.status === "ACTIVE")) return { kind: "ACTIVE_CYCLE" };
  if (pendingRebuild && pendingRebuild.phaseId === phase.id) return { kind: "PENDING_REBUILD" };
  const latest = [...phase.trainingCycles].sort((a: any, b: any) => (b.cycleIndex ?? 0) - (a.cycleIndex ?? 0))[0] as any;
  if (!latest) return { kind: "NO_CYCLE_YET" };
  if (latest.status === "COMPLETED") return { kind: "ANALYZING" };
  if (latest.status === "ANALYZED") {
    if (latest.decision === "INSUFFICIENT_DATA") return { kind: "INSUFFICIENT_DATA", lastDecision: latest.decision };
    return { kind: "READY_TO_ADVANCE", lastDecision: latest.decision ?? "" };
  }
  if (latest.status === "CANCELLED") return { kind: "CYCLE_CANCELLED" };
  return { kind: "NO_CYCLE_YET" };
}

// ── Wizard ────────────────────────────────────────────────────────────────

export type WizardBody = {
  weightKg: string;
  heightCm: string;
  age: string;
  gender: Gender | "";
  bodyFatMethod: BodyFatMethod;
  bodyFatPct: string;
  inbodyBodyFatPct: number | null;
  activityLevel: ActivityLevel | "";
  trainingDaysPerWeek: number;
  dailyGoalSteps: number;
  goal: GoalKey;
  targetWeightKg: string;
  targetBodyFatPercent: string;
  timeframeWeeks: number;
};

export function effectiveBodyFatPct(b: Pick<WizardBody, "bodyFatMethod" | "inbodyBodyFatPct" | "bodyFatPct">): number | undefined {
  if (b.bodyFatMethod === "inbody" && b.inbodyBodyFatPct != null) return b.inbodyBodyFatPct;
  if (!b.bodyFatPct.trim()) return undefined;
  const n = Number(b.bodyFatPct);
  return Number.isFinite(n) ? n : undefined;
}

/** Web's `diagnosisInput`: only what the user actually gave, numbers parsed. */
export function buildDiagnosisInput(b: WizardBody): FitnessDiagnosisInput {
  const input: FitnessDiagnosisInput = {};
  if (b.weightKg) input.weightKg = Number(b.weightKg);
  if (b.heightCm) input.heightCm = Number(b.heightCm);
  if (b.age) input.age = Number(b.age);
  if (b.gender) input.gender = b.gender;
  const bf = effectiveBodyFatPct(b);
  if (bf != null) {
    input.bodyFatPct = bf;
    input.bodyFatMethod = b.bodyFatMethod;
  }
  if (b.activityLevel) input.activityLevel = b.activityLevel;
  input.trainingDaysPerWeek = b.trainingDaysPerWeek;
  input.dailyGoalSteps = b.dailyGoalSteps;
  input.goal = b.goal;
  if (b.targetWeightKg) input.targetWeightKg = Number(b.targetWeightKg);
  if (b.targetBodyFatPercent) input.targetBodyFatPercent = Number(b.targetBodyFatPercent);
  input.timeframeWeeks = b.timeframeWeeks;
  return input;
}

export function hasMinimumEnergyInputs(b: WizardBody): boolean {
  return Boolean(b.weightKg && b.heightCm && b.age && b.gender && b.activityLevel);
}

export function wizardStepError(step: number, b: WizardBody): string | null {
  if (step === 1 && !(b.weightKg && b.heightCm && b.age && b.gender))
    return "Vui lòng nhập đủ cân nặng, chiều cao, tuổi và giới tính";
  if (step === 1) {
    const w = Number(b.weightKg);
    const h = Number(b.heightCm);
    const a = Number(b.age);
    if (!(w > 0) || !(h > 0) || !(a > 0)) return "Cân nặng, chiều cao và tuổi phải là số dương";
  }
  if (step === 2 && !b.activityLevel) return "Vui lòng chọn mức độ vận động";
  return null;
}

/** Prefill from the profile, then the latest InBody (a real measurement outranks a stored weight). */
export function prefillFromProfileAndInBody(profile: any, history: any[] | null | undefined): Partial<WizardBody> & { inbodyDate?: string | null } {
  const out: Partial<WizardBody> & { inbodyDate?: string | null } = {};
  const p = profile ?? {};
  if (p.age) out.age = String(p.age);
  if (p.gender) out.gender = p.gender;
  if (p.heightCm) out.heightCm = String(p.heightCm);
  if (p.currentWeight) out.weightKg = String(p.currentWeight);
  const latest = Array.isArray(history) ? history[0] : null;
  if (latest?.bodyFatPct != null) {
    out.inbodyBodyFatPct = latest.bodyFatPct;
    out.inbodyDate = latest.date ?? latest.dateOnly ?? null;
    out.bodyFatMethod = "inbody";
    if (latest.weight) out.weightKg = String(latest.weight);
  }
  return out;
}

export function draftTotalWeeks(phases: { plannedStartAt: string; plannedEndAt: string }[]): number {
  return phases.reduce(
    (sum, p) => sum + Math.round((new Date(p.plannedEndAt).getTime() - new Date(p.plannedStartAt).getTime()) / (7 * 86_400_000)),
    0,
  );
}

/** Forecasts grouped by the server's strategy groups (K1/K2/…), with totals for the header row. */
export function groupForecasts(result: { strategyGroups: { key: string; bucket: StrategyBucket; phaseIndexes: number[] }[]; phaseForecasts: PhaseForecastResult[] }) {
  return result.strategyGroups.map((g) => {
    const forecasts = result.phaseForecasts.filter((f) => g.phaseIndexes.includes(f.phaseIndex));
    const weeks = forecasts.reduce((s, f) => s + f.durationWeeks, 0);
    const avgKcal = forecasts.length ? Math.round(forecasts.reduce((s, f) => s + f.projectedCalories, 0) / forecasts.length) : null;
    return { ...g, forecasts, weeks, avgKcal };
  });
}

// ── Advanced (manual) create ──────────────────────────────────────────────

export type ManualPhase = { phaseType: RoadmapPhaseType; weeks: number };

const DAY_MS = 86_400_000;
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Body for `POST /fitness-roadmaps` (saved as DRAFT). Phases run back-to-back from today (no
 * overlap — the server rejects overlaps). Web's manual panel sends one phase; mobile lets the client
 * chain up to 4 using the same endpoint. Each phase's objective is `maxCycles = ceil(weeks / 4)` —
 * the same count the server itself shows as plannedCycleCount — so a manual phase can complete
 * after its planned cycles instead of never (the AI draft path sets objective.maxCycles the same way).
 */
export function buildManualRoadmap(input: { name: string; goalType: GoalKey; phases: ManualPhase[] }, today = new Date()) {
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const phases = input.phases.map((p, i) => {
    const start = cursor;
    const end = new Date(start.getTime() + p.weeks * 7 * DAY_MS);
    cursor = end;
    return {
      phaseIndex: i + 1,
      name: PHASE_TYPE_LABEL[p.phaseType],
      phaseType: p.phaseType,
      plannedStartAt: ymd(start),
      plannedEndAt: ymd(end),
      objective: { maxCycles: Math.max(1, Math.ceil(p.weeks / 4)) },
    };
  });
  return {
    name: input.name.trim() || "Lộ trình của tôi",
    goalType: input.goalType,
    plannedStartAt: phases[0]?.plannedStartAt ?? ymd(cursor),
    phases,
  };
}

export function manualRoadmapError(phases: ManualPhase[]): string | null {
  if (phases.length === 0) return "Thêm ít nhất một giai đoạn.";
  if (phases.length > 4) return "Tối đa 4 giai đoạn.";
  for (const p of phases) if (!(p.weeks >= 1 && p.weeks <= 26)) return "Mỗi giai đoạn dài từ 1 đến 26 tuần.";
  return null;
}

export function isNotFound(error: any): boolean {
  return error?.response?.status === 404;
}

export function roadmapErrorMessage(error: any, fallback: string): string {
  const e = error?.response?.data?.error;
  if (typeof e === "string") return translateRoadmapError(e);
  if (typeof e?.message === "string") return translateRoadmapError(e.message);
  return fallback;
}

/** The fitness-service roadmap routes answer in English; the client reads Vietnamese. */
const ROADMAP_ERRORS_VI: Record<string, string> = {
  "No completed cycle is ready for roadmap advancement":
    "Chưa có chu kỳ tập nào hoàn thành trong giai đoạn này — hãy tập theo lịch, khi chu kỳ kết thúc và được đánh giá thì mới chuyển giai đoạn được.",
  "Roadmap has no active phase": "Lộ trình chưa có giai đoạn nào đang diễn ra.",
  "Another roadmap is already ACTIVE": "Bạn đang có một lộ trình khác đang chạy.",
  "An active legacy cycle already exists; close it before activating a roadmap phase":
    "Bạn đang có một chu kỳ tập chạy riêng ngoài lộ trình — hãy kết thúc chu kỳ đó trước khi bắt đầu lộ trình.",
  "Cannot archive a roadmap while a phase is ACTIVE": "Không thể lưu trữ khi còn giai đoạn đang diễn ra.",
  "Cannot archive a roadmap while a training cycle is ACTIVE": "Không thể lưu trữ khi còn chu kỳ tập đang chạy.",
  "Roadmap phase dates must not overlap": "Các giai đoạn không được trùng thời gian.",
  "Roadmap is archived": "Lộ trình này đã được lưu trữ.",
};
export function translateRoadmapError(message: string): string {
  return ROADMAP_ERRORS_VI[message] ?? message;
}
