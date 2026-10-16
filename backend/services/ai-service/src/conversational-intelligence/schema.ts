import { z } from "zod";

/**
 * Conversational Intelligence V2 — the strict, typed result of interpreting ONE user turn.
 *
 * This layer only UNDERSTANDS language. It never writes business state, never picks tools, and its output is always
 * validated (zod + unit/range cross-checks) before the deterministic workflow layer looks at it.
 */

export const ENTITY_TYPES = [
  "HEIGHT_CM",
  "WEIGHT_KG", // CURRENT body weight
  "TARGET_WEIGHT_KG",
  "WEIGHT_UNLABELED", // a weight-shaped value whose role (current vs target) the text does not say
  "AGE",
  "GENDER",
  "SESSIONS_PER_WEEK",
  "SESSION_MINUTES",
  "MEALS_PER_DAY",
  "BUDGET_VND",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"] as const;
export type Goal = (typeof GOALS)[number];

export const PRIMARY_INTENTS = [
  "ANSWER_QUESTION",
  "START_WORKFLOW",
  "PROVIDE_INFORMATION",
  "CORRECT_INFORMATION",
  "ASK_RECOMMENDATION",
  "REVISE_WORKFLOW",
  "CONFIRM",
  "DISMISS",
  "UNKNOWN",
] as const;
export type PrimaryIntent = (typeof PRIMARY_INTENTS)[number];

export const WORKFLOW_INTENTS = [
  "CREATE_ROADMAP",
  "CREATE_WORKOUT_PLAN",
  "FIND_TRAINING_PROGRAM",
  "FIND_PT",
  "HIRE_PT",
  "CREATE_NUTRITION_PLAN",
] as const;
export type WorkflowIntent = (typeof WORKFLOW_INTENTS)[number];

export const REQUESTED_ACTIONS = ["ASK", "SUGGEST", "CLARIFY", "PROPOSE_CHANGE", "REVISE", "CONFIRM", "EXECUTE_AFTER_CONFIRM"] as const;
export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

export const REFERENCE_KINDS = [
  "ACCEPT_PROPOSAL", // "mức đó", "dùng mức bạn đề xuất", "72 đó"
  "LOWER_OPTION",
  "HIGHER_OPTION",
  "MIDDLE_OPTION",
  "FIRST_ITEM", // "cái đầu tiên", "PT thứ nhất"
  "THIS_ITEM", // "PT này", "plan này"
  "PREVIOUS_STATE", // "giữ cái cũ", "cái vừa rồi"
  // Phase 3 Batch 4 (docs/ai-product/phase3-batch4-conversational-revision.md) — generalizes FIRST_ITEM
  // to any ordinal position ("PT thứ hai", "chương trình thứ 3") via the `ordinal` field below. Only
  // fires for N>=2; "đầu tiên/thứ nhất" stays FIRST_ITEM unchanged, zero regression risk.
  "ORDINAL_ITEM",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const SemanticEntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  value: z.union([z.number(), z.string()]),
  sourceText: z.string(),
  /** true when the text itself states the role AND the unit ("nặng 80kg"); false when the role/unit is inferred. */
  explicit: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** the user is REJECTING this value ("không phải 74", "tôi không muốn xuống 70"): must never be assigned. */
  negated: z.boolean().optional(),
});
export type SemanticEntity = z.infer<typeof SemanticEntitySchema>;

export const SemanticCorrectionSchema = z.object({
  field: z.union([z.enum(ENTITY_TYPES), z.literal("GOAL")]),
  previousValue: z.union([z.number(), z.string()]).optional(),
  newValue: z.union([z.number(), z.string()]).optional(),
  confidence: z.number().min(0).max(1),
});
export type SemanticCorrection = z.infer<typeof SemanticCorrectionSchema>;

export const SemanticReferenceSchema = z.object({
  kind: z.enum(REFERENCE_KINDS), sourceText: z.string(),
  /** ORDINAL_ITEM only — the 1-based position referenced ("thứ hai" -> 2). */
  ordinal: z.number().int().positive().optional(),
});
export type SemanticReference = z.infer<typeof SemanticReferenceSchema>;

export const GoalSignalSchema = z.object({
  goal: z.enum(GOALS),
  /** EXPLICIT: the user names the goal ("giảm mỡ", "tăng cơ"). IMPLICIT: inferred from how they talk ("tôi đang khá mập"). */
  strength: z.enum(["EXPLICIT", "IMPLICIT"]),
  /** "không tăng cơ nữa" — the user is dropping this goal. */
  negatesGoal: z.boolean().optional(),
  sourceText: z.string(),
});
export type GoalSignal = z.infer<typeof GoalSignalSchema>;

export const SemanticNegationSchema = z.object({
  target: z.union([z.enum(ENTITY_TYPES), z.literal("GOAL"), z.literal("ACTION")]),
  value: z.union([z.number(), z.string()]).optional(),
  sourceText: z.string(),
});
export type SemanticNegation = z.infer<typeof SemanticNegationSchema>;

export const SemanticAmbiguitySchema = z.object({ field: z.string(), reason: z.string() });
export type SemanticAmbiguity = z.infer<typeof SemanticAmbiguitySchema>;

export const SemanticInterpretationSchema = z.object({
  primaryIntent: z.enum(PRIMARY_INTENTS),
  workflowIntent: z.enum(WORKFLOW_INTENTS).optional(),
  entities: z.array(SemanticEntitySchema),
  corrections: z.array(SemanticCorrectionSchema),
  references: z.array(SemanticReferenceSchema),
  goalSignals: z.array(GoalSignalSchema),
  negations: z.array(SemanticNegationSchema),
  ambiguities: z.array(SemanticAmbiguitySchema),
  requestedAction: z.enum(REQUESTED_ACTIONS).optional(),
  /** the user asks WHY ("vì sao bạn đề xuất 72?"). */
  asksWhy: z.boolean().optional(),
  clarificationRequired: z.boolean(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["DETERMINISTIC", "LLM", "MERGED"]),
});
export type SemanticInterpretation = z.infer<typeof SemanticInterpretationSchema>;

/** What the interpreter is allowed to know about the conversation (authoritative + session state). */
export interface InterpretContext {
  /** the workflow slot the assistant just asked about, e.g. "targetWeight". */
  expectedSlot?: string | null;
  persisted?: Partial<{
    goal: Goal;
    heightCm: number;
    currentWeightKg: number;
    targetWeightKg: number;
    age: number;
    gender: string;
  }>;
  /** a value/range the assistant proposed on an earlier turn (for "mức đó", "lấy mức thấp hơn"). */
  proposal?: { field: string; lowKg?: number; highKg?: number; recommendedKg?: number } | null;
}
