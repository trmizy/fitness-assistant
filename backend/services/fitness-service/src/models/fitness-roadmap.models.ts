import { z } from "zod";

export const RoadmapPhaseTypeSchema = z.enum([
  "FAT_LOSS",
  "DIET_BREAK",
  "MAINTENANCE",
  "LEAN_GAIN",
  "MINI_CUT",
  "RECOMPOSITION",
  "PERFORMANCE",
  "RECOVERY",
]);

export const roadmapPhaseObjectiveSchema = z
  .object({
    maxCycles: z.number().int().min(1).max(52).optional(),
    completed: z.boolean().optional(),
  })
  .strict();

export const roadmapPhaseTransitionRulesSchema = z
  .object({
    completeOnPlannedEndDate: z.boolean().optional(),
    allowDeloadCycle: z.boolean().optional(),
  })
  .strict();

export const createRoadmapPhaseSchema = z.object({
  phaseIndex: z.number().int().min(1),
  name: z.string().min(1).max(200),
  phaseType: RoadmapPhaseTypeSchema,
  plannedStartAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  plannedEndAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  objective: roadmapPhaseObjectiveSchema.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  transitionRules: roadmapPhaseTransitionRulesSchema.optional(),
});

export const createFitnessRoadmapSchema = z.object({
  name: z.string().min(1).max(200),
  goalType: z.string().min(1).max(100),
  plannedStartAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  plannedEndAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  targetMetrics: z.record(z.string(), z.unknown()).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  sourceAssessmentId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  phases: z.array(createRoadmapPhaseSchema).min(1).max(24).optional(),
});

export const activatePhaseSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  name: z.string().min(1).max(200).optional(),
  targetMetrics: z.record(z.string(), z.unknown()).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export const addRoadmapPhaseSchema = createRoadmapPhaseSchema;
export const activateRoadmapSchema = activatePhaseSchema;

// Rebuild proposal phases are identical to a normal planned phase except
// phaseIndex is always server-assigned during rebuild (continuing from the
// roadmap's current max index), never caller-supplied.
export const rebuildPhaseProposalSchema = createRoadmapPhaseSchema.omit({ phaseIndex: true });

export const applyRoadmapRebuildSchema = z.object({
  assessmentId: z.string().min(1),
  phases: z.array(rebuildPhaseProposalSchema).min(1).max(24).optional(),
});

// FitnessRoadmap AI Draft generation (Phase B) — request body for
// POST /fitness-roadmaps/ai-draft. userId always comes from req.user!.id,
// never from this body. See docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md.
export const generateAiRoadmapDraftSchema = z.object({
  goalType: z.string().min(1).max(100),
  timeframeWeeks: z.number().int().min(1).max(104).optional(),
  plannedStartAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  constraints: z.array(z.string().max(200)).max(20).optional(),
  // Already-analyzed, already-validated output of the existing
  // POST /ai/agent/goal-image endpoint (fitness-goal-vision.service.ts) —
  // this route never calls vision itself, only accepts an attributes object
  // the client obtained earlier. Purely a style-emphasis signal (Phase D
  // hook), never a body-composition source of truth.
  goalVisualAttributes: z
    .object({
      muscularity: z.enum(["LOW", "MODERATE", "HIGH"]).nullable(),
      relativeLeanness: z.enum(["MODERATE", "LEAN_APPEARANCE", "VERY_LEAN_APPEARANCE"]).nullable(),
      focusMuscles: z.array(z.string()).max(7),
    })
    .strict()
    .optional(),
  // Gymini Guided Roadmap Creation additions (design doc §15) — optional,
  // wizard-sourced target details the AI draft prompt can use to phrase a
  // more specific summary/reasoning. Never required, never overrides the
  // deterministic phase-type fallback logic (mapGoalTypeToFallbackPhaseType
  // still keys off goalType alone), and never a second source of truth for
  // the actual numeric targets an accepted roadmap would store.
  targetWeightKg: z.number().min(20).max(400).optional(),
  targetBodyFatPercent: z.number().min(3).max(70).optional(),
  trainingDaysPerWeek: z.number().int().min(0).max(7).optional(),
});

