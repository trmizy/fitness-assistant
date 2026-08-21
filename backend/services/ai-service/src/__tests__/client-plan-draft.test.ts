import test from "node:test";
import assert from "node:assert/strict";
import {
  GenerateClientPlanDraftRequestSchema,
  GenerateClientPlanDraftOutputSchema,
} from "../schemas/client-plan-draft.schemas";
import { llmService } from "../services/llm.service";
import { clientPlanDraftService } from "../services/client-plan-draft.service";

function exercise(id: string, bodyPart: string, name = id) {
  return { id, exerciseName: name, bodyPart, typeOfActivity: "STRENGTH", typeOfEquipment: "BARBELL", muscleGroupsActivated: [] };
}

function validRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "pt-1",
    client: { experienceLevel: "INTERMEDIATE", competesInSport: false, goal: "MUSCLE_GAIN", injuries: [] },
    priorDecisions: [],
    durationWeeks: 4,
    daysPerWeek: 2,
    allowedExercises: [exercise("ex-1", "UPPER_BODY"), exercise("ex-2", "LOWER_BODY"), exercise("ex-3", "CORE")],
    ...overrides,
  };
}

function mockLlmAnswer(json: Record<string, unknown>) {
  return { answer: JSON.stringify(json), model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
}

function validOutput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    days: [
      { dayNumber: 1, title: "Ngày 1", exercises: [{ exerciseId: "ex-1", order: 0, sets: 3, reps: 10 }] },
      { dayNumber: 2, title: "Ngày 2", exercises: [{ exerciseId: "ex-2", order: 0, sets: 3, reps: 10 }] },
    ],
    dataGaps: [],
    warnings: [],
    summaryForPt: "Bản nháp 2 buổi/tuần.",
    ...overrides,
  };
}

// ── Zod validation ───────────────────────────────────────────────────────────

test("GenerateClientPlanDraftRequestSchema: accepts a well-formed request", () => {
  const parsed = GenerateClientPlanDraftRequestSchema.parse(validRequest());
  assert.equal(parsed.daysPerWeek, 2);
});

test("GenerateClientPlanDraftRequestSchema: rejects an empty allowedExercises array", () => {
  assert.throws(() => GenerateClientPlanDraftRequestSchema.parse(validRequest({ allowedExercises: [] })));
});

test("GenerateClientPlanDraftOutputSchema: accepts a well-formed LLM output", () => {
  const parsed = GenerateClientPlanDraftOutputSchema.parse(validOutput());
  assert.equal(parsed.days.length, 2);
});

// ── Injury-based exercise exclusion (belt-and-braces pre-filter) ────────────

test("clientPlanDraftService.generateDraft: excludes LOWER_BODY (and FULL_BODY) exercises when client reports a knee injury", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () =>
    mockLlmAnswer(validOutput({ days: [{ dayNumber: 1, title: "Ngày 1", exercises: [{ exerciseId: "ex-2", order: 0, sets: 3, reps: 10 }] }] }));

  const req = GenerateClientPlanDraftRequestSchema.parse(
    validRequest({ client: { experienceLevel: "INTERMEDIATE", injuries: ["knee pain"] } }),
  );
  const result = await clientPlanDraftService.generateDraft(req);
  // ex-2 is LOWER_BODY -> must never appear even though the (mocked) LLM proposed it
  const usedIds = result.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
  assert.ok(!usedIds.includes("ex-2"));
  assert.ok(result.warnings.some((w) => /chấn thương/i.test(w)));
});

test("clientPlanDraftService.generateDraft: with no safe exercises left after injury filtering, returns an empty draft with a clear warning instead of guessing", async () => {
  const req = GenerateClientPlanDraftRequestSchema.parse(
    validRequest({
      client: { experienceLevel: "INTERMEDIATE", injuries: ["back pain", "knee pain", "shoulder pain"] },
      allowedExercises: [exercise("ex-2", "LOWER_BODY"), exercise("ex-4", "FULL_BODY")], // everything gets excluded
    }),
  );
  const result = await clientPlanDraftService.generateDraft(req);
  assert.deepEqual(result.days, []);
  assert.ok(result.warnings.length > 0);
});

// ── Exercise-id grounding (never trust an invented id) ───────────────────────

test("clientPlanDraftService.generateDraft: drops any exerciseId the LLM invents outside the allowed catalog", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () =>
    mockLlmAnswer(
      validOutput({
        days: [
          {
            dayNumber: 1,
            title: "Ngày 1",
            exercises: [
              { exerciseId: "ex-1", order: 0, sets: 3, reps: 10 },
              { exerciseId: "invented-not-real-id", order: 1, sets: 3, reps: 10 },
            ],
          },
        ],
      }),
    );

  const req = GenerateClientPlanDraftRequestSchema.parse(validRequest());
  const result = await clientPlanDraftService.generateDraft(req);
  const usedIds = result.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
  assert.ok(usedIds.includes("ex-1"));
  assert.ok(!usedIds.includes("invented-not-real-id"));
});

// ── Data-gap transparency ────────────────────────────────────────────────────

test("clientPlanDraftService.generateDraft: forces a dataGaps note when no cycleFeedbackSummary was supplied, even if the LLM omitted it", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => mockLlmAnswer(validOutput({ dataGaps: [] }));

  const req = GenerateClientPlanDraftRequestSchema.parse(validRequest()); // no cycleFeedbackSummary
  const result = await clientPlanDraftService.generateDraft(req);
  assert.ok(result.dataGaps.some((g) => /feedback|dữ liệu/i.test(g)));
});

// ── LLM fallback ──────────────────────────────────────────────────────────────

test("clientPlanDraftService.generateDraft: falls back to an empty, honest draft when the LLM never returns valid JSON", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
  });
  const originalCallLLM = llmService.callLLM;
  llmService.callLLM = async () => ({ answer: "not valid json", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as any;

  const req = GenerateClientPlanDraftRequestSchema.parse(validRequest());
  const result = await clientPlanDraftService.generateDraft(req);
  assert.deepEqual(result.days, []);
  assert.ok(result.dataGaps.length > 0 || result.summaryForPt.length > 0);
});

// ── No copyrighted-program naming (prompt-level guard, checked structurally) ─

test("GenerateClientPlanDraftOutputSchema: has no field for a named commercial program (schema shape enforces generic day/exercise structure only)", () => {
  const shape = GenerateClientPlanDraftOutputSchema.shape;
  assert.deepEqual(Object.keys(shape).sort(), ["dataGaps", "days", "summaryForPt", "warnings"]);
});
