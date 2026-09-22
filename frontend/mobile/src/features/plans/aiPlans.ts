/**
 * CL-18/CL-23 — the pure parts of "Kế hoạch AI", ported from web's `AIPlansPage.tsx` so the rules
 * the server enforces (ranges, weekday count, exerciseId validity) read the same on both apps and
 * can be unit-tested without a device.
 *
 * Nothing here decides anything the server doesn't: the plan content is whatever ai-service wrote,
 * the job status is whatever `GET /plans/job/:id` says, and these helpers only shape it for display.
 */
import type {
  ExerciseItem,
  PlanContent,
  PlanStatusBackend,
  WeeklyScheduleItem,
  WorkoutPlanRecord,
} from "../../services/api";

export type PlanFilter = "all" | "active" | "completed" | "failed";
export type TrainingLocation = "HOME" | "GYM";
export type EquipmentPreference = "MACHINE_ONLY" | "MIXED_GYM";

export const LLM_NOT_READY_MESSAGE = "AI Coach hiện chưa sẵn sàng. Vui lòng thử lại sau.";
export const LLM_TIMEOUT_MESSAGE =
  "AI Coach đang quá tải hoặc phản hồi chưa kịp. Vui lòng thử tạo lại sau.";

/** Same five presets as web's goal chips, same default goal ("Giảm mỡ tăng cơ"). */
export const GOAL_PRESETS = ["Giảm mỡ", "Tăng cơ", "Giảm mỡ tăng cơ", "Duy trì sức khỏe", "Tăng sức bền"];
export const DEFAULT_GOAL = "Giảm mỡ tăng cơ";

/** Web's `?goal=` deep-link codes (from onboarding/dashboard) mapped to a goal the AI reads. */
export const QUERY_GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì sức khỏe",
  ATHLETIC_PERFORMANCE: "Tăng sức bền",
};

export const LOCATION_OPTIONS: { value: TrainingLocation; label: string; desc: string }[] = [
  { value: "GYM", label: "Phòng gym", desc: "Máy, tạ, cable" },
  { value: "HOME", label: "Ở nhà", desc: "Bodyweight, tạ đôi, band" },
];

export const EQUIPMENT_OPTIONS: { value: EquipmentPreference; label: string; desc: string }[] = [
  { value: "MACHINE_ONLY", label: "Tập hoàn toàn bằng máy", desc: "Chỉ machine/cable/smith" },
  { value: "MIXED_GYM", label: "Kết hợp máy và bài thường", desc: "Machine + tạ + barbell" },
];

/** Monday-first, Sunday last — `value` is JS `Date.getDay()` (0 = Sunday), which the server stores. */
export const WEEKDAY_OPTIONS = [
  { value: 1, short: "T2", label: "Thứ 2" },
  { value: 2, short: "T3", label: "Thứ 3" },
  { value: 3, short: "T4", label: "Thứ 4" },
  { value: 4, short: "T5", label: "Thứ 5" },
  { value: 5, short: "T6", label: "Thứ 6" },
  { value: 6, short: "T7", label: "Thứ 7" },
  { value: 0, short: "CN", label: "Chủ nhật" },
];

export const WEEKDAY_LABEL_BY_VALUE: Record<number, string> = Object.fromEntries(
  WEEKDAY_OPTIONS.map((o) => [o.value, o.label]),
);

export const WEEKDAY_SUGGESTIONS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 3, 5, 0],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 0],
};

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// ── Status ────────────────────────────────────────────────────────────────

export function statusLabel(status: PlanStatusBackend): string {
  if (status === "QUEUED") return "Đang chờ";
  if (status === "PROCESSING") return "Đang xử lý";
  if (status === "COMPLETED") return "Hoàn thành";
  return "Thất bại";
}

export function statusTone(status: PlanStatusBackend): "success" | "danger" | "info" | "warning" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "PROCESSING") return "info";
  return "warning";
}

export function isPending(status: PlanStatusBackend): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

// ── List: sort, filter, default selection ─────────────────────────────────

