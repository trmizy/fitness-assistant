import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PROGRAM_SCORING,
  scoreTrainingProgram,
  type AgentEvidence,
  type AgentPreferences,
  type TrainingProgramCandidate,
} from "@gym-coach/shared";
import {
  buildDefaultProgramSelection,
  buildProgramClaimCatalog,
  renderProgramNarrationFromClaims,
} from "../../llm/program_recommendation_claims";

type Scored = { program: TrainingProgramCandidate; score: ReturnType<typeof scoreTrainingProgram> };
type Report = Record<string, unknown>;

const prefs: AgentPreferences = {
  goal: "MUSCLE_GAIN",
  days: [1, 3, 5],
  sessionMinutes: 60,
  durationWeeks: 12,
  demo: false,
};

const evidence: AgentEvidence[] = [{
  id: "ev-acsm",
  title: "ACSM progression model",
  sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/19204579/",
  finding: "Resistance training frequency and progression should be matched to training status and progressed over time.",
  evidenceLevel: "guideline",
  version: "v1",
}];

function program(i: number, overrides: Partial<TrainingProgramCandidate> = {}): TrainingProgramCandidate {
  return {
    id: `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    name: `Program ${i}`,
    goal: "MUSCLE_GAIN",
    daysPerWeek: 3,
    durationWeeks: 12,
    estimatedMinutes: 51,
    experienceLevel: "BEGINNER",
    focusMuscles: ["CHEST", "BACK"],
    fingerprint: `fp-${i}`,
    dataOrigin: "REAL",
    days: [],
    ...overrides,
  };
}

function rank(rows: TrainingProgramCandidate[], p = prefs, focus: string[] = ["CHEST"]): Scored[] {
  return rows
    .map(program => ({ program, score: scoreTrainingProgram(program, p, { userExperience: "BEGINNER", goalIntentFocusMuscles: focus }) }))
    .sort((a, b) => b.score.total - a.score.total || a.program.id.localeCompare(b.program.id));
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function percentile(values: number[], pct: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[index];
}

function componentStats(rows: Scored[]) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.score.components)))].sort();
  return Object.fromEntries(keys.map(key => {
    const values = rows.map(r => r.score.components[key]).filter(v => v !== undefined);
    return [key, {
      variance: Number(variance(values).toFixed(6)),
      allOneRate: values.filter(v => v === 1).length / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    }];
  }));
}

function scoreDistribution(rows: Scored[]) {
  const values = rows.map(r => r.score.total);
  const unique = new Set(values);
  return {
    min: Math.min(...values),
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
    p75: percentile(values, 0.75),
    max: Math.max(...values),
    tieRate: Number((1 - unique.size / values.length).toFixed(4)),
    uniqueScores: unique.size,
  };
}

function ablation(rows: TrainingProgramCandidate[]) {
  const base = rank(rows).map(r => r.program.id).join("|");
  return Object.fromEntries(Object.keys(PROGRAM_SCORING.weights).map(key => {
    const modified = {
      ...PROGRAM_SCORING,
      weights: { ...PROGRAM_SCORING.weights, [key]: 0 },
    };
    const ids = rows
      .map(program => ({ program, score: scoreTrainingProgram(program, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] }, modified as typeof PROGRAM_SCORING) }))
      .sort((a, b) => b.score.total - a.score.total || a.program.id.localeCompare(b.program.id))
      .map(r => r.program.id)
      .join("|");
    return [key, { changesOrder: ids !== base, top1Changed: ids.split("|")[0] !== base.split("|")[0] }];
  }));
}

function currentEquipmentPredicate(links: Array<{ equipmentId: string; requirementType: string }>, userEquipment: Set<string>, typeOfEquipment = "BODYWEIGHT"): boolean {
  return links.length ? !links.some(link => !userEquipment.has(link.equipmentId)) : typeOfEquipment === "BODYWEIGHT";
}

function buildDataset(): TrainingProgramCandidate[] {
  return Array.from({ length: 100 }, (_, i) => program(i + 1, {
    estimatedMinutes: 30 + (i % 31),
    durationWeeks: 6 + (i % 20),
    focusMuscles: i % 3 === 0 ? ["CHEST"] : i % 3 === 1 ? ["LEGS"] : ["CHEST", "BACK"],
  }));
}

function assertGoldenScenarios() {
  assert.equal(rank([program(1, { focusMuscles: ["CHEST"] }), program(2, { focusMuscles: ["LEGS"] })])[0].program.id, program(1).id);
  const noFocus = rank([program(2, { focusMuscles: ["LEGS"] }), program(1, { focusMuscles: ["CHEST"] })], prefs, []);
  assert.equal(noFocus[0].program.id, program(1).id, "without focus preference, tie should fall to id order");
  assert.equal(rank([program(1, { estimatedMinutes: 51 }), program(2, { estimatedMinutes: 60 })])[0].program.id, program(1).id);
  assert.equal(rank([program(1, { durationWeeks: 12 }), program(2, { durationWeeks: 24 })])[0].program.id, program(1).id);
  const noDurationPref = rank([program(2, { durationWeeks: 24 }), program(1, { durationWeeks: 12 })], { ...prefs, durationWeeks: undefined }, ["CHEST"]);
  assert.equal(noDurationPref[0].program.id, program(1).id, "without duration preference, tie should fall to id order");
}

function assertClaimSecurity() {
  const scored = rank([program(1)])[0];
  const catalog = buildProgramClaimCatalog({ program: scored.program, compatibility: scored.score }, evidence);
  const omitted = renderProgramNarrationFromClaims(scored.program.id, catalog, [`${scored.program.id}::COMPATIBILITY`]);
  assert.ok(omitted.uncertainty.some(text => text.includes("không phải")), "NO_OUTCOME_HISTORY must remain mandatory even when not selected");
  const injected = renderProgramNarrationFromClaims(scored.program.id, catalog, [
    "other::GOAL",
    `${scored.program.id}::FAKE`,
    `${scored.program.id}::EVIDENCE:fake`,
  ]);
  assert.equal(injected.evidenceRefs.length, 0);
  assert.equal(injected.strengths.some(text => /guarantee|đảm bảo|steroid|rẻ nhất/i.test(text)), false);
  const fallback = renderProgramNarrationFromClaims(scored.program.id, catalog, buildDefaultProgramSelection(catalog));
  assert.ok(fallback.strengths.length > 0);
}

function main() {
  const dataset = buildDataset();
  const scored = rank(dataset);
  assertGoldenScenarios();
  assertClaimSecurity();
  const equipmentCases = {
    requiredMissingEligible: currentEquipmentPredicate([{ equipmentId: "barbell", requirementType: "REQUIRED" }], new Set(["dumbbell"])),
    optionalMissingEligible: currentEquipmentPredicate([{ equipmentId: "band", requirementType: "OPTIONAL" }], new Set()),
    alternativeOnePresentEligible: currentEquipmentPredicate([
      { equipmentId: "barbell", requirementType: "ALTERNATIVE" },
      { equipmentId: "dumbbell", requirementType: "ALTERNATIVE" },
    ], new Set(["dumbbell"])),
  };
  const report: Report = {
    scoringVersion: PROGRAM_SCORING.version,
    totalCases: dataset.length,
    distribution: scoreDistribution(scored),
    componentStats: componentStats(scored),
    ablation: ablation(dataset),
    top5: scored.slice(0, 5).map(r => ({ id: r.program.id, total: r.score.total, components: r.score.components, reasons: r.score.reasons })),
    goldenScenarios: { total: 5, pass: 5, fail: 0 },
    claimSecurity: { total: 4, pass: 4, fail: 0 },
    equipmentSemanticsObservedFromCurrentPredicate: equipmentCases,
    findingHints: [
      "goal/experience/schedule/equipment are constant after current fitness-service hard filters",
      "sessionDuration, focusMuscle, and durationWeeks are the only varying v1 ranking dimensions in the representative post-filter matrix",
      "current equipment predicate rejects missing OPTIONAL and one-of-many ALTERNATIVE equipment",
    ],
  };
  const out = resolve("backend/services/ai-service/src/evaluation/program-recommendation/results/program-recommendation-evaluation-1.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
