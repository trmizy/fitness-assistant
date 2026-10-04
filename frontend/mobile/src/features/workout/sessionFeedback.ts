import type {
  CompletionFeedbackInput,
  ExerciseFeedbackIssueType,
  SessionFeedbackDifficulty,
  SessionFeedbackEnjoyment,
  SessionFeedbackPerceivedProgress,
  SessionFeedbackRecord,
  SessionFeedbackWouldRepeat,
  SessionSkipReason,
  SkipCancelFeedbackInput,
} from "../../services/api";

/**
 * 14B.1 (PG-A2) — post-session feedback and skip reasons, web `WorkoutLogPage`'s
 * `SessionFeedbackModal` / `SkipCancelFeedbackModal`. Options and labels are web's; the server
 * decides which shape it accepts from the session's real status (completed/partial vs
 * skipped/cancelled) and only for today's session.
 */

export const DIFFICULTY_OPTIONS: { value: SessionFeedbackDifficulty; label: string }[] = [
  { value: "too_easy", label: "Quá dễ" },
  { value: "just_right", label: "Vừa sức" },
  { value: "too_hard", label: "Quá nặng" },
];

export const ENJOYMENT_OPTIONS: { value: SessionFeedbackEnjoyment; label: string }[] = [
  { value: "low", label: "Không thích" },
  { value: "medium", label: "Bình thường" },
  { value: "high", label: "Rất thích" },
];

export const WOULD_REPEAT_OPTIONS: { value: SessionFeedbackWouldRepeat; label: string }[] = [
  { value: "yes", label: "Có" },
  { value: "unsure", label: "Chưa chắc" },
  { value: "no", label: "Không" },
];

export const PERCEIVED_PROGRESS_OPTIONS: { value: SessionFeedbackPerceivedProgress; label: string }[] = [
  { value: "better_than_last_time", label: "Tốt hơn lần trước" },
  { value: "same", label: "Như cũ" },
  { value: "worse", label: "Kém hơn" },
  { value: "unsure", label: "Chưa chắc" },
];

export const EXERCISE_ISSUE_TAGS: { value: ExerciseFeedbackIssueType; label: string }[] = [
  { value: "liked", label: "Thích bài này" },
  { value: "too_heavy", label: "Quá nặng" },
  { value: "too_light", label: "Quá nhẹ" },
  { value: "too_many_sets", label: "Nhiều set quá" },
  { value: "too_few_sets", label: "Ít set quá" },
  { value: "uncomfortable", label: "Khó chịu" },
  { value: "pain", label: "Bị đau" },
  { value: "boring", label: "Nhàm chán" },
  { value: "confusing", label: "Khó hiểu cách tập" },
  { value: "equipment_unavailable", label: "Thiếu dụng cụ" },
];

export const SKIP_REASON_OPTIONS: { value: SessionSkipReason; label: string }[] = [
  { value: "fatigue", label: "Quá mệt" },
  { value: "pain", label: "Đau/chấn thương" },
  { value: "schedule_conflict", label: "Bận việc khác" },
  { value: "motivation", label: "Không có động lực" },
  { value: "illness", label: "Bị ốm" },
  { value: "equipment_unavailable", label: "Thiếu dụng cụ" },
  { value: "too_hard_previous_session", label: "Buổi trước quá nặng" },
  { value: "other", label: "Lý do khác" },
];

