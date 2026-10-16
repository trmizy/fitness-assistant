/**
 * V2.3A.7 Phase 7 — PRODUCTION_PATH_SEMANTIC_BASELINE_V1.
 *
 * Calls the REAL production interpretTurn()/interpretWithLlm() path (same
 * buildSystemInstructions/buildUserTurn split, same LlmOutputSchema, same
 * deterministic extraction, same merge logic, same TS grounding guard) —
 * with LLM_PROVIDER=bedrock and real credentials already authorized in
 * this environment, a genuine LIVE inference call against the actually-
 * deployed model (apac.amazon.nova-pro-v1:0) for cases that need the LLM
 * fallback. NOT the sealed 66-row heldout — a small, new, explicit
 * unsealed smoke corpus authored for this task.
 *
 * process.env must be set BEFORE llm.service.ts is first imported (it
 * reads LLM_PROVIDER at module-load time into a top-level const) — a
 * static `import` at the top of this file would be hoisted above these
 * assignments, so every import below is a dynamic `await import()`,
 * exactly like the existing bedrock-provider.test.ts/
 * llm-provider-anthropic-regression.test.ts pattern.
 *
 * Read-only w.r.t. AWS state: Bedrock InvokeModel/Converse is an inference
 * call, not a mutation. No AWS resource is created/changed/deleted.
 */
process.env.LLM_PROVIDER = "bedrock";
process.env.EMBEDDING_PROVIDER = "bedrock";
process.env.BEDROCK_REGION = "ap-southeast-1";
process.env.BEDROCK_CHAT_MODEL = "apac.amazon.nova-pro-v1:0";

interface Case {
  id: string;
  category: string;
  text: string;
  expectedPrimaryIntent?: string;
  expectEntityType?: string;
  expectGoal?: string;
  expectAsksRecommendation?: boolean;
  expectReferenceResolved?: boolean; // SYSTEM metric: should references end up non-empty?
  expectClarification?: boolean; // SYSTEM metric
}

const CASES: Case[] = [
  { id: "intent-1", category: "intent", text: "Tôi cao 170cm.", expectedPrimaryIntent: "PROVIDE_INFORMATION" },
  { id: "entity-1", category: "entities", text: "Tôi nặng 65kg và cao 170cm.", expectEntityType: "WEIGHT_KG" },
  { id: "goal-1", category: "goalSignals", text: "Tôi muốn giảm mỡ.", expectGoal: "WEIGHT_LOSS" },
  { id: "recommend-1", category: "asksRecommendation", text: "Bạn chọn giúp tôi mức tạ phù hợp.", expectAsksRecommendation: true },
  { id: "correction-1", category: "isCorrection", text: "à không, tôi tập 5 buổi", expectedPrimaryIntent: "CORRECT_INFORMATION" },
  { id: "reference-zero-1", category: "reference_0", text: "đổi sang PT đó đi", expectReferenceResolved: false, expectClarification: true },
  { id: "reference-one-1", category: "reference_1", text: "PT Minh tư vấn tốt lắm, chốt người đó cho tôi.", expectReferenceResolved: true, expectClarification: false },
  { id: "reference-multi-1", category: "reference_multi", text: "Bench và deadlift đều nặng, bớt cái đó lại.", expectReferenceResolved: false, expectClarification: true },
  // >=12 chars and no workflow/correction/recommend trigger -> genuinely reaches needsSemanticLlm()==true, exercising a REAL live Bedrock call.
  { id: "ambiguity-llm-1", category: "ambiguity_llm_fallback", text: "Thôi cái đó cũng được, tùy bạn thôi.", expectClarification: undefined },
  { id: "dismiss-1", category: "dismiss", text: "Thôi bỏ qua hết đi nhé.", expectedPrimaryIntent: "DISMISS" },
];

