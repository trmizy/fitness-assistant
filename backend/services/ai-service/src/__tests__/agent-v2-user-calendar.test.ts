/**
 * V2 Multi-Agent — TZ-UTC fix: "today / yesterday / N days ago" are calendar days in the user's time zone
 * (Asia/Ho_Chi_Minh, the same boundary as Training's today schedule), never UTC days. OFFLINE: mock models, synthetic data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { calendarDateIn, calendarDaysBetween, USER_TIME_ZONE } from "../agent-v2/user-calendar";
import { RECOVERY_TOOL_CONTRACTS } from "../agent-v2/recovery-tools";
import { PROGRESS_TOOL_CONTRACTS } from "../agent-v2/progress-tools";
import { recoveryFacts } from "../agent-v2/supervisor";
import { call, say, system, T0, use, USER_A } from "./m5-benchmark/harness";

const H = 3_600_000;
const sessionsOf = (rows: unknown) => (RECOVERY_TOOL_CONTRACTS.find((c) => c.id === "recovery.get_recent_sessions")!.project as (r: unknown) => any)(rows);
const row = (date: string) => ({ id: "w", name: "x", date, duration: 50, exercises: [{ exercise: { bodyPart: "LOWER_BODY" }, workoutSets: [{ rpe: 8, completed: true }] }] });

test("UC-1 calendar day in Asia/Ho_Chi_Minh (UTC+7), not the UTC day; invalid input → null", () => {
  assert.equal(USER_TIME_ZONE, "Asia/Ho_Chi_Minh");
  assert.equal(calendarDateIn("2026-11-12T16:59:59Z"), "2026-11-12"); // 23:59:59 VN
  assert.equal(calendarDateIn("2026-11-12T17:00:00Z"), "2026-11-13"); // 00:00 VN — UTC still says the 12th
  assert.equal(calendarDateIn("2026-11-13T18:30:00Z"), "2026-11-14");
  assert.equal(calendarDateIn(Date.parse("2026-11-13T09:00:00Z")), "2026-11-13");
  assert.equal(calendarDateIn(new Date("2026-12-31T20:00:00Z")), "2027-01-01", "year boundary");
  assert.equal(calendarDateIn("2026-11-10"), "2026-11-10", "a date-only value keeps its day");
  for (const bad of [null, undefined, "", "not-a-date", NaN]) assert.equal(calendarDateIn(bad), null, String(bad));
  assert.equal(calendarDateIn("2026-11-12T17:00:00Z", "UTC"), "2026-11-12");
});

test("UC-2 calendarDaysBetween is pure date arithmetic", () => {
  assert.equal(calendarDaysBetween("2026-11-13", "2026-11-14"), 1);
  assert.equal(calendarDaysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(calendarDaysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(calendarDaysBetween("2026-11-14", "2026-11-14"), 0);
  assert.equal(calendarDaysBetween("2026-11-15", "2026-11-14"), -1);
  for (const bad of ["unknown", "2026-11", "", "2026-13-45x"]) assert.equal(calendarDaysBetween(bad, "2026-11-14"), null, bad);
});

test("UC-3 recovery projection + facts: a workout at 19:00 VN is 'yesterday' at 01:30 VN the next day (UTC said 'today')", () => {
  const now = Date.parse("2026-11-13T18:30:00Z"); // 2026-11-14 01:30 VN
  const s = sessionsOf([row("2026-11-13T12:00:00Z")]); // 2026-11-13 19:00 VN
  assert.equal(s.sessions[0].date, "2026-11-13");
  const f = recoveryFacts("recovery.get_recent_sessions", s, now) as any;
  assert.deepEqual(f.recentSessions.yesterdayBodyParts, ["LOWER_BODY"]); assert.equal(f.recentSessions.lastLoggedDaysAgo, 1);
  // and the reverse: 03:00 VN today is NOT yesterday (UTC put it on the previous day)
  const early = sessionsOf([row("2026-11-12T20:00:00Z")]); // 2026-11-13 03:00 VN
  assert.equal(early.sessions[0].date, "2026-11-13");
  const g = recoveryFacts("recovery.get_recent_sessions", early, Date.parse("2026-11-13T09:00:00Z")) as any; // 16:00 VN
  assert.equal(g.recentSessions.yesterdayBodyParts, null); assert.equal(g.recentSessions.lastLoggedDaysAgo, 0);
  assert.equal(sessionsOf([row("garbage")]).sessions[0].date, "unknown");
});

test("UC-4 supervisor end-to-end after midnight VN: the user's 'tập chân hôm qua' matches the log — no false history conflict", async () => {
  const s = system();
  s.advance(9.5 * H); // now = 2026-11-13T18:30Z = 2026-11-14 01:30 VN
  (s.w.recovery as any).getRecentWorkoutHistory = async () => ({ status: "ok", value: [row("2026-11-13T12:00:00Z")], source: "FITNESS_SERVICE", fetchedAt: 0 });
  s.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu: hôm qua bạn có một buổi tập thân dưới được ghi lại."));
  s.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  const r = await s.ask(USER_A, "Tôi tập chân hôm qua, hôm nay nên tập gì?");
  assert.ok(r.decision!.agents.includes("recovery"), JSON.stringify(r.decision!.agents));
  assert.deepEqual(r.conflicts.filter((c) => c.startsWith("user_claim")), [], r.answer);
  assert.doesNotMatch(r.answer, /không có buổi tập nào được ghi vào hôm qua/);
  // reverse: at 16:00 VN a 03:00-VN session is today, so "hôm qua" really has no logged session → the conflict note stays
  const t = system();
  (t.w.recovery as any).getRecentWorkoutHistory = async () => ({ status: "ok", value: [row("2026-11-12T20:00:00Z")], source: "FITNESS_SERVICE", fetchedAt: 0 });
  t.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu: buổi gần nhất được ghi là hôm nay."));
  t.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài."));
  const r2 = await t.ask(USER_A, "Tôi tập chân hôm qua, hôm nay nên tập gì?");
  assert.ok(r2.conflicts.includes("user_claims_session_not_in_history"), JSON.stringify(r2.conflicts));
  assert.equal(T0, Date.parse("2026-11-13T09:00:00.000Z"));
});

test("UC-5 progress dates are user-calendar days (cycle start/end, assessment date)", () => {
  const cycle = PROGRESS_TOOL_CONTRACTS.find((c) => c.id === "progress.get_cycle_status")!.project as (r: unknown) => any;
  const p = cycle({ active: { cycle: { status: "ACTIVE", weekNumber: 2, startDate: "2026-11-01T17:30:00Z", endDate: "2026-11-29" } }, assessment: { decision: "KEEP", userDecision: null, createdAt: "2026-11-12T23:10:00Z" } });
  assert.equal(p.activeCycle.startDate, "2026-11-02", "00:30 VN on the 2nd, UTC said the 1st");
  assert.equal(p.activeCycle.endDate, "2026-11-29");
  assert.equal(p.latestAssessment.createdAt, "2026-11-13");
  const none = cycle({ active: { cycle: { status: "ACTIVE", startDate: null, endDate: "" } }, assessment: null });
  assert.equal(none.activeCycle.startDate, null); assert.equal(none.activeCycle.endDate, null);
});
