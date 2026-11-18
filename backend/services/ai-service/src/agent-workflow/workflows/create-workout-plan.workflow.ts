import type { SlotDefinition, WorkflowContext, WorkflowDefinition } from "../types";
import { parseSessionsPerWeek, parseMinutes } from "../slot-values";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import { classifySpeechAct } from "../../llm/speech_act";

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
    // V1 RC1 (H-05/H-06): also "lịch (tập) 4 buổi", "lịch 3 ngày", "tập bốn buổi", "(đổi lịch) lên 4 buổi" — the unit word must
    // still sit next to the number and be tied to the schedule ("lịch"/"tập"/"…/tuần"), so "4 hiệp", "45 phút", "16 tuổi",
    // "nghỉ 2 ngày", "8 bài" never count. A HYPOTHETICAL sentence ("Nếu tập 6 buổi thì có ổn không?") is not the user's choice;
    // a polite condition ("nếu được thì 4 buổi") is.
    const asserted = message
      .split(/(?<=[.!?\n])\s+/u)
      .filter((sent) => classifySpeechAct(sent.replace(/(?<!\p{L})(?:nếu|neu)\s+(?:được|duoc|có thể|co the|tiện|tien)(?!\p{L})\s*,?\s*(?:thì|thi)?/giu, " ")) !== "HYPOTHETICAL")
      .map((sent) => normalizeAgentText(sent))
      .join(" ");
    const N = String.raw`(\d|mot|hai|ba|bon|nam|sau|bay)`;
    const WORD: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7 };
    const days = new RegExp(String.raw`\b${N}\s*(?:buoi|ngay)\s*(?:\/|moi|mot|trong|1)?\s*tuan\b`).exec(asserted)
      ?? new RegExp(String.raw`\blich(?:\s+tap)?\s+${N}\s*(?:buoi|ngay)\b`).exec(asserted)
      ?? new RegExp(String.raw`\btap\s+${N}\s*buoi\b`).exec(asserted)
      ?? new RegExp(String.raw`\blich\b.{0,40}?\b${N}\s*buoi\b(?!\s*nghi)`).exec(asserted);
    if (days) {
      const n = /\d/.test(days[1]) ? days[1] : String(WORD[days[1]]);
      const r = parseSessionsPerWeek(n); if (r.ok) out.daysPerWeek = r.value;
    }
    const mins = s.match(/(?<![\d.,])(\d{2,3})\s*(?:phut|min|p)\b|(?<![\d.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:gio|tieng)\b/);
    if (mins) { const r = parseMinutes(mins[0]); if (r.ok) out.sessionMinutes = r.value; }
    return out;
  },
};
