// Level C: Q&A corpora (general / exercise / nutrition / personalized), adversarial + security, cross-user. REAL gateway + configured model.
// Usage: node test/ai-chat-full-verification/qa.mjs <suite...>   suites: general personalized adversarial crossuser
import fs from "node:fs";
import { U, ok, info, setJourney, turn, fq, uq, aiq, fqOne, actionRow, confirmViaApi, dismissViaApi, fillSlots, finish } from "./harness.mjs";
import { http } from "./lib.mjs";

const load = (f) => JSON.parse(fs.readFileSync(`test/ai-chat-full-verification/corpus/${f}`, "utf8"));
const cnt = (db, sql) => Number({ ai: aiq, fitness: fq, user: uq }[db](sql));
const snapshot = (u) => ({
  workoutPrograms: cnt("fitness", `select count(*) from workout_programs where user_id='${u.userId}'`),
  nutritionPrograms: cnt("fitness", `select count(*) from nutrition_programs where user_id='${u.userId}'`),
  nutritionGoals: cnt("fitness", `select count(*) from nutrition_goals where user_id='${u.userId}'`),
  roadmaps: cnt("fitness", `select count(*) from fitness_roadmaps where user_id='${u.userId}'`),
  contracts: cnt("user", `select count(*) from contracts where client_user_id='${u.userId}'`),
  profile: uq(`select age, gender, "heightCm", "currentWeight", "targetWeight", goal from user_profiles where "userId"='${u.userId}'`),
  memories: cnt("ai", `select count(*) from user_memories where user_id='${u.userId}'`),
  completedActions: cnt("ai", `select count(*) from fitness_agent_actions where user_id='${u.userId}' and status='COMPLETED'`),
});
const sameWrites = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blockTypes = (t) => t.blocks.map((b) => b.type);
const stats = { turns: [], byCategory: {} };
const rec = (cat, t) => { (stats.byCategory[cat] ??= []).push(t.ms); stats.turns.push({ cat, ms: t.ms, status: t.status }); };

export async function general() {
  setJourney("general-qa");
  const user = U.D;
  const before = snapshot(user);
  const corpus = load("qa.json");
  let failed = 0;
  for (const c of corpus) {
    const t = await turn(c.id, user, c.message);
    rec(c.category, t);
    const good = t.status === 200 && t.answer.length > 40 && blockTypes(t).length === 0 && new RegExp(c.mustMatch, "i").test(t.answer);
    if (!good) failed += 1;
    ok(`${c.id} [${c.category}] answered, no workflow/card, on-topic`, good, `${t.status} blocks=${blockTypes(t)} ${t.answer.slice(0, 90).replace(/\n/g, " ")}`);
  }
  const after = snapshot(user);
  ok(`no business write happened during ${corpus.length} pure Q&A turns (workout/nutrition/contract/roadmap/profile/memory unchanged)`, sameWrites(before, after), JSON.stringify({ before, after }).slice(0, 300));
  info(`general Q&A failures: ${failed}/${corpus.length}`);
}

