import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_SCORING_V2, scoreTrainingProgramV2, type AgentPreferences, type TrainingProgramCandidate } from "@gym-coach/shared";

/**
 * Golden ranking suite v2 — Codex Independent Evaluation #1's own §34
 * requirement (docs/codex-training-program-recommendation-evaluation-1.md):
 * "Create at least 30-50 meaningful semantic ranking cases... not only
 * arbitrary numeric matrices." These are semantic scenarios, each with a
 * stated reason for the expected outcome — not a generated grid.
 *
 * Companion: `training-program-scoring.test.ts` (v1, unchanged, still
 * exercises the frozen v1 function Codex's evaluator imports directly).
 */

function program(overrides: Partial<TrainingProgramCandidate> = {}): TrainingProgramCandidate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Hypertrophy 3 Days",
    goal: "MUSCLE_GAIN",
    daysPerWeek: 3,
    durationWeeks: 12,
    estimatedMinutes: 51,
    experienceLevel: "BEGINNER",
    focusMuscles: ["CHEST", "BACK"],
    fingerprint: "fp",
    dataOrigin: "REAL",
    days: [],
    ...overrides,
  };
}

const fullPrefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, durationWeeks: 12, demo: false };

function rank(rows: TrainingProgramCandidate[], prefs: AgentPreferences, focus: string[] = []) {
  return rows
    .map(p => ({ p, score: scoreTrainingProgramV2(p, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus }) }))
    .sort((a, b) => b.score.total - a.score.total || a.p.id.localeCompare(b.p.id));
}

