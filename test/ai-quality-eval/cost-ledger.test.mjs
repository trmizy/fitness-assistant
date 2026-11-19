// node --test test/ai-quality-eval/cost-ledger.test.mjs — mocked log lines only, no provider call.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLedger, summarize, BudgetGate, PRICES, settleQuietMs } from "./cost-ledger.mjs";

const line = (o) => JSON.stringify({ level: 30, time: o.time ?? 1, pid: 1, ...o });
const LOG = [
  line({ msg: "llm_call", callPurpose: "GENERAL_QA", outcome: "ok", promptTokens: 5000, completionTokens: 500, clientRequestId: "aiq-run-B1-13-t1" }),
  line({ msg: "llm_call", callPurpose: "OTHER", outcome: "ok", promptTokens: 400, completionTokens: 40, clientRequestId: "aiq-run-B1-13-t1" }),
  line({ msg: "llm_call", callPurpose: "GENERATION", outcome: "ok", promptTokens: 6000, completionTokens: 700 }), // background job: no request id
  line({ msg: "llm_call", callPurpose: "GENERATION", outcome: "ok", promptTokens: 6000, completionTokens: 650 }), // its parse-retry
  line({ msg: "llm_call", callPurpose: "GENERAL_QA", outcome: "timeout", clientRequestId: "aiq-run-H-01-t1" }), // failed: no usage reported
  line({ msg: "embedding_call", model: "cohere.embed-multilingual-v3", texts: 1, inputChars: 120, outcome: "ok", clientRequestId: "aiq-run-B1-13-t1" }),
  line({ msg: "LLM orchestration finished" }),
  "not json at all",
].join("\n");

test("every model call is counted: chat, auxiliary, BACKGROUND generation and its retry, failed calls, embeddings", () => {
  const entries = parseLedger(LOG);
  assert.equal(entries.filter((e) => e.kind === "llm").length, 5);
  assert.equal(entries.filter((e) => e.kind === "embedding").length, 1);
  const s = summarize(entries, PRICES);
  assert.equal(s.calls.llm, 5);
  assert.equal(s.calls.background, 2, "GENERATION calls without a request id are background work");
  assert.equal(s.calls.failedWithoutUsage, 1);
  // usage-based LLM cost: (5000+400+6000+6000)/1000*0.0008 + (500+40+700+650)/1000*0.0032
  assert.ok(Math.abs(s.usd.llmFromUsage - (17.4 * 0.0008 + 1.89 * 0.0032)) < 1e-9);
  assert.ok(s.usd.embeddingEstimated > 0 && s.usd.embeddingEstimated < 0.001, "embedding cost is an ESTIMATE from characters");
  assert.equal(s.byRequest["aiq-run-B1-13-t1"].llmCalls, 2);
  assert.ok(s.usd.backgroundFromUsage > 0);
});

test("budget gate refuses to START a case when actual spend + projected next case exceeds the cap", () => {
  const gate = new BudgetGate({ maxUsd: 0.05, maxLlmCalls: 100 });
  const s = summarize(parseLedger(LOG), PRICES);
  assert.equal(gate.canStart(s, 0.001).ok, true);
  const r = gate.canStart(s, 0.04);
  assert.equal(r.ok, false);
  assert.match(r.reason, /BUDGET/);
});

test("budget gate enforces a hard cap on the NUMBER of model calls (incl. background)", () => {
  const gate = new BudgetGate({ maxUsd: 10, maxLlmCalls: 5 });
  const r = gate.canStart(summarize(parseLedger(LOG), PRICES), 0);
  assert.equal(r.ok, false);
  assert.match(r.reason, /CALL_LIMIT/);
});

test("the gate never claims an absolute billing cap: work already queued can still finish after it says stop", () => {
  const gate = new BudgetGate({ maxUsd: 0.05, maxLlmCalls: 100 });
  assert.match(gate.guarantee, /not a billing cap/i);
});

test("projection uses the observed average once cases have run, a conservative default before", () => {
  const gate = new BudgetGate({ maxUsd: 1, maxLlmCalls: 100, defaultCaseUsd: 0.02 });
  assert.equal(gate.projectNextCase(summarize([], PRICES), 0), 0.02);
  const s = summarize(parseLedger(LOG), PRICES);
  assert.ok(Math.abs(gate.projectNextCase(s, 2) - s.usd.total / 2) < 1e-12);
});

// RC1 final verification (2026-11-12, rc-verify-v2, REAL HTTP/API): the owner authorised "40 model/provider calls"; the run
// was gated on LLM calls only (12) and settled after 15 s of quiet, while the log shows 13 LLM + 33 Cohere calls in the run
// window (46) — embeddings were never counted against the cap, and a 17.7 s background plan-generation call finished after
// the "quiet" settle had already written the summary.
test("RC1 repro: --max-calls caps PROVIDER calls (LLM + embedding), not LLM calls alone", () => {
  const many = [
    ...Array.from({ length: 12 }, () => line({ msg: "llm_call", callPurpose: "GENERAL_QA", outcome: "ok", promptTokens: 10, completionTokens: 1, clientRequestId: "r" })),
    ...Array.from({ length: 28 }, () => line({ msg: "embedding_call", texts: 1, inputChars: 50, outcome: "ok" })),
  ].join("\n");
  const s = summarize(parseLedger(many), PRICES);
  assert.equal(s.calls.provider, 40);
  const r = new BudgetGate({ maxUsd: 10, maxCalls: 40 }).canStart(s, 0);
  assert.equal(r.ok, false, "12 LLM + 28 embedding = 40 provider calls must hit a 40-call cap");
  assert.match(r.reason, /CALL_LIMIT: 40 provider calls/);
  assert.equal(new BudgetGate({ maxUsd: 10, maxLlmCalls: 41 }).canStart(s, 0).ok, true, "legacy option name still accepted");
});

test("RC1 repro: the settle quiet window outlasts the slowest call seen (17.7 s call > old fixed 15 s window)", () => {
  const slow = line({ msg: "llm_call", callPurpose: "OTHER", outcome: "ok", promptTokens: 4519, completionTokens: 4156, latencyMs: 17746 });
  const e = parseLedger(slow);
  assert.equal(e[0].latencyMs, 17746);
  assert.ok(settleQuietMs(e) > 17746 * 2 - 1, "at least twice the slowest observed call");
  assert.equal(settleQuietMs([]), 60_000, "floor: 60 s even before any call was seen");
  assert.equal(settleQuietMs(parseLedger(line({ msg: "llm_call", latencyMs: 400_000 }))), 120_000, "capped so a hung call cannot stall forever");
});
