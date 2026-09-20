// CI gate: run the UNCHANGED Codex conversational-workflow v2 evaluator and require every case PASS (30/30).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const evaluator = "backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts";
const resultFile = "backend/services/ai-service/src/evaluation/conversational-workflow-v2/results/conversational-workflow-evaluation-2.json";
const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", evaluator], { stdio: "ignore" });
if (run.status !== 0) { console.error("evaluator process exited", run.status); process.exit(1); }
const result = JSON.parse(readFileSync(resultFile, "utf8"));
const bad = result.cases.filter((c) => c.status !== "PASS");
if (bad.length > 0) { console.error("foundation evaluator not all PASS:", bad.map((c) => c.id ?? c.name)); process.exit(1); }
console.log(`foundation evaluator ${result.cases.length}/${result.cases.length} PASS`);