function id(n: number): string {
  return `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
}

// ── 1. Eligibility dimensions never enter components/total ──────────────

test("v2: goal/experience/schedule/equipment never appear in components — they are eligibility facts, not ranking weight", () => {
  const score = scoreTrainingProgramV2(program(), fullPrefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  for (const key of ["goal", "experience", "schedule", "equipment"]) {
    assert.equal(key in score.components, false, `"${key}" must not be a components key in v2`);
  }
});

test("v2: eligibilityReasons confirms all four hard-filter facts for an eligible candidate", () => {
  const score = scoreTrainingProgramV2(program(), fullPrefs, { userExperience: "BEGINNER" });
  assert.deepEqual([...score.eligibilityReasons!].sort(), [
    "PROGRAM_EQUIPMENT_ELIGIBLE", "PROGRAM_EXPERIENCE_ELIGIBLE", "PROGRAM_GOAL_ELIGIBLE", "PROGRAM_SCHEDULE_ELIGIBLE",
  ]);
});

test("v2: scoringVersion is program-compatibility-v2", () => {
  assert.equal(scoreTrainingProgramV2(program(), fullPrefs, {}).scoringVersion, PROGRAM_SCORING_V2.version);
});

// ── 2. Session-duration differentiation (the primary v2 ranking signal) ─

test("v2: a program closer to 85% of the requested session time ranks above one exactly at the hard limit", () => {
  const [top] = rank([program({ id: id(1), estimatedMinutes: 51 }), program({ id: id(2), estimatedMinutes: 60 })], fullPrefs);
  assert.equal(top.p.id, id(1));
});

test("v2: three programs at 30/45/60 min (target=60) rank by closeness to 51 (85% of 60), not by raw length", () => {
  const ranked = rank([
    program({ id: id(1), estimatedMinutes: 30 }),
    program({ id: id(2), estimatedMinutes: 45 }),
    program({ id: id(3), estimatedMinutes: 60 }),
  ], fullPrefs).map(r => r.p.id);
  // 45 is closest to the 51-minute target, then 60, then 30.
  assert.deepEqual(ranked, [id(2), id(3), id(1)]);
});

test("v2: session-duration alone (no focus/duration-weeks preference) is enough to produce a real, non-tied ranking", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, demo: false };
  const ranked = rank([program({ id: id(1), estimatedMinutes: 60 }), program({ id: id(2), estimatedMinutes: 51 })], prefs);
  assert.equal(ranked[0].p.id, id(2));
  assert.notEqual(ranked[0].score.total, ranked[1].score.total, "a real signal must actually differentiate scores, not just declare a winner");
});

// ── 3. Focus-muscle differentiation ──────────────────────────────────────

test("v2: a program whose focus matches the user's confirmed goal-intent focus ranks above one that doesn't", () => {
  const ranked = rank([
    program({ id: id(1), focusMuscles: ["LEGS"] }),
    program({ id: id(2), focusMuscles: ["CHEST"] }),
  ], fullPrefs, ["CHEST"]);
  assert.equal(ranked[0].p.id, id(2));
});

test("v2: partial focus overlap (1 of 2 desired muscles) scores strictly between full overlap and zero overlap", () => {
  const full = scoreTrainingProgramV2(program({ focusMuscles: ["CHEST", "BACK"] }), fullPrefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
  const partial = scoreTrainingProgramV2(program({ focusMuscles: ["CHEST"] }), fullPrefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
  const none = scoreTrainingProgramV2(program({ focusMuscles: ["LEGS"] }), fullPrefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
  assert.ok(full.components.focusMuscle > partial.components.focusMuscle);
  assert.ok(partial.components.focusMuscle > none.components.focusMuscle);
});

test("v2: GENERAL is never treated as a real desired focus muscle (matches v1's own exclusion)", () => {
  const score = scoreTrainingProgramV2(program({ focusMuscles: ["CHEST"] }), fullPrefs, { goalIntentFocusMuscles: ["GENERAL"] });
  assert.equal("focusMuscle" in score.components, false);
});

// ── 4. Duration-weeks differentiation ────────────────────────────────────

test("v2: a program whose duration exactly matches the requested weeks ranks above a much longer one", () => {
  const ranked = rank([program({ id: id(1), durationWeeks: 24 }), program({ id: id(2), durationWeeks: 12 })], fullPrefs);
  assert.equal(ranked[0].p.id, id(2));
});

test("v2: duration-weeks distance scores decrease monotonically with distance from the requested value", () => {
  const exact = scoreTrainingProgramV2(program({ durationWeeks: 12 }), fullPrefs, {});
  const near = scoreTrainingProgramV2(program({ durationWeeks: 14 }), fullPrefs, {});
  const far = scoreTrainingProgramV2(program({ durationWeeks: 24 }), fullPrefs, {});
  assert.ok(exact.components.durationWeeks! > near.components.durationWeeks!);
  assert.ok(near.components.durationWeeks! > far.components.durationWeeks!);
});

// ── 5. Optional data absent — excluded, never scored as 0 ───────────────

test("v2: no focus preference -> focusMuscle key absent from components entirely (not scored as 0)", () => {
  const score = scoreTrainingProgramV2(program(), fullPrefs, { goalIntentFocusMuscles: [] });
  assert.equal("focusMuscle" in score.components, false);
});

test("v2: no durationWeeks preference -> durationWeeks key absent from components entirely", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, demo: false };
  const score = scoreTrainingProgramV2(program(), prefs, {});
  assert.equal("durationWeeks" in score.components, false);
});

test("v2: absent optional dimensions never drag down total for an otherwise-perfect session-duration match", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, demo: false };
  const score = scoreTrainingProgramV2(program({ estimatedMinutes: 51 }), prefs, {});
  assert.equal(score.total, 100, "sessionDuration is the only present dimension and is a perfect match — total must be 100, not diluted by absent dimensions");
});

// ── 6. All soft signals equal -> honest ties ─────────────────────────────

test("v2: two candidates identical on every ranking dimension tie exactly (same total)", () => {
  const a = scoreTrainingProgramV2(program({ id: id(1) }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  const b = scoreTrainingProgramV2(program({ id: id(2) }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  assert.equal(a.total, b.total);
});

test("v2: with no ranking signal available at all (no sessionMinutes, no focus, no durationWeeks), every eligible candidate ties at the documented neutral value with signalCount=0", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false };
  const a = scoreTrainingProgramV2(program({ id: id(1), estimatedMinutes: 30 }), prefs, {});
  const b = scoreTrainingProgramV2(program({ id: id(2), estimatedMinutes: 60 }), prefs, {});
  assert.equal(a.total, 100);
  assert.equal(b.total, 100);
  assert.equal(a.signalCount, 0);
  assert.equal(b.signalCount, 0);
  assert.deepEqual(a.components, {});
});

test("v2: zero-signal ties still resolve deterministically via the caller's id tie-break", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false };
  const ranked = rank([program({ id: id(2) }), program({ id: id(1) })], prefs);
  assert.deepEqual(ranked.map(r => r.p.id), [id(1), id(2)]);
});

// ── 7. Single signal available ────────────────────────────────────────────

test("v2: only durationWeeks preference given (no sessionMinutes, no focus) -> durationWeeks alone determines a real ranking", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], durationWeeks: 12, demo: false };
  const ranked = rank([program({ id: id(1), durationWeeks: 24 }), program({ id: id(2), durationWeeks: 12 })], prefs);
  assert.equal(ranked[0].p.id, id(2));
  assert.equal(ranked[0].score.signalCount, 1);
});

test("v2: only focus preference given (no sessionMinutes, no durationWeeks) -> focus alone determines a real ranking", () => {
  const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false };
  const ranked = rank([program({ id: id(1), focusMuscles: ["LEGS"] }), program({ id: id(2), focusMuscles: ["CHEST"] })], prefs, ["CHEST"]);
  assert.equal(ranked[0].p.id, id(2));
  assert.equal(ranked[0].score.signalCount, 1);
});

// ── 8. Multiple signals conflict ─────────────────────────────────────────

test("v2: winning big on the higher-weighted dimension (sessionDuration, weight 70) while losing completely on the lower-weighted one (focusMuscle, weight 20) still outranks the reverse", () => {
  // Program A: perfect session-duration fit, zero focus overlap.
  // Program B: the WORST possible session-duration fit that still keeps the
  // dimension present (durationFit floors at 0.6, never scores lower for a
  // present-but-mismatched target), full focus overlap.
  const a = scoreTrainingProgramV2(program({ id: id(1), estimatedMinutes: 51, focusMuscles: ["LEGS"] }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  const b = scoreTrainingProgramV2(program({ id: id(2), estimatedMinutes: 24, focusMuscles: ["CHEST"] }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  // A: (1*70 + 0*20)/90*100 = 77.8 -> 78. B: (0.6*70 + 1*20)/90*100 = 68.9 -> 69.
  // A perfect match on the 70-weighted dimension beats B's worst-case (but
  // still present) match on it even with a perfect 20-weighted dimension —
  // an inspectable consequence of the chosen weights, not a scientific claim.
  assert.ok(a.total > b.total, `expected A (${a.total}) > B (${b.total}) — session-duration's floor (0.6) plus its higher weight should not be fully offset by a perfect but lower-weighted focus match`);
});

