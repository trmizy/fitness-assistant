// Evaluates the deterministic semantic layer against a corpus and compares it with the LEGACY parsers (shadow table).
// Usage (repo root):
//   node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/run-corpus.ts [corpus.json|holdout.json]
import fs from "node:fs";
import { evaluateCorpus, pct, type CorpusCase } from "../../backend/services/ai-service/src/conversational-intelligence/evaluate";
import { extractRoadmapSlotsFromMessage } from "../../backend/services/ai-service/src/agent-workflow/workflows/roadmap.workflow";
import { parseTargetWeightKg, parseWeightKg } from "../../backend/services/ai-service/src/agent-workflow/slot-values";

const file = process.argv[2] ?? "corpus.json";
const label = file.replace(/\.json$/, "");
const cases: CorpusCase[] = JSON.parse(fs.readFileSync(`test/conversational-intelligence/${file}`, "utf8"));
const ev = evaluateCorpus(cases);

// ── shadow comparison: legacy parsers vs the new layer, entity by entity ──
const legacyOf = (c: CorpusCase): Record<string, any> => {
  if (c.ctx.slot === "targetWeight") { const r = parseTargetWeightKg(c.text); return r.ok ? { targetWeight: r.value } : {}; }
  if (c.ctx.slot === "currentWeightKg") { const r = parseWeightKg(c.text); return r.ok ? { currentWeightKg: r.value } : {}; }
  return extractRoadmapSlotsFromMessage(c.text);
};
const LEGACY_KEY: Record<string, string> = { HEIGHT_CM: "heightCm", WEIGHT_KG: "currentWeightKg", TARGET_WEIGHT_KG: "targetWeight", AGE: "age", GENDER: "gender" };
const rows: string[] = [];
let legacyOk = 0, newOk = 0, n = 0, oldCorrectNewWrong = 0;
for (const c of cases) {
  const got = ev.perCase.find((p) => p.id === c.id)!.ents;
  for (const spec of c.exp.ents ?? []) {
    const [t, v] = spec.split("=");
    const lk = LEGACY_KEY[t];
    if (!lk) continue;
    const legacy = legacyOf(c)[lk];
    const lok = String(legacy) === v;
    const nok = got.includes(spec);
    n += 1; if (lok) legacyOk += 1; if (nok) newOk += 1; if (lok && !nok) oldCorrectNewWrong += 1;
    rows.push(`| ${c.id} | ${c.text.replace(/\|/g, "/")} | ${spec} | ${legacy === undefined ? "—" : legacy} ${lok ? "✅" : "❌"} | ${nok ? "✅" : "❌"} |`);
  }
}

const summary = {
  corpus: label, totalCases: ev.totalCases, categories: ev.categories,
  ...Object.fromEntries(Object.entries(ev.metrics).map(([k, t]) => [`${k}Accuracy`, pct(t)])),
  unitMistakes: ev.unitMistakes, crossFieldContamination: ev.crossFieldContamination, confirmationBypasses: ev.confirmationBypasses,
  shadow: { entitiesCompared: n, legacyCorrect: `${legacyOk}/${n}`, newCorrect: `${newOk}/${n}`, regressionsOldCorrectNewWrong: oldCorrectNewWrong },
  failures: ev.failures,
};
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync(`test/conversational-intelligence/results/${label}-results.json`, JSON.stringify(summary, null, 2));
fs.writeFileSync(`test/conversational-intelligence/results/${label}-shadow-comparison.md`, ["| Case | Input | Expected | Legacy parser | New semantic layer |", "|---|---|---|---|---|", ...rows].join("\n"));
console.log(JSON.stringify({ ...summary, failures: undefined }, null, 2));
console.log(`\nFAILURES (${ev.failures.length}):`);
for (const f of ev.failures) console.log(" - " + f);
process.exitCode = ev.failures.length ? 1 : 0;
