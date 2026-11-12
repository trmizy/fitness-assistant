/**
 * V1 RC1 (2026-11-12) — cost telemetry. Every model call must be attributable for the test-stack cost ledger
 * (test/ai-quality-eval/cost-ledger.mjs): `llm_call` carries the request's clientRequestId (null for background work), and every
 * Cohere call emits an `embedding_call` line with text count + characters. Logging only — no prompt/answer text, no behaviour
 * change. Mock provider; no network.
 */
process.env.LLM_PROVIDER = "mock";
import test from "node:test";
import assert from "node:assert/strict";

test("llm_call carries the request's clientRequestId inside a request and null for background work", async () => {
  const { logger } = await import("@gym-coach/shared");
  const { llmService } = await import("../services/llm.service");
  const { withClientRequestId } = await import("../services/request-identity");
  const seen: any[] = [];
  const orig = logger.info.bind(logger);
  (logger as any).info = (obj: any, msg?: string) => { if (msg === "llm_call") seen.push(obj); return orig(obj, msg); };
  try {
    await withClientRequestId("aiq-test-case-0001", () => llmService.callLLM("Xin chào", { purpose: "GENERAL_QA" } as any));
    await llmService.callLLM("background", { purpose: "GENERATION" } as any);
  } finally { (logger as any).info = orig; }
  assert.equal(seen.length, 2);
  assert.equal(seen[0].clientRequestId, "aiq-test-case-0001");
  assert.equal(seen[1].clientRequestId, null);
  assert.ok(!JSON.stringify(seen).includes("Xin chào"), "never logs prompt text");
});

test("embedding telemetry line shape: model, text count, characters, outcome, request id — never the text", async () => {
  const { embeddingTelemetry } = await import("../services/bedrock.client");
  const { withClientRequestId } = await import("../services/request-identity");
  const t = withClientRequestId("aiq-test-case-0002", () => embeddingTelemetry(["đau gối khi squat", "abc"], "cohere.embed-multilingual-v3", 12, "ok"));
  assert.deepEqual(t, { model: "cohere.embed-multilingual-v3", texts: 2, inputChars: 20, latencyMs: 12, outcome: "ok", clientRequestId: "aiq-test-case-0002" });
  assert.ok(!JSON.stringify(t).includes("squat"));
});
