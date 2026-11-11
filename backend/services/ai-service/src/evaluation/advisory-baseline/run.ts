import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { QUESTIONS, auditCorpus, fixtureContext, fixtureReview, inspectCurrentPrompt } from "./baseline";
import { retriever } from "../../llm/retriever";
import { interpretationDeps, validateInterpretationNarration } from "../../conversational-intelligence/global/personalized-interpretation";
import { buildKnowledgeContext } from "../../llm/knowledge-source";
import { NARRATION_BUDGET } from "../../llm/json_llm_call.util";
import { LLM_MODEL, LLM_PROVIDER } from "../../services/llm.service";
import { EMBEDDING_PROVIDER, EMBEDDING_VECTOR_SIZE } from "../../services/embedding-config";
import { getVectorStore } from "../../vector-store/provider";

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--live-retrieval", "--live-generation"]);
  for (const arg of args) if (!allowed.has(arg) && !arg.startsWith("--out=")) throw new Error(`Unknown option: ${arg}`);
  const liveRetrieval = args.includes("--live-retrieval");
  const liveGeneration = args.includes("--live-generation");
  const rootCandidates = [process.cwd(), path.resolve(process.cwd(), "../../..")];
  const root = rootCandidates.find((candidate) => fs.existsSync(path.join(candidate, "data/processed/evidence")));
  if (!root) throw new Error("Run from repo root or ai-service; data/processed/evidence is required");
  const corpusDir = path.join(root, "data/processed/evidence");
  const records: Array<{ file: string; value: Record<string, unknown> }> = [];
  const hash = createHash("sha256");
  for (const file of fs.readdirSync(corpusDir).filter((name) => name.endsWith(".jsonl")).sort()) {
    const bytes = fs.readFileSync(path.join(corpusDir, file));
    hash.update(file).update("\0").update(bytes).update("\0");
    for (const line of bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim())) {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid chunk in ${file}`);
      records.push({ file, value: value as Record<string, unknown> });
    }
  }
  const retrievalRows: unknown[] = [];
  // Frozen diagnostic inputs, not a fresh held-out benchmark; no threshold verdict.
  if (liveRetrieval) for (const question of QUESTIONS.slice(0, 3)) {
    const started = Date.now();
    try {
      const result = await retriever.retrieveForChat(question);
      retrievalRows.push({ question, latencyMs: Date.now() - started,
        outcome: result.isEmpty ? "empty_or_internal_error" : "hit", reason: result.reason ?? null,
        documents: result.documents.map((doc) => ({ id: doc.id, source: doc.source, score: doc.score })),
        typedKnowledgeItems: buildKnowledgeContext(result.documents).length });
    } catch (error) {
      retrievalRows.push({ question, latencyMs: Date.now() - started, outcome: "error", errorKind: error instanceof Error ? error.name : "UnknownError" });
    }
  }
  let generation: unknown = { status: "NOT_RUN", reason: "Use --live-generation for one real call with synthetic facts/evidence." };
  if (liveGeneration) {
    const started = Date.now();
    // Calls the existing bounded production helper; does not enable its rollout flags.
    const context = fixtureContext(), review = fixtureReview();
    const interpretation = await interpretationDeps.narrate(context, review, "synthetic-evaluation");
    generation = { evidence: "REAL HTTP/API + TEST FIXTURE", scope: "generation component only; synthetic facts and reference; not an authenticated journey",
      latencyMs: Date.now() - started, status: interpretation ? "CANDIDATE_RETURNED" : "NO_VALID_CANDIDATE",
      llmCalled: true,
      interpretation, validation: interpretation ? validateInterpretationNarration(interpretation, context, review) : null,
      failureClassification: interpretation ? null : "provider_or_parse_or_schema_failure; see redacted runtime logs for the error class",
      reasoningQuality: "NOT_SCORED", scientificCorrectness: "NOT_SCORED",
      budget: { ...NARRATION_BUDGET, numPredict: 260 } };
  }
  const report = {
    generatedAt: new Date().toISOString(), status: "DIAGNOSTIC_BASELINE_NOT_A_QUALITY_SIGNOFF",
    runtime: { provider: LLM_PROVIDER, model: LLM_MODEL, embeddingProvider: EMBEDDING_PROVIDER,
      embeddingDimensions: EMBEDDING_VECTOR_SIZE, vectorStore: getVectorStore().provider,
      flags: Object.fromEntries(["RAG_RETRIEVAL_V2", "GYMINI_UNIFIED_AI_COACH", "CONVERSATIONAL_INTELLIGENCE_V2"].map((key) => [key, process.env[key] ?? "unset (code default applies)"])) },
    codeHashes: Object.fromEntries([
      "conversational-intelligence/global/personalized-interpretation.ts",
      "conversational-intelligence/global/router.ts", "llm/retriever.ts", "llm/retrieval-v2.ts",
      "services/llm.service.ts", "evaluation/advisory-baseline/baseline.ts", "evaluation/advisory-baseline/run.ts",
    ].map((file) => [file, createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "../..", file))).digest("hex")])),
    diagnostics: inspectCurrentPrompt(), corpus: { ...auditCorpus(records), directory: corpusDir, sha256: hash.digest("hex") },
    runtimeRetrieval: { status: liveRetrieval ? "EXECUTED" : "NOT_RUN", evidence: liveRetrieval ? "REAL HTTP/API" : null,
      scope: "Existing retrieveForChat with current process flags/providers; no quality labels or corpus writes. Legacy retrieval can swallow provider errors as empty.", rows: retrievalRows },
    generation,
  };
  const out = path.resolve(root, args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "artifacts/ai-advisory-baseline/baseline.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: out, chunks: records.length, runtime: report.runtime,
    runtimeRetrieval: report.runtimeRetrieval.status, generation, status: report.status }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.name : "BaselineError"); process.exitCode = 1; });
