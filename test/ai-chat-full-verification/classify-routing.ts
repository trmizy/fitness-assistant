// Level A/B: deterministic intent classification of the routing corpus (no LLM). Compares parseFitnessAgentIntent to the semantic expectation.
// Run (repo root): npx tsx test/ai-chat-full-verification/classify-routing.ts [--json out.json]
import fs from "node:fs";
import { parseFitnessAgentIntent } from "../../backend/services/ai-service/src/services/fitness-agent-intent";

const corpus = JSON.parse(fs.readFileSync("test/ai-chat-full-verification/corpus/routing.json", "utf8"));
const rows = corpus.map((c: any) => {
  const got = parseFitnessAgentIntent(c.message).kind;
  let verdict: string;
  if (c.expectedIntent === "AMBIGUOUS") verdict = got === null ? "OK(clarify/none)" : `REVIEW(routed ${got})`;
  else if (c.expectedIntent === "NOT_WRITE") verdict = got === null || got === "PT" || got === "PROGRAM" ? "OK" : `REVIEW(${got})`;
  else verdict = got === c.expectedIntent ? "OK" : "MISMATCH";
  return { id: c.id, category: c.category, message: c.message, expected: c.expectedIntent, got, verdict };
});
for (const r of rows) console.log(`${r.verdict.padEnd(22)} ${r.id} exp=${String(r.expected).padEnd(22)} got=${String(r.got).padEnd(22)} ${r.message}`);
const count = (p: (r: any) => boolean) => rows.filter(p).length;
console.log(`\nTOTAL ${rows.length}  OK ${count((r: any) => r.verdict.startsWith("OK"))}  MISMATCH ${count((r: any) => r.verdict === "MISMATCH")}  REVIEW ${count((r: any) => r.verdict.startsWith("REVIEW"))}`);
const j = process.argv.indexOf("--json");
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(rows, null, 1));
