import { digest } from "../../evaluation/evaluation-kit/identity";
import type { SessionConfig } from "../../evaluation/bedrock-pilot/config";
import type { EvaluationTransport } from "../../evaluation/bedrock-pilot/session";
export const pilotPrompt = { system: "Synthetic fixture only", user: "{}", layers: [] };
export function pilotConfig(): SessionConfig {
  return { mode: "FAKE", liveOptIn: false, dataClass: "SYNTHETIC_EVALUATION_ONLY", modelId: "amazon.nova-pro-v1:0", inferenceProfile: null, region: "ap-southeast-1", profileModelConfirmed: false,
    parameters: { maxTokens: 2048, temperature: 0.2, retries: 0, timeoutMs: 1000 }, pins: { commit: "a".repeat(40), code: "b".repeat(64), corpus: "c".repeat(64), cases: "d".repeat(64), promptHashes: [digest({ system: pilotPrompt.system, user: pilotPrompt.user })] },
    budget: { maxCalls: 12, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 24576, maxEstimatedUsd: 1, maxFailures: 2 },
    pricing: { authority: "FAKE_TEST_ONLY", sourceUrl: "https://aws.amazon.com/bedrock/pricing/", tokenUnit: "USD_PER_MILLION_TOKENS", modelId: "amazon.nova-pro-v1:0", inferenceProfile: null, region: "ap-southeast-1", version: "TEST_RATES_NOT_AWS_PRICES", checkedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), inputUsdPerMillion: 1, outputUsdPerMillion: 2, confirmedBy: "TEST_FIXTURE", evidenceHash: "e".repeat(64) }, approval: null };
}
export const pilotAnswer = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic plumbing response only.", proposedAction: null }, sourceLinks: [] };
export function pilotTransport(text = JSON.stringify(pilotAnswer)): EvaluationTransport {
  return { kind: "FAKE", async count() { return 12; }, async invoke() { return { $metadata: {}, output: { message: { role: "assistant", content: [{ text }] } }, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, stopReason: "end_turn" }; } };
}
