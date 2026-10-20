// REAL HTTP/API probe of the chat roadmap TIME CONTRACT (audit BDG-18: the chat path used to hard-code 16 weeks).
// Real gateway + ai-service + fitness-service + isolated test DBs, real roadmap-draft generation by the configured model (Nova Pro).
// Nothing is confirmed/saved: only drafts are created. Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/probe-roadmap-timeframe.mjs
import fs from "node:fs";
import { registerUser, putProfile, say } from "./lib.mjs";

const stamp = Date.now().toString(36);
const u = await registerUser(`probe.tf.${stamp}@gymini-test.local`, "Probe Timeframe");
const p = await putProfile(u, { age: 30, gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 85, targetWeight: 78, preferredTrainingDays: [1, 3, 5], hasCompletedOnboarding: true });
if (p.status !== 200) throw new Error("profile " + p.status);

const blockOf = (r) => {
  const d = r.raw?.data ?? r.raw ?? {};
  return (Array.isArray(d.structuredBlocks) ? d.structuredBlocks : []).find((b) => b?.kind === "CREATE_PLAN_BUNDLE" || b?.type === "WORKFLOW_MISSING_DATA") ?? null;
};
const timeframeSentence = (answer) => (String(answer).split("\n").find((l) => /Lộ trình dài|không ép khung|mặc định \d+ tuần|yêu cầu \d+ tuần|chưa chắc bạn muốn/.test(l)) ?? "").slice(0, 200);
const summarize = (r) => {
  const b = blockOf(r);
  return { type: b?.type ?? null, totalWeeks: b?.summary?.totalWeeks ?? null, phaseCount: b?.summary?.phaseCount ?? null, timeframeNote: timeframeSentence(r.answer), answerHead: String(r.answer).slice(0, 120) };
};

const scenarios = [
  { id: "R1-12-weeks", turns: ["Tạo lộ trình giảm mỡ trong 12 tuần cho tôi"], expect: "12 weeks, 'theo yêu cầu'" },
  { id: "R2-6-months", turns: ["Tạo lộ trình 6 tháng cho tôi"], expect: "~26 weeks" },
  { id: "R3-no-limit", turns: ["Tạo lộ trình không giới hạn thời gian cho tôi"], expect: "no fixed deadline; reply says so" },
  { id: "R4-default", turns: ["Tạo lộ trình cho tôi"], expect: "default 16 weeks, DISCLOSED as default" },
  { id: "R5-revise-weeks", turns: ["Tạo lộ trình giảm mỡ trong 12 tuần cho tôi", "đổi sang 8 tuần"], expect: "8 weeks after revision" },
  { id: "R6-revise-keeps", turns: ["Tạo lộ trình giảm mỡ trong 12 tuần cho tôi", "Ưu tiên tập nhẹ nhàng hơn"], expect: "still 12 weeks (not 16)" },
  { id: "R7-ambiguous", turns: ["Tạo lộ trình không giới hạn thời gian nhưng muốn xong trong 12 tuần"], expect: "asks, no draft" },
];
const out = [];
for (const s of scenarios) {
  let r, sid; const steps = [];
  for (const t of s.turns) { r = await say(u, t, sid); sid = r.sessionId ?? sid; steps.push({ turn: t, ...summarize(r) }); }
  const last = steps.at(-1);
  const row = { id: s.id, expect: s.expect, last, steps: steps.length };
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync("test/ai-chat-full-verification/results/probe-roadmap-timeframe.json", JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
