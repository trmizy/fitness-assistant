// Independent (Claude-authored) REAL HTTP/API + DB reproduction of Codex's final sign-off finding X4-T10
// (docs/codex-conversational-intelligence-final-signoff.md "New Blocking Finding: X4-T10") — a live PENDING
// FitnessAgentAction ranked 11th by updatedAt (behind 10 newer terminal rows in the same session) was hidden by
// tryConfirmationBoundary's `take: 10` window. Run AFTER the fix (docs/conversational-intelligence-x4-t10-final-fix.md).
import fs from "node:fs";
import { registerUser, putProfile, say, q, confirmAction } from "../ai-chat-full-verification/lib.mjs";
const aq = (sql) => q("ai", sql).trim();
const uq = (sql) => q("user", sql).trim();

const u = await registerUser(`x4t10.repro.${Date.now()}@gymini-test.local`, "X4 T10 Repro");
await putProfile(u, { hasCompletedOnboarding: true, goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
const r0 = await say(u, "Tôi đang có PT chưa?"); // establish a session without triggering any draft
const sid = r0.sessionId;

// Create ONE real, still-live PENDING draft action via the real HTTP path (workout-plan draft).
const draft = await say(u, "Tạo lịch tập cho tôi.", sid);
const actionId = draft.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
if (!actionId) throw new Error("PRECONDITION_FAILED: no draft action created");
console.log("1) draft created:", actionId, "status:", aq(`select status from fitness_agent_actions where id='${actionId}'`));

// 10 newer, unrelated terminal rows in the SAME session — TEST FIXTURE (exactly mirrors Codex's construction:
// real draft/pending action via real HTTP, additional history rows as explicit fixtures).
for (let i = 1; i <= 10; i++) {
  aq(`insert into fitness_agent_actions (id, user_id, session_id, kind, risk, payload, status, expires_at, created_at, updated_at) values (gen_random_uuid(), '${u.userId}', '${sid}', 'CREATE_NUTRITION_PLAN', 'MEDIUM', '{}', 'COMPLETED', now() + interval '10 minutes', now() + interval '${i} seconds', now() + interval '${i} seconds')`); // TEST FIXTURE
}
console.log("2) total rows in session:", aq(`select count(*) from fitness_agent_actions where session_id='${sid}'`));
console.log("   pending action still live:", aq(`select status, expires_at > now() as still_live from fitness_agent_actions where id='${actionId}'`));

const status1 = await say(u, "Đã lưu thành công chưa?", sid);
console.log("3) status question (pending hidden behind 10 newer terminal rows):", status1.status, "->", status1.answer);
const pendingDetected = /Chưa — mình chưa lưu gì cả/.test(status1.answer);
const draftStillPending1 = aq(`select status from fitness_agent_actions where id='${actionId}'`) === "PENDING";

// Now actually resolve the pending draft via the REAL confirmation endpoint (a bare "Xác nhận cập nhật." text
// message never confirms a DRAFT action by design — only the dedicated /confirm endpoint, i.e. the card's own
// button, does; text-only confirmation is reserved for a profile workflow's AWAITING_SLOT_CONFIRMATION step. See
// confirmation-boundary.ts's own module doc comment: "writes only happen through the confirmation card / the
// workflow's own confirmation step").
const confirm = await confirmAction(u, actionId);
console.log("4) real /confirm call:", confirm.status, "->", JSON.stringify(confirm.json).slice(0, 150));
const statusAfter = aq(`select status from fitness_agent_actions where id='${actionId}'`);
const status2 = await say(u, "Đã lưu thành công chưa?", sid);
console.log("5) status question after resolution:", status2.status, "->", status2.answer);
const actionCountAfter = aq(`select count(*) from fitness_agent_actions where session_id='${sid}'`);

const nowTruthfulPositive = /^Rồi/.test(status2.answer) && !/Chưa có thay đổi nào được lưu/i.test(status2.answer);
const result = {
  actionId, totalRowsInSession: 11, pendingDetectedBeforeResolution: pendingDetected, draftStillPendingBeforeResolution: draftStillPending1,
  confirmHttp: confirm.status, draftStatusAfterConfirm: statusAfter, statusAnswerAfterResolution: status2.answer,
  noNewRowsCreated: actionCountAfter === "11", nowTruthfulPositive,
};
console.log("\nRESULT", JSON.stringify(result, null, 2));
fs.mkdirSync("test/conversational-intelligence/results/final-closure", { recursive: true });
fs.writeFileSync("test/conversational-intelligence/results/final-closure/x4-t10-repro.json", JSON.stringify(result, null, 2));
const ok = pendingDetected && draftStillPending1 && statusAfter === "COMPLETED" && nowTruthfulPositive && result.noNewRowsCreated;
console.log("\nok=", ok);
process.exit(ok ? 0 : 1);
