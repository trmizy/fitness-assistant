import fs from "node:fs";
import { evaluateGlobal, pct, type GlobalCase } from "../../backend/services/ai-service/src/conversational-intelligence/global/evaluate-global";
const cases: GlobalCase[] = JSON.parse(fs.readFileSync("test/conversational-intelligence/global-holdout2.json", "utf8"));
const ev = evaluateGlobal(cases);
const file = "test/conversational-intelligence/results/global-holdout2-after-b-fix.json";
const out = { total: ev.total, ...Object.fromEntries(Object.entries(ev.metrics).map(([k, t]) => [`${k}Accuracy`, pct(t)])), unsafeMisroutes: ev.unsafeMisroutes, failures: ev.failures };
if (fs.existsSync(file)) { console.error("already written"); process.exit(2); }
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, failures: undefined }, null, 2)); console.log("FAILURES:"); for (const f of ev.failures) console.log(" - " + f);
