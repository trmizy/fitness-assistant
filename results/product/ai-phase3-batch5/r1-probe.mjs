// Phase 3 R1 — live probe through the gateway. Per-turn model-call attribution uses the ai-service `llm_call` events (purpose, latency,
// timeout, outcome) filtered by the turn's OWN [t0, t1] window on both edges (the earlier Batch 5 probe had no upper bound and mis-attributed calls).
// Single run per turn; no p50/p90 claim. Writes only its own test user.
import { execSync } from "node:child_process";
import fs from "node:fs";
import { registerUser, putProfile, say } from "../../../test/ai-chat-full-verification/lib.mjs";

const s = Date.now();
const u = await registerUser(`r1.probe.${s}@gymini-test.local`, "R1 Probe");
await putProfile(u, { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE", preferredTrainingDays: [1, 3, 5], sessionDurationMinutes: 60 });

const turns = JSON.parse(process.argv[2] ?? "null") ?? [
  ["PT READ", "PT hiện tại của tôi là ai?"],
  ["Macro READ", "Macro hiện tại của tôi bao nhiêu?"],
  ["Revision (no draft)", "Buổi chân hơi nặng."],
  ["General QA", "Progressive overload là gì?"],
];
const out = [];
let sid = null;
for (const [label, text] of turns) {
  const t0 = Date.now();
  const r = await say(u, text, sid ?? undefined);
  const t1 = Date.now();
  sid = r.sessionId ?? sid;
  const log = execSync(`docker logs gymcoach-ai-dev --since ${new Date(t0 - 2000).toISOString()} 2>&1`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const ev = log.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // attribute by the call START (time - latencyMs), so a call that ended just before this turn is not counted in it
  const inWindow = ev.filter((e) => typeof e.time === "number" && (e.msg !== "llm_call" || (e.time - (e.latencyMs ?? 0)) >= t0 - 50) && (e.time - (e.msg === "llm_call" ? (e.latencyMs ?? 0) : 0)) <= t1 + 50);
  const calls = inWindow.filter((e) => e.msg === "llm_call").map((e) => ({ purpose: e.callPurpose, outcome: e.outcome, latencyMs: e.latencyMs, timeoutMs: e.timeoutMs }));
  const trace = inWindow.filter((e) => e.msg === "ci_global_trace" && e.correlationId === r.data?.traceId).slice(-1)[0];
  const routing = ev.filter((e) => e.msg === "ci_global_llm_route" && e.correlationId === r.data?.traceId).map((e) => ({ accepted: e.accepted, acceptedRoute: e.acceptedRoute, llmRoute: e.llmRoute, rejectionReason: e.rejectionReason ?? null, latencyMs: e.latencyMs }));
  out.push({ label, text, http: r.status, httpMs: t1 - t0, answerChars: (r.answer ?? "").length, answer: (r.answer ?? "").slice(0, 120), route: trace?.route ?? null, deterministicRoute: trace?.deterministicRoute ?? null, llmCalled: trace?.llmCalled ?? false, modelCalls: calls, routing });
}
fs.writeFileSync(new URL("./r1-probe.json", import.meta.url), JSON.stringify({ measuredAt: new Date().toISOString(), runs: "single run per turn", turns: out }, null, 2));
console.log(JSON.stringify(out.map((t) => ({ label: t.label, http: t.http, ms: t.httpMs, route: t.route, llm: t.modelCalls.map((c) => `${c.purpose}:${c.outcome}:${c.latencyMs}ms`), routing: t.routing.map((x) => `${x.accepted ? "ACCEPT" : "REJECT"}:${x.rejectionReason ?? x.acceptedRoute}`) })), null, 1));
