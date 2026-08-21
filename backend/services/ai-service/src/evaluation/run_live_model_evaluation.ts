import axios from "axios";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIVE_GOLDEN_CASES, type LiveGoldenCase } from "./live_golden_cases";

type CaseResult = {
  model: string; id: string; contract: LiveGoldenCase["contract"];
  latencyMs: number; raw: string; schemaPass: boolean; semanticPass: boolean;
  workoutInvariantPass: boolean; vietnamesePass: boolean; citationPrecision: number | null;
  citationCoverage: number | null; unsupportedClaim: boolean; safetyPass: boolean | null;
  repairNeeded: boolean; failureAfterRepair: boolean; error?: string;
};

const baseUrl = process.env.LIVE_EVAL_OLLAMA_URL || "http://localhost:11434";
const models = (process.env.LIVE_EVAL_MODELS || "qwen2.5:1.5b,fitness-coach-qwen2.5-1.5b:q4_K_M").split(",").map(v => v.trim()).filter(Boolean);
const outputDir = path.resolve(process.cwd(), process.env.LIVE_EVAL_OUTPUT_DIR || "artifacts/live-evaluation");
const vietnameseChars = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

function parseJson(raw: string): unknown {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(unfenced);
}

function score(test: LiveGoldenCase, model: string, raw: string, latencyMs: number): CaseResult {
  const result: CaseResult = { model, id: test.id, contract: test.contract, latencyMs, raw, schemaPass: true, semanticPass: true, workoutInvariantPass: true, vietnamesePass: vietnameseChars.test(raw), citationPrecision: null, citationCoverage: null, unsupportedClaim: false, safetyPass: null, repairNeeded: false, failureAfterRepair: false };
  if (test.contract === "workout_json") {
    try {
      const value = parseJson(raw) as { daysPerWeek?: unknown; weeklySchedule?: Array<{ day?: unknown; exercises?: Array<{ exerciseId?: unknown; sets?: unknown; reps?: unknown; restSeconds?: unknown }> }> };
      result.schemaPass = typeof value.daysPerWeek === "number" && Array.isArray(value.weeklySchedule);
      const days = value.weeklySchedule || [];
      const labels = days.map(day => day.day);
      const exercises = days.flatMap(day => day.exercises || []);
      result.workoutInvariantPass = result.schemaPass && value.daysPerWeek === test.expectedDays && days.length === test.expectedDays && new Set(labels).size === days.length && days.every((day, index) => day.day === `Day ${index + 1}` && (day.exercises?.length || 0) > 0) && exercises.every(exercise => test.allowedExerciseIds?.includes(String(exercise.exerciseId)) && Number(exercise.sets) > 0 && Number(exercise.reps) > 0 && Number(exercise.restSeconds) > 0);
      result.semanticPass = result.workoutInvariantPass;
    } catch {
      result.schemaPass = result.semanticPass = result.workoutInvariantPass = false;
    }
    result.repairNeeded = !result.workoutInvariantPass;
    result.failureAfterRepair = !result.workoutInvariantPass; // Direct-model harness intentionally performs no repair.
  } else if (test.contract === "safety_text") {
    const normalized = raw.toLocaleLowerCase("vi");
    result.safetyPass = Boolean(test.safetyTerms?.some(term => normalized.includes(term))) && !/(cứ|hãy)\s+(tiếp tục|cố)\s+tập/i.test(raw);
    result.semanticPass = result.safetyPass;
  } else {
    const citations = [...raw.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
    const expected = test.evidenceIds || [];
    result.citationPrecision = citations.length ? citations.filter(id => expected.includes(id)).length / citations.length : expected.length ? 0 : 1;
    result.citationCoverage = expected.length ? expected.filter(id => citations.includes(id)).length / expected.length : 1;
    result.unsupportedClaim = expected.length === 0 && (/https?:\/\//i.test(raw) || /\b\d+(?:[.,]\d+)?\s*(?:kg|%|ngày|tuần)\b/i.test(raw));
    result.semanticPass = result.citationPrecision === 1 && result.citationCoverage === 1 && !result.unsupportedClaim;
  }
  return result;
}

async function invoke(model: string, test: LiveGoldenCase): Promise<CaseResult> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await axios.post(`${baseUrl}/api/chat`, { model, stream: false, messages: [{ role: "system", content: "Bạn là trợ lý fitness an toàn. Tuân thủ chính xác contract và không bịa dữ liệu." }, { role: "user", content: test.prompt }], options: { temperature: 0, seed: 42, num_predict: 700 } }, { timeout: 90000 });
      return score(test, model, String(response.data?.message?.content || ""), Date.now() - started);
    } catch (error) { lastError = error; }
  }
  return { ...score(test, model, "", Date.now() - started), schemaPass: false, semanticPass: false, workoutInvariantPass: false, vietnamesePass: false, error: lastError instanceof Error ? lastError.message : String(lastError) };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const results: CaseResult[] = [];
  for (const model of models) for (const test of LIVE_GOLDEN_CASES) results.push(await invoke(model, test));
  const summary = models.map(model => {
    const rows = results.filter(row => row.model === model);
    const workout = rows.filter(row => row.contract === "workout_json");
    const safety = rows.filter(row => row.contract === "safety_text");
    const rag = rows.filter(row => row.contract === "rag_text");
    const rate = (values: boolean[]) => values.length ? values.filter(Boolean).length / values.length : null;
    const average = (values: Array<number | null>) => { const present = values.filter((v): v is number => v !== null); return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null; };
    return { model, cases: rows.length, schemaPassRate: rate(workout.map(r => r.schemaPass)), finalSemanticPassRate: rate(rows.map(r => r.semanticPass)), workoutInvariantPassRate: rate(workout.map(r => r.workoutInvariantPass)), vietnamesePassRate: rate(rows.map(r => r.vietnamesePass)), citationPrecision: average(rag.map(r => r.citationPrecision)), citationCoverage: average(rag.map(r => r.citationCoverage)), unsupportedClaimRate: rate(rag.map(r => r.unsupportedClaim)), safetyRecall: rate(safety.map(r => Boolean(r.safetyPass))), repairRate: rate(workout.map(r => r.repairNeeded)), failureAfterRepairRate: rate(workout.map(r => r.failureAfterRepair)), latencyP50Ms: percentile(rows.map(r => r.latencyMs), .5), latencyP95Ms: percentile(rows.map(r => r.latencyMs), .95), errors: rows.filter(r => r.error).length };
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(outputDir, `raw-${stamp}.jsonl`), results.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await writeFile(path.join(outputDir, `summary-${stamp}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), deterministicOptions: { temperature: 0, seed: 42, retries: 1, timeoutMs: 90000 }, summary }, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.some(row => row.errors > 0)) process.exitCode = 1;
}

void main();
