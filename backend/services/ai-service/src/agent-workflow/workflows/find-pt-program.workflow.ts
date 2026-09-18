import type { SlotDefinition, WorkflowContext, WorkflowDefinition } from "../types";
import { parseBudgetVnd, parseGoal, parseMinutes, parseTrainingDays } from "../slot-values";
import { normalizeAgentText } from "../../services/fitness-agent-intent";

/**
 * FIND_PT / FIND_TRAINING_PROGRAM — realized as the existing "PT"/"PROGRAM"
 * intents (fitness-agent.service.ts::tryTurn's shared PT/PROGRAM branch).
 * Required slots mirror that branch's own existing check exactly:
 * `!preferences.goal || !preferences.days?.length || (kind==="PT" &&
 * !preferences.budgetVnd)` — this is not a new requirement, just a real
 * multi-turn resolution of an existing one-shot dead-end message ("Để tìm
 * lựa chọn phù hợp, hãy cho biết mục tiêu, các ngày bạn tập được...").
 *
 * `days`/`sessionMinutes`/`budgetVnd` all stay WORKFLOW_ONLY (this pass's own
 * scoped decision — see roadmap.workflow.ts's comment on the same day-
 * numbering-convention risk for `preferredTrainingDays`, and
 * `sessionDurationMinutes`/`ptBudgetVnd` simply have no route in
 * user-service's real profileSchema that exposes them as user-writable via
 * PUT /profile/me — docs/conversational-ai-coach-workflow-audit.md §5).
 * WORKFLOW_ONLY does not mean "never read from context" though — a real
 * bug caught by this module's own existing regression suite
 * (fitness-agent-goal-intent-loop.test.ts): `budgetVnd` DOES have a real
 * UserProfile-backed field (`ptBudgetVnd`) and IS returned by
 * `/profile/agent/context` as `budgetVnd` — a `readFromContext` that always
 * returns `undefined` regardless made the workflow re-ask for budget even
 * when the user already had one on file, and broke the existing
 * single-turn "tìm pt cho tôi" test (which expects one immediate real
 * recommendation whenever preferences are already fully known). Every
 * WORKFLOW_ONLY slot here still reads its real, already-known value from
 * EnterpriseContext exactly like a PROFILE_FACT slot would — WORKFLOW_ONLY
 * only governs whether a NEWLY-typed value gets written back, never
 * whether an already-known one is honored.
 */

