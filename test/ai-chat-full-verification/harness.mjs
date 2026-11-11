// Shared harness for the Level C chat verification: traced turns, recorded assertions, DB helpers.
import fs from "node:fs";
import { say, confirmAction, dismissAction, q, appendJsonl } from "./lib.mjs";

export const U = JSON.parse(fs.readFileSync(".tmp-stack/users.json", "utf8"));
export const TRACE = "test/ai-chat-full-verification/results/trace.jsonl";
export const RESULTS = [];
export const state = { current: "" };
export const setJourney = (n) => { state.current = n; };

export const ok = (name, cond, extra = "") => {
  RESULTS.push({ journey: state.current, name, pass: !!cond, extra: String(extra).slice(0, 300) });
  console.log(`${cond ? "PASS" : "FAIL"}  [${state.current}] ${name}${extra ? "  :: " + String(extra).slice(0, 220) : ""}`);
  return !!cond;
};
export const info = (msg) => console.log(`   . ${String(msg).slice(0, 700)}`);

/** One traced chat turn through the real /ai/ask entry point. */
export async function turn(label, user, text, sessionId) {
  const r = await say(user, text, sessionId);
  const blocks = r.data?.structuredBlocks ?? [];
  appendJsonl(TRACE, {
    at: new Date().toISOString(), journey: state.current, label, userId: user.userId, sessionId: r.sessionId, conversationId: r.data?.conversationId, message: text,
    status: r.status, ms: r.ms, usedFallback: r.data?.usedFallback, answer: (r.answer || "").slice(0, 500),
    blocks: blocks.map((b) => ({ type: b.type, actionId: b.actionId, kind: b.kind, risk: b.risk, recommendationId: b.recommendationId, workflowType: b.workflowType, missing: b.missing })),
  });
  console.log(`  > [${label}] "${text}"  (${r.status}, ${r.ms}ms)  blocks=[${blocks.map((b) => b.type + (b.kind ? ":" + b.kind : "")).join(",")}]`);
  console.log(`    ${(r.answer || "").slice(0, 260).replace(/\n/g, " / ")}`);
  return { ...r, blocks, block: (type) => blocks.find((b) => b.type === type), sessionId: r.sessionId, actionId: blocks.find((b) => b.actionId)?.actionId };
}

export const aiq = (sql) => q("ai", sql);
export const fq = (sql) => q("fitness", sql);
export const uq = (sql) => q("user", sql);
export const fqOne = (sql) => fq(sql).split("\n")[0];
export const actionRow = (id) => aiq(`select kind||'|'||status||'|'||risk from fitness_agent_actions where id='${id}'`);

export async function confirmViaApi(user, actionId) {
  const r = await confirmAction(user, actionId);
  appendJsonl(TRACE, { at: new Date().toISOString(), journey: state.current, label: "confirm-api", userId: user.userId, actionId, status: r.status, ms: r.ms, body: JSON.stringify(r.json).slice(0, 600) });
  console.log(`  > [confirm] action ${String(actionId).slice(0, 8)} -> ${r.status} (${r.ms}ms) ${JSON.stringify(r.json?.data?.answer ?? r.json?.data?.message ?? r.json?.error ?? r.json).slice(0, 200)}`);
  return r;
}
export async function dismissViaApi(user, actionId) {
  const r = await dismissAction(user, actionId);
  appendJsonl(TRACE, { at: new Date().toISOString(), journey: state.current, label: "dismiss-api", userId: user.userId, actionId, status: r.status, ms: r.ms, body: JSON.stringify(r.json).slice(0, 600) });
  console.log(`  > [dismiss] action ${String(actionId).slice(0, 8)} -> ${r.status} (${r.ms}ms) ${JSON.stringify(r.json?.data?.answer ?? r.json?.data?.message ?? r.json?.error ?? r.json).slice(0, 200)}`);
  return r;
}

export async function fillSlots(user, s, t, answers, doneBlock) {
  for (const a of answers) { if (t.block(doneBlock)) break; t = await turn("slot", user, a, s); s = t.sessionId; }
  return { t, s };
}

export function finish(which) {
  const pass = RESULTS.filter((r) => r.pass).length;
  console.log(`\nRESULT ${pass}/${RESULTS.length} assertions passed`);
  appendJsonl("test/ai-chat-full-verification/results/assertions.jsonl", { at: new Date().toISOString(), journeys: which, results: RESULTS });
}
