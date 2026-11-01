/** Explicit offline CLI: no production service, AWS, DB or embedding provider import. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ARMS, runDevSlice } from "./pipeline";
import { createFixtureIo, prepareCorpus } from "./retrieval";
import { createScriptedMock, devCases } from "./fixtures";
import { EVAL_PROTOCOL, measureDevResult } from "./evaluation";

export async function runMockExperiment() {
  const root = path.resolve(__dirname, "../../../../../..");
  const data = path.join(root, "data/eval/advisory-progress-dev");
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(data, name), "utf8"));
  const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"));
  const cases = devCases(), provider = createScriptedMock(cases);
  const fixture = createFixtureIo(corpus);
  const results = [];
  for (const c of cases) for (const arm of ARMS) {
    const result = await runDevSlice(c.request, arm, { corpus, provider, io: fixture.io });
    results.push({ ...result, metrics: measureDevResult(c, result) });
  }
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return { manifest: {
    mode: "MOCK_PROTOCOL_ONLY", modelEvaluation: "NOT_RUN", embeddingCalls: 0,
    mockCalls: provider.calls(), ...fixture.counters(), arms: ARMS, caseCount: cases.length,
    caseSha256: hash(cases), corpusSha256: hash(corpus), promptSha256: hash(results.map((r) => r.prompt)),
    codeSha256: hash(["context.ts", "retrieval.ts", "pipeline.ts", "review.ts", "fixtures.ts", "evaluation.ts", "run.ts"].map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")])),
    sourceFileSha256: Object.fromEntries(["evidence-pack.json", "evidence-claim-map-v2.json"].map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(data, name))).digest("hex")])),
    reusedCodeSha256: hash([
      "../../llm/retrieval-v2.ts", "../../llm/knowledge-source.ts", "../../llm/fitness-concepts.ts", "../../llm/safety-signals.ts",
      "../advisory-progress/experiment.ts", "../advisory-progress/guarded.ts", "../advisory-progress/source-ablation-v3.ts", "../advisory-progress/content-review.ts",
      "../advisory-progress/content-aware-v3.ts", "../advisory-progress/content-aware-v3-schema.ts", "../advisory-progress/content-aware-v3-facts.ts", "../advisory-progress/content-aware-v3-language.ts",
    ].map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")])),
    limitations: ["Scripted mock uses implementer-authored answers and labels", "Sources are historical abstract excerpts, not an updated expert-reviewed corpus", "CPU fixture lookup is not vector retrieval evaluation", "No production or model performance validation"],
  }, protocol: EVAL_PROTOCOL, cases, results };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--mock")) throw new Error("Only --mock is supported; live inference is not implemented");
  const experiment = await runMockExperiment();
  // Stdout is reviewable and never overwrites artifacts. Redirect to a fresh ignored artifact if desired.
  process.stdout.write(JSON.stringify(experiment, null, 2) + "\n");
}
if (require.main === module) main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
