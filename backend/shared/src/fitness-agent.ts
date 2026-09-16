import { z } from "zod";

export const AgentPreferencesSchema = z.object({
  goal: z.enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"]).optional(),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(v => new Set(v).size === v.length).optional(),
  sessionMinutes: z.number().int().min(15).max(180).optional(),
  budgetVnd: z.number().int().positive().max(100000000).optional(),
  provinceCode: z.number().int().positive().optional(),
  mode: z.enum(["ONLINE", "OFFLINE"]).optional(),
  durationWeeks: z.number().int().min(1).max(52).optional(),
  demo: z.boolean().default(false),
}).strict();
export type AgentPreferences = z.infer<typeof AgentPreferencesSchema>;
export const GoalIntentSchema = z.object({
  primaryGoal: z.enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"]),
  focusMuscles: z.array(z.enum(["SHOULDERS", "CHEST", "BACK", "ARMS", "LEGS", "GLUTES", "GENERAL"])).max(7),
  muscularity: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
  relativeLeanness: z.enum(["MODERATE", "LEAN_APPEARANCE", "VERY_LEAN_APPEARANCE"]).optional(),
  source: z.enum(["TEXT", "REFERENCE_IMAGE", "MANUAL", "ONBOARDING"]),
  confirmedByUser: z.literal(true),
}).strict();
export type GoalIntent = z.infer<typeof GoalIntentSchema>;
export type DataOrigin = "REAL" | "SYNTHETIC";
export interface HistoricalSummary {
  count: number;
  medianWeightChange: number | null;
  medianTrainingAdherence: number | null;
  medianNutritionAdherence: number | null;
  medianDurationWeeks: number | null;
  completionRate: number | null;
  dataOrigin: DataOrigin;
  similarityVersion: string;
  note: string;
}
export interface PTCandidate {
  id: string; name: string; photoUrl: string | null;
  specialties: string[]; yearsExperience: string | null; languages: string[];
  certificates: Array<{ name: string; issuer: string; verificationStatus: string }>;
  packages: Array<{ id: string; name: string; price: number; sessions: number; sessionMinutes: number; mode: string }>;
  availableDays: number[]; availableSlots: number;
  averageRating: number | null; reviewCount: number;
  clientsStarted: number; clientsCompleted: number;
  cancellationRate: number | null; noShowRate: number | null;
  dataOrigin: DataOrigin; history: HistoricalSummary;
}
export interface TrainingProgramCandidate {
  id: string; name: string; goal: string; daysPerWeek: number; durationWeeks: number;
  estimatedMinutes: number; experienceLevel: string; focusMuscles: string[];
  fingerprint: string; dataOrigin: DataOrigin; days: unknown[];
}
export interface CompatibilityScore {
  total: number; scoringVersion: string; components: Record<string, number>;
  reasons?: string[];
  // Training-program v2 only (fitness-agent-scoring.ts::scoreTrainingProgramV2)
  // — both optional so `scorePT`'s existing PT-agent callers/tests are
  // completely unaffected (they simply never set these fields).
  /** Confirmatory eligibility facts (already guaranteed true by the caller's
   * own hard filter) — never part of `components`/`total`, kept separate so
   * a constant hard-filter dimension can never be mistaken for a
   * candidate-differentiating ranking signal. */
  eligibilityReasons?: string[];
  /** How many `components` entries actually varied this call (0 means every
   * ranking dimension was absent — see scoreTrainingProgramV2's own
   * "zero ranking signal" handling). */
  signalCount?: number;
}
export interface AgentEvidence {
  id: string; title: string; sourceUrl: string; finding: string;
  evidenceLevel: string; version: string;
}
// Adaptive Cycle Evaluation via chat (docs/agentic-fitness/01_NUTRITION_AGENT_
// TOOLS_PLAN.md, phase D) — accept/reject a PENDING training or nutrition
// recommendation. Real prescription change (same MEDIUM tier as APPLY_
// TRAINING_PLAN), so still goes through the prepare()/confirm()/execute()
// flow, unlike SUBSTITUTE_MEAL_ITEM (never added here — that tool
// deliberately bypasses this whole action-kind system, see fitness-agent
// .service.ts's trySubstitution doc comment).
export const AgentActionKindSchema = z.enum([
  "VIEW_PT", "APPLY_TRAINING_PLAN", "CREATE_PT_CONTRACT_DRAFT", "CONFIRM_PT_CONTRACT",
  "ACCEPT_TRAINING_RECOMMENDATION", "REJECT_TRAINING_RECOMMENDATION",
  "ACCEPT_NUTRITION_RECOMMENDATION", "REJECT_NUTRITION_RECOMMENDATION",
  // Agent automation (chat "hãy tạo và gán lộ trình/plan tập/dinh dưỡng vào
  // hệ thống") — one action that, on confirm, creates+activates a real
  // FitnessRoadmap, applies a real workout program, and bootstraps a real
  // NutritionGoal in sequence. Reuses the same prepare()/confirm()/execute()
  // flow as every other real write here, not a new mechanism.
  "CREATE_PLAN_BUNDLE",
  // "gán/lưu lịch tập [vừa tạo] vào hệ thống" — persists the user's most
  // recent LLM-generated WorkoutPlan (from POST /plans/workout/generate)
  // into a real WorkoutProgram/WorkoutSchedule via the existing
  // /workouts/from-ai-plan endpoint. Distinct from CREATE_PLAN_BUNDLE:
  // that one generates a fresh roadmap+workout+nutrition bundle from the
  // user's profile; this one saves the SPECIFIC plan already shown in the
  // conversation, so what gets created always matches what was previewed.
  "SAVE_GENERATED_PLAN",
  // Conversational AI Coach product capability expansion — a NEW,
  // self-contained "tạo lịch tập cho tôi" workflow (agent-workflow/
  // workflows/create-workout-plan.workflow.ts) that collects daysPerWeek/
  // sessionMinutes explicitly, generates a structured draft, shows a real
  // WORKOUT_PLAN_PREVIEW (not prose), and supports a genuine revision loop
  // BEFORE this confirmation is ever created. Distinct from
  // SAVE_GENERATED_PLAN (which persists whatever the PRIOR chat turn's
  // deterministic answer happened to be, via Conversation.routeIntent
  // lookback) — this kind's payload is always exactly what the user saw in
  // the preview they're confirming. Executes through the SAME
  // importAiPlanToSchedule boundary as SAVE_GENERATED_PLAN — no new
  // persistence mechanism.
  "CREATE_WORKOUT_PLAN",
  // "tạo kế hoạch dinh dưỡng cho tôi" — wraps the EXISTING async AI
  // nutrition-plan pipeline (POST /plans/nutrition/generate ->
  // /adjust -> /save-to-nutrition, the same endpoints the REST "Generate
  // Plan" wizard already uses) behind the conversational workflow
  // foundation. On confirm, persists through the existing
  // save-to-nutrition boundary — no new nutrition-generation logic.
  "CREATE_NUTRITION_PLAN",
  // Roadmap management for an EXISTING roadmap via chat — advance to the
  // next phase, rebuild the remaining phases after an ADJUST/DELOAD/REBUILD
  // assessment, or archive it outright. Each wraps a real, already-shipped
  // fitness-service endpoint (advance/rebuild-preview+apply/archive) that
  // RoadmapJourneyPage.tsx already calls — same real business rules (e.g.
  // advance 409s with no completed cycle ready), just reachable from chat.
  "ROADMAP_ADVANCE", "ROADMAP_REBUILD", "ROADMAP_ARCHIVE",
  // Training-cycle management via chat — close out or abandon the
  // currently active cycle. Each wraps a real training-cycle.routes.ts
  // endpoint (/complete, /cancel) already used by the client UI; EVALUATE
  // (a separate, pre-existing intent) already owns "how is my cycle
  // going" read-only status checks, so these two only ever fire on an
  // explicit close/cancel verb.
  "CYCLE_COMPLETE", "CYCLE_CANCEL",
  // "ghi lại tôi vừa ăn X" — creates one NutritionLog row via the same
  // real POST /nutrition the manual "add meal" UI uses, grounded in the
  // real Food catalog (never an LLM-invented calorie/macro number). LOW
  // risk: a single log entry the user can delete from the Nutrition page
  // like any other, not a program/goal-level change.
  "NUTRITION_LOG_MEAL",
  // Workout-session (WorkoutSchedule) runtime management via chat — start,
  // skip, or cancel TODAY's scheduled session. Deliberately scoped to
  // session-level ops only: per-exercise/per-set completion during an
  // active session is a real-time logging interaction better suited to
  // the workout-logging UI itself, not a one-shot chat confirm.
  "WORKOUT_START", "WORKOUT_SKIP", "WORKOUT_CANCEL",
]);
export type AgentActionKind = z.infer<typeof AgentActionKindSchema>;
export function agentActionRisk(kind: AgentActionKind): "LOW" | "MEDIUM" | "HIGH" {
  if (kind === "VIEW_PT" || kind === "NUTRITION_LOG_MEAL") return "LOW";
  if (kind === "CREATE_PT_CONTRACT_DRAFT" || kind === "CONFIRM_PT_CONTRACT" || kind === "CREATE_PLAN_BUNDLE"
    || kind === "ROADMAP_REBUILD" || kind === "ROADMAP_ARCHIVE" || kind === "CYCLE_CANCEL") return "HIGH";
  return "MEDIUM"; // APPLY_TRAINING_PLAN, ROADMAP_ADVANCE, CYCLE_COMPLETE, and all 4 accept/reject-recommendation kinds
}
export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
