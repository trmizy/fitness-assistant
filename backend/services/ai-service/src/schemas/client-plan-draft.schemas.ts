import { z } from "zod";

/** Phase 7 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — a PT-initiated
 * AI DRAFT of a client's workout plan. This is explicitly a draft: the
 * caller (coach.service.ts, fitness-service) never persists this as a real
 * plan/schedule — the PT must review, edit, and explicitly submit via the
 * existing POST /coach/clients/:clientId/plans (Phase 6, unchanged) before
 * anything is actually assigned. No exerciseId here is ever invented by the
 * model — every one is validated against the caller-supplied
 * allowedExercises catalog (same grounding discipline as ai.worker.ts's
 * existing client plan-generation flow), and none of this ever names or
 * copies a specific commercial/copyrighted training program. */
export const GenerateClientPlanDraftRequestSchema = z.object({
  userId: z.string().min(1), // the PT — used for LLM logging/audit, not the plan owner
  client: z.object({
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"]).optional(),
    competesInSport: z.boolean().optional(),
    goal: z.string().nullable().optional(),
    /** Reported injury/pain areas — the model must never place an exercise
     * that loads one of these areas (see buildDraftPrompt's hard rule). */
    injuries: z.array(z.string()).default([]),
  }),
  /** CycleFeedbackSummaryResult, if the client has an active cycle with
   * feedback — opaque passthrough, same convention as
   * feedback-analysis.schemas.ts. */
  cycleFeedbackSummary: z.record(z.string(), z.unknown()).optional(),
  priorDecisions: z.array(z.string()).default([]),
  /** Free-text notes from the PT — e.g. "client wants more upper body
   * volume", "avoid overhead pressing for now". Never treated as an
   * instruction to bypass a safety rule. */
  ptNotes: z.string().max(1000).optional(),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  allowedExercises: z
    .array(
      z.object({
        id: z.string(),
        exerciseName: z.string(),
        bodyPart: z.string().nullable().optional(),
        typeOfActivity: z.string().nullable().optional(),
        typeOfEquipment: z.string().nullable().optional(),
        muscleGroupsActivated: z.array(z.string()).optional(),
      }),
    )
    .min(1, "at least one allowed exercise is required to draft a plan"),
});
export type GenerateClientPlanDraftRequest = z.infer<typeof GenerateClientPlanDraftRequestSchema>;

const draftExerciseSchema = z.object({
  exerciseId: z.string(),
  order: z.number().int().min(0).default(0),
  sets: z.number().int().min(1).max(10).default(3),
  reps: z.number().int().min(1).max(50).default(10),
  note: z.string().max(300).optional(),
});

const draftDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7),
  title: z.string(),
  exercises: z.array(draftExerciseSchema),
});

/** LLM output — validated with Zod, deterministic (empty-days) fallback on
 * failure. `days[].exercises[].exerciseId` is re-validated against
 * allowedExercises by the service layer AFTER this schema check (Zod alone
 * can't cross-reference against a dynamic allowed-id set); any exerciseId
 * not in the catalog is dropped, never invented into a real assignment. */
export const GenerateClientPlanDraftOutputSchema = z.object({
  days: z.array(draftDaySchema),
  /** Explicit gaps in the data used (e.g. "client has no active cycle yet",
   * "feedback data too sparse to personalize confidently") — must never be
   * silently omitted when data is thin. */
  dataGaps: z.array(z.string()).default([]),
  /** Non-medical, PT-facing cautions — e.g. an injury area the model
   * deliberately avoided programming around. */
  warnings: z.array(z.string()).default([]),
  summaryForPt: z.string(),
});
export type GenerateClientPlanDraftOutput = z.infer<typeof GenerateClientPlanDraftOutputSchema>;
