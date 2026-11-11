// Level C: the 20-step supervisor conversation (multi-domain, one user, one continuous chat session where possible).
// Enterprise Data -> Recommendation -> Action -> business DB -> next chat answer reflects the new truth. REAL gateway, configured qwen3:30b.
// Usage: node test/ai-chat-full-verification/supervisor.mjs      (user: G, created by setup-users-supervisor.mjs / auto-registered here)
import fs from "node:fs";
import { ok, info, setJourney, turn, fq, uq, aiq, fqOne, actionRow, confirmViaApi, finish } from "./harness.mjs";
import { registerUser, putProfile, sleep, appendJsonl } from "./lib.mjs";

const TRACE = "test/ai-chat-full-verification/results/supervisor-trace.jsonl";
const cnt = (sql) => Number(fqOne(sql));
setJourney("supervisor-20-step");

const email = `chat.g.${Date.now()}@gymini-test.local`;
const g = await registerUser(email, "Tester G");
await putProfile(g, { goal: "WEIGHT_LOSS", activityLevel: "MODERATELY_ACTIVE" }); // otherwise incomplete profile. activityLevel is pre-set: the roadmap workflow does not collect it and nutrition bootstrap needs it (documented limitation L-activity)
info(`user G ${g.userId}`);
let s;
const step = async (n, label, fn) => { console.log(`\n=== STEP ${n}: ${label}`); const rec = { step: n, label, at: new Date().toISOString() }; try { rec.result = await fn(); } catch (e) { ok(`step ${n} threw`, false, e?.message); rec.error = e?.message; } appendJsonl(TRACE, rec); };
const say = async (label, text) => { const t = await turn(label, g, text, s); s = t.sessionId; return t; };
const before = () => ({
  roadmaps: cnt(`select count(*) from fitness_roadmaps where user_id='${g.userId}' and status='ACTIVE'`),
  programs: cnt(`select count(*) from workout_programs where user_id='${g.userId}'`),
  contracts: Number(uq(`select count(*) from contracts where client_user_id='${g.userId}'`)),
  nutritionPrograms: cnt(`select count(*) from nutrition_programs where user_id='${g.userId}'`),
});

