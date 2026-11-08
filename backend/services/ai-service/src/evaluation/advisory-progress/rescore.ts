/** Rubric correction only. Reads preserved model outputs; makes zero model calls. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AnswerSchema, EvidencePackSchema, VARIANTS, buildAdvisoryPrompt, checkAnswer, type Answer, type Variant } from "./experiment";
import { scenarios, scoreScenario } from "./scenarios";

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].startsWith("--run-dir=")) throw new Error("Expected --run-dir=<preserved-run>");
  const root = [process.cwd(), path.resolve(process.cwd(), "../../..")].find((candidate) => fs.existsSync(path.join(candidate, "data/eval/advisory-progress-dev/evidence-pack.json")));
  if (!root) throw new Error("RepositoryDataNotFound");
  const runDir = path.resolve(root, args[0].slice(10));
  const output = path.join(runDir, "rescored-v1-1.json");
  if (fs.existsSync(output)) throw new Error("RescoreAlreadyExists_NoOverwrite");
  const sourceBytes = fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev/evidence-pack.json"));
  const corpusSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
  if (manifest.corpusSha256 !== corpusSha256) throw new Error("CorpusChanged_DoNotRescore");
  const pack = EvidencePackSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  const cases = scenarios(pack.sources);
  const reconstructedRequests = cases.flatMap((scenario) => VARIANTS.map((variant) => ({ id: scenario.id, variant, prompt: buildAdvisoryPrompt(scenario.input, variant) })));
  const requestHash = createHash("sha256").update(JSON.stringify(reconstructedRequests)).digest("hex");
  if (requestHash !== manifest.requestsSha256) throw new Error("PromptsOrInputsChanged_DoNotRescore");
  const bytes = fs.readFileSync(path.join(runDir, "results.jsonl"));
  const raw = bytes.toString("utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
    id: string; variant: Variant; finalCandidate: Answer | null; finalIssues: string[]; contractPass: boolean;
  });
  if (raw.length !== cases.length * VARIANTS.length) throw new Error("IncompleteRun");
  const seen = new Set<string>();
  const rows = raw.map((row) => {
    const key = `${row.id}:${row.variant}`;
    if (seen.has(key) || !VARIANTS.includes(row.variant)) throw new Error("InvalidOrDuplicateResult");
    seen.add(key);
    const scenario = cases.find((item) => item.id === row.id);
    if (!scenario) throw new Error("UnknownCase");
    const candidate = row.finalCandidate ? AnswerSchema.parse(row.finalCandidate) : null;
    const score = candidate ? scoreScenario(scenario, candidate) : null;
    const issues = candidate ? checkAnswer(scenario.input, candidate) : ["generation_failed"];
    // Preserve unresolved model verification as a failure; rubric correction cannot remove it.
    if (row.finalIssues.includes("verification_not_resolved")) issues.push("verification_not_resolved");
    return { id: row.id, variant: row.variant, originalContractPass: row.contractPass,
      correctedContractPass: issues.length === 0 && score !== null && Object.values(score).every(Boolean), score, issues };
  });
  const summary = VARIANTS.map((variant) => ({ variant, cases: cases.length,
    originalContractPasses: rows.filter((row) => row.variant === variant && row.originalContractPass).length,
    correctedContractPasses: rows.filter((row) => row.variant === variant && row.correctedContractPass).length }));
  const report = { status: "DEV_RUBRIC_CORRECTION_NOT_MODEL_IMPROVEMENT", generatedAt: new Date().toISOString(),
    correction: "v1 required all supplied facts even when attendance was irrelevant to the question. v1.1 requires F_PROGRESS for outcome questions and F_ADHERENCE for attendance-only. Inputs/prompts/responses unchanged; original summary retained.",
    corpusSha256, sourceResultsSha256: createHash("sha256").update(bytes).digest("hex"),
    correctedScenariosSha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
    modelCalls: 0, summary, rows };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, summary, modelCalls: 0 }, null, 2));
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "RescoreError"); process.exitCode = 1; }
