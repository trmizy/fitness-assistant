import test from "node:test";
import assert from "node:assert/strict";
import {
  GenerateRoadmapDraftRequestSchema,
  GenerateRoadmapDraftOutputSchema,
} from "../schemas/roadmap-draft.schemas";
import { llmService } from "../services/llm.service";
import { roadmapDraftService } from "../services/roadmap-draft.service";

function validRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "user-1",
    goalType: "WEIGHT_LOSS",
    timeframeWeeks: 24,
    profile: { experienceLevel: "INTERMEDIATE", injuries: [], safetyScreeningStatus: "CLEARED" },
    constraints: [],
    ...overrides,
  };
}

function mockLlmAnswer(json: Record<string, unknown>) {
  return { answer: JSON.stringify(json), model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any;
}

function validOutput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    summary: "Roadmap giảm mỡ 6 tháng.",
    reasoningSummary: "Bắt đầu với giảm mỡ, xen kẽ diet break, kết thúc bằng duy trì.",
    confidence: 0.7,
    phases: [
      { phaseType: "FAT_LOSS", name: "Giảm mỡ giai đoạn 1", plannedDurationWeeks: 8, reason: "Bắt đầu deficit." },
      { phaseType: "DIET_BREAK", name: "Nghỉ giữa kỳ", plannedDurationWeeks: 2, reason: "Hồi phục hormone." },
      { phaseType: "MAINTENANCE", name: "Duy trì", plannedDurationWeeks: 4, reason: "Ổn định kết quả." },
    ],
    warnings: [],
    assumptions: [],
    ...overrides,
  };
}

function withMockedLlm(response: () => ReturnType<typeof mockLlmAnswer>, fn: () => Promise<void>) {
  const original = llmService.callLLM;
  llmService.callLLM = async () => response();
  return fn().finally(() => {
    llmService.callLLM = original;
  });
}

// ── Zod validation ───────────────────────────────────────────────────────────

test("GenerateRoadmapDraftRequestSchema: accepts a well-formed request", () => {
  const parsed = GenerateRoadmapDraftRequestSchema.parse(validRequest());
  assert.equal(parsed.goalType, "WEIGHT_LOSS");
});

test("GenerateRoadmapDraftRequestSchema: rejects an unknown phaseType-adjacent field misuse (goalType missing)", () => {
  assert.throws(() => GenerateRoadmapDraftRequestSchema.parse(validRequest({ goalType: "" })));
});

// Gymini Guided Roadmap Creation additions (design doc §15).
test("GenerateRoadmapDraftRequestSchema: accepts optional wizard-sourced targetBodyFatPercent", () => {
  const parsed = GenerateRoadmapDraftRequestSchema.parse(
    validRequest({ profile: { ...validRequest().profile, targetWeightKg: 75, targetBodyFatPercent: 15 } }),
  );
  assert.equal((parsed.profile as any).targetBodyFatPercent, 15);
});

test("GenerateRoadmapDraftRequestSchema: trainingDaysPerWeek=0 is accepted (a user not yet training is a valid wizard input, not rejected)", () => {
  const parsed = GenerateRoadmapDraftRequestSchema.parse(
    validRequest({ profile: { ...validRequest().profile, trainingDaysPerWeek: 0 } }),
  );
  assert.equal((parsed.profile as any).trainingDaysPerWeek, 0);
});

test("GenerateRoadmapDraftRequestSchema: rejects an out-of-range targetBodyFatPercent", () => {
  assert.throws(() =>
    GenerateRoadmapDraftRequestSchema.parse(
      validRequest({ profile: { ...validRequest().profile, targetBodyFatPercent: 95 } }),
    ),
  );
});

test("GenerateRoadmapDraftOutputSchema: accepts a well-formed LLM output", () => {
  const parsed = GenerateRoadmapDraftOutputSchema.parse(validOutput());
  assert.equal(parsed.phases.length, 3);
});

test("GenerateRoadmapDraftOutputSchema: rejects an unknown phaseType (AI cannot invent a new enum value)", () => {
  assert.throws(() =>
    GenerateRoadmapDraftOutputSchema.parse(
      validOutput({ phases: [{ phaseType: "SHREDDING_MAX", name: "x", plannedDurationWeeks: 4, reason: "y" }] }),
    ),
  );
});

test("GenerateRoadmapDraftOutputSchema: rejects a phase with zero/negative duration", () => {
  assert.throws(() =>
    GenerateRoadmapDraftOutputSchema.parse(
      validOutput({ phases: [{ phaseType: "FAT_LOSS", name: "x", plannedDurationWeeks: 0, reason: "y" }] }),
    ),
  );
});

test("GenerateRoadmapDraftOutputSchema: rejects an empty phases array", () => {
  assert.throws(() => GenerateRoadmapDraftOutputSchema.parse(validOutput({ phases: [] })));
});

// ── Service behavior ─────────────────────────────────────────────────────────

test("roadmapDraftService.generateDraft: returns the validated LLM output when well-formed", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput()),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest());
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.phases.length, 3);
      assert.equal(result.phases[0].phaseType, "FAT_LOSS");
    },
  );
});