/** Newest first by max(updatedAt, createdAt), then higher version — web's `sortedPlans`. */
export function sortPlans(plans: WorkoutPlanRecord[] | undefined | null): WorkoutPlanRecord[] {
  return [...(plans ?? [])].sort((a, b) => {
    const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
    const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
    if (tsA !== tsB) return tsB - tsA;
    return (b.version ?? 0) - (a.version ?? 0);
  });
}

export function filterPlans(sorted: WorkoutPlanRecord[], filter: PlanFilter): WorkoutPlanRecord[] {
  if (filter === "all") return sorted;
  if (filter === "active") return sorted.filter((p) => isPending(p.status));
  if (filter === "completed") return sorted.filter((p) => p.status === "COMPLETED");
  return sorted.filter((p) => p.status === "FAILED");
}

export function planCounts(sorted: WorkoutPlanRecord[]) {
  return {
    active: filterPlans(sorted, "active").length,
    completed: filterPlans(sorted, "completed").length,
    failed: filterPlans(sorted, "failed").length,
    all: sorted.length,
  };
}

/** First filter the list opens on: something running, else finished plans, else failures. */
export function initialFilter(sorted: WorkoutPlanRecord[]): PlanFilter {
  const c = planCounts(sorted);
  if (c.active > 0) return "active";
  if (c.completed > 0) return "completed";
  if (c.failed > 0) return "failed";
  return "all";
}

/** Prefer the newest COMPLETED plan; fall back to the newest of any status. */
export function chooseLatestPlan(plans: WorkoutPlanRecord[]): WorkoutPlanRecord | null {
  if (!plans.length) return null;
  const completed = plans.filter((p) => p.status === "COMPLETED");
  const source = completed.length > 0 ? completed : plans;
  const sorted = [...source].sort((a, b) => {
    const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
    const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
    if (tsA !== tsB) return tsB - tsA;
    const verA = a.version ?? 0;
    const verB = b.version ?? 0;
    if (verA !== verB) return verB - verA;
    return (b.id || "").localeCompare(a.id || "");
  });
  return sorted[0] ?? null;
}

// ── Plan content ──────────────────────────────────────────────────────────

export function toPlanContent(value: unknown): PlanContent | null {
  return isRecord(value) ? (value as PlanContent) : null;
}

export function toExerciseList(value: unknown): ExerciseItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isRecord(item)) as ExerciseItem[];
}

export function toWeeklySchedule(value: unknown): WeeklyScheduleItem[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => isRecord(item)) as WeeklyScheduleItem[];
}

export function hasValidExerciseId(exercise: ExerciseItem): boolean {
  return typeof exercise.exerciseId === "string" && UUID_PATTERN.test(exercise.exerciseId.trim());
}

export function countInvalidExerciseIds(schedule: WeeklyScheduleItem[] | null): number {
  if (!schedule) return 0;
  let missing = 0;
  for (const day of schedule) {
    for (const exercise of toExerciseList(day.exercises)) {
      if (!hasValidExerciseId(exercise)) missing += 1;
    }
  }
  return missing;
}

/** Distinct valid exerciseIds, for one batched catalog lookup (muscle group + equipment). */
export function planExerciseIds(schedule: WeeklyScheduleItem[] | null): string[] {
  const ids = new Set<string>();
  for (const day of schedule ?? []) {
    for (const exercise of toExerciseList(day.exercises)) {
      if (hasValidExerciseId(exercise)) ids.add(exercise.exerciseId!.trim());
    }
  }
  return Array.from(ids);
}

/** Days/week used for the save form: plan content first, then the record, clamped to 1..7. */
export function saveDaysPerWeek(plan: WorkoutPlanRecord | null, fallback = 4): number {
  const content = toPlanContent(plan?.plan);
  const raw = Number(content?.daysPerWeek ?? plan?.daysPerWeek ?? fallback);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(7, Math.max(1, Math.trunc(raw)));
}

export function planLocation(plan: WorkoutPlanRecord | null): TrainingLocation | null {
  const loc = (plan?.plan as any)?._metadata?.trainingLocation;
  return loc === "HOME" || loc === "GYM" ? loc : null;
}

