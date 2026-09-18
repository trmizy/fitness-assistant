import {
  median,
  type AgentPreferences,
  type HistoricalSummary,
  type DataOrigin,
  type PTCandidate,
  type CompatibilityScore,
  type TrainingProgramCandidate,
} from "./fitness-agent";

// Product heuristics, not a calibrated prediction or scientific effect estimate.
export const FITNESS_SCORING = {
  // v2 (2026-09-14): cold-start fairness fix in scorePT() — see its own
  // comment. Bumped because the numeric meaning of a candidate's `total`
  // for a cold-start PT changed (no longer penalized as if evidence were
  // negative), not because the weights themselves changed.
  version: "compatibility-v2", similarityVersion: "journey-distance-v1",
  weights: { goal: 30, schedule: 25, budget: 20, reputation: 10, evidence: 15 },
  distance: { weight: 0.30, frequency: 0.25, duration: 0.15, session: 0.15, bodyFat: 0.15 },
  minimumCohort: 5, maximumCohort: 20,
} as const;
export const GOAL_SPECIALTIES: Record<string, string[]> = {
  WEIGHT_LOSS: ["Giảm mỡ", "Fat Loss", "Body Recomposition", "FAT_LOSS"],
  MUSCLE_GAIN: ["Tăng cơ", "Thể hình", "Muscle Gain", "Hypertrophy", "MUSCLE_GAIN"],
  MAINTENANCE: ["Sức bền", "General Fitness", "GENERAL_FITNESS"],
  ATHLETIC_PERFORMANCE: ["Powerlifting", "Thể thao thành tích", "Sports Performance", "STRENGTH"],
};
export interface JourneyFeatures {
  goal: string; experience: string; baselineWeight: number; baselineBodyFat: number | null;
  trainingDays: number; sessionMinutes: number; durationWeeks: number; constraints: string[];
}
export interface JourneyObservation extends JourneyFeatures {
  sessionsPrescribed: number; sessionsCompleted: number; nutritionAdherence: number | null;
  endingWeight: number | null; status: string;
}
export function journeySimilarity(a: JourneyFeatures, b: JourneyFeatures, config = FITNESS_SCORING): number {
  if (a.goal !== b.goal || a.experience !== b.experience) return 0;
  const normalized = (values: string[]) => [...values].map(v => v.trim().toLowerCase()).sort().join("|");
  if (normalized(a.constraints) !== normalized(b.constraints)) return 0;
  const values: Record<keyof typeof config.distance, number | null> = {
    weight: Math.min(1, Math.abs(a.baselineWeight - b.baselineWeight) / 30),
    frequency: Math.min(1, Math.abs(a.trainingDays - b.trainingDays) / 6),
    duration: Math.min(1, Math.abs(a.durationWeeks - b.durationWeeks) / Math.max(1, a.durationWeeks)),
    session: Math.min(1, Math.abs(a.sessionMinutes - b.sessionMinutes) / 90),
    bodyFat: a.baselineBodyFat === null || b.baselineBodyFat === null ? null : Math.min(1, Math.abs(a.baselineBodyFat - b.baselineBodyFat) / 20),
  };
  let sum = 0, denominator = 0;
  for (const key of Object.keys(values) as Array<keyof typeof values>) if (values[key] !== null) {
    sum += config.distance[key] * values[key]!; denominator += config.distance[key];
  }
  return Math.max(0, 1 - sum / denominator);
}
export function summarizeJourneys(rows: JourneyObservation[], origin: DataOrigin, config = FITNESS_SCORING): HistoricalSummary {
  const eligible = rows.filter(r => r.sessionsPrescribed > 0 && r.sessionsCompleted >= 0 && r.sessionsCompleted <= r.sessionsPrescribed && r.endingWeight !== null);
  const enough = eligible.length >= config.minimumCohort;
  return {
    count: enough ? eligible.length : 0,
    medianWeightChange: enough ? median(eligible.map(r => r.endingWeight! - r.baselineWeight)) : null,
    medianTrainingAdherence: enough ? median(eligible.map(r => r.sessionsCompleted / r.sessionsPrescribed)) : null,
    medianNutritionAdherence: enough ? median(eligible.flatMap(r => r.nutritionAdherence === null ? [] : [r.nutritionAdherence])) : null,
    medianDurationWeeks: enough ? median(eligible.map(r => r.durationWeeks)) : null,
    completionRate: enough ? eligible.filter(r => r.status === "COMPLETED").length / eligible.length : null,
    dataOrigin: origin, similarityVersion: config.similarityVersion,
    note: !enough ? "Not enough historical evidence." : origin === "SYNTHETIC"
      ? "Demo synthetic dataset; not evidence of real coaching effectiveness."
      : "Observed association among similar clients; not a causal effect or guaranteed result.",
  };
}
export function scorePT(candidate: PTCandidate, preferences: AgentPreferences, config = FITNESS_SCORING): CompatibilityScore {
  const aliases = GOAL_SPECIALTIES[preferences.goal ?? ""] ?? [];
  const days = preferences.days ?? [];
  const components: Record<string, number> = {
    goal: aliases.some(v => candidate.specialties.includes(v)) ? 1 : 0,
    schedule: days.length ? days.filter(d => candidate.availableDays.includes(d)).length / days.length : 0,
    budget: preferences.budgetVnd ? (candidate.packages.some(p => p.price <= preferences.budgetVnd!) ? 1 : 0) : 0,
    reputation: candidate.reviewCount >= 5 && candidate.averageRating !== null ? candidate.averageRating / 5 : 0,
  };
  // Cold-start fairness: a PT below `minimumCohort` doesn't have enough
  // observed journeys for `history.count` to mean anything — it is NOT
  // evidence of poor outcomes, just an absence of evidence. Scoring it as
  // 0 (the old behavior) silently treated every brand-new PT as if they
  // had the worst possible track record, worth the same as a PT with 20
  // genuinely bad journeys. Instead, drop the `evidence` dimension out of
  // both the numerator and the weight-normalizing denominator entirely
  // when there isn't enough cohort data to trust it, so a cold-start PT is
  // ranked on goal/schedule/budget/reputation only, not artificially
  // capped by a dimension that has nothing real to say yet.
  const hasEvidence = candidate.history.count >= config.minimumCohort;
  if (hasEvidence) {
    components.evidence = Math.min(1, candidate.history.count / config.maximumCohort);
  }
  const totalWeight = Object.keys(components)
    .reduce((sum, key) => sum + config.weights[key as keyof typeof config.weights], 0);
  const total = Object.entries(components).reduce((sum, [key, value]) => sum + value * config.weights[key as keyof typeof config.weights], 0);
  return { total: Math.round(100 * total / totalWeight), scoringVersion: config.version, components };
}

