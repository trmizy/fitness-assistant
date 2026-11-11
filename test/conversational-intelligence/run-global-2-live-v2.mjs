// Config B (deterministic + qwen3:4b typed-LLM fallback) measured on the Phase-G blind corpus — REAL HTTP/API through the
// Docker ai-service (gymcoach-ai-dev, CONVERSATIONAL_INTELLIGENCE_V2=on, CONVERSATIONAL_INTELLIGENCE_V2_LLM=on).
//
// FIX over run-global-2-live.mjs: that script read `docker logs --since 20s` AFTER awaiting the HTTP response, so any
// turn whose request took >20s (slow RAG-fallback turns) had its ci_global_trace line fall outside the window by the
// time the check ran, and was wrongly recorded as "no trace". This version instead counts how many ci_global_trace
// lines exist in the container log BEFORE sending each turn, then (after the response) reads the FULL container log
// and takes the trace line at that same index (turns run strictly sequentially, one HTTP call at a time, so the trace
// lines appear in the exact same order as the turns regardless of how long any individual turn took). This is a count
// offset, not a time window, so it cannot miss a slow turn's trace line.
//
// Usage: node test/conversational-intelligence/run-global-2-live-v2.mjs [sample|full|stratified]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { registerUser, putProfile, say, sleep } from "../ai-chat-full-verification/lib.mjs";

const MODE = process.argv[2] ?? "stratified";
const all = JSON.parse(fs.readFileSync("test/conversational-intelligence/global-blind-2.json", "utf8"));
const NO_SETUP = all.filter((c) => !c.ctx.active && !c.ctx.proposal);
const NEEDS_SETUP = all.filter((c) => c.ctx.active || c.ctx.proposal);
function stratified(cases, perCat) {
  const byCat = new Map();
  for (const c of cases) { if (!byCat.has(c.cat)) byCat.set(c.cat, []); byCat.get(c.cat).push(c); }
  const out = [];
  for (const [, list] of byCat) {
    const n = Math.min(perCat, list.length);
    for (let i = 0; i < n; i += 1) out.push(list[Math.floor((i * list.length) / n)]);
  }
  return out;
}
const cases = MODE === "full" ? all : MODE === "stratified" ? stratified(all, 5) : [...NO_SETUP, ...NEEDS_SETUP.filter((_, i) => i % 3 === 0)];

const newUser = async () => {
  const u = await registerUser(`ci.g2v2.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@gymini-test.local`, "CI G2 v2");
  await putProfile(u, { hasCompletedOnboarding: true, goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
  return u;
};

async function setupActive(u, wf) {
  let r = await say(u, wf === "FIND_PT" ? "Tìm PT cho tôi." : wf === "CREATE_WORKOUT_PLAN" ? "Tạo lịch tập cho tôi." : wf === "CREATE_NUTRITION_PLAN" ? "Tạo thực đơn cho tôi." : wf === "FIND_TRAINING_PROGRAM" ? "Tìm chương trình tập cho tôi." : "Tạo lộ trình cho tôi.");
  const s = r.sessionId;
  const fillers = { FIND_PT: ["T2 T4 T6"], CREATE_WORKOUT_PLAN: [], CREATE_NUTRITION_PLAN: [], FIND_TRAINING_PROGRAM: ["T2 T4 T6"], CREATE_ROADMAP: ["25 tuổi", "cao 172cm", "nam"] }[wf] ?? [];
  for (const f of fillers) r = await say(u, f, s);
  return s;
}
async function setupProposal(u) {
  const r = await say(u, "với tình trạng hiện tại tôi nên cut hay bulk?");
  return r.sessionId;
}

function traceLines() {
  const log = execSync(`docker logs gymcoach-ai-dev 2>&1`, { encoding: "utf8", maxBuffer: 200_000_000 });
  return log.split("\n").filter((l) => l.includes("ci_global_trace"));
}

const results = [];
let missedCount = 0;
for (const c of cases) {
  const u = await newUser();
  let s;
  if (c.ctx.active) s = await setupActive(u, c.ctx.active.wf);
  else if (c.ctx.proposal) s = await setupProposal(u);
  const before = traceLines().length;
  const r = await say(u, c.text, s);
  await sleep(150);
  const after = traceLines();
  let trace = null;
  // Exactly one new ci_global_trace line is expected for the turn just sent (index `before`, 0-based, into `after`).
  // If more than one appeared (shouldn't happen — turns are sequential/awaited), take the line at index `before`
  // (the first new one, matching send order) since that is the one this turn actually produced.
  if (after.length > before) {
    try { trace = JSON.parse(after[before]); } catch { trace = null; }
  } else {
    missedCount += 1;
  }
  results.push({ id: c.id, cat: c.cat, text: c.text, exp: c.exp, ctx: c.ctx, httpStatus: r.status, route: trace?.route ?? null, topic: trace?.topic ?? null, workflow: trace?.workflow ?? null, interrupts: trace?.interrupts ?? null });
  process.stdout.write(".");
}
console.log(`\n${results.length} turns run, ${missedCount} turns produced NO new trace line at all (genuine gap, not a capture-window artifact)`);

const fmt = (r) => `${r.route ?? "NONE"}${r.topic ? `(${r.topic})` : r.workflow ? `(${r.workflow})` : ""}`;
const bump = (m, k, ok) => { m[k] = m[k] ?? { n: 0, ok: 0 }; m[k].n += 1; if (ok) m[k].ok += 1; };
const metrics = {};
let unsafe = 0;
const failures = [];
for (const r of results) {
  const routeOk = r.route === r.exp.route;
  const topicOk = r.exp.topic ? r.topic === r.exp.topic : true;
  const wfOk = r.exp.wf ? r.workflow === r.exp.wf : true;
  const ok = routeOk && topicOk && wfOk;
  bump(metrics, "route", routeOk);
  if (r.exp.topic) bump(metrics, "topic", topicOk && routeOk);
  if (["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA", "NEGATE_ACTION"].includes(r.exp.route) && !r.ctx.active) {
    const mutating = ["START_WORKFLOW", "SLOT_ANSWER", "WRITE_ACTION"].includes(r.route);
    if (mutating) unsafe += 1;
  }
  if (!ok) failures.push(`${r.id} [${r.cat}] "${r.text}" → ${fmt(r)}, expected ${r.exp.route}${r.exp.topic ? `(${r.exp.topic})` : r.exp.wf ? `(${r.exp.wf})` : ""}`);
}
const pct = (t) => (t.n ? `${((t.ok / t.n) * 100).toFixed(1)}% (${t.ok}/${t.n})` : "n/a");
const out = {
  config: "B: deterministic + qwen3:4b typed-LLM fallback (REAL Docker HTTP, route read from the container's own ci_global_trace log, count-offset correlation — fixes the time-window capture bug in run-global-2-live.mjs)",
  mode: MODE, total: results.length, noTraceCount: results.filter((r) => r.route === null).length,
  routeAccuracy: pct(metrics.route ?? { n: 0, ok: 0 }), topicAccuracy: pct(metrics.topic ?? { n: 0, ok: 0 }),
  unsafeMisroutes: unsafe, failureCount: failures.length, failures,
};
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync(`test/conversational-intelligence/results/global-blind-2-config-b-v2-${MODE}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, failures: undefined }, null, 2));
console.log("\nFAILURES:"); for (const f of failures) console.log(" - " + f);
process.exit(0);