export function locationLabel(loc: TrainingLocation | null): string {
  if (loc === "HOME") return "Ở nhà";
  if (loc === "GYM") return "Phòng gym";
  return "Chưa xác định";
}

export function extractPlanWarnings(content: PlanContent | null): string[] {
  const metadata = (content as any)?._metadata;
  if (!isRecord(metadata) || !Array.isArray(metadata.aiWarnings)) return [];
  return metadata.aiWarnings
    .map((w) => (typeof w === "string" ? w : JSON.stringify(w)).trim())
    .filter(Boolean);
}

export type PlanEvidenceItem = {
  title?: string;
  source_url?: string;
  source_type?: string;
  summary?: string;
};
export type PlanAdjustmentItem = {
  metric?: string;
  observed_value?: string | number;
  interpretation?: string;
  plan_adjustment?: string;
};

/** snake_case or camelCase — the generator has written both over time. */
export function getPlanEvidence(content: PlanContent | null) {
  const r = content as any;
  const pick = (a: string, b: string) => (Array.isArray(r?.[a]) ? r[a] : Array.isArray(r?.[b]) ? r[b] : []);
  return {
    adjustmentReason: pick("adjustment_reason", "adjustmentReasons") as PlanAdjustmentItem[],
    evidenceUsed: pick("evidence_used", "evidenceUsed") as PlanEvidenceItem[],
    safetyNotes: pick("safety_notes", "safetyNotes") as string[],
  };
}

export function formatEvidenceSourceType(value?: string): string {
  if (!value) return "Tài liệu";
  if (value === "curated_summary") return "Tóm tắt chọn lọc";
  if (value === "guideline") return "Hướng dẫn";
  if (value === "paper") return "Nghiên cứu";
  if (value === "dataset") return "Bộ dữ liệu";
  return value.replace(/_/g, " ");
}

export function isSafeHttpUrl(value?: string): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// Mojibake/garbled model output (seen from small local models) — replaced by a clean Vietnamese note.
const GARBLED =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001FͰ-ӿ฀-๿຀-໿]|[ƷƵƳƪǍǭȸ½¿]|�|\?|Āng|ᬺ|ǈi|ī|ǉ|ĝ|Âng|Ñ|Ȃ|ӣ/;

/** Web's `localizePlanNoteForDisplay`, verbatim rules. */
export function localizePlanNote(value: string): string {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  if (GARBLED.test(trimmed)) {
    if (/7-9|giờ|phục hồi|hồi/i.test(trimmed))
      return "Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.";
    if (/đau|nhức|kéo dài|khối lượng|nghỉ/i.test(trimmed))
      return "Nếu đau nhức kéo dài, hãy giảm khối lượng tập hoặc nghỉ thêm.";
    if (/form|chuẩn|cường độ/i.test(trimmed)) return "Giữ form chuẩn trước khi tăng cường độ.";
    if (/protein|calo|nước/i.test(trimmed))
      return "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.";
    return "Tập trung vào kỹ thuật chuẩn, kiểm soát nhịp tập và tăng tiến từ từ.";
  }
  const map: Record<string, string> = {
    "add load or reps gradually when all sets feel controlled.":
      "Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.",
    "sleep 7-9 hours and keep at least one recovery day weekly.":
      "Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.",
    "protein 1.8-2.2 g/kg/day and calories aligned with the goal.":
      "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.",
  };
  if (map[key]) return map[key];
  if (/add .*load|add .*reps|progress/i.test(trimmed))
    return "Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.";
  if (/sleep|recovery|stretch/i.test(trimmed))
    return "Ngủ 7-9 giờ mỗi ngày, giãn cơ nhẹ sau buổi tập và giữ ít nhất một ngày phục hồi mỗi tuần.";
  if (/protein|calorie|caloric|nutrition/i.test(trimmed))
    return "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.";
  return trimmed;
}

