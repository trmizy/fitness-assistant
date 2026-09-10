import { z } from "zod";

/**
 * FitnessRoadmap AI Draft generation (Phase B of the roadmap next-phase
 * work — docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md). Mirrors the exact
 * draft-only discipline already established by client-plan-draft.schemas.ts:
 * this NEVER writes to fitness-service's database directly. fitness-service
 * re-validates every field independently against its own RoadmapPhaseType
 * enum/date logic before ever offering the proposal to a user/PT, and the
 * user/PT must still explicitly accept it (POST /fitness-roadmaps/ai-draft/accept)
 * before a real (DRAFT-status) FitnessRoadmap row is created.
 *
 * RoadmapPhaseType is intentionally redeclared here rather than imported
 * from fitness-service — the two services stay decoupled (no cross-service
 * type import), and fitness-service independently re-validates this same
 * enum on its own schema before accepting anything from here, so an
 * unexpected/renamed value on one side can never silently pass through to
 * the other.
 */
export const RoadmapDraftPhaseTypeSchema = z.enum([
  "FAT_LOSS",
  "DIET_BREAK",
  "MAINTENANCE",
  "LEAN_GAIN",
  "MINI_CUT",
  "RECOMPOSITION",
  "PERFORMANCE",
  "RECOVERY",
]);

export const GenerateRoadmapDraftRequestSchema = z.object({
  userId: z.string().min(1),
  goalType: z.string().min(1).max(100),
  /** Caller's requested overall horizon; a soft target, not a hard
   * contract — fitness-service clamps the final total independently. */
  timeframeWeeks: z.number().int().min(1).max(104).optional(),
  profile: z.object({
    age: z.number().int().min(10).max(100).nullable().optional(),
    gender: z.string().nullable().optional(),
    heightCm: z.number().nullable().optional(),
    currentWeightKg: z.number().nullable().optional(),
    targetWeightKg: z.number().nullable().optional(),
    /** Gymini Guided Roadmap Creation addition (design doc §15) — optional
     * wizard-sourced target body-fat %, purely a phrasing signal for
     * summary/reasoningSummary, never a hard numeric contract the model is
     * scored against. */
    targetBodyFatPercent: z.number().min(3).max(70).nullable().optional(),
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"]).optional(),
    // min(0) not min(1): a user who has not started training yet (0
    // days/week) is a real, valid, common wizard input — never rejected.
    trainingDaysPerWeek: z.number().int().min(0).max(7).nullable().optional(),
    /** Reported injury/pain areas — never a reason by itself to omit
     * RECOVERY, only ever additional context for reasoningSummary. */
    injuries: z.array(z.string()).default([]),
    /** "UNKNOWN" | "CLEARED" | "FOLLOW_UP_SUGGESTED" — when
     * FOLLOW_UP_SUGGESTED, the model must say so in warnings and must not
     * propose an aggressive (MINI_CUT/back-to-back FAT_LOSS) sequence. */
    safetyScreeningStatus: z.enum(["UNKNOWN", "CLEARED", "FOLLOW_UP_SUGGESTED"]).nullable().optional(),
  }),
  /** Real InBody measurement, when available — always prioritized in the
   * prompt over any image-derived estimate below. */
  bodyComposition: z
    .object({
      bodyFatPercent: z.number().nullable().optional(),
      muscleMassKg: z.number().nullable().optional(),
      measuredAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Optional, already-analyzed goal-image attributes from the existing
   * POST /ai/agent/goal-image endpoint (fitness-goal-vision.service.ts).
   * This service never calls vision itself — the caller (fitness-service)
   * passes through an already-validated GoalVisualAttributes object it
   * received earlier, if the user provided one. Purely a style/emphasis
   * signal, never a body-composition source of truth (see the prompt's own
   * explicit priority ordering). */
  goalVisualAttributes: z
    .object({
      muscularity: z.enum(["LOW", "MODERATE", "HIGH"]).nullable(),
      relativeLeanness: z.enum(["MODERATE", "LEAN_APPEARANCE", "VERY_LEAN_APPEARANCE"]).nullable(),
      focusMuscles: z.array(z.string()),
    })
    .nullable()
    .optional(),
  history: z
    .object({
      completedCycleCount: z.number().int().min(0).default(0),
      lastCycleDecision: z.string().nullable().optional(),
      nutritionGoalVersionCount: z.number().int().min(0).default(0),
    })
    .optional(),
  /** Free-text constraints (e.g. "no gym access on weekends", "avoid
   * overhead pressing"). Never treated as an instruction to bypass a
   * safety rule (same convention as client-plan-draft's ptNotes). */
  constraints: z.array(z.string()).max(20).default([]),
});
export type GenerateRoadmapDraftRequest = z.infer<typeof GenerateRoadmapDraftRequestSchema>;

const draftPhaseSchema = z.object({
  phaseType: RoadmapDraftPhaseTypeSchema,
  name: z.string().min(1).max(200),
  plannedDurationWeeks: z.number().int().min(1).max(26),
  /** Optional cap on how many TrainingCycle repeats this phase runs before
   * being eligible for completion — fitness-service maps this straight
   * onto RoadmapPhase.objective.maxCycles, its own already-validated field. */
  objectiveMaxCycles: z.number().int().min(1).max(12).optional(),
  reason: z.string().max(500),
});

export const GenerateRoadmapDraftOutputSchema = z.object({
  summary: z.string().max(1000),
  reasoningSummary: z.string().max(2000),
  confidence: z.number().min(0).max(1),
  phases: z.array(draftPhaseSchema).min(1).max(12),
  warnings: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type GenerateRoadmapDraftOutput = z.infer<typeof GenerateRoadmapDraftOutputSchema>;
