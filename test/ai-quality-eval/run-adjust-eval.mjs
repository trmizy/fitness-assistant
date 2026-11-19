// REAL HTTP/API eval of "Điều chỉnh" (plan adjustment) on the isolated stack: base plan per persona -> 50 adjustment requests ->
// machine checks on the adjusted plan + Opus judge (BEFORE vs AFTER). Usage (repo root, stack up, GATEWAY_URL=http://localhost:13000):
//   node node_modules/tsx/dist/cli.mjs test/ai-quality-eval/run-adjust-eval.mjs --label adj-run1 [--only W01,N04] [--no-judge] [--concurrency 3]
import fs from "node:fs";
import path from "node:path";
import { registerUser, putProfile, http, sleep } from "../ai-chat-full-verification/lib.mjs";
import { judgeAnswer } from "./judge.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const arg = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
const LABEL = arg("--label", `adj-${Date.now()}`);
const ONLY = arg("--only", "") ? new Set(arg("--only").split(",")) : null;
const JUDGE = !args.includes("--no-judge");
const CONC = Number(arg("--concurrency", "3"));
const spec = JSON.parse(fs.readFileSync(path.join(root, "test/ai-quality-eval/adjust-cases.json"), "utf8"));
const personasSpec = JSON.parse(fs.readFileSync(path.join(root, "test/ai-quality-eval/coach-cases-b1.json"), "utf8")).personas;
const cases = spec.cases.filter((c) => !ONLY || ONLY.has(c.id));
const d = (r) => r?.json?.data ?? r?.json;
const stamp = Date.now();

async function waitJob(token, jobId) {
  let last = null;
  for (let i = 0; i < 90; i++) {
    last = d(await http("GET", `/plans/job/${jobId}`, { token }));
    const st = String(last?.status ?? last?.state ?? "");
    if (/COMPLETED|FAILED/i.test(st)) return { status: st.toUpperCase(), error: last?.error ?? last?.failureReason ?? last?.errorMessage ?? null };
    await sleep(4000);
  }
  return { status: "TIMEOUT", error: "job did not finish in 6 min" };
}
const workoutContent = (row) => (row?.plan?.weeklySchedule ? row.plan : row?.plan?.plan ?? row);
async function fetchWorkout(token, planId) { return workoutContent(d(await http("GET", `/plans/${planId}`, { token }))); }
async function fetchNutrition(token, planId) {
  const list = d(await http("GET", "/plans/nutrition/current", { token }));
  const rows = Array.isArray(list) ? list : list?.plans ?? list?.items ?? [];
  const row = rows.find((x) => x.id === planId);
  return row ? { content: row.plan, row } : null;
}

