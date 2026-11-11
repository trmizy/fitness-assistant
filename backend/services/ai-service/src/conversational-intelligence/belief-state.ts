import type { Goal, InterpretContext, SemanticEntity, SemanticInterpretation } from "./schema";

/**
 * Conversation belief state — a request/session-scoped semantic view that layers the user's CURRENT words on top of the
 * authoritative persisted facts WITHOUT overwriting them. Persisted state changes only through the existing confirmation
 * flow; this structure exists so the assistant can reason about "the DB says muscle gain, the user is now saying they want
 * to lose weight" as a conflict instead of a validation error.
 *
 * Precedence (highest first): current explicit correction > current explicit statement > confirmed workflow state >
 * authoritative persisted fact > stable memory > model inference. A higher-precedence candidate wins FOR REASONING only.
 */

export type BeliefField = "goal" | "heightCm" | "currentWeightKg" | "targetWeightKg" | "age" | "gender" | "sessionsPerWeek" | "sessionMinutes" | "mealsPerDay" | "budgetVnd";
export type BeliefSource = "CURRENT_CORRECTION" | "CURRENT_USER" | "CONFIRMED_WORKFLOW" | "AUTHORITATIVE_DB" | "STABLE_MEMORY" | "INFERENCE";

export const SOURCE_RANK: Record<BeliefSource, number> = {
  CURRENT_CORRECTION: 6, CURRENT_USER: 5, CONFIRMED_WORKFLOW: 4, AUTHORITATIVE_DB: 3, STABLE_MEMORY: 2, INFERENCE: 1,
};

export interface BeliefValue<T> {
  persisted?: T;
  currentCandidate?: T;
  /** where the candidate itself came from (independent of which value currently wins for reasoning) */
  candidateSource?: BeliefSource;
  /** source of the value that currently wins for reasoning */
  source: BeliefSource;
  confidence: number;
  conflict?: boolean;
}

export type Belief = Partial<{
  goal: BeliefValue<Goal>;
  heightCm: BeliefValue<number>;
  currentWeightKg: BeliefValue<number>;
  targetWeightKg: BeliefValue<number>;
  age: BeliefValue<number>;
  gender: BeliefValue<string>;
  sessionsPerWeek: BeliefValue<number>;
  sessionMinutes: BeliefValue<number>;
  mealsPerDay: BeliefValue<number>;
  budgetVnd: BeliefValue<number>;
}>;

/** Value that wins for reasoning: the candidate if it outranks the persisted fact, else the persisted fact. */
export function effective<T>(b?: BeliefValue<T>): T | undefined {
  if (!b) return undefined;
  if (b.currentCandidate !== undefined && SOURCE_RANK[b.source] >= SOURCE_RANK.AUTHORITATIVE_DB) return b.currentCandidate;
  return b.persisted;
}

const ENTITY_FIELD: Partial<Record<SemanticEntity["type"], BeliefField>> = {
  HEIGHT_CM: "heightCm", WEIGHT_KG: "currentWeightKg", TARGET_WEIGHT_KG: "targetWeightKg", AGE: "age", GENDER: "gender",
  SESSIONS_PER_WEEK: "sessionsPerWeek", SESSION_MINUTES: "sessionMinutes", MEALS_PER_DAY: "mealsPerDay", BUDGET_VND: "budgetVnd",
};

/** Resolve WEIGHT_UNLABELED with the slot the assistant just asked about; otherwise it stays unresolved (never guessed). */
export function resolveEntityField(e: SemanticEntity, expectedSlot?: string | null): BeliefField | undefined {
  if (e.type === "WEIGHT_UNLABELED") return expectedSlot === "targetWeight" ? "targetWeightKg" : expectedSlot === "currentWeightKg" ? "currentWeightKg" : undefined;
  return ENTITY_FIELD[e.type];
}

function set<T>(b: Belief, field: BeliefField, value: T, source: BeliefSource, confidence: number) {
  const cur = (b as Record<string, BeliefValue<T>>)[field] ?? ({ source: "AUTHORITATIVE_DB", confidence: 1 } as BeliefValue<T>);
  const next: BeliefValue<T> = { ...cur, currentCandidate: value, candidateSource: source };
  if (SOURCE_RANK[source] >= SOURCE_RANK[cur.source] || cur.persisted === undefined) { next.source = source; next.confidence = confidence; }
  if (cur.persisted !== undefined && cur.persisted !== value) next.conflict = true;
  (b as Record<string, BeliefValue<T>>)[field] = next;
}

/** persisted facts + this session's already-collected candidates + this turn's interpretation. */
export function buildBelief(persisted: NonNullable<InterpretContext["persisted"]>, sessionKnown: Record<string, unknown>, interp: SemanticInterpretation, expectedSlot?: string | null): Belief {
  const b: Belief = {};
  const seed = <T>(field: BeliefField, v: T | undefined) => { if (v !== undefined && v !== null) (b as Record<string, BeliefValue<T>>)[field] = { persisted: v, source: "AUTHORITATIVE_DB", confidence: 1 }; };
  seed("goal", persisted.goal); seed("heightCm", persisted.heightCm); seed("currentWeightKg", persisted.currentWeightKg);
  seed("targetWeightKg", persisted.targetWeightKg); seed("age", persisted.age); seed("gender", persisted.gender);

  // earlier turns of THIS workflow: user-stated, not yet confirmed into the profile
  const KNOWN_FIELD: Record<string, BeliefField> = { goal: "goal", heightCm: "heightCm", currentWeightKg: "currentWeightKg", targetWeight: "targetWeightKg", age: "age", gender: "gender", daysPerWeek: "sessionsPerWeek", sessionMinutes: "sessionMinutes", mealsPerDay: "mealsPerDay", budgetVnd: "budgetVnd" };
  for (const [k, v] of Object.entries(sessionKnown)) if (KNOWN_FIELD[k] && v !== undefined && !k.startsWith("__")) set(b, KNOWN_FIELD[k], v, "CURRENT_USER", 0.9);

  const correcting = interp.corrections.length > 0;
  for (const e of interp.entities) {
    if (e.negated) continue;
    const field = resolveEntityField(e, expectedSlot);
    if (!field) continue;
    set(b, field, e.value, correcting ? "CURRENT_CORRECTION" : "CURRENT_USER", e.confidence);
  }
  for (const c of interp.corrections) {
    if (c.field === "GOAL" && c.newValue) set(b, "goal", c.newValue as Goal, "CURRENT_CORRECTION", c.confidence);
  }
  // an explicit (non-negated) goal statement becomes the current candidate; an IMPLICIT one is only a weak inference.
  const explicit = interp.goalSignals.find((g) => !g.negatesGoal && g.strength === "EXPLICIT");
  if (explicit && !interp.corrections.some((c) => c.field === "GOAL")) set(b, "goal", explicit.goal, "CURRENT_USER", 0.9);
  else if (!explicit) {
    const implicit = interp.goalSignals.find((g) => !g.negatesGoal && g.strength === "IMPLICIT");
    if (implicit) set(b, "goal", implicit.goal, "INFERENCE", 0.55);
  }
  return b;
}
