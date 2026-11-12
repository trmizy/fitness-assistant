/**
 * Gymini V2 (EXPERIMENTAL) — Nutrition Agent tool contracts (M1, READ only).
 *
 * Every READ handler is a thin adapter over an EXISTING V1 domain function in services/fitness-agent-tools.ts (same HTTP
 * routes, same identity forwarding, same validation on the fitness-service side). No calorie/macro formula, meal-plan query
 * or food matching is re-implemented here: the contract only adds an argument schema, a model-safe projection and an output
 * schema.
 *
 * Selection — verified READ-ONLY by code (CODE AUDIT 2026-11-13, fitness-service):
 *   nutrition.get_target            GET /nutrition/target-preview → resolveNutritionTargetForUser: the ACTIVE NutritionGoal
 *                                   (source of truth) or, without one, the deterministic onboarding prescription. No write.
 *   nutrition.get_plan_consistency  GET /nutrition/active-state → nutrition-goal-plan-consistency.service (0 writes).
 *   nutrition.search_food           GET /food/search (public catalog) + V1 food picking.
 * Declared WRITE (handler = null, never executable by an agent): log_meal, save_meal_plan, bootstrap_goal.
 * Not included: POST /nutrition/agent/substitute-meal-item (side effects not verified), daily intake history (no V1 tool
 * function exists; the agent must not claim logged intake).
 */
import { z } from "zod";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { createToolRegistry, type ToolRegistryOptions } from "./tool-registry";
import type { AgentToolPolicy, ToolContract } from "./tool-contract";

export type NutritionToolDeps = Pick<typeof fitnessAgentTools, "getNutritionTargetPreview" | "getNutritionActiveState" | "searchFood">;
type C<I, R, O> = ToolContract<I, R, O, NutritionToolDeps>;

const empty = z.object({}).strict();
const clip = (s: unknown, max: number) => (typeof s === "string" ? s.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const macros = z.object({ calories: z.number().nullable(), protein: z.number().nullable(), carbs: z.number().nullable(), fat: z.number().nullable() }).strict();

// ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const getTarget: C<{}, any, unknown> = {
  id: "nutrition.get_target", domain: "nutrition", kind: "READ", timeoutMs: 20_000,
  title: "Daily nutrition target",
  description: "The signed-in user's authoritative daily calories and macros: the active NutritionGoal, or the deterministic initial estimate when no goal exists, or which profile fields are missing.",
  llmExposure: "Status, calories, protein, carbs, fat (g/day), whether a professional review is required, names of missing fields. No ids.",
  input: empty,
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ACTIVE_GOAL"), source: z.literal("NutritionGoal"), daily: macros }).strict(),
    z.object({ status: z.literal("ESTIMATE"), source: z.literal("onboarding_prescription"), daily: macros, professionalReviewRequired: z.boolean() }).strict(),
    z.object({ status: z.literal("INSUFFICIENT_DATA"), missingFields: z.array(z.string().max(40)).max(10) }).strict(),
  ]),
  handler: (ctx, _i, deps) => deps.getNutritionTargetPreview(ctx),
  project: (raw: any) => {
    const daily = { calories: num(raw?.calories), protein: num(raw?.protein), carbs: num(raw?.carbs), fat: num(raw?.fat) };
    if (raw?.status === "ACTIVE_GOAL") return { status: "ACTIVE_GOAL", source: "NutritionGoal", daily };
    if (raw?.status === "COMPUTED") return { status: "ESTIMATE", source: "onboarding_prescription", daily, professionalReviewRequired: raw?.professionalReviewRequired === true };
    return { status: "INSUFFICIENT_DATA", missingFields: (Array.isArray(raw?.missingFields) ? raw.missingFields : []).slice(0, 10).map((f: unknown) => String(f).slice(0, 40)) };
  },
};

