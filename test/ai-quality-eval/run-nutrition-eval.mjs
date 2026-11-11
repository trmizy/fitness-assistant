// Nutrition AI quality evaluation — REAL HTTP/API through the isolated verification stack (gateway :13000).
// Ground truth: each persona's ACTIVE NutritionGoal (PRESCRIBED, fetched from fitness-service) and the ai-service
// nutritionCalculator (ESTIMATED maintenance) — the system's own engines, never a re-implemented formula.
// Scoring: deterministic checks per case (+ generic hygiene checks) and an OPTIONAL LLM-as-judge (Nova Pro, same model
// family as the system under test => indicative only). A hard cost cap aborts the run.
// Usage (repo root, run through tsx so the TS engine can be imported):
//   GATEWAY_URL=http://localhost:13000 node node_modules/tsx/dist/cli.mjs test/ai-quality-eval/run-nutrition-eval.mjs --label nova-pro [--only ID,ID] [--no-judge] [--budget 5]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerUser, putProfile, say, http, sleep } from "../ai-chat-full-verification/lib.mjs";

const root = process.cwd();
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt("--label", "run"), ONLY = opt("--only", "")?.split(",").filter(Boolean), JUDGE = !args.includes("--no-judge"), BUDGET = Number(opt("--budget", "5"));
const PRICE = { system: "apac.amazon.nova-pro-v1:0", judge: JUDGE_MODEL, sut: priceOf("apac.amazon.nova-pro-v1:0"), judgePrice: priceOf(JUDGE_MODEL), note: "list prices USD/1K tokens; confirm in AWS Billing" };
const spec = JSON.parse(fs.readFileSync(path.join(root, process.env.AIQ_CASES || "test/ai-quality-eval/nutrition-cases.json"), "utf8"));
const { nutritionCalculator } = await import(pathToFileURL(path.join(root, "backend/services/ai-service/src/llm/nutrition_calculator.ts")).href);
const outDir = path.join(root, "test/ai-quality-eval/results"); fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const usage = { sutIn: 0, sutOut: 0, judgeIn: 0, judgeOut: 0 };
const cost = () => (usage.sutIn / 1000) * PRICE.sut.in + (usage.sutOut / 1000) * PRICE.sut.out + (usage.judgeIn / 1000) * PRICE.judgePrice.in + (usage.judgeOut / 1000) * PRICE.judgePrice.out;
const budgetGuard = () => { if (cost() > BUDGET) throw new Error(`BUDGET_EXCEEDED: estimated $${cost().toFixed(3)} > $${BUDGET}`); };

import { lower, near, textChecks } from "./checks.mjs";
import { judgeAnswer, JUDGE_MODEL, priceOf } from "./judge.mjs";

// ---------------------------------------------------------------- personas
const personas = {};
// Tokens (3h) are cached per label so re-runs do not exhaust the gateway's /auth limiter (20 / 15 min, must not be weakened).
// --fresh registers new personas (clean conversation memory) for a reportable run.
const cacheFile = path.join(root, ".tmp-stack", `aiq-personas-${LABEL}.json`);
const cache = !args.includes("--fresh") && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
for (const [key, p] of Object.entries(spec.personas)) {
  const u = cache[key] ?? await registerUser(`aiq.nut.${LABEL}.${key.toLowerCase()}.${stamp.slice(0, 19).toLowerCase().replace(/[^a-z0-9]/g, "")}@gymini-test.local`, `AIQ ${key}`);
  cache[key] = u; fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const pr = await putProfile(u, p.profile);
  const goal = (await http("GET", "/nutrition/goals", { token: u.token })).json;
  const calc = nutritionCalculator.calculate({ age: p.profile.age, gender: p.profile.gender, heightCm: p.profile.heightCm, currentWeightKg: p.profile.currentWeight, goal: p.profile.goal,
    activityLevel: p.profile.activityLevel, experienceLevel: p.profile.experienceLevel }, {});
  personas[key] = { ...p, user: u, profileStatus: pr.status, goal: goal?.calories ? goal : null, calc };
  console.log(`persona ${key}: profile ${pr.status}, goal ${goal?.calories ? `${goal.calories} kcal P${goal.protein} C${goal.carbs} F${goal.fat} (${goal.triggeredBy ?? goal.goalMode})` : "NONE"}, calc maintenance ${calc.maintenanceCalories}`);
}

// ---------------------------------------------------------------- judge (optional; shared prompt in judge.mjs)
async function judge(c, persona, answer) {
  if (!JUDGE) return null;
  budgetGuard();
  const j = await judgeAnswer({ root, c: { ...c, judgeRole: c.judgeRole ?? spec.judgeRole }, persona, answer });
  usage.judgeIn += j.inputTokens; usage.judgeOut += j.outputTokens;
  return j.scores;
}

