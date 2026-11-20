/**
 * Integration C — starts the REAL ai-service (HTTP + BullMQ worker, Postgres, Redis) with ONLY `llmService.callLLM` replaced by a deterministic,
 * controllable STUB. No provider is contacted: this proves orchestration/persistence/identity/versioning, NOT model quality.
 *
 * Control: the JSON file named by STUB_CONTROL (default ./stub-control.json) is re-read on every call: { "mode": "ok"|"truncated"|"timeout"|"garbage"|"slow", "delayMs": n }.
 * Every call is appended to STUB_CALLS_LOG (one JSON line) — the evidence that the number of "model" calls is exactly what the tests expect.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const AI = path.resolve(__dirname, "../../../backend/services/ai-service/src");
const load = (rel: string) => import(pathToFileURL(path.join(AI, rel)).href);

const CONTROL = process.env.STUB_CONTROL || path.resolve(__dirname, "stub-control.json");
const CALLS = process.env.STUB_CALLS_LOG || path.resolve(__dirname, "stub-calls.jsonl");

const control = (): { mode: string; delayMs?: number } => { try { return JSON.parse(fs.readFileSync(CONTROL, "utf8")); } catch { return { mode: "ok" }; } };

function deltaAnswer(prompt: string): string {
  const days = [...prompt.matchAll(/\[Day (\d+)\][^\n]*ADD EXACTLY (\d+) NEW[^\n]*\n[^\n]*\nCandidates[^\n]*\n((?:[^\n]+\n?)+?)(?:\n\n|\nSchema|$)/g)];
  return JSON.stringify({ days: days.map((m) => ({ dayIndex: Number(m[1]) - 1, add: m[3].trim().split("\n").slice(0, Number(m[2])).map((l) => ({ exerciseId: l.split("|")[0], name: l.split("|")[1], sets: 3, reps: "10", restSeconds: 60, note: "Bổ sung" })) })) });
}

function generationAnswer(prompt: string): string {
  const num = (re: RegExp, d: number) => Number(re.exec(prompt)?.[1] ?? d);
  const daysPerWeek = num(/DaysPerWeek: (\d+)/, 4), perDay = num(/ExercisesPerDay: (\d+)/, 4), durationWeeks = num(/DurationWeeks: (\d+)/, 4);
  const goal = /Goal: ([^\n]+)/.exec(prompt)?.[1] ?? "MUSCLE_GAIN";
  const blocks = [...prompt.matchAll(/\[Day (\d+)\] ([^\n]*)\n((?:[^\n\[][^\n]*\n?)+)/g)];
  const weeklySchedule = Array.from({ length: daysPerWeek }, (_, i) => {
    const b = blocks.find((x) => Number(x[1]) === i + 1) ?? blocks[i % Math.max(1, blocks.length)];
    const lines = (b?.[3] ?? "").trim().split("\n").filter((l) => l.includes("|"));
    return {
      day: `Day ${i + 1}`, goal: (b?.[2] ?? `Buổi ${i + 1}`).trim() || `Buổi ${i + 1}`, cardio: "Khởi động nhẹ 5-10 phút",
      exercises: lines.slice(0, perDay).map((l, k) => ({ exerciseId: l.split("|")[0], order: k + 1, name: l.split("|")[1], sets: 3, reps: "8-12", restSeconds: 75, note: "Giữ form chuẩn" })),
    };
  });
  return JSON.stringify({ goal, durationWeeks, daysPerWeek, exercisesPerDay: perDay, weeklySchedule, progressionNotes: ["Tăng dần mức tạ"], recoveryNotes: ["Ngủ đủ giấc"], nutritionSummary: "Đủ protein" });
}

(async () => {
  const { llmService } = await load("services/llm.service");
  const { LlmError } = await load("errors/api-error");
  (llmService as any).callLLM = async (prompt: string, opts: { numPredict?: number } = {}) => {
    const c = control();
    const isDelta = /ADD EXACTLY \d+ NEW/.test(prompt);
    fs.appendFileSync(CALLS, JSON.stringify({ at: new Date().toISOString(), mode: c.mode, kind: isDelta ? "delta" : "generate", numPredict: opts.numPredict ?? null, promptChars: prompt.length }) + "\n");
    if (c.delayMs) await new Promise((r) => setTimeout(r, c.delayMs));
    if (c.mode === "timeout") throw new LlmError("LLM request timed out (stub)");
    const full = isDelta ? deltaAnswer(prompt) : generationAnswer(prompt);
    const answer = c.mode === "truncated" ? full.slice(0, Math.max(20, Math.floor(full.length * 0.6))) : c.mode === "garbage" ? "sorry, no json" : full;
    return { answer, promptTokens: 1, completionTokens: 1 };
  };
  await load("server");
})();