// Deterministic training-program ranking. This is intentionally conservative:
// fitness-service owns the hard filters (canonical exercises, equipment,
// injuries/safety, experience, days, goal and session-length feasibility).
// The scorer only orders already-eligible programs and never predicts outcomes.
export const PROGRAM_SCORING = {
  version: "program-compatibility-v1",
  weights: {
    goal: 25,
    experience: 20,
    schedule: 20,
    equipment: 15,
    sessionDuration: 10,
    focusMuscle: 5,
    durationWeeks: 5,
  },
} as const;

function normalizeToken(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function overlapRatio(candidateValues: string[], desiredValues: string[]): number | null {
  const desired = new Set(desiredValues.map(normalizeToken).filter(Boolean).filter(v => v !== "GENERAL"));
  if (!desired.size) return null;
  const candidate = new Set(candidateValues.map(normalizeToken).filter(Boolean));
  let overlap = 0;
  for (const value of desired) if (candidate.has(value)) overlap++;
  return overlap / desired.size;
}

function durationFit(estimatedMinutes: number, targetMinutes?: number): number | null {
  if (!targetMinutes || targetMinutes <= 0 || !Number.isFinite(estimatedMinutes)) return null;
  if (estimatedMinutes > targetMinutes) return 0;
  // Preference-fit heuristic: enough work to use the requested session, but
  // with a small buffer for warm-up/transitions. Very short programs stay
  // eligible, just rank lower when all hard constraints are otherwise equal.
  const target = targetMinutes * 0.85;
  const distance = Math.abs(estimatedMinutes - target) / Math.max(15, targetMinutes);
  return Math.max(0.6, Math.min(1, 1 - distance));
}

function weekFit(durationWeeks: number, requestedWeeks?: number): number | null {
  if (!requestedWeeks || requestedWeeks <= 0 || !Number.isFinite(durationWeeks)) return null;
  const distance = Math.abs(durationWeeks - requestedWeeks) / Math.max(1, requestedWeeks);
  return Math.max(0, Math.min(1, 1 - distance));
}

export function scoreTrainingProgram(
  program: TrainingProgramCandidate,
  preferences: AgentPreferences,
  opts: { userExperience?: string | null; goalIntentFocusMuscles?: string[] } = {},
  config = PROGRAM_SCORING,
): CompatibilityScore {
  const requestedDays = preferences.days?.length;
  const reasons: string[] = [];
  const components: Record<string, number> = {
    goal: preferences.goal ? (normalizeToken(program.goal) === normalizeToken(preferences.goal) ? 1 : 0) : 0,
    experience: opts.userExperience ? (normalizeToken(program.experienceLevel) === normalizeToken(opts.userExperience) ? 1 : 0) : 1,
    schedule: requestedDays ? (program.daysPerWeek === requestedDays ? 1 : Math.max(0, 1 - Math.abs(program.daysPerWeek - requestedDays) / 6)) : 0,
    equipment: 1,
  };
  if (components.goal >= 1) reasons.push("PROGRAM_GOAL_MATCH");
  if (components.experience >= 1) reasons.push("PROGRAM_EXPERIENCE_MATCH");
  if (components.schedule >= 1) reasons.push("PROGRAM_SCHEDULE_MATCH");
  else if (components.schedule > 0) reasons.push("PROGRAM_SCHEDULE_PARTIAL_MATCH");
  if (components.equipment >= 1) reasons.push("PROGRAM_EQUIPMENT_FULL_MATCH");
  const session = durationFit(program.estimatedMinutes, preferences.sessionMinutes);
  if (session !== null) {
    components.sessionDuration = session;
    reasons.push(session >= 0.9 ? "PROGRAM_SESSION_DURATION_STRONG_MATCH" : "PROGRAM_SESSION_DURATION_ACCEPTABLE");
  }
  const focus = overlapRatio(program.focusMuscles, opts.goalIntentFocusMuscles ?? []);
  if (focus !== null) {
    components.focusMuscle = focus;
    if (focus > 0) reasons.push("PROGRAM_FOCUS_MUSCLE_MATCH");
  }
  const weeks = weekFit(program.durationWeeks, preferences.durationWeeks);
  if (weeks !== null) {
    components.durationWeeks = weeks;
    if (weeks >= 1) reasons.push("PROGRAM_DURATION_WEEKS_MATCH");
    else if (weeks > 0) reasons.push("PROGRAM_DURATION_WEEKS_PARTIAL_MATCH");
  }

  const totalWeight = Object.keys(components)
    .reduce((sum, key) => sum + config.weights[key as keyof typeof config.weights], 0);
  const total = Object.entries(components)
    .reduce((sum, [key, value]) => sum + value * config.weights[key as keyof typeof config.weights], 0);
  return { total: Math.round(100 * total / totalWeight), scoringVersion: config.version, components, reasons };
}

// v1 (`scoreTrainingProgram`/`PROGRAM_SCORING` above) is kept byte-for-byte
// UNCHANGED — Codex's independent evaluator
// (backend/services/ai-service/src/evaluation/program-recommendation/
// evaluate_program_recommendation.ts) imports these two exact names
// directly and must keep seeing v1's real, documented behavior. v1 is not
// deleted or renamed; production has simply moved to v2 below.
//
// v2 — Codex Independent Evaluation #1
// (docs/codex-training-program-recommendation-evaluation-1.md, MEDIUM
// finding #2): v1 measured tie rate 0.87 across a 100-candidate matrix
// because `goal`/`experience`/`schedule`/`equipment` are already exact hard
// filters in `agent-program.service.ts::candidates()` — every candidate
// that reaches this scorer has ALREADY matched all four, so they are
// constant (always 1) for every real candidate and contribute 80/100 of
// v1's weight without ever differentiating anything. v2's `components` (the
// only thing that feeds `total`) contains ONLY dimensions that can actually
// vary among already-eligible candidates: sessionDuration, focusMuscle,
// durationWeeks — same as v1's own optional dimensions, same "excluded from
// the denominator when the input is absent" rule (a missing preference is
// never scored as 0). The four hard-filter dimensions are still computed
// and returned as `eligibilityReasons` (confirmatory facts for the Claim
// Catalog / explainability — see program_recommendation_claims.ts), just
// never weighted into `total`.
export const PROGRAM_SCORING_V2 = {
  version: "program-compatibility-v2",
  weights: { sessionDuration: 70, focusMuscle: 20, durationWeeks: 10 },
} as const;

export function scoreTrainingProgramV2(
  program: TrainingProgramCandidate,
  preferences: AgentPreferences,
  opts: { userExperience?: string | null; goalIntentFocusMuscles?: string[] } = {},
  config = PROGRAM_SCORING_V2,
): CompatibilityScore {
  const requestedDays = preferences.days?.length;

  // Eligibility facts — confirmatory only, deliberately never weighted.
  // These mirror exactly what agent-program.service.ts::candidates()
  // already hard-filtered on before this program could ever reach here;
  // recomputing them descriptively (rather than trusting "it must be true")
  // costs nothing and keeps the Claim Catalog's eligibility claims grounded
  // in the same real fields the ranking claims use, not asserted blindly.
  const eligibilityReasons: string[] = [];
  if (preferences.goal && normalizeToken(program.goal) === normalizeToken(preferences.goal)) eligibilityReasons.push("PROGRAM_GOAL_ELIGIBLE");
  if (!opts.userExperience || normalizeToken(program.experienceLevel) === normalizeToken(opts.userExperience)) eligibilityReasons.push("PROGRAM_EXPERIENCE_ELIGIBLE");
  if (requestedDays && program.daysPerWeek === requestedDays) eligibilityReasons.push("PROGRAM_SCHEDULE_ELIGIBLE");
  // Equipment has no per-candidate numeric fit here (it is a boolean hard
  // filter with REQUIRED/ALTERNATIVE/OPTIONAL semantics resolved entirely in
  // fitness-service — see equipment-availability.util.ts) — every candidate
  // reaching this function already passed it.
  eligibilityReasons.push("PROGRAM_EQUIPMENT_ELIGIBLE");

  const components: Record<string, number> = {};
  const rankingReasons: string[] = [];
  const session = durationFit(program.estimatedMinutes, preferences.sessionMinutes);
  if (session !== null) {
    components.sessionDuration = session;
    rankingReasons.push(session >= 0.9 ? "PROGRAM_SESSION_DURATION_STRONG_MATCH" : "PROGRAM_SESSION_DURATION_ACCEPTABLE");
  }
  const focus = overlapRatio(program.focusMuscles, opts.goalIntentFocusMuscles ?? []);
  if (focus !== null) {
    components.focusMuscle = focus;
    if (focus > 0) rankingReasons.push("PROGRAM_FOCUS_MUSCLE_MATCH");
  }
  const weeks = weekFit(program.durationWeeks, preferences.durationWeeks);
  if (weeks !== null) {
    components.durationWeeks = weeks;
    if (weeks >= 1) rankingReasons.push("PROGRAM_DURATION_WEEKS_MATCH");
    else if (weeks > 0) rankingReasons.push("PROGRAM_DURATION_WEEKS_PARTIAL_MATCH");
  }

  const signalCount = Object.keys(components).length;
  if (signalCount === 0) {
    // Every ranking dimension is absent (no sessionMinutes, no confirmed
    // focus muscles, no duration-weeks preference) — there is genuinely no
    // information left to differentiate eligible candidates on. Per this
    // pass's own instruction, manufacturing a fake 95-vs-94 split from
    // constant/absent data would be dishonest; every such candidate ties at
    // a fixed value (100 — "matches everything currently known/requested"),
    // `signalCount: 0` makes the tie self-documenting, and the caller's
    // existing stable `program.id` tie-break decides final order, exactly
    // as it already does for any other tie.
    return {
      total: 100, scoringVersion: config.version, components: {},
      reasons: [...eligibilityReasons, "PROGRAM_ZERO_RANKING_SIGNAL"],
      eligibilityReasons, signalCount: 0,
    };
  }

  const totalWeight = Object.keys(components)
    .reduce((sum, key) => sum + config.weights[key as keyof typeof config.weights], 0);
  const total = Object.entries(components)
    .reduce((sum, [key, value]) => sum + value * config.weights[key as keyof typeof config.weights], 0);
  return {
    total: Math.round(100 * total / totalWeight), scoringVersion: config.version, components,
    reasons: [...eligibilityReasons, ...rankingReasons], eligibilityReasons, signalCount,
  };
}