const getPlanConsistency: C<{}, any, unknown> = {
  id: "nutrition.get_plan_consistency", domain: "nutrition", kind: "READ", timeoutMs: 20_000,
  title: "Nutrition goal vs meal plan",
  description: "Whether the user's active meal plan matches their active nutrition goal (MATCHED, MACRO_MISMATCH, STALE_GOAL_CHANGED, NO_ACTIVE_GOAL, NO_ACTIVE_PROGRAM, LOW_CONFIDENCE) and which macros differ.",
  llmExposure: "Status, goal and plan daily macros, plan name, per-macro differences, the recommended action code. No ids, no meal items.",
  input: empty,
  output: z.object({
    status: z.enum(["NO_ACTIVE_GOAL", "NO_ACTIVE_PROGRAM", "MATCHED", "STALE_GOAL_CHANGED", "MACRO_MISMATCH", "LOW_CONFIDENCE"]),
    goal: macros.nullable(),
    plan: z.object({ name: z.string().max(80).nullable(), daily: macros }).strict().nullable(),
    mismatches: z.array(z.object({ field: z.enum(["calories", "protein", "carbs", "fat"]), planValue: z.number(), goalValue: z.number() }).strict()).max(4),
    recommendedAction: z.string().max(80),
  }).strict(),
  handler: (ctx, _i, deps) => deps.getNutritionActiveState(ctx),
  project: (raw: any) => ({
    status: raw?.status,
    goal: raw?.activeGoal ? { calories: num(raw.activeGoal.calories), protein: num(raw.activeGoal.protein), carbs: num(raw.activeGoal.carbs), fat: num(raw.activeGoal.fat) } : null,
    plan: raw?.activeProgram ? {
      name: clip(raw.activeProgram.name, 80),
      daily: { calories: num(raw.activeProgram.dailyCaloriesTarget), protein: num(raw.activeProgram.proteinTargetGrams), carbs: num(raw.activeProgram.carbTargetGrams), fat: num(raw.activeProgram.fatTargetGrams) },
    } : null,
    mismatches: (Array.isArray(raw?.mismatches) ? raw.mismatches : []).slice(0, 4).map((m: any) => ({ field: m?.field, planValue: m?.planValue, goalValue: m?.goalValue })),
    recommendedAction: String(raw?.recommendedAction ?? "").slice(0, 80),
  }),
};

const searchFood: C<{ name: string }, any, unknown> = {
  id: "nutrition.search_food", domain: "nutrition", kind: "READ", timeoutMs: 20_000,
  title: "Food catalog lookup",
  description: "Looks up one food in Gymini's food catalog by name and returns its stored calories and macros. Use it instead of guessing nutrient values.",
  llmExposure: "Catalog food name and the nutrient values exactly as stored in the catalog. No ids.",
  input: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  output: z.object({ found: z.boolean(), food: z.object({ name: z.string().max(120), calories: z.number(), protein: z.number(), carbs: z.number(), fats: z.number() }).strict().nullable() }).strict(),
  handler: (ctx, i, deps) => deps.searchFood(ctx, i.name),
  project: (raw: any) => raw
    ? { found: true, food: { name: String(raw.name ?? "").slice(0, 120), calories: raw.calories, protein: raw.protein, carbs: raw.carbs, fats: raw.fats } }
    : { found: false, food: null },
};

// ── WRITE (declared, never executable by an agent) ───────────────────────────────────────────────────────────────────
const write = (toolId: string, title: string, input: z.ZodTypeAny): C<any, unknown, unknown> => ({
  id: toolId, domain: "nutrition", kind: "WRITE", timeoutMs: 20_000, title,
  description: `${title}. WRITE: only reachable through the user's explicit confirmation flow in V1, never as an agent tool call.`,
  llmExposure: "Not exposed: no agent may call this tool.",
  input, output: z.unknown(), handler: null, project: (r) => r,
});
const writeContracts = [
  write("nutrition.log_meal", "Log a meal to the nutrition diary", z.object({ foodName: z.string().max(80), grams: z.number() }).strict()),
  write("nutrition.save_meal_plan", "Save a generated meal plan as the active NutritionProgram", z.object({ planId: z.string().max(64) }).strict()),
  write("nutrition.bootstrap_goal", "Create the first NutritionGoal from the profile", z.object({}).strict()),
];

export const NUTRITION_TOOL_CONTRACTS: ReadonlyArray<C<any, any, unknown>> = [getTarget, getPlanConsistency, searchFood, ...writeContracts];
export const NUTRITION_READ_TOOL_IDS = NUTRITION_TOOL_CONTRACTS.filter((c) => c.kind === "READ").map((c) => c.id);
export const NUTRITION_WRITE_TOOL_IDS = NUTRITION_TOOL_CONTRACTS.filter((c) => c.kind === "WRITE").map((c) => c.id);

/** M1 pilot: READ only. DRAFT/WRITE are never grantable here. */
export const NUTRITION_AGENT_PILOT_POLICY: AgentToolPolicy = Object.freeze({
  agentId: "nutrition-agent-pilot",
  allowedTools: Object.freeze([...NUTRITION_READ_TOOL_IDS]),
  allowDraft: false,
});

/** Registry with every nutrition contract. deps default to the V1 domain tools; flag default = AI_AGENT_V2 (OFF). */
export function createNutritionToolRegistry(options: Omit<ToolRegistryOptions<NutritionToolDeps>, "deps"> & { deps?: NutritionToolDeps } = {}) {
  const registry = createToolRegistry<NutritionToolDeps>({ ...options, deps: options.deps ?? fitnessAgentTools });
  for (const c of NUTRITION_TOOL_CONTRACTS) registry.register(c);
  return registry;
}
