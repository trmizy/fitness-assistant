/** Offline CLI. No production service/provider, model, embedding or DB import. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ARMS, POLICY_VARIANTS, SETTINGS, groundCandidate, runDevSlice } from "./pipeline";
import { createFixtureIo, prepareCorpus } from "./retrieval";
import { createScriptedMock, devCases } from "./fixtures";
import { EVAL_PROTOCOL, measureDevResult } from "./evaluation";

export async function runMockExperiment() {
  const root = path.resolve(__dirname, "../../../../../.."), data = path.join(root, "data/eval/advisory-progress-dev");
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(data, name), "utf8"));
  const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"));
  const cases = devCases(), provider = createScriptedMock(), fixture = createFixtureIo(corpus);
  const results = [], postGate = [];
  for (let repetition = 0; repetition < EVAL_PROTOCOL.repetitions; repetition++) for (const c of cases) for (const policy of POLICY_VARIANTS) {
    const settings = { ...SETTINGS, seed: 17 + repetition };
    for (const arm of ARMS) {
      const result = await runDevSlice(c.request, arm, { corpus, provider, io: fixture.io }, { policy, settings });
      results.push({ ...result, repetition, metrics: measureDevResult(c, result) });
      if (arm === "FIVE_LAYER_CONTEXT_RAG") {
        const grounded = groundCandidate(result);
        postGate.push({ ...grounded, repetition, metrics: measureDevResult(c, grounded) });
      }
    }
  }
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const rag = results.filter((r) => r.arm === "FIVE_LAYER_CONTEXT_RAG");
  return {
    manifest: { mode: "MOCK_PROTOCOL_ONLY", modelEvaluation: "NOT_RUN", embeddingCalls: 0, mockCalls: provider.calls(), ...fixture.counters(),
      arms: ARMS, policies: POLICY_VARIANTS, repetitions: EVAL_PROTOCOL.repetitions, caseCount: cases.length,
      historicalReference: EVAL_PROTOCOL.historicalReference, caseSha256: hash(cases), corpusSha256: hash(corpus), promptSha256: hash(results.map((r) => r.prompt)),
      codeSha256: hash(["context.ts", "retrieval.ts", "pipeline.ts", "review.ts", "fixtures.ts", "evaluation.ts", "run.ts"].map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")])),
      sourceFileSha256: Object.fromEntries(["evidence-pack.json", "evidence-claim-map-v2.json"].map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(data, name))).digest("hex")])),
      limitations: ["Mock always abstains, copies visible projections, and has no label/case lookup", "DEV cases are implementer-authored, not independent held-out", "CPU fixture scores are not vector retrieval evaluation", "Semantic/model quality remains NOT_EVALUATED"],
    },
    rawVsPostGate: { generatedRag: rag.length, rawContractEligible: rag.filter((r) => r.release === "DEV_REVIEW_ONLY").length,
      postGateEligible: postGate.filter((r) => r.release === "DEV_REVIEW_ONLY").length, blocked: postGate.filter((r) => r.release === "BLOCKED").length,
      coverage: rag.length ? postGate.filter((r) => r.release === "DEV_REVIEW_ONLY").length / rag.length : null,
      rawCorrectness: null, postGateCorrectness: null },
    protocol: EVAL_PROTOCOL, cases, results, postGate,
  };
}
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--mock")) throw new Error("Only --mock is supported; live inference is not implemented");
  process.stdout.write(JSON.stringify(await runMockExperiment(), null, 2) + "\n");
}
if (require.main === module) main().catch((e) => { process.stderr.write(e.message + "\n"); process.exitCode = 1; });