test("roadmapDraftService.generateDraft: malformed/invalid-JSON LLM response falls back to a deterministic, non-fabricated draft (never throws, never half-empty)", async () => {
  await withMockedLlm(
    () => ({ answer: "not json at all {{{", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest());
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.confidence, 0);
      assert.ok(result.phases.length >= 1);
      assert.ok(result.warnings.some((w) => /AI không tạo được/i.test(w)));
      // Zod-valid regardless of the fallback path.
      GenerateRoadmapDraftOutputSchema.parse(result);
    },
  );
});

test("roadmapDraftService.generateDraft: LLM response with an out-of-schema phaseType falls back deterministically instead of passing through", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput({ phases: [{ phaseType: "SHREDDING_MAX", name: "x", plannedDurationWeeks: 4, reason: "y" }] })),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest());
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.confidence, 0, "must use the deterministic fallback, not the invalid LLM output");
      assert.ok(result.phases.every((p) => (p.phaseType as string) !== "SHREDDING_MAX"));
    },
  );
});

test("roadmapDraftService.generateDraft: no real InBody data -> assumptions must disclose it", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput()),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest());
      const result = await roadmapDraftService.generateDraft(req);
      assert.ok(result.assumptions.some((a) => /InBody/i.test(a)));
    },
  );
});

test("roadmapDraftService.generateDraft: safetyScreeningStatus=FOLLOW_UP_SUGGESTED forces a warning even if the LLM omitted one", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput({ warnings: [] })),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(
        validRequest({ profile: { experienceLevel: "INTERMEDIATE", injuries: [], safetyScreeningStatus: "FOLLOW_UP_SUGGESTED" } }),
      );
      const result = await roadmapDraftService.generateDraft(req);
      assert.ok(result.warnings.some((w) => /FOLLOW_UP_SUGGESTED|theo dõi thêm/i.test(w)));
    },
  );
});

// ── Goal-aware deterministic fallback (never a universal FAT_LOSS default) ──

const GOAL_FALLBACK_MAP: Record<string, string> = {
  WEIGHT_LOSS: "FAT_LOSS",
  MUSCLE_GAIN: "LEAN_GAIN",
  MAINTENANCE: "MAINTENANCE",
  ATHLETIC_PERFORMANCE: "PERFORMANCE",
};

for (const [goalType, expectedPhaseType] of Object.entries(GOAL_FALLBACK_MAP)) {
  test(`roadmapDraftService.generateDraft: ${goalType} + AI unavailable -> ${expectedPhaseType} fallback, not a universal FAT_LOSS default`, async () => {
    await withMockedLlm(
      () => ({ answer: "not json {{{", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any),
      async () => {
        const req = GenerateRoadmapDraftRequestSchema.parse(validRequest({ goalType }));
        const result = await roadmapDraftService.generateDraft(req);
        assert.equal(result.confidence, 0);
        assert.equal(result.phases[0].phaseType, expectedPhaseType);
      },
    );
  });
}

test("roadmapDraftService.generateDraft: unrecognized goalType + AI unavailable -> safe neutral MAINTENANCE fallback, never FAT_LOSS", async () => {
  await withMockedLlm(
    () => ({ answer: "not json {{{", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest({ goalType: "SOME_FUTURE_GOAL" }));
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.phases[0].phaseType, "MAINTENANCE");
    },
  );
});

test("roadmapDraftService.generateDraft: MUSCLE_GAIN + FOLLOW_UP_SUGGESTED screening -> RECOVERY overrides the goal mapping (safety always wins)", async () => {
  await withMockedLlm(
    () => ({ answer: "not json {{{", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 } as any),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(
        validRequest({
          goalType: "MUSCLE_GAIN",
          profile: { experienceLevel: "INTERMEDIATE", injuries: [], safetyScreeningStatus: "FOLLOW_UP_SUGGESTED" },
        }),
      );
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.phases[0].phaseType, "RECOVERY");
      assert.notEqual(result.phases[0].phaseType, "LEAN_GAIN");
    },
  );
});

test("roadmapDraftService.generateDraft: invalid AI phases + MUSCLE_GAIN -> LEAN_GAIN fallback, never FAT_LOSS", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput({ phases: [{ phaseType: "SHREDDING_MAX", name: "x", plannedDurationWeeks: 4, reason: "y" }] })),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(validRequest({ goalType: "MUSCLE_GAIN" }));
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(result.confidence, 0, "must use the deterministic fallback, not the invalid LLM output");
      assert.equal(result.phases[0].phaseType, "LEAN_GAIN");
      assert.notEqual(result.phases[0].phaseType, "FAT_LOSS");
    },
  );
});

test("roadmapDraftService.generateDraft: real InBody data present -> no fabricated 'missing InBody' assumption is forced", async () => {
  await withMockedLlm(
    () => mockLlmAnswer(validOutput({ assumptions: ["Đã dùng dữ liệu InBody thật gần nhất."] })),
    async () => {
      const req = GenerateRoadmapDraftRequestSchema.parse(
        validRequest({ bodyComposition: { bodyFatPercent: 22, muscleMassKg: 55, measuredAt: "2026-09-01" } }),
      );
      const result = await roadmapDraftService.generateDraft(req);
      assert.equal(
        result.assumptions.filter((a) => /Chưa có số liệu InBody thật/i.test(a)).length,
        0,
        "must not force the missing-InBody assumption when real InBody data was actually supplied",
      );
    },
  );
});
