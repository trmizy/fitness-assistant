// Ablation runner (A/B/C/D) for the InBody-grounded RAG paper.
// Run from backend/services/ai-service so production modules + AWS SDK resolve (see README.md for the exact command).
// Output: results/<runId>/answers.jsonl (append-only; re-running with the same --run-id resumes and skips finished items).
// Evidence label: TEST FIXTURE personas + REAL model calls (Bedrock Nova Pro) + production retriever/engine code.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { retriever } from "../../../backend/services/ai-service/src/llm/retriever";
import { nutritionCalculator } from "../../../backend/services/ai-service/src/llm/nutrition_calculator";
import { CONFIGS, SYSTEM_PROMPT, buildUserMessage, questionsFor, type Config, type Persona, type Question } from "./lib/prompts";

const here = __dirname;
const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RUN_ID = arg("--run-id", new Date().toISOString().replace(/[-:]/g, "").slice(0, 15));
const REPEATS = Number(arg("--repeats", "3"));
const CONCURRENCY = Number(arg("--concurrency", "6"));
const LIMIT = Number(arg("--limit-personas", "999"));
const MODEL = process.env.ABL_MODEL || "apac.amazon.nova-pro-v1:0";
// Reasoning models on Bedrock (e.g. Kimi K3.1) reject `temperature` and spend output tokens on reasoning.
const NO_TEMP = process.env.ABL_NO_TEMPERATURE === "1";
const MAX_TOKENS = Number(process.env.ABL_MAX_TOKENS || "700");

const req = createRequire(path.resolve(here, "../../../backend/services/ai-service/package.json"));
const { BedrockRuntimeClient, ConverseCommand } = req("@aws-sdk/client-bedrock-runtime");
const br = new BedrockRuntimeClient({ region: "ap-southeast-1", maxAttempts: 8 });

const dataset = JSON.parse(fs.readFileSync(path.join(here, "personas-inbody.v1.json"), "utf8"));
const expectedSha = fs.readFileSync(path.join(here, "personas-inbody.v1.json.sha256"), "utf8").split(/\s+/)[0];
const actualSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "personas-inbody.v1.json"))).digest("hex");
if (expectedSha !== actualSha) { console.error("DATASET_CHECKSUM_MISMATCH"); process.exit(4); }
const personas: Persona[] = dataset.personas.slice(0, LIMIT);

const outDir = path.join(here, "results", RUN_ID);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "answers.jsonl");
const done = new Set<string>();
if (fs.existsSync(outFile)) for (const line of fs.readFileSync(outFile, "utf8").split("\n")) if (line.trim()) done.add(JSON.parse(line).key);
fs.writeFileSync(path.join(outDir, "run-config.json"), JSON.stringify({
  runId: RUN_ID, model: MODEL, temperature: NO_TEMP ? "model default (not settable)" : 0, maxTokens: MAX_TOKENS, repeats: REPEATS, concurrency: CONCURRENCY,
  datasetSha256: actualSha, personas: personas.length, configs: CONFIGS, ragTopK: process.env.RAG_TOP_K ?? "5 (default)",
  ragMinScore: process.env.RAG_MIN_SCORE ?? "0.35 (default)", embedding: process.env.BEDROCK_EMBEDDING_MODEL, systemPrompt: SYSTEM_PROMPT,
  startedAt: new Date().toISOString(), node: process.version,
}, null, 2));

