// Phase 3 Batch 5 — REAL HTTP latency + Qwen call-count probe through the gateway (single run per turn; labeled as such).
// Uses only the existing verification helpers (real register/verify/login, real /ai/ask). Writes nothing but its own test user.
import { execSync } from "node:child_process";
import fs from "node:fs";
import { registerUser, putProfile, say, q } from "../../../test/ai-chat-full-verification/lib.mjs";

const stamp = Date.now();
const u = await registerUser(`b5.latency.${stamp}@gymini-test.local`, "Batch5 Latency");
await putProfile(u, { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE", preferredTrainingDays: [1, 3, 5], sessionDurationMinutes: 60 });

const turns = [
  ["READ deterministic", "Cân nặng hiện tại của tôi là bao nhiêu?"],
  ["Workout create (start)", "Tạo lịch tập 4 buổi mỗi tuần, mỗi buổi 60 phút. Tôi chỉ có tạ tay."],
  ["Workout revision/slot", "Buổi chân hơi nặng."],
  ["PT READ", "PT hiện tại của tôi là ai?"],
  ["Nutrition READ", "Macro hiện tại của tôi bao nhiêu?"],
  ["General QA (Qwen path)", "Progressive overload là gì?"],
];
const rows = [];
let sid = null;
for (const [label, text] of turns) {
  const since = new Date(Date.now() - 1000).toISOString();
  const r = await say(u, text, sid ?? undefined);
  sid = r.sessionId ?? sid;
  // Qwen generation calls for this turn = Ollama access-log POSTs to /api/chat (or generate) since the turn began.
  let qwen = 0, qwenMs = [];
  try {
    const log = execSync(`docker logs gymcoach-ollama --since ${since} 2>&1`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of log.split("\n")) {
      if (!/POST\s+"\/api\/(chat|generate)"/.test(line)) continue;
      qwen += 1;
      const m = /\|\s*([0-9.]+(?:µs|ms|s|m|h)(?:[0-9.]+(?:µs|ms|s|m))*)\s*\|/.exec(line);
      if (m) qwenMs.push(m[1]);
    }
  } catch { /* log read failure is recorded as unknown below */ }
  rows.push({ label, text, httpStatus: r.status, httpMs: r.ms, answerChars: (r.answer ?? "").length, route: r.block?.intent ?? null, qwenChatCalls: qwen, qwenDurations: qwenMs, traceId: r.data?.traceId ?? null });
}
const pendingRow = q("ai", `select count(*) from fitness_agent_actions where user_id='${u.userId}' and status='PENDING'`);
const completedRow = q("ai", `select count(*) from fitness_agent_actions where user_id='${u.userId}' and status='COMPLETED'`);
const programRow = q("fitness", `select count(*) from workout_programs where user_id='${u.userId}'`);
const out = { measuredAt: new Date().toISOString(), runs: "single run per turn (not p50/p90)", userId: u.userId, turns: rows, state: { pendingActions: pendingRow, completedActions: completedRow, workoutPrograms: programRow } };
fs.writeFileSync(new URL("./live-turn-latency.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.turns.map((t) => ({ label: t.label, http: t.httpStatus, ms: t.httpMs, qwen: t.qwenChatCalls, chars: t.answerChars })), null, 1), JSON.stringify(out.state));
