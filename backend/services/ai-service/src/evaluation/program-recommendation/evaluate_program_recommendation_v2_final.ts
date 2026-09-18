import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  PROGRAM_SCORING,
  PROGRAM_SCORING_V2,
  scoreTrainingProgram,
  scoreTrainingProgramV2,
  type AgentPreferences,
  type TrainingProgramCandidate,
} from "@gym-coach/shared";
import {
  buildProgramClaimCatalog,
  renderProgramNarrationFromClaims,
} from "../../llm/program_recommendation_claims";

type CaseResult = { name: string; status: "PASS" | "FAIL"; detail?: string };

const prefs: AgentPreferences = {
  goal: "MUSCLE_GAIN",
  days: [1, 3, 5],
  sessionMinutes: 60,
  durationWeeks: 12,
  demo: false,
};

function program(id: string, overrides: Partial<TrainingProgramCandidate> = {}): TrainingProgramCandidate {
  return {
    id,
    name: `Codex V2 Final ${id}`,
    goal: "MUSCLE_GAIN",
    daysPerWeek: 3,
    durationWeeks: 12,
    estimatedMinutes: 51,
    experienceLevel: "BEGINNER",
    focusMuscles: ["CHEST", "BACK"],
    fingerprint: `fp-${id}`,
    dataOrigin: "REAL",
    days: [],
    ...overrides,
  };
}

function runCase(name: string, fn: () => void, cases: CaseResult[]) {
  try {
    fn();
    cases.push({ name, status: "PASS" });
  } catch (err) {
    cases.push({ name, status: "FAIL", detail: (err as Error).message });
  }
}

function valuesForDistribution() {
  const dataset = Array.from({ length: 100 }, (_, i) => program(`p-${i}`, {
    estimatedMinutes: 30 + (i % 31),
    durationWeeks: 6 + (i % 20),
    focusMuscles: i % 3 === 0 ? ["CHEST"] : i % 3 === 1 ? ["LEGS"] : ["CHEST", "BACK"],
  }));
  const v1 = dataset.map(p => scoreTrainingProgram(p, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }).total);
  const v2 = dataset.map(p => scoreTrainingProgramV2(p, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }).total);
  return {
    v1UniqueScores: new Set(v1).size,
    v2UniqueScores: new Set(v2).size,
    v1TieRate: Number((1 - new Set(v1).size / v1.length).toFixed(4)),
    v2TieRate: Number((1 - new Set(v2).size / v2.length).toFixed(4)),
  };
}

