import test from "node:test";
import assert from "node:assert/strict";
import {
  AnalyzeFeedbackRequestSchema,
  AnalyzeFeedbackOutputSchema,
} from "../schemas/feedback-analysis.schemas";
import { llmService } from "../services/llm.service";
import { retriever } from "../llm/retriever";
import { feedbackAnalysisService } from "../services/feedback-analysis.service";

function validRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "user-1",
    cycle: { name: "Bulk block 1", goalType: "MUSCLE_GAIN", experienceLevel: "INTERMEDIATE", competesInSport: false },
    cycleFeedbackSummary: {
      totalSessions: 10,
      feedbackSubmittedCount: 6,
      feedbackCompletionRate: 0.6,
      dataQualityScore: 0.6,
      feedbackSentimentByRules: "mixed",
      averagePain: 2,
      sessionsMarkedTooHard: 1,
      sessionsMarkedTooEasy: 0,
      safetyFlags: [],
    },
    ...overrides,
  };
}

function mockLlmAnswer(json: Record<string, unknown>) {
  return {
    answer: JSON.stringify(json),
    model: "mock",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  } as any;
}

function validOutput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    feedbackInterpretation: "Người dùng phản hồi lẫn lộn, phần lớn ổn.",
    sentiment: "mixed",
    complaintValidity: "partially_supported",
    complaintCategories: ["too_hard"],
    suggestedImprovementAreas: ["Giảm nhẹ khối lượng buổi đầu tuần"],
    riskFlags: [],
    recommendedDecisionInfluence: "minor_adjust",
    explanationForUser: "Một vài buổi hơi nặng, có thể giảm nhẹ.",
    explanationForCoach: "1/6 buổi đánh dấu too_hard, pain trung bình thấp — chưa đáng lo.",
    ...overrides,
  };
}

// ── Zod validation ───────────────────────────────────────────────────────────

test("AnalyzeFeedbackRequestSchema: accepts a well-formed request", () => {
  const parsed = AnalyzeFeedbackRequestSchema.parse(validRequest());
  assert.equal(parsed.userId, "user-1");
});

test("AnalyzeFeedbackRequestSchema: cycleFeedbackSummary passes through as an opaque record", () => {
  const parsed = AnalyzeFeedbackRequestSchema.parse(validRequest());
  assert.equal((parsed.cycleFeedbackSummary as any).totalSessions, 10);
});

test("AnalyzeFeedbackOutputSchema: accepts a well-formed LLM output", () => {
  const parsed = AnalyzeFeedbackOutputSchema.parse(validOutput());
  assert.equal(parsed.sentiment, "mixed");
});

test("AnalyzeFeedbackOutputSchema: rejects an invalid sentiment value", () => {
  assert.throws(() => AnalyzeFeedbackOutputSchema.parse(validOutput({ sentiment: "furious" })));
});

test("AnalyzeFeedbackOutputSchema: rejects an invalid complaintCategories entry", () => {
  assert.throws(() => AnalyzeFeedbackOutputSchema.parse(validOutput({ complaintCategories: ["not_a_real_category"] })));
});

test("AnalyzeFeedbackOutputSchema: rejects an invalid recommendedDecisionInfluence value", () => {
  assert.throws(() => AnalyzeFeedbackOutputSchema.parse(validOutput({ recommendedDecisionInfluence: "rebuild_now" })));
});

// ── LLM fallback + belt-and-braces overrides ─────────────────────────────────