// ---------------------------------------------------------------- plan generation helper
export function planSummary(plan) {
  const r1 = (x) => Math.round(Number(x) || 0);
  const head = `target ${plan.dailyCaloriesTarget} kcal, protein ${plan.proteinTargetGrams} g, ${plan.mealsPerDay} meals/day, excluded: ${(plan.excludedFoods ?? []).join(", ") || "none"}`;
  const days = (plan.nutritionDays ?? plan.weeklySchedule ?? []).map((d, i) => {
    const meals = d.meals ?? [], sum = (k) => r1(meals.reduce((a, m) => a + (Number(m[k]) || 0), 0));
    return `Day ${d.dayNumber ?? i + 1} (${r1(d.totalCalories ?? sum("calories"))} kcal, P${sum("protein")} C${sum("carbs")} F${sum("fat")}): ` +
      meals.map((m) => `${m.mealType}: ${(m.items ?? []).map((it) => `${it.name} ${r1(it.quantity)}${it.unit ?? "g"}`).join(" + ")}`).join(" | ");
  });
  return [head, ...days].join("\n");
}
const previewOf = (r) => (Array.isArray(r?.data?.structuredBlocks) ? r.data.structuredBlocks : []).find((b) => b?.type === "NUTRITION_PLAN_PREVIEW") ?? null;
// Answers the slot-filling questions a real user would answer (meals/day, extra restrictions), otherwise polls the queue.
async function planTurn(u, message, meals = 3) {
  let r = await say(u, message); const turns = [r]; let b = previewOf(r);
  for (let i = 0; !b && i < 20; i++) {
    const a = lower(r.answer);
    const reply = /mấy bữa|bao nhiêu bữa|số bữa/.test(a) ? `${meals} bữa` : /dị ứng|kiêng|không ăn được/.test(a) && /\?/.test(a) ? "Không có thêm." : null;
    if (!reply) await sleep(5000);
    r = await say(u, reply ?? "Thực đơn xong chưa?", r.sessionId); turns.push(r); b = previewOf(r);
  }
  return { r, b, turns };
}
const itemKcal = (i) => Number(i.calories ?? i.kcal ?? i.energyKcal ?? NaN);
const dayKcal = (d) => { const direct = Number(d.totalCalories ?? d.calories ?? d.kcal ?? NaN); if (Number.isFinite(direct)) return direct;
  const s = (d.meals ?? []).flatMap((m) => m.items ?? []).map(itemKcal); return s.length && s.every(Number.isFinite) ? s.reduce((a, b) => a + b, 0) : NaN; };

