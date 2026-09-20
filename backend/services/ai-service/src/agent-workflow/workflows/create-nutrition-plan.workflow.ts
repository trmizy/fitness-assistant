import type { SlotDefinition, WorkflowContext, WorkflowDefinition } from "../types";
import { parseMealsPerDay } from "../slot-values";
import { normalizeAgentText } from "../../services/fitness-agent-intent";
import {
  extractNutritionConstraints, constraintSetIsEmpty, type NutritionConstraintSet,
} from "../../services/nutrition-food-constraints";

/**
 * CREATE_NUTRITION_PLAN — a standalone "tạo kế hoạch dinh dưỡng cho tôi"
 * workflow. See docs/standalone-nutrition-workflow-audit.md and
 * docs/ai-coach-product-remediation-1.md for the full audit; the short
 * version: goal/body-stats/activity/experience come from
 * EnterpriseContext/profileExtractor, the calorie/macro TARGET comes from the
 * authoritative NutritionGoal / deterministic prescription (fitness-service),
 * `durationWeeks` is hardcoded to 1, and the ONE genuinely-asked slot is
 * `mealsPerDay`.
 *
 * `nutritionConstraints` is a second, NON-required, WORKFLOW_ONLY slot that
 * exists purely so dietary constraints stated in the INITIATING message
 * ("Tạo kế hoạch dinh dưỡng cho tôi. Tôi không ăn cá.") survive slot
 * collection (remediation M1) — the orchestrator only keeps extracted keys
 * that match a declared slot, and the final "4 bữa" answer arrives in a
 * later turn. It is never asked for, never persisted to UserProfile/
 * UserMemory/NutritionGoal (no authoritative schema home exists — see the
 * audit's product-schema-gap section). Known limitation: because an
 * already-known slot is never overwritten during collection, a SECOND
 * constraint stated in a middle turn is merged later by
 * proposeNutritionPlan from the final turn's own text instead.
 */

const mealsPerDaySlot: SlotDefinition<number> = {
  key: "mealsPerDay", label: "số bữa mỗi ngày", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: true,
  readFromContext: () => undefined, // no EnterpriseContext equivalent exists — always a real ask unless extractFromMessage catches it
  parse: parseMealsPerDay,
  question: () => "Bạn muốn chia thành mấy bữa mỗi ngày (2-6, mặc định 3)?",
  format: (v) => `${v} bữa/ngày`,
};

const nutritionConstraintsSlot: SlotDefinition<NutritionConstraintSet> = {
  key: "nutritionConstraints", label: "ràng buộc thực đơn", source: "USER_PROFILE", persistence: "WORKFLOW_ONLY", required: false,
  readFromContext: () => undefined,
  parse: (raw) => {
    const set = extractNutritionConstraints(raw);
    return constraintSetIsEmpty(set) ? { ok: false, reason: "no_constraint", clarifyingQuestion: "Bạn muốn loại trừ thực phẩm nào?" } : { ok: true, value: set };
  },
  question: () => "Bạn có thực phẩm nào cần loại trừ không?",
  format: (v) => [...v.exclusions.map((e) => `không ${e.label}`), ...v.hints].join("; ") || "không có",
};

export const createNutritionPlanSlots: SlotDefinition<any>[] = [mealsPerDaySlot, nutritionConstraintsSlot];

export const createNutritionPlanWorkflow: WorkflowDefinition = {
  type: "CREATE_NUTRITION_PLAN",
  gatesIntentKind: "CREATE_NUTRITION_PLAN",
  slots: createNutritionPlanSlots,
  // "chia làm 4 bữa" stated up front — resolves mealsPerDay from the
  // triggering message so the user isn't asked something they just said.
  // Deliberately STRICTER than parseMealsPerDay's own bare-digit answer
  // path (which is only ever run against a reply to the targeted question
  // itself, never arbitrary free text): requires the "bữa/meal" word right
  // next to the digit, so an unrelated number elsewhere in the initiating
  // message (age, weight) is never misread as mealsPerDay.
  extractFromMessage: (message: string, _ctx: WorkflowContext) => {
    const out: Record<string, unknown> = {};
    const s = normalizeAgentText(message);
    const match = s.match(/(\d)\s*(?:bua|meals?)\b/);
    if (match) {
      const result = parseMealsPerDay(match[0]);
      if (result.ok) out.mealsPerDay = result.value;
    }
    const constraints = extractNutritionConstraints(message);
    if (!constraintSetIsEmpty(constraints)) out.nutritionConstraints = constraints;
    return out;
  },
};
