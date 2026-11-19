// Post-hoc scorer for a run of run-nutrition-eval.mjs over coach-cases-holdout-v1.json (or any case file with checks.*).
// Offline: reads the result JSON, the case spec and the ai-service log; makes NO network or model call.
//
//   node test/ai-quality-eval/holdout-score.mjs <results.json> [cases.json] [ai.log]
//
// Per case it reports
//   - deterministic checks from the SPEC (independent of the implementation): responseSource, notResponseSource,
//     mustNotMatch / mustMatch on the final answer → PASS / FAIL
//   - everything that needs judgement (correctness, helpfulness, safety tone) → NOT_VERIFIED (never counted as pass)
//   - from the log, by traceId: real prompt tokens, retrievalDocs (knowledge ids), route — for trace review
// It never prints an accuracy % over NOT_VERIFIED items.
import fs from "node:fs";
import path from "node:path";

const [resultsFile, casesFile = "test/ai-quality-eval/coach-cases-holdout-v1.json", logFile = ".tmp-stack/ai.log"] = process.argv.slice(2);
if (!resultsFile) { console.error("usage: holdout-score.mjs <results.json> [cases.json] [ai.log]"); process.exit(2); }
const results = JSON.parse(fs.readFileSync(resultsFile, "utf8")).results ?? [];
const spec = JSON.parse(fs.readFileSync(casesFile, "utf8"));
const byId = new Map(spec.cases.map((c) => [c.id, c]));

const traceInfo = new Map();
if (fs.existsSync(logFile)) {
  const wanted = new Set(results.map((r) => r.traceId).filter(Boolean));
  for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
    if (!line.includes("contextManifest") && !line.includes("AI chat timing")) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const id = j.request_id; if (!wanted.has(id)) continue;
    const t = traceInfo.get(id) ?? {};
    if (j.contextManifest) Object.assign(t, { promptTokensEst: j.contextManifest.promptTokens, overBudget: j.contextManifest.overBudget, retrievalDocs: j.retrievalDocs ?? null, blocks: j.contextManifest.entries?.map((e) => e.block) });
    if (j.timing) Object.assign(t, { route: j.route, totalMs: j.timing.totalMs, llmMs: j.timing.llmGenerateMs });
    traceInfo.set(id, t);
  }
}

const rows = [];
for (const r of results) {
  const c = byId.get(r.id); if (!c) continue;
  const ck = c.checks ?? {}, answer = String(r.answer ?? ""), det = [];
  if (ck.responseSource) det.push({ check: `responseSource == ${ck.responseSource}`, pass: r.responseSource === ck.responseSource, got: r.responseSource });
  if (ck.notResponseSource) det.push({ check: `responseSource != ${ck.notResponseSource}`, pass: r.responseSource !== ck.notResponseSource, got: r.responseSource });
  for (const re of ck.mustNotMatch ?? []) { const m = answer.match(new RegExp(re, "i")); det.push({ check: `mustNotMatch /${re}/`, pass: !m, got: m?.[0] ?? "" }); }
  for (const re of ck.mustMatch ?? []) det.push({ check: `mustMatch /${re}/`, pass: new RegExp(re, "i").test(answer), got: "" });
  rows.push({
    id: r.id, contaminated: Boolean(c.contaminated), status: r.status, responseSource: r.responseSource, ms: r.ms,
    promptTokens: r.promptTokens, completionTokens: r.completionTokens, trace: traceInfo.get(r.traceId) ?? null,
    deterministic: det, deterministicVerdict: det.length ? (det.every((d) => d.pass) ? "PASS" : "FAIL") : "NONE",
    judgement: "NOT_VERIFIED",
  });
}
const counted = rows.filter((r) => !r.contaminated && r.deterministicVerdict !== "NONE");
const summary = {
  cases: rows.length,
  deterministicPass: counted.filter((r) => r.deterministicVerdict === "PASS").length,
  deterministicFail: counted.filter((r) => r.deterministicVerdict === "FAIL").length,
  noDeterministicCheck: rows.filter((r) => r.deterministicVerdict === "NONE").length,
  contaminatedExcluded: rows.filter((r) => r.contaminated).length,
  judgement: "NOT_VERIFIED for all cases (needs blind human / approved judge)",
};
const out = path.join(path.dirname(resultsFile), `${path.basename(resultsFile, ".json")}.holdout-score.json`);
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of rows) console.log(`${r.id.padEnd(6)} ${r.deterministicVerdict.padEnd(5)} ${String(r.responseSource).padEnd(18)} ${r.contaminated ? "(contaminated) " : ""}${r.deterministic.filter((d) => !d.pass).map((d) => `${d.check} got="${String(d.got).slice(0, 60)}"`).join("; ")}`);
console.log("written", out);
