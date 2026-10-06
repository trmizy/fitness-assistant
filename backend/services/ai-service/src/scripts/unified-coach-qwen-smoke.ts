/**
 * Phase 3 Batch 5 — REAL Qwen3 4B product smoke (docs/ai-product/phase3-batch5-rollout-readiness.md §12).
 *
 * Deliberately NOT part of the automated suite: it needs a live local Ollama with the exact configured model.
 * Run:  LLM_PROVIDER=ollama LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M npx tsx src/scripts/unified-coach-qwen-smoke.ts
 *
 * If Ollama is unreachable or the exact tag is not installed, the script exits with MODEL_ENVIRONMENT_BLOCKED and
 * runs nothing. It never substitutes another model. Output is JSON on stdout (timings are single runs, not p50/p90).
 */
import { llmService, LLM_MODEL } from "../services/llm.service";
import { llmRoute } from "../conversational-intelligence/global/llm-route";

const EXPECTED_TAG = "qwen3:4b-instruct-2507-q4_K_M";
const OLLAMA = process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || "http://localhost:11434";

async function installedTags(): Promise<string[]> {
  const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
  const j = (await r.json()) as { models?: Array<{ name: string }> };
  return (j.models ?? []).map((m) => m.name);
}

async function main() {
  const out: Record<string, unknown> = { expectedTag: EXPECTED_TAG, configuredTag: LLM_MODEL, startedAt: new Date().toISOString() };
  let tags: string[];
  try {
    tags = await installedTags();
  } catch (err) {
    console.log(JSON.stringify({ ...out, verdict: "MODEL_ENVIRONMENT_BLOCKED", reason: `ollama unreachable at ${OLLAMA}: ${(err as Error).message}` }, null, 2));
    process.exit(3);
  }
  if (LLM_MODEL !== EXPECTED_TAG || !tags.includes(EXPECTED_TAG)) {
    console.log(JSON.stringify({ ...out, verdict: "MODEL_ENVIRONMENT_BLOCKED", reason: "configured or installed tag does not match the approved tag", installed: tags }, null, 2));
    process.exit(3);
  }
  out.installed = tags;

  // S1 — health (real provider probe)
  let t = Date.now();
  const health = await llmService.getHealthStatus();
  out.s1Health = { latencyMs: Date.now() - t, llmAvailable: health.llmAvailable, provider: health.llmProvider, model: health.model ?? null };

  // S2 — general QA (model call expected; real generation)
  t = Date.now();
  const qa = await llmService.callLLM("Progressive overload là gì? Trả lời đúng 2 câu ngắn bằng tiếng Việt.", { temperature: 0, numPredict: 200, timeoutMs: 170000 });
  out.s2GeneralQa = { latencyMs: Date.now() - t, modelCalls: 1, answerChars: qa.answer.length, promptTokens: qa.promptTokens, completionTokens: qa.completionTokens, sample: qa.answer.slice(0, 160) };

  // S3 — ambiguous natural-language revision through the typed semantic router (the real fallback used by Conversational Intelligence)
  t = Date.now();
  const route = await llmRoute("Buổi chân hơi nặng", { active: { wf: "CREATE_WORKOUT_PLAN", slot: null }, draft: true }, "smoke-user", "smoke-s3");
  out.s3AmbiguousRevision = { latencyMs: Date.now() - t, modelCalls: 1, acceptedRoute: route?.route ?? null, expectedFamily: "revision of the pending draft (WRITE_ACTION)" };

  out.verdict = "EXECUTED";
  out.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.log(JSON.stringify({ verdict: "SMOKE_ERROR", error: (err as Error).message }, null, 2));
  process.exit(4);
});
