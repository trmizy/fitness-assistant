// Independent reproduction (Claude-authored, not a copy of Codex's script) of the newly reported X4 gap: a completed
// UPDATE_GOAL profile-workflow confirmation is invisible to the confirmation boundary, which reads FitnessAgentAction only.
// REAL HTTP/API through the Docker gateway, real DB reads for ground truth.
import { registerUser, putProfile, say, q } from "../ai-chat-full-verification/lib.mjs";
const uq = (sql) => q("user", sql).trim();
const aq = (sql) => q("ai", sql).trim();

const u = await registerUser(`x4followup.repro.${Date.now()}@gymini-test.local`, "X4 Followup Repro");
await putProfile(u, { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE" });

let r = await say(u, "với tình trạng hiện tại tôi nên cut hay bulk?");
const sid = r.sessionId;
console.log("1) recommendation:", r.status, r.answer.slice(0, 80).replace(/\n/g, " "));

r = await say(u, "ok đổi theo đề xuất đó", sid);
console.log("2) proposal accepted:", r.status, r.answer.slice(0, 80).replace(/\n/g, " "));
console.log("   goal before confirm:", uq(`select goal from user_profiles where "userId"='${u.userId}'`));
console.log("   workflow before confirm:", aq(`select workflow_type||'|'||status from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`));

r = await say(u, "Xác nhận cập nhật.", sid);
console.log("3) confirm:", r.status, r.answer.slice(0, 80).replace(/\n/g, " "));
const goalAfter = uq(`select goal from user_profiles where "userId"='${u.userId}'`);
const wfAfter = aq(`select workflow_type||'|'||status from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`);
const actionsAfter = aq(`select count(*) from fitness_agent_actions where user_id='${u.userId}'`);
console.log("   goal after confirm (DB):", goalAfter);
console.log("   workflow after confirm (DB):", wfAfter);
console.log("   fitness_agent_actions rows for this user:", actionsAfter);

r = await say(u, "Đã lưu thành công chưa?", sid);
console.log("4) status question:", r.status, "->", r.answer);

const truthful = goalAfter === "WEIGHT_LOSS" && /đã (được )?(lưu|cập nhật|xác nhận)|thành công|lưu rồi/i.test(r.answer) && !/chưa có thay đổi nào được lưu/i.test(r.answer);
console.log("\nconfirmedWrite(goal really changed)=", goalAfter === "WEIGHT_LOSS", " workflowCompleted=", wfAfter.endsWith("COMPLETED"), " statusAnswerTruthful=", truthful);
process.exit(truthful ? 0 : 1);