export interface ScaleSpec {
  key: "readinessScore" | "sessionRpe" | "painScore" | "fatigueAfterSession";
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

export const FEEDBACK_SCALES: ScaleSpec[] = [
  { key: "readinessScore", label: "Chất lượng buổi tập", hint: "1 = rất tệ, 10 = xuất sắc", min: 1, max: 10, step: 1 },
  { key: "sessionRpe", label: "Mức độ gắng sức (RPE)", hint: "1 = rất nhẹ, 10 = tối đa", min: 1, max: 10, step: 0.5, format: (v) => `RPE ${v}` },
  { key: "painScore", label: "Mức độ đau/khó chịu", hint: "0 = không đau, 10 = đau dữ dội", min: 0, max: 10, step: 1 },
  { key: "fatigueAfterSession", label: "Mệt mỏi sau buổi tập", hint: "1 = còn khỏe, 10 = kiệt sức", min: 1, max: 10, step: 1 },
];

export function stepScale(spec: ScaleSpec, value: number, direction: 1 | -1): number {
  const next = Math.round((value + direction * spec.step) * 10) / 10;
  return Math.min(spec.max, Math.max(spec.min, next));
}

export interface CompletionForm {
  readinessScore: number;
  sessionRpe: number;
  painScore: number;
  fatigueAfterSession: number;
  painLocation: string;
  sessionRating: number;
  difficulty?: SessionFeedbackDifficulty;
  enjoyment?: SessionFeedbackEnjoyment;
  wouldRepeatSession?: SessionFeedbackWouldRepeat;
  perceivedProgress?: SessionFeedbackPerceivedProgress;
  notes: string;
  exerciseTags: Record<string, ExerciseFeedbackIssueType | undefined>;
}

/** Web's starting values; a saved record (the "Xem/sửa" path) pre-fills what it has. */
export function initialCompletionForm(saved?: SessionFeedbackRecord | null): CompletionForm {
  const tags: CompletionForm["exerciseTags"] = {};
  for (const ex of saved?.exerciseFeedback ?? []) {
    if (ex.issueType) tags[ex.exerciseId] = ex.issueType as ExerciseFeedbackIssueType;
  }
  return {
    readinessScore: saved?.readinessScore ?? 6,
    sessionRpe: saved?.sessionRpe ?? 6,
    painScore: saved?.painScore ?? 0,
    fatigueAfterSession: saved?.fatigueAfterSession ?? 5,
    painLocation: saved?.painLocation ?? "",
    sessionRating: saved?.sessionRating ?? 0,
    difficulty: saved?.difficulty ?? undefined,
    enjoyment: saved?.enjoyment ?? undefined,
    wouldRepeatSession: saved?.wouldRepeatSession ?? undefined,
    perceivedProgress: saved?.perceivedProgress ?? undefined,
    notes: saved?.notes ?? "",
    exerciseTags: tags,
  };
}

/** Same body web sends: optional fields are left out rather than sent empty. */
export function completionPayload(form: CompletionForm): CompletionFeedbackInput {
  const exerciseFeedback = Object.entries(form.exerciseTags)
    .filter(([, issueType]) => Boolean(issueType))
    .map(([exerciseId, issueType]) => ({ exerciseId, issueType }));
  return {
    readinessScore: form.readinessScore,
    sessionRpe: form.sessionRpe,
    painScore: form.painScore,
    fatigueAfterSession: form.fatigueAfterSession,
    painLocation: form.painScore > 0 ? form.painLocation.trim() || undefined : undefined,
    sessionRating: form.sessionRating > 0 ? form.sessionRating : undefined,
    difficulty: form.difficulty,
    enjoyment: form.enjoyment,
    wouldRepeatSession: form.wouldRepeatSession,
    perceivedProgress: form.perceivedProgress,
    notes: form.notes.trim() || undefined,
    exerciseFeedback: exerciseFeedback.length ? exerciseFeedback : undefined,
  };
}

export function skipPayload(input: {
  skipReason: SessionSkipReason;
  notes: string;
  shouldAdjustPlan: boolean;
  makeupDay: string | null;
}): SkipCancelFeedbackInput {
  return {
    skipReason: input.skipReason,
    notes: input.notes.trim() || undefined,
    shouldAdjustPlan: input.shouldAdjustPlan,
    userAvailableMakeupDay: input.makeupDay || undefined,
  };
}

/** Feedback exists only for these statuses (server rule in session-feedback.service). */
export const FEEDBACK_COMPLETION_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED"];
export const FEEDBACK_SKIP_STATUSES = ["SKIPPED", "CANCELLED"];

/** A real feedback row, not the "user dismissed the prompt" marker. */
export function hasSubmittedFeedback(data: { feedback: SessionFeedbackRecord | null; feedbackMissing: boolean } | undefined): boolean {
  return Boolean(data?.feedback) && !data?.feedbackMissing;
}