await step(1, "goal statement (no workflow yet)", async () => { const t = await say("s1", "Tôi muốn giảm mỡ."); ok("statement answered, no card, no write", t.blocks.length === 0 && Object.values(before()).every((v) => v === 0)); });
await step(2, "create roadmap -> missing data", async () => { const t = await say("s2", "Tạo lộ trình giảm mỡ cho tôi."); ok("roadmap workflow asks only missing profile data", !!t.block("WORKFLOW_MISSING_DATA")); });
await step(3, "provide missing data", async () => { let t; for (const a of ["Tôi 27 tuổi", "cao 170cm", "nặng 82kg", "nam", "tôi muốn xuống 72kg"]) t = await say("s3", a); ok("PROFILE_UPDATE_CONFIRMATION shown, nothing written yet", !!t.block("PROFILE_UPDATE_CONFIRMATION") && uq(`select age from user_profiles where "userId"='${g.userId}'`) === ""); });
await step(4, "confirm profile", async () => { const t = await say("s4", "Đồng ý, lưu vào hồ sơ"); ok("profile written and the original roadmap request resumed to a preview", !!t.block("ACTION_CONFIRMATION") && uq(`select age from user_profiles where "userId"='${g.userId}'`) === "27", t.blocks.map((b) => b.type).join(",")); return { actionId: t.actionId }; });
let bundleAction;
await step(5, "revise roadmap", async () => { const t = await say("s5", "Đổi thành 4 tháng."); bundleAction = t.block("ACTION_CONFIRMATION")?.actionId; ok("same pending roadmap action revised", !!bundleAction, bundleAction); });
await step(6, "confirm roadmap (button)", async () => {
  const c = await confirmViaApi(g, bundleAction);
  ok("roadmap bundle confirmed", c.status === 200, c.status);
  ok("ACTIVE FitnessRoadmap + NutritionGoal exist in the DB", cnt(`select count(*) from fitness_roadmaps where user_id='${g.userId}' and status='ACTIVE'`) === 1 && cnt(`select count(*) from nutrition_goals where user_id='${g.userId}' and status='ACTIVE'`) >= 1, fq(`select status from fitness_roadmaps where user_id='${g.userId}'`));
  return { steps: c.json?.data?.block?.steps };
});
await sleep(16000); // profile-cache TTL: subsequent reads must see the roadmap-era state
let workoutAction, programsBefore;
await step(7, "workout plan from that goal", async () => {
  programsBefore = before().programs;
  let t = await say("s7", "Tạo lịch tập theo lộ trình đó.");
  for (const a of ["4 buổi mỗi tuần", "60 phút mỗi buổi"]) { if (t.block("WORKOUT_PLAN_PREVIEW")) break; t = await say("s7", a); }
  workoutAction = t.block("WORKOUT_PLAN_PREVIEW")?.actionId; ok("WORKOUT_PLAN_PREVIEW shown", !!workoutAction, t.blocks.map((b) => b.type).join(","));
});
await step(8, "revise workout (unavailable weekday)", async () => { const t = await say("s8", "Thứ 4 tôi bận."); ok("plan kept at its session count, moved off Wednesday", /vẫn \d+ buổi/.test(t.answer), t.answer.slice(0, 100)); });
await step(9, "confirm workout", async () => { const c = await confirmViaApi(g, workoutAction); ok("workout saved", c.status === 200 && before().programs === programsBefore + 1, `${c.status} programs ${programsBefore}->${before().programs}`); });
let ptRec, hireAction;
await step(10, "find PT", async () => {
  let t = await say("s10", "Tìm PT phù hợp với tôi.");
  for (const a of ["T2 T4 T6", "không giới hạn"]) { if (t.block("PT_RECOMMENDATIONS")) break; t = await say("s10", a); }
  ptRec = t.block("PT_RECOMMENDATIONS"); ok("PT_RECOMMENDATIONS shown (real PT candidates, or an honest 'no match')", !!ptRec, t.blocks.map((b) => b.type).join(","));
  return { n: ptRec?.candidates?.length, ids: ptRec?.candidates?.map((c) => c.id), recommendationId: ptRec?.recommendationId };
});
await step(11, "why is PT #1 a fit", async () => { if (!ptRec?.candidates?.length) { info("no PT candidate matched this profile in the fixture roster; steps 11-14 skipped honestly"); return { skipped: true }; } const t = await say("s11", "Vì sao PT thứ nhất phù hợp?"); ok("answer grounded in the stored recommendation (name + score)", t.answer.includes(ptRec.candidates[0].name) && /\/100/.test(t.answer), t.answer.slice(0, 120)); });
await step(12, "hire PT", async () => { if (!ptRec?.candidates?.length) return { skipped: true }; const t = await say("s12", "Thuê PT này."); hireAction = t.block("ACTION_CONFIRMATION")?.actionId; ok("draft confirmation, no contract yet", !!hireAction && before().contracts === 0); });
await step(13, "confirm PT draft + contract", async () => {
  if (!hireAction) return { skipped: true };
  const c1 = await confirmViaApi(g, hireAction); const next = c1.json?.data?.block;
  ok("second confirmation card (CONFIRM_PT_CONTRACT) offered", next?.kind === "CONFIRM_PT_CONTRACT" && before().contracts === 0, next?.kind);
  const c2 = await confirmViaApi(g, next.actionId);
  ok("real PT contract created (PENDING_REVIEW)", before().contracts === 1, `${c2.status} ${JSON.stringify(c2.json?.data?.block ?? {}).slice(0, 100)}`);
});
await step(14, "PT/contract status question (KNOWN LIMITATION: no contract-status read intent; it re-enters the PT search)", async () => { if (!hireAction) return { skipped: true }; const t = await say("s14", "Tôi đang có PT chưa?"); info("step14 answer: " + t.answer.slice(0, 140)); ok("no false claim about the contract (no write, no \"you have no PT\" statement)", !/chưa có PT|chưa có hợp đồng/i.test(t.answer) && before().contracts === 1, t.answer.slice(0, 140)); });
await step(14.5, "interruption: a calorie question while a PT search is pending (observed behaviour, then cancel the search)", async () => {
  const t = await say("s14b", "Một ngày tôi cần bao nhiêu calo?");
  info("interrupt answer: " + t.answer.slice(0, 160));
  const hijacked = /ngày tập|ngân sách|budget/i.test(t.answer) && !/kcal/i.test(t.answer);
  info(hijacked ? "OBSERVED: the pending PT slot workflow swallowed an unrelated Q&A turn" : "Q&A answered while the PT workflow was pending");
  await say("s14c", "Thôi không tìm PT nữa.");
  return { hijacked };
});
await step(15, "TDEE / calorie question uses the authoritative goal", async () => {
  const goal = fq(`select calories from nutrition_goals where user_id='${g.userId}' and status='ACTIVE'`).split("\n")[0];
  const t = await say("s15", "Một ngày tôi cần bao nhiêu calo?");
  ok(`answer states the ACTIVE NutritionGoal (${goal} kcal) created by the roadmap bundle`, goal !== "" && new RegExp(goal.replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?")).test(t.answer), t.answer.slice(0, 140));
  return { goal };
});
let nutAction, nutBefore;
await step(16, "nutrition plan (constraints in one message + count)", async () => {
  nutBefore = before().nutritionPrograms;
  await say("s16", "Tạo thực đơn, tôi không ăn cá.");
  await say("s17", "À tôi cũng không ăn thịt bò.");
  let t = await say("s17", "4 bữa");
  for (let i = 0; i < 40 && !t.block("NUTRITION_PLAN_PREVIEW"); i += 1) { await sleep(4000); t = await say("s16-poll", "Thực đơn xong chưa?"); }
  nutAction = t.block("NUTRITION_PLAN_PREVIEW")?.actionId; ok("NUTRITION_PLAN_PREVIEW shown", !!nutAction, t.blocks.map((b) => b.type).join(","));
});
await step(18, "revise to 3 meals", async () => {
  let t = await say("s18", "Ít bữa hơn.");
  for (let i = 0; i < 40 && !t.block("NUTRITION_PLAN_PREVIEW"); i += 1) { await sleep(4000); t = await say("s18-poll", "Xong chưa?"); }
  ok("revised preview on the SAME action", t.block("NUTRITION_PLAN_PREVIEW")?.actionId === nutAction, t.blocks.map((b) => b.type).join(","));
});
await step(19, "confirm nutrition", async () => { const c = await confirmViaApi(g, nutAction); ok("real NutritionProgram saved", c.status === 200 && before().nutritionPrograms === nutBefore + 1, `${c.status}`); });
await step(20, "current schedule question uses the saved program", async () => { const t = await say("s20", "Lịch tập hiện tại của tôi thế nào?"); ok("answer describes the saved training program (fresh)", /lịch|tập|buổi|Thứ/i.test(t.answer) && !/chưa có (lịch|chương trình)/i.test(t.answer), t.answer.slice(0, 200)); });

info("final state: " + JSON.stringify(before()));
finish(["supervisor"]);