test("feedbackAnalysisService.analyzeFeedback: falls back to a deterministic template when the LLM never returns valid JSON", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () => ({ answer: "not valid json", model: "mock", promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as any;

  const req = AnalyzeFeedbackRequestSchema.parse(validRequest());
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.equal(result.sentiment, "mixed"); // pulled straight from cycleFeedbackSummary's rule-based sentiment
  assert.equal(result.recommendedDecisionInfluence, "none"); // fallback never recommends acting
  assert.equal(result.citations.length, 0);
  assert.equal(result.usedFallback, true);
});

test("feedbackAnalysisService.analyzeFeedback: low feedback data quality forces insufficient_data + none, even if the LLM concluded strongly", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    mockLlmAnswer(validOutput({ complaintValidity: "supported_by_data", recommendedDecisionInfluence: "adjust" }));

  const req = AnalyzeFeedbackRequestSchema.parse(
    validRequest({
      cycleFeedbackSummary: {
        totalSessions: 10,
        feedbackSubmittedCount: 1, // below the 2-submission floor
        dataQualityScore: 0.1,
        feedbackSentimentByRules: "insufficient_feedback",
        safetyFlags: [],
      },
    }),
  );
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.equal(result.complaintValidity, "insufficient_data");
  assert.equal(result.recommendedDecisionInfluence, "none");
});

test("feedbackAnalysisService.analyzeFeedback: an unsupported complaint never drives a decision influence", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    mockLlmAnswer(validOutput({ complaintValidity: "not_supported", recommendedDecisionInfluence: "adjust" }));

  const req = AnalyzeFeedbackRequestSchema.parse(validRequest());
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.equal(result.recommendedDecisionInfluence, "none");
});

test("feedbackAnalysisService.analyzeFeedback: positive sentiment + high pain forces a risk flag even if the LLM omitted it", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () => mockLlmAnswer(validOutput({ sentiment: "positive", riskFlags: [] }));

  const req = AnalyzeFeedbackRequestSchema.parse(
    validRequest({
      cycleFeedbackSummary: {
        totalSessions: 10,
        feedbackSubmittedCount: 6,
        dataQualityScore: 0.6,
        feedbackSentimentByRules: "positive",
        averagePain: 8,
        safetyFlags: ["HIGH_PAIN_REPORTED"],
      },
    }),
  );
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.ok(result.riskFlags.includes("POSITIVE_FEEDBACK_BUT_HIGH_PAIN"));
});

test("feedbackAnalysisService.analyzeFeedback: rebuild_consideration without rule-confirmed negative sentiment is downgraded to adjust", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    mockLlmAnswer(
      validOutput({
        complaintValidity: "supported_by_data",
        recommendedDecisionInfluence: "rebuild_consideration",
      }),
    );

  const req = AnalyzeFeedbackRequestSchema.parse(
    validRequest({
      cycleFeedbackSummary: {
        totalSessions: 10,
        feedbackSubmittedCount: 8,
        dataQualityScore: 0.8,
        feedbackSentimentByRules: "mixed", // not "negative" -> rebuild_consideration isn't earned
        safetyFlags: [],
      },
    }),
  );
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.equal(result.recommendedDecisionInfluence, "adjust");
});

test("feedbackAnalysisService.analyzeFeedback: rebuild_consideration IS allowed through when rule-based sentiment is negative", async (t) => {
  t.after(() => {
    llmService.callLLM = originalCallLLM;
    retriever.retrieveEvidence = originalRetrieveEvidence;
  });
  const originalCallLLM = llmService.callLLM;
  const originalRetrieveEvidence = retriever.retrieveEvidence;

  retriever.retrieveEvidence = async () => [];
  llmService.callLLM = async () =>
    mockLlmAnswer(
      validOutput({
        complaintValidity: "supported_by_data",
        recommendedDecisionInfluence: "rebuild_consideration",
      }),
    );

  const req = AnalyzeFeedbackRequestSchema.parse(
    validRequest({
      cycleFeedbackSummary: {
        totalSessions: 10,
        feedbackSubmittedCount: 8,
        dataQualityScore: 0.8,
        feedbackSentimentByRules: "negative",
        safetyFlags: [],
      },
    }),
  );
  const result = await feedbackAnalysisService.analyzeFeedback(req);
  assert.equal(result.recommendedDecisionInfluence, "rebuild_consideration");
});
