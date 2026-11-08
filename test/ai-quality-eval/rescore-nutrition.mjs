// Re-applies the CURRENT text-only checks (checks.mjs + nutrition-cases.json) to the answers stored in one or more result
// files, keeps live-only checks (goal re-read, plan preview) as recorded, and prints a side-by-side comparison.
// No HTTP / no model calls. Usage: node test/ai-quality-eval/rescore-nutrition.mjs <result.json> [<result.json> ...]
import fs from "node:fs";
import path from "node:path";
import { textChecks, LIVE_CHECK } from "./checks.mjs";

const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), process.env.AIQ_CASES || "test/ai-quality-eval/nutrition-cases.json"), "utf8"));
const byId = Object.fromEntries(spec.cases.map((c) => [c.id, c]));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const JK = ["correctness", "relevance", "personalization", "safety", "clarity"];
const rows = [];
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const results = j.results.filter((r) => byId[r.id]).map((r) => {
    const c = byId[r.id], persona = j.personas[r.persona];
    const checks = [...textChecks(c, persona, r.answer, r.status), ...r.checks.filter((x) => LIVE_CHECK.test(x.name))];
    const passed = checks.filter((x) => x.pass).length;
    return { ...r, checks, passed, total: checks.length, casePass: passed === checks.length };
  });
  const cats = [...new Set(results.map((r) => r.category))];
  const summary = { label: j.label, file: path.basename(f), cases: results.length, casePassRate: mean(results.map((r) => +r.casePass)), checkPassRate: results.reduce((a, r) => a + r.passed, 0) / results.reduce((a, r) => a + r.total, 0),
    fallbackRate: mean(results.map((r) => +r.usedFallback)), medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)],
    judgeMean: Object.fromEntries(JK.map((k) => [k, mean(results.map((r) => r.judge?.[k]).filter(Number.isFinite))])), estCostUsd: j.summary?.estCostUsd ?? j.estCostUsd,
    byCategory: Object.fromEntries(cats.map((cat) => { const rs = results.filter((r) => r.category === cat); return [cat, { n: rs.length, casePass: mean(rs.map((r) => +r.casePass)), checkPass: rs.reduce((a, r) => a + r.passed, 0) / rs.reduce((a, r) => a + r.total, 0), fallback: mean(rs.map((r) => +r.usedFallback)), relevance: mean(rs.map((r) => r.judge?.relevance).filter(Number.isFinite)) }]; })),
    perCase: Object.fromEntries(results.map((r) => [r.id, { pass: r.casePass, passed: r.passed, total: r.total, fallback: r.usedFallback, failed: r.checks.filter((x) => !x.pass).map((x) => x.name) }])) };
  rows.push(summary);
  fs.writeFileSync(f.replace(/\.json$/, ".rescored.json"), JSON.stringify({ ...j, rescoredAt: new Date().toISOString(), summary, results }, null, 2));
}
const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) + "%" : "-"), f1 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");
console.log(["metric", ...rows.map((r) => r.label)].join(" | "));
for (const [k, fn] of [["case pass", (r) => pct(r.casePassRate)], ["check pass", (r) => pct(r.checkPassRate)], ["fallback rate", (r) => pct(r.fallbackRate)], ["median latency (ms)", (r) => r.medianMs], ["est. cost (USD)", (r) => f1(r.estCostUsd)],
  ...JK.map((k) => [`judge ${k}`, (r) => f1(r.judgeMean[k])])]) console.log([k, ...rows.map(fn)].join(" | "));
for (const cat of [...new Set(rows.flatMap((r) => Object.keys(r.byCategory)))]) console.log([`${cat} case/check/fallback/relevance`, ...rows.map((r) => { const b = r.byCategory[cat]; return b ? `${pct(b.casePass)} / ${pct(b.checkPass)} / ${pct(b.fallback)} / ${f1(b.relevance)}` : "-"; })].join(" | "));
console.log(JSON.stringify(Object.fromEntries(rows.map((r) => [r.label, r.perCase])), null, 0).slice(0, 4000));