export function localizeDayGoal(value: unknown, dayIndex: number): string {
  if (typeof value !== "string" || !value.trim()) return `Buổi tập ${dayIndex + 1}`;
  const trimmed = value.trim();
  if (GARBLED.test(trimmed)) {
    if (/tay trước/i.test(trimmed)) return "Lưng + Tay trước";
    if (/tay sau/i.test(trimmed)) return "Ngực + Vai + Tay sau";
    if (/vai/i.test(trimmed)) return "Vai + Tay";
    if (/chân|mong|mông/i.test(trimmed)) return "Chân + Mông";
    return `Buổi tập ${dayIndex + 1}`;
  }
  return trimmed;
}

/** "Bench · Row · OHP" — the design's one-line day summary, from real exercise names. */
export function dayExerciseSummary(day: WeeklyScheduleItem, max = 4): string {
  const names = toExerciseList(day.exercises)
    .map((e) => (typeof e.name === "string" ? e.name.trim() : ""))
    .filter(Boolean);
  const head = names.slice(0, max).join(" · ");
  return names.length > max ? `${head} · +${names.length - max}` : head;
}

// ── LLM failures ──────────────────────────────────────────────────────────

export function isLlmUnavailableMessage(message: string | null | undefined): boolean {
  return (
    !!message &&
    /LLM|Ollama|ollama|AI model|AI Coach|timed out|timeout|unreachable|LLM_UNAVAILABLE/i.test(message)
  );
}

export function friendlyPlanFailReason(reason?: string | null): string {
  if (reason && /timed out|timeout/i.test(reason)) return LLM_TIMEOUT_MESSAGE;
  if (isLlmUnavailableMessage(reason)) return LLM_NOT_READY_MESSAGE;
  return reason || "Máy chủ không cho biết lý do thất bại.";
}

// ── Validation (same ranges the server's zod schemas enforce) ─────────────

function inRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

export function validateGenerate(input: {
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  exercisesPerDay: number;
}): string | null {
  if (!input.goal.trim()) return "Mục tiêu không được để trống";
  if (!inRange(input.durationWeeks, 1, 52)) return "Số tuần phải trong khoảng 1-52";
  if (!inRange(input.daysPerWeek, 1, 7)) return "Số buổi mỗi tuần phải trong khoảng 1-7";
  if (!inRange(input.exercisesPerDay, 1, 8)) return "Số bài mỗi buổi phải trong khoảng 1-8";
  return null;
}

/** Optional overrides: an empty string means "keep the plan's value". */
export function parseAdjustInput(input: {
  adjustments: string;
  daysPerWeek: string;
  exercisesPerDay: string;
}):
  | { ok: true; adjustments: string; daysPerWeek?: number; exercisesPerDay?: number }
  | { ok: false; error: string } {
  const adjustments = input.adjustments.trim();
  if (!adjustments) return { ok: false, error: "Nội dung điều chỉnh không được để trống" };
  let daysPerWeek: number | undefined;
  if (input.daysPerWeek.trim()) {
    const n = Number(input.daysPerWeek);
    if (!inRange(n, 1, 7)) return { ok: false, error: "Số buổi mới phải trong khoảng 1-7" };
    daysPerWeek = n;
  }
  let exercisesPerDay: number | undefined;
  if (input.exercisesPerDay.trim()) {
    const n = Number(input.exercisesPerDay);
    if (!inRange(n, 1, 8)) return { ok: false, error: "Số bài mới phải trong khoảng 1-8" };
    exercisesPerDay = n;
  }
  return { ok: true, adjustments, daysPerWeek, exercisesPerDay };
}

export function parseRepeatWeeks(raw: string): { ok: true; value?: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: true };
  const n = Number(t);
  if (!inRange(n, 1, 52)) return { ok: false, error: "Số tuần áp dụng phải trong khoảng 1-52" };
  return { ok: true, value: n };
}

/**
 * Toggle one weekday, capped at the plan's days/week. Returns the new selection kept in
 * Monday-first order (the order Day 1..N are mapped onto), plus a warning when the cap blocked it.
 */