async function main() {
  const { interpretTurn } = await import("../../../backend/services/ai-service/src/conversational-intelligence/interpreter");
  const llm = await import("../../../backend/services/ai-service/src/services/llm.service");
  console.log("LLM_PROVIDER resolved to:", llm.LLM_PROVIDER);

  const results: any[] = [];
  for (const c of CASES) {
    const started = Date.now();
    let interp: any = null;
    let error: string | null = null;
    try {
      interp = await interpretTurn(c.text, {}, { userId: "v2.3a7-baseline", allowLlm: true });
    } catch (err) {
      error = (err as Error)?.message ?? String(err);
    }
    results.push({ ...c, latencyMs: Date.now() - started, interpretation: interp, error });
    console.log(`[${c.id}] source=${interp?.source} primaryIntent=${interp?.primaryIntent} clarificationRequired=${interp?.clarificationRequired} references=${JSON.stringify(interp?.references)} latencyMs=${Date.now() - started} error=${error}`);
  }

  const modelMetrics = { primaryIntentCorrect: 0, primaryIntentTotal: 0, entityCorrect: 0, entityTotal: 0, goalCorrect: 0, goalTotal: 0, asksRecommendationCorrect: 0, asksRecommendationTotal: 0 };
  const systemMetrics = { referenceCorrect: 0, referenceTotal: 0, clarificationCorrect: 0, clarificationTotal: 0 };
  let liveLlmCalls = 0;

  for (const r of results) {
    if (!r.interpretation) continue;
    if (r.interpretation.source === "MERGED") liveLlmCalls += 1;
    if (r.expectedPrimaryIntent) {
      modelMetrics.primaryIntentTotal += 1;
      if (r.interpretation.primaryIntent === r.expectedPrimaryIntent) modelMetrics.primaryIntentCorrect += 1;
    }
    if (r.expectEntityType) {
      modelMetrics.entityTotal += 1;
      if (r.interpretation.entities.some((e: any) => e.type === r.expectEntityType)) modelMetrics.entityCorrect += 1;
    }
    if (r.expectGoal) {
      modelMetrics.goalTotal += 1;
      if (r.interpretation.goalSignals.some((g: any) => g.goal === r.expectGoal)) modelMetrics.goalCorrect += 1;
    }
    if (typeof r.expectAsksRecommendation === "boolean") {
      modelMetrics.asksRecommendationTotal += 1;
      if ((r.interpretation.requestedAction === "SUGGEST") === r.expectAsksRecommendation) modelMetrics.asksRecommendationCorrect += 1;
    }
    if (typeof r.expectReferenceResolved === "boolean") {
      systemMetrics.referenceTotal += 1;
      const resolved = Array.isArray(r.interpretation.references) && r.interpretation.references.length > 0;
      if (resolved === r.expectReferenceResolved) systemMetrics.referenceCorrect += 1;
    }
    if (typeof r.expectClarification === "boolean") {
      systemMetrics.clarificationTotal += 1;
      if (r.interpretation.clarificationRequired === r.expectClarification) systemMetrics.clarificationCorrect += 1;
    }
  }

  console.log(`\nliveLlmCalls (source===MERGED, i.e. an actual Bedrock Converse call happened): ${liveLlmCalls}/${results.length}`);
  console.log("\n=== MODEL metrics (label: PRODUCTION_PATH_HYBRID_V1 -- NOT directly comparable to HISTORICAL_OFFLINE_13_FIELD numbers) ===");
  console.log(JSON.stringify(modelMetrics, null, 2));
  console.log("\n=== SYSTEM metrics ===");
  console.log(JSON.stringify(systemMetrics, null, 2));

  const fs = await import("node:fs");
  const outDir = "../../../training/semantic-qwen3-4b/outputs/v2.3a7-production-contract-alignment";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/production_path_baseline_results.json`, JSON.stringify({ label: "PRODUCTION_PATH_HYBRID_V1", liveBedrock: true, liveLlmCalls, totalCases: results.length, results, modelMetrics, systemMetrics }, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
