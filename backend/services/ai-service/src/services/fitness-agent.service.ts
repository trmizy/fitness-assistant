import { randomUUID } from "node:crypto";
import { AgentPreferencesSchema, FITNESS_SCORING, PROGRAM_SCORING_V2, scorePT, scoreTrainingProgramV2, agentActionRisk, logger, type AgentPreferences, type AgentActionKind } from "@gym-coach/shared";
import { prisma, conversationRepository, PlanStatus } from "../repositories/conversation.repository";
import { conversationService } from "./conversation.service";
import { llmService } from "./llm.service";
import { GenerateNutritionPlanRequestSchema } from "../schemas/nutrition-plan.schemas";
import { createHash } from "node:crypto";
import {
  extractNutritionConstraints, mergeNutritionConstraints, constraintSetIsEmpty, constraintPromptLines,
  unsupportedRestrictionMessage, findExclusionViolations, EMPTY_CONSTRAINTS, type NutritionConstraintSet,
} from "./nutrition-food-constraints";
import { fitnessAgentTools, type AgentIdentity } from "./fitness-agent-tools";
import { parseFitnessAgentIntent, normalizeAgentText } from "./fitness-agent-intent";
import { parseMinutes, parseSessionsPerWeek, parseTrainingDays } from "../agent-workflow/slot-values";
import { isLikelyFoodSubstitutionMessage, extractFoodSubstitutionIntent } from "./food-substitution-extractor";
import { isLikelyMealLogMessage, extractMealLogIntent } from "./meal-log-extractor";
import { profileExtractor } from "../llm/profile_extractor";
import { intentRouter } from "../llm/intent_router";
import { inputParser } from "../llm/input_parser";
import { recommendationEngine } from "../llm/recommendation_engine";
import { narrateRecommendations, extractGoalIntentGrounding } from "../llm/recommendation_narrator";
import { narrateProgramRecommendations } from "../llm/program_recommendation_narrator";
import { runWorkflowTurn, registerWorkflow, RESUME_SENTINEL } from "../agent-workflow/orchestrator";
import { workflowStateRepository } from "../agent-workflow/workflow-state.repository";
import { createRoadmapWorkflow } from "../agent-workflow/workflows/roadmap.workflow";
import { findPtWorkflow, findTrainingProgramWorkflow, resolveBudgetPreference } from "../agent-workflow/workflows/find-pt-program.workflow";
import { createWorkoutPlanWorkflow } from "../agent-workflow/workflows/create-workout-plan.workflow";
import { createNutritionPlanWorkflow } from "../agent-workflow/workflows/create-nutrition-plan.workflow";

registerWorkflow(createRoadmapWorkflow);
registerWorkflow(findPtWorkflow);
registerWorkflow(findTrainingProgramWorkflow);
registerWorkflow(createWorkoutPlanWorkflow);
registerWorkflow(createNutritionPlanWorkflow);

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
export type AgentBlock = { type: "PT_RECOMMENDATIONS" | "PROGRAM_RECOMMENDATIONS" | "ACTION_CONFIRMATION" | "GOAL_ANALYSIS" | "ACTION_RESULT" | "SUBSTITUTE_RESULT" | "CYCLE_EVALUATION_RESULT" | "IMAGE_CHAT" | "WORKFLOW_MISSING_DATA" | "PROFILE_UPDATE_CONFIRMATION" | "WORKOUT_PLAN_PREVIEW" | "NUTRITION_PLAN_PREVIEW"; [key: string]: unknown };
const TRAINING_DECISION_LABEL_VI: Record<string, string> = {
  KEEP: "Giữ nguyên", PROGRESS: "Tăng tải", ADJUST: "Điều chỉnh nhỏ", DELOAD: "Giảm tải (deload)",
  REBUILD: "Xây lại chương trình", INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};
const NUTRITION_DECISION_LABEL_VI: Record<string, string> = {
  KEEP_PLAN: "Giữ nguyên dinh dưỡng", PROPOSE_ADJUSTMENT: "Đề xuất điều chỉnh", PROPOSE_DIET_BREAK: "Đề xuất nghỉ diet break",
  REQUEST_MORE_DATA: "Cần thêm dữ liệu", EARLY_REVIEW: "Cần xem xét sớm", ESCALATE: "Cần chuyên gia xem xét",
};
// Mutable dependency object — ESM named imports can't be reassigned, so
// tests stub fitnessAgentDeps.tools.* / .extractFoodSubstitutionIntent
// directly rather than mocking the module.
export const fitnessAgentDeps = { tools: fitnessAgentTools, extractFoodSubstitutionIntent, extractMealLogIntent, profileExtractor, narrateRecommendations, narrateProgramRecommendations };

// Shared by proposePlanBundle (initial draft) and tryReviseRoadmapDraft
// (revised draft) so the confirmation card is built identically either way
// — a revision is never a second, differently-shaped preview.
function buildPlanBundleConfirmationBlock(
  draft: any, workoutCandidate: any, actionId: string, risk: string, expiresAt: Date,
): AgentBlock {
  const phaseCount = Array.isArray(draft?.phases) ? draft.phases.length : 0;
  const totalWeeks = Array.isArray(draft?.phases)
    ? draft.phases.reduce((sum: number, p: any) => {
        const start = new Date(p.plannedStartAt).getTime();
        const end = new Date(p.plannedEndAt).getTime();
        return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / (7 * 86_400_000)) : 0);
      }, 0)
    : 0;
  return {
    type: "ACTION_CONFIRMATION", actionId, kind: "CREATE_PLAN_BUNDLE", risk,
    title: "Tạo lộ trình + chương trình tập + dinh dưỡng",
    summary: {
      roadmapSummary: draft?.summary ?? null,
      phaseCount, totalWeeks,
      workoutName: workoutCandidate?.name ?? null,
      workoutDaysPerWeek: workoutCandidate?.daysPerWeek ?? null,
    },
    expiresAt: expiresAt.toISOString(),
    note: "Xác nhận sẽ: (1) kích hoạt lộ trình mới này (thay thế lộ trình đang hoạt động nếu có), (2) áp dụng chương trình tập bên trên (thay lịch tập chưa hoàn thành), (3) tạo mục tiêu dinh dưỡng thật dựa trên hồ sơ/InBody hiện tại của bạn. Đây là thay đổi thật trên hệ thống.",
  };
}

async function ownSession(identity: AgentIdentity, sessionId: string) {
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: identity.userId, archivedAt: null } });
  if (!session) throw fail("Conversation not found", 404);
}

// CREATE_WORKOUT_PLAN (docs/standalone-workout-workflow-design.md) — reuses
// the EXACT SAME deterministic pipeline SAVE_GENERATED_PLAN already trusts
// (intentRouter -> inputParser -> recommendationEngine ->
// searchExerciseByName) via a new caller, not a new generation mechanism.
// The one genuinely new piece is this bounded, deterministic session-length
// trim — recommendation_engine.ts never consumes duration at all, so a
// `sessionMinutes` slot would otherwise be silently ignored.
const MINUTES_PER_EXERCISE_ESTIMATE = 8; // warm-up + working sets + rest + transition — deliberately conservative so trimming errs toward a SHORTER session than requested, never longer
function trimDayForSessionMinutes<T extends { exercises: Array<Record<string, unknown>> }>(day: T, sessionMinutes: number): T {
  const maxExercises = Math.max(3, Math.floor(sessionMinutes / MINUTES_PER_EXERCISE_ESTIMATE));
  if (day.exercises.length <= maxExercises) return day;
  return { ...day, exercises: day.exercises.slice(0, maxExercises).map((e, i) => ({ ...e, order: i + 1 })) };
}

/** Resolves a deterministic recommendation_engine.ts draft into a
 * persistable weeklySchedule, mirroring proposeSaveGeneratedPlan's own
 * exercise-name -> canonical Exercise.id resolution (never a raw string
 * reaches the returned schedule — an unmatched exercise is dropped, never
 * persisted as text). The synthesized Vietnamese question is fed through
 * the SAME intentRouter/inputParser the existing chat path already uses
 * (intentRouter's diacritic-aware regex is what actually matters for
 * routing — see proposeSaveGeneratedPlan's own comment on this), never a
 * second, parallel routing/generation implementation. */
// M7 (AI Coach product remediation): the preview's weekday labels and the
// dates fitness-service actually schedules must be the SAME thing. The
// import endpoint pairs `selectedWeekdays[i]` (JS getUTCDay: 0=Sunday..6)
// with the i-th program day; without it, it lays days on consecutive dates
// from the start date (Mon/Wed/Fri shown -> Fri/Sat/Sun saved).
const weekdayLabel = (w: number) => (w === 0 ? "Chủ nhật" : `Thứ ${w + 1}`);
const weekOrder = (w: number) => (w + 6) % 7; // Monday first, Sunday last
function parseLabelWeekday(label: string): number | null {
  const m = normalizeAgentText(label).match(/^(?:thu\s*([2-7])|chu nhat|cn)\b/);
  if (!m) return null;
  return m[1] ? Number(m[1]) - 1 : 0;
}
const DEFAULT_WEEKDAY_SPREAD: Record<number, number[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 0] };
/** Agent/profile day numbering is 1=Mon..7=Sun; import/JS is 0=Sun..6. */
const agentDaysToWeekdays = (days: unknown): number[] | undefined =>
  Array.isArray(days) && days.length ? days.map((d: number) => (d === 7 ? 0 : d)) : undefined;

