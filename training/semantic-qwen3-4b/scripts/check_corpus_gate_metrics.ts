/**
 * V2.3A.8.1 step 17/AC/AD: read-only report of the exact corpus evaluation
 * metrics after the gold correction, to quote precise numerator/denominator
 * in the final report. Does not modify anything.
 */
import fs from "fs";
import path from "path";
import { evaluateCorpus } from "../../../backend/services/ai-service/src/conversational-intelligence/evaluate";

const corpusPath = path.resolve(__dirname, "../../../test/conversational-intelligence/corpus.json");
const data = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const ev = evaluateCorpus(data);

console.log("totalCases:", ev.totalCases);
console.log("unitMistakes:", ev.unitMistakes, "crossFieldContamination:", ev.crossFieldContamination, "confirmationBypasses:", ev.confirmationBypasses);
console.log("reference metric:", JSON.stringify(ev.metrics.reference));
console.log("ambiguity metric:", JSON.stringify(ev.metrics.ambiguity));
console.log("all metrics:", JSON.stringify(ev.metrics, null, 1));
console.log("failures (full list):", JSON.stringify(ev.failures));
