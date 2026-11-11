// Measures the configured model (qwen3:30b via the SSH tunnel) as the TYPED semantic parser on a sample of the corpus.
// Reports: intent accuracy, entity exact-match, unit contamination BEFORE and AFTER the TypeScript validator, latency.
// Usage (repo root): node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/run-llm.ts [sampleSize]
import fs from "node:fs";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "ollama";
process.env.LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11435";
process.env.OLLAMA_BASE_URL = process.env.LLM_BASE_URL;
process.env.LLM_MODEL = process.env.LLM_MODEL ?? "qwen3:30b-a3b-instruct-2507-q4_K_M";
process.env.CYCLE_ANALYSIS_LLM_TIMEOUT_MS = "90000";

async function main() {
const { llmOnlyReading } = await import("../../backend/services/ai-service/src/conversational-intelligence/interpreter");
type Case = { id: string; cat: string; text: string; exp: Record<string, any>; ctx: Record<string, any> };
const all: Case[] = JSON.parse(fs.readFileSync("test/conversational-intelligence/corpus.json", "utf8"));
const size = Number(process.argv[2] ?? 40);
const WANT = ["unit-extraction", "target-weight", "corrections", "ask-recommendation", "multi-slot", "natural-vietnamese", "goal-signals", "general-qa"];
const sample: Case[] = [];
for (let round = 0; sample.length < size && round < 20; round += 1) for (const cat of WANT) { const pool = all.filter((c) => c.cat === cat && (c.exp.ents || c.exp.intent || c.exp.rec || c.exp.goal)); const pick = pool[round]; if (pick && sample.length < size) sample.push(pick); }

const TYPE_OK: Record<string, string[]> = { WEIGHT_KG: ["WEIGHT_KG", "WEIGHT_UNLABELED"], TARGET_WEIGHT_KG: ["TARGET_WEIGHT_KG"] };
let intentN = 0, intentOk = 0, entN = 0, entOk = 0, entOkRaw = 0, contaminationRaw = 0, contaminationValidated = 0, recN = 0, recOk = 0, failed = 0;
const lat: number[] = [];
const notes: string[] = [];
for (const c of sample) {
  const t0 = Date.now();
  const r = await llmOnlyReading(c.text, { expectedSlot: c.ctx.slot ?? null }, "ci-eval").catch(() => null);
  lat.push(Date.now() - t0);
  if (!r) { failed += 1; notes.push(`${c.id} LLM returned no valid JSON`); continue; }
  const intentMap: Record<string, string> = { ASK_RECOMMENDATION: "ASK_RECOMMENDATION" };
  if (c.exp.intent) { intentN += 1; if (r.raw.primaryIntent === c.exp.intent) intentOk += 1; else notes.push(`${c.id} intent ${r.raw.primaryIntent} ≠ ${c.exp.intent}`); }
  if (c.exp.rec) { recN += 1; if (r.raw.asksRecommendation || r.raw.primaryIntent === "ASK_RECOMMENDATION") recOk += 1; else notes.push(`${c.id} missed recommendation request`); }
  for (const spec of c.exp.ents ?? []) {
    const [t, v] = spec.split("=");
    if (!["HEIGHT_CM", "WEIGHT_KG", "TARGET_WEIGHT_KG", "AGE", "SESSIONS_PER_WEEK", "SESSION_MINUTES", "MEALS_PER_DAY", "BUDGET_VND"].includes(t)) continue;
    entN += 1;
    const match = (list: { type: string; value: any }[]) => list.some((e) => (TYPE_OK[t] ?? [t]).includes(e.type) && String(e.value) === v);
    if (match(r.raw.entities as any)) entOkRaw += 1;
    if (match(r.validatedEntities as any)) entOk += 1; else notes.push(`${c.id} ${c.text.slice(0, 50)} → missing ${spec}`);
  }
  for (const spec of c.exp.forbid ?? []) {
    const [t, v] = spec.split("=");
    if ((r.raw.entities as any[]).some((e) => e.type === t && String(e.value) === v && !e.negated)) contaminationRaw += 1;
    if ((r.validatedEntities as any[]).some((e) => e.type === t && String(e.value) === v && !e.negated)) contaminationValidated += 1;
  }
}
lat.sort((a, b) => a - b);
const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
const out = {
  model: process.env.LLM_MODEL, sampled: sample.length, invalidJson: failed,
  intentAccuracy: intentN ? `${((intentOk / intentN) * 100).toFixed(1)}% (${intentOk}/${intentN})` : "n/a",
  recommendationIntent: recN ? `${((recOk / recN) * 100).toFixed(1)}% (${recOk}/${recN})` : "n/a",
  entityExactMatchRaw: `${((entOkRaw / Math.max(1, entN)) * 100).toFixed(1)}% (${entOkRaw}/${entN})`,
  entityExactMatchAfterValidator: `${((entOk / Math.max(1, entN)) * 100).toFixed(1)}% (${entOk}/${entN})`,
  forbiddenEntityRaw: contaminationRaw, forbiddenEntityAfterValidator: contaminationValidated,
  latencyMs: { min: lat[0], p50: q(50), p90: q(90), max: lat[lat.length - 1], mean: Math.round(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length)) },
  notes,
};
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync("test/conversational-intelligence/results/llm-qwen3-30b-results.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
