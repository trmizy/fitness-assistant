import type { SlotDefinition, WorkflowContext, WorkflowDefinition } from "../types";
import { parseSessionsPerWeek, parseMinutes } from "../slot-values";
import { normalizeAgentText } from "../../services/fitness-agent-intent";

/**
 * CREATE_WORKOUT_PLAN — a standalone "tạo lịch tập cho tôi" workflow,
 * distinct from both:
 *   - FIND_TRAINING_PROGRAM (finds an existing eligible
 *     WorkoutProgramTemplate via deterministic ranking v2 — no generation
 *     at all, untouched by this workflow);
 *   - SAVE_GENERATED_PLAN (persists whatever the PRIOR chat turn's
 *     deterministic recommendation_engine.ts answer happened to be, via a
 *     Conversation.routeIntent lookback — fragile/implicit, and has no
 *     structured preview or revision loop of its own).
 *
 * This workflow generates a FRESH draft on demand (reusing the exact same
 * deterministic recommendation_engine.ts + searchExerciseByName mechanism
 * SAVE_GENERATED_PLAN already trusts — see
 * docs/standalone-workout-workflow-audit.md), shows it as a real
 * structured WORKOUT_PLAN_PREVIEW, and supports a genuine revision loop
 * BEFORE any FitnessAgentAction/confirmation exists at all. See
 * fitness-agent.service.ts::proposeWorkoutPlan/tryReviseWorkoutPlanDraft
 * for the generation/revision logic — this file only declares what's
 * required to get there.
 *
 * Slots are deliberately minimal: goal/experienceLevel/availableEquipment/
 * injuries/safetyScreeningStatus all come straight from EnterpriseContext
 * (via profileExtractor, exactly like SAVE_GENERATED_PLAN already does) —
 * "use authoritative context wherever already known", not re-collected as
 * a slot. Only `daysPerWeek` and `sessionMinutes` are asked, and only when
 * genuinely unknown.
 */

function profileArray(ctx: WorkflowContext, key: string): number[] | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return Array.isArray(v) && v.length > 0 ? (v as number[]) : undefined;
}
function profileNumber(ctx: WorkflowContext, key: string): number | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

const daysPerWeekSlot: SlotDefinition<number> = {
  key: "daysPerWeek", label: "số buổi tập mỗi tuần", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  // Real EnterpriseContext field is `days` (an array of specific weekday
  // indices, per fitness-agent-tools.ts's contextSchema) — its LENGTH is
  // the day-COUNT the deterministic generator actually consumes
  // (recommendation_engine.ts::buildWorkoutPlanTemplate reads
  // `profile.training.trainingDaysPerWeek`, a count, not specific days).
  // Never re-asks when the user already has a real training-days
  // preference on file.
  readFromContext: (ctx) => profileArray(ctx, "days")?.length,
  parse: parseSessionsPerWeek,
  question: () => "Bạn muốn tập mấy buổi mỗi tuần?",
  format: (v) => `${v} buổi/tuần`,
};
const sessionMinutesSlot: SlotDefinition<number> = {
  key: "sessionMinutes", label: "thời lượng mỗi buổi", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  readFromContext: (ctx) => profileNumber(ctx, "sessionMinutes"),
  parse: parseMinutes,
  question: () => "Mỗi buổi bạn có khoảng bao nhiêu phút?",
  format: (v) => `${v} phút`,
};

export const createWorkoutPlanSlots: SlotDefinition<any>[] = [daysPerWeekSlot, sessionMinutesSlot];

export const createWorkoutPlanWorkflow: WorkflowDefinition = {
  type: "CREATE_WORKOUT_PLAN",
  gatesIntentKind: "CREATE_WORKOUT_PLAN",
  slots: createWorkoutPlanSlots,
  // What the OPENING message already says must not be asked again ("Tạo lịch tập 3 buổi mỗi tuần, mỗi buổi 45 phút"). Deliberately strict
  // (a unit word must sit next to the number) so an unrelated number elsewhere (age, weight, "8 bài cho thứ 7") is never read as a slot.
  extractFromMessage: (message: string) => {
    const out: Record<string, unknown> = {};
    const s = normalizeAgentText(message);
    const days = s.match(/(\d)\s*(?:buoi|ngay)\s*(?:\/|moi|mot|trong|1)?\s*tuan\b/);
    if (days) { const r = parseSessionsPerWeek(days[1]); if (r.ok) out.daysPerWeek = r.value; }
    const mins = s.match(/(?<![\d.,])(\d{2,3})\s*(?:phut|min)\b|(?<![\d.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:gio|tieng)\b/);
    if (mins) { const r = parseMinutes(mins[0]); if (r.ok) out.sessionMinutes = r.value; }
    return out;
  },
};
