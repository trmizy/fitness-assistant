import { median, type AgentPreferences, type HistoricalSummary, type DataOrigin, type PTCandidate, type CompatibilityScore } from "./fitness-agent";

// Product heuristics, not a calibrated prediction or scientific effect estimate.
export const FITNESS_SCORING = {
  version: "compatibility-v1", similarityVersion: "journey-distance-v1",
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
  const components = {
    goal: aliases.some(v => candidate.specialties.includes(v)) ? 1 : 0,
    schedule: days.length ? days.filter(d => candidate.availableDays.includes(d)).length / days.length : 0,
    budget: preferences.budgetVnd ? (candidate.packages.some(p => p.price <= preferences.budgetVnd!) ? 1 : 0) : 0,
    reputation: candidate.reviewCount >= 5 && candidate.averageRating !== null ? candidate.averageRating / 5 : 0,
    evidence: candidate.history.count >= config.minimumCohort ? Math.min(1, candidate.history.count / config.maximumCohort) : 0,
  };
  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);
  const total = Object.entries(components).reduce((sum, [key, value]) => sum + value * config.weights[key as keyof typeof config.weights], 0);
  return { total: Math.round(100 * total / totalWeight), scoringVersion: config.version, components };
}