// Gymini Guided Roadmap Creation — POST /fitness-roadmaps/diagnosis body.
// Read-only, zero DB write, zero AI call (docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md
// §15). Every field is an OPTIONAL override of the caller's stored
// user-service profile/InBody values — the wizard lets a user tweak a
// number before committing it to their profile, but the diagnosis screen
// must still work with nothing supplied at all (falls back entirely to
// stored data, or explicit "Không đủ dữ liệu" when neither exists).
export const fitnessDiagnosisInputSchema = z.object({
  weightKg: z.number().min(20).max(400).optional(),
  heightCm: z.number().min(100).max(250).optional(),
  age: z.number().int().min(13).max(100).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  bodyFatPct: z.number().min(3).max(70).optional(),
  // Provenance of bodyFatPct — purely informational (echoed back, and used
  // to prefer an explicit InBody override over a rough manual/visual
  // estimate when both happen to be present); never changes the math.
  bodyFatMethod: z.enum(["manual", "visual_reference", "inbody"]).optional(),
  activityLevel: z
    .enum(["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE", "EXTREMELY_ACTIVE"])
    .optional(),
  trainingDaysPerWeek: z.number().int().min(0).max(7).optional(),
  dailyGoalSteps: z.number().int().min(0).max(50_000).optional(),
  // Goal-neutral for the energy breakdown itself (see
  // fitness-diagnosis.engine.ts's computeEnergyBreakdown, always called
  // with goal="MAINTENANCE"), but still accepted here since the reasoning
  // text and target-realism check ARE goal-aware.
  goal: z.enum(["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"]).optional(),
  targetWeightKg: z.number().min(20).max(400).optional(),
  targetBodyFatPercent: z.number().min(3).max(70).optional(),
  timeframeWeeks: z.number().int().min(1).max(104).optional(),
});

// Gymini Roadmap Projection & Strategy Report Hardening — POST
// /fitness-roadmaps/projection body. Read-only, zero DB write, zero AI
// call (docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md §13). Current-
// state fields are the same optional overrides fitnessDiagnosisInputSchema
// accepts; `phases` is the AI draft's (pre-Save) or a persisted
// RoadmapPhase[]'s phase sequence — .passthrough() so either shape
// validates without stripping the fields this route doesn't need.
export const roadmapPhaseForecastPhaseInputSchema = z
  .object({
    phaseIndex: z.number().int().min(1),
    phaseType: RoadmapPhaseTypeSchema,
    name: z.string().min(1).max(200),
    plannedStartAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    plannedEndAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .passthrough();

export const roadmapPhaseForecastInputSchema = z.object({
  weightKg: z.number().min(20).max(400).optional(),
  heightCm: z.number().min(100).max(250).optional(),
  age: z.number().int().min(13).max(100).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  bodyFatPct: z.number().min(3).max(70).optional(),
  bodyFatMethod: z.enum(["manual", "visual_reference", "inbody"]).optional(),
  activityLevel: z
    .enum(["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE", "EXTREMELY_ACTIVE"])
    .optional(),
  phases: z.array(roadmapPhaseForecastPhaseInputSchema).min(1).max(24),
});

// Accepting an AI (or, structurally identically, a future PT-edited) draft
// re-uses createFitnessRoadmapSchema's exact phase shape — the accept step
// is deliberately just "create a roadmap," attributed to createdByRole=AI
// server-side, never caller-supplied.
export const acceptAiRoadmapDraftSchema = createFitnessRoadmapSchema.extend({
  sourceAssessmentId: z.string().min(1).optional(),
});

export type RoadmapPhaseObjective = z.infer<typeof roadmapPhaseObjectiveSchema>;
export type RoadmapPhaseTransitionRules = z.infer<typeof roadmapPhaseTransitionRulesSchema>;
export type CreateFitnessRoadmapInput = z.infer<typeof createFitnessRoadmapSchema>;
export type CreateRoadmapPhaseInput = z.infer<typeof createRoadmapPhaseSchema>;
export type ActivatePhaseInput = z.infer<typeof activatePhaseSchema>;
export type RebuildPhaseProposalInput = z.infer<typeof rebuildPhaseProposalSchema>;
export type ApplyRoadmapRebuildInput = z.infer<typeof applyRoadmapRebuildSchema>;
export type GenerateAiRoadmapDraftInput = z.infer<typeof generateAiRoadmapDraftSchema>;
export type AcceptAiRoadmapDraftInput = z.infer<typeof acceptAiRoadmapDraftSchema>;
export type FitnessDiagnosisInput = z.infer<typeof fitnessDiagnosisInputSchema>;
export type RoadmapPhaseForecastInput = z.infer<typeof roadmapPhaseForecastInputSchema>;
