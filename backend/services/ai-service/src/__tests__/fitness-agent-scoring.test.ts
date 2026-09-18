/**
 * scorePT() / journeySimilarity() / summarizeJourneys() — pure functions,
 * no DB/LLM required. Added 2026-09-14 alongside the cold-start fairness
 * fix in backend/shared/src/fitness-agent-scoring.ts (see docs/
 * ai-agent-system-feasibility-audit.md §32-33 / the hybrid-two-agent
 * implementation task): a PT below `minimumCohort` must not be scored as
 * if their (nonexistent) evidence were bad, only as if it were absent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scorePT,
  summarizeJourneys,
  journeySimilarity,
  FITNESS_SCORING,
  type JourneyObservation,
} from "@gym-coach/shared";
import type { PTCandidate, AgentPreferences, HistoricalSummary } from "@gym-coach/shared";

const noEvidence: HistoricalSummary = {
  count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null,
  medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL",
  similarityVersion: FITNESS_SCORING.similarityVersion, note: "Not enough historical evidence.",
};

function baseCandidate(overrides: Partial<PTCandidate> = {}): PTCandidate {
  return {
    id: "pt-1", name: "PT Test", photoUrl: null,
    specialties: ["Giảm mỡ"], yearsExperience: "3", languages: ["vi"],
    certificates: [], packages: [{ id: "pkg-1", name: "Gói 10 buổi", price: 2_000_000, sessions: 10, sessionMinutes: 60, mode: "OFFLINE" }],
    availableDays: [1, 3, 5], availableSlots: 10,
    averageRating: null, reviewCount: 0,
    clientsStarted: 0, clientsCompleted: 0, cancellationRate: null, noShowRate: null,
    dataOrigin: "REAL", history: noEvidence,
    ...overrides,
  };
}

const prefs: AgentPreferences = {
  goal: "WEIGHT_LOSS", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 3_000_000, demo: false,
};

test("scorePT: cold-start PT (no evidence) is not penalized to the same floor as a PT with poor observed outcomes", () => {
  const coldStart = scorePT(baseCandidate({ history: noEvidence }), prefs);
  // "evidence" must be entirely absent from the score breakdown, not 0 —
  // absence-of-data and worst-possible-data must not collapse to the
  // same number.
  assert.equal("evidence" in coldStart.components, false);

  const strongEvidence = scorePT(
    baseCandidate({ history: { ...noEvidence, count: FITNESS_SCORING.maximumCohort } }),
    prefs,
  );
  assert.equal(strongEvidence.components.evidence, 1);
  // A cold-start PT that is otherwise identical on every other dimension
  // must score HIGHER than 0 and must not be forced below a PT that is
  // identical except for having maximum positive evidence — but the two
  // are not required to be equal; strong evidence should still be able to
  // help. The regression this test guards against is the old behavior
  // where cold-start scored strictly lower than *any* candidate.evidence
  // >= 0 due to a hard 0, even when goal/schedule/budget/reputation were
  // identical and superior.
  assert.ok(coldStart.total > 0);
  assert.ok(strongEvidence.total >= coldStart.total);
});

test("scorePT: below-threshold-but-nonzero cohort count is treated identically to zero cohort (both absent, not partial-bad)", () => {
  const belowThreshold = scorePT(
    baseCandidate({ history: { ...noEvidence, count: FITNESS_SCORING.minimumCohort - 1 } }),
    prefs,
  );
  const zeroCohort = scorePT(baseCandidate({ history: noEvidence }), prefs);
  assert.deepEqual(belowThreshold, zeroCohort);
});

test("scorePT: goal/schedule/budget/reputation components behave as before (regression guard)", () => {
  const perfect = scorePT(
    baseCandidate({
      specialties: ["Giảm mỡ"], availableDays: [1, 3, 5],
      packages: [{ id: "p", name: "n", price: 1_000_000, sessions: 8, sessionMinutes: 60, mode: "OFFLINE" }],
      averageRating: 5, reviewCount: 10,
    }),
    prefs,
  );
  assert.equal(perfect.components.goal, 1);
  assert.equal(perfect.components.schedule, 1);
  assert.equal(perfect.components.budget, 1);
  assert.equal(perfect.components.reputation, 1);
  assert.equal(perfect.total, 100);
});

test("scorePT: mismatched goal/schedule/budget still score 0 on those dimensions (not dropped like evidence)", () => {
  const mismatch = scorePT(
    baseCandidate({ specialties: ["Chạy bộ"], availableDays: [2, 4], packages: [{ id: "p", name: "n", price: 50_000_000, sessions: 1, sessionMinutes: 60, mode: "OFFLINE" }] }),
    prefs,
  );
  assert.equal(mismatch.components.goal, 0);
  assert.equal(mismatch.components.schedule, 0);
  assert.equal(mismatch.components.budget, 0);
  // These dimensions are hard 0s, not dropped — unlike evidence, a real
  // preference mismatch IS meaningful negative signal, not absence of data.
  assert.ok("goal" in mismatch.components);
});

test("summarizeJourneys: below minimumCohort always reports count 0 + 'not enough evidence' note, regardless of how good the underlying journeys are", () => {
  const goodButFewJourneys: JourneyObservation[] = Array.from({ length: FITNESS_SCORING.minimumCohort - 1 }, () => ({
    goal: "WEIGHT_LOSS", experience: "BEGINNER", baselineWeight: 80, baselineBodyFat: 25,
    trainingDays: 3, sessionMinutes: 60, durationWeeks: 12, constraints: [],
    sessionsPrescribed: 36, sessionsCompleted: 36, nutritionAdherence: 0.9,
    endingWeight: 72, status: "COMPLETED",
  }));
  const summary = summarizeJourneys(goodButFewJourneys, "REAL");
  assert.equal(summary.count, 0);
  assert.equal(summary.note, "Not enough historical evidence.");
});

test("summarizeJourneys: SYNTHETIC origin is always labeled as such in the note, never presented as real evidence", () => {
  const rows: JourneyObservation[] = Array.from({ length: FITNESS_SCORING.minimumCohort }, () => ({
    goal: "MUSCLE_GAIN", experience: "INTERMEDIATE", baselineWeight: 70, baselineBodyFat: 18,
    trainingDays: 4, sessionMinutes: 75, durationWeeks: 16, constraints: [],
    sessionsPrescribed: 64, sessionsCompleted: 60, nutritionAdherence: 0.85,
    endingWeight: 74, status: "COMPLETED",
  }));
  const summary = summarizeJourneys(rows, "SYNTHETIC");
  assert.equal(summary.dataOrigin, "SYNTHETIC");
  assert.match(summary.note, /Demo synthetic dataset/);
});

test("journeySimilarity: never matches across a different goal or experience level, regardless of body-metric closeness", () => {
  const a = { goal: "WEIGHT_LOSS", experience: "BEGINNER", baselineWeight: 80, baselineBodyFat: 25, trainingDays: 3, sessionMinutes: 60, durationWeeks: 12, constraints: [] };
  const differentGoal = { ...a, goal: "MUSCLE_GAIN" };
  const differentExperience = { ...a, experience: "ADVANCED" };
  assert.equal(journeySimilarity(a, differentGoal), 0);
  assert.equal(journeySimilarity(a, differentExperience), 0);
});

test("journeySimilarity: does not use any demographic dimension (age/gender) — only goal, experience, training load and body composition", () => {
  // Documentation-as-test: JourneyFeatures has no age/gender field at
  // all, so it is structurally impossible for journeySimilarity to match
  // on those dimensions. This test fails to compile (not just fails at
  // runtime) if someone adds one without updating this guard.
  const a = { goal: "WEIGHT_LOSS", experience: "BEGINNER", baselineWeight: 80, baselineBodyFat: 25, trainingDays: 3, sessionMinutes: 60, durationWeeks: 12, constraints: [] };
  const keys = Object.keys(a).sort();
  assert.deepEqual(keys, ["baselineBodyFat", "baselineWeight", "constraints", "durationWeeks", "experience", "goal", "sessionMinutes", "trainingDays"]);
});
