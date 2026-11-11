// Config B (deterministic + qwen3:4b typed-LLM fallback) measured on the Phase-G blind corpus — REAL HTTP/API through the
// Docker ai-service (gymcoach-ai-dev, CONVERSATIONAL_INTELLIGENCE_V2=on, CONVERSATIONAL_INTELLIGENCE_V2_LLM=on). For each
// turn the route actually taken is read back from the container's own ci_global_trace log line (ground truth of what the
// live system decided), not re-derived locally. Turns needing an active workflow/proposal are driven through the real
// multi-step conversation first. Usage: node test/conversational-intelligence/run-global-2-live.mjs [sample|full]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { registerUser, putProfile, say, sleep } from "../ai-chat-full-verification/lib.mjs";

const MODE = process.argv[2] ?? "sample";
const all = JSON.parse(fs.readFileSync("test/conversational-intelligence/global-blind-2.json", "utf8"));
const NO_SETUP = all.filter((c) => !c.ctx.active && !c.ctx.proposal);
const NEEDS_SETUP = all.filter((c) => c.ctx.active || c.ctx.proposal);
// sample mode: every no-setup case (fast, no state to build) + 1 in 3 of the setup-needing ones (slower, multi-turn)
// stratified: a bounded, TIME-FEASIBLE sample — every category represented (at least 3, up to 5, evenly spread through
// each category's own list, not just a biased prefix), used because full-corpus latency against the local 4B model is
// dominated by the ~30-80s RAG-fallback turns and would take hours end to end.
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
  const u = await registerUser(`ci.g2.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@gymini-test.local`, "CI G2");
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

const results = [];
for (const c of cases) {
  const u = await newUser();
  let s;
  if (c.ctx.active) s = await setupActive(u, c.ctx.active.wf);
  else if (c.ctx.proposal) s = await setupProposal(u);
  const r = await say(u, c.text, s);
  await sleep(150);
  let trace = null;
  try {
    const log = execSync(`docker logs --since 20s gymcoach-ai-dev 2>&1`, { encoding: "utf8", maxBuffer: 20_000_000 });
    const lines = log.split("\n").filter((l) => l.includes("ci_global_trace"));
    if (lines.length) trace = JSON.parse(lines[lines.length - 1]);
  } catch { /* best-effort */ }
  results.push({ id: c.id, cat: c.cat, text: c.text, exp: c.exp, ctx: c.ctx, httpStatus: r.status, route: trace?.route ?? null, topic: trace?.topic ?? null, workflow: trace?.workflow ?? null, interrupts: trace?.interrupts ?? null });
  process.stdout.write(".");
}
console.log(`\n${results.length} turns run`);

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
  config: "B: deterministic + qwen3:4b typed-LLM fallback (REAL Docker HTTP, route read from the container's own ci_global_trace log)",
  mode: MODE, total: results.length, noTraceCount: results.filter((r) => r.route === null).length,
  routeAccuracy: pct(metrics.route ?? { n: 0, ok: 0 }), topicAccuracy: pct(metrics.topic ?? { n: 0, ok: 0 }),
  unsafeMisroutes: unsafe, failureCount: failures.length, failures,
};
fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync(`test/conversational-intelligence/results/global-blind-2-config-b-${MODE}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, failures: undefined }, null, 2));
console.log("\nFAILURES:"); for (const f of failures) console.log(" - " + f);
process.exit(0);
