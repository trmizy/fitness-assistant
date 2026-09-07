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
export interface CompatibilityScore {
  total: number; scoringVersion: string; components: Record<string, number>;
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
]);
export type AgentActionKind = z.infer<typeof AgentActionKindSchema>;
export function agentActionRisk(kind: AgentActionKind): "LOW" | "MEDIUM" | "HIGH" {
  if (kind === "VIEW_PT") return "LOW";
  if (kind === "CREATE_PT_CONTRACT_DRAFT" || kind === "CONFIRM_PT_CONTRACT") return "HIGH";
  return "MEDIUM"; // APPLY_TRAINING_PLAN, and all 4 accept/reject-recommendation kinds
}
export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
