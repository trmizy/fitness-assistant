// Level C journeys: REAL HTTP through the gateway with real JWTs, configured qwen3:30b, real BullMQ worker, real DBs.
// Usage: node test/ai-chat-full-verification/journeys.mjs <journey> [more...]
//   journeys: roadmapMissingData roadmapCreateSave workoutJourney programJourney ptJourney nutritionJourney unsupportedNutrition
import { U, ok, info, setJourney, turn, fq, uq, aiq, fqOne, actionRow, confirmViaApi, fillSlots, finish } from "./harness.mjs";
import { sleep } from "./lib.mjs";

const cnt = (sql) => Number(fqOne(sql));
const contracts = (uid) => Number(uq(`select count(*) from contracts where client_user_id='${uid}'`));

export async function roadmapMissingData() { // incomplete profile -> only missing fields asked -> profile confirm -> resume -> preview
  setJourney("roadmap-missing-data");
  const c = U[process.env.JUSER || "F"]; let s;
  let t = await turn("create", c, "Tạo lộ trình giảm mỡ cho tôi"); s = t.sessionId;
  ok("intent routed to the roadmap workflow (asks ONLY missing data, no generic chat)", t.block("WORKFLOW_MISSING_DATA"), t.blocks.map((b) => b.type).join(","));
  const known = t.block("WORKFLOW_MISSING_DATA")?.known ?? [];
  ok("goal already known from the profile is NOT re-asked", known.some((k) => /mục tiêu/.test(k.label)), JSON.stringify(known).slice(0, 140));
  for (const ans of ["Tôi 27 tuổi", "cao 170cm", "nặng 82kg", "nam", "tôi muốn xuống 72kg"]) { t = await turn("slot", c, ans, s); s = t.sessionId; }
  const pu = t.block("PROFILE_UPDATE_CONFIRMATION");
  ok("PROFILE_FACT change requires a confirmation card (allowUseOnce=false) and nothing is written yet", pu && pu.allowUseOnce === false && uq(`select age from user_profiles where "userId"='${c.userId}'`) === "", JSON.stringify(pu?.changes ?? []).slice(0, 160));
  t = await turn("profile-confirm", c, "Đồng ý, lưu vào hồ sơ", s); s = t.sessionId;
  ok("after the confirmation the ORIGINAL request resumes into a roadmap preview (no re-asking, fresh profile)", t.block("ACTION_CONFIRMATION"), t.blocks.map((b) => b.type).join(","));
  const prof = uq(`select age, gender, "heightCm", "currentWeight", "targetWeight" from user_profiles where "userId"='${c.userId}'`);
  ok("authoritative profile holds the confirmed values", prof === "27|MALE|170|82|72", prof);
  return { user: c, sessionId: s, last: t };
}

export async function roadmapCreateSave() { // complete profile -> preview -> revise -> confirm -> DB
  setJourney("roadmap-create-revise-save");
  const u = U.E;
  let t = await turn("create", u, "Tạo lộ trình giảm mỡ cho tôi"); let s = t.sessionId;
  ok("roadmap preview produced", t.block("ACTION_CONFIRMATION")?.kind === "CREATE_PLAN_BUNDLE", t.blocks.map((b) => b.type + ":" + b.kind).join(","));
  const conf = t.block("ACTION_CONFIRMATION"); if (!conf) return {};
  ok("risk shown as HIGH", conf.risk === "HIGH", conf.risk);
  ok("nothing persisted before confirmation", cnt(`select count(*) from fitness_roadmaps where user_id='${u.userId}'`) === 0);
  const r = await turn("revise", u, "Đổi thành 4 tháng.", s); s = r.sessionId;
  info("revise blocks: " + r.blocks.map((b) => b.type + ":" + (b.kind ?? "")).join(",") + " summary: " + JSON.stringify(r.block("ACTION_CONFIRMATION")?.summary ?? {}));
  const conf2 = r.block("ACTION_CONFIRMATION") ?? conf;
  ok("revision reuses the SAME pending action", conf2.actionId === conf.actionId, `${conf.actionId} vs ${conf2.actionId}`);
  const c1 = await confirmViaApi(u, conf2.actionId);
  ok("confirm succeeded", c1.status === 200, c1.status);
  const roadmaps = fq(`select id, status from fitness_roadmaps where user_id='${u.userId}'`);
  ok("a real ACTIVE FitnessRoadmap exists", /ACTIVE/.test(roadmaps), roadmaps);
  ok("action is COMPLETED", /COMPLETED/.test(actionRow(conf2.actionId)), actionRow(conf2.actionId));
  const c2 = await confirmViaApi(u, conf2.actionId);
  ok("replaying the confirmation creates no second roadmap", cnt(`select count(*) from fitness_roadmaps where user_id='${u.userId}' and status='ACTIVE'`) === 1, c2.status);
  return { user: u, sessionId: s };
}

