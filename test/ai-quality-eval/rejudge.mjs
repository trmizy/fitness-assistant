// Re-grades the answers stored in result files with the shared judge (judge.mjs, default Claude Opus 4.6), writing
// <file>.judged-<model>.json next to each input. No call to the system under test.
// Usage: node test/ai-quality-eval/rejudge.mjs <result.json> [...]   (AIQ_CASES selects the case file, AIQ_JUDGE_MODEL the judge)
import fs from "node:fs";
import path from "node:path";
import { judgeAnswer, JUDGE_MODEL, priceOf } from "./judge.mjs";

const root = process.cwd();
const spec = JSON.parse(fs.readFileSync(path.join(root, process.env.AIQ_CASES || "test/ai-quality-eval/nutrition-cases.json"), "utf8"));
const byId = Object.fromEntries(spec.cases.map((c) => [c.id, c]));
const price = priceOf(JUDGE_MODEL), tag = JUDGE_MODEL.replace(/[^a-z0-9]+/gi, "-");
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  let tin = 0, tout = 0;
  for (const r of j.results) {
    const c = byId[r.id]; if (!c) continue;
    // newer runs store the full 7-day summary (planSummary); older runs only kept day 1, which the judge must not read as a cut-off plan
    const answer = r.plan ? `${r.answer}\n\n[PLAN PREVIEW — ${r.plan.summaryText ? "all days" : "day 1 sample only (stored by an older harness)"}]\n${r.plan.summaryText ?? JSON.stringify(r.plan).slice(0, 3000)}` : r.answer;
    const out = await judgeAnswer({ root, c, persona: { ...j.personas[r.persona], label: j.personas[r.persona]?.label ?? spec.personas[r.persona]?.label }, answer });
    r.judge = out.scores; tin += out.inputTokens; tout += out.outputTokens;
    process.stdout.write(".");
  }
  const outFile = f.replace(/\.json$/, `.judged-${tag}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ ...j, rejudgedAt: new Date().toISOString(), judgeModel: JUDGE_MODEL, judgeUsage: { inputTokens: tin, outputTokens: tout, estUsd: (tin / 1000) * price.in + (tout / 1000) * price.out } }, null, 2));
  console.log(`\n${path.basename(f)} -> ${path.basename(outFile)} ($${((tin / 1000) * price.in + (tout / 1000) * price.out).toFixed(2)})`);
}
