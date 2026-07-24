import test from "node:test";
import assert from "node:assert/strict";
import {
  AssessCycleRequestSchema,
  AssessCycleOutputSchema,
} from "../schemas/cycle-assessment.schemas";
import { llmService } from "../services/llm.service";
import { retriever } from "../llm/retriever";
import { cycleAssessmentService } from "../services/cycle-assessment.service";

function validRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "user-1",
    cycle: {
      name: "Bulk block 1",
      goalType: "MUSCLE_GAIN",
      cycleIndex: 2,
      durationDays: 30,
      startDate: "2026-06-01",
      endDate: "2026-07-01",
    },
    dataQuality: { dataQualityScore: 0.8, dataCompletenessScore: 0.85, qualityFlags: [] },
    computedMetrics: { adherenceRate: 0.85 },
    decision: { value: "ADJUST", confidenceScore: 0.7, recommendedActionScope: "minor_adjustment" },
    reasonCodes: ["PLATEAU_GOOD_ADHERENCE_MINOR_CHANGE_NEEDED"],
    safetyFlags: [],
    allowedChanges: ["VOLUME", "REPS"],
    ...overrides,
  };
}

// ── Zod validation ───────────────────────────────────────────────────────────

test("AssessCycleRequestSchema: accepts a well-formed request", () => {
  const parsed = AssessCycleRequestSchema.parse(validRequest());
  assert.equal(parsed.decision.value, "ADJUST");
});

test("AssessCycleRequestSchema: rejects an invalid decision value", () => {
  assert.throws(() =>
    AssessCycleRequestSchema.parse(validRequest({ decision: { value: "MAYBE", confidenceScore: 0.5, recommendedActionScope: "none" } })),
  );
});

test("AssessCycleRequestSchema: rejects an invalid allowedChanges entry", () => {
  assert.throws(() => AssessCycleRequestSchema.parse(validRequest({ allowedChanges: ["NOT_A_REAL_TYPE"] })));
});

test("AssessCycleOutputSchema: accepts a well-formed LLM output", () => {
  const parsed = AssessCycleOutputSchema.parse({
    decision: "ADJUST",
    headline: "Chững lại nhẹ",
    summary: "Adherence tốt nhưng tiến độ chậm.",
    positiveSignals: ["Adherence 85%"],
    warningSignals: [],
    proposedChanges: [
      { type: "REPS", target: "Bench Press", currentValue: "8-10", proposedValue: "10-12", reason: "Tăng kích thích" },
    ],
    missingData: [],
    safetyNotice: null,
    requiresConfirmation: true,
  });
  assert.equal(parsed.proposedChanges[0].type, "REPS");
});

test("AssessCycleOutputSchema: rejects a proposedChanges entry with an invalid type", () => {
  assert.throws(() =>
    AssessCycleOutputSchema.parse({
      decision: "ADJUST",
      headline: "x",
      summary: "x",
      proposedChanges: [{ type: "STEROID_CYCLE", target: "x", currentValue: "x", proposedValue: "x", reason: "x" }],
      requiresConfirmation: true,
    }),
  );
});

test("AssessCycleOutputSchema: rejects a decision value outside the 6-state enum", () => {
  assert.throws(() =>
    AssessCycleOutputSchema.parse({
      decision: "MAINTAIN", // not a real value — real ones are KEEP/PROGRESS/ADJUST/DELOAD/REBUILD/INSUFFICIENT_DATA
      headline: "x",
      summary: "x",
      requiresConfirmation: true,
    }),
  );
});

// ── LLM fallback path ────────────────────────────────────────────────────────

test("cycleAssessmentService.assessCycle: falls back to a deterministic template when the LLM never returns valid JSON", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    ({ answer: "not valid json at all", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as any;

  const req = AssessCycleRequestSchema.parse(
    validRequest({
      reasonCodes: ["PLATEAU_GOOD_ADHERENCE_MINOR_CHANGE_NEEDED"],
      safetyFlags: [{ code: "HIGH_PAIN_SCORE", severity: "critical", message: "Dừng bài gây đau và tham khảo bác sĩ." }],
    }),
  );

  const result = await cycleAssessmentService.assessCycle(req);
  assert.equal(result.decision, "ADJUST"); // echoes the Decision Engine's value, not invented
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.safetyNotice, "Dừng bài gây đau và tham khảo bác sĩ."); // pulled straight from safetyFlags, not LLM
  assert.deepEqual(result.proposedChanges, []);
  assert.equal(result.citations.length, 0); // no evidence retrieved -> no fabricated citations
});

test("cycleAssessmentService.assessCycle: the engine's decision always wins even if the LLM echoes a different one", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    ({
      answer: JSON.stringify({
        decision: "PROGRESS", // wrong on purpose — request says ADJUST
        headline: "x",
        summary: "x",
        positiveSignals: [],
        warningSignals: [],
        proposedChanges: [],
        missingData: [],
        safetyNotice: null,
        requiresConfirmation: true,
      }),
      model: "mock",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }) as any;

  const req = AssessCycleRequestSchema.parse(validRequest({ decision: { value: "ADJUST", confidenceScore: 0.7, recommendedActionScope: "minor_adjustment" } }));
  const result = await cycleAssessmentService.assessCycle(req);
  assert.equal(result.decision, "ADJUST");
});

test("cycleAssessmentService.assessCycle: requiresConfirmation is forced true even if the LLM returns false", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    ({
      answer: JSON.stringify({
        decision: "ADJUST",
        headline: "x",
        summary: "x",
        positiveSignals: [],
        warningSignals: [],
        proposedChanges: [],
        missingData: [],
        safetyNotice: null,
        requiresConfirmation: false, // the model should never be able to set this
      }),
      model: "mock",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }) as any;

  const req = AssessCycleRequestSchema.parse(validRequest());
  const result = await cycleAssessmentService.assessCycle(req);
  assert.equal(result.requiresConfirmation, true);
});
