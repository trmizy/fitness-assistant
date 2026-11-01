import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openEvaluationSession, type SessionConfig, type EvaluationTransport } from "../evaluation/bedrock-pilot/session";
import { digest } from "../evaluation/evaluation-kit/identity";
import type { Prompt } from "../evaluation/ai-coach-dev/pipeline";
const prompt: Prompt = { system: "Synthetic DEV policy", user: "{}", layers: [] };
const answer = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic plumbing response only.", proposedAction: null }, sourceLinks: [] };
function config(): SessionConfig { return {
  mode: "FAKE", liveOptIn: false, dataClass: "SYNTHETIC_EVALUATION_ONLY", modelId: "amazon.nova-pro-v1:0", inferenceProfile: null, region: "ap-southeast-1", profileModelConfirmed: false,
  parameters: { maxTokens: 20, temperature: 0.2, retries: 0, timeoutMs: 1000 }, pins: { commit: "a".repeat(40), code: "a".repeat(64), corpus: "b".repeat(64), cases: "c".repeat(64), promptHashes: [digest({ system: prompt.system, user: prompt.user })] },
  budget: { maxCalls: 3, maxInputTokensPerCall: 100, maxInputTokens: 100, maxOutputTokens: 100, maxEstimatedUsd: 1, maxFailures: 2 },
  pricing: { authority: "FAKE_TEST_ONLY", sourceUrl: "https://aws.amazon.com/bedrock/pricing/", version: "FAKE_TEST_RATES_NOT_AWS_PRICES", checkedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), modelId: "amazon.nova-pro-v1:0", region: "ap-southeast-1", inputUsdPerMillion: 1, outputUsdPerMillion: 2, confirmedBy: "FAKE_TEST", evidenceHash: "f".repeat(64) }, approval: null,
}; }
const dir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gymini-eval-")), "run");
function fake(text = JSON.stringify(answer)): EvaluationTransport { return { kind: "FAKE", async count() { return 12; }, async invoke(input) {
  assert.ok(!("seed" in input.inferenceConfig!)); assert.equal(input.inferenceConfig?.maxTokens, 20);
  return { $metadata: {}, output: { message: { role: "assistant", content: [{ text }] } }, usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, metrics: { latencyMs: 0 }, stopReason: "end_turn" };
} }; }
test("fake transport normalizes raw candidate, usage, stop reason and append-only journal", async () => {
  const folder = dir(), session = openEvaluationSession(config(), folder, fake());
  const result = await session.evaluate(prompt);
  assert.equal(result.parseError, null); assert.deepEqual(result.parsedCandidate, answer);
  assert.equal(result.inputTokens, 12); assert.equal(result.outputTokens, 8); assert.equal(result.stopReason, "end_turn");
  assert.equal(session.state().inferenceCalls, 1);
  const lines = fs.readFileSync(path.join(folder, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.record.event), ["ATTEMPT_STARTED", "INFERENCE_RESERVED", "ATTEMPT_FINISHED"]);
  assert.throws(() => openEvaluationSession(config(), folder, fake()));
});
test("schema and parse failures preserve raw text and parsed invalid candidate", async () => {
  const invalid = { debug: "preserve me" };
  const s = openEvaluationSession(config(), dir(), fake(JSON.stringify(invalid)));
  const r = await s.evaluate(prompt); assert.equal(r.parseError, "SCHEMA_INVALID"); assert.deepEqual(r.parsedCandidate, invalid);
  const broken = await openEvaluationSession(config(), dir(), fake("not json")).evaluate(prompt);
  assert.equal(broken.rawText, "not json"); assert.equal(broken.parseError, "INVALID_JSON");
});
test("call, token and spend admission controls reserve before inference including concurrent requests", async () => {
  for (const limit of [{ maxInputTokens: 5 }, { maxOutputTokens: 10 }, { maxEstimatedUsd: 0.000001 }]) {
    const c = config(); Object.assign(c.budget, limit); const s = openEvaluationSession(c, dir(), fake());
    assert.equal((await s.evaluate(prompt)).providerError, "BUDGET_REJECTED"); assert.equal(s.state().inferenceCalls, 0);
  }
  const c = config(); c.budget.maxCalls = 1; const s = openEvaluationSession(c, dir(), fake());
  const results = await Promise.allSettled([s.evaluate(prompt), s.evaluate(prompt)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(s.state().inferenceCalls, 1);
});
test("failure threshold retains unknown spend reservation; errors cannot leak credentials", async () => {
  const c = config(); c.budget.maxFailures = 1; const folder = dir();
  const s = openEvaluationSession(c, folder, { ...fake(), async invoke() { throw new Error("secretAccessKey=DO_NOT_LOG_ME"); } });
  const result = await s.evaluate(prompt);
  assert.equal(result.providerError, "PROVIDER_ERROR"); assert.equal(s.state().outputTokens, 20);
  await assert.rejects(() => s.evaluate(prompt), /BudgetStopped/);
  assert.ok(!fs.readFileSync(path.join(folder, "results.jsonl"), "utf8").includes("DO_NOT_LOG_ME"));
});
test("live opt-in, valid pricing, approval and supported parameters are mandatory", () => {
  const c = config(); c.mode = "LIVE";
  assert.throws(() => openEvaluationSession(c, dir()), /LiveNotApproved/);
  assert.throws(() => openEvaluationSession({ ...config(), parameters: { ...config().parameters, seed: 1 } }, dir(), fake()));
  assert.throws(() => openEvaluationSession({ ...config(), parameters: { ...config().parameters, topP: 1 } }, dir(), fake()));
  const expired = config(); expired.pricing.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.throws(() => openEvaluationSession(expired, dir(), fake()), /PricingNotValid/);
});
test("unknown usage stops the session and raw response secrets are redacted in persistence", async () => {
  const folder = dir();
  const s = openEvaluationSession(config(), folder, fake('{"secretAccessKey":"NEVER_LOG_THIS"}'));
  await s.evaluate(prompt);
  assert.ok(!fs.readFileSync(path.join(folder, "results.jsonl"), "utf8").includes("NEVER_LOG_THIS"));
  const missing = openEvaluationSession(config(), dir(), { ...fake(), async invoke() { return { $metadata: {}, stopReason: "end_turn" } as Awaited<ReturnType<EvaluationTransport["invoke"]>>; } });
  assert.equal((await missing.evaluate(prompt)).providerError, "USAGE_MISMATCH_OR_UNKNOWN"); assert.equal(missing.state().stopped, true);
});