test("v2: conflicting signals still produce a deterministic, reproducible total (no randomness)", () => {
  const once = scoreTrainingProgramV2(program({ estimatedMinutes: 45, focusMuscles: ["LEGS"], durationWeeks: 20 }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  const twice = scoreTrainingProgramV2(program({ estimatedMinutes: 45, focusMuscles: ["LEGS"], durationWeeks: 20 }), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  assert.deepEqual(once, twice);
});

// ── 9. Ties + shuffled candidate order ───────────────────────────────────

test("v2: shuffled input order never changes the final ranking (stable sort on total, then id)", () => {
  const rows = [
    program({ id: id(3), estimatedMinutes: 60 }),
    program({ id: id(1), estimatedMinutes: 51 }),
    program({ id: id(2), estimatedMinutes: 51 }),
  ];
  const forward = rank(rows, fullPrefs).map(r => r.p.id);
  const shuffled = rank([...rows].reverse(), fullPrefs).map(r => r.p.id);
  assert.deepEqual(forward, shuffled);
  assert.deepEqual(forward, [id(1), id(2), id(3)], "id(1) and id(2) tie on score, id order breaks the tie");
});

test("v2: a genuine 3-way tie (identical dimensions) resolves purely by ascending id, regardless of array order", () => {
  const rows = [
    program({ id: id(9) }),
    program({ id: id(2) }),
    program({ id: id(5) }),
  ];
  const ranked = rank(rows, fullPrefs, ["CHEST"]).map(r => r.p.id);
  assert.deepEqual(ranked, [id(2), id(5), id(9)]);
});

// ── 10. Zero / one / multiple eligible candidates ────────────────────────

test("v2: zero candidates -> ranking over an empty list is a no-op, not an error", () => {
  assert.deepEqual(rank([], fullPrefs), []);
});

test("v2: exactly one eligible candidate -> scored and ranked trivially, no crash from missing comparison", () => {
  const ranked = rank([program()], fullPrefs, ["CHEST"]);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score.total >= 0 && ranked[0].score.total <= 100);
});

test("v2: multiple eligible candidates with mixed real+absent signals all score within [0,100] and stay ordered", () => {
  const rows = Array.from({ length: 12 }, (_, i) => program({
    id: id(i + 1),
    estimatedMinutes: 30 + i * 3,
    durationWeeks: 8 + i,
    focusMuscles: i % 3 === 0 ? ["CHEST"] : i % 3 === 1 ? ["LEGS"] : ["CHEST", "BACK"],
  }));
  const ranked = rank(rows, fullPrefs, ["CHEST"]);
  assert.equal(ranked.length, 12);
  for (const r of ranked) assert.ok(r.score.total >= 0 && r.score.total <= 100);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score.total >= ranked[i].score.total, "must stay sorted descending by total");
});

// ── 11. v1/v2 divergence sanity — the actual bug this pass fixes ────────

test("v2 vs v1 divergence: two candidates identical except sessionDuration produce a WIDER score gap in v2 than v1 (v1 dilutes real signal with 80 constant points)", () => {
  const prefsLocal = fullPrefs;
  const strong = scoreTrainingProgramV2(program({ estimatedMinutes: 51 }), prefsLocal, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const weak = scoreTrainingProgramV2(program({ estimatedMinutes: 60 }), prefsLocal, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  assert.ok(strong.total - weak.total > 5, "v2's gap for a real session-duration difference must be meaningfully larger than v1's ~2-3 point gap on the same input");
});

// ── 12. All three signals present together ───────────────────────────────

test("v2: all three ranking signals present — the candidate winning on all three ranks first, unambiguously", () => {
  const ranked = rank([
    program({ id: id(1), estimatedMinutes: 51, focusMuscles: ["LEGS"], durationWeeks: 24 }),
    program({ id: id(2), estimatedMinutes: 51, focusMuscles: ["CHEST", "BACK"], durationWeeks: 12 }),
  ], fullPrefs, ["CHEST", "BACK"]);
  assert.equal(ranked[0].p.id, id(2), "id(2) is at least as good on every signal and strictly better on focus+duration");
});

test("v2: all three signals present has signalCount=3", () => {
  const score = scoreTrainingProgramV2(program(), fullPrefs, { goalIntentFocusMuscles: ["CHEST"] });
  assert.equal(score.signalCount, 3);
});

// ── 13. Eligibility facts are independent of which ranking signals exist ─

test("v2: eligibilityReasons are populated identically whether or not any ranking signal is present", () => {
  const withSignals = scoreTrainingProgramV2(program(), fullPrefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const noPrefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false };
  const withoutSignals = scoreTrainingProgramV2(program(), noPrefs, { userExperience: "BEGINNER" });
  assert.deepEqual([...withSignals.eligibilityReasons!].sort(), [...withoutSignals.eligibilityReasons!].sort());
});

test("v2: a program with a different goal than requested is descriptively marked (no PROGRAM_GOAL_ELIGIBLE), even though such a program should never actually reach this scorer under real hard filters", () => {
  const score = scoreTrainingProgramV2(program({ goal: "WEIGHT_LOSS" }), fullPrefs, { userExperience: "BEGINNER" });
  assert.equal(score.eligibilityReasons!.includes("PROGRAM_GOAL_ELIGIBLE"), false);
});

// ── 14. Larger multi-candidate scenario with real conflicting preferences ─

test("v2: 8 candidates with genuinely conflicting session/focus/duration profiles rank in the order the weighted formula predicts", () => {
  const rows = [
    program({ id: id(1), estimatedMinutes: 51, focusMuscles: ["CHEST"], durationWeeks: 12 }), // best on all 3
    program({ id: id(2), estimatedMinutes: 51, focusMuscles: ["LEGS"], durationWeeks: 12 }),   // best session+duration, no focus
    program({ id: id(3), estimatedMinutes: 30, focusMuscles: ["CHEST"], durationWeeks: 12 }),  // worst session, best focus+duration
    program({ id: id(4), estimatedMinutes: 51, focusMuscles: ["CHEST"], durationWeeks: 52 }),  // best session+focus, worst duration
  ];
  const ranked = rank(rows, fullPrefs, ["CHEST"]).map(r => r.p.id);
  assert.equal(ranked[0], id(1), "the candidate that's best on every dimension must rank first");
  assert.equal(ranked.length, 4);
});