function profileArray(ctx: WorkflowContext, key: string): number[] | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return Array.isArray(v) && v.length > 0 ? (v as number[]) : undefined;
}
function profileString(ctx: WorkflowContext, key: string): string | undefined {
  const v = (ctx.enterpriseContext.profile as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

const DAY_LABEL: Record<number, string> = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };

const goalSlot: SlotDefinition<string> = {
  key: "goal", label: "mục tiêu tập luyện", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  readFromContext: (ctx) => profileString(ctx, "goal"),
  parse: parseGoal,
  question: () => "Mục tiêu tập luyện của bạn là gì (giảm mỡ/tăng cơ/duy trì/hiệu suất)?",
  format: (v) => v,
};
const daysSlot: SlotDefinition<number[]> = {
  key: "days", label: "các ngày tập được", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  readFromContext: (ctx) => profileArray(ctx, "days"),
  parse: parseTrainingDays,
  question: () => "Bạn tập được những ngày nào trong tuần (ví dụ T2-T4-T6)?",
  format: (v) => v.map((d) => DAY_LABEL[d] ?? String(d)).join(", "),
};
const sessionMinutesSlot: SlotDefinition<number> = {
  key: "sessionMinutes", label: "thời lượng mỗi buổi", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: false,
  readFromContext: (ctx) => {
    const v = (ctx.enterpriseContext.profile as Record<string, unknown>).sessionMinutes;
    return typeof v === "number" ? v : undefined;
  },
  parse: parseMinutes, question: () => "Mỗi buổi bạn có khoảng bao nhiêu phút?", format: (v) => `${v} phút`,
};
// Codex Evaluation #1 §16/§40 — "Ngân sách không quan trọng"/"Không giới
// hạn" was rejected as an unparseable number and re-asked identically,
// which can feel like a trap. The follow-up task explicitly requires a
// typed no-cap representation rather than the earlier decision to reject
// with an explanation (that decision predates this requirement — see
// docs/conversational-ai-coach-remediation-2.md §7).
//
// `NO_BUDGET_CAP` is a distinct string sentinel, never `0` (which
// `!preferences.budgetVnd` would treat as "missing" and re-trigger the
// exact re-ask this fixes) and never `Number.MAX_VALUE` (which would be
// fake money silently smuggled into a numeric budget field downstream).
// `resolveBudgetPreference()` (called from fitness-agent.service.ts, the
// single place workflow-local slots become real `AgentPreferences`) is the
// ONLY place this sentinel is ever interpreted — everywhere else
// (findPTCandidates/scorePT) it must never appear at all: it becomes real
// `undefined`, which agentic-fitness.service.ts's candidate search and
// fitness-agent-scoring.ts's `scorePT` ALREADY treat as "no budget
// constraint" today (`preferences.budgetVnd ? ... : 0` uniformly zeroes the
// budget scoring term for every candidate, which does not change relative
// ranking — see backend/shared/src/fitness-agent-scoring.ts:75). The one
// piece of that existing behavior this DOES change is
// fitness-agent.service.ts's own pre-search gate, which — before this fix —
// hard-required a truthy `budgetVnd` for "PT" and would have rejected a
// `NO_CAP` turn as "still missing"; `resolveBudgetPreference()` in that file
// treats `NO_CAP` as satisfying the requirement. No PT search/scoring
// business rule is reopened by this change.
export const NO_BUDGET_CAP = "NO_CAP" as const;
export type BudgetPreference = number | typeof NO_BUDGET_CAP;
const NO_CAP_PHRASE_RE = /(khong quan trong|khong gioi han|khong can|tuy y|bao nhieu cung duoc|khong co gioi han|uu tien phu hop hon gia)/;

/** Translates a resolved FIND_PT budget slot value (number | "NO_CAP") into
 * the real `AgentPreferences.budgetVnd` shape (number | undefined) — the
 * one and only boundary where the sentinel is allowed to exist and is
 * removed. Never returns 0 or Number.MAX_VALUE for "NO_CAP". */
export function resolveBudgetPreference(value: BudgetPreference | undefined): number | undefined {
  return value === NO_BUDGET_CAP || value === undefined ? undefined : value;
}

const budgetSlot: SlotDefinition<BudgetPreference> = {
  key: "budgetVnd", label: "ngân sách cho PT", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  // Real field: UserProfile.ptBudgetVnd, surfaced as `budgetVnd` by
  // /profile/agent/context (agentic-fitness.service.ts::context). Honoring
  // an already-known value here does NOT persist it back (WORKFLOW_ONLY —
  // no PUT /profile/me route exposes ptBudgetVnd as agent-writable), it
  // only avoids re-asking for a preference Gymini already has on file. A
  // profile-backed value is always a real positive number — the profile
  // schema has no "no cap" representation, by design (§7's own instruction:
  // "Do not persist this as a false profile numeric fact").
  readFromContext: (ctx) => {
    const v = (ctx.enterpriseContext.profile as Record<string, unknown>).budgetVnd;
    return typeof v === "number" && v > 0 ? v : undefined;
  },
  parse: (raw) => {
    if (NO_CAP_PHRASE_RE.test(normalizeAgentText(raw))) {
      return { ok: true, value: NO_BUDGET_CAP };
    }
    return parseBudgetVnd(raw);
  },
  question: () => "Ngân sách của bạn cho PT khoảng bao nhiêu (ví dụ 1.5 triệu), hoặc nói \"không giới hạn\" nếu ngân sách không quan trọng?",
  format: (v) => (v === NO_BUDGET_CAP ? "Không giới hạn" : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(v)),
};

export const findProgramSlots: SlotDefinition<any>[] = [goalSlot, daysSlot, sessionMinutesSlot];
export const findPtSlots: SlotDefinition<any>[] = [goalSlot, daysSlot, sessionMinutesSlot, budgetSlot];

export const findTrainingProgramWorkflow: WorkflowDefinition = {
  type: "FIND_TRAINING_PROGRAM", gatesIntentKind: "PROGRAM", slots: findProgramSlots,
};
export const findPtWorkflow: WorkflowDefinition = {
  type: "FIND_PT", gatesIntentKind: "PT", slots: findPtSlots,
};