export function toggleWeekday(
  selected: number[],
  weekday: number,
  limit: number,
): { selected: number[]; warning: string | null } {
  if (selected.includes(weekday)) {
    return { selected: selected.filter((v) => v !== weekday), warning: null };
  }
  if (selected.length >= limit) {
    return {
      selected,
      warning: `Kế hoạch này có ${limit} buổi/tuần, bạn chỉ được chọn tối đa ${limit} ngày.`,
    };
  }
  const next = [...selected, weekday];
  return {
    selected: WEEKDAY_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)),
    warning: null,
  };
}

export function suggestedWeekdays(daysPerWeek: number): number[] {
  return WEEKDAY_SUGGESTIONS[daysPerWeek] ?? WEEKDAY_OPTIONS.slice(0, daysPerWeek).map((d) => d.value);
}

/**
 * True when saving this plan would replace a DIFFERENT active program — the client must confirm.
 * Saving the same plan again (its program already came from this plan) needs no confirmation.
 */
export function replacesOtherProgram(activeProgram: any, planId: string): boolean {
  const source = typeof activeProgram?.sourcePlanId === "string" ? activeProgram.sourcePlanId : null;
  return Boolean(activeProgram?.id && source !== planId);
}

// ── Job progress (CL-23 running view) ─────────────────────────────────────

/**
 * The design's four phase rows. The server only reports QUEUED → PROCESSING → COMPLETED/FAILED —
 * no percentage — so the rows follow the real status: queued = step 1 active, processing walks
 * steps 2-4 on elapsed time (never reaching "done" until the server says COMPLETED).
 */
export const JOB_PHASES = ["Phân tích mục tiêu", "Chọn bài tập", "Sắp xếp lịch", "Tối ưu khối lượng"];

export function jobProgress(
  status: PlanStatusBackend | null,
  elapsedMs: number,
): { progress: number; activePhase: number } {
  if (status === "COMPLETED") return { progress: 1, activePhase: JOB_PHASES.length };
  if (status === "PROCESSING") {
    // Asymptotic toward 95%: moves visibly early on, never claims completion by itself.
    const p = 0.25 + 0.7 * (1 - Math.exp(-elapsedMs / 45_000));
    const activePhase = Math.min(JOB_PHASES.length - 1, 1 + Math.floor(((p - 0.25) / 0.7) * 3));
    return { progress: p, activePhase };
  }
  // QUEUED (or not yet known): a small, slowly-growing sliver inside step 1.
  const p = 0.05 + 0.15 * (1 - Math.exp(-elapsedMs / 20_000));
  return { progress: p, activePhase: 0 };
}

export function apiErrorMessage(error: any, fallback: string): string {
  const data = error?.response?.data;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data?.message === "string") return data.message;
  if (error instanceof Error && error.message && !/status code/i.test(error.message)) return error.message;
  return fallback;
}

/** Same generate body a failed plan was created with — web's `handleRetryFailedPlan`. */
export function retryPayload(plan: WorkoutPlanRecord) {
  const content = toPlanContent(plan.plan);
  const meta = (plan.plan as any)?._metadata ?? {};
  return {
    goal: plan.goal ?? "",
    durationWeeks: plan.duration ?? 0,
    daysPerWeek: plan.daysPerWeek ?? 0,
    exercisesPerDay: content?.exercisesPerDay ?? 4,
    trainingLocation: (meta.trainingLocation === "HOME" ? "HOME" : "GYM") as TrainingLocation,
    equipmentPreference: (meta.equipmentPreference === "MACHINE_ONLY" ? "MACHINE_ONLY" : "MIXED_GYM") as EquipmentPreference,
  };
}

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Start-date choices for "Lưu vào lịch tập" / "Áp dụng kế hoạch": today plus the next days, as
 * YYYY-MM-DD in LOCAL time (the same value web's `<input type="date">` produces). The app ships no
 * native date picker, and a plan is started within days, not months — so a strip of chips.
 */
export function startDateOptions(today: Date, count = 21): { value: string; label: string; sub: string }[] {
  const out: { value: string; label: string; sub: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = i === 0 ? "Hôm nay" : i === 1 ? "Ngày mai" : WEEKDAY_SHORT[d.getDay()];
    out.push({ value, label, sub: `${d.getDate()}/${d.getMonth() + 1}` });
  }
  return out;
}