// ── plan readers ────────────────────────────────────────────────────────────
const exNames = (p) => (p?.weeklySchedule ?? []).flatMap((day) => (day.exercises ?? []).map((e) => String(e.name ?? e.exerciseName ?? "")));
const repLow = (r) => { const m = String(r ?? "").match(/\d+/); return m ? Number(m[0]) : null; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const allSets = (p) => (p?.weeklySchedule ?? []).flatMap((day) => (day.exercises ?? []).map((e) => Number(e.sets)).filter(Number.isFinite));
const allRepLows = (p) => (p?.weeklySchedule ?? []).flatMap((day) => (day.exercises ?? []).map((e) => repLow(e.reps)).filter((x) => x != null));
const meals = (n, i = 0) => n?.weeklySchedule?.[i]?.meals ?? [];
const itemNames = (n) => (n?.weeklySchedule ?? []).flatMap((day) => (day.meals ?? []).flatMap((m) => [m.title ?? m.name ?? "", ...(m.items ?? []).map((it) => String(it.name ?? it.foodName ?? ""))]));
const mealKcal = (m) => Number(m.totalCalories ?? m.calories ?? (m.items ?? []).reduce((a, it) => a + (Number(it.calories) || 0), 0));
const mealCarbs = (m) => Number(m.carbs ?? (m.items ?? []).reduce((a, it) => a + (Number(it.carbs) || 0), 0));
const findMeal = (ms, re) => ms.find((m) => re.test(String(m.mealType ?? m.type ?? m.title ?? "")));
const dayKcal = (n, i) => meals(n, i).reduce((a, m) => a + mealKcal(m), 0);
const rx = (s) => new RegExp(s, "i");

function runChecks(c, out) {
  const res = [];
  const add = (name, pass, detail) => res.push({ name, pass: Boolean(pass), detail: String(detail ?? "").slice(0, 200) });
  if (c.checks.some((k) => k.t === "expect422" || k.t === "noFoodOr422") && out.httpStatus === 422) { add("honest_refusal_422", true, out.httpMessage); return res; }
  for (const k of c.checks) if (k.t === "expect422") add("expect422", out.httpStatus === 422, `HTTP ${out.httpStatus} ${out.httpMessage ?? ""}`);
  if (c.checks.some((k) => k.t === "expect422")) return res;
  add("job_completed", out.job?.status === "COMPLETED", `${out.httpStatus} ${out.job?.status ?? ""} ${out.job?.error ?? out.httpMessage ?? ""}`);
  if (out.job?.status !== "COMPLETED" || !out.after) return res;
  const A = out.after, B = out.before;
  if (c.kind === "workout") {
    const names = exNames(A);
    for (const k of c.checks) {
      if (k.t === "noExercise") { const bad = names.filter((n) => rx(k.re).test(n)); add(`noExercise`, bad.length === 0, bad.join(", ") || "none"); }
      if (k.t === "minExercise") { const hit = names.filter((n) => rx(k.re).test(n)); add(`minExercise>=${k.n}`, hit.length >= k.n, `${hit.length}: ${hit.join(", ")}`); }
      if (k.t === "eachDayHas") { const miss = (A.weeklySchedule ?? []).filter((day) => !(day.exercises ?? []).some((e) => rx(k.re).test(String(e.name)))).map((day) => day.day); add("eachDayHas", miss.length === 0, miss.length ? `missing on ${miss.join(", ")}` : "all days"); }
      if (k.t === "days") add(`days=${k.n}`, (A.weeklySchedule ?? []).length === k.n, `got ${(A.weeklySchedule ?? []).length}`);
      if (k.t === "perDayMax") { const counts = (A.weeklySchedule ?? []).map((day) => (day.exercises ?? []).length); add(`perDay<=${k.n}`, counts.every((x) => x <= k.n), counts.join("/")); }
      if (k.t === "perDayMin") { const counts = (A.weeklySchedule ?? []).map((day) => (day.exercises ?? []).length); add(`perDay>=${k.n}`, counts.every((x) => x >= k.n), counts.join("/")); }
      if (k.t === "cardioEachDay") { const crx = /đi bộ|di bo|walk|đạp|dap xe|bike|cycl|elliptical|treadmill|chạy|chay|row|cardio|bơi|boi|jog/i; const miss = (A.weeklySchedule ?? []).filter((day) => !(crx.test(String(day.cardio ?? "")) || (day.exercises ?? []).some((e) => crx.test(String(e.name))))).map((day) => day.day); add("cardioEachDay", miss.length === 0, miss.length ? `missing on ${miss.join(", ")}` : (A.weeklySchedule ?? []).map((day) => day.cardio).join(" | ")); }
      if (k.t === "setsDecrease") { const a = avg(allSets(A)), b = avg(allSets(B)); const ta = allSets(A).reduce((x, y) => x + y, 0), tb = allSets(B).reduce((x, y) => x + y, 0); add("setsDecrease", a != null && b != null && (a < b || ta < tb), `avg ${b?.toFixed(2)} -> ${a?.toFixed(2)}, total ${tb} -> ${ta}`); }
      if (k.t === "repsDecrease") { const a = avg(allRepLows(A)), b = avg(allRepLows(B)); add("repsDecrease", a != null && b != null && a < b, `avg low-rep ${b?.toFixed(1)} -> ${a?.toFixed(1)}`); }
      if (k.t === "day1FullBody") { const n1 = (A.weeklySchedule?.[0]?.exercises ?? []).map((e) => String(e.name)); const lower = n1.some((n) => /squat|lunge|leg|deadlift|hip|glute|calf|step|bridge|hamstring/i.test(n)); const upper = n1.some((n) => /press|row|pull|push|curl|fly|chest|back|shoulder|lat|dip|raise/i.test(n)); add("day1FullBody", lower && upper, n1.join(", ")); }
    }
    const changed = names.filter((n) => !exNames(B).includes(n)).length;
    add("info_changed_exercises", true, `${changed}/${names.length} differ from base`);
  } else {
    const names = itemNames(A);
    for (const k of c.checks) {
      if (k.t === "noFood" || k.t === "noFoodOr422") { const bad = [...new Set(names.filter((n) => rx(k.re).test(n)))]; add("noFood", bad.length === 0, bad.join(", ") || "none"); }
      if (k.t === "moreFood") { const a = names.filter((n) => rx(k.re).test(n)).length, b = itemNames(B).filter((n) => rx(k.re).test(n)).length; add("moreFood", a > b, `${b} -> ${a}`); }
      if (k.t === "meals") { const counts = (A.weeklySchedule ?? []).map((day) => (day.meals ?? []).length); add(`meals=${k.n}`, counts.length > 0 && counts.every((x) => x === k.n), counts.join("/")); }
      if (k.t === "breakfastLighter") { const bf = findMeal(meals(A), /break|sáng|sang/i), lu = findMeal(meals(A), /lunch|trưa|trua/i); add("breakfastLighter", bf && lu && mealKcal(bf) < mealKcal(lu) * 0.85, `bf ${bf && mealKcal(bf)} vs lunch ${lu && mealKcal(lu)} (base bf ${mealKcal(findMeal(meals(B), /break|sáng|sang/i) ?? {})})`); }
      if (k.t === "dinnerLighter") { const di = findMeal(meals(A), /dinner|tối|toi/i), lu = findMeal(meals(A), /lunch|trưa|trua/i); add("dinnerLighter", di && lu && mealKcal(di) < mealKcal(lu) && mealCarbs(di) < mealCarbs(lu), `dinner ${di && mealKcal(di)}kcal/${di && mealCarbs(di)}g carb vs lunch ${lu && mealKcal(lu)}kcal/${lu && mealCarbs(lu)}g`); }
    }
    // Always: the authoritative calorie target must not move and every day must stay within ±10 % of it.
    const tA = Number(A.dailyCaloriesTarget), tB = Number(B.dailyCaloriesTarget);
    add("target_unchanged", tA === tB, `${tB} -> ${tA}`);
    if (out.goalCalories) add("target_equals_NutritionGoal", Math.abs(tA - out.goalCalories) <= 1, `plan ${tA} vs goal ${out.goalCalories}`);
    const offDays = (A.weeklySchedule ?? []).map((_, i) => dayKcal(A, i)).filter((k) => !(Math.abs(k - tA) <= tA * 0.1));
    add("days_within_10pct", offDays.length === 0, offDays.length ? `off: ${offDays.map(Math.round).join(",")}` : "ok");
  }
  return res;
}

function summarise(kind, p) {
  if (!p) return "(không có)";
  if (kind === "workout") return (p.weeklySchedule ?? []).map((day, i) => `Buổi ${i + 1} (${day.goal ?? day.focus ?? ""}): ${(day.exercises ?? []).map((e) => `${e.name} ${e.sets ?? "?"}x${e.reps ?? "?"}`).join("; ")}${day.cardio ? ` | cardio: ${day.cardio}` : ""}`).join("\n");
  const day = p.weeklySchedule?.[0];
  return `Mục tiêu ${p.dailyCaloriesTarget} kcal, đạm ${p.proteinTargetGrams ?? "?"} g, ${p.mealsPerDay ?? meals(p).length} bữa/ngày.\nNgày 1:\n${(day?.meals ?? []).map((m) => `- ${m.mealType ?? m.title}: ${Math.round(mealKcal(m))} kcal — ${(m.items ?? []).map((it) => it.name).join(", ")}`).join("\n")}\nCác món trong tuần: ${[...new Set(itemNames(p))].filter(Boolean).slice(0, 40).join(", ")}`;
}

// ── personas + base plans ───────────────────────────────────────────────────
const P = {};
for (const key of [...new Set(cases.map((c) => c.persona))]) {
  const spec0 = personasSpec[key];
  const u = await registerUser(`aiq.adj.${LABEL}.${key.toLowerCase()}.${stamp}@gymini-test.local`.toLowerCase().replace(/[^a-z0-9.@-]/g, ""), `AIQ Adj ${key}`);
  await putProfile(u, spec0.profile);
  const goal = d(await http("GET", "/nutrition/goals", { token: u.token }));
  P[key] = { ...spec0, user: u, goal: goal?.calories ? goal : null };
  const needW = cases.some((c) => c.persona === key && c.kind === "workout"), needN = cases.some((c) => c.persona === key && c.kind === "nutrition");
  if (needW) {
    const g = await http("POST", "/plans/workout/generate", { token: u.token, body: { goal: spec0.profile.goal, durationWeeks: 4, daysPerWeek: 3, exercisesPerDay: 5, trainingLocation: "GYM" } });
    const j = await waitJob(u.token, d(g)?.jobId);
    P[key].workoutId = d(g)?.planId; P[key].workout = await fetchWorkout(u.token, d(g)?.planId);
    console.log(`persona ${key}: base workout ${j.status} — ${exNames(P[key].workout).length} exercises`);
  }
  if (needN) {
    const g = await http("POST", "/plans/nutrition/generate", { token: u.token, body: { goal: spec0.profile.goal, durationWeeks: 1, mealsPerDay: 3 } });
    const j = await waitJob(u.token, d(g)?.jobId);
    P[key].nutritionId = d(g)?.planId; P[key].nutrition = (await fetchNutrition(u.token, d(g)?.planId))?.content;
    console.log(`persona ${key}: base nutrition ${j.status} — plan target ${P[key].nutrition?.dailyCaloriesTarget} kcal vs NutritionGoal ${P[key].goal?.calories ?? "none"} kcal, ${itemNames(P[key].nutrition).length} items`);
  }
}

// ── run cases ───────────────────────────────────────────────────────────────
const results = [];
async function runCase(c) {
  const p = P[c.persona]; const t0 = Date.now();
  const out = { id: c.id, kind: c.kind, persona: c.persona, adjustments: c.adjustments, textOnly: Boolean(c.textOnly), goalCalories: p.goal?.calories ?? null };
  let r;
  if (c.kind === "workout") r = await http("POST", "/plans/adjust", { token: p.user.token, body: { planId: p.workoutId, adjustments: c.adjustments, ...(c.daysPerWeek ? { daysPerWeek: c.daysPerWeek } : {}), ...(c.exercisesPerDay ? { exercisesPerDay: c.exercisesPerDay } : {}) } });
  else r = await http("POST", `/plans/nutrition/${p.nutritionId}/adjust`, { token: p.user.token, body: { adjustments: c.adjustments, ...(c.mealsPerDay ? { mealsPerDay: c.mealsPerDay } : {}) } });
  out.httpStatus = r.status; out.httpMessage = r.json?.error?.message ?? null;
  if (r.status === 202) {
    out.job = await waitJob(p.user.token, d(r)?.jobId);
    if (out.job.status === "COMPLETED") out.after = c.kind === "workout" ? await fetchWorkout(p.user.token, d(r)?.planId) : (await fetchNutrition(p.user.token, d(r)?.planId))?.content;
  }
  out.before = c.kind === "workout" ? p.workout : p.nutrition;
  out.ms = Date.now() - t0;
  out.checks = runChecks(c, out);
  out.casePass = out.checks.filter((k) => !k.name.startsWith("info_")).every((k) => k.pass);
  if (JUDGE && (out.after || out.httpStatus === 422)) {
    const answer = out.after
      ? `KẾ HOẠCH TRƯỚC KHI ĐIỀU CHỈNH:\n${summarise(c.kind, out.before)}\n\nKẾ HOẠCH SAU KHI AI ĐIỀU CHỈNH:\n${summarise(c.kind, out.after)}`
      : `Hệ thống từ chối điều chỉnh (HTTP ${out.httpStatus}): ${out.httpMessage}`;
    try {
      const j = await judgeAnswer({ root, c: { message: `Yêu cầu điều chỉnh: "${c.adjustments}"`, category: c.kind === "workout" ? "WORKOUT_ADJUSTMENT" : "NUTRITION_ADJUSTMENT", reference: c.reference, judgeRole: spec.judgeRole }, persona: p, answer });
      out.judge = j.scores;
    } catch (e) { out.judgeError = String(e?.message ?? e).slice(0, 200); }
  }
  const failed = out.checks.filter((k) => !k.pass).map((k) => `${k.name}(${k.detail})`);
  const js = out.judge ? ` judge=${["correctness", "relevance", "personalization", "safety", "clarity"].map((x) => out.judge[x]).join("/")}` : "";
  const info = out.checks.find((k) => k.name === "info_changed_exercises");
  console.log(`${out.casePass ? "PASS" : "FAIL"} ${c.id} ${c.kind.padEnd(9)} ${String(out.httpStatus)} ${out.job?.status ?? "-"} ${Math.round(out.ms / 1000)}s${js}${info ? " " + info.detail : ""} | ${failed.join("; ")}`);
  results.push(out);
}
const queue = [...cases];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runCase(queue.shift()); }));

results.sort((a, b) => a.id.localeCompare(b.id));
const by = (k) => results.filter((r) => r.kind === k);
const pass = (xs) => xs.filter((r) => r.casePass).length;
const mean = (xs, f) => { const v = xs.map((r) => r.judge?.[f]).filter((x) => typeof x === "number"); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "-"; };
console.log(`\nSUMMARY ${LABEL}: total ${pass(results)}/${results.length} | workout ${pass(by("workout"))}/${by("workout").length} (judge rel ${mean(by("workout"), "relevance")} corr ${mean(by("workout"), "correctness")} safe ${mean(by("workout"), "safety")}) | nutrition ${pass(by("nutrition"))}/${by("nutrition").length} (judge rel ${mean(by("nutrition"), "relevance")} corr ${mean(by("nutrition"), "correctness")} safe ${mean(by("nutrition"), "safety")})`);
const file = path.join(root, "test/ai-quality-eval/results", `adjust-${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify({ label: LABEL, at: new Date().toISOString(), results: results.map(({ before, ...r }) => r) }, null, 2));
console.log("written", file);
