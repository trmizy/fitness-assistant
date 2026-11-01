/** Offline CLI. No production service/provider, model, embedding or DB import. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ARMS, POLICY_VARIANTS, SETTINGS, groundCandidate, runDevSlice } from "./pipeline";
import { createFixtureIo, prepareCorpus } from "./retrieval";
import { createScriptedMock, devCases } from "./fixtures";
import { EVAL_PROTOCOL, measureDevResult } from "./evaluation";
import type { V2Io } from "../../llm/retrieval-v2";

export async function runMockExperiment() {
  const root = path.resolve(__dirname, "../../../../../.."), data = path.join(root, "data/eval/advisory-progress-dev");
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(data, name), "utf8"));
  const supplement = JSON.parse(fs.readFileSync(path.join(root, "data/eval/ai-coach-dev/corpus-supplement.json"), "utf8"));
  const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"), supplement);
  const reviewProtocol = JSON.parse(fs.readFileSync(path.join(root, "data/eval/ai-coach-dev/evaluation-protocol.json"), "utf8"));
  const cases = devCases(), provider = createScriptedMock();
  let fixtureSearches = 0;
  const fixtures = cases.map((c) => createFixtureIo(c.evaluationOnly.retrievalCondition === "SOURCE_ABLATION"
    ? corpus.map((p) => ({ ...p, excerpts: p.excerpts.filter((e) => e.id !== "LOAD_HYPERTROPHY_RESULT") }))
    : c.evaluationOnly.retrievalCondition === "SYNTHETIC_CONFLICT_ONLY" ? corpus.filter((p) => p.source.sourceClass !== "CURATED_EVIDENCE") : corpus));
  const results = [], postGate = [];
  for (let repetition = 0; repetition < EVAL_PROTOCOL.repetitions; repetition++) for (const c of cases) for (const policy of POLICY_VARIANTS) {
    const settings = { ...SETTINGS, seed: 17 + repetition };
    const baseIo = fixtures[cases.indexOf(c)].io;
    const io: V2Io = { ...baseIo, async search(...args) { fixtureSearches++;
      if (c.evaluationOnly.retrievalCondition === "NO_MATCH") return [];
      if (c.evaluationOnly.retrievalCondition === "UNAVAILABLE") throw new Error("Injected DEV retrieval outage");
      return baseIo.search(...args);
    } };
    // Deterministic rotation counterbalances request order while preserving paired settings.
    const offset = (cases.indexOf(c) + repetition) % ARMS.length;
    for (const arm of [...ARMS.slice(offset), ...ARMS.slice(0, offset)]) {
      const result = await runDevSlice(c.request, arm, { corpus, provider, io }, { policy, settings });
      results.push({ ...result, repetition, metrics: measureDevResult(c, result) });
      if (arm === "LAYERED_CONTEXT_RAG") {
        const grounded = groundCandidate(result);
        postGate.push({ ...grounded, repetition, metrics: measureDevResult(c, grounded) });
      }
    }
  }
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const ragAttempts = results.filter((r) => r.arm === "LAYERED_CONTEXT_RAG");
  const rag = ragAttempts.filter((r) => r.generationCalls > 0);
  const firstRagByCase = [...new Map(ragAttempts.map((r) => [r.caseId, r])).values()];
  return {
    manifest: { mode: "MOCK_PROTOCOL_ONLY", readiness: "PREPARED_PENDING_INDEPENDENT_REVIEW", modelEvaluation: "NOT_RUN", embeddingCalls: 0, modelCalls: 0, vectorDbCalls: 0, mockCalls: provider.calls(), fixtureSearches,
      arms: ARMS, policies: POLICY_VARIANTS, repetitions: EVAL_PROTOCOL.repetitions, caseCount: cases.length,
      historicalReference: EVAL_PROTOCOL.historicalReference, caseSha256: hash(cases), corpusSha256: hash(corpus), promptSha256: hash(results.map((r) => r.prompt)),
      codeSha256: hash(["context.ts", "retrieval.ts", "pipeline.ts", "review.ts", "fixtures.ts", "evaluation.ts", "run.ts"].map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")])),
      sourceFileSha256: Object.fromEntries(["evidence-pack.json", "evidence-claim-map-v2.json"].map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(data, name))).digest("hex")])),
      supplementSha256: hash(supplement), reviewProtocolSha256: hash(reviewProtocol),
      reusedCodeSha256: hash(["../../llm/fitness-concepts.ts", "../../llm/retrieval-v2.ts", "../../llm/knowledge-source.ts", "../../llm/safety-signals.ts", "../../llm/safety-narrative.ts", "../../llm/safety_guard.ts", "../advisory-progress/content-aware-v3.ts", "../advisory-progress/content-aware-v3-facts.ts", "../advisory-progress/outcome-support.ts", "../advisory-progress/content-aware-v3-language.ts", "../advisory-progress/content-aware-v3-schema.ts"].map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")])),
      limitations: ["Mock always abstains, copies visible projections, and has no label/case lookup", "DEV cases are implementer-authored, not independent held-out", "CPU fixture scores are not vector retrieval evaluation", "Semantic/model quality remains NOT_EVALUATED"],
    },
    rawVsPostGate: { attemptedRag: ragAttempts.length, preGenerationRouted: ragAttempts.length - rag.length, safetyRouted: ragAttempts.filter((r) => r.safetyHandling.action === "SAFETY_HANDLING_REQUIRED").length, outOfDomainRouted: ragAttempts.filter((r) => r.safetyHandling.action === "OUT_OF_DOMAIN_HANDLING_REQUIRED").length, generatedRag: rag.length, rawContractEligible: rag.filter((r) => r.release === "DEV_REVIEW_ONLY").length,
      postGateEligible: postGate.filter((r) => r.release === "DEV_REVIEW_ONLY").length, blocked: postGate.filter((r) => r.release === "BLOCKED").length,
      coverage: rag.length ? postGate.filter((r) => r.release === "DEV_REVIEW_ONLY").length / rag.length : null,
      rawCorrectness: null, postGateCorrectness: null },
    retrievalCoverage: { label: "DEV_STATUS_COVERAGE_NOT_SEMANTIC_RECALL", cases: firstRagByCase.map((r) => ({ caseId: r.caseId, status: r.evidence.status, excerptIds: r.evidence.passages.flatMap((p) => p.excerpts.map((e) => e.id)) })),
      statusCounts: Object.fromEntries([...new Set(firstRagByCase.map((r) => r.evidence.status))].map((status) => [status, firstRagByCase.filter((r) => r.evidence.status === status).length])), independentlyJudgedRelevance: null },
    protocol: EVAL_PROTOCOL, reviewProtocol, cases, results, postGate,
  };
}
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--mock")) throw new Error("Only --mock is supported; live inference is not implemented");
  process.stdout.write(JSON.stringify(await runMockExperiment(), null, 2) + "\n");
}
if (require.main === module) main().catch((e) => { process.stderr.write(e.message + "\n"); process.exitCode = 1; });
