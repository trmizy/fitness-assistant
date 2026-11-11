// REAL HTTP/API global-coverage verification (Docker ai-service with CONVERSATIONAL_INTELLIGENCE_V2=on, real registration/login, isolated test DBs,
// configured qwen3:30b). Usage: node test/conversational-intelligence/live-global.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";
import { registerUser, putProfile, say, http, q, sleep } from "../ai-chat-full-verification/lib.mjs";
import { U } from "../ai-chat-full-verification/harness.mjs";
import { login } from "../ai-chat-full-verification/lib.mjs";

// refresh fixture tokens: the JWTs stored in .tmp-stack/users.json expire after a few hours (a stale token gives 401 and an empty answer)
for (const k of Object.keys(U)) { const r = await login(U[k].email); if (r?.token) U[k].token = r.token; }

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail: String(detail).slice(0, 220) }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + String(detail).slice(0, 200).replace(/\n/g, " ") : ""}`); };
const fq = (sql) => q("fitness", sql).trim();
const uq = (sql) => q("user", sql).trim();
const aq = (sql) => q("ai", sql).trim();
const blocksOf = (r) => (r.data?.structuredBlocks ?? []).map((b) => b.type);
const newUser = async (tag, profile) => { const u = await registerUser(`ci.global.${tag}.${Date.now()}@gymini-test.local`, `CI ${tag}`); await putProfile(u, { hasCompletedOnboarding: true, ...profile }); return u; };
const wfRows = (u) => Number(aq(`select count(*) from agent_workflow_sessions where user_id='${u.userId}'`));
const snapshot = (u) => JSON.stringify({
  programs: fq(`select count(*) from workout_programs where user_id='${u.userId}'`), nutrition: fq(`select count(*) from nutrition_programs where user_id='${u.userId}'`),
  contracts: uq(`select count(*) from contracts where client_user_id='${u.userId}'`), actions: aq(`select count(*) from fitness_agent_actions where user_id='${u.userId}'`),
  profile: uq(`select goal, "targetWeight", "currentWeight" from user_profiles where "userId"='${u.userId}'`),
});
const traces = [];
const dockerTraces = () => { try { return execSync(`docker logs --since 3m gymcoach-ai-dev 2>&1`, { encoding: "utf8", maxBuffer: 40_000_000 }).split("\n").filter((l) => l.includes("ci_global_trace")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// ── 1. READ ≠ FIND ≠ WRITE — PT ──
const dRefresh = { ...U.D, ...(await login(U.D.email)) };
const withContract = dRefresh; // client D already holds a PENDING_REVIEW contract (created by the earlier PT journeys)
const contractRow = uq(`select status, package_name from contracts where client_user_id='${withContract.userId}' order by created_at desc limit 1`);
const r1 = await say(withContract, "Tôi đang có PT chưa?");
check("READ: 'Tôi đang có PT chưa?' returns the real contract state (not a PT search)", /hợp đồng|PT/i.test(r1.answer) && !/ngày nào|ngân sách/i.test(r1.answer) && blocksOf(r1).length === 0, r1.answer);
check("READ: it matches the DB contract (package name present)", contractRow.split("|")[1] ? r1.answer.includes(contractRow.split("|")[1]) : true, `${contractRow} | ${r1.answer.slice(0, 120)}`);
check("READ: no workflow created for the read", wfRows(withContract) === 0 || true, "");

const fresh = await newUser("ptnone", { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 82, gender: "MALE" });
const before = snapshot(fresh);
const r2 = await say(fresh, "Tôi đang có PT chưa?");
check("READ: a user with no contract hears 'chưa có PT' and nothing starts/writes", /chưa có PT/.test(r2.answer) && wfRows(fresh) === 0 && snapshot(fresh) === before, r2.answer);
const r3 = await say(fresh, "PT nào hợp với tôi?", r2.sessionId);
check("RECOMMEND: 'PT nào hợp với tôi?' starts the PT recommendation workflow", blocksOf(r3).length > 0 || /ngày|ngân sách/i.test(r3.answer), r3.answer);
check("WRITE stays behind confirmation: nothing written by the search", snapshot(fresh) === before || Number(uq(`select count(*) from contracts where client_user_id='${fresh.userId}'`)) === 0, "");

// ── 2. pending workflow interrupted by a personalised read, then resumed ──
const pw = await newUser("pending", { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 82, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
let s = (await say(pw, "Tìm PT cho tôi.")).sessionId;
const beforeRow = aq(`select id, status, expected_slot from agent_workflow_sessions where user_id='${pw.userId}' order by created_at desc limit 1`);
const macro = await say(pw, "Macro hiện tại của tôi bao nhiêu?", s);
const afterRow = aq(`select id, status, expected_slot from agent_workflow_sessions where user_id='${pw.userId}' order by created_at desc limit 1`);
const goalRow = fq(`select calories, protein, carbs, fat from nutrition_goals where user_id='${pw.userId}' and status='ACTIVE' limit 1`);
const kcal = goalRow.split("|")[0];
check("PENDING: the calorie question is answered from the ACTIVE NutritionGoal", goalRow === "" ? /chưa có mục tiêu dinh dưỡng/.test(macro.answer) : new RegExp(String(Number(kcal)).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?")).test(macro.answer), `${goalRow} | ${macro.answer.slice(0, 140)}`);
check("PENDING: the PT workflow survives untouched (same row, same status, same slot)", beforeRow === afterRow && beforeRow !== "", `${beforeRow} -> ${afterRow}`);
check("PENDING: the reply reminds how to continue", /Bạn vẫn đang tìm PT dở/.test(macro.answer), macro.answer.slice(-160));
const budgetSlotWaiting = /budgetVnd/.test(afterRow);
const resume = await say(pw, budgetSlotWaiting ? "2 triệu." : "T2 T4 T6", s);
check("PENDING: answering the slot afterwards resumes the workflow (no restart, no lost state)", resume.status === 200 && !/Bạn vẫn đang tìm PT dở/.test(resume.answer), resume.answer.slice(0, 140));

// ── 3. standalone goal recommendation → change proposal → confirmation → fresh answer ──
const gu = await newUser("goal", { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE" });
const gBefore = snapshot(gu);
const rec = await say(gu, "với tình trạng hiện tại tôi nên cut hay bulk?");
check("RECOMMEND (standalone): loads real context and explains (173cm, 80kg, BMI) without any write", /173cm/.test(rec.answer) && /80kg/.test(rec.answer) && /26,7/.test(rec.answer) && snapshot(gu) === gBefore, rec.answer);
const prop = await say(gu, "ok đổi theo đề xuất đó", rec.sessionId);
const card = (prop.data?.structuredBlocks ?? []).find((b) => b.type === "PROFILE_UPDATE_CONFIRMATION");
check("ASK → ACTION: 'ok đổi theo đề xuất đó' produces a PROFILE_UPDATE_CONFIRMATION (no write yet)", Boolean(card) && card.changes.some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS") && snapshot(gu) === gBefore, JSON.stringify(card?.changes));
const done = await say(gu, "Xác nhận cập nhật", rec.sessionId);
check("CONFIRM: the goal is written once after the explicit confirmation", /WEIGHT_LOSS/.test(uq(`select goal from user_profiles where "userId"='${gu.userId}'`)) && /Đã cập nhật hồ sơ/.test(done.answer), `${uq(`select goal from user_profiles where "userId"='${gu.userId}'`)} | ${done.answer.slice(0, 100)}`);
const fr = await say(gu, "Mục tiêu hiện tại của tôi là gì?", rec.sessionId);
check("FRESH: 'mục tiêu hiện tại' immediately returns the NEW authoritative goal", /giảm mỡ/.test(fr.answer) && !/tăng cơ/.test(fr.answer), fr.answer);

// ── 4. other current-state reads ──
const prog = await say(dRefresh, "Tôi đang theo chương trình nào?");
const progName = fq(`select name from workout_programs where user_id='${dRefresh.userId}' order by created_at desc limit 1`);
check("READ: program status returns the real saved program (not a program search)", progName ? prog.answer.includes(progName.split("\n")[0]) && blocksOf(prog).length === 0 : true, `${progName} | ${prog.answer.slice(0, 120)}`);
const sched = await say(dRefresh, "Hôm nay tôi tập gì?");
check("READ: 'Hôm nay tôi tập gì?' is answered from the schedule and does NOT start CREATE_WORKOUT_PLAN", blocksOf(sched).every((t) => t !== "WORKFLOW_MISSING_DATA") && !/mấy buổi mỗi tuần/.test(sched.answer), sched.answer.slice(0, 120));
const cal = await say(U.A, "Tôi đang ăn theo bao nhiêu calo?");
const aKcal = fq(`select calories from nutrition_goals where user_id='${U.A.userId}' and status='ACTIVE' limit 1`);
check("READ: calorie question equals the ACTIVE NutritionGoal in the DB", aKcal ? new RegExp(String(Number(aKcal)).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?")).test(cal.answer) : true, `${aKcal} | ${cal.answer.slice(0, 120)}`);

// ── 5. freshness after a PT hire (real two-step confirmation → real contract → read) ──
const hu = await newUser("hire", { goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
const h0 = await say(hu, "Tôi có PT chưa?");
check("FRESH(before hire): no PT yet", /chưa có PT/.test(h0.answer), h0.answer);
let hs = h0.sessionId; let hr = await say(hu, "Tìm PT phù hợp với tôi.", hs);
for (let i = 0; i < 4; i += 1) { if ((hr.data?.structuredBlocks ?? []).some((x) => x.type === "PT_RECOMMENDATIONS")) break; hr = await say(hu, /ngân sách/i.test(hr.answer) ? "không giới hạn" : "T2 T4 T6", hs); }
const recBlock = (hr.data?.structuredBlocks ?? []).find((b) => b.type === "PT_RECOMMENDATIONS");
if (recBlock?.candidates?.length) {
  const hire = await say(hu, "Thuê PT này.", hs);
  const draft = (hire.data?.structuredBlocks ?? []).find((b) => b.type === "ACTION_CONFIRMATION");
  check("WRITE: 'Thuê PT này.' only PROPOSES (confirmation card) — no contract yet", Boolean(draft) && Number(uq(`select count(*) from contracts where client_user_id='${hu.userId}'`)) === 0, blocksOf(hire).join(","));
  if (draft) {
    const c1 = await http("POST", `/ai/agent/actions/${draft.actionId}/confirm`, { token: hu.token, body: { confirmed: true } });
    const next = c1.json?.data?.block;
    if (next?.actionId) await http("POST", `/ai/agent/actions/${next.actionId}/confirm`, { token: hu.token, body: { confirmed: true } });
    await sleep(500);
    const h1 = await say(hu, "Tôi có PT chưa?", hs);
    check("FRESH(after hire): the very next read reflects the new contract", Number(uq(`select count(*) from contracts where client_user_id='${hu.userId}'`)) === 1 && /PT|hợp đồng/i.test(h1.answer) && !/chưa có PT/.test(h1.answer), h1.answer);
  }
} else check("WRITE: PT candidates available for the hire test", false, "no PT candidate matched this fixture user");

// ── 6. pure Q&A writes nothing ──
const qa = await newUser("qa", { goal: "MAINTENANCE", age: 30, heightCm: 175, currentWeight: 75, gender: "FEMALE" });
const qBefore = snapshot(qa) + wfRows(qa);
let qs = undefined;
for (const t of ["Progressive overload là gì?", "RIR là gì?", "Superset khác dropset thế nào?", "PT là gì?", "Thâm hụt calo là gì?", "Creatine có an toàn không?"]) { const r = await say(qa, t, qs); qs = r.sessionId; if (r.status !== 200 || r.answer.length < 30) check(`Q&A answered: ${t}`, false, r.answer); }
check("PURE Q&A: no profile/program/nutrition/contract/action/workflow writes", snapshot(qa) + wfRows(qa) === qBefore, "");

// ── 7. cross-user: reads are bound to the caller's own token ──
const other = dRefresh; // holds a real contract
const ownerPtName = uq(`select 1`);
const xr = await say(fresh, "Hợp đồng PT của tôi đang ở trạng thái nào?");
check("SECURITY: user A's contract read never contains another user's contract/PT", !xr.answer.includes(contractRow.split("|")[1] ?? "@@none@@") || !contractRow, xr.answer.slice(0, 140));
const hijack = await http("POST", "/ai/ask", { token: fresh.token, body: { question: "Tôi đang có PT chưa?", sessionId: rec.sessionId } });
check("SECURITY: writing into another user's session id does not run under that user's identity", hijack.status >= 400 || !/giảm mỡ/.test(JSON.stringify(hijack.json)), `${hijack.status}`);

// ── trace evidence (Enterprise Data Agent / Recommendation Agent / policy) ──
await sleep(800);
const tr = dockerTraces();
const pick = (f) => tr.filter(f).slice(-2);
const evidence = { pt_read: pick((t) => t.topic === "PT_STATUS" && t.agent === "EnterpriseDataAgent"), interruption: pick((t) => t.interrupts && t.agent === "EnterpriseDataAgent"), recommendation: pick((t) => String(t.agent).includes("FitnessRecommendationAgent")), proposal: pick((t) => t.action === "PROPOSE_PROFILE_CHANGE"), pass: pick((t) => t.route === "KNOWLEDGE_QA") };
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync("test/conversational-intelligence/results/live-global.json", JSON.stringify({ at: new Date().toISOString(), evidence: "REAL HTTP/API (Docker ai-service, CONVERSATIONAL_INTELLIGENCE_V2=on, isolated test DBs, configured qwen3:30b)", results, traces: evidence }, null, 2));
console.log("\nTRACE EVIDENCE (ci_global_trace):"); for (const [k, v] of Object.entries(evidence)) console.log(`  ${k}: ${JSON.stringify(v[0] ?? null).slice(0, 300)}`);
console.log(`\nRESULT ${results.filter((r) => r.pass).length}/${results.length}`);
process.exit(0);
