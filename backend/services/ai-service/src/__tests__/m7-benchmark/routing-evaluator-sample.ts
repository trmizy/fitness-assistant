/**
 * M8-A4 — writes SAMPLE reports from the SYNTHETIC fixture (JSON + text) into <worktree>/.agent-evidence/. OFFLINE; fake models only.
 * Every report is stamped "SYNTHETIC — not a G7/G8 result". Run: npx tsx src/__tests__/m7-benchmark/routing-evaluator-sample.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBudgetGuard, createFakeRoutingModel } from "./routing-evaluator-budget";
import { createDeterministicAdapter, createHybridSelectiveAdapter, createModelAlwaysAdapter, runSystem, type RoutingSystemAdapter } from "./routing-evaluator-adapters";
import { evaluateDataset, renderTextReport } from "./routing-evaluator";
import { syntheticDatasetJsonl, syntheticModelAnswers, syntheticOutcomes, syntheticRows } from "./routing-evaluator-fixture";
import type { BudgetGuard } from "./routing-evaluator-budget";

const OUT = resolve(__dirname, "../../../../../../.agent-evidence");
const limits = { maxCalls: 100, maxInputTokens: 200_000, maxOutputTokens: 10_000, maxCostUsd: 1 };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const jsonl = syntheticDatasetJsonl();
  const cases = syntheticRows().map((r) => ({ id: r.id, question: r.question }));
  const runs: Array<{ name: string; outcomes: unknown[]; guard?: BudgetGuard }> = [{ name: "replay-synthetic-outcomes", outcomes: syntheticOutcomes() }];
  const sys: Array<[string, RoutingSystemAdapter & { guard?: BudgetGuard }]> = [
    ["A-deterministic", createDeterministicAdapter()],
    ["B-model-always-FAKE", createModelAlwaysAdapter({ model: createFakeRoutingModel(syntheticModelAnswers()), guard: createBudgetGuard(limits) })],
    ["C-hybrid-selective-FAKE", createHybridSelectiveAdapter({ model: createFakeRoutingModel(syntheticModelAnswers()), guard: createBudgetGuard(limits) })],
  ];
  for (const [name, a] of sys) runs.push({ name, outcomes: await runSystem(a, cases), guard: a.guard });
  for (const r of runs) {
    const res = evaluateDataset(jsonl, r.outcomes, { system: r.name, validate: { checkDistribution: false, checkBenchmarkOverlap: true }, budget: r.guard?.snapshot() ?? null });
    if (!res.ok) throw new Error(`${r.name}: ${res.stage} ${JSON.stringify(res.errors)}`);
    writeFileSync(resolve(OUT, `routing-eval-sample-${r.name}.json`), JSON.stringify(res.report, null, 2) + "\n");
    writeFileSync(resolve(OUT, `routing-eval-sample-${r.name}.txt`), renderTextReport(res.report));
    console.log(`${r.name}: G7 ${res.report.gates.G7.verdict} ${res.report.gates.G7.ratio.num}/${res.report.gates.G7.ratio.den}; G8 ${res.report.gates.G8.verdict} ${res.report.gates.G8.ratio.num}/${res.report.gates.G8.ratio.den}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
