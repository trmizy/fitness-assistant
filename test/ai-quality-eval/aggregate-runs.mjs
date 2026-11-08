// Aggregates repeated runs of the same case file (e.g. v2-r1..r3): mean ± sample SD over runs for every headline metric and
// per category, plus per-case stability (how many runs each case passed) — the number a single run cannot give.
// Usage: node test/ai-quality-eval/aggregate-runs.mjs <run1.json> <run2.json> [...]   (final result files, with .summary)
import fs from "node:fs";
import path from "node:path";

// AIQ_SUBSET=<cases.json>: keep only the case ids of that file (e.g. the 31 v1 cases inside a v2 run, for a like-for-like comparison)
const subset = process.env.AIQ_SUBSET ? new Set(JSON.parse(fs.readFileSync(process.env.AIQ_SUBSET, "utf8")).cases.map((c) => c.id)) : null;
const files = process.argv.slice(2), runs = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")))
  .map((r) => (subset ? { ...r, results: r.results.filter((x) => subset.has(x.id)), summary: { ...r.summary, estCostUsd: null } } : r));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => (a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)) : 0);
const fmt = (a, p = 1, scale = 100) => `${(mean(a) * scale).toFixed(p)} ± ${(sd(a) * scale).toFixed(p)}`;
const J = ["correctness", "relevance", "personalization", "safety", "clarity"];
const casePass = (r) => mean(r.results.map((x) => +x.casePass)), checkPass = (r) => r.results.reduce((a, x) => a + x.passed, 0) / r.results.reduce((a, x) => a + x.total, 0);
const jm = (rs, k) => mean(rs.map((x) => x.judge?.[k]).filter(Number.isFinite));
const out = [`runs: ${runs.map((r) => r.label).join(", ")} (n=${runs.length}, ${runs[0].results.length} cases each)`,
  `case pass %      ${fmt(runs.map(casePass))}`, `check pass %     ${fmt(runs.map(checkPass))}`,
  `fallback %       ${fmt(runs.map((r) => mean(r.results.map((x) => +!!x.usedFallback))))}`,
  `median latency s ${fmt(runs.map((r) => r.results.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(r.results.length / 2)]), 1, 0.001)}`,
  ...J.map((k) => `judge ${k.padEnd(15)} ${fmt(runs.map((r) => jm(r.results, k)), 2, 1)}`), "", "per category (case pass %, mean ± SD over runs):"];
const cats = [...new Set(runs[0].results.map((x) => x.category))];
for (const c of cats) out.push(`  ${c.padEnd(18)} n=${String(runs[0].results.filter((x) => x.category === c).length).padStart(2)}  ${fmt(runs.map((r) => mean(r.results.filter((x) => x.category === c).map((x) => +x.casePass))))}   judge correctness ${fmt(runs.map((r) => jm(r.results.filter((x) => x.category === c), "correctness")), 2, 1)}`);
const ids = runs[0].results.map((x) => x.id), stab = ids.map((id) => [id, runs.filter((r) => r.results.find((x) => x.id === id)?.casePass).length]);
out.push("", `case stability: always pass ${stab.filter(([, n]) => n === runs.length).length}, sometimes ${stab.filter(([, n]) => n > 0 && n < runs.length).length}, never ${stab.filter(([, n]) => n === 0).length}`);
for (const [id, n] of stab.filter(([, n]) => n < runs.length)) {
  const why = runs.map((r) => r.results.find((x) => x.id === id)).filter((x) => x && !x.casePass).map((x) => x.checks.filter((c) => !c.pass).map((c) => c.name).join("+"));
  out.push(`  ${id.padEnd(7)} passed ${n}/${runs.length}  failing: ${[...new Set(why)].join(" | ")}`);
}
const cost = runs.map((r) => r.summary?.estCostUsd ?? 0);
out.push("", `est. cost per run USD ${mean(cost).toFixed(2)} (total ${cost.reduce((a, b) => a + b, 0).toFixed(2)})`);
console.log(out.join("\n"));
if (process.env.AIQ_AGG_OUT) fs.writeFileSync(process.env.AIQ_AGG_OUT, out.join("\n") + "\n"), console.log("written", path.resolve(process.env.AIQ_AGG_OUT));
