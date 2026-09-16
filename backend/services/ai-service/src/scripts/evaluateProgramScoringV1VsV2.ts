/**
 * v1-vs-v2 score-distribution comparison — Codex Independent Evaluation #1's
 * §35/§36 requirement (docs/codex-training-program-recommendation-evaluation-1.md):
 * reproduce the same diagnostics (distribution, tie rate, component
 * variance, ablation) for v2 and compare against v1's own numbers.
 *
 * This is a NEW file, owned by this pass — Codex's own evaluator
 * (backend/services/ai-service/src/evaluation/program-recommendation/
 * evaluate_program_recommendation.ts) is never modified; it keeps measuring
 * v1 exactly as it always has. This script measures v1 AND v2 side by side
 * using the exact same representative 100-case dataset shape Codex's
 * evaluator uses, so the two reports are genuinely comparable.
 *
 * Goal (this task's own §35): NOT "make scores more spread out at any
 * cost" — it is "make differences correspond to actual varying user
 * preferences." A lower tie rate is only meaningful if it comes from real
 * signal, not from injecting noise; the divergence check below asserts a
 * real signal actually produces a wider gap in v2, not merely that v2's
 * distribution looks different.
 *
 * Run: npx tsx src/scripts/evaluateProgramScoringV1VsV2.ts
 */
import {
  PROGRAM_SCORING, PROGRAM_SCORING_V2, scoreTrainingProgram, scoreTrainingProgramV2,
  type TrainingProgramCandidate,
} from "@gym-coach/shared";

const prefs = { goal: "MUSCLE_GAIN" as const, days: [1, 3, 5], sessionMinutes: 60, durationWeeks: 12, demo: false };

function program(i: number, overrides: Partial<TrainingProgramCandidate> = {}): TrainingProgramCandidate {
  return {
    id: `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    name: `Program ${i}`, goal: "MUSCLE_GAIN", daysPerWeek: 3, durationWeeks: 12, estimatedMinutes: 51,
    experienceLevel: "BEGINNER", focusMuscles: ["CHEST", "BACK"], fingerprint: `fp-${i}`, dataOrigin: "REAL", days: [],
    ...overrides,
  };
}

// Identical shape to Codex's own evaluate_program_recommendation.ts
// buildDataset() — same representative post-filter matrix, so v1/v2 numbers
// below are directly comparable to Codex's own Evaluation #1 report.
function buildDataset(): TrainingProgramCandidate[] {
  return Array.from({ length: 100 }, (_, i) => program(i + 1, {
    estimatedMinutes: 30 + (i % 31),
    durationWeeks: 6 + (i % 20),
    focusMuscles: i % 3 === 0 ? ["CHEST"] : i % 3 === 1 ? ["LEGS"] : ["CHEST", "BACK"],
  }));
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}
function percentile(values: number[], pct: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx];
}
function distribution(values: number[]) {
  const unique = new Set(values);
  return {
    min: Math.min(...values), p25: percentile(values, 0.25), median: percentile(values, 0.5),
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
    p75: percentile(values, 0.75), max: Math.max(...values),
    tieRate: Number((1 - unique.size / values.length).toFixed(4)), uniqueScores: unique.size,
  };
}
function componentVariance(rows: { components: Record<string, number> }[]) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.components)))].sort();
  return Object.fromEntries(keys.map(key => {
    const values = rows.map(r => r.components[key]).filter(v => v !== undefined);
    return [key, Number(variance(values).toFixed(6))];
  }));
}

function main() {
  const dataset = buildDataset();
  const focus = ["CHEST"];

  const v1 = dataset.map(p => scoreTrainingProgram(p, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus }));
  const v2 = dataset.map(p => scoreTrainingProgramV2(p, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus }));

  const v1Values = v1.map(s => s.total);
  const v2Values = v2.map(s => s.total);

  // Divergence sanity: this is NOT "v2 has a lower tie rate" alone (that
  // could come from noise) — it is "the same real signal (sessionDuration)
  // produces a strictly wider gap in v2 than v1 on the identical input,"
  // proving the removed constant dimensions were genuinely diluting signal
  // rather than v2 having simply added arbitrary variance.
  const strongV1 = scoreTrainingProgram(program(9001, { estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus });
  const weakV1 = scoreTrainingProgram(program(9002, { estimatedMinutes: 60 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus });
  const strongV2 = scoreTrainingProgramV2(program(9001, { estimatedMinutes: 51 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus });
  const weakV2 = scoreTrainingProgramV2(program(9002, { estimatedMinutes: 60 }), prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus });

  const report = {
    v1: {
      scoringVersion: PROGRAM_SCORING.version,
      distribution: distribution(v1Values),
      componentVariance: componentVariance(v1),
    },
    v2: {
      scoringVersion: PROGRAM_SCORING_V2.version,
      distribution: distribution(v2Values),
      componentVariance: componentVariance(v2),
      signalCountDistribution: v2.reduce<Record<number, number>>((acc, s) => {
        const k = s.signalCount ?? -1;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    },
    realSignalDivergenceCheck: {
      description: "Same real sessionDuration difference (51 vs 60 min, target 60) — gap must be meaningfully wider in v2 than v1, proving removed constant dimensions were diluting real signal.",
      v1Gap: strongV1.total - weakV1.total,
      v2Gap: strongV2.total - weakV2.total,
      v2GapWiderThanV1: strongV2.total - weakV2.total > strongV1.total - weakV1.total,
    },
    interpretation: [
      "Goal is NOT to make scores more spread out at any cost — a tie between genuinely equal programs is correct.",
      "v1's 0.87 tie rate came from 4 constant dimensions (goal/experience/schedule/equipment) contributing 80/100 of every eligible candidate's score identically.",
      "v2 removes those 4 from components/total entirely (they remain as eligibilityReasons, never weighted) — the reported v2 tie rate should be lower ONLY because the real varying dimensions (sessionDuration/focusMuscle/durationWeeks) now determine the full score, not because arbitrary noise was added.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