export async function workoutJourney() { // create -> revise (equipment, weekday) -> save by chat text -> replay
  setJourney("workout-create-revise-save");
  const user = U.D;
  let t = await turn("create", user, "Tạo lịch tập cho tôi."); let s = t.sessionId;
  ok("workout workflow opened (asks only what is missing)", t.block("WORKFLOW_MISSING_DATA") || t.block("WORKOUT_PLAN_PREVIEW"), t.blocks.map((b) => b.type).join(","));
  ({ t, s } = await fillSlots(user, s, t, ["4 buổi mỗi tuần", "60 phút mỗi buổi"], "WORKOUT_PLAN_PREVIEW"));
  const prev = t.block("WORKOUT_PLAN_PREVIEW");
  ok("WORKOUT_PLAN_PREVIEW produced with an actionId", !!prev?.actionId, t.blocks.map((b) => b.type).join(","));
  if (!prev) return {};
  info("preview keys: " + Object.keys(prev).join(","));
  const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
  let r = await turn("revise-equipment", user, "Tôi không có máy cable.", s); s = r.sessionId;
  ok("revision keeps the SAME pending action", (r.block("WORKOUT_PLAN_PREVIEW")?.actionId ?? r.actionId) === prev.actionId, r.actionId);
  r = await turn("revise-weekday", user, "Thứ 4 tôi bận.", s); s = r.sessionId;
  const actionNow = r.block("WORKOUT_PLAN_PREVIEW")?.actionId ?? prev.actionId;
  ok("nothing was written by revisions", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before);
  r = await turn("save-text", user, "Ổn rồi, lưu đi.", s); s = r.sessionId;
  ok("a bare 'lưu đi' is NOT an execution path: honest 'nothing saved yet', no false success claim, nothing written", /chưa lưu gì/i.test(r.answer) && !/thành công/i.test(r.answer) && cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before, r.answer.slice(0, 100));
  const c1 = await confirmViaApi(user, actionNow);
  ok("confirmation card (button) succeeds", c1.status === 200, c1.status);
  info("action row after confirm: " + actionRow(actionNow));
  ok("real WorkoutProgram persisted by the confirmation", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, actionRow(actionNow));
  const days = fq(`select count(*) from workout_program_days d join workout_programs p on p.id=d.program_id where p.user_id='${user.userId}'`);
  info("persisted program days: " + days + " (revised weekday must not have collapsed the plan)");
  const c2 = await confirmViaApi(user, actionNow);
  ok("confirming again does not duplicate the program (stored result replay)", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, c2.status);
  r = await turn("save-replay-text", user, "Lưu đi", s); s = r.sessionId;
  ok("after completion a bare 'lưu đi' says nothing is pending (still no false success)", /chưa có bản nháp|chưa lưu/i.test(r.answer) && !/thành công/i.test(r.answer), r.answer.slice(0, 100));
  return { user, sessionId: s };
}