function main() {
  const cases: CaseResult[] = [];

  runCase("v2 scoring version is persisted as program-compatibility-v2", () => {
    assert.equal(scoreTrainingProgramV2(program("a"), prefs, {}).scoringVersion, PROGRAM_SCORING_V2.version);
  }, cases);

  runCase("hard-filter dimensions are not weighted components", () => {
    const components = scoreTrainingProgramV2(program("a"), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }).components;
    assert.deepEqual(Object.keys(components).sort(), ["durationWeeks", "focusMuscle", "sessionDuration"]);
  }, cases);

  runCase("eligibility facts remain available for explainability", () => {
    const reasons = scoreTrainingProgramV2(program("a"), prefs, { userExperience: "BEGINNER" }).eligibilityReasons ?? [];
    for (const reason of ["PROGRAM_GOAL_ELIGIBLE", "PROGRAM_EXPERIENCE_ELIGIBLE", "PROGRAM_SCHEDULE_ELIGIBLE", "PROGRAM_EQUIPMENT_ELIGIBLE"]) {
      assert.ok(reasons.includes(reason), reason);
    }
  }, cases);

  runCase("session target prefers 51 minutes over 60 when requested session is 60", () => {
    const strong = scoreTrainingProgramV2(program("strong", { estimatedMinutes: 51 }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    const weak = scoreTrainingProgramV2(program("weak", { estimatedMinutes: 60 }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    assert.ok(strong.total > weak.total, `${strong.total} <= ${weak.total}`);
  }, cases);

  runCase("session scoring is monotonic around the 85 percent target", () => {
    const near = scoreTrainingProgramV2(program("near", { estimatedMinutes: 50 }), prefs, {});
    const far = scoreTrainingProgramV2(program("far", { estimatedMinutes: 30 }), prefs, {});
    assert.ok(near.total > far.total, `${near.total} <= ${far.total}`);
  }, cases);

  runCase("focus full overlap beats partial overlap", () => {
    const full = scoreTrainingProgramV2(program("full", { focusMuscles: ["CHEST", "BACK"] }), prefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
    const partial = scoreTrainingProgramV2(program("partial", { focusMuscles: ["CHEST"] }), prefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
    assert.ok(full.total > partial.total, `${full.total} <= ${partial.total}`);
  }, cases);

  runCase("focus partial overlap beats zero overlap", () => {
    const partial = scoreTrainingProgramV2(program("partial", { focusMuscles: ["CHEST"] }), prefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
    const none = scoreTrainingProgramV2(program("none", { focusMuscles: ["LEGS"] }), prefs, { goalIntentFocusMuscles: ["CHEST", "BACK"] });
    assert.ok(partial.total > none.total, `${partial.total} <= ${none.total}`);
  }, cases);

  runCase("GENERAL is ignored as a non-specific focus token", () => {
    const score = scoreTrainingProgramV2(program("general"), prefs, { goalIntentFocusMuscles: ["GENERAL"] });
    assert.equal("focusMuscle" in score.components, false);
  }, cases);

  runCase("duration weeks exact match beats near match", () => {
    const exact = scoreTrainingProgramV2(program("exact", { durationWeeks: 12 }), prefs, {});
    const near = scoreTrainingProgramV2(program("near", { durationWeeks: 14 }), prefs, {});
    assert.ok(exact.total > near.total, `${exact.total} <= ${near.total}`);
  }, cases);

  runCase("duration weeks near match beats far match", () => {
    const near = scoreTrainingProgramV2(program("near", { durationWeeks: 14 }), prefs, {});
    const far = scoreTrainingProgramV2(program("far", { durationWeeks: 24 }), prefs, {});
    assert.ok(near.total > far.total, `${near.total} <= ${far.total}`);
  }, cases);

  runCase("missing focus preference excludes focus from denominator", () => {
    const score = scoreTrainingProgramV2(program("a"), prefs, { goalIntentFocusMuscles: [] });
    assert.equal("focusMuscle" in score.components, false);
  }, cases);

  runCase("missing durationWeeks preference excludes duration from denominator", () => {
    const score = scoreTrainingProgramV2(program("a"), { ...prefs, durationWeeks: undefined }, {});
    assert.equal("durationWeeks" in score.components, false);
  }, cases);

  runCase("missing sessionMinutes preference excludes session from denominator", () => {
    const score = scoreTrainingProgramV2(program("a"), { ...prefs, sessionMinutes: undefined }, {});
    assert.equal("sessionDuration" in score.components, false);
  }, cases);

  runCase("zero ranking signal ties at documented neutral value", () => {
    const score = scoreTrainingProgramV2(program("a"), { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }, { goalIntentFocusMuscles: [] });
    assert.equal(score.total, 100);
    assert.equal(score.signalCount, 0);
  }, cases);

  runCase("zero ranking signal is reproducible across candidates", () => {
    const a = scoreTrainingProgramV2(program("a"), { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }, { goalIntentFocusMuscles: [] });
    const b = scoreTrainingProgramV2(program("b", { estimatedMinutes: 30, durationWeeks: 24 }), { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }, { goalIntentFocusMuscles: [] });
    assert.equal(a.total, b.total);
    assert.equal(a.signalCount, b.signalCount);
  }, cases);

  runCase("session-only signal can produce a real ranking", () => {
    const localPrefs = { goal: "MUSCLE_GAIN" as const, days: [1, 3, 5], sessionMinutes: 60, demo: false };
    const a = scoreTrainingProgramV2(program("a", { estimatedMinutes: 51 }), localPrefs, { goalIntentFocusMuscles: [] });
    const b = scoreTrainingProgramV2(program("b", { estimatedMinutes: 60 }), localPrefs, { goalIntentFocusMuscles: [] });
    assert.ok(a.total > b.total, `${a.total} <= ${b.total}`);
  }, cases);

  runCase("focus-only signal can produce a real ranking", () => {
    const localPrefs = { goal: "MUSCLE_GAIN" as const, days: [1, 3, 5], demo: false };
    const a = scoreTrainingProgramV2(program("a", { focusMuscles: ["CHEST"] }), localPrefs, { goalIntentFocusMuscles: ["CHEST"] });
    const b = scoreTrainingProgramV2(program("b", { focusMuscles: ["LEGS"] }), localPrefs, { goalIntentFocusMuscles: ["CHEST"] });
    assert.ok(a.total > b.total, `${a.total} <= ${b.total}`);
  }, cases);

  runCase("duration-only signal can produce a real ranking", () => {
    const localPrefs = { goal: "MUSCLE_GAIN" as const, days: [1, 3, 5], durationWeeks: 12, demo: false };
    const a = scoreTrainingProgramV2(program("a", { durationWeeks: 12 }), localPrefs, { goalIntentFocusMuscles: [] });
    const b = scoreTrainingProgramV2(program("b", { durationWeeks: 24 }), localPrefs, { goalIntentFocusMuscles: [] });
    assert.ok(a.total > b.total, `${a.total} <= ${b.total}`);
  }, cases);

  runCase("session weight dominates a lower-priority focus conflict", () => {
    const a = scoreTrainingProgramV2(program("a", { estimatedMinutes: 51, focusMuscles: ["LEGS"] }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    const b = scoreTrainingProgramV2(program("b", { estimatedMinutes: 24, focusMuscles: ["CHEST"] }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    assert.ok(a.total > b.total, `${a.total} <= ${b.total}`);
  }, cases);

  runCase("identical input is deterministic", () => {
    const a = scoreTrainingProgramV2(program("a", { estimatedMinutes: 45 }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    const b = scoreTrainingProgramV2(program("a", { estimatedMinutes: 45 }), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    assert.deepEqual(a, b);
  }, cases);

  runCase("tie-breaking by id is stable outside the scorer", () => {
    const rows = ["b", "a"].map(id => ({ p: program(id), s: scoreTrainingProgramV2(program(id), prefs, { goalIntentFocusMuscles: ["CHEST"] }) }));
    rows.sort((x, y) => y.s.total - x.s.total || x.p.id.localeCompare(y.p.id));
    assert.equal(rows[0].p.id, "a");
  }, cases);

  runCase("v2 has more unique scores than v1 on the representative matrix", () => {
    const d = valuesForDistribution();
    assert.ok(d.v2UniqueScores > d.v1UniqueScores, `${d.v2UniqueScores} <= ${d.v1UniqueScores}`);
  }, cases);

  runCase("v2 tie rate is lower than v1 on the representative matrix", () => {
    const d = valuesForDistribution();
    assert.ok(d.v2TieRate < d.v1TieRate, `${d.v2TieRate} >= ${d.v1TieRate}`);
  }, cases);

  runCase("v2 produces a wider gap from the same real session signal than v1", () => {
    const strongV1 = scoreTrainingProgram(program("v1s", { estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
    const weakV1 = scoreTrainingProgram(program("v1w", { estimatedMinutes: 60 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
    const strongV2 = scoreTrainingProgramV2(program("v2s", { estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
    const weakV2 = scoreTrainingProgramV2(program("v2w", { estimatedMinutes: 60 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
    assert.ok(strongV2.total - weakV2.total > strongV1.total - weakV1.total);
  }, cases);

  runCase("program claim catalog always includes no-outcome-history disclosure", () => {
    const compatibility = scoreTrainingProgramV2(program("a"), prefs, { goalIntentFocusMuscles: ["CHEST"] });
    const catalog = buildProgramClaimCatalog({ program: program("a"), compatibility }, []);
    assert.ok(catalog.some(c => c.type === "NO_OUTCOME_HISTORY"));
  }, cases);

  runCase("zero-signal catalog includes mandatory zero-ranking disclosure", () => {
    const compatibility = scoreTrainingProgramV2(program("a"), { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }, { goalIntentFocusMuscles: [] });
    const catalog = buildProgramClaimCatalog({ program: program("a"), compatibility }, []);
    assert.ok(catalog.some(c => c.type === "ZERO_RANKING_SIGNAL"));
  }, cases);

  runCase("mandatory zero-ranking disclosure renders even if not selected", () => {
    const candidate = program("a");
    const compatibility = scoreTrainingProgramV2(candidate, { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }, { goalIntentFocusMuscles: [] });
    const catalog = buildProgramClaimCatalog({ program: candidate, compatibility }, []);
    const narration = renderProgramNarrationFromClaims(candidate.id, catalog, [`${candidate.id}::COMPATIBILITY`]);
    assert.ok(narration.uncertainty.length >= 2, `uncertainty=${JSON.stringify(narration.uncertainty)}`);
  }, cases);

  const failed = cases.filter(c => c.status === "FAIL");
  const report = {
    evaluator: "codex-training-program-recommendation-v2-final",
    generatedAt: new Date().toISOString(),
    scoringVersions: {
      retired: PROGRAM_SCORING.version,
      productionExpected: PROGRAM_SCORING_V2.version,
    },
    distributionCheck: valuesForDistribution(),
    summary: {
      totalCases: cases.length,
      passed: cases.length - failed.length,
      failed: failed.length,
    },
    cases,
  };

  const outputPath = join(
    process.cwd(),
    "backend/services/ai-service/src/evaluation/program-recommendation/results/program-recommendation-v2-final-signoff.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main();
