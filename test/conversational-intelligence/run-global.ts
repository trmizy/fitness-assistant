// Evaluates the GLOBAL router on the blind corpus. Usage (repo root):
//   node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/run-global.ts first-pass|post-remediation
// "first-pass" WRITES results/global-blind-first-pass.json ONCE and refuses to overwrite it (frozen evidence).
import fs from "node:fs";
import crypto from "node:crypto";
import { evaluateGlobal, pct, type GlobalCase } from "../../backend/services/ai-service/src/conversational-intelligence/global/evaluate-global";

const label = process.argv[2] ?? "post-remediation";
const raw = fs.readFileSync("test/conversational-intelligence/global-blind.json", "utf8");
const cases: GlobalCase[] = JSON.parse(raw);
const hash = crypto.createHash("sha256").update(raw).digest("hex");
const ev = evaluateGlobal(cases);
const out = {
  label, corpusSha256: hash, total: ev.total,
  ...Object.fromEntries(Object.entries(ev.metrics).map(([k, t]) => [`${k}Accuracy`, pct(t)])),
  unsafeMisroutes: ev.unsafeMisroutes, failureCount: ev.failures.length, failures: ev.failures,
};
const file = `test/conversational-intelligence/results/global-blind-${label}.json`;
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
if (label === "first-pass" && fs.existsSync(file)) { console.error("first-pass is FROZEN — refusing to overwrite " + file); process.exit(2); }
fs.writeFileSync(file, JSON.stringify(out, null, 2));
fs.writeFileSync(`test/conversational-intelligence/results/global-blind-${label}-cases.md`, ["| id | input | got | expected | ok |", "|---|---|---|---|---|", ...ev.perCase.map((p) => `| ${p.id} | ${p.text.replace(/\|/g, "/")} | ${p.got} | ${p.expected} | ${p.ok ? "✅" : "❌"} |`)].join("\n"));
console.log(JSON.stringify({ ...out, failures: undefined }, null, 2));
console.log(`\nFAILURES (${ev.failures.length}) — see the -cases.md table`);
