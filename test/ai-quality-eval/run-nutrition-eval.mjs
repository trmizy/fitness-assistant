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
import { registerUser, putProfile, say as sayRaw, http, sleep } from "../ai-chat-full-verification/lib.mjs";
import { parseLedger, summarize, BudgetGate, settleQuietMs, PRICES as LEDGER_PRICES } from "./cost-ledger.mjs";
import { settleVerdict } from "../ai-chat-full-verification/provider-gate.mjs";
import { queueBacklog } from "../ai-chat-full-verification/stack-process.mjs";

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
// Cost ledger (cost-ledger.mjs, V1 RC1): the API-reported estimate above misses background plan generation, retries and
// embeddings. The gate also reads the ai-service's own llm_call / embedding_call telemetry written since this run started
// (the isolated stack is exclusive to the run) and refuses to START a case whose projected cost would cross --budget, or once
// --max-calls model calls have happened. Not a billing cap: already-queued work can still finish (reported at the end).
const MAX_CALLS = Number(opt("--max-calls", "100"));
const LEDGER_LOG = path.join(root, ".tmp-stack", "ai.log");
const LEDGER_START = fs.existsSync(LEDGER_LOG) ? fs.statSync(LEDGER_LOG).size : 0;
const ledgerEntries = () => {
  if (!fs.existsSync(LEDGER_LOG)) return [];
  const len = Math.max(0, fs.statSync(LEDGER_LOG).size - LEDGER_START), buf = Buffer.alloc(len), fd = fs.openSync(LEDGER_LOG, "r");
  fs.readSync(fd, buf, 0, len, LEDGER_START); fs.closeSync(fd);
  return parseLedger(buf.toString("utf8"));
};
const ledgerNow = () => summarize(ledgerEntries(), LEDGER_PRICES);
const gate = new BudgetGate({ maxUsd: BUDGET, maxCalls: MAX_CALLS }); // provider calls = LLM + embedding
// Provider gate (stack.mjs LOCAL_BEDROCK=1, RC1 incident follow-up) — the AUTHORITATIVE cap: it reserves every HTTP attempt
// before the network and refuses past its caps. The log ledger above stays as a cross-check only. A run against a paid stack
// without a gate is refused unless --allow-ungated (e.g. a free local Ollama stack).
const GATE_URL = process.env.EVAL_GATE_URL || "http://127.0.0.1:13090";
const gateStatus = async () => { try { const r = await fetch(`${GATE_URL}/__gate/status`, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } };
// The optional LLM judge (judge.mjs) is called by THIS process with its own credentials — it does not pass the provider
// gate, so it is uncapped before the network. It must be asked for explicitly.
if (JUDGE && !args.includes("--allow-ungated-judge")) throw new Error("UNGATED_JUDGE: the LLM judge bypasses the provider gate (paid, uncapped). Use --no-judge, or --allow-ungated-judge with explicit owner approval.");
const gate0 = await gateStatus();
if (!gate0 && !args.includes("--allow-ungated")) throw new Error(`NO_PROVIDER_GATE at ${GATE_URL}: paid calls would not be capped before the network. Start the stack with LOCAL_BEDROCK=1 + EVAL_MAX_PROVIDER_CALLS/EVAL_MAX_USD, or pass --allow-ungated for a free local model.`);
if (gate0 && (gate0.maxCalls > MAX_CALLS || gate0.maxUsd > BUDGET)) throw new Error(`GATE_CAP_MISMATCH: gate allows ${gate0.maxCalls} calls / ${gate0.maxUsd}, run authorised ${MAX_CALLS} / ${BUDGET}`);
if (gate0) console.log(`provider gate: ${gate0.attempts} attempt(s) already used before the first case (stack start-up), ${gate0.remainingCalls} left`);
async function gateGuard() {
  if (!gate0) return;
  const g = await gateStatus();
  if (!g) throw new Error("GATE_UNREACHABLE: refusing to start another case");
  const perCase = casesDone > 0 ? g.attempts / casesDone : 8;
  if (g.closed || g.remainingCalls < perCase) throw new Error(`BUDGET_EXCEEDED (gate): ${g.remainingCalls} provider call(s) left < ~${perCase.toFixed(1)} per case${g.closed ? " (gate closed)" : ""}`);
}
/** Close the gate (nothing new can start), wait for in-flight calls, read the run's queue → SETTLED / SETTLED_WITH_UNKNOWN / UNSETTLED. */
async function settleGate() {
  if (!gate0) return null;
  await fetch(`${GATE_URL}/__gate/close`, { method: "POST" }).catch(() => {});
  const t0 = Date.now(); let g = await gateStatus();
  while (g && g.inFlight > 0 && Date.now() - t0 < 300_000) { await sleep(2000); g = await gateStatus(); }
  const queuePending = await queueBacklog(Number(process.env.VERIFICATION_REDIS_PORT ?? 56379));
  return { ...(g ?? { unreachable: true }), queuePending, ...settleVerdict({ gate: g, queuePending }) };
}
let casesDone = 0, currentCase = "setup", turnNo = 0;
// Every turn carries its own clientRequestId, so llm_call / embedding_call lines are attributable per case (background = none).
const say = (u, question, sessionId) => sayRaw(u, question, sessionId, { clientRequestId: `aiq-${stamp.replace(/\D/g, "").slice(-12)}-${currentCase}-t${++turnNo}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 64) });
const budgetGuard = () => {
  if (cost() > BUDGET) throw new Error(`BUDGET_EXCEEDED: estimated $${cost().toFixed(3)} > $${BUDGET}`);
  const led = ledgerNow(), r = gate.canStart(led, gate.projectNextCase(led, casesDone));
  if (!r.ok) throw new Error(`BUDGET_EXCEEDED (ledger): ${r.reason}`);
};
/**
 * After the last case, wait until background model work stops — no new call for settleQuietMs (≥ 60 s and ≥ 2× the slowest
 * call seen; rc-verify-v2 settled on a fixed 15 s while a 17.7 s call was still running), max 300 s — and return the final
 * ledger. `unsettled: true` = calls were still arriving when the wait ended: the ledger is then a LOWER BOUND.
 */
async function settleLedger() {
  let last = ledgerNow(), quietSince = Date.now(), quietMs = settleQuietMs(ledgerEntries());
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000 && Date.now() - quietSince < quietMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const now = ledgerNow();
    if (now.calls.provider !== last.calls.provider) { last = now; quietSince = Date.now(); quietMs = settleQuietMs(ledgerEntries()); }
  }
  const unsettled = Date.now() - quietSince < quietMs;
  const { byRequest, ...rest } = ledgerNow();
  return { ...rest, requests: Object.keys(byRequest).length, unsettled, settleQuietMs: quietMs, note: gate.guarantee };
}

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

// ---------------------------------------------------------------- answer provenance
// The HTTP payload has no route; the ai-service trace log ("LLM orchestration finished" / early returns) carries responseSource
// per traceId: "llm" = model-written, anything else = deterministic template/lookup/safety gate (canned answer).
const AI_LOG = path.join(root, ".tmp-stack", "ai.log");
async function responseSourceOf(traceId) {
  if (!traceId || !fs.existsSync(AI_LOG)) return null;
  for (let i = 0; i < 6; i++) {
    const st = fs.statSync(AI_LOG), len = Math.min(st.size, 4_000_000), fd = fs.openSync(AI_LOG, "r"), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    const line = buf.toString("utf8").split("\n").reverse().find((l) => l.includes(`"traceId":"${traceId}"`) && l.includes("responseSource"));
    if (line) { try { return JSON.parse(line).responseSource ?? null; } catch { return null; } }
    await sleep(400);
  }
  return null;
}
// near-duplicate answers to DIFFERENT questions = template reuse (5-word shingles, Jaccard)
function shingles(t) { const w = lower(t).replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean); const s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(" ")); return s; }
function templateReuse(rows) {
  const sh = rows.map((r) => shingles(r.answer)), pairs = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { const a = sh[i], b = sh[j]; if (!a.size || !b.size) continue; let inter = 0; for (const x of a) if (b.has(x)) inter++; const jac = inter / (a.size + b.size - inter); if (jac >= 0.35) pairs.push({ a: rows[i].id, b: rows[j].id, jaccard: +jac.toFixed(2) }); }
  const sentCount = new Map();
  rows.forEach((r) => new Set(String(r.answer).split(/(?<=[.!?\n])\s+/).map((x) => lower(x).replace(/\d+/g, "#").trim()).filter((x) => x.length > 50)).forEach((x) => sentCount.set(x, (sentCount.get(x) ?? 0) + 1)));
  const boilerplate = [...sentCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([sentence, cases]) => ({ cases, sentence: sentence.slice(0, 160) }));
  return { nearDuplicatePairs: pairs.sort((x, y) => y.jaccard - x.jaccard), boilerplateSentences: boilerplate };
}

// ---------------------------------------------------------------- run
// Memory isolation between cases (eval 2026-11-11: personas are reused across ~8 cases per batch, so a memory saved in one
// case — "Em vừa sinh con được 6 tuần…" — leaked into a later one). Before every case the persona's saved memories are
// removed through the public API, ONLY for harness-created @gymini-test.local accounts. Multi-turn cases share state inside
// the case on purpose (one session). --shared-memory restores the old behaviour.
const ISOLATE_MEMORY = !args.includes("--shared-memory");
async function resetPersonaMemory(u, email) {
  if (!ISOLATE_MEMORY || !/@gymini-test\.local$/i.test(String(email ?? ""))) return 0;
  const list = (await http("GET", "/ai/memories", { token: u.token })).json;
  const rows = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : Array.isArray(list?.memories) ? list.memories : [];
  let n = 0;
  for (const m of rows) if (m?.id && (await http("DELETE", `/ai/memories/${m.id}`, { token: u.token })).status < 300) n++;
  return n;
}

const results = [];
for (const c of spec.cases.filter((x) => !ONLY?.length || ONLY.includes(x.id))) {
  budgetGuard();
  await gateGuard();
  currentCase = c.id; turnNo = 0;
  const P = personas[c.persona], u = P.user, checks = [], add = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  const memoriesCleared = await resetPersonaMemory(u, u.email);
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
  const traceId = r?.data?.traceId ?? null, responseSource = await responseSourceOf(traceId);
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
  const row = { id: c.id, category: c.category, persona: c.persona, message: c.message, previousTurns: c.previousTurns ?? [], memoriesCleared, status: r?.status, ms: turns.reduce((a, x) => a + (x.ms ?? 0), 0), turns: turns.length,
    traceId, responseSource, deterministic: responseSource ? responseSource !== "llm" : (r?.data?.promptTokens ?? 0) === 0,
    model: r?.data?.modelUsed ?? null, usedFallback: !!r?.data?.usedFallback, fallbackReason: r?.data?.fallbackReason ?? null, validationNotes: r?.data?.validationNotes ?? null,
    promptTokens: turns.reduce((a, x) => a + (x.data?.promptTokens ?? 0), 0), completionTokens: turns.reduce((a, x) => a + (x.data?.completionTokens ?? 0), 0),
    checks, passed, total: checks.length, casePass: passed === checks.length, judge: j, answer: ans, plan: plan ? { summaryText: planSummary(plan), dailyCaloriesTarget: plan.dailyCaloriesTarget, proteinTargetGrams: plan.proteinTargetGrams, mealsPerDay: plan.mealsPerDay, excludedFoods: plan.excludedFoods, days: (plan.nutritionDays ?? []).length, sample: JSON.stringify(plan.nutritionDays?.[0] ?? null).slice(0, 1500) } : null };
  results.push(row);
  casesDone += 1;
  console.log(`${row.casePass ? "PASS" : "FAIL"} ${c.id.padEnd(6)} ${c.category.padEnd(16)} ${passed}/${checks.length} fallback=${row.usedFallback ? row.fallbackReason : "no"} ${row.ms}ms src=${row.responseSource ?? "?"} judge=${j ? ["correctness", "relevance", "personalization", "safety", "clarity", "analysis"].map((k) => j[k] ?? "-").join("/") + (j.canned ? " CANNED" : "") : "-"} | ${checks.filter((x) => !x.pass).map((x) => x.name).join(", ")}`);
  fs.writeFileSync(path.join(outDir, `nutrition-${LABEL}-${stamp}.json`), JSON.stringify({ label: LABEL, at: stamp, price: PRICE, usage, estCostUsd: cost(), personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, { label: v.label, profileStatus: v.profileStatus, goal: v.goal, calc: v.calc }])), results }, null, 2));
}

// ---------------------------------------------------------------- summary
// Real model usage of the WHOLE run from the ai-service telemetry, incl. background work that finished after the last case.
const gateFinal = await settleGate();
if (gateFinal) console.log(`provider gate: ${gateFinal.verdict} — ${gateFinal.attempts} attempts sent (${gateFinal.byKind?.llm} LLM / ${gateFinal.byKind?.embedding} embedding), ${gateFinal.refused} refused before the network, ${gateFinal.unknown} unknown, est. ${(gateFinal.usd?.actual ?? 0).toFixed(4)} (+≤${(gateFinal.usd?.unknownUpperBound ?? 0).toFixed(4)} unknown)${gateFinal.reasons?.length ? " — " + gateFinal.reasons.join("; ") : ""}`);
const ledger = { ...(await settleLedger()), gate: gateFinal };
console.log(`ledger${ledger.unsettled ? " (UNSETTLED — lower bound)" : ""}: ${ledger.calls.provider} provider calls = ${ledger.calls.llm} llm calls (${ledger.calls.background} background), ${ledger.calls.embedding} embedding calls, $${ledger.usd.total.toFixed(4)} (llm from usage $${ledger.usd.llmFromUsage.toFixed(4)} + embeddings estimated $${ledger.usd.embeddingEstimated.toFixed(4)})`);
const cats = [...new Set(results.map((r) => r.category))];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const jk = ["correctness", "relevance", "personalization", "safety", "clarity", "analysis"];
const summary = { label: LABEL, cases: results.length, casePassRate: mean(results.map((r) => +r.casePass)), checkPassRate: results.reduce((a, r) => a + r.passed, 0) / results.reduce((a, r) => a + r.total, 0),
  fallbackRate: mean(results.map((r) => +r.usedFallback)), deterministicRate: mean(results.map((r) => +r.deterministic)),
  responseSources: results.reduce((m, r) => ((m[r.responseSource ?? "unknown"] = (m[r.responseSource ?? "unknown"] ?? 0) + 1), m), {}),
  judgeCannedRate: mean(results.filter((r) => typeof r.judge?.canned === "boolean").map((r) => +r.judge.canned)), templateReuse: templateReuse(results), medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)],
  judgeMean: Object.fromEntries(jk.map((k) => [k, mean(results.map((r) => r.judge?.[k]).filter(Number.isFinite))])), usage, estCostUsd: cost(), ledger,
  byCategory: Object.fromEntries(cats.map((cat) => { const rs = results.filter((r) => r.category === cat); return [cat, { n: rs.length, casePass: mean(rs.map((r) => +r.casePass)), checkPass: rs.reduce((a, r) => a + r.passed, 0) / rs.reduce((a, r) => a + r.total, 0), fallback: mean(rs.map((r) => +r.usedFallback)), judge: Object.fromEntries(jk.map((k) => [k, mean(rs.map((r) => r.judge?.[k]).filter(Number.isFinite))])) }]; })),
  failedChecks: Object.entries(results.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => c.name.replace(/:.*/, "")))
    .reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]) };
const file = path.join(outDir, `nutrition-${LABEL}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify({ label: LABEL, at: stamp, price: PRICE, summary, personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, { label: v.label, profileStatus: v.profileStatus, goal: v.goal, calc: v.calc }])), results }, null, 2));
console.log("\nSUMMARY " + JSON.stringify(summary, null, 2));
console.log("written", file);