function resolveSelectedWeekdays(schedule: any[], preferred?: number[]): number[] {
  const n = schedule.length;
  if (preferred && preferred.length === n && new Set(preferred).size === n) return [...preferred].sort((a, b) => weekOrder(a) - weekOrder(b));
  const parsed = schedule.map((d: any) => parseLabelWeekday(d.day));
  if (parsed.every((w) => w !== null) && new Set(parsed).size === n) return parsed as number[];
  return DEFAULT_WEEKDAY_SPREAD[n] ?? DEFAULT_WEEKDAY_SPREAD[7].slice(0, n);
}
/** Rewrites each day's leading weekday label so what the user reads is what will be scheduled. */
function applyWeekdayLabels(schedule: any[], weekdays: number[]): any[] {
  return schedule.map((d: any, i: number) => ({
    ...d, day: `${weekdayLabel(weekdays[i])} ${String(d.day).replace(/^(?:Thứ\s*\d|Chủ nhật|CN)\s*/i, "").trim()}`.trim(),
  }));
}
const todayHcm = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
/** Same rule as fitness-service nextDateForWeekday(start, weekday, 0). */
function firstDateForWeekday(startDate: string, weekday: number): string {
  const d = new Date(`${startDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

async function generateWorkoutDraft(
  identity: AgentIdentity, profile: any, daysPerWeek: number, sessionMinutes: number, preferredWeekdays?: number[],
): Promise<{ weeklySchedule: any[]; selectedWeekdays: number[]; unmatchedCount: number }> {
  const syntheticQuestion = `Tạo lịch tập ${daysPerWeek} buổi mỗi tuần cho tôi`;
  const routedIntent = intentRouter.route(syntheticQuestion, profile);
  const parsedInput = inputParser.parse(syntheticQuestion, profile);
  parsedInput.routeIntent = routedIntent.intent;
  parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;
  parsedInput.parsedTrainingDays = daysPerWeek; // the resolved slot value is authoritative, not whatever the synthesized text happens to re-parse to
  const recommendation = recommendationEngine.recommend(profile, parsedInput, "vi");
  const rawDays = (recommendation.workoutPlan?.days ?? []).map((d: any) => trimDayForSessionMinutes(d, sessionMinutes));
  const uniqueNames = [...new Set(rawDays.flatMap((d: any) => d.exercises.map((e: any) => e.name)))] as string[];
  const resolutions = new Map<string, { id: string; exerciseName: string } | null>();
  await Promise.all(uniqueNames.map(async name => {
    resolutions.set(name, await fitnessAgentDeps.tools.searchExerciseByName(identity, name).catch(() => null));
  }));
  let unmatchedCount = 0;
  const weeklySchedule = rawDays.map((day: any) => ({
    day: day.day, goal: day.goal,
    exercises: day.exercises.flatMap((e: any) => {
      const match = resolutions.get(e.name);
      if (!match) { unmatchedCount += 1; return []; }
      return [{ exerciseId: match.id, name: match.exerciseName, order: e.order, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds, note: e.note }];
    }),
  })).filter((d: any) => d.exercises.length > 0);
  const selectedWeekdays = resolveSelectedWeekdays(weeklySchedule, preferredWeekdays);
  return { weeklySchedule: applyWeekdayLabels(weeklySchedule, selectedWeekdays), selectedWeekdays, unmatchedCount };
}

function workoutSafetyWarnings(profile: any): string[] {
  // No reusable injury/experience-level validator exists for AI-GENERATED
  // workout plans today (only for TEMPLATE SELECTION — see
  // agent-program.service.ts's own candidates() gate); this mirrors
  // roadmap-draft.service.ts's own soft-warning treatment of the exact same
  // signal rather than inventing a second, competing safety mechanism.
  // Never a hard block — a disclosed gap, not silently ignored.
  const warnings: string[] = [];
  if (profile.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED") {
    warnings.push("Hồ sơ của bạn có gợi ý cần theo dõi thêm về sức khỏe — cân nhắc tham khảo ý kiến chuyên gia trước khi tăng cường độ tập.");
  }
  // M5: profileExtractor maps UserProfile.injuries to profile.training.injuries
  // (profile_extractor.ts) — there is no top-level profile.injuries.
  const injuries: string[] = profile.training?.injuries ?? profile.injuries ?? [];
  if (Array.isArray(injuries) && injuries.length > 0) {
    warnings.push(`Bạn đã báo cáo chấn thương/đau: ${injuries.join(", ")}. Lịch tập này CHỈ có cảnh báo, chưa tự động loại bỏ bài tập theo từng chấn thương cụ thể (khác với việc chọn chương trình có sẵn, vốn có bộ lọc chống chỉ định) — hãy tự điều chỉnh hoặc nhắn cho mình biết bài nào cần đổi.`);
  }
  if (profile.experienceLevel === "BEGINNER") {
    warnings.push("Lịch tập tạo bằng AI không lọc bài theo trình độ như khi chọn chương trình có sẵn — người mới nên bắt đầu nhẹ ở các bài kỹ thuật cao (ví dụ deadlift).");
  }
  return warnings;
}

function buildWorkoutPlanPreviewBlock(
  actionId: string, risk: string, expiresAt: Date,
  payload: { goal?: string | null; sessionMinutes: number; weeklySchedule: any[]; selectedWeekdays?: number[]; exclusions?: string[] },
  extraWarnings: string[] = [],
): AgentBlock {
  const start = todayHcm();
  const weekdays = payload.selectedWeekdays;
  return {
    type: "WORKOUT_PLAN_PREVIEW", actionId, kind: "CREATE_WORKOUT_PLAN", risk,
    title: "Lịch tập do AI Coach tạo",
    goal: payload.goal ?? null, daysPerWeek: payload.weeklySchedule.length, sessionMinutes: payload.sessionMinutes,
    // firstDate = the first calendar date this day will actually be
    // scheduled on (same nextDateForWeekday rule as the import endpoint).
    days: payload.weeklySchedule.map((d: any, i: number) => ({ day: d.day, goal: d.goal, firstDate: weekdays && weekdays.length === payload.weeklySchedule.length ? firstDateForWeekday(start, weekdays[i]) : null, exercises: d.exercises.map((e: any) => ({ name: e.name, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds })) })),
    warnings: extraWarnings,
    exclusions: payload.exclusions ?? [],
    expiresAt: expiresAt.toISOString(),
    note: "Bạn có thể yêu cầu chỉnh sửa trực tiếp trong đoạn chat (ví dụ \"Đổi squat\", \"Tôi không có máy cable\", \"Buổi tập ngắn xuống 45 phút\", \"Tôi tập được thứ 3, 5, 7\") trước khi lưu. Xác nhận sẽ lưu lịch tập này vào hệ thống, thay thế lịch chưa hoàn thành hiện tại.",
  };
}

// Small, local keyword extractor for exercise-name-targeted revisions
// ("Đổi squat.", "Tôi không muốn deadlift.", "Tôi không có máy cable.") —
// strips carrier phrasing, leaving whatever noun the user actually named,
// matched by substring against the CURRENT draft's own resolved exercise
// names (never against arbitrary catalog text) in
// tryReviseWorkoutPlanDraft. Deliberately simple/bounded rather than an
// LLM extractor — same "deterministic first" precedent as slot-values.ts.
function extractExerciseRevisionKeyword(rawMessage: string): string | null {
  // M6: longest carrier phrases FIRST — the old single alternation
  // (`khong|khong the|khong co|khong muon`) let the shorter "khong" win, so
  // "co"/"muon" survived as the extracted keyword.
  const s = normalizeAgentText(rawMessage)
    .replace(/[.,!?]/g, " ")
    .replace(/\bkhong\s+(?:co|muon|thich|can|dung|the|tap|choi)\b/g, " ")
    .replace(/\b(?:khong|tranh|kieng|bo|doi|thay the|thay|loai bo|loai|xoa|hay|xin|giup|nhe|nha|di|voi)\b/g, " ")
    .replace(/\b(?:toi|ban|minh|hien|dang)\b/g, " ")
    .replace(/\b(?:thiet bi|dung cu|may|bai tap|bai|cai|nay|do|ay|kia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 3 ? s : null;
}

const exerciseTokens = (name: string) => normalizeAgentText(name).split(/[^a-z0-9]+/).filter(Boolean).map((t) => t.replace(/s$/, ""));
/** Whole-token match (every keyword token is a token of the exercise name):
 * "deadlift" matches BOTH "Deadlift" and "Romanian Deadlift"; "cable" matches
 * every cable exercise; "squat" never matches an unrelated substring. */
function exerciseMatchesKeyword(name: string, keyword: string): boolean {
  const have = new Set(exerciseTokens(name));
  const want = exerciseTokens(keyword);
  return want.length > 0 && want.every((t) => have.has(t));
}
const violatesAnyExclusion = (name: string, exclusions: string[]) => exclusions.some((k) => exerciseMatchesKeyword(name, k));

/** Finds a substitute that does not itself hit an active exclusion (e.g. a
 * "no cable" request must not be answered with another cable exercise). */
async function findAllowedSubstitute(
  identity: AgentIdentity, exerciseId: string, excludeIds: string[], exclusions: string[],
): Promise<{ id: string; exerciseName: string } | null> {
  const exclude = [...excludeIds];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sub = await fitnessAgentDeps.tools.getExerciseSubstitute(identity, exerciseId, exclude);
    if (!sub) return null;
    if (!violatesAnyExclusion(sub.exerciseName, exclusions)) return sub;
    exclude.push(sub.id);
  }
  return null;
}

// Reuses intentRouter's own Vietnamese muscle-group keyword matching
// (inferMuscleGroup) rather than a second, competing keyword map — this
// table only connects that ALREADY-COMPUTED hint to the deterministic
// engine's own day/goal labels (e.g. "Thứ 4 (Legs A)" / "Tứ đầu + Gân
// khoeo + Mông + Bắp chân"), which recommendation_engine.ts hardcodes and
// nothing upstream otherwise maps.
const MUSCLE_GROUP_DAY_RE: Partial<Record<string, RegExp>> = {
  legs: /legs|lower|chan|dui|mong|tu dau|gan kheo|gan khoeo/,
  chest: /push|chest|nguc/,
  back: /pull|back|lung/,
  shoulders: /shoulder|vai/,
  core: /core|bung/,
  biceps: /biceps|tay truoc/,
  triceps: /triceps|tay sau/,
};

async function substituteMatchingExercises(
  identity: AgentIdentity, weeklySchedule: any[], keywords: string[], exclusions: string[] = keywords,
): Promise<{ weeklySchedule: any[]; changedCount: number; droppedCount: number }> {
  let changedCount = 0, droppedCount = 0;
  const days = await Promise.all(weeklySchedule.map(async (day: any) => {
    const exercises = await Promise.all(day.exercises.map(async (e: any) => {
      if (!violatesAnyExclusion(e.name, keywords)) return e;
      const otherIdsSameDay = day.exercises.map((x: any) => x.exerciseId).filter((id: string) => id !== e.exerciseId);
      const sub = await findAllowedSubstitute(identity, e.exerciseId, [e.exerciseId, ...otherIdsSameDay], exclusions);
      if (sub) { changedCount += 1; return { ...e, exerciseId: sub.id, name: sub.exerciseName }; }
      droppedCount += 1; return null;
    }));
    const kept = exercises.filter((e): e is NonNullable<typeof e> => e !== null).map((e: any, i: number) => ({ ...e, order: i + 1 }));
    return { ...day, exercises: kept };
  }));
  return { weeklySchedule: days.filter((d: any) => d.exercises.length > 0), changedCount, droppedCount };
}

// "Cho phương án khác." — broad, best-effort resubstitution via the SAME
// granular exerciseSubstitutionService the live "Đổi bài tập" workout UI
// already uses (never recommendation_engine.ts's own coarser 3-tier
// equipment substitution — see docs/standalone-workout-workflow-audit.md).
async function substituteAllExercises(identity: AgentIdentity, weeklySchedule: any[], exclusions: string[] = []): Promise<{ weeklySchedule: any[]; changedCount: number }> {
  let changedCount = 0;
  const days = await Promise.all(weeklySchedule.map(async (day: any) => {
    const exercises = await Promise.all(day.exercises.map(async (e: any) => {
      const otherIdsSameDay = day.exercises.map((x: any) => x.exerciseId).filter((id: string) => id !== e.exerciseId);
      const sub = await findAllowedSubstitute(identity, e.exerciseId, [e.exerciseId, ...otherIdsSameDay], exclusions);
      if (!sub) return e;
      changedCount += 1;
      return { ...e, exerciseId: sub.id, name: sub.exerciseName };
    }));
    return { ...day, exercises };
  }));
  return { weeklySchedule: days, changedCount };
}

// CREATE_NUTRITION_PLAN (docs/standalone-nutrition-workflow-design.md) —
// reuses the SAME REST pipeline the nutrition wizard already trusts
// (conversationService.queueNutritionPlanGeneration -> BullMQ job ->
// conversationRepository.findNutritionPlanById -> requestService("fitness",
// "/nutrition/from-ai-plan")), called as plain in-process functions since
// this workflow lives in the SAME service as those functions — no HTTP
// round-trip to itself. The one real architectural wrinkle: generation is
// an async job (unlike CREATE_WORKOUT_PLAN's synchronous generator), so the
// draft's "GENERATING -> PREVIEW" lifecycle is tracked entirely in the
// FitnessAgentAction's own payload, polled on the user's NEXT turn — no
// change to the orchestrator's state machine.
//
// Real, disclosed gap found while auditing the REST "adjust" endpoint
// (plan.controller.ts::adjustNutritionPlan): it passes the user's
// adjustment text as `notes`, but NutritionPlanJobDataSchema
// (nutrition.processor.ts) has no `notes` field at all — that text is
// silently dropped before it ever reaches the LLM prompt. This chat
// revision loop does NOT reuse that broken `notes` path; every extracted
// constraint below is routed through `restrictions` instead, which
// nutrition.processor.ts genuinely renders into the prompt as "Hạn chế bắt
// buộc: ...". See docs/standalone-nutrition-workflow-audit.md.
type NutritionTargetSnapshot = { source: "ACTIVE_GOAL" | "COMPUTED"; calories: number; protein: number; carbs: number; fat: number; goalId?: string };
type NutritionDraftPayload = {
  planId: string; jobId: string; phase: "GENERATING" | "PREVIEW" | "FAILED";
  mealsPerDay: number; goal: string | null;
  constraints: NutritionConstraintSet; target: NutritionTargetSnapshot;
  content?: any; contentHash?: string; lastTouchedAt?: string;
};

const MISSING_PROFILE_FIELD_VI: Record<string, string> = {
  weightKg: "cân nặng", heightCm: "chiều cao", age: "tuổi", gender: "giới tính", goal: "mục tiêu", activityLevel: "mức vận động",
};
const hashNutritionContent = (content: unknown) => createHash("sha256").update(JSON.stringify(content ?? null)).digest("hex");
const sameTarget = (a: NutritionTargetSnapshot, b: NutritionTargetSnapshot) =>
  a.calories === b.calories && a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;

/** M3: the calorie/macro target is NEVER chosen by this chat layer or by the
 * LLM. It is the user's ACTIVE NutritionGoal when one exists, else the same
 * deterministic initial prescription onboarding computes (fitness-service
 * resolveNutritionTargetForUser). Missing profile data -> ask, never fall back
 * to the processor's generic 2200 kcal / 30-45-25 defaults. */
async function resolveNutritionTarget(identity: AgentIdentity): Promise<{ ok: true; target: NutritionTargetSnapshot } | { ok: false; message: string }> {
  try {
    const t = await fitnessAgentDeps.tools.getNutritionTargetPreview(identity);
    if (t.status === "insufficient_data") {
      const missing = t.missingFields.map((f) => MISSING_PROFILE_FIELD_VI[f] ?? f).join(", ");
      return { ok: false, message: `Mình chưa đủ dữ liệu hồ sơ để tính mục tiêu dinh dưỡng chuẩn cho bạn (còn thiếu: ${missing}). Hãy bổ sung trong hồ sơ rồi nhờ mình tạo lại — mình sẽ không dùng một mức calo chung chung thay cho mục tiêu thật của bạn.` };
    }
    const base = { calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
    return { ok: true, target: t.status === "ACTIVE_GOAL" ? { source: "ACTIVE_GOAL", goalId: t.goalId, ...base } : { source: "COMPUTED", ...base } };
  } catch {
    return { ok: false, message: "Mình chưa lấy được mục tiêu dinh dưỡng của bạn lúc này nên chưa tạo thực đơn — bạn thử lại sau ít phút nhé." };
  }
}

function targetNote(target: NutritionTargetSnapshot): string {
  const src = target.source === "ACTIVE_GOAL" ? "mục tiêu dinh dưỡng đang hoạt động của bạn" : "mục tiêu tính theo hồ sơ của bạn (công thức chuẩn của Gymini, chưa lưu thành mục tiêu)";
  return `Calo/macro lấy từ ${src}: ${target.calories} kcal · P${target.protein}g C${target.carbs}g F${target.fat}g. AI chỉ chọn món trong các mức này.`;
}

function buildNutritionPlanPreviewBlock(actionId: string, risk: string, expiresAt: Date, content: any, draft: Pick<NutritionDraftPayload, "constraints" | "target">): AgentBlock {
  return {
    type: "NUTRITION_PLAN_PREVIEW", actionId, kind: "CREATE_NUTRITION_PLAN", risk,
    title: "Thực đơn do AI Coach tạo",
    goal: content.goal ?? null, mealsPerDay: content.mealsPerDay,
    dailyCaloriesTarget: content.dailyCaloriesTarget, proteinTargetGrams: content.proteinTargetGrams,
    carbTargetGrams: content.carbTargetGrams, fatTargetGrams: content.fatTargetGrams,
    targetNote: targetNote(draft.target),
    excludedFoods: draft.constraints.exclusions.map((e) => e.label),
    softPreferences: draft.constraints.hints,
    nutritionDays: (content.weeklySchedule ?? []).map((d: any) => ({
      dayNumber: d.dayNumber, title: d.title, totalCalories: d.totalCalories,
      meals: (d.meals ?? []).map((m: any) => ({
        mealType: m.mealType, title: m.title, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
        items: (m.items ?? []).map((it: any) => ({ name: it.name, quantity: it.quantity, unit: it.unit, calories: it.calories })),
      })),
    })),
    expiresAt: expiresAt.toISOString(),
    note: "Bạn có thể yêu cầu chỉnh sửa trong đoạn chat (ví dụ \"Tôi không ăn cá\", \"Dị ứng đậu phộng\", \"Ít bữa hơn\"). Loại trừ thực phẩm được lọc chắc chắn; các mong muốn khác (ngân sách, món Việt, đổi bữa) chỉ là gợi ý cho AI. Mỗi lần chỉnh sẽ tính lại TOÀN BỘ thực đơn (có thể mất 1-2 phút, không sửa riêng một món). Xác nhận sẽ lưu thực đơn này vào hệ thống dinh dưỡng.",
  };
}

/** Builds/re-validates queueNutritionPlanGeneration params through the SAME zod
 * schema the real POST /plans/nutrition/generate route validates against.
 * If an optional body-stat value is out of the schema's bounds it is dropped,
 * but the authoritative target and enforced exclusions are NEVER dropped —
 * if those fail validation the caller must not generate. */
function buildNutritionGenerationParams(
  goal: string, mealsPerDay: number, constraints: NutritionConstraintSet, target: NutritionTargetSnapshot, body: Record<string, unknown> = {},
): { ok: true; params: ReturnType<typeof GenerateNutritionPlanRequestSchema.parse> } | { ok: false } {
  const base = {
    goal, durationWeeks: 1, mealsPerDay,
    restrictions: constraintPromptLines(constraints),
    excludedFoodKeys: constraints.exclusions.map((e) => e.key),
    dailyCaloriesTarget: target.calories, proteinTargetG: target.protein, carbTargetG: target.carbs, fatTargetG: target.fat,
  };
  for (const extra of [body, {}]) {
    const parsed = GenerateNutritionPlanRequestSchema.safeParse({ ...base, ...extra });
    if (parsed.success) return { ok: true, params: parsed.data };
  }
  return { ok: false };
}

/** An EXECUTING claim older than this is treated as a crashed request and may be reclaimed. */
const EXECUTION_STALE_MS = 2 * 60_000;
type DraftDomain = "ROADMAP" | "WORKOUT" | "NUTRITION";
const DRAFT_KINDS = ["CREATE_PLAN_BUNDLE", "CREATE_WORKOUT_PLAN", "CREATE_NUTRITION_PLAN"] as const;
const DRAFT_DOMAIN_OF_KIND: Record<string, DraftDomain> = { CREATE_PLAN_BUNDLE: "ROADMAP", CREATE_WORKOUT_PLAN: "WORKOUT", CREATE_NUTRITION_PLAN: "NUTRITION" };
const DRAFT_DOMAIN_LABEL_VI: Record<DraftDomain, string> = { ROADMAP: "lộ trình", WORKOUT: "lịch tập", NUTRITION: "thực đơn" };
const AMBIGUOUS_REVISION_RE = /^(?:(?:doi|sua|chinh|thay)(?: lai)?(?: giup| di| nhe| nha)?(?: toi| minh)?|lam lai|lam khac di)[.!\s]*$/;
/** Strong, deterministic domain cues (accent-insensitive). A weak/generic
 * word alone (e.g. "20 phút") deliberately does NOT count. */
function classifyDraftDomains(text: string): DraftDomain[] {
  const s = normalizeAgentText(text);
  const out: DraftDomain[] = [];
  if (/\b(?:bua|thuc don|mon an|dinh duong|calo|ngan sach|di ung|khong an|kieng|nau an|thuc pham|mon viet|de mua|doi mon)\b/.test(s)) out.push("NUTRITION");
  if (/\b(?:bai tap|buoi tap|lich tap|squat|deadlift|bench|cable|ta don|thanh don|superset|hiep|phuong an khac|chu nhat|thu\s*[2-7]|t[2-7]|ngay (?:chan|nguc|lung|vai|tay|bung)|\d\s*buoi)\b/.test(s)) out.push("WORKOUT");
  if (/\b(?:lo trinh|giai doan|phase|roadmap)\b/.test(s)) out.push("ROADMAP");
  return out;
}

export const fitnessAgent = {
  async tryTurn(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const intent = parseFitnessAgentIntent(question);
    // Conversational AI Coach workflow orchestration — checked BEFORE the
    // existing intent dispatch below (docs/conversational-ai-coach-
    // workflow-design.md §Expected-slot priority): a reply to a pending
    // slot question ("72 kg") often has no recognizable intent.kind of its
    // own at all, so this MUST run ahead of the `!intent.kind` branch, not
    // after it. ownSession() moved here (was previously only checked for
    // recognized intents) so a workflow-continuation turn is never
    // processed against a session id the caller doesn't actually own.
    await ownSession(identity, sessionId);
    // Final remediation M1: nutritionConstraints is an ACCUMULATING set, but the
    // (signed-off) orchestrator never overwrites an already-known slot — so a
    // constraint stated in a middle turn would be lost. Merge it into the
    // active workflow's stored set here (product layer), BEFORE the generic
    // slot handling, which then continues untouched.
    const accumulated = await this.accumulateNutritionWorkflowConstraints(question, identity, sessionId, intent.kind);
    if (accumulated) return accumulated;
    const workflowResult = await runWorkflowTurn(question, identity, sessionId, intent.kind, {
      getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
      updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
    });
    if (workflowResult && workflowResult.answer !== RESUME_SENTINEL) {
      return workflowResult as { answer: string; blocks: AgentBlock[] };
    }
    // workflowResult is either null (no workflow involved this turn) or the
    // RESUME_SENTINEL (every required slot just became known/confirmed).
    // On a genuine resume, the CURRENT message (e.g. a bare "72 kg" or
    // "Xác nhận cập nhật" reply) almost never carries a recognizable
    // intent.kind of its own — dispatching on `intent.kind` here would
    // silently drop the resume (a real bug caught while writing this
    // module's own E2E test: the resumed roadmap/PT/program generation
    // never ran, the turn just returned null). Dispatch on the just-
    // completed workflow's own gatesIntentKind instead whenever this is a
    // resume; otherwise behave exactly as before.
    const isResuming = workflowResult?.answer === RESUME_SENTINEL;
    const effectiveKind = isResuming ? (workflowResult!.resumeIntentKind ?? null) : intent.kind;
    if (!effectiveKind) {
      if (!isResuming) {
        // ROADMAP_REVISION (docs/conversational-ai-coach-workflow-design.md
        // §Roadmap revision loop) — a free-text message with no other
        // recognized intent, while a CREATE_PLAN_BUNDLE preview is still
        // PENDING for this session, is treated as a revision request on
        // that DRAFT only. Checked first (ahead of substitution/meal-log)
        // because it's gated on real, live server-side state (a genuine
        // pending action), not a keyword guess — the strongest available
        // signal. Never run on a resume turn — the resumed dispatch below
        // already owns this turn.
        // Pending DRAFT routing (roadmap bundle / workout / nutrition) —
        // remediation M4: routePendingDraftTurn picks WHICH draft owns this
        // turn (explicit domain cue > most-recently-touched, non-displaced
        // draft > ask) instead of a fixed first-match order.
        const draftResult = await this.routePendingDraftTurn(question, identity, sessionId);
        if (draftResult) return draftResult;
        // Not PT/PROGRAM/SELECT — check for a food-substitution request
        // before falling through to the normal RAG/LLM chat pipeline (see
        // docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md). Cheap
        // keyword gate first so this doesn't add an LLM call to every
        // unrelated chat message.
        if (isLikelyFoodSubstitutionMessage(question)) {
          const substitutionResult = await this.trySubstitution(question, identity, sessionId);
          if (substitutionResult) return substitutionResult;
        }
        if (isLikelyMealLogMessage(question)) {
          const mealLogResult = await this.tryMealLog(question, identity, sessionId);
          if (mealLogResult) return mealLogResult;
        }
      }
      return null;
    }
    if (effectiveKind === "EVALUATE") return this.tryEvaluateCycle(identity);
    if (effectiveKind === "CREATE_PLAN_BUNDLE") return this.proposePlanBundle(identity, sessionId);
    if (effectiveKind === "SAVE_GENERATED_PLAN") return this.proposeSaveGeneratedPlan(identity, sessionId);
    if (effectiveKind === "CREATE_WORKOUT_PLAN") return this.proposeWorkoutPlan(identity, sessionId, workflowResult?.resumeKnownSlots);
    if (effectiveKind === "CREATE_NUTRITION_PLAN") return this.proposeNutritionPlan(question, identity, sessionId, workflowResult?.resumeKnownSlots);
    if (effectiveKind === "ROADMAP_STATUS") return this.answerRoadmapStatus(identity);
    if (effectiveKind === "ROADMAP_ADVANCE") return this.proposeRoadmapAdvance(identity, sessionId);
    if (effectiveKind === "ROADMAP_REBUILD") return this.proposeRoadmapRebuild(identity, sessionId);
    if (effectiveKind === "ROADMAP_ARCHIVE") return this.proposeRoadmapArchive(identity, sessionId);
    if (effectiveKind === "CYCLE_COMPLETE") return this.proposeCycleComplete(identity, sessionId);
    if (effectiveKind === "CYCLE_CANCEL") return this.proposeCycleCancel(identity, sessionId);
    if (effectiveKind === "WORKOUT_START") return this.proposeWorkoutSession(identity, sessionId, "WORKOUT_START");
    if (effectiveKind === "WORKOUT_SKIP") return this.proposeWorkoutSession(identity, sessionId, "WORKOUT_SKIP");
    if (effectiveKind === "WORKOUT_CANCEL") return this.proposeWorkoutSession(identity, sessionId, "WORKOUT_CANCEL");
    if (effectiveKind === "REVIEW") return this.tryReviewRecommendation(intent.reviewDecision!, intent.reviewTarget, identity, sessionId);
    if (effectiveKind === "SELECT") {
      const recommendation = await prisma.fitnessRecommendation.findFirst({ where: { userId: identity.userId, sessionId }, orderBy: { createdAt: "desc" } });
      if (!recommendation) return { answer: "Hãy tìm PT hoặc chương trình phù hợp trước khi chọn.", blocks: [] };
      if (!intent.candidateNumber && recommendation.candidateIds.length !== 1) return { answer: "Bạn muốn chọn mục nào? Hãy dùng nút Chọn hoặc nói số thứ tự để tránh chọn nhầm.", blocks: [recommendation.result as AgentBlock] };
      const candidateId = recommendation.candidateIds[(intent.candidateNumber ?? 1) - 1];
      if (!candidateId) return { answer: "Số thứ tự không có trong danh sách hiện tại.", blocks: [recommendation.result as AgentBlock] };
      const block = await this.prepare(identity, recommendation.id, candidateId);
      return { answer: "Hãy kiểm tra thông tin bên dưới và xác nhận trước khi thay đổi kế hoạch hoặc đăng ký PT.", blocks: [block] };
    }
    const context = await fitnessAgentDeps.tools.getUserFitnessContext(identity);
    const previous = await prisma.fitnessRecommendation.findFirst({ where: { userId: identity.userId, sessionId }, orderBy: { createdAt: "desc" } });
    const previousPreferences = previous ? (previous.contextSnapshot as any)?.preferences : {};
    // resumeKnownSlots (only set on a workflow resume — see orchestrator.ts)
    // carries FIND_PT/FIND_TRAINING_PROGRAM's own WORKFLOW_ONLY goal/days/
    // sessionMinutes/budgetVnd slots, just resolved via chat this turn but
    // deliberately never written to UserProfile — without this, a resumed
    // PT/PROGRAM search would re-derive preferences from the (unchanged)
    // profile alone and immediately re-ask what the user just answered.
    // Codex Evaluation #1 §16/§40 (extended by docs/conversational-ai-coach-
    // remediation-2.md §7) — resumeKnownSlots.budgetVnd may be the workflow's
    // own "NO_CAP" sentinel (find-pt-program.workflow.ts), never a real
    // AgentPreferences.budgetVnd value. Detected and stripped to `undefined`
    // BEFORE the zod parse below — AgentPreferencesSchema.budgetVnd is a
    // strict positive-number schema and would throw on the raw string.
    // `noBudgetCap` is tracked separately so the requiredness check right
    // below can treat an explicit no-cap answer as satisfied, not as
    // "still missing" (which is what a bare falsy budgetVnd already means).
    const resumeBudget = (workflowResult?.resumeKnownSlots as { budgetVnd?: unknown } | undefined)?.budgetVnd;
    const noBudgetCap = resumeBudget === "NO_CAP";
    const resumeKnownSlotsForPreferences = noBudgetCap
      ? { ...workflowResult?.resumeKnownSlots, budgetVnd: resolveBudgetPreference(resumeBudget as never) }
      : workflowResult?.resumeKnownSlots;
    const preferences = AgentPreferencesSchema.parse({
      goal: context.profile.goal ?? undefined, days: context.profile.days.length ? context.profile.days : undefined,
      sessionMinutes: context.profile.sessionMinutes, budgetVnd: context.profile.budgetVnd ?? undefined,
      ...previousPreferences, ...resumeKnownSlotsForPreferences, ...intent.preferences,
    });
    if (!preferences.goal || !preferences.days?.length || (effectiveKind === "PT" && !preferences.budgetVnd && !noBudgetCap)) {
      return { answer: "Để tìm lựa chọn phù hợp, hãy cho biết mục tiêu, các ngày bạn tập được (ví dụ T2-T4-T6), thời lượng mỗi buổi và ngân sách nếu cần PT.", blocks: [] };
    }
    const evidence = fitnessAgentDeps.tools.getScientificEvidence(preferences.goal);
    const recommendationId = randomUUID();
    let block: AgentBlock;
    let historyAuditId: string | null = null;
    if (effectiveKind === "PT") {
      const retrieval = await fitnessAgentDeps.tools.findPTCandidates(identity, preferences);
      historyAuditId = retrieval.historyAuditId;
      const ranked = retrieval.candidates
        .map(pt => ({ pt, compatibility: scorePT(pt, preferences) }))
        .sort((a, b) => b.compatibility.total - a.compatibility.total || a.pt.id.localeCompare(b.pt.id))
        .slice(0, 5);
      // Recommendation Narrator (docs/ai-agent-system-target-architecture.md
      // §3/§6) — the ONE new LLM capability in this flow. It never re-ranks
      // or re-scores `ranked` above; it only explains it. Never allowed to
      // break the recommendation itself: any failure (timeout, disabled,
      // validation rejection) degrades to the original static why[] strings
      // per-candidate, never a thrown error or an empty result.
      // Image -> GoalContext -> Recommendation loop closure (docs/
      // ai-agent-implementation-report.md's own named gap, closed
      // 2026-09-14): context.profile.goalIntent is the confirmed
      // GoalIntentSchema-shaped object from the goal-image/text-goal flow
      // (fitness-goal-vision.service.ts -> POST /profile/agent/goal),
      // already flowing through getUserFitnessContext() via HTTP
      // passthrough but never read until now. Only categorical fields are
      // extracted (extractGoalIntentGrounding) — never anything numeric —
      // and it informs narration only, never scorePT's ranking formula.
      const goalIntent = extractGoalIntentGrounding((context.profile as { goalIntent?: unknown }).goalIntent);
      const narrationResult = await fitnessAgentDeps.narrateRecommendations(
        ranked.map(r => ({ candidate: r.pt, compatibility: r.compatibility, history: r.pt.history })),
        evidence,
        { userId: identity.userId, goalIntent },
      ).catch(err => {
        logger.warn({ err: (err as Error)?.message, userId: identity.userId }, "[fitness-agent] recommendation narration failed; using static why[] fallback");
        return { narrations: [], usedFallback: true };
      });
      // Observability (docs/ai-agent-system-target-architecture.md §7):
      // narrationUsed/narrationFallbackCount/historicalCohortsAvailable let
      // an evaluator (or the eval suite) distinguish "narration ran and
      // passed validation" from "silently fell back to templates" without
      // needing a live LLM to reproduce the run — same log-line discipline
      // as the rest of this file's structured logger.warn calls.
      logger.info({
        userId: identity.userId, candidateCount: ranked.length,
        narratedCount: narrationResult.narrations.length,
        narrationFallbackCount: ranked.length - narrationResult.narrations.length,
        usedNarrationFallback: narrationResult.usedFallback,
        historicalCohortsAvailable: ranked.filter(r => r.pt.history.count > 0).length,
        evidenceCount: evidence.length,
      }, "[fitness-agent] PT recommendation narration summary");
      const narrationById = new Map(narrationResult.narrations.map(n => [n.candidateId, n]));
      const candidates = ranked.map(({ pt, compatibility }) => {
        const narration = narrationById.get(pt.id) ?? null;
        return {
          ...pt, compatibility,
          why: narration ? [narration.summary, ...narration.strengths] : [
            "Chuyên môn phù hợp mục tiêu đã chọn", "Có lịch trống và gói trong giới hạn ngân sách",
            pt.history.note,
          ],
          narration,
        };
      });
      block = { type: "PT_RECOMMENDATIONS", recommendationId, candidates, evidence,
        warnings: context.profile.reviewRequired ? ["Bạn đã báo cáo yếu tố sức khỏe cần chuyên gia xem xét."] : [],
        truncated: retrieval.truncated, usedNarrationFallback: narrationResult.usedFallback };
    } else {
      const retrieval = await fitnessAgentDeps.tools.findTrainingPrograms(identity, preferences);
      const goalIntent = extractGoalIntentGrounding((context.profile as { goalIntent?: unknown }).goalIntent);
      const ranked = retrieval.programs
        .map(program => ({
          program,
          compatibility: scoreTrainingProgramV2(program, preferences, {
            userExperience: context.profile.experience,
            goalIntentFocusMuscles: goalIntent?.focusMuscles,
          }),
        }))
        .sort((a, b) => b.compatibility.total - a.compatibility.total || a.program.id.localeCompare(b.program.id))
        .slice(0, 5);
      const narrationResult = await fitnessAgentDeps.narrateProgramRecommendations(
        ranked.map(r => ({ program: r.program, compatibility: r.compatibility })),
        evidence,
        { userId: identity.userId },
      ).catch(err => {
        logger.warn({ err: (err as Error)?.message, userId: identity.userId }, "[fitness-agent] program narration failed; using static why[] fallback");
        return { narrations: [], usedFallback: true };
      });
      logger.info({
        userId: identity.userId, candidateCount: ranked.length,
        narratedCount: narrationResult.narrations.length,
        narrationFallbackCount: ranked.length - narrationResult.narrations.length,
        usedNarrationFallback: narrationResult.usedFallback,
        evidenceCount: evidence.length,
      }, "[fitness-agent] program recommendation narration summary");
      const narrationById = new Map(narrationResult.narrations.map(n => [n.candidateId, n]));
      const candidates = ranked.map(({ program, compatibility }) => {
        const narration = narrationById.get(program.id) ?? null;
        return {
          ...program,
          compatibility,
          why: narration ? [narration.summary, ...narration.strengths] : [
            "Mục tiêu, trình độ, thiết bị và số ngày phù hợp với dữ liệu hồ sơ hiện tại.",
            "Thời lượng ước tính nằm trong giới hạn bạn đã đưa ra.",
            "Chưa có cohort kết quả đủ tin cậy cho từng template chương trình; điểm này không phải dự đoán kết quả cá nhân.",
          ],
          narration,
          history: {
            count: 0,
            note: "No sufficiently grounded program-template outcome cohort is available yet.",
            dataOrigin: program.dataOrigin,
          },
        };
      });
      block = { type: "PROGRAM_RECOMMENDATIONS", recommendationId, candidates, evidence, warnings: retrieval.warnings, usedNarrationFallback: narrationResult.usedFallback };
    }
    const candidates = block.candidates as Array<{ id: string }>;
    await prisma.fitnessRecommendation.create({ data: {
      id: recommendationId, userId: identity.userId, sessionId, type: effectiveKind,
      contextSnapshot: { preferences, experience: context.profile.experience, reviewRequired: context.profile.reviewRequired, historyAuditId,
        trainingSummary: { ...context.coach.training_summary }, nutritionSummary: { ...context.coach.nutrition_summary } },
      candidateIds: candidates.map(c => c.id), scoringVersion: effectiveKind === "PT" ? FITNESS_SCORING.version : PROGRAM_SCORING_V2.version,
      similarityVersion: FITNESS_SCORING.similarityVersion, evidenceIds: evidence.map(e => e.id), historicalJourneyIds: [], result: block as any,
    } });
    return { answer: candidates.length
      ? "Đây là các lựa chọn phù hợp từ dữ liệu Gymini. Compatibility Score là điểm phù hợp, không phải xác suất thành công. Mở từng thẻ để xem lý do và nguồn bằng chứng."
      : "Chưa có lựa chọn phù hợp với các điều kiện hiện tại. Bạn có thể đổi lịch, ngân sách hoặc hình thức tập rồi thử lại.", blocks: [block] };
  },
  async prepare(identity: AgentIdentity, recommendationId: string, candidateId: string, packageId?: string): Promise<AgentBlock> {
    const rec = await prisma.fitnessRecommendation.findFirst({ where: { id: recommendationId, userId: identity.userId } });
    if (!rec || !rec.candidateIds.includes(candidateId)) throw fail("Recommendation not found", 404);
    await ownSession(identity, rec.sessionId);
    if (Date.now() - rec.createdAt.getTime() > 30 * 60000) throw fail("Recommendation expired. Search again.", 409);
    const candidates = (rec.result as any).candidates as any[];
    const candidate = candidates.find(c => c.id === candidateId);
    const preferences = (rec.contextSnapshot as any).preferences as AgentPreferences;
    const kind: AgentActionKind = rec.type === "PT" ? "CREATE_PT_CONTRACT_DRAFT" : "APPLY_TRAINING_PLAN";
    const selectedPackage = rec.type === "PT" ? candidate.packages.find((p: any) => packageId ? p.id === packageId : p.id === candidate.packages[0]?.id) : null;
    if (rec.type === "PT" && !selectedPackage) throw fail("Package not found", 404);
    const action = await prisma.fitnessAgentAction.create({ data: {
      userId: identity.userId, sessionId: rec.sessionId, recommendationId: rec.id, kind, risk: agentActionRisk(kind),
      payload: rec.type === "PT" ? { ptId: candidateId, packageId: selectedPackage.id, preferences }
        : { templateId: candidateId, fingerprint: candidate.fingerprint, preferences, startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()) },
      expiresAt: new Date(Date.now() + 15 * 60000),
    } });
    await prisma.fitnessRecommendation.update({ where: { id: rec.id }, data: { selectedCandidateId: candidateId } });
    return { type: "ACTION_CONFIRMATION", actionId: action.id, kind, risk: action.risk,
      title: candidate.name, summary: selectedPackage ?? { days: candidate.daysPerWeek, durationWeeks: candidate.durationWeeks, replacesCurrentPlan: true },
      expiresAt: action.expiresAt.toISOString(), note: rec.type === "PT" ? "Tạo bản nháp; chưa thanh toán. PT vẫn phải duyệt yêu cầu qua quy trình hợp đồng hiện có." : "Áp dụng sẽ thay thế lịch chưa hoàn thành và liên kết chương trình với chu kỳ tập." };
  },
  async execute(identity: AgentIdentity, actionId: string, confirmed: boolean): Promise<AgentBlock> {
    if (confirmed !== true) throw fail("Explicit confirmation required");
    const action = await prisma.fitnessAgentAction.findFirst({ where: { id: actionId, userId: identity.userId } });
    if (!action) throw fail("Action not found", 404);
    await ownSession(identity, action.sessionId);
    if (action.status === "COMPLETED") return action.result as AgentBlock;
    // Terminal-state invariant (M3): only a PENDING action may execute.
    // CANCELLED is terminal — a stale card / second tab / replay never
    // resurrects it. Checked in the common entry BEFORE any business call.
    if (action.status === "CANCELLED") throw fail("Action is CANCELLED and can no longer be confirmed.", 409);
    if (action.status !== "PENDING" && action.status !== "EXECUTING") throw fail(`Action is ${action.status} and can no longer be confirmed.`, 409);
    if (action.expiresAt < new Date() && action.status === "PENDING") throw fail("Action expired. Refresh the recommendation.", 409);

    // Finalization race closure: confirm and dismiss compete on ONE atomic DB
    // transition, PENDING -> EXECUTING (confirm) / PENDING -> CANCELLED
    // (dismiss), each a single conditional UPDATE. Exactly one wins; the
    // loser re-reads and answers truthfully. Works across processes (the
    // arbiter is the row, not memory) and no DB transaction is held across
    // the business HTTP call: short claim, external call, short finalize.
    let claimed = false;
    if (action.status === "PENDING") {
      claimed = (await prisma.fitnessAgentAction.updateMany({
        where: { id: action.id, userId: identity.userId, status: "PENDING" },
        data: { status: "EXECUTING", result: { executingSince: new Date().toISOString() } },
      })).count === 1;
    } else {
      // EXECUTING: another request owns it. Only a STALE claim (crashed
      // process) may be reclaimed; the downstream sourcePlanId idempotency
      // makes the retry safe. Reclaim is itself a conditional update on the
      // exact stale marker we read, so two reclaimers cannot both win.
      const since = Date.parse((action.result as any)?.executingSince ?? "");
      if (Number.isFinite(since) && Date.now() - since > EXECUTION_STALE_MS) {
        claimed = (await prisma.fitnessAgentAction.updateMany({
          where: { id: action.id, userId: identity.userId, status: "EXECUTING", result: { equals: action.result as any } },
          data: { result: { executingSince: new Date().toISOString() } },
        })).count === 1;
      }
    }
    if (!claimed) {
      const latest = await prisma.fitnessAgentAction.findFirst({ where: { id: action.id, userId: identity.userId }, select: { status: true, result: true } });
      if (latest?.status === "COMPLETED") return latest.result as AgentBlock; // the winner already finished: idempotent
      if (latest?.status === "EXECUTING") throw fail("Action is already being executed — please wait a moment.", 409);
      throw fail(`Action is ${latest?.status ?? "unavailable"} and can no longer be confirmed.`, 409);
    }
    const release = () => prisma.fitnessAgentAction.updateMany({ where: { id: action.id, userId: identity.userId, status: "EXECUTING" }, data: { status: "PENDING", result: null as any } });
    let outcome: { block: AgentBlock; retryable: boolean };
    try {
      outcome = await this.runActionBranch(identity, action);
    } catch (err) {
      await release(); // nothing was committed by the business layer -> retryable, never stuck EXECUTING
      throw err;
    }
    if (outcome.retryable) {
      // The business write FAILED after we claimed it. Do not record a fake
      // COMPLETED: hand the action back to PENDING so the user can retry (or
      // dismiss) and the stored state agrees with the real outcome.
      await release();
      return outcome.block;
    }
    await prisma.fitnessAgentAction.updateMany({ where: { id: action.id, status: "EXECUTING" }, data: { status: "COMPLETED", result: outcome.block as any } });
    return outcome.block;
  },
  /** The per-kind business branches, run ONLY after the caller holds the
   * atomic EXECUTING claim (see execute()). `retryable` = the business write
   * failed and the claim must be handed back. */
  async runActionBranch(identity: AgentIdentity, action: { id: string; kind: string; sessionId: string; recommendationId: string | null; payload: unknown }): Promise<{ block: AgentBlock; retryable: boolean }> {
    const payload = action.payload as any;
    let block: AgentBlock;
    let retryable = false;
    if (action.kind === "CREATE_PT_CONTRACT_DRAFT") {
      const draft = await fitnessAgentDeps.tools.createPTContractDraft(identity, { ...payload, actionId: action.id });
      // Stable second action ID allows recovery after an upstream success/lost response.
      const confirmation = await prisma.fitnessAgentAction.upsert({ where: { id: draft.id }, update: {}, create: {
        id: draft.id, userId: identity.userId, sessionId: action.sessionId, recommendationId: action.recommendationId,
        kind: "CONFIRM_PT_CONTRACT", risk: "HIGH", payload: { draftId: draft.id }, expiresAt: new Date(draft.expiresAt),
      } });
      block = { type: "ACTION_CONFIRMATION", actionId: confirmation.id, kind: confirmation.kind, risk: "HIGH", title: "Xác nhận yêu cầu hợp đồng PT",
        summary: draft.snapshot, expiresAt: draft.expiresAt, note: "Chỉ gửi yêu cầu hợp đồng. PT duyệt và bạn thanh toán qua quy trình hiện có; chưa tự động trừ tiền." };
    } else if (action.kind === "CONFIRM_PT_CONTRACT") {
      block = { type: "ACTION_RESULT", ...await fitnessAgentDeps.tools.confirmPTContract(identity, payload.draftId) };
    } else if (action.kind === "APPLY_TRAINING_PLAN") {
      block = { type: "ACTION_RESULT", ...await fitnessAgentDeps.tools.applyTrainingPlan(identity, { ...payload, actionId: action.id, confirmed: true }) };
    } else if (
      action.kind === "ACCEPT_TRAINING_RECOMMENDATION" || action.kind === "REJECT_TRAINING_RECOMMENDATION" ||
      action.kind === "ACCEPT_NUTRITION_RECOMMENDATION" || action.kind === "REJECT_NUTRITION_RECOMMENDATION"
    ) {
      await fitnessAgentDeps.tools.reviewRecommendation(identity, payload);
      const isNutrition = action.kind.includes("NUTRITION");
      const isAccept = action.kind.startsWith("ACCEPT");
      block = { type: "ACTION_RESULT", message: `Đã ${isAccept ? "chấp nhận" : "từ chối"} đề xuất ${isNutrition ? "dinh dưỡng" : "tập luyện"}.`, nextUrl: "/client/training" };
    } else if (action.kind === "CREATE_PLAN_BUNDLE") {
      // Three real, independent writes in sequence, each already a
      // separately-tested existing operation. Never claim full success on
      // partial failure — report exactly which step failed, and DON'T
      // retry a step that already succeeded if this whole action is
      // re-confirmed after a partial failure (status stays PENDING on
      // error below, but each individual create/apply call below is
      // itself idempotent-ish: activateRoadmap on an already-ACTIVE
      // roadmap and bootstrapNutrition on an existing goal are both no-ops
      // per their own service logic, not duplicate-creators).
      const draft = payload.roadmapDraft as any;
      const steps: { step: string; ok: boolean; detail?: string }[] = [];
      let roadmapId: string | null = null;
      try {
        const accepted = await fitnessAgentDeps.tools.acceptRoadmapDraft(identity, {
          name: "Lộ trình do AI Coach tạo", goalType: draft.goalType, plannedStartAt: draft.plannedStartAt,
          phases: draft.phases,
          configuration: { aiDraft: { summary: draft.summary, reasoningSummary: draft.reasoningSummary, confidence: draft.confidence, warnings: draft.warnings, assumptions: draft.assumptions } },
        });
        roadmapId = (accepted as any).roadmap.id;
        await fitnessAgentDeps.tools.activateRoadmap(identity, roadmapId!);
        steps.push({ step: "roadmap", ok: true });
      } catch (err: any) {
        steps.push({ step: "roadmap", ok: false, detail: err?.message ?? "Không tạo được lộ trình" });
      }
      if (payload.workoutCandidate) {
        try {
          await fitnessAgentDeps.tools.applyTrainingPlan(identity, {
            templateId: payload.workoutCandidate.id, fingerprint: payload.workoutCandidate.fingerprint,
            preferences: payload.preferences,
            startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
            actionId: action.id, confirmed: true,
          });
          steps.push({ step: "workout", ok: true });
        } catch (err: any) {
          steps.push({ step: "workout", ok: false, detail: err?.message ?? "Không tạo được chương trình tập" });
        }
      } else {
        steps.push({ step: "workout", ok: false, detail: "Không có chương trình tập phù hợp để áp dụng" });
      }
      try {
        const nutritionResult = await fitnessAgentDeps.tools.bootstrapNutrition(identity);
        steps.push({ step: "nutrition", ok: true, detail: (nutritionResult as any).data?.status });
      } catch (err: any) {
        steps.push({ step: "nutrition", ok: false, detail: err?.message ?? "Không tạo được mục tiêu dinh dưỡng" });
      }
      const allOk = steps.every(s => s.ok);
      const label: Record<string, string> = { roadmap: "Lộ trình", workout: "Chương trình tập", nutrition: "Mục tiêu dinh dưỡng" };
      const summaryLines = steps.map(s => `${s.ok ? "✅" : "❌"} ${label[s.step]}${s.detail ? ` — ${s.detail}` : ""}`);
      block = {
        type: "ACTION_RESULT",
        message: allOk
          ? "Đã tạo và kích hoạt lộ trình, chương trình tập và mục tiêu dinh dưỡng thật trên hệ thống."
          : "Một số phần chưa tạo được — xem chi tiết bên dưới, các phần còn lại vẫn đã được tạo thật.",
        steps: summaryLines,
        nextUrl: "/client/dashboard",
      };
    } else if (action.kind === "SAVE_GENERATED_PLAN") {
      // weeklySchedule was already resolved to real exerciseIds at propose
      // time (see proposeSaveGeneratedPlan) — what's confirmed here is
      // exactly what was previewed, no re-generation/re-matching step that
      // could drift from what the user actually saw and agreed to.
      try {
        const result = await fitnessAgentDeps.tools.importAiPlanToSchedule(identity, {
          sourcePlanId: action.id, sourcePlanName: "Lịch tập vừa đề xuất",
          goal: payload.goal, durationWeeks: 8, daysPerWeek: payload.daysPerWeek,
          startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
          repeatWeeks: 8, weeklySchedule: payload.weeklySchedule, replaceExisting: true,
        });
        block = { type: "ACTION_RESULT", message: "Đã lưu lịch tập vào hệ thống, thay thế lịch tập chưa hoàn thành hiện tại.",
          steps: [`✅ Chương trình tập — ${(result as any).message ?? "đã lưu"}`], nextUrl: "/client/training" };
      } catch (err: any) {
        retryable = true;
        block = { type: "ACTION_RESULT", message: `Không lưu được lịch tập — ${err?.message ?? "lỗi không xác định"}.`,
          steps: [`❌ Chương trình tập — ${err?.message ?? "lỗi không xác định"}`], nextUrl: "/client/training" };
      }
    } else if (action.kind === "CREATE_WORKOUT_PLAN") {
      // Same persistence boundary as SAVE_GENERATED_PLAN above
      // (importAiPlanToSchedule) — what's confirmed here is exactly what
      // was last previewed/revised (see proposeWorkoutPlan/
      // tryReviseWorkoutPlanDraft), no separate regeneration step that
      // could drift from what the user actually saw and agreed to.
      // importAiPlanToSchedule is idempotent per (userId, sourcePlanId) —
      // a repeated confirm of this same action produces one logical write.
      try {
        const result = await fitnessAgentDeps.tools.importAiPlanToSchedule(identity, {
          sourcePlanId: action.id, sourcePlanName: "Lịch tập do AI Coach tạo",
          goal: payload.goal ?? "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: payload.weeklySchedule.length,
          startDate: todayHcm(),
          repeatWeeks: 8, weeklySchedule: payload.weeklySchedule, replaceExisting: true,
          // M7: the reviewed weekday pattern; without it the import lays days
          // on consecutive dates from startDate.
          ...(Array.isArray(payload.selectedWeekdays) && payload.selectedWeekdays.length === payload.weeklySchedule.length ? { selectedWeekdays: payload.selectedWeekdays } : {}),
        });
        block = { type: "ACTION_RESULT", message: "Đã lưu lịch tập vào hệ thống, thay thế lịch tập chưa hoàn thành hiện tại.",
          steps: [`✅ Chương trình tập — ${(result as any).message ?? "đã lưu"}`], nextUrl: "/client/training" };
      } catch (err: any) {
        retryable = true;
        block = { type: "ACTION_RESULT", message: `Không lưu được lịch tập — ${err?.message ?? "lỗi không xác định"}.`,
          steps: [`❌ Chương trình tập — ${err?.message ?? "lỗi không xác định"}`], nextUrl: "/client/training" };
      }
    } else if (action.kind === "CREATE_NUTRITION_PLAN") {
      // Real persistence boundary — the SAME fitness-service endpoint
      // POST /plans/:planId/save-to-nutrition itself calls
      // (plan.controller.ts::saveNutritionPlan), invoked directly here
      // since ai-service already has requestService for exactly this.
      // Re-fetches the Plan row fresh (rather than trusting the cached
      // payload.content) so a plan archived/changed between preview and
      // confirm is caught, mirroring the "revalidate before execution"
      // precedent elsewhere in this file.
      if (payload.phase !== "PREVIEW") {
        throw fail("Thực đơn chưa sẵn sàng để lưu — vui lòng đợi tính toán xong.", 409);
      }
      // Revalidate before the write (M3): the plan must still match the
      // authoritative target it was generated against — an accepted cycle
      // adjustment between preview and confirm would otherwise leave a
      // program silently disagreeing with the user's active goal. Fail closed.
      const currentTarget = await resolveNutritionTarget(identity);
      if (!currentTarget.ok || !sameTarget(currentTarget.target, (payload as NutritionDraftPayload).target)) {
        throw fail("Mục tiêu dinh dưỡng của bạn đã thay đổi (hoặc chưa xác minh được) kể từ khi tạo thực đơn — hãy nhờ mình tạo lại thực đơn theo mục tiêu mới.", 409);
      }
      try {
        const plan = await conversationRepository.findNutritionPlanById(payload.planId);
        if (!plan || plan.status !== PlanStatus.COMPLETED || (plan as any).archivedAt) {
          throw new Error("Kế hoạch dinh dưỡng không còn hợp lệ để lưu");
        }
        const planContent = plan.plan as any;
        // What is saved must be exactly what was previewed.
        if (payload.contentHash && hashNutritionContent(planContent) !== payload.contentHash) {
          throw new Error("Nội dung thực đơn đã thay đổi sau khi bạn xem — hãy nhờ mình tạo lại để xem bản mới");
        }
        const savedViolations = findExclusionViolations(planContent, ((payload as NutritionDraftPayload).constraints?.exclusions ?? []).map((e) => e.key));
        if (savedViolations.length > 0) throw new Error(`Thực đơn chứa thực phẩm đã loại trừ (${savedViolations.slice(0, 3).join(", ")}) nên không được lưu`);
        const result = await fitnessAgentDeps.tools.saveNutritionPlanFromAiPlan(identity, {
          sourcePlanId: plan.id, sourcePlanName: plan.name, goal: plan.goal, durationWeeks: plan.durationWeeks,
          mealsPerDay: plan.mealsPerDay, repeatEnabled: false,
          weeklySchedule: planContent.weeklySchedule, dailyCaloriesTarget: planContent.dailyCaloriesTarget,
          proteinTargetGrams: planContent.proteinTargetGrams, carbTargetGrams: planContent.carbTargetGrams, fatTargetGrams: planContent.fatTargetGrams,
        });
        block = { type: "ACTION_RESULT", message: (result as any).message || "Đã lưu thực đơn vào hệ thống dinh dưỡng.", nextUrl: "/client/nutrition" };
      } catch (err: any) {
        retryable = true;
        block = { type: "ACTION_RESULT", message: `Không lưu được thực đơn — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/nutrition" };
      }
    } else if (action.kind === "ROADMAP_ADVANCE") {
      try {
        await fitnessAgentDeps.tools.advanceRoadmapPhase(identity, payload.roadmapId as string);
        // advanceRoadmap can 200-OK without changing anything — confirmed
        // live, two distinct no-op reasons with the exact same HTTP
        // response: (1) the phase still has an ACTIVE cycle, or (2) the
        // most recent cycle closed with no COMPLETED CycleAssessment (e.g.
        // too few logged sessions to assess — "insufficient data"), which
        // the real engine treats as BLOCKED_PENDING_REVIEW/no-op rather
        // than an error. Verify the active phase actually changed, and
        // distinguish which of the two no-op reasons applies so the
        // message stays accurate instead of always blaming "still active".
        const after = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
        const newActivePhaseId = (after as any).activePhase?.id ?? null;
        if (newActivePhaseId && newActivePhaseId !== payload.activePhaseIdBefore) {
          block = { type: "ACTION_RESULT", message: "Đã chuyển lộ trình sang giai đoạn tiếp theo.", nextUrl: "/client/dashboard" };
        } else if ((after as any).activeCycle) {
          block = { type: "ACTION_RESULT", message: "Chưa chuyển được giai đoạn — chu kỳ tập hiện tại vẫn đang chạy (ACTIVE), cần hoàn thành trước khi chuyển giai đoạn.", nextUrl: "/client/dashboard" };
        } else {
          block = { type: "ACTION_RESULT", message: "Chưa chuyển được giai đoạn — chu kỳ tập gần nhất chưa có đánh giá đầy đủ (ví dụ chưa đủ buổi tập được ghi nhận), cần dữ liệu tập luyện thật trước khi có thể chuyển giai đoạn.", nextUrl: "/client/dashboard" };
        }
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không chuyển được giai đoạn — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else if (action.kind === "ROADMAP_REBUILD") {
      try {
        await fitnessAgentDeps.tools.applyRoadmapRebuild(identity, payload.roadmapId as string, payload.assessmentId as string);
        block = { type: "ACTION_RESULT", message: "Đã xây lại lộ trình với các giai đoạn mới.", nextUrl: "/client/dashboard" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không xây lại được lộ trình — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else if (action.kind === "ROADMAP_ARCHIVE") {
      try {
        await fitnessAgentDeps.tools.archiveRoadmap(identity, payload.roadmapId as string);
        block = { type: "ACTION_RESULT", message: "Đã lưu trữ lộ trình.", nextUrl: "/client/dashboard" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không lưu trữ được lộ trình — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else if (action.kind === "CYCLE_COMPLETE") {
      try {
        const result = await fitnessAgentDeps.tools.completeCycle(identity, payload.cycleId as string);
        const decision = (result as any).decision as string | null;
        const decisionLabel = decision ? (TRAINING_DECISION_LABEL_VI[decision] ?? decision) : null;
        block = { type: "ACTION_RESULT", message: `Đã hoàn thành chu kỳ tập.${decisionLabel ? ` Kết quả đánh giá: ${decisionLabel}.` : ""}`, nextUrl: "/client/training" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không hoàn thành được chu kỳ tập — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/training" };
      }
    } else if (action.kind === "CYCLE_CANCEL") {
      try {
        await fitnessAgentDeps.tools.cancelCycle(identity, payload.cycleId as string);
        block = { type: "ACTION_RESULT", message: "Đã hủy chu kỳ tập.", nextUrl: "/client/training" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không hủy được chu kỳ tập — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/training" };
      }
    } else if (action.kind === "NUTRITION_LOG_MEAL") {
      try {
        await fitnessAgentDeps.tools.createNutritionLog(identity, {
          mealType: payload.mealType, foodName: payload.foodName,
          calories: payload.calories, protein: payload.protein, carbs: payload.carbs, fats: payload.fats,
        });
        block = { type: "ACTION_RESULT", message: `Đã ghi lại "${payload.foodName}" vào nhật ký dinh dưỡng.`, nextUrl: "/client/nutrition" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không ghi lại được bữa ăn — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/nutrition" };
      }
    } else if (action.kind === "WORKOUT_START" || action.kind === "WORKOUT_SKIP" || action.kind === "WORKOUT_CANCEL") {
      const VERB: Record<string, string> = { WORKOUT_START: "bắt đầu", WORKOUT_SKIP: "bỏ qua", WORKOUT_CANCEL: "hủy" };
      try {
        if (action.kind === "WORKOUT_START") await fitnessAgentDeps.tools.startWorkoutSchedule(identity, payload.scheduleId as string);
        else if (action.kind === "WORKOUT_SKIP") await fitnessAgentDeps.tools.skipWorkoutSchedule(identity, payload.scheduleId as string);
        else await fitnessAgentDeps.tools.cancelWorkoutSchedule(identity, payload.scheduleId as string);
        block = { type: "ACTION_RESULT", message: `Đã ${VERB[action.kind]} buổi tập hôm nay.`, nextUrl: "/client/training" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không ${VERB[action.kind]} được buổi tập — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/training" };
      }
    } else throw fail("Unsupported action");
    return { block, retryable };
  },
  /** Food-substitution path (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_
   * PLAN.md) — deliberately does NOT go through prepare()/execute(): LOW
   * risk (free, reversible, nutrient-equivalent, never touches the
   * calorie/macro target), confirmed with the product owner to apply in
   * one turn instead. Returns null (never throws) on anything that isn't
   * clearly a substitution request, so the caller falls through to the
   * normal chat pipeline exactly like an unrecognized PT/PROGRAM/SELECT
   * intent would. */
  async trySubstitution(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const extraction = await fitnessAgentDeps.extractFoodSubstitutionIntent(question, identity.userId);
    if (!extraction || !extraction.isFoodSubstitutionRequest || !extraction.currentFoodMention) return null;
    await ownSession(identity, sessionId);
    const result = await fitnessAgentDeps.tools.substituteMealItem(identity, {
      currentFoodMention: extraction.currentFoodMention,
      desiredFoodMention: extraction.desiredFoodMention,
      mealHint: extraction.mealHint,
    });
    const block: AgentBlock = { type: "SUBSTITUTE_RESULT", ...result };
    let answer: string;
    if (result.status === "APPLIED") answer = (result as any).message;
    else if (result.status === "AMBIGUOUS_MEAL" || result.status === "AMBIGUOUS_ITEM") {
      const list = ((result as any).candidates ?? [])
        .map((c: any) => `• ${c.label ?? c.itemName}`)
        .join("\n");
      answer = `${(result as any).message}\n${list}\n\nHãy nói rõ hơn (ví dụ nêu tên bữa) rồi thử lại.`;
    } else answer = (result as any).message;
    return { answer, blocks: [block] };
  },
  // "ghi lại tôi vừa ăn phở bò" — same LLM-extracts-MENTIONS-only precedent
  // as trySubstitution above, but goes through propose -> confirm (unlike
  // substitution) since this creates a brand-new log entry rather than
  // adjusting a bounded, already-planned item. The real calories/macros
  // always come from fitnessAgentTools.searchFood (real catalog), never
  // from the LLM extraction itself.
  async tryMealLog(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const extraction = await fitnessAgentDeps.extractMealLogIntent(question, identity.userId);
    if (!extraction || !extraction.isMealLogRequest || !extraction.foodMention) return null;
    await ownSession(identity, sessionId);
    const food = await fitnessAgentDeps.tools.searchFood(identity, extraction.foodMention);
    if (!food) {
      return {
        answer: `Mình không tìm thấy "${extraction.foodMention}" trong thư viện món ăn để ghi lại chính xác calo/macro. Bạn có thể mô tả món khác, hoặc tự thêm trong trang Dinh dưỡng.`,
        blocks: [],
      };
    }
    const multiplier = extraction.quantityMultiplier ?? 1;
    const vietnamHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hour12: false }).format(new Date()));
    const mealType = extraction.mealType ?? (vietnamHour < 10 ? "breakfast" : vietnamHour < 14 ? "lunch" : vietnamHour < 18 ? "snack" : "dinner");
    const logPayload = {
      mealType, foodName: food.name,
      calories: Math.round(food.calories * multiplier),
      protein: Math.round(food.protein * multiplier * 10) / 10,
      carbs: Math.round(food.carbs * multiplier * 10) / 10,
      fats: Math.round(food.fats * multiplier * 10) / 10,
    };
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "NUTRITION_LOG_MEAL", risk: agentActionRisk("NUTRITION_LOG_MEAL"),
        payload: logPayload,
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const MEAL_TYPE_LABEL_VI: Record<string, string> = { breakfast: "Bữa sáng", lunch: "Bữa trưa", dinner: "Bữa tối", snack: "Bữa phụ" };
    return {
      answer: `Mình sẽ ghi lại "${food.name}"${multiplier !== 1 ? ` (x${multiplier})` : ""} vào ${MEAL_TYPE_LABEL_VI[mealType]} — khoảng ${logPayload.calories} kcal, ${logPayload.protein}g đạm, ${logPayload.carbs}g carb, ${logPayload.fats}g béo. Xác nhận nếu đúng.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "NUTRITION_LOG_MEAL", risk: action.risk,
        title: food.name,
        summary: { ...logPayload, mealTypeLabel: MEAL_TYPE_LABEL_VI[mealType] },
        expiresAt: action.expiresAt.toISOString(),
        note: "Số liệu calo/macro lấy từ thư viện món ăn thật — có thể không khớp 100% cách bạn chế biến, bạn có thể sửa lại sau trong trang Dinh dưỡng.",
      }],
    };
  },
  /** Cycle-evaluation-via-chat (docs/agentic-fitness/01_NUTRITION_AGENT_
   * TOOLS_PLAN.md, phase C) — wraps the EXISTING evaluateCycle() verbatim
   * (same call inbody-reassessment.service.ts already reuses; no new
   * decision logic here at all) and formats its already-computed aiSummary/
   * nutritionAiHeadline/nutritionAiExplanation (produced once during
   * evaluateCycle's own ai-service call) into a chat answer — no separate
   * LLM call needed for this formatting step. Read-only from the user's
   * point of view (accepting/rejecting is a separate REVIEW turn), so runs
   * directly without prepare()/confirm(), same as PT_RECOMMENDATIONS. */
  async tryEvaluateCycle(identity: AgentIdentity): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getActiveCycle>>;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động.", blocks: [] };
      throw err;
    }
    const assessment = await fitnessAgentDeps.tools.evaluateCycle(identity, active.cycle.id);
    const trainingLabel = assessment.decision ? (TRAINING_DECISION_LABEL_VI[assessment.decision] ?? assessment.decision) : "Chưa xác định";
    let answer = `Đánh giá chu kỳ tập: ${trainingLabel}.`;
    if (assessment.aiSummary) answer += ` ${assessment.aiSummary}`;
    if (assessment.nutritionDecision) {
      const nutritionLabel = NUTRITION_DECISION_LABEL_VI[assessment.nutritionDecision] ?? assessment.nutritionDecision;
      answer += `\n\nDinh dưỡng: ${nutritionLabel}.`;
      if (assessment.nutritionAiHeadline) answer += ` ${assessment.nutritionAiHeadline}`;
      if (assessment.nutritionAiExplanation) answer += ` ${assessment.nutritionAiExplanation}`;
    }
    const pending: string[] = [];
    if (assessment.userDecision === "PENDING" && assessment.decision) pending.push("tập luyện");
    if (assessment.nutritionUserDecision === "PENDING" && assessment.nutritionDecision) pending.push("dinh dưỡng");
    if (pending.length) answer += `\n\nBạn có thể nói "chấp nhận" hoặc "từ chối" cho đề xuất ${pending.join(" và ")}.`;
    return { answer, blocks: [{ type: "CYCLE_EVALUATION_RESULT", ...assessment }] };
  },
  /** Accept/reject-via-chat (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_
   * PLAN.md, phase D) — wraps the EXISTING accept/reject endpoints
   * verbatim (same real prescription-change logic TrainingCyclePage's own
   * Accept/Reject buttons call). Real prescription change, so — unlike
   * substitution — this keeps the prepare()/confirm()/execute() flow: this
   * method only ever returns an ACTION_CONFIRMATION, never applies
   * anything itself. Never guesses which target (training/nutrition) when
   * both are pending and the message didn't say — asks instead, same rule
   * as trySubstitution's ambiguous-meal handling. */
  async tryReviewRecommendation(
    decision: "ACCEPT" | "REJECT",
    target: "TRAINING" | "NUTRITION" | undefined,
    identity: AgentIdentity,
    sessionId: string,
  ): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getActiveCycle>>;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động.", blocks: [] };
      throw err;
    }
    let assessment: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getLatestAssessment>>;
    try {
      assessment = await fitnessAgentDeps.tools.getLatestAssessment(identity, active.cycle.id);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Chưa có đánh giá nào cho chu kỳ hiện tại — hãy yêu cầu đánh giá trước.", blocks: [] };
      throw err;
    }
    const trainingPending = assessment.userDecision === "PENDING" && !!assessment.decision;
    const nutritionPending = assessment.nutritionUserDecision === "PENDING" && !!assessment.nutritionDecision;
    let resolvedTarget = target;
    if (!resolvedTarget) {
      if (trainingPending && nutritionPending) {
        return { answer: 'Cả đề xuất tập luyện và dinh dưỡng đều đang chờ. Bạn muốn xử lý đề xuất nào — nói rõ "tập luyện" hoặc "dinh dưỡng".', blocks: [] };
      }
      resolvedTarget = trainingPending ? "TRAINING" : nutritionPending ? "NUTRITION" : undefined;
    }
    if (!resolvedTarget) return { answer: "Hiện không có đề xuất nào đang chờ để chấp nhận hoặc từ chối.", blocks: [] };
    const isPending = resolvedTarget === "NUTRITION" ? nutritionPending : trainingPending;
    if (!isPending) {
      return { answer: `Đề xuất ${resolvedTarget === "NUTRITION" ? "dinh dưỡng" : "tập luyện"} hiện không có gì đang chờ xử lý.`, blocks: [] };
    }
    const kind: AgentActionKind = `${decision === "ACCEPT" ? "ACCEPT" : "REJECT"}_${resolvedTarget}_RECOMMENDATION` as AgentActionKind;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null, kind, risk: agentActionRisk(kind),
        payload: { cycleId: active.cycle.id, assessmentId: assessment.id, target: resolvedTarget, decision },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const block: AgentBlock = {
      type: "ACTION_CONFIRMATION", actionId: action.id, kind, risk: action.risk,
      title: `${decision === "ACCEPT" ? "Chấp nhận" : "Từ chối"} đề xuất ${resolvedTarget === "NUTRITION" ? "dinh dưỡng" : "tập luyện"}`,
      expiresAt: action.expiresAt.toISOString(),
      note: resolvedTarget === "NUTRITION"
        ? "Chấp nhận sẽ tạo phiên bản mục tiêu dinh dưỡng mới theo đề xuất."
        : "Chấp nhận sẽ ghi nhận đề xuất; áp dụng chương trình tập mới (nếu có) vẫn là bước riêng.",
    };
    return { answer: "Hãy kiểm tra thông tin bên dưới và xác nhận.", blocks: [block] };
  },
  /** Agent automation — "hãy tạo và gán lộ trình + plan tập + dinh dưỡng vào
   * hệ thống". Everything below is READ-ONLY (a real AI roadmap draft +
   * a real matched workout candidate, both already-existing endpoints
   * GuidedRoadmapWizard.tsx / the program-recommendation flow already call)
   * — nothing is created/activated until the user explicitly confirms via
   * the normal execute()/ACTION_CONFIRMATION flow below, same as every
   * other real write in this file. */
  async proposePlanBundle(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile;
    const missing: string[] = [];
    if (!profile.goal) missing.push("mục tiêu (giảm mỡ/tăng cơ/duy trì/hiệu suất)");
    if (profile.age == null) missing.push("tuổi");
    if (profile.heightCm == null) missing.push("chiều cao");
    if (profile.currentWeightKg == null) missing.push("cân nặng");
    if (!profile.gender) missing.push("giới tính");
    if (missing.length > 0) {
      return {
        answer: `Mình cần thêm vài thông tin trong hồ sơ của bạn trước khi lên lộ trình thật: ${missing.join(", ")}. Hãy cập nhật hồ sơ (hoặc đo InBody) rồi thử lại — mình sẽ không tự giả định số liệu cho một lộ trình sắp được kích hoạt thật.`,
        blocks: [],
      };
    }
    const goalType = profile.goal as "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";

    const draft = await fitnessAgentDeps.tools.generateRoadmapDraft(identity, {
      goalType,
      timeframeWeeks: 16,
    }) as any;

    const preferredDays = profile.training?.preferredTrainingDays?.length
      ? profile.training.preferredTrainingDays
      : profile.training?.trainingDaysPerWeek
        ? Array.from({ length: Math.min(7, profile.training.trainingDaysPerWeek) }, (_, i) => i + 1)
        : [1, 3, 5];
    const preferences = AgentPreferencesSchema.parse({
      goal: goalType,
      days: preferredDays,
      sessionMinutes: 60,
    });
    let workoutCandidate: any = null;
    try {
      const programs = await fitnessAgentDeps.tools.findTrainingPrograms(identity, preferences);
      // Top-ranked candidate only — this flow is "create everything with one
      // confirm", not another round of choosing between programs (that's
      // what the existing PROGRAM_RECOMMENDATIONS flow is already for).
      workoutCandidate = programs.programs[0] ?? null;
    } catch (err: any) {
      // Non-fatal: the roadmap + nutrition parts can still be proposed even
      // if no matching workout template exists right now.
      workoutCandidate = null;
    }

    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CREATE_PLAN_BUNDLE", risk: agentActionRisk("CREATE_PLAN_BUNDLE"),
        payload: { roadmapDraft: draft, workoutCandidate, preferences },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });

    const block = buildPlanBundleConfirmationBlock(draft, workoutCandidate, action.id, action.risk, action.expiresAt);
    return {
      answer: draft?.summary
        ? `Đây là lộ trình mình đề xuất dựa trên hồ sơ thật của bạn:\n\n${draft.summary}\n\nKiểm tra chi tiết bên dưới và xác nhận nếu bạn muốn tạo thật.`
        : "Kiểm tra thông tin bên dưới và xác nhận nếu bạn muốn tạo thật.",
      blocks: [block],
    };
  },
  /** ROADMAP_REVISION — a free-text message while a CREATE_PLAN_BUNDLE
   * preview is still PENDING for this session (see tryTurn's `!intent.kind`
   * branch). Regenerates the SAME draft-only preview with the user's
   * revision text appended as a `constraints` entry — real, existing,
   * accepted field on generateAiRoadmapDraftSchema (fitness-service) that
   * ai-service's own roadmap-draft prompt already renders as "Ràng buộc
   * khác: ..." (see roadmap-draft.service.ts), so this is not a new
   * capability, just a new caller of one that already influences
   * generation. Never touches the active roadmap — accept/activate only
   * ever happens once, at the existing CREATE_PLAN_BUNDLE confirm step,
   * completely unchanged. Returns null (not an error) when there is no
   * live pending plan-bundle preview to revise, so tryTurn falls through to
   * its normal dispatch for genuinely unrelated messages. */
  async tryReviseRoadmapDraft(question: string, identity: AgentIdentity, sessionId: string, given?: { id: string; risk: string; payload: unknown }): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const trimmed = question.trim();
    if (!trimmed) return null;
    const action = given ?? await prisma.fitnessAgentAction.findFirst({
      where: { userId: identity.userId, sessionId, kind: "CREATE_PLAN_BUNDLE", status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!action) return null;
    const payload = action.payload as any;
    const goalType = payload?.roadmapDraft?.goalType;
    if (!goalType) return null;
    const priorConstraints: string[] = Array.isArray(payload.constraints) ? payload.constraints : [];
    const constraints = [...priorConstraints, trimmed].slice(-20); // generateAiRoadmapDraftSchema caps at 20
    let draft: any;
    try {
      draft = await fitnessAgentDeps.tools.generateRoadmapDraft(identity, { goalType, timeframeWeeks: 16, constraints });
    } catch (err: any) {
      return { answer: `Mình chưa điều chỉnh được lộ trình lúc này — ${err?.message ?? "lỗi không xác định"}. Bạn thử lại sau ít phút, hoặc xác nhận lộ trình hiện tại nếu vẫn phù hợp.`, blocks: [] };
    }
    const expiresAt = new Date(Date.now() + 15 * 60000);
    await prisma.fitnessAgentAction.update({
      where: { id: action.id },
      data: { payload: { ...payload, roadmapDraft: draft, constraints, lastTouchedAt: new Date().toISOString() }, expiresAt },
    });
    const block = buildPlanBundleConfirmationBlock(draft, payload.workoutCandidate, action.id, action.risk, expiresAt);
    return {
      answer: draft?.summary
        ? `Mình đã điều chỉnh lộ trình theo yêu cầu của bạn:\n\n${draft.summary}\n\nKiểm tra lại bên dưới — bạn có thể tiếp tục yêu cầu điều chỉnh, hoặc xác nhận nếu đã ưng ý.`
        : "Mình đã điều chỉnh lộ trình theo yêu cầu của bạn. Kiểm tra lại bên dưới và xác nhận nếu đã ưng ý.",
      blocks: [block],
    };
  },
  // "gán/lưu lịch tập [vừa tạo] vào hệ thống" — the chat "hãy tạo lịch tập"
  // answer is produced by recommendation_engine.ts, a DETERMINISTIC template
  // (pure function of profile+question) that is never persisted anywhere —
  // no WorkoutPlan row, no id. So "save what you just showed me" means:
  // find the question that produced it (Conversation.routeIntent), re-run
  // the exact same deterministic computation to reproduce it byte-for-byte,
  // resolve its free-text exercise names against the real catalog (the
  // template has no exerciseId at all), and only then build a real,
  // importable weeklySchedule. What gets previewed here is exactly what
  // gets created on confirm — no separate regeneration step.
  async proposeSaveGeneratedPlan(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    // Collision guard — a natural "lưu/gán lịch tập" phrase matches THIS
    // intent's own regex even while a CREATE_WORKOUT_PLAN preview (a
    // separate, newer draft mechanism — see proposeWorkoutPlan) is still
    // pending for this session; without this, that phrase would silently
    // try to reconstruct a stale recommendation_engine.ts answer instead of
    // the draft the user is actually looking at. Redirect to the real
    // pending draft instead of creating a competing action.
    const pendingWorkoutPlan = await prisma.fitnessAgentAction.findFirst({
      where: { userId: identity.userId, sessionId, kind: "CREATE_WORKOUT_PLAN", status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (pendingWorkoutPlan) {
      const pendingPayload = pendingWorkoutPlan.payload as any;
      return {
        answer: "Bạn đang có một lịch tập vừa được tạo ở trên — hãy bấm \"Xác nhận\" trên thẻ đó để lưu, hoặc tiếp tục nhắn để chỉnh sửa trước khi lưu.",
        blocks: [buildWorkoutPlanPreviewBlock(pendingWorkoutPlan.id, pendingWorkoutPlan.risk, pendingWorkoutPlan.expiresAt, pendingPayload, [])],
      };
    }
    const WORKOUT_PLAN_INTENTS = ["workout_plan_request", "body_recomposition_request", "frequency_change_request", "combined_plan_request"];
    const sourceTurn = await prisma.conversation.findFirst({
      where: { userId: identity.userId, sessionId, routeIntent: { in: WORKOUT_PLAN_INTENTS } },
      orderBy: { createdAt: "desc" },
    });
    if (!sourceTurn) {
      return {
        answer: "Mình chưa thấy lịch tập nào bạn vừa nhờ mình tạo trong đoạn hội thoại này để lưu. Hãy nhờ mình tạo lịch tập trước (ví dụ: \"hãy tạo lịch tập cho tôi\"), sau đó nói lại \"gán vào lịch tập\" — mình sẽ lưu đúng lịch đó vào hệ thống.",
        blocks: [],
      };
    }
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile;
    const routedIntent = intentRouter.route(sourceTurn.question, profile);
    const parsedInput = inputParser.parse(sourceTurn.question, profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;
    const recommendation = recommendationEngine.recommend(profile, parsedInput, "vi");
    const days = recommendation.workoutPlan?.days ?? [];
    if (!days.length) {
      return {
        answer: "Mình không tái tạo lại được lịch tập đã hiển thị trước đó. Bạn có thể nhờ mình tạo lại lịch tập rồi thử lưu lại.",
        blocks: [],
      };
    }
    // Resolve every unique exercise name once (not once per occurrence).
    const uniqueNames = [...new Set(days.flatMap(d => d.exercises.map(e => e.name)))];
    const resolutions = new Map<string, { id: string; exerciseName: string } | null>();
    await Promise.all(uniqueNames.map(async name => {
      resolutions.set(name, await fitnessAgentDeps.tools.searchExerciseByName(identity, name).catch(() => null));
    }));
    const unmatched = new Set<string>();
    const weeklySchedule = days.map(day => ({
      day: day.day, goal: day.goal,
      exercises: day.exercises.flatMap(e => {
        const match = resolutions.get(e.name);
        if (!match) { unmatched.add(e.name); return []; }
        return [{ exerciseId: match.id, name: match.exerciseName, order: e.order, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds, note: e.note }];
      }),
    })).filter(d => d.exercises.length > 0);
    if (!weeklySchedule.length) {
      return {
        answer: "Mình không khớp được bài tập nào trong lịch vừa đề xuất với thư viện bài tập thật, nên chưa thể lưu. Bạn có thể nhờ mình tạo lại lịch tập với các bài phổ biến hơn.",
        blocks: [],
      };
    }
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "SAVE_GENERATED_PLAN", risk: agentActionRisk("SAVE_GENERATED_PLAN"),
        payload: { goal: profile.goal ?? "MUSCLE_GAIN", daysPerWeek: weeklySchedule.length, weeklySchedule },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const unmatchedNote = unmatched.size > 0
      ? ` Lưu ý: ${unmatched.size} bài tập (${[...unmatched].join(", ")}) không khớp được với thư viện bài tập nên sẽ không có trong lịch được lưu.`
      : "";
    return {
      answer: `Mình sẽ lưu đúng lịch tập đã đề xuất (${weeklySchedule.length} ngày/tuần) vào lịch tập thật của bạn, thay thế lịch chưa hoàn thành hiện tại.${unmatchedNote} Xác nhận bên dưới nếu bạn đồng ý.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "SAVE_GENERATED_PLAN", risk: action.risk,
        title: "Lịch tập vừa đề xuất",
        summary: { planName: "Lịch tập vừa đề xuất", daysPerWeek: weeklySchedule.length, durationWeeks: 8, goal: profile.goal, unmatchedCount: unmatched.size },
        expiresAt: action.expiresAt.toISOString(),
        note: "Xác nhận sẽ lưu đúng lịch tập này vào hệ thống, thay thế lịch chưa hoàn thành hiện tại.",
      }],
    };
  },
  // CREATE_WORKOUT_PLAN — "tạo lịch tập cho tôi" (docs/standalone-workout-
  // workflow-design.md). By the time this runs, create-workout-plan.
  // workflow.ts has already resolved daysPerWeek/sessionMinutes (either via
  // resumeKnownSlots, when a workflow row asked for them, or straight from
  // real context otherwise — see contextProfile below, which mirrors that
  // workflow's own readFromContext exactly so there's one source of truth
  // for "already known"). Only the generation itself happens here — the
  // orchestrator never owns domain generation/ranking/writes.
  async proposeWorkoutPlan(identity: AgentIdentity, sessionId: string, resumeKnownSlots?: Record<string, unknown>): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const [personalization, enterpriseContext] = await Promise.all([
      fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader),
      fitnessAgentDeps.tools.getUserFitnessContext(identity),
    ]);
    const profile = personalization.profile as any;
    const contextProfile = enterpriseContext.profile as any;
    const daysPerWeek = (resumeKnownSlots?.daysPerWeek as number | undefined)
      ?? (Array.isArray(contextProfile.days) && contextProfile.days.length ? contextProfile.days.length : undefined)
      ?? 3;
    const sessionMinutes = (resumeKnownSlots?.sessionMinutes as number | undefined)
      ?? (typeof contextProfile.sessionMinutes === "number" ? contextProfile.sessionMinutes : undefined)
      ?? 60;

    // The user's real weekly availability (agent numbering 1=Mon..7=Sun) wins
    // over the engine's hardcoded weekday labels when it matches the day count.
    const { weeklySchedule, selectedWeekdays, unmatchedCount } = await generateWorkoutDraft(identity, profile, daysPerWeek, sessionMinutes, agentDaysToWeekdays(contextProfile.days));
    if (!weeklySchedule.length) {
      return { answer: "Mình chưa tạo được lịch tập phù hợp lúc này. Bạn có thể thử lại, hoặc nêu rõ hơn mục tiêu/số buổi tập.", blocks: [] };
    }
    const warnings = workoutSafetyWarnings(profile);
    const payload = { goal: profile.goal ?? null, sessionMinutes, weeklySchedule, selectedWeekdays, exclusions: [] as string[], lastTouchedAt: new Date().toISOString() };
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CREATE_WORKOUT_PLAN", risk: agentActionRisk("CREATE_WORKOUT_PLAN"),
        payload, expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const unmatchedNote = unmatchedCount > 0 ? ` Lưu ý: ${unmatchedCount} bài tập không khớp được với thư viện bài tập nên đã được bỏ qua.` : "";
    return {
      answer: `Đây là lịch tập mình đề xuất (${weeklySchedule.length} buổi/tuần, khoảng ${sessionMinutes} phút/buổi).${unmatchedNote} Bạn có thể yêu cầu chỉnh sửa (ví dụ đổi bài, đổi thời lượng) hoặc xác nhận để lưu.`,
      blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload, warnings)],
    };
  },
  /** CREATE_WORKOUT_PLAN revision loop — a free-text message while a
   * CREATE_WORKOUT_PLAN preview is still PENDING for this session. Modifies
   * the DRAFT only (the action's own payload); no WorkoutProgram/
   * WorkoutSchedule write happens until the existing confirm/execute()
   * flow runs, completely unchanged. Every branch below either regenerates
   * through generateWorkoutDraft (canonical-ID resolution + the session-
   * length trim run again) or edits already-resolved exerciseIds via the
   * real substitution service — a raw exercise NAME never re-enters the
   * payload. Returns null (not an error) when the message isn't a
   * recognized revision, so tryTurn falls through to its normal dispatch. */
  async tryReviseWorkoutPlanDraft(question: string, identity: AgentIdentity, sessionId: string, given?: { id: string; risk: string; expiresAt: Date; payload: unknown }): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const trimmed = question.trim();
    if (!trimmed) return null;
    const action = given ?? await prisma.fitnessAgentAction.findFirst({
      where: { userId: identity.userId, sessionId, kind: "CREATE_WORKOUT_PLAN", status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!action) return null;
    const payload = action.payload as { goal: string | null; sessionMinutes: number; weeklySchedule: any[]; selectedWeekdays?: number[]; exclusions?: string[] };
    const exclusions = payload.exclusions ?? [];
    const s = normalizeAgentText(trimmed);
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile as any;
    const warnings = workoutSafetyWarnings(profile);

    const respond = async (
      weeklySchedule: any[], sessionMinutes: number, note: string,
      extra: { selectedWeekdays?: number[]; exclusions?: string[] } = {},
    ): Promise<{ answer: string; blocks: AgentBlock[] }> => {
      const expiresAt = new Date(Date.now() + 15 * 60000);
      const newPayload = {
        ...payload, sessionMinutes, weeklySchedule,
        selectedWeekdays: extra.selectedWeekdays ?? payload.selectedWeekdays,
        exclusions: extra.exclusions ?? exclusions,
        lastTouchedAt: new Date().toISOString(),
      };
      await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { payload: newPayload, expiresAt } });
      return { answer: note, blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, expiresAt, newPayload, warnings)] };
    };
    const regenerate = async (count: number, preferred?: number[]) => {
      const draft = await generateWorkoutDraft(identity, profile, count, payload.sessionMinutes, preferred);
      if (!draft.weeklySchedule.length || !exclusions.length) return draft;
      // Re-apply every exclusion already stated in this draft's lifetime.
      const filtered = await substituteMatchingExercises(identity, draft.weeklySchedule, exclusions, exclusions);
      const days = applyWeekdayLabels(filtered.weeklySchedule, draft.selectedWeekdays.slice(0, filtered.weeklySchedule.length));
      return { ...draft, weeklySchedule: days, selectedWeekdays: draft.selectedWeekdays.slice(0, days.length) };
    };

    // "Thêm superset." — honestly unsupported; checked first so it's never
    // silently swallowed by a looser pattern below.
    if (/\bsuperset\b/.test(s)) {
      return {
        answer: "Mình chưa hỗ trợ thêm superset vào lịch tập qua chat. Bạn có thể yêu cầu đổi bài, đổi số buổi/thời lượng, hoặc lưu lịch này rồi chỉnh trực tiếp trong trang Tập luyện.",
        blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload, warnings)],
      };
    }

    // Gated on an explicit unit word before ever calling the parsers below
    // — parseSessionsPerWeek's own bare-digit pattern would otherwise
    // misread "45" out of "Buổi tập ngắn xuống 45 phút." as a day-count.
    const mentionsMinutesUnit = /\b(phut|gio|tieng)\b/.test(s);
    const mentionsDaysUnit = /\b(buoi|ngay)\b/.test(s) && !mentionsMinutesUnit;

    // Training-weekday change — "Tôi tập được thứ 3, 5, 7." The reviewed
    // weekday pattern is preserved all the way to the import payload
    // (M7) — never reduced to a bare count.
    if (/\b(?:thu\s*[2-7]|t[2-7]|chu nhat|cn)\b/.test(s) && !mentionsMinutesUnit) {
      const daysParsed = parseTrainingDays(trimmed);
      if (daysParsed.ok) {
        const weekdays = [...new Set(agentDaysToWeekdays(daysParsed.value) ?? [])].sort((a, b) => weekOrder(a) - weekOrder(b));
        if (weekdays.length >= 1 && weekdays.length <= 7) {
          if (weekdays.length === payload.weeklySchedule.length) {
            const relabeled = applyWeekdayLabels(payload.weeklySchedule, weekdays);
            return respond(relabeled, payload.sessionMinutes, `Mình đã đổi lịch tập sang các ngày: ${weekdays.map(weekdayLabel).join(", ")}.`, { selectedWeekdays: weekdays });
          }
          const draft = await regenerate(weekdays.length, weekdays);
          if (draft.weeklySchedule.length === weekdays.length) {
            return respond(draft.weeklySchedule, payload.sessionMinutes, `Mình đã đổi lịch tập sang ${weekdays.length} buổi/tuần vào: ${weekdays.map(weekdayLabel).join(", ")}.`, { selectedWeekdays: draft.selectedWeekdays });
          }
        }
      }
    }

    // Session-length change — "Buổi tập ngắn xuống 45 phút." Re-trims only
    // (day structure doesn't depend on duration), same trim used at
    // proposal time.
    if (mentionsMinutesUnit) {
      const minutesResult = parseMinutes(trimmed);
      if (minutesResult.ok) {
        const retrimmed = payload.weeklySchedule.map((day: any) => trimDayForSessionMinutes(day, minutesResult.value));
        return respond(retrimmed, minutesResult.value, `Mình đã rút gọn buổi tập xuống khoảng ${minutesResult.value} phút.`);
      }
    }

    // Day-count change — regenerates, since day structure genuinely depends
    // on count (unlike the session-minutes case above, a length-only trim
    // wouldn't be correct here).
    if (mentionsDaysUnit) {
      const daysResult = parseSessionsPerWeek(trimmed);
      if (daysResult.ok) {
        const { weeklySchedule, selectedWeekdays, unmatchedCount } = await regenerate(daysResult.value);
        if (!weeklySchedule.length) {
          return { answer: "Mình chưa tạo lại được lịch tập với số buổi này. Bạn có thể thử số buổi khác.", blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload, warnings)] };
        }
        const unmatchedNote = unmatchedCount > 0 ? ` (${unmatchedCount} bài tập không khớp thư viện đã được bỏ qua)` : "";
        return respond(weeklySchedule, payload.sessionMinutes, `Mình đã đổi lịch tập sang ${weeklySchedule.length} buổi/tuần (${selectedWeekdays.map(weekdayLabel).join(", ")})${unmatchedNote}.`, { selectedWeekdays });
      }
    }

    // Day-intensity reduction — "Ngày chân nhẹ hơn." Reuses intentRouter's
    // own Vietnamese muscle-group keyword matching (never a second,
    // competing keyword map) to find WHICH day, then only reduces sets
    // (never reps/rest — a coarser, safer edit) on that day's exercises.
    if (/\b(nhe hon|nhe di|giam nhe|giam cuong do|it hon)\b/.test(s)) {
      // `s` (already diacritic-stripped) is fed in here, not the raw
      // message — intentRouter's own inferMuscleGroup only .toLowerCase()s
      // its input without stripping diacritics, so raw "chân" would never
      // match its ASCII-only "chan" alternative. Its OTHER patterns (e.g.
      // the routing regex's `l[iị]ch t[aậ]p`-style character classes) also
      // accept the plain-ASCII branch, so normalized input is safe here.
      const muscleHint = intentRouter.route(s, profile).muscleGroupHint;
      const dayRe = muscleHint ? MUSCLE_GROUP_DAY_RE[muscleHint] : undefined;
      if (dayRe) {
        let matched = false;
        const lightened = payload.weeklySchedule.map((day: any) => {
          if (!dayRe.test(normalizeAgentText(`${day.day} ${day.goal}`))) return day;
          matched = true;
          return { ...day, exercises: day.exercises.map((e: any) => ({ ...e, sets: Math.max(2, e.sets - 1) })) };
        });
        if (matched) {
          const retrimmed = lightened.map((day: any) => trimDayForSessionMinutes(day, payload.sessionMinutes));
          return respond(retrimmed, payload.sessionMinutes, "Mình đã giảm nhẹ số hiệp (sets) cho ngày bạn vừa nhắc tới.");
        }
      }
      return {
        answer: "Mình chưa xác định được ngày nào bạn muốn giảm nhẹ — bạn có thể nói rõ nhóm cơ (ví dụ \"ngày chân\", \"ngày ngực\") không?",
        blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload, warnings)],
      };
    }

    // "Cho phương án khác." — broad, best-effort resubstitution.
    if (/\b(phuong an khac|cach khac|option khac|mau khac)\b/.test(s)) {
      const revised = await substituteAllExercises(identity, payload.weeklySchedule, exclusions);
      if (!revised.changedCount) {
        return { answer: "Mình chưa tìm được phương án thay thế nào khác cho lịch tập hiện tại.", blocks: [buildWorkoutPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload, warnings)] };
      }
      return respond(revised.weeklySchedule, payload.sessionMinutes, `Mình đã đổi ${revised.changedCount} bài tập sang phương án khác.`);
    }

    // Named-exercise exclusion/swap — "Đổi squat.", "Tôi không muốn
    // deadlift.", "Tôi không có máy cable."
    const keyword = extractExerciseRevisionKeyword(trimmed);
    if (keyword) {
      // The keyword also becomes a durable exclusion for the rest of this
      // draft's life (substitutes must not re-introduce it, and later
      // regenerations re-apply it).
      const nextExclusions = [...new Set([...exclusions, keyword])];
      const revised = await substituteMatchingExercises(identity, payload.weeklySchedule, [keyword], nextExclusions);
      if (revised.changedCount > 0 || revised.droppedCount > 0) {
        const parts: string[] = [];
        if (revised.changedCount > 0) parts.push(`đổi ${revised.changedCount} bài`);
        if (revised.droppedCount > 0) parts.push(`bỏ ${revised.droppedCount} bài không tìm được thay thế`);
        // Days may have shrunk (dropped exercises can empty a day) — keep
        // weekdays aligned with the surviving days, in order.
        const keptIdx = revised.weeklySchedule.map((d: any) => payload.weeklySchedule.findIndex((o: any) => o.day === d.day));
        const weekdays = payload.selectedWeekdays && keptIdx.every((i: number) => i >= 0) ? keptIdx.map((i: number) => payload.selectedWeekdays![i]) : undefined;
        return respond(revised.weeklySchedule, payload.sessionMinutes, `Mình đã ${parts.join(" và ")} liên quan đến "${keyword}" và sẽ tránh ${keyword} trong lịch này.`, { exclusions: nextExclusions, ...(weekdays ? { selectedWeekdays: weekdays } : {}) });
      }
    }

    return null;
  },
  // CREATE_NUTRITION_PLAN — "tạo kế hoạch dinh dưỡng cho tôi". Queues the
  // SAME async BullMQ job POST /plans/nutrition/generate would, and returns
  // immediately with an acknowledgement — the preview itself only appears
  // once tryPollOrReviseNutritionPlanDraft (below) sees the job COMPLETED
  // on a later turn. Constraints = the ones captured from the INITIATING
  // message (resumeKnownSlots.nutritionConstraints, remediation M1) MERGED
  // with any in the current turn's own text — never one replacing the other.
  async proposeNutritionPlan(question: string, identity: AgentIdentity, sessionId: string, resumeKnownSlots?: Record<string, unknown>): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const health = await llmService.getHealthStatus();
    if (!health.llmAvailable) {
      return { answer: "AI dinh dưỡng hiện chưa sẵn sàng (mô hình AI chưa hoạt động) — bạn thử lại sau ít phút nhé.", blocks: [] };
    }
    const constraints = mergeNutritionConstraints(
      resumeKnownSlots?.nutritionConstraints as NutritionConstraintSet | undefined,
      extractNutritionConstraints(question),
    );
    if (constraints.unsupported.length > 0) {
      return { answer: unsupportedRestrictionMessage(constraints.unsupported), blocks: [] };
    }
    const resolved = await resolveNutritionTarget(identity);
    if (!resolved.ok) return { answer: resolved.message, blocks: [] };
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile as any;
    const mealsPerDay = (resumeKnownSlots?.mealsPerDay as number | undefined) ?? 3;
    const built = buildNutritionGenerationParams(profile.goal ?? "MAINTENANCE", mealsPerDay, constraints, resolved.target, {
      weightKg: profile.currentWeightKg, heightCm: profile.heightCm, age: profile.age, gender: profile.gender,
      bodyFatPct: profile.inBody?.bodyFatPct, activityLevel: profile.activityLevel,
      trainingDaysPerWeek: profile.training?.trainingDaysPerWeek, experienceLevel: profile.experienceLevel,
    });
    if (!built.ok) {
      return { answer: "Mục tiêu dinh dưỡng của bạn nằm ngoài giới hạn mà bộ tạo thực đơn hỗ trợ nên mình chưa tạo tự động — bạn nhờ huấn luyện viên/chuyên gia xem giúp nhé.", blocks: [] };
    }
    const queued = await conversationService.queueNutritionPlanGeneration({ userId: identity.userId, ...built.params });
    const payload: NutritionDraftPayload = {
      planId: queued.planId, jobId: queued.jobId, phase: "GENERATING", mealsPerDay, goal: profile.goal ?? null,
      constraints, target: resolved.target, lastTouchedAt: new Date().toISOString(),
    };
    await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CREATE_NUTRITION_PLAN", risk: agentActionRisk("CREATE_NUTRITION_PLAN"),
        payload: payload as any,
        // Longer TTL than the 15-minute default elsewhere in this file —
        // generation can itself take ~1-2 minutes, on top of however long
        // the user takes to send their next message.
        expiresAt: new Date(Date.now() + 20 * 60000),
      },
    });
    const excluded = constraints.exclusions.length ? ` Đã loại trừ: ${constraints.exclusions.map((e) => e.label).join(", ")}.` : "";
    return {
      answer: `Mình đang tính thực đơn theo mục tiêu dinh dưỡng của bạn (${resolved.target.calories} kcal, P${resolved.target.protein}g).${excluded} Việc này có thể mất khoảng 1-2 phút — bạn nhắn lại (ví dụ "xong chưa") để mình kiểm tra nhé.`,
      blocks: [],
    };
  },
  /** CREATE_NUTRITION_PLAN's multi-turn async lifecycle. Called by
   * routePendingDraftTurn (which decides WHICH pending draft owns a turn —
   * remediation M4) with the chosen action:
   *   a recognized revision (mealsPerDay +/-1 or extracted constraints), in
   *     GENERATING or PREVIEW -> merge constraints (never replace), re-resolve
   *     the authoritative target, re-queue a FRESH full generation;
   *   GENERATING + a poll-shaped message -> poll the real Plan row:
   *     COMPLETED -> exclusion re-check, PREVIEW; FAILED -> cancel + report;
   *   anything else -> null so the turn falls through normally. */
  async tryPollOrReviseNutritionPlanDraft(question: string, identity: AgentIdentity, sessionId: string, given?: { id: string; risk: string; expiresAt: Date; payload: unknown }): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const trimmed = question.trim();
    if (!trimmed) return null;
    const action = given ?? await prisma.fitnessAgentAction.findFirst({
      where: { userId: identity.userId, sessionId, kind: "CREATE_NUTRITION_PLAN", status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!action) return null;
    const payload = action.payload as NutritionDraftPayload;
    if (payload.phase === "FAILED") return null;
    const s = normalizeAgentText(trimmed);

    let mealsPerDay = payload.mealsPerDay;
    const mealsCue = /\b(it bua hon|giam bua|bua it hon)\b/.test(s) ? -1 : /\b(nhieu bua hon|tang bua)\b/.test(s) ? 1 : 0;
    if (mealsCue !== 0) mealsPerDay = Math.max(2, Math.min(6, mealsPerDay + mealsCue));
    const newConstraints = extractNutritionConstraints(trimmed);
    const isRevision = mealsCue !== 0 || !constraintSetIsEmpty(newConstraints);

    if (!isRevision) {
      // Poll only when the message is poll-shaped — a GENERATING action must
      // never swallow an unrelated turn (M4 failure A).
      const isPollCue = /\b(xong|chua|san sang|the nao|ket qua|dau roi|kiem tra|thuc don|ke hoach)\b/.test(s);
      if (payload.phase !== "GENERATING" || !isPollCue) return null;
      const plan = await conversationRepository.findNutritionPlanById(payload.planId);
      if (!plan) return { answer: "Mình không tìm thấy kế hoạch dinh dưỡng vừa tạo — bạn thử nhờ mình tạo lại nhé.", blocks: [] };
      if (plan.status === PlanStatus.FAILED) {
        await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { payload: { ...payload, phase: "FAILED" } as any, status: "CANCELLED" } });
        return { answer: `Mình chưa tạo được thực đơn lúc này${plan.failReason ? ` (${plan.failReason})` : ""}. Bạn có thể nhờ mình tạo lại.`, blocks: [] };
      }
      if (plan.status !== PlanStatus.COMPLETED) {
        return { answer: "Thực đơn vẫn đang được tính toán — bạn đợi thêm khoảng 1 phút rồi nhắn lại nhé.", blocks: [] };
      }
      const content = plan.plan as any;
      // Defense in depth: the processor already filters/validates, but a plan
      // that violates a declared exclusion must never be previewed.
      const violations = findExclusionViolations(content, payload.constraints.exclusions.map((e) => e.key));
      if (violations.length > 0) {
        await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { payload: { ...payload, phase: "FAILED" } as any, status: "CANCELLED" } });
        return { answer: `Thực đơn vừa tính vi phạm thực phẩm bạn đã loại trừ (${violations.slice(0, 3).join(", ")}) nên mình không hiển thị. Bạn nhờ mình tạo lại nhé.`, blocks: [] };
      }
      const expiresAt = new Date(Date.now() + 20 * 60000);
      await prisma.fitnessAgentAction.update({
        where: { id: action.id },
        data: { payload: { ...payload, phase: "PREVIEW", content, contentHash: hashNutritionContent(content), lastTouchedAt: new Date().toISOString() } as any, expiresAt },
      });
      return {
        answer: `Thực đơn đã sẵn sàng (~${content.dailyCaloriesTarget} kcal/ngày, ${content.mealsPerDay} bữa). Bạn có thể yêu cầu chỉnh sửa hoặc xác nhận để lưu.`,
        blocks: [buildNutritionPlanPreviewBlock(action.id, action.risk, expiresAt, content, payload)],
      };
    }

    // Revision. A restriction we cannot ENFORCE is refused, never silently
    // downgraded to a prompt hint (remediation M2).
    const keepPreview = payload.phase === "PREVIEW" && payload.content
      ? [buildNutritionPlanPreviewBlock(action.id, action.risk, action.expiresAt, payload.content, payload)] : [];
    if (newConstraints.unsupported.length > 0) {
      return { answer: unsupportedRestrictionMessage(newConstraints.unsupported), blocks: keepPreview };
    }
    const health = await llmService.getHealthStatus();
    if (!health.llmAvailable) {
      return { answer: "AI dinh dưỡng hiện chưa sẵn sàng để tính lại thực đơn — bạn thử lại sau ít phút nhé.", blocks: keepPreview };
    }
    const resolved = await resolveNutritionTarget(identity);
    if (!resolved.ok) return { answer: resolved.message, blocks: keepPreview };
    const constraints = mergeNutritionConstraints(payload.constraints ?? EMPTY_CONSTRAINTS, newConstraints);
    const built = buildNutritionGenerationParams(payload.goal ?? "MAINTENANCE", mealsPerDay, constraints, resolved.target);
    if (!built.ok) return { answer: "Mục tiêu dinh dưỡng của bạn nằm ngoài giới hạn mà bộ tạo thực đơn hỗ trợ nên mình chưa tính lại tự động.", blocks: keepPreview };
    const queued = await conversationService.queueNutritionPlanGeneration({ userId: identity.userId, ...built.params });
    const expiresAt = new Date(Date.now() + 20 * 60000);
    const next: NutritionDraftPayload = {
      planId: queued.planId, jobId: queued.jobId, phase: "GENERATING", mealsPerDay, goal: payload.goal,
      constraints, target: resolved.target, lastTouchedAt: new Date().toISOString(),
    };
    await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { payload: next as any, expiresAt } });
    const excluded = constraints.exclusions.length ? ` Đang loại trừ: ${constraints.exclusions.map((e) => e.label).join(", ")}.` : "";
    return {
      answer: `Mình đang tính lại TOÀN BỘ thực đơn theo yêu cầu của bạn.${excluded} Có thể mất khoảng 1-2 phút — bạn nhắn lại (ví dụ "xong chưa") để mình kiểm tra nhé.`,
      blocks: [],
    };
  },
  /** M4 — which pending DRAFT (roadmap bundle / workout / nutrition) owns this
   * turn. Pending FitnessAgentActions are not slot workflows (the signed-off
   * AgentWorkflowSession invariant is untouched); this is selection among
   * already-created drafts:
   *   1. explicit domain cues in the message pick that domain's newest draft;
   *      cues for >1 domain that both have a draft -> ask, never guess;
   *   2. no cue: only the most recently touched draft is eligible, and only
   *      if no OTHER task (PT/program search, another action) happened since
   *      — so a stale draft can't swallow a later unrelated turn;
   *   3. a bare "đổi lại"-style message with >1 domain drafts -> ask. */
  async routePendingDraftTurn(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const drafts = await prisma.fitnessAgentAction.findMany({
      where: { userId: identity.userId, sessionId, kind: { in: [...DRAFT_KINDS] }, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!drafts.length) return null;
    const touched = (a: { createdAt: Date; payload: unknown }) => Math.max(a.createdAt.getTime(), Date.parse((a.payload as any)?.lastTouchedAt ?? "") || 0);
    drafts.sort((a, b) => touched(b) - touched(a));
    const domainOf = (a: { kind: string }): DraftDomain => DRAFT_DOMAIN_OF_KIND[a.kind];
    const dispatch = (a: (typeof drafts)[number]) =>
      domainOf(a) === "WORKOUT" ? this.tryReviseWorkoutPlanDraft(question, identity, sessionId, a)
        : domainOf(a) === "NUTRITION" ? this.tryPollOrReviseNutritionPlanDraft(question, identity, sessionId, a)
          : this.tryReviseRoadmapDraft(question, identity, sessionId, a);
    const askWhich = (domains: DraftDomain[]) => ({
      answer: `Bạn đang có nhiều bản nháp cùng lúc (${domains.map((d) => DRAFT_DOMAIN_LABEL_VI[d]).join(" và ")}). Bạn muốn chỉnh cái nào? Hãy nói rõ (ví dụ "chỉnh thực đơn"/"chỉnh lịch tập") giúp mình nhé.`,
      blocks: [] as AgentBlock[],
    });
    const pendingDomains = [...new Set(drafts.map(domainOf))];

    const cueDomains = classifyDraftDomains(question).filter((d) => pendingDomains.includes(d));
    if (cueDomains.length > 1) return askWhich(cueDomains);
    if (cueDomains.length === 1) {
      const target = drafts.find((a) => domainOf(a) === cueDomains[0]);
      return target ? dispatch(target) : null;
    }
    // No explicit domain cue.
    const current = drafts[0];
    const [latestRecommendation, latestOtherAction] = await Promise.all([
      prisma.fitnessRecommendation.findFirst({ where: { userId: identity.userId, sessionId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.fitnessAgentAction.findFirst({ where: { userId: identity.userId, sessionId, kind: { notIn: [...DRAFT_KINDS] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const displacedAt = Math.max(latestRecommendation?.createdAt.getTime() ?? 0, latestOtherAction?.createdAt.getTime() ?? 0);
    if (displacedAt > touched(current)) return null;
    if (pendingDomains.length > 1 && AMBIGUOUS_REVISION_RE.test(normalizeAgentText(question))) return askWhich(pendingDomains);
    return dispatch(current);
  },
  /** L1 — "Bỏ qua" on a workout/nutrition preview really cancels the draft
   * (so the UI label is truthful and the draft stops receiving later turns). */
  /** Merges nutrition constraints found in ANY turn of an active, still-
   * collecting CREATE_NUTRITION_PLAN workflow into its stored
   * NutritionConstraintSet (typed merge: dedupe by canonical key, never
   * replace). Does not answer the pending slot — the generic orchestrator does
   * that right after. Returns a result ONLY when the message adds a hard
   * exclusion that cannot be enforced: that is refused immediately and the
   * workflow is cancelled (consistent with the initiating-message policy —
   * nothing is queued and nothing is silently dropped), so the user restates
   * the request without the unsupported clause. */
  async accumulateNutritionWorkflowConstraints(question: string, identity: AgentIdentity, sessionId: string, intentKind: string | null): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    if (intentKind !== null && intentKind !== "CREATE_NUTRITION_PLAN") return null;
    const active = await workflowStateRepository.findActive(identity.userId, sessionId);
    if (!active || active.workflowType !== "CREATE_NUTRITION_PLAN" || active.status !== "COLLECTING_SLOTS") return null;
    const found = extractNutritionConstraints(question);
    if (constraintSetIsEmpty(found)) return null;
    const slots = ((active.slotsJson as Record<string, unknown>) ?? {});
    if (found.unsupported.length > 0) {
      await workflowStateRepository.cancel(active.id);
      return { answer: `${unsupportedRestrictionMessage(found.unsupported)} Mình đã dừng yêu cầu tạo thực đơn này — bạn gửi lại yêu cầu (kèm các thực phẩm loại trừ hỗ trợ được) để mình tạo nhé.`, blocks: [] };
    }
    const merged = mergeNutritionConstraints(slots.nutritionConstraints as NutritionConstraintSet | undefined, found);
    await workflowStateRepository.update(active.id, { slotsJson: { ...slots, nutritionConstraints: merged }, extendExpiry: true });
    return null;
  },
  async dismissDraft(identity: AgentIdentity, actionId: string): Promise<AgentBlock> {
    const action = await prisma.fitnessAgentAction.findFirst({ where: { id: actionId, userId: identity.userId } });
    if (!action) throw fail("Action not found", 404);
    await ownSession(identity, action.sessionId);
    if (action.kind !== "CREATE_WORKOUT_PLAN" && action.kind !== "CREATE_NUTRITION_PLAN") throw fail("Action cannot be dismissed", 400);
    // ONE atomic conditional UPDATE competes with confirm's PENDING -> EXECUTING
    // claim. The response is derived from the state that actually won, never
    // from what was requested: dismiss must not say "nothing was saved" when
    // confirmation already owns (or finished) the write.
    const won = (await prisma.fitnessAgentAction.updateMany({
      where: { id: action.id, userId: identity.userId, status: "PENDING" },
      data: { status: "CANCELLED" },
    })).count === 1;
    if (won) return { type: "ACTION_RESULT", message: "Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống." };
    const latest = await prisma.fitnessAgentAction.findFirst({ where: { id: action.id, userId: identity.userId }, select: { status: true } });
    if (latest?.status === "COMPLETED") return { type: "ACTION_RESULT", message: "Bản này đã được lưu vào hệ thống trước đó nên không thể bỏ qua." };
    if (latest?.status === "EXECUTING") return { type: "ACTION_RESULT", message: "Bản này đang được lưu nên không thể bỏ qua lúc này." };
    return { type: "ACTION_RESULT", message: "Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống." }; // already CANCELLED: idempotent
  },
  // Roadmap management via chat, for an EXISTING roadmap. Read-only status
  // check answers directly (no confirm needed, same as the workout-schedule
  // lookup elsewhere); advance/rebuild/archive all go through the same
  // propose -> ACTION_CONFIRMATION -> execute() flow as every other real
  // write in this file.
  async answerRoadmapStatus(identity: AgentIdentity): Promise<{ answer: string; blocks: AgentBlock[] }> {
    // Response shape confirmed live: { roadmap, phases, activePhase,
    // activeCycle, ... } — phases/activePhase/activeCycle are siblings of
    // roadmap, not nested inside it.
    let data: any;
    try {
      data = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
    } catch (err: any) {
      if (err?.status === 404) {
        return { answer: "Bạn chưa có lộ trình nào đang hoạt động. Hãy nhờ mình lên lộ trình mới nếu bạn muốn.", blocks: [] };
      }
      return { answer: "Mình chưa lấy được thông tin lộ trình của bạn lúc này. Vui lòng thử lại sau.", blocks: [] };
    }
    const phases = Array.isArray(data.phases) ? data.phases : [];
    const activePhase = data.activePhase ?? null;
    const activeIndex = activePhase ? phases.findIndex((p: any) => p.id === activePhase.id) : -1;
    const lines = [
      `Lộ trình hiện tại của bạn: mục tiêu ${data.roadmap?.goalType ?? "chưa rõ"}, đang ở giai đoạn ${activeIndex >= 0 ? activeIndex + 1 : "?"}/${phases.length}${activePhase?.name ? ` (${activePhase.name})` : ""}.`,
    ];
    if (activePhase) {
      lines.push(data.activeCycle
        ? "Bạn đang có 1 chu kỳ tập đang chạy trong giai đoạn này."
        : "Giai đoạn này chưa có chu kỳ tập nào đang chạy.");
    }
    return { answer: lines.join(" "), blocks: [] };
  },
  async proposeRoadmapAdvance(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let data: any;
    try {
      data = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
    } catch {
      return { answer: "Bạn chưa có lộ trình nào đang hoạt động để chuyển giai đoạn.", blocks: [] };
    }
    const roadmap = data.roadmap;
    const phases = Array.isArray(data.phases) ? data.phases : [];
    const activePhase = data.activePhase ?? null;
    const activeIndex = activePhase ? phases.findIndex((p: any) => p.id === activePhase.id) : -1;
    const nextPhase = activeIndex >= 0 ? phases[activeIndex + 1] : null;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_ADVANCE", risk: agentActionRisk("ROADMAP_ADVANCE"),
        // activePhaseId captured now so execute() can verify a transition
        // actually happened — confirmed live: fitness-roadmap.service.ts's
        // advanceRoadmap silently no-ops (200 OK, nothing changed) when the
        // current phase still has an ACTIVE cycle, with no field in its
        // response distinguishing that from a real transition.
        payload: { roadmapId: roadmap.id, activePhaseIdBefore: activePhase?.id ?? null },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Bạn đang ở giai đoạn ${activeIndex >= 0 ? activeIndex + 1 : "?"}/${phases.length}${activePhase?.name ? ` (${activePhase.name})` : ""}. Xác nhận sẽ chuyển sang giai đoạn tiếp theo${nextPhase?.name ? ` (${nextPhase.name})` : ""} nếu đủ điều kiện.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_ADVANCE", risk: action.risk,
        title: "Chuyển sang giai đoạn tiếp theo",
        summary: { currentPhase: activePhase?.name ?? null, nextPhase: nextPhase?.name ?? null },
        expiresAt: action.expiresAt.toISOString(),
        note: "Nếu chưa có chu kỳ tập nào hoàn thành và được đánh giá trong giai đoạn hiện tại, thao tác này sẽ báo lỗi và không thay đổi gì.",
      }],
    };
  },
  async proposeRoadmapRebuild(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let roadmap: any;
    try {
      roadmap = (await fitnessAgentDeps.tools.getCurrentRoadmap(identity)).roadmap;
    } catch {
      return { answer: "Bạn chưa có lộ trình nào đang hoạt động để xây lại.", blocks: [] };
    }
    let proposal: any;
    try {
      proposal = await fitnessAgentDeps.tools.previewRoadmapRebuild(identity, roadmap.id as string);
    } catch (err: any) {
      return { answer: `Mình chưa xây lại được lộ trình lúc này — ${err?.message ?? "cần có một chu kỳ tập vừa được đánh giá (ADJUST/DELOAD/REBUILD) trước khi xây lại"}.`, blocks: [] };
    }
    const proposedPhases = Array.isArray(proposal.proposedPhases) ? proposal.proposedPhases : [];
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_REBUILD", risk: agentActionRisk("ROADMAP_REBUILD"),
        payload: { roadmapId: roadmap.id, assessmentId: proposal.assessmentId },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Mình đề xuất xây lại ${proposedPhases.length} giai đoạn còn lại của lộ trình dựa trên đánh giá chu kỳ gần nhất. Xác nhận bên dưới nếu bạn muốn áp dụng thật — các giai đoạn chưa bắt đầu hiện tại sẽ được thay thế.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_REBUILD", risk: action.risk,
        title: "Xây lại lộ trình",
        summary: { phaseCount: proposedPhases.length, phases: proposedPhases.map((p: any) => p.name).filter(Boolean) },
        expiresAt: action.expiresAt.toISOString(),
        note: "Xác nhận sẽ hoàn thành giai đoạn hiện tại, bỏ các giai đoạn cũ chưa bắt đầu, và tạo + kích hoạt các giai đoạn mới này.",
      }],
    };
  },
  async proposeRoadmapArchive(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let roadmap: any;
    let isDraft = false;
    try {
      roadmap = (await fitnessAgentDeps.tools.getCurrentRoadmap(identity)).roadmap;
    } catch {
      try {
        roadmap = (await fitnessAgentDeps.tools.getCurrentDraftRoadmap(identity)).roadmap;
        isDraft = true;
      } catch {
        return { answer: "Bạn chưa có lộ trình nào (đang hoạt động hoặc bản nháp) để lưu trữ.", blocks: [] };
      }
    }
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_ARCHIVE", risk: agentActionRisk("ROADMAP_ARCHIVE"),
        payload: { roadmapId: roadmap.id },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Xác nhận sẽ lưu trữ (archive) ${isDraft ? "bản nháp" : "lộ trình đang hoạt động"} mục tiêu ${roadmap.goalType ?? ""} hiện tại của bạn. Sau đó bạn có thể tạo lộ trình mới.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_ARCHIVE", risk: action.risk,
        title: "Lưu trữ lộ trình hiện tại",
        summary: { goalType: roadmap.goalType ?? null, isDraft },
        expiresAt: action.expiresAt.toISOString(),
        note: isDraft ? undefined : "Không thể lưu trữ khi đang có giai đoạn ACTIVE — hãy hoàn thành hoặc chuyển giai đoạn trước nếu cần.",
      }],
    };
  },
  // Training-cycle management via chat, for the currently ACTIVE cycle.
  // EVALUATE (a separate, pre-existing intent) already handles read-only
  // "how is my cycle going" status/progress questions — these two only
  // fire on an explicit close/cancel verb (see fitness-agent-intent.ts).
  async proposeCycleComplete(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: any;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch (err: any) {
      if (err?.status === 404) return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động.", blocks: [] };
      return { answer: "Mình chưa lấy được thông tin chu kỳ tập của bạn lúc này. Vui lòng thử lại sau.", blocks: [] };
    }
    const cycle = active.cycle;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CYCLE_COMPLETE", risk: agentActionRisk("CYCLE_COMPLETE"),
        payload: { cycleId: cycle.id },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Xác nhận sẽ hoàn thành chu kỳ tập "${cycle.name ?? ""}" hiện tại của bạn. Sau khi hoàn thành, mình sẽ tự đánh giá kết quả dựa trên dữ liệu tập luyện thật.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "CYCLE_COMPLETE", risk: action.risk,
        title: "Hoàn thành chu kỳ tập hiện tại",
        summary: { cycleName: cycle.name ?? null, goal: cycle.goal ?? null },
        expiresAt: action.expiresAt.toISOString(),
        note: "Chu kỳ sẽ đóng lại và được đánh giá tự động — nếu chưa đủ buổi tập được ghi nhận, đánh giá sẽ báo \"chưa đủ dữ liệu\" thay vì một kết luận sai.",
      }],
    };
  },
  async proposeCycleCancel(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: any;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch {
      return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động để hủy.", blocks: [] };
    }
    const cycle = active.cycle;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CYCLE_CANCEL", risk: agentActionRisk("CYCLE_CANCEL"),
        payload: { cycleId: cycle.id },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Xác nhận sẽ hủy chu kỳ tập "${cycle.name ?? ""}" hiện tại — chu kỳ này sẽ không được tính vào lịch sử đánh giá.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "CYCLE_CANCEL", risk: action.risk,
        title: "Hủy chu kỳ tập hiện tại",
        summary: { cycleName: cycle.name ?? null },
        expiresAt: action.expiresAt.toISOString(),
        note: "Chu kỳ sẽ bị hủy, không thể hoàn tác.",
      }],
    };
  },
  // Today's scheduled workout session — start/skip/cancel via chat.
  // Deliberately scoped to session-level ops only (see the shared
  // AgentActionKindSchema comment): per-exercise/per-set completion during
  // an active session needs real-time state, not a one-shot chat confirm.
  // One shared propose method since START/SKIP/CANCEL only differ in verb
  // and which tool call executes on confirm.
  async proposeWorkoutSession(identity: AgentIdentity, sessionId: string, kind: "WORKOUT_START" | "WORKOUT_SKIP" | "WORKOUT_CANCEL"): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const LABEL: Record<typeof kind, { title: string; verb: string; note: string }> = {
      WORKOUT_START: { title: "Bắt đầu buổi tập hôm nay", verb: "bắt đầu", note: "Buổi tập sẽ chuyển sang trạng thái đang tập." },
      WORKOUT_SKIP: { title: "Bỏ qua buổi tập hôm nay", verb: "bỏ qua", note: "Buổi tập hôm nay sẽ được đánh dấu là đã bỏ qua." },
      WORKOUT_CANCEL: { title: "Hủy buổi tập hôm nay", verb: "hủy", note: "Buổi tập hôm nay sẽ bị hủy." },
    };
    const schedules = await fitnessAgentDeps.tools.getTodaySchedule(identity);
    const schedule = (schedules as any[])[0];
    if (!schedule) {
      return { answer: "Bạn chưa có buổi tập nào được lên lịch cho hôm nay.", blocks: [] };
    }
    const dayTitle = schedule.programDay?.title ?? schedule.programDay?.program?.name ?? null;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind, risk: agentActionRisk(kind),
        payload: { scheduleId: schedule.id },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Xác nhận sẽ ${LABEL[kind].verb} buổi tập hôm nay${dayTitle ? ` ("${dayTitle}")` : ""}.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind, risk: action.risk,
        title: LABEL[kind].title,
        summary: { dayTitle: dayTitle ?? null, status: schedule.status ?? null },
        expiresAt: action.expiresAt.toISOString(),
        note: LABEL[kind].note,
      }],
    };
  },
};