export async function programJourney() { // find -> pick #2 -> confirm -> DB -> replay
  setJourney("program-find-apply");
  const user = U.A;
  let t = await turn("find", user, "Tìm chương trình tập phù hợp với tôi."); let s = t.sessionId;
  ({ t, s } = await fillSlots(user, s, t, ["60 phút mỗi buổi", "Tôi tập T2 T4 T6"], "PROGRAM_RECOMMENDATIONS"));
  const rec = t.block("PROGRAM_RECOMMENDATIONS");
  ok("PROGRAM_RECOMMENDATIONS produced (eligible candidates)", !!rec, t.blocks.map((b) => b.type).join(","));
  if (!rec) return {};
  const cands = rec.candidates ?? [];
  info("candidate keys: " + Object.keys(cands[0] ?? {}).join(","));
  info("candidates: " + JSON.stringify(cands.map((c) => ({ id: c.id ?? c.programId ?? c.templateId, name: String(c.name ?? c.title ?? "").slice(0, 60), score: c.compatibility?.total ?? c.score }))));
  const ids = cands.map((c) => c.id ?? c.programId ?? c.templateId);
  ok("candidates are real templates in the DB (no invented program ids)", ids.length > 0 && ids.every((id) => fqOne(`select count(*) from workout_program_templates where id='${id}'`) === "1"), ids.join(","));
  const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
  let r = await turn("select-2", user, "Chọn chương trình thứ 2", s); s = r.sessionId;
  const conf = r.block("ACTION_CONFIRMATION");
  ok("selecting produces a confirmation and does NOT write", !!conf && cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before, r.blocks.map((b) => b.type).join(","));
  if (!conf) return {};
  const c1 = await confirmViaApi(user, conf.actionId);
  ok("confirm succeeded", c1.status === 200, c1.status);
  ok("real program applied (WorkoutProgram row created)", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1);
  const c2 = await confirmViaApi(user, conf.actionId);
  ok("confirm replay is idempotent (no duplicate program)", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, c2.status);
  return { user, sessionId: s };
}

export async function ptJourney() { // find -> ask why -> hire -> draft confirm -> contract confirm -> replay
  setJourney("pt-search-hire");
  const user = U.A;
  let t = await turn("pt-search", user, "Tìm PT phù hợp với tôi."); let s = t.sessionId;
  ({ t, s } = await fillSlots(user, s, t, ["không giới hạn"], "PT_RECOMMENDATIONS"));
  const rec = t.block("PT_RECOMMENDATIONS");
  ok("PT_RECOMMENDATIONS produced from real PT candidates", !!rec, t.blocks.map((b) => b.type).join(","));
  if (!rec) return {};
  const cands = rec.candidates ?? [];
  info("candidate keys: " + Object.keys(cands[0] ?? {}).join(","));
  info("candidates: " + JSON.stringify(cands.slice(0, 3).map((c) => ({ id: c.id ?? c.ptId ?? c.candidateId, name: c.name ?? c.fullName ?? c.displayName, score: c.compatibility?.total ?? c.score }))));
  const ids = cands.map((c) => c.id ?? c.ptId ?? c.candidateId ?? c.userId).filter(Boolean);
  ok("every candidate id exists as a real PT profile (no invented PT)", ids.length > 0 && ids.every((id) => Number(uq(`select count(*) from user_profiles where id='${id}' or "userId"='${id}'`)) >= 1), ids.join(","));
  let r = await turn("why", user, "Vì sao PT thứ nhất phù hợp?", s); s = r.sessionId;
  const before = contracts(user.userId);
  r = await turn("hire", user, "Thuê PT này.", s); s = r.sessionId;
  const draftConf = r.block("ACTION_CONFIRMATION");
  ok("hire request produces a confirmation card (never a direct write)", !!draftConf, r.blocks.map((b) => b.type + ":" + (b.kind ?? "")).join(","));
  ok("no contract exists before confirmation", contracts(user.userId) === before);
  if (!draftConf) return {};
  const c1 = await confirmViaApi(user, draftConf.actionId);
  info("first confirm body: " + JSON.stringify(c1.json).slice(0, 500));
  const blocksOf = (j) => j?.data?.blocks ?? j?.data?.structuredBlocks ?? (j?.data?.block ? [j.data.block] : []);
  const next = blocksOf(c1.json).find?.((b) => b.type === "ACTION_CONFIRMATION");
  ok("PT contract needs a SECOND explicit confirmation (draft first, contract second)", !!next && contracts(user.userId) === before, JSON.stringify(next ?? {}).slice(0, 200));
  if (next) {
    const c2 = await confirmViaApi(user, next.actionId);
    info("second confirm body: " + JSON.stringify(c2.json).slice(0, 300));
    const after = contracts(user.userId);
    ok("real PT contract exists after the second confirmation", after === before + 1, `${before} -> ${after}`);
    await confirmViaApi(user, next.actionId);
    ok("repeating the confirmation creates no duplicate contract", contracts(user.userId) === after);
  }
  return { user, sessionId: s };
}

