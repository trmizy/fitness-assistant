import test from "node:test";
import assert from "node:assert/strict";
import { scoreTrainingProgramV2, type AgentEvidence, type AgentPreferences, type TrainingProgramCandidate } from "@gym-coach/shared";
import { buildDefaultProgramSelection, buildProgramClaimCatalog, renderProgramNarrationFromClaims } from "../program_recommendation_claims";

const prefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, durationWeeks: 12, demo: false };
const program: TrainingProgramCandidate = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Template",
  goal: "MUSCLE_GAIN",
  daysPerWeek: 3,
  durationWeeks: 12,
  estimatedMinutes: 55,
  experienceLevel: "BEGINNER",
  focusMuscles: ["CHEST", "BACK"],
  fingerprint: "fp",
  dataOrigin: "REAL",
  days: [],
};
const evidence: AgentEvidence[] = [{
  id: "ev-1",
  title: "ACSM progression",
  sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/19204579/",
  finding: "Resistance-training frequency should be matched to training status and progressed over time.",
  evidenceLevel: "guideline",
  version: "v1",
}];

test("program claim catalog v2: eligibility claims present alongside ranking claims and mandatory no-history disclosure", () => {
  const compatibility = scoreTrainingProgramV2(program, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const catalog = buildProgramClaimCatalog({ program, compatibility }, evidence);
  assert.ok(catalog.some(c => c.type === "GOAL_ELIGIBLE"));
  assert.ok(catalog.some(c => c.type === "EQUIPMENT_ELIGIBLE"));
  assert.ok(catalog.some(c => c.type === "SESSION_DURATION"), "session duration is a real ranking signal, not eligibility");
  assert.ok(catalog.some(c => c.type === "SCIENTIFIC_EVIDENCE"));
  assert.ok(catalog.some(c => c.type === "NO_OUTCOME_HISTORY"));
  assert.equal(catalog.some(c => String(c.type).includes("OUTCOME_PREDICTION")), false);
});

test("program claim catalog v2: eligibility claims are rendered separately from ranking strengths", () => {
  const compatibility = scoreTrainingProgramV2(program, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const catalog = buildProgramClaimCatalog({ program, compatibility }, evidence);
  const narration = renderProgramNarrationFromClaims(program.id, catalog, buildDefaultProgramSelection(catalog));
  assert.ok(narration.strengths.some(s => s.includes("khớp với mục tiêu")), "eligibility text still shown to the user, just categorized separately");
  assert.ok(narration.strengths.some(s => s.includes("phút mỗi buổi")), "real ranking signal (session duration) also shown");
});

test("program claim catalog v2: zero ranking signal -> mandatory ZERO_RANKING_SIGNAL disclosure, no fake differentiation", () => {
  const noPrefs: AgentPreferences = { goal: "MUSCLE_GAIN", days: [1, 3, 5], demo: false }; // no sessionMinutes, no durationWeeks
  const compatibility = scoreTrainingProgramV2(program, noPrefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: [] });
  assert.equal(compatibility.signalCount, 0);
  assert.equal(compatibility.total, 100);
  const catalog = buildProgramClaimCatalog({ program, compatibility }, evidence);
  const narration = renderProgramNarrationFromClaims(program.id, catalog, []);
  assert.ok(narration.uncertainty.some(text => text.includes("đáp ứng các ràng buộc hiện tại như nhau")));
});

test("program renderer ignores hallucinated or cross-candidate claim ids", () => {
  const compatibility = scoreTrainingProgramV2(program, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const catalog = buildProgramClaimCatalog({ program, compatibility }, evidence);
  const narration = renderProgramNarrationFromClaims(program.id, catalog, [
    `${program.id}::COMPATIBILITY`,
    "other-program::GOAL",
    `${program.id}::INVENTED_CLAIM`,
  ]);
  assert.match(narration.summary, /Mức phù hợp tổng thể/);
  assert.equal(narration.strengths.some(s => s.includes("INVENTED")), false);
});

test("default program selection renders a complete deterministic explanation", () => {
  const compatibility = scoreTrainingProgramV2(program, prefs, { userExperience: "BEGINNER", goalIntentFocusMuscles: ["CHEST"] });
  const catalog = buildProgramClaimCatalog({ program, compatibility }, evidence);
  const narration = renderProgramNarrationFromClaims(program.id, catalog, buildDefaultProgramSelection(catalog));
  assert.equal(narration.candidateId, program.id);
  assert.ok(narration.strengths.length > 0);
  assert.ok(narration.uncertainty.some(text => text.includes("không phải dự đoán")));
  assert.deepEqual(narration.evidenceRefs, ["ev-1"]);
});
