import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalyzePlanModerationRequestSchema,
  AnalyzePlanModerationOutputSchema,
} from "../schemas/plan-moderation-analysis.schemas";
import { llmService } from "../services/llm.service";
import { planModerationAnalysisService } from "../services/plan-moderation-analysis.service";

function validRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "pub-1",
    planTitle: "3-day full body",
    planGoal: "MUSCLE_GAIN",
    computedStats: { daysPerWeek: 3, restDaysPerWeek: 4 },
    ruleFlags: [],
    similarListings: [],
    daySummaries: ["Day 1: Squat (3x8)"],
    ...overrides,
  };
}

function mockLlmAnswer(json: Record<string, unknown>) {
  return { answer: JSON.stringify(json), model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
}

function validOutput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    concerns: [],
    confidenceScore: 0.8,
    recommendation: "likely_safe",
    explanationForAdmin: "Kế hoạch cân đối, có ngày nghỉ hợp lý.",
    ...overrides,
  };
}

// ── Zod validation ───────────────────────────────────────────────────────────

test("AnalyzePlanModerationRequestSchema: accepts a well-formed request", () => {
  const parsed = AnalyzePlanModerationRequestSchema.parse(validRequest());
  assert.equal(parsed.planGoal, "MUSCLE_GAIN");
});

test("AnalyzePlanModerationOutputSchema: rejects an invalid recommendation value", () => {
  assert.throws(() => AnalyzePlanModerationOutputSchema.parse(validOutput({ recommendation: "approved" })));
});

test("AnalyzePlanModerationOutputSchema: rejects confidenceScore outside 0-1", () => {
  assert.throws(() => AnalyzePlanModerationOutputSchema.parse(validOutput({ confidenceScore: 1.5 })));
});

// ── Belt-and-braces overrides ─────────────────────────────────────────────────

test("planModerationAnalysisService.analyze: a severe rule flag (NO_REST_DAY) forces recommendation away from likely_safe, even if the LLM said otherwise", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => mockLlmAnswer(validOutput({ recommendation: "likely_safe" }));

  const req = AnalyzePlanModerationRequestSchema.parse(validRequest({ ruleFlags: ["NO_REST_DAY"] }));
  const result = await planModerationAnalysisService.analyze(req);
  assert.notEqual(result.recommendation, "likely_safe");
});

test("planModerationAnalysisService.analyze: no severe flags -> the model's likely_safe verdict is respected", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => mockLlmAnswer(validOutput({ recommendation: "likely_safe" }));

  const req = AnalyzePlanModerationRequestSchema.parse(validRequest({ ruleFlags: [] }));
  const result = await planModerationAnalysisService.analyze(req);
  assert.equal(result.recommendation, "likely_safe");
});

test("planModerationAnalysisService.analyze: a high-similarity duplicate is always surfaced as a concern, even if the model omitted it", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => mockLlmAnswer(validOutput({ concerns: [] }));

  const req = AnalyzePlanModerationRequestSchema.parse(
    validRequest({ similarListings: [{ title: "Existing Plan", similarityScore: 0.92 }] }),
  );
  const result = await planModerationAnalysisService.analyze(req);
  assert.ok(result.concerns.some((c) => /trùng|giống|duplicate|similar/i.test(c)));
});

test("planModerationAnalysisService.analyze: falls back to a conservative, honest report when the LLM never returns valid JSON", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => ({ answer: "not valid json", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as any;

  const req = AnalyzePlanModerationRequestSchema.parse(validRequest({ ruleFlags: ["EXCESSIVE_VOLUME_PER_SESSION"] }));
  const result = await planModerationAnalysisService.analyze(req);
  assert.equal(result.usedFallback, true);
  assert.equal(result.recommendation, "likely_unsafe"); // fallback maps a severe flag straight through
  assert.deepEqual(result.concerns, ["EXCESSIVE_VOLUME_PER_SESSION"]);
});
