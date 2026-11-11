import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { llmService, LLM_MODEL, LLM_PROVIDER } from "../../services/llm.service";
import { extractFirstJsonObject } from "../../llm/json_llm_call.util";
import { AnswerSchema, EvidencePackSchema, VerificationSchema, VARIANTS, buildAdvisoryPrompt, buildVerificationPrompt, checkAnswer, type Answer, type Variant } from "./experiment";
import { RUBRIC_VERSION, scenarios, scoreScenario } from "./scenarios";
import { GUARDED_VERSION, buildGuardedPrompt, buildErrorAwareVerification, contextualAnswerSchema, contextualVerificationSchema } from "./guarded";

type CallRecord = { latencyMs: number; promptTokens: number; completionTokens: number; errorKind: string | null; validationIssues?: Array<{ path: string; code: string }> };
const OPTIONS = { responseFormat: "json", temperature: 0.2, numPredict: 2048, timeoutMs: 20000, purpose: "GENERAL_QA" } as const;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function invoke<T>(prompt: { system: string; user: string }, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<{ value: T | null; rejectedCandidate: unknown; call: CallRecord }> {
  const started = Date.now();
  const call: CallRecord = { latencyMs: 0, promptTokens: 0, completionTokens: 0, errorKind: null };
  let rejectedCandidate: unknown = null;
  try {
    const response = await llmService.callLLM(prompt.user, { ...OPTIONS, systemPrompt: prompt.system });
    call.promptTokens = response.promptTokens; call.completionTokens = response.completionTokens;
    // All inputs in this runner are synthetic. Bound text retained for a one-shot repair,
    // never quote provider exceptions or credentials. Structured rejected JSON stays auditable.
    rejectedCandidate = { unparsedText: response.answer.slice(0, 8000), truncated: response.answer.length > 8000 };
    const object = extractFirstJsonObject(response.answer);
    if (!object) throw new Error("MissingJsonObject");
    rejectedCandidate = JSON.parse(object) as unknown;
    const value = schema.parse(rejectedCandidate);
    call.latencyMs = Date.now() - started;
    return { value, rejectedCandidate: null, call };
  } catch (error) {
    call.errorKind = error instanceof Error ? error.name : "UnknownError";
    // Keep schema diagnostics without recording provider errors or quoting arbitrary model text.
    if (error instanceof z.ZodError) call.validationIssues = error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
    call.latencyMs = Date.now() - started;
    return { value: null, rejectedCandidate, call };
  }
}

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args) if (arg !== "--live" && !arg.startsWith("--out-dir=") && !arg.startsWith("--treatment=")) throw new Error("UnknownArgument");
  const live = args.includes("--live");
  const treatment = args.find((arg) => arg.startsWith("--treatment="))?.slice(12) ?? "original";
  if (treatment !== "original" && treatment !== "guarded") throw new Error("UnknownTreatment");
  const guarded = treatment === "guarded";
  if (live && LLM_PROVIDER !== "bedrock") throw new Error("BedrockRequired_NoModelCallMade");
  const root = [process.cwd(), path.resolve(process.cwd(), "../../..")].find((candidate) => fs.existsSync(path.join(candidate, "data/eval/advisory-progress-dev/evidence-pack.json")));
  if (!root) throw new Error("RepositoryDataNotFound");
  const sourceBytes = fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev/evidence-pack.json"));
  const pack = EvidencePackSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  const cases = scenarios(pack.sources);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(root, args.find((arg) => arg.startsWith("--out-dir="))?.slice(10) ?? `artifacts/ai-advisory-progress/${stamp}`);
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw new Error("OutputDirectoryNotEmpty_NoArtifactsOverwritten");
  fs.mkdirSync(outDir, { recursive: true });
  const requests = cases.flatMap((scenario) => VARIANTS.map((variant) => ({ id: scenario.id, variant, prompt: guarded ? buildGuardedPrompt(scenario.input, variant) : buildAdvisoryPrompt(scenario.input, variant) })));
  const manifest = {
    createdAt: new Date().toISOString(), status: live ? "LIVE_DEVELOPMENT_DIAGNOSTIC" : "PREPARED_NO_MODEL_CALLS",
    scope: "Generation-only A–D, frozen evidence, synthetic personal facts, no retrieval or production integration",
    dataAuthority: "ASSISTANT_AUTHORED_DEV_NOT_INDEPENDENT_HELDOUT", sourceReviewAuthority: pack.reviewAuthority,
    treatment: guarded ? GUARDED_VERSION : "original-v1",
    runtime: { provider: LLM_PROVIDER, model: LLM_MODEL, region: process.env.BEDROCK_REGION ?? null },
    options: OPTIONS, applicationAttemptsPerCall: 1, maximumApplicationCalls: cases.length * 6,
    experiment: { A: "zero-shot", B: "few-shot", C: "zero-shot + one model verification", D: "few-shot + one model verification" },
    corpusSha256: digest(sourceBytes), scenariosSha256: digest(JSON.stringify(cases)), requestsSha256: digest(JSON.stringify(requests)),
    codeHashes: Object.fromEntries(["experiment.ts", "scenarios.ts", "run.ts", "guarded.ts"].map((file) => [file, digest(fs.readFileSync(path.join(__dirname, file)))])),
    rubricVersion: RUBRIC_VERSION,
    scoring: "Contract/ID/numeric checks and expected assessment/questions only; no automatic scientific entailment or clinical correctness score",
    thresholds: { diagnosticContractTarget: 1, productionAdoption: "NOT_AUTHORIZED_BY_THIS_EXPERIMENT" },
    limitations: ["No randomization or repeated trials; fixed A/B/C/D order; six development cases, not statistical evidence of generalization.",
      "Model verification is a treatment, not an independent gold label.", "Both retrieved evidence and examples are fixed; this does not evaluate retriever quality.",
      "No user data, persisted actions, deployment flags, DB or corpus/index writes."],
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requests, null, 2) + "\n");
  if (!live) { console.log(JSON.stringify({ outDir, status: manifest.status, cases: cases.length, variants: VARIANTS.length, maximumCalls: manifest.maximumApplicationCalls })); return; }
  const results: Array<{
    id: string; family: string; variant: Variant; calls: CallRecord[];
    initialCandidate: Answer | null; finalCandidate: Answer | null;
    initialRejectedCandidate: unknown;
    verification: z.infer<typeof VerificationSchema> | null;
    initialIssues: string[]; finalIssues: string[];
    contractScore: ReturnType<typeof scoreScenario> | null; contractPass: boolean;
    latencyMs: number;
  }> = [];
  // Preserve partial artifacts immediately. Errors stay in denominator; no retries or tuning on this run.
  const resultFile = path.join(outDir, "results.jsonl");
  fs.writeFileSync(resultFile, "");
  for (const scenario of cases) for (const variant of VARIANTS) {
    const started = Date.now();
    const generated = await invoke(guarded ? buildGuardedPrompt(scenario.input, variant) : buildAdvisoryPrompt(scenario.input, variant), guarded ? contextualAnswerSchema(scenario.input) : AnswerSchema);
    const calls = [generated.call];
    const initialIssues = generated.value ? checkAnswer(scenario.input, generated.value) : ["generation_failed"];
    let finalCandidate = generated.value;
    let verification: z.infer<typeof VerificationSchema> | null = null;
    const verificationRequired = variant === "C" || variant === "D";
    const repairableCandidate = generated.value ?? generated.rejectedCandidate;
    if (verificationRequired && (guarded ? repairableCandidate !== null : generated.value !== null)) {
      const feedback = { checks: initialIssues, schemaIssues: generated.call.validationIssues ?? [] };
      const prompt = guarded ? buildErrorAwareVerification(scenario.input, repairableCandidate, feedback) : buildVerificationPrompt(scenario.input, generated.value!);
      const verified = await invoke(prompt, guarded ? contextualVerificationSchema(scenario.input, feedback) : VerificationSchema);
      calls.push(verified.call); verification = verified.value;
      if (verification?.verdict === "REVISE") finalCandidate = verification.revisedAnswer;
    }
    const finalIssues = finalCandidate ? checkAnswer(scenario.input, finalCandidate) : ["generation_failed"];
    if (verificationRequired && (!verification || verification.verdict === "UNCERTAIN")) finalIssues.push("verification_not_resolved");
    const contractScore = finalCandidate ? scoreScenario(scenario, finalCandidate) : null;
    const row = { id: scenario.id, family: scenario.family, variant, calls, initialCandidate: generated.value,
      initialRejectedCandidate: generated.rejectedCandidate,
      finalCandidate, verification, initialIssues, finalIssues, contractScore,
      contractPass: finalIssues.length === 0 && contractScore !== null && Object.values(contractScore).every(Boolean),
      latencyMs: Date.now() - started };
    results.push(row);
    fs.appendFileSync(resultFile, JSON.stringify(row) + "\n");
    console.log(JSON.stringify({ id: row.id, variant, contractPass: row.contractPass, latencyMs: row.latencyMs }));
  }
  const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null;
  const summary = VARIANTS.map((variant) => {
    const rows = results.filter((row) => row.variant === variant);
    return { variant, cases: rows.length, contractPasses: rows.filter((row) => row.contractPass).length,
      schemaCandidates: rows.filter((row) => row.finalCandidate !== null).length,
      linkageAndNumericPasses: rows.filter((row) => row.finalCandidate && checkAnswer(cases.find((scenario) => scenario.id === row.id)!.input, row.finalCandidate).length === 0).length,
      applicationCalls: rows.reduce((sum, row) => sum + row.calls.length, 0),
      errors: rows.flatMap((row) => row.calls).filter((call) => call.errorKind).length,
      promptTokens: rows.flatMap((row) => row.calls).reduce((sum, call) => sum + call.promptTokens, 0),
      completionTokens: rows.flatMap((row) => row.calls).reduce((sum, call) => sum + call.completionTokens, 0),
      observedP50Ms: percentile(rows.map((row) => row.latencyMs), 0.5), observedP95Ms: percentile(rows.map((row) => row.latencyMs), 0.95) };
  });
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ status: "DEV_DIAGNOSTIC_NOT_QUALITY_SIGNOFF", summary,
    scientificEntailment: "NOT_SCORED", independentHumanReview: "NOT_RUN", generalization: "NOT_MEASURED" }, null, 2) + "\n");
  console.log(JSON.stringify({ outDir, summary }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "ExperimentError"); process.exitCode = 1; });
