// Primary entry point for the workout-BPM research run. Stage-gated: each stage refuses to run if an earlier required
// stage did not succeed, and every stage writes machine-readable status into an immutable run directory.
// Usage: node test/research/workout-plan-bpm/run-experiments.mjs [--stage preflight]
// Exit codes: 0 ok, 1 assertion failure, 2 environment/model/tooling incomplete, 3 missing required repository path,
//             4 dataset/source integrity violation (incl. dataset construction blocked), 5 report-generation failure.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runPreflight } from "./lib/preflight.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const args = process.argv.slice(2);
const stage = args[args.indexOf("--stage") + 1] ?? "preflight";

const utcStamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const runId = args[args.indexOf("--run-id") + 1] ?? utcStamp();
const runDir = path.join(repoRoot, "results/research/workout-plan-bpm", runId);
if (fs.existsSync(runDir)) { console.error(`refusing to overwrite existing run ${runDir}`); process.exit(4); }
for (const d of ["environment", "logs", "config-A", "config-B", "config-C", "frozen-150", "confirmation", "db", "metrics", "charts", "mermaid", "tables"])
  fs.mkdirSync(path.join(runDir, d), { recursive: true });

const writeJson = (rel, obj) => fs.writeFileSync(path.join(runDir, rel), JSON.stringify(obj, null, 2) + "\n");
const startedAt = new Date().toISOString();
const ledger = [];
const record = (id, command, status) => ledger.push({ id, command, startedAt: status.startedAt, endedAt: new Date().toISOString(), classification: status.classification });

const status = { runId, stage, overall: "IN_PROGRESS", startedAt, blockers: [], notes: [] };

// Stage: preflight -------------------------------------------------------------------------------------------------------
const pf = runPreflight(repoRoot);
const { porcelain, ...gitPublic } = pf.git;
fs.writeFileSync(path.join(runDir, "environment", "initial-git-porcelain.txt"), porcelain);
writeJson("environment/git.json", { ...gitPublic, porcelainFile: "environment/initial-git-porcelain.txt" });
writeJson("environment/runtime.json", {
  utc: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version, cpuCount: os.cpus().length,
  // Versions of tools that are NOT present are recorded as absent rather than guessed.
  pythonAvailable: false, pythonDocxAvailable: false, mermaidCliAvailable: false,
});

if (pf.problems.length) {
  status.overall = "BLOCKED"; status.exitCode = 3; status.blockers = pf.problems;
  writeJson("source-manifest.json", { docs: pf.docs, requiredPathsChecked: pf.problems.length === 0 });
  writeJson("run-status.json", { ...status, finishedAt: new Date().toISOString() });
  console.error(`MISSING_REQUIRED_PATH: ${pf.problems.length} item(s)`); process.exit(3);
}

writeJson("source-manifest.json", {
  docs: pf.docs, globCounts: pf.globCounts,
  definitionCounts: { functionalRequirements: pf.counts.functionalRequirements, exceptions: pf.counts.exceptions, acceptanceCriteria: pf.counts.acceptanceCriteria },
  definitionIds: { FR: pf.counts.frIds, EX: pf.counts.exIds, AC: pf.counts.acIds },
});
record("EV-CMD-001", "preflight: required docs/paths/globs, source hashes, git state", { startedAt, classification: "PREFLIGHT_OK" });
status.preflight = { result: "PASS", functionalRequirements: pf.counts.functionalRequirements, exceptions: pf.counts.exceptions, acceptanceCriteria: pf.counts.acceptanceCriteria };

// Stage: dataset construction is NOT performed here. The evaluation-plan document is parsed for the dataset contract and
// the blockers below are recorded so the frozen-150 dataset is never built on guessed labels.
const evalPlan = fs.readFileSync(path.join(repoRoot, "docs/research/workout-plan-bpm/11-qwen3-4b-evaluation-plan.md"), "utf8");
const categoryTargets = [...evalPlan.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/gm)].map((m) => ({ category: m[1].trim(), target: Number(m[2]) }))
  .filter((r) => r.category !== "Category" && !r.category.startsWith("-"));
const targetSum = categoryTargets.reduce((a, r) => a + r.target, 0);
const datasetBlockers = [];
if (targetSum !== 150) datasetBlockers.push({ code: "DATASET_LABEL_UNDERSPECIFIED", detail: `11-qwen3-4b-evaluation-plan.md per-category targets sum to ${targetSum}, but the same document and the research brief require exactly 150` });
const perCaseSemanticsUndefined = ["expected write behavior NO_WRITE|PENDING_ONLY|AUTHORIZED_WRITE per turn (not defined per utterance in any design document)",
  "expected BPM route/state outcome per turn (only FR/EX/AC defined; no utterance-level gold route)",
  "gold entity/slot values for ambiguous free-text categories (e.g. typo/slang, reference/anaphora) (no labeling rule defined)"];
for (const q of perCaseSemanticsUndefined) datasetBlockers.push({ code: "DATASET_LABEL_UNDERSPECIFIED", detail: q });
writeJson("frozen-150/dataset-blockers.json", { categoryTargets, targetSum, blockers: datasetBlockers });
record("EV-CMD-002", "parse 11-qwen3-4b-evaluation-plan.md dataset contract", { startedAt, classification: "DATASET_CONSTRUCTION_BLOCKED" });

status.dataset = { result: "BLOCKED", reason: "DATASET_LABEL_UNDERSPECIFIED", categoryTargetSum: targetSum, unresolved: datasetBlockers.length };
status.overall = "BLOCKED";
status.exitCode = 4;
status.blockers = datasetBlockers;
status.notes.push("Preflight passed. Experiments A/B/C, frozen-150 execution, and report generation were NOT started: they depend on the frozen dataset, which cannot be built without the decisions listed in blockers.");
fs.writeFileSync(path.join(runDir, "command-ledger.jsonl"), ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeJson("run-manifest.json", { runId, stage, repoRoot: "<repo>", startedAt, finishedAt: new Date().toISOString(), node: process.version });
writeJson("run-status.json", { ...status, finishedAt: new Date().toISOString() });
fs.mkdirSync(path.join(repoRoot, "results/research/workout-plan-bpm"), { recursive: true });
fs.writeFileSync(path.join(repoRoot, "results/research/workout-plan-bpm/LATEST.txt"), runId + "\n");
console.log(JSON.stringify({ runId, overall: status.overall, exitCode: status.exitCode, preflight: status.preflight, dataset: status.dataset }, null, 2));
process.exit(status.exitCode);