// ---------------------------------------------------------------- run
const results = [];
for (const c of spec.cases.filter((x) => !ONLY?.length || ONLY.includes(x.id))) {
  budgetGuard();
  const P = personas[c.persona], u = P.user, checks = [], add = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  const goalBefore = (await http("GET", "/nutrition/goals", { token: u.token })).json;
  let r, plan = null, turns = [];
  if (c.category === "PLAN_GENERATION") { const pt = await planTurn(u, c.message, c.plan?.meals ?? 3); r = pt.r; plan = pt.b; turns = pt.turns; }
  else if (Array.isArray(c.previousTurns) && c.previousTurns.length) {
    // multi-turn: earlier turns in the same session, checks apply to the LAST answer (c.message)
    let sid; for (const m of c.previousTurns) { const pr = await say(u, m, sid); sid = pr.sessionId; turns.push(pr); }
    r = await say(u, c.message, sid); turns.push(r);
  } else { r = await say(u, c.message); turns = [r]; }
  for (const t of turns) { usage.sutIn += t.data?.promptTokens ?? 0; usage.sutOut += t.data?.completionTokens ?? 0; }
  const ans = String(r?.answer ?? ""), ex = c.expect ?? {}, g = P.goal;
  checks.push(...textChecks(c, P, ans, r?.status));
  if (ex.goalUnchanged) { const after = (await http("GET", "/nutrition/goals", { token: u.token })).json; add("goal_not_overwritten", after?.id === goalBefore?.id && after?.calories === goalBefore?.calories, `${goalBefore?.calories} -> ${after?.calories}`); }
  if (c.plan) {
    add("plan_preview_produced", !!plan, plan ? "" : `no NUTRITION_PLAN_PREVIEW after ${turns.length} turns`);
    if (plan) {
      add("plan_target_equals_goal", g && plan.dailyCaloriesTarget === g.calories && plan.proteinTargetGrams === g.protein, `plan ${plan.dailyCaloriesTarget}/${plan.proteinTargetGrams} goal ${g?.calories}/${g?.protein}`);
      const days = plan.nutritionDays ?? [], totals = days.map(dayKcal);
      add("plan_has_7_days", days.length >= 7, days.length);
      add(`plan_daily_kcal_within_${c.plan.kcalTolerancePct}pct`, totals.length && totals.every((x) => Number.isFinite(x) && near(x, plan.dailyCaloriesTarget, c.plan.kcalTolerancePct / 100)), totals.join(","));
      const names = days.flatMap((d) => (d.meals ?? []).flatMap((m) => (m.items ?? []).map((i) => String(i.name ?? ""))));
      const bad = names.filter((n) => new RegExp(c.plan.excludeRegex, "i").test(n));
      add("plan_respects_exclusions", bad.length === 0, [...new Set(bad)].slice(0, 6).join(", "));
      if (c.plan.meals) add(`plan_${c.plan.meals}_meals`, (plan.mealsPerDay ?? days[0]?.meals?.length) === c.plan.meals, plan.mealsPerDay ?? days[0]?.meals?.length);
    }
  }
  // The judge sees ALL 7 days as a compact summary — the earlier `JSON.stringify(plan).slice(0, 3000)` cut the plan mid-day,
  // and the judge then (rightly) scored a "truncated, unusable plan" and summed macros from partial data (2026-11-08).
  const j = await judge(c, P, plan ? `${ans}\n\n[PLAN PREVIEW — all days]\n${planSummary(plan)}` : ans);
  const passed = checks.filter((x) => x.pass).length;
  const row = { id: c.id, category: c.category, persona: c.persona, message: c.message, status: r?.status, ms: turns.reduce((a, x) => a + (x.ms ?? 0), 0), turns: turns.length,
    model: r?.data?.modelUsed ?? null, usedFallback: !!r?.data?.usedFallback, fallbackReason: r?.data?.fallbackReason ?? null, validationNotes: r?.data?.validationNotes ?? null,
    promptTokens: turns.reduce((a, x) => a + (x.data?.promptTokens ?? 0), 0), completionTokens: turns.reduce((a, x) => a + (x.data?.completionTokens ?? 0), 0),
    checks, passed, total: checks.length, casePass: passed === checks.length, judge: j, answer: ans, plan: plan ? { summaryText: planSummary(plan), dailyCaloriesTarget: plan.dailyCaloriesTarget, proteinTargetGrams: plan.proteinTargetGrams, mealsPerDay: plan.mealsPerDay, excludedFoods: plan.excludedFoods, days: (plan.nutritionDays ?? []).length, sample: JSON.stringify(plan.nutritionDays?.[0] ?? null).slice(0, 1500) } : null };
  results.push(row);
  console.log(`${row.casePass ? "PASS" : "FAIL"} ${c.id.padEnd(6)} ${c.category.padEnd(16)} ${passed}/${checks.length} fallback=${row.usedFallback ? row.fallbackReason : "no"} ${row.ms}ms judge=${j ? ["correctness", "relevance", "personalization", "safety", "clarity"].map((k) => j[k] ?? "?").join("/") : "-"} | ${checks.filter((x) => !x.pass).map((x) => x.name).join(", ")}`);
  fs.writeFileSync(path.join(outDir, `nutrition-${LABEL}-${stamp}.json`), JSON.stringify({ label: LABEL, at: stamp, price: PRICE, usage, estCostUsd: cost(), personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, { label: v.label, profileStatus: v.profileStatus, goal: v.goal, calc: v.calc }])), results }, null, 2));
}

// ---------------------------------------------------------------- summary
const cats = [...new Set(results.map((r) => r.category))];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const jk = ["correctness", "relevance", "personalization", "safety", "clarity"];
const summary = { label: LABEL, cases: results.length, casePassRate: mean(results.map((r) => +r.casePass)), checkPassRate: results.reduce((a, r) => a + r.passed, 0) / results.reduce((a, r) => a + r.total, 0),
  fallbackRate: mean(results.map((r) => +r.usedFallback)), medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)],
  judgeMean: Object.fromEntries(jk.map((k) => [k, mean(results.map((r) => r.judge?.[k]).filter(Number.isFinite))])), usage, estCostUsd: cost(),
  byCategory: Object.fromEntries(cats.map((cat) => { const rs = results.filter((r) => r.category === cat); return [cat, { n: rs.length, casePass: mean(rs.map((r) => +r.casePass)), checkPass: rs.reduce((a, r) => a + r.passed, 0) / rs.reduce((a, r) => a + r.total, 0), fallback: mean(rs.map((r) => +r.usedFallback)), judge: Object.fromEntries(jk.map((k) => [k, mean(rs.map((r) => r.judge?.[k]).filter(Number.isFinite))])) }]; })),
  failedChecks: Object.entries(results.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => c.name.replace(/:.*/, "")))
    .reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]) };
const file = path.join(outDir, `nutrition-${LABEL}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify({ label: LABEL, at: stamp, price: PRICE, summary, personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, { label: v.label, profileStatus: v.profileStatus, goal: v.goal, calc: v.calc }])), results }, null, 2));
console.log("\nSUMMARY " + JSON.stringify(summary, null, 2));
console.log("written", file);
