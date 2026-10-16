// Independent (Claude-authored, not a copy of Codex's script) REAL HTTP/API + DB reproduction of the two X4
// event-ordering defects Codex's resumed independent verification reported (docs/codex-conversational-intelligence-
// final-closure-signoff.md), run AFTER the fix (docs/conversational-intelligence-x4-event-ordering-fix.md). Mirrors
// the shape of Codex's own results/codex-final-followup/x4-edge-http.json without overwriting it.
import fs from "node:fs";
import { registerUser, putProfile, say, q, dismissAction } from "../ai-chat-full-verification/lib.mjs";
const aq = (sql) => q("ai", sql).trim();
const uq = (sql) => q("user", sql).trim();

const results = [];

// Defect A: a real completed profile confirmation, then 6 newer unrelated terminal workflows (test fixture rows,
// exactly as Codex's own probe did), then asked whether the earlier update was saved.
{
  const u = await registerUser(`x4order.a.${Date.now()}@gymini-test.local`, "X4 Order A");
  await putProfile(u, { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE" });
  const r1 = await say(u, "với tình trạng hiện tại tôi nên cut hay bulk?");
  await say(u, "ok đổi theo đề xuất đó", r1.sessionId);
  const confirmed = await say(u, "Xác nhận cập nhật.", r1.sessionId);
  const confirmedUpdatedAt = aq(`select updated_at from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`);
  for (let i = 1; i <= 6; i++) {
    aq(`insert into agent_workflow_sessions (id, user_id, session_id, workflow_type, status, slots_json, expires_at, created_at, updated_at) values (gen_random_uuid(), '${u.userId}', '${r1.sessionId}', 'CREATE_WORKOUT_PLAN', 'CANCELLED', '{}', now() + interval '10 minutes', '${confirmedUpdatedAt}'::timestamp + interval '${i} seconds', '${confirmedUpdatedAt}'::timestamp + interval '${i} seconds')`); // TEST FIXTURE, matches Codex's own construction
  }
  const status = await say(u, "Đã lưu thành công chưa?", r1.sessionId);
  const goal = uq(`select goal from user_profiles where "userId"='${u.userId}'`);
  const truthful = goal === "WEIGHT_LOSS" && /^Rồi/.test(status.answer) && !/Chưa có thay đổi nào được lưu/i.test(status.answer);
  console.log("Defect A — confirmedAnswer:", confirmed.answer, "| statusAnswer:", status.answer, "| truthful:", truthful);
  results.push({ scenario: "history-over-five", userId: u.userId, sessionId: r1.sessionId, confirmedAnswer: confirmed.answer, http: status.status, answer: status.answer, goal, truthful });
}

// Defect B: a real draft action, a real profile confirmation completing AFTER it, then the SAME action cancelled via
// the real dismiss API AFTER that (the newest event of all).
{
  const u = await registerUser(`x4order.b.${Date.now()}@gymini-test.local`, "X4 Order B");
  await putProfile(u, { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
  const draft = await say(u, "Tạo lịch tập cho tôi.");
  const actionId = draft.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
  const r1 = await say(u, "với tình trạng hiện tại tôi nên cut hay bulk?", draft.sessionId);
  await say(u, "ok đổi theo đề xuất đó", r1.sessionId);
  const confirmed = await say(u, "Xác nhận cập nhật.", r1.sessionId);
  const d = await dismissAction(u, actionId);
  const status = await say(u, "Đã lưu thành công chưa?", draft.sessionId);
  const goal = uq(`select goal from user_profiles where "userId"='${u.userId}'`);
  const actionStatus = aq(`select status from fitness_agent_actions where id='${actionId}'`);
  const truthful = goal === "WEIGHT_LOSS" && actionStatus === "CANCELLED" && /đã được bỏ qua/.test(status.answer);
  console.log("Defect B — confirmedAnswer:", confirmed.answer, "| dismiss:", d.status, "| statusAnswer:", status.answer, "| truthful:", truthful);
  results.push({ scenario: "action-cancelled-later", userId: u.userId, sessionId: draft.sessionId, actionId, confirmedAnswer: confirmed.answer, dismissStatus: d.status, http: status.status, answer: status.answer, goal, actionStatus, truthful });
}

fs.mkdirSync("test/conversational-intelligence/results/final-closure", { recursive: true });
fs.writeFileSync("test/conversational-intelligence/results/final-closure/x4-event-ordering-after.json", JSON.stringify(results, null, 2));
const allTruthful = results.every((r) => r.truthful);
console.log(`\nallTruthful=${allTruthful}`);
process.exit(allTruthful ? 0 : 1);