export async function nutritionJourney() { // 3-turn accumulation -> job -> preview -> revise -> save (text) -> replay
  setJourney("nutrition-create-revise-save");
  const user = U.A;
  let t = await turn("t1", user, "Tạo thực đơn, tôi không ăn cá."); let s = t.sessionId;
  t = await turn("t2", user, "À tôi cũng không ăn thịt bò.", s); s = t.sessionId;
  t = await turn("t3", user, "4 bữa", s); s = t.sessionId;
  ok("generation started (job queued)", /tính thực đơn|đang/i.test(t.answer) || t.blocks.length > 0, t.answer.slice(0, 80));
  info("authoritative ACTIVE NutritionGoal: " + fq(`select calories, protein, carbs, fat from nutrition_goals where user_id='${user.userId}' and status='ACTIVE'`));
  let prev;
  for (let i = 0; i < 40 && !prev; i += 1) { await sleep(4000); t = await turn("poll", user, "Thực đơn xong chưa?", s); s = t.sessionId; prev = t.block("NUTRITION_PLAN_PREVIEW"); }
  ok("NUTRITION_PLAN_PREVIEW shown", !!prev, t.blocks.map((b) => b.type).join(","));
  if (!prev) return {};
  const programsBefore = cnt(`select count(*) from nutrition_programs where user_id='${user.userId}'`);
  let r = await turn("revise", user, "Ít bữa hơn.", s); s = r.sessionId;
  let prev2; for (let i = 0; i < 40 && !(prev2 = r.block("NUTRITION_PLAN_PREVIEW")); i += 1) { await sleep(4000); r = await turn("poll", user, "Xong chưa?", s); s = r.sessionId; }
  ok("revised preview shown for the SAME action", !!prev2 && prev2.actionId === prev.actionId, `${prev.actionId} vs ${prev2?.actionId}`);
  ok("nothing persisted before save", cnt(`select count(*) from nutrition_programs where user_id='${user.userId}'`) === programsBefore);
  r = await turn("save-text", user, "Lưu.", s); s = r.sessionId;
  ok("a bare text \"Lưu.\" writes nothing and does not claim success", /chưa lưu gì/i.test(r.answer) && !/thành công/i.test(r.answer) && cnt(`select count(*) from nutrition_programs where user_id='${user.userId}'`) === programsBefore, r.answer.slice(0, 90));
  const c1 = await confirmViaApi(user, prev2.actionId);
  ok("confirmation card (button) succeeded", c1.status === 200, c1.status);
  ok("real NutritionProgram persisted", cnt(`select count(*) from nutrition_programs where user_id='${user.userId}'`) === programsBefore + 1, JSON.stringify(c1.json).slice(0, 120));
  const c2 = await confirmViaApi(user, prev2.actionId);
  ok("confirming again creates no duplicate NutritionProgram (stored result)", cnt(`select count(*) from nutrition_programs where user_id='${user.userId}'`) === programsBefore + 1, c2.status);
  return { user, sessionId: s };
}

export async function unsupportedNutrition() {
  setJourney("nutrition-unsupported-constraint");
  const user = U.D;
  const plansBefore = Number(aiq(`select count(*) from nutrition_plans where user_id='${user.userId}'`));
  const actionsBefore = Number(aiq(`select count(*) from fitness_agent_actions where user_id='${user.userId}'`));
  const t = await turn("unsupported", user, "Tạo thực đơn 4 bữa, tôi không ăn cá và không ăn cay.");
  ok("explicit refusal, no false guarantee", /chưa thể ĐẢM BẢO|không thể đảm bảo/i.test(t.answer), t.answer.slice(0, 120));
  ok("no NutritionPlan and no action created", Number(aiq(`select count(*) from nutrition_plans where user_id='${user.userId}'`)) === plansBefore && Number(aiq(`select count(*) from fitness_agent_actions where user_id='${user.userId}'`)) === actionsBefore);
}

const JOURNEYS = { roadmapMissingData, roadmapCreateSave, workoutJourney, programJourney, ptJourney, nutritionJourney, unsupportedNutrition };
if (process.argv[1].endsWith("journeys.mjs")) {
  const which = process.argv.slice(2);
  for (const name of which) {
    const fn = JOURNEYS[name];
    if (!fn) { console.log("unknown journey", name); continue; }
    try { await fn(); } catch (e) { ok(`journey ${name} threw`, false, e?.message); }
  }
  finish(which);
}
