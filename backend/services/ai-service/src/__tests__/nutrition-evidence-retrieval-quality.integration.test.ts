/**
 * Part 11 requirement: "Test AI evidence retrieval quality (not just
 * document existence) via realistic queries", explicitly not brittle
 * exact-text matching — expecting the right evidence CATEGORY to surface.
 *
 * This exercises the REAL retriever against the REAL Qdrant
 * `fitness_evidence` collection (local Ollama embeddings) — proving the
 * 14 evidence entries added in the AI-nutrition-overhaul pass
 * (`npm run knowledge:pipeline`, run 2026-08-18) are not just present in
 * `_index.json`/on disk, but genuinely retrievable and relevant for the
 * kinds of questions a real user would ask.
 *
 * Requires a reachable Qdrant instance with the fitness_evidence
 * collection populated — skipped automatically if unset, matching this
 * repo's existing integration-test gating convention.
 *
 * Run with (from backend/services/ai-service):
 *   RUN_QDRANT_INTEGRATION_TESTS=true npx tsx --test src/__tests__/nutrition-evidence-retrieval-quality.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const canRun = process.env.RUN_QDRANT_INTEGRATION_TESTS === "true";
const skipOpts = {
  skip: canRun ? false : "Set RUN_QDRANT_INTEGRATION_TESTS=true (needs a reachable Qdrant with fitness_evidence populated) to run this integration test",
  timeout: 30_000,
};

async function loadRetriever() {
  const mod = await import("../llm/retriever");
  return mod.retriever;
}

test(
  "creatine dosage/safety query surfaces the ISSN creatine position stand as a top result",
  skipOpts,
  async () => {
    const retriever = await loadRetriever();
    const results = await retriever.retrieveEvidence([
      "creatine dosage safety for muscle gain",
    ]);
    assert.ok(results.length > 0, "expected at least one retrieved document");
    const titles = results.map((r: any) => String(r.metadata?.title ?? ""));
    assert.ok(
      titles.some((t) => /creatine/i.test(t)),
      `expected a creatine-related document in top results, got: ${titles.join(" | ")}`,
    );
  },
);

test(
  "low-energy-availability / overtraining-and-undereating query surfaces REDs or athlete-nutrition consensus",
  skipOpts,
  async () => {
    const retriever = await loadRetriever();
    const results = await retriever.retrieveEvidence([
      "low energy availability signs athlete training too much eating too little",
    ]);
    assert.ok(results.length > 0, "expected at least one retrieved document");
    const titles = results.map((r: any) => String(r.metadata?.title ?? ""));
    assert.ok(
      titles.some((t) => /relative energy deficiency|REDs|athletic performance/i.test(t)),
      `expected a REDs/athlete-nutrition document in top results, got: ${titles.join(" | ")}`,
    );
  },
);

test(
  "muscle-gain calorie surplus size query surfaces the surplus-size evidence (Helms/Slater), not an unrelated document",
  skipOpts,
  async () => {
    const retriever = await loadRetriever();
    const results = await retriever.retrieveEvidence([
      "how big should a calorie surplus be for building muscle without gaining too much fat",
    ]);
    assert.ok(results.length > 0, "expected at least one retrieved document");
    const titles = results.map((r: any) => String(r.metadata?.title ?? ""));
    assert.ok(
      titles.some((t) => /surplus|hypertrophy/i.test(t)),
      `expected a calorie-surplus/hypertrophy document in top results, got: ${titles.join(" | ")}`,
    );
  },
);

test(
  "hydration query surfaces the fluid-replacement evidence, not a generic/irrelevant document",
  skipOpts,
  async () => {
    const retriever = await loadRetriever();
    const results = await retriever.retrieveEvidence([
      "how much water should I drink during exercise in hot weather",
    ]);
    assert.ok(results.length > 0, "expected at least one retrieved document");
    const titles = results.map((r: any) => String(r.metadata?.title ?? ""));
    assert.ok(
      titles.some((t) => /fluid|hydration|physically active/i.test(t)),
      `expected a hydration/fluid-replacement document in top results, got: ${titles.join(" | ")}`,
    );
  },
);