export async function personalized() {
  setJourney("personalized-qa");
  const user = U.A;
  const f = {
    goal: uq(`select goal from user_profiles where "userId"='${user.userId}'`), height: uq(`select "heightCm" from user_profiles where "userId"='${user.userId}'`),
    weight: uq(`select "currentWeight" from user_profiles where "userId"='${user.userId}'`), target: uq(`select "targetWeight" from user_profiles where "userId"='${user.userId}'`),
    ng: fq(`select calories||'|'||protein||'|'||carbs||'|'||fat from nutrition_goals where user_id='${user.userId}' and status='ACTIVE'`).split("|"),
    programs: cnt("fitness", `select count(*) from workout_programs where user_id='${user.userId}'`),
    contracts: cnt("user", `select count(*) from contracts where client_user_id='${user.userId}'`),
  };
  info("DB facts for user A: " + JSON.stringify(f));
  const num = (n) => String(Math.round(Number(n)));
  const qs = [
    ["P01", "Mục tiêu hiện tại của tôi là gì?", /giảm/i],
    ["P02", "Tôi đang giảm cân hay tăng cơ?", /giảm/i],
    ["P03", "Tôi cao bao nhiêu?", new RegExp(num(f.height))],
    ["P04", "Cân nặng hiện tại của tôi là bao nhiêu?", new RegExp("113")],
    ["P05", "Cân nặng mục tiêu của tôi là bao nhiêu kg?", new RegExp(num(f.target))],
    ["P06", "Một ngày tôi cần bao nhiêu calo?", new RegExp(f.ng[0].replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?"))],
    ["P07", "Macro hiện tại của tôi là bao nhiêu?", new RegExp(`${f.ng[1]}|${f.ng[2]}|${f.ng[3]}`)],
    ["P08", "Mục tiêu protein mỗi ngày của tôi là bao nhiêu gram?", new RegExp(f.ng[1])],
    ["P09", "Tôi đang có PT chưa?", f.contracts > 0 ? /PT|hợp đồng|Phương/i : /chưa|không/i],
    ["P10", "Tôi đã có chương trình tập nào chưa?", f.programs > 0 ? /chương trình|lịch/i : /chưa|không/i],
    ["P11", "Lịch tập hiện tại của tôi thế nào?", /lịch|tập|chưa/i],
    ["P12", "Tôi bao nhiêu tuổi?", /22/],
    ["P13", "Giới tính trong hồ sơ của tôi là gì?", /nam|male/i],
    ["P14", "Mức độ vận động của tôi là gì?", /ít vận động|sedentary|ngồi nhiều|hầu như/i],
    ["P15", "Kinh nghiệm tập luyện của tôi ở mức nào?", /mới|beginner|người mới/i],
    ["P16", "Tôi có thiết bị tập nào ở nhà?", /dumbbell|tạ tay|thể trọng|bodyweight/i],
    ["P17", "Tôi cần giảm bao nhiêu kg nữa để đạt mục tiêu?", /33|34/],
    ["P18", "Tóm tắt hồ sơ của tôi giúp tôi.", /113|178|22/],
    ["P19", "Hôm nay tôi nên ăn tối đa bao nhiêu calo?", new RegExp(f.ng[0].replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?"))],
    ["P20", "Tôi đã có lộ trình nào đang hoạt động chưa?", /lộ trình|chưa/i],
  ];
  const before = snapshot(user);
  for (const [id, q, re] of qs) {
    const t = await turn(id, user, q);
    rec("personalized", t);
    ok(`${id} personalized answer matches the authoritative DB`, t.status === 200 && re.test(t.answer) && blockTypes(t).length === 0, `${t.status} ${t.answer.slice(0, 140).replace(/\n/g, " ")}`);
  }
  ok("personalized Q&A performed no writes", sameWrites(before, snapshot(user)));
}

export async function freshness() { // fact changed in the DB -> the next chat answer reflects it (no stale AI memory)
  setJourney("freshness-after-write");
  const user = U.D;
  const t0 = await turn("before", user, "Cân nặng hiện tại của tôi là bao nhiêu?");
  ok("initial answer shows the DB weight (78)", /78/.test(t0.answer), t0.answer.slice(0, 120));
  const { putProfile } = await import("./lib.mjs");
  const w = await putProfile(user, { currentWeight: 74 });
  ok("authoritative profile updated through user-service", w.status === 200, w.status);
  await new Promise((r) => setTimeout(r, 16000)); // profile snapshot TTL is 15 s (documented); the chat-write path invalidates it explicitly
  const t1 = await turn("after", user, "Cân nặng hiện tại của tôi là bao nhiêu?");
  ok("answer after the change reflects 74 kg, not the stale 78 kg", /74 ?kg/.test(t1.answer) && !/(hiện tại|đang ở)[^.\n]{0,25}78 ?kg/i.test(t1.answer), t1.answer.slice(0, 140));
  await putProfile(user, { currentWeight: 78 });
}

async function pendingWorkoutFor(user) {
  let t = await turn("setup-create", user, "Tạo lịch tập cho tôi."); let s = t.sessionId;
  ({ t, s } = await fillSlots(user, s, t, ["3 buổi mỗi tuần", "60 phút mỗi buổi"], "WORKOUT_PLAN_PREVIEW"));
  return { sessionId: s, actionId: t.block("WORKOUT_PLAN_PREVIEW")?.actionId };
}

export async function adversarial() {
  setJourney("adversarial");
  const user = U.B;
  const corpus = load("adversarial.json");
  const { sessionId, actionId } = await pendingWorkoutFor(user);
  ok("setup: a pending workout draft exists for the bypass attempts", !!actionId, actionId);
  const before = snapshot(user);
  for (const c of corpus) {
    const withPending = c.withPending && actionId;
    const t = await turn(c.id, user, c.message, withPending ? sessionId : undefined);
    rec(c.category, t);
    let good = t.status < 500;
    if (c.mustNotMatch) good = good && !new RegExp(c.mustNotMatch, "i").test(t.answer);
    if (c.mustMatch) good = good && new RegExp(c.mustMatch, "i").test(t.answer);
    if (c.forbidBlocks) good = good && blockTypes(t).length === 0;
    if (c.forbidWrite) good = good && sameWrites(before, snapshot(user));
    ok(`${c.id} [${c.category}] handled safely`, good, `${t.status} blocks=${blockTypes(t)} ${t.answer.slice(0, 120).replace(/\n/g, " ")}`);
  }
  ok("the pending draft is STILL pending after every bypass attempt (no write)", /PENDING/.test(actionRow(actionId)), actionRow(actionId));
  ok("no user data or secrets leaked in any adversarial answer (checked per-case above) and no write occurred", sameWrites(before, snapshot(user)));
}

export async function crossuser() {
  setJourney("cross-user-security");
  const a = U.A, b = U.B;
  const { sessionId, actionId } = await pendingWorkoutFor(a);
  ok("setup: user A has a pending action", !!actionId, actionId);
  const before = aiq(`select status from fitness_agent_actions where id='${actionId}'`);
  const c1 = await http("POST", `/ai/agent/actions/${actionId}/confirm`, { token: b.token, body: { confirmed: true } });
  ok("user B cannot CONFIRM user A's action", c1.status >= 400 && c1.status < 500, `${c1.status} ${JSON.stringify(c1.json).slice(0, 100)}`);
  const c2 = await http("POST", `/ai/agent/actions/${actionId}/dismiss`, { token: b.token, body: {} });
  ok("user B cannot DISMISS user A's action", c2.status >= 400 && c2.status < 500, `${c2.status} ${JSON.stringify(c2.json).slice(0, 100)}`);
  ok("user A's action untouched by B's attempts", aiq(`select status from fitness_agent_actions where id='${actionId}'`) === before, before);
  const m = await http("GET", `/ai/sessions/${sessionId}/messages`, { token: b.token });
  ok("user B cannot read user A's session messages", m.status >= 400 || !JSON.stringify(m.json).includes("Tạo lịch tập cho tôi"), `${m.status} ${JSON.stringify(m.json).slice(0, 100)}`);
  const t = await turn("b-uses-a-session", b, "Lưu đi", sessionId);
  ok("user B sending a message into A's session id does not touch A's draft or leak it", /PENDING/.test(actionRow(actionId)) && !/Tạo lịch tập/.test(t.answer), `${t.status} ${t.answer.slice(0, 100)}`);
  const rc = await http("POST", `/ai/agent/recommendations/${actionId}/choose`, { token: b.token, body: { candidateId: actionId } });
  ok("user B cannot choose against A's recommendation id", rc.status >= 400, rc.status);
  const noAuth = await http("POST", `/ai/agent/actions/${actionId}/confirm`, { body: { confirmed: true } });
  ok("unauthenticated confirm is rejected (401)", noAuth.status === 401, noAuth.status);
  const bad = await http("POST", `/ai/agent/actions/${actionId}/confirm`, { token: "not-a-jwt", body: { confirmed: true } });
  ok("invalid token is rejected (401)", bad.status === 401, bad.status);
  ok("A's draft is still pending", /PENDING/.test(actionRow(actionId)));
}

const SUITES = { general, personalized, freshness, adversarial, crossuser };
if (process.argv[1].endsWith("qa.mjs")) {
  const which = process.argv.slice(2);
  for (const name of which) {
    const fn = SUITES[name]; if (!fn) { console.log("unknown suite", name); continue; }
    try { await fn(); } catch (e) { ok(`suite ${name} threw`, false, e?.message); }
  }
  const byCat = Object.fromEntries(Object.entries(stats.byCategory).map(([k, v]) => { const s = [...v].sort((x, y) => x - y); return [k, { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] }]; }));
  console.log("LATENCY_MS_BY_CATEGORY " + JSON.stringify(byCat));
  finish(which);
}
