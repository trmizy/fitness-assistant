// REAL HTTP/API probe of how the chat revises a pending WORKOUT draft (Phase 2 of the AI plan): move / set-frequency / replace /
// remove-body-part, single and multi-turn. Real gateway + ai-service + isolated test DBs (stack.mjs). Read-only apart from creating
// ONE fresh test user and chat sessions/drafts; nothing is confirmed/saved.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/probe-workout-revisions.mjs
import fs from "node:fs";
import { registerUser, putProfile, say } from "./lib.mjs";

const stamp = Date.now().toString(36);
const u = await registerUser(`probe.rev.${stamp}@gymini-test.local`, "Probe Revisions");
const p = await putProfile(u, { age: 30, gender: "MALE", heightCm: 175, goal: "MUSCLE_GAIN", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "INTERMEDIATE", currentWeight: 78, targetWeight: 80, hasCompletedOnboarding: true, availableEquipment: ["dumbbell", "barbell", "bodyweight", "machine"] });
if (p.status !== 200) throw new Error("profile " + p.status);

const LEG = /squat|lunge|leg|calf|deadlift|hip thrust|glute|quad|hamstring|chân|đùi|mông|bắp chân/i;
const findPayload = (r) => {
  const d = r.raw?.data ?? r.raw ?? {};
  const blocks = Array.isArray(d.structuredBlocks) ? d.structuredBlocks : [];
  return blocks.find((x) => x?.type === "WORKOUT_PLAN_PREVIEW" && Array.isArray(x.days)) ?? null;
};
const summarize = (r) => {
  const d = findPayload(r);
  if (!d) return { sessions: null, days: null, legExercises: null, exclusions: null, answer: String(r.answer).slice(0, 170) };
  return {
    sessions: d.days.length,
    days: d.days.map((x) => String(x.day).replace(/\s*\(.*\)/, "")).join(", "),
    exercisesPerDay: d.days.map((x) => (x.exercises ?? []).length).join("/"),
    legExercises: d.days.flatMap((x) => (x.exercises ?? []).map((e) => e.name ?? "")).filter((n) => LEG.test(n)).length,
    exclusions: d.exclusions ?? null,
    answer: String(r.answer).slice(0, 170),
  };
};

async function freshDraft() {
  let r = await say(u, "Tạo lịch tập cho tôi.");
  const sid = r.sessionId;
  for (const a of ["4 buổi mỗi tuần", "60 phút mỗi buổi"]) { if (findPayload(r)) break; r = await say(u, a, sid); }
  r = await say(u, "Tôi tập được thứ 2, 4, 6, chủ nhật", sid);
  return { sid, r };
}

const scenarios = [
  { id: "S1-move", turns: ["Đổi buổi thứ 6 sang thứ 7"], expect: "4 sessions on Mon, Wed, Sat, Sun" },
  { id: "S2-move-variant", turns: ["Chuyển buổi thứ 6 qua thứ 7 giúp mình"], expect: "4 sessions on Mon, Wed, Sat, Sun" },
  { id: "S3-move-no-diacritics", turns: ["doi buoi thu 6 sang thu 7"], expect: "4 sessions on Mon, Wed, Sat, Sun" },
  { id: "S4-set-frequency", turns: ["Giảm xuống 3 buổi mỗi tuần"], expect: "3 sessions" },
  { id: "S5-replace-session", turns: ["Thay buổi thứ 7 thành tập chân"], expect: "unchanged count; no Sat session exists -> must ask/explain, not corrupt" },
  { id: "S6-remove-body-part", turns: ["Tôi bị đau chân, bỏ bài tập chân"], expect: "asks (or applies if no session would vanish); never a false reassurance" },
  { id: "S6b-pain-then-yes", turns: ["Tôi bị đau chân, bỏ bài tập chân", "đồng ý"], expect: "0 leg exercises; sessions that were all-leg removed; count reported truthfully" },
  { id: "S7-constraint-then-move", turns: ["Tôi bị đau chân, bỏ bài tập chân", "đồng ý", "Đổi buổi chủ nhật sang thứ 7"], expect: "still 0 leg exercises after a move" },
  { id: "S8-constraint-then-unrelated-then-move", turns: ["Tôi bị đau chân, bỏ bài tập chân", "đồng ý", "Protein giúp gì cho cơ bắp?", "Đổi buổi chủ nhật sang thứ 7"], expect: "constraint survives an unrelated question: 0 leg exercises" },
  { id: "S9-constraint-then-regenerate", turns: ["Tôi bị đau chân, bỏ bài tập chân", "đồng ý", "Đổi sang 3 buổi mỗi tuần"], expect: "regenerated draft (real catalog) still has 0 leg exercises, or says it cannot" },
  { id: "S10-lift", turns: ["Tôi bị đau chân, bỏ bài tập chân", "đồng ý", "Hết đau chân rồi"], expect: "avoidance lifted; draft not changed by the lift" },
];

const out = [];
const base = await freshDraft();
console.log("BASE draft:", JSON.stringify(summarize(base.r)));
for (const s of scenarios) {
  const { sid, r: start } = await freshDraft();
  const before = summarize(start);
  let last = start; const per = [];
  for (const t of s.turns) { last = await say(u, t, sid); per.push({ turn: t, ...summarize(last) }); }
  const after = per[per.length - 1];
  const row = { id: s.id, expect: s.expect, before: { sessions: before.sessions, days: before.days, legs: before.legExercises }, after: { sessions: after.sessions, days: after.days, legs: after.legExercises, exclusions: after.exclusions }, answer: after.answer };
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync("test/ai-chat-full-verification/results/probe-workout-revisions.json", JSON.stringify({ at: new Date().toISOString(), base: summarize(base.r), out }, null, 2));