// ------------------------------------------------------------------ numeric extraction
export function parseNumberVi(s: string): number | null {
  const t = s.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
export function extractAnswer(text: string, unit: "kcal" | "g"): { value: number | null; method: string } {
  const line = text.match(/ĐÁP\s*SỐ\s*[:：]\s*([^\n]+)/i);
  const grab = (s: string) => {
    const nums = [...s.matchAll(/\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?/g)].map((m) => parseNumberVi(m[0])).filter((x): x is number => x !== null);
    const plausible = nums.filter((x) => (unit === "kcal" ? x >= 500 && x <= 6000 : x >= 20 && x <= 400));
    if (!plausible.length) return null;
    return plausible.length >= 2 ? (plausible[0] + plausible[1]) / 2 : plausible[0]; // range "a–b" -> midpoint
  };
  if (line) { const v = grab(line[1]); if (v !== null) return { value: v, method: "answer_line" }; }
  const re = unit === "kcal" ? /([\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(?:kcal|calo)/gi : /([\d.,]+(?:\s*[-–]\s*[\d.,]+)?)\s*(?:g|gram)\b/gi;
  const all = [...text.matchAll(re)];
  for (let i = all.length - 1; i >= 0; i--) { const v = grab(all[i][1]); if (v !== null) return { value: v, method: "fallback_last_unit" }; }
  return { value: null, method: "none" };
}

// ------------------------------------------------------------------ context providers
const retrievalCache = new Map<string, Promise<any[]>>();
function retrieve(q: Question) {
  const key = q.text.split("\n(")[0]; // retrieval query = the user's question without the answer-format instruction
  if (!retrievalCache.has(key)) retrievalCache.set(key, retriever.retrieveForChat(key).then((r: any) => (r.documents ?? []).map((d: any) => ({ id: d.id, source: d.source, score: d.score, pageContent: d.pageContent }))));
  return retrievalCache.get(key)!;
}
function engine(p: Persona) {
  const a = p.profile;
  return nutritionCalculator.calculate({
    age: a.age, gender: a.gender, heightCm: a.heightCm, currentWeightKg: a.currentWeight, goal: a.goal, activityLevel: a.activityLevel, experienceLevel: a.experienceLevel,
    inBody: { weightKg: p.inbody.weight, bodyFatPct: p.inbody.bodyFatPct, bodyFatKg: p.inbody.bodyFat, skeletalMuscleKg: p.inbody.muscleMass, bmr: p.inbody.bmr, bmi: p.inbody.bmi },
  } as any, { normalizedQuestion: "", intent: "nutrition" } as any);
}

async function callModel(user: string) {
  const t0 = Date.now();
  const r = await br.send(new ConverseCommand({
    modelId: MODEL, system: [{ text: SYSTEM_PROMPT }], messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens: MAX_TOKENS, ...(NO_TEMP ? {} : { temperature: 0 }) },
  }));
  return { text: r.output?.message?.content?.map((x: any) => x.text ?? "").join("") ?? "", inTok: r.usage?.inputTokens ?? 0, outTok: r.usage?.outputTokens ?? 0, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ job list
type Job = { key: string; rep: number; cfg: Config; p: Persona; q: Question };
const jobs: Job[] = [];
for (let rep = 1; rep <= REPEATS; rep++)
  personas.forEach((p, i) => questionsFor(p, i).forEach((q) => CONFIGS.forEach((cfg) => {
    const key = `${rep}|${p.id}|${q.qid}|${cfg}`;
    if (!done.has(key)) jobs.push({ key, rep, cfg, p, q });
  })));
console.log(`run ${RUN_ID}: ${jobs.length} jobs to do (${done.size} already done), model ${MODEL}`);

let finished = 0, failed = 0;
const out = fs.createWriteStream(outFile, { flags: "a" });
async function work(job: Job) {
  const { cfg, p, q } = job;
  const docs = cfg === "C" || cfg === "D" ? await retrieve(q) : [];
  const eng = cfg === "D" ? engine(p) : undefined;
  const user = buildUserMessage(cfg, p, q, { docs, engine: eng });
  let res; let attempt = 0;
  for (;;) {
    try { res = await callModel(user); break; } catch (err: any) {
      attempt += 1; if (attempt >= 8) { failed += 1; console.error(`FAIL ${job.key}: ${err?.name} ${err?.message}`); return; }
      // Bedrock on-demand quota: back off hard on throttling so the run converges instead of burning retries.
      const base = err?.name === "ThrottlingException" ? 8000 : 2000;
      await new Promise((r) => setTimeout(r, base * attempt + Math.random() * 1000));
    }
  }
  const ex = q.numeric ? extractAnswer(res.text, q.numeric) : undefined;
  out.write(JSON.stringify({
    key: job.key, rep: job.rep, persona: p.id, qid: q.qid, sub: q.sub ?? null, config: cfg, model: MODEL,
    promptSha: crypto.createHash("sha256").update(SYSTEM_PROMPT + "\n" + user).digest("hex").slice(0, 16),
    retrieved: docs.map((d: any) => ({ id: d.id, source: d.source, score: d.score })), engine: eng ?? null,
    answer: res.text, extracted: ex ?? null, inTok: res.inTok, outTok: res.outTok, ms: res.ms, at: new Date().toISOString(),
  }) + "\n");
  finished += 1;
  if (finished % 50 === 0) console.log(`${finished}/${jobs.length} done, ${failed} failed`);
}

(async () => {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < jobs.length) await work(jobs[next++]); }));
  out.end();
  console.log(`finished ${finished}, failed ${failed} -> ${outFile}`);
  process.exit(failed ? 1 : 0);
})();
