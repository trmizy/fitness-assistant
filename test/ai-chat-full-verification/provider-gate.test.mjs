// node --test test/ai-chat-full-verification/provider-gate.test.mjs
// MOCKED provider only (an in-process upstream function or a local HTTP server) — no real provider call, no network beyond
// 127.0.0.1. Oracles are hand-written counts. Scenarios are the ones the RC1 incident review requires.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGate, classify, settleVerdict, bedrockUpstream } from "./provider-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const AI_DIR = path.join(ROOT, "backend/services/ai-service");
const CONVERSE = "/model/apac.amazon.nova-pro-v1%3A0/converse";
const EMBED = "/model/cohere.embed-multilingual-v3/invoke";
const converseOk = (inT = 100, outT = 20) => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "ok" }] } }, stopReason: "end_turn", usage: { inputTokens: inT, outputTokens: outT, totalTokens: inT + outT } })) });
const embedOk = () => ({ status: 200, headers: { "content-type": "application/json", "x-amzn-bedrock-input-token-count": "4" }, body: Buffer.from(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] })) });

async function start(opts) {
  const g = createGate(opts);
  await new Promise((r) => g.server.listen(0, "127.0.0.1", r));
  const port = g.server.address().port;
  const send = (p, body = { inferenceConfig: { maxTokens: 10 } }, { signal } = {}) =>
    fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  return { g, port, send, stop: () => g.shutdown() };
}
const counting = (fn) => { const u = async (req) => { u.calls++; return fn(req); }; u.calls = 0; return u; };

test("40 calls admitted; call 41 is refused BEFORE the network, with a non-retryable error", async () => {
  const up = counting(() => converseOk());
  const s = await start({ maxCalls: 40, maxUsd: 100, upstream: up });
  for (let i = 0; i < 40; i++) assert.equal((await s.send(CONVERSE)).status, 200);
  const r = await s.send(CONVERSE);
  assert.equal(r.status, 403);
  assert.match(r.headers.get("x-amzn-errortype"), /^AccessDeniedException/);
  assert.equal(up.calls, 40, "the 41st request never reached the provider");
  const st = s.g.status();
  assert.equal(st.attempts, 40); assert.equal(st.refused, 1); assert.equal(st.remainingCalls, 0);
  await s.stop();
});

test("concurrent background workers cannot race past the cap (60 simultaneous requests, cap 40)", async () => {
  let release; const gateOpen = new Promise((r) => (release = r));
  const up = counting(async () => { await gateOpen; return converseOk(); });
  const s = await start({ maxCalls: 40, maxUsd: 100, upstream: up });
  const all = Array.from({ length: 60 }, () => s.send(CONVERSE));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.g.status().inFlight, 40);
  release();
  const codes = (await Promise.all(all)).map((r) => r.status);
  assert.equal(codes.filter((c) => c === 200).length, 40);
  assert.equal(codes.filter((c) => c === 403).length, 20);
  assert.equal(up.calls, 40);
  await s.stop();
});

test("embeddings are provider calls under the same cap; usage counted once per attempt", async () => {
  const up = counting((req) => (req.cls.kind === "embedding" ? embedOk() : converseOk()));
  const s = await start({ maxCalls: 3, maxUsd: 100, upstream: up });
  assert.equal((await s.send(EMBED, { texts: ["a"], input_type: "search_query" })).status, 200);
  assert.equal((await s.send(CONVERSE)).status, 200);
  assert.equal((await s.send(EMBED, { texts: ["b"], input_type: "search_query" })).status, 200);
  assert.equal((await s.send(EMBED, { texts: ["c"], input_type: "search_query" })).status, 403, "4th call refused even though it is an embedding");
  const st = s.g.status();
  assert.deepEqual(st.byKind, { llm: 1, embedding: 2 });
  assert.equal(st.tokens.embeddingIn, 8); assert.equal(st.tokens.llmIn, 100);
  await s.stop();
});

test("the USD cap uses actual + reserved spend, so in-flight calls cannot jointly overrun it", async () => {
  let release; const hold = new Promise((r) => (release = r));
  const up = counting(async () => { await hold; return converseOk(); });
  // each reservation ≈ maxTokens 4096 × $0.0032/1K ≈ $0.0131 → only 3 fit under $0.04
  const s = await start({ maxCalls: 100, maxUsd: 0.04, upstream: up });
  const p = Array.from({ length: 5 }, () => s.send(CONVERSE, { inferenceConfig: { maxTokens: 4096 } }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(up.calls, 3);
  release();
  const codes = (await Promise.all(p)).map((r) => r.status).sort();
  assert.deepEqual(codes, [200, 200, 200, 403, 403]);
  await s.stop();
});

test("unknown operations (e.g. streaming) are refused, never forwarded", async () => {
  const up = counting(() => converseOk());
  const s = await start({ maxCalls: 10, maxUsd: 1, upstream: up });
  assert.equal((await s.send("/model/x/converse-stream")).status, 403);
  assert.equal(up.calls, 0);
  assert.equal(classify("GET", CONVERSE), null);
  await s.stop();
});

test("a job left from an earlier run that fires after the run closed the gate is refused before the network", async () => {
  const up = counting(() => converseOk());
  const s = await start({ maxCalls: 40, maxUsd: 1, upstream: up });
  await fetch(`http://127.0.0.1:${s.port}/__gate/close`, { method: "POST" });
  assert.equal((await s.send(CONVERSE)).status, 403);
  assert.equal(up.calls, 0);
  assert.equal(s.g.status().settled, true);
  await s.stop();
});

test("a call longer than any quiet window keeps the run UNSETTLED until the provider answers (no time-based guess)", async () => {
  let release; const hold = new Promise((r) => (release = r));
  const s = await start({ maxCalls: 5, maxUsd: 1, upstream: async () => { await hold; return converseOk(); } });
  const p = s.send(CONVERSE);
  await new Promise((r) => setTimeout(r, 50));
  s.g.close();
  // however long the logs stay quiet, an in-flight call means not settled
  assert.equal(s.g.status().settled, false);
  assert.equal(settleVerdict({ gate: s.g.status(), queuePending: 0 }).verdict, "UNSETTLED");
  release(); await p;
  assert.equal(s.g.status().settled, true);
  assert.equal(settleVerdict({ gate: s.g.status(), queuePending: 0 }).verdict, "SETTLED");
  await s.stop();
});

test("a call the client abandons (timeout / stop) is still followed to completion and its usage recorded", async () => {
  let release; const hold = new Promise((r) => (release = r));
  const s = await start({ maxCalls: 5, maxUsd: 1, upstream: async () => { await hold; return converseOk(300, 50); } });
  const ac = new AbortController();
  const p = s.send(CONVERSE, undefined, { signal: ac.signal }).catch((e) => e.name);
  await new Promise((r) => setTimeout(r, 50));
  ac.abort();
  assert.equal(await p, "AbortError");
  assert.equal(s.g.status().inFlight, 1, "the gate does not forget the request when the client leaves");
  await new Promise((r) => setTimeout(r, 150)); // let the server observe the dropped connection before the provider answers
  release();
  await new Promise((r) => setTimeout(r, 50));
  const st = s.g.status();
  assert.equal(st.completed, 1); assert.equal(st.clientAborted, 1); assert.equal(st.tokens.llmIn, 300);
  await s.stop();
});

test("no provider answer at all → recorded as UNKNOWN (possibly billed), not dropped", async () => {
  const s = await start({ maxCalls: 5, maxUsd: 1, upstreamTimeoutMs: 100, upstream: () => new Promise(() => {}) });
  const r = await s.send(CONVERSE);
  assert.equal(r.status, 504);
  const st = s.g.status();
  assert.equal(st.unknown, 1); assert.ok(st.usd.unknownUpperBound > 0); assert.equal(st.inFlight, 0);
  s.g.close();
  const v = settleVerdict({ gate: s.g.status(), queuePending: 0 });
  assert.equal(v.verdict, "SETTLED_WITH_UNKNOWN");
  assert.match(v.reasons.join(" "), /possibly billed/);
  await s.stop();
});

test("queue still holding jobs, or a queue that cannot be read, is UNSETTLED", () => {
  const gate = { closed: true, inFlight: 0, unknown: 0 };
  assert.equal(settleVerdict({ gate, queuePending: 3 }).verdict, "UNSETTLED");
  assert.equal(settleVerdict({ gate, queuePending: null }).verdict, "UNSETTLED");
  assert.equal(settleVerdict({ gate: { ...gate, closed: false }, queuePending: 0 }).verdict, "UNSETTLED");
  assert.equal(settleVerdict({ gate, queuePending: 0 }).verdict, "SETTLED");
});

// ── The REAL ai-service Bedrock client (bedrock.client.ts) against the gate, with the env stack.mjs uses ─────────────
const probe = (endpoint, extraEnv = {}) => {
  const env = { ...process.env, AWS_ENDPOINT_URL_BEDROCK_RUNTIME: endpoint, AWS_ACCESS_KEY_ID: "gate-only-fake", AWS_SECRET_ACCESS_KEY: "gate-only-fake",
    BEDROCK_EMBEDDING_MODEL: "cohere.embed-multilingual-v3", BEDROCK_CHAT_MODEL: "apac.amazon.nova-pro-v1:0", BEDROCK_REGION: "ap-southeast-1", ...extraEnv };
  for (const k of ["AWS_PROFILE", "AWS_SESSION_TOKEN", "BEDROCK_CROSS_ACCOUNT_ROLE_ARN", "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS"]) delete env[k];
  // async spawn: the gate under test runs in THIS process, so its event loop must stay free
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(HERE, "provider-gate-sdk-probe.mjs")], { cwd: AI_DIR, env });
    let so = "", se = ""; c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    const t = setTimeout(() => c.kill(), 60_000);
    c.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(so.trim().split("\n").pop())); } catch { reject(new Error(`probe failed: ${se.slice(-600)}`)); } });
  });
};
const listen = (g) => new Promise((r) => g.server.listen(0, "127.0.0.1", () => r(g.server.address().port)));

test("REAL ai-service client: chat AND embedding go through the gate (endpoint override honoured, fake creds suffice)", async () => {
  const seen = [];
  const g = createGate({ maxCalls: 10, maxUsd: 1, upstream: async (req) => { seen.push(req.cls.kind); return req.cls.kind === "embedding" ? embedOk() : converseOk(); } });
  const port = await listen(g);
  const out = await probe(`http://127.0.0.1:${port}`);
  assert.equal(out.chat.ok, true, JSON.stringify(out));
  assert.equal(out.embedding.ok, true, JSON.stringify(out));
  assert.deepEqual(seen.sort(), ["embedding", "llm"]);
  assert.equal(g.status().attempts, 2);
  await g.shutdown();
});

test("REAL ai-service client: every SDK retry is a separate counted attempt; usage only from the successful one", async () => {
  let n = 0;
  const g = createGate({ maxCalls: 10, maxUsd: 1, upstream: async (req) => {
    if (req.cls.kind === "embedding") return embedOk();
    n++;
    return n <= 2 ? { status: 500, headers: { "content-type": "application/json", "x-amzn-errortype": "InternalServerException" }, body: Buffer.from('{"message":"boom"}') } : converseOk(111, 9);
  } });
  const port = await listen(g);
  const out = await probe(`http://127.0.0.1:${port}`);
  assert.equal(out.chat.ok, true, JSON.stringify(out));
  const st = g.status();
  assert.equal(st.byKind.llm, 3, "1 logical chat call = 3 HTTP attempts (2 retried 500s + 1 success), all counted");
  assert.equal(st.failed, 2); assert.equal(st.tokens.llmIn, 111, "usage not double-counted");
  await g.shutdown();
});

test("REAL ai-service client: a gate refusal is not retried by the SDK (one refused attempt per call)", async () => {
  const up = counting(() => converseOk());
  const g = createGate({ maxCalls: 0, maxUsd: 1, upstream: up });
  const port = await listen(g);
  const out = await probe(`http://127.0.0.1:${port}`);
  assert.equal(out.chat.ok, false); assert.equal(out.embedding.ok, false);
  assert.equal(g.status().refused, 2, "exactly one refusal per logical call — no retry storm");
  assert.equal(up.calls, 0);
  await g.shutdown();
});

test("fail closed: gate not running → the ai-service client cannot reach any provider", async () => {
  const out = await probe("http://127.0.0.1:9");
  assert.equal(out.chat.ok, false); assert.equal(out.embedding.ok, false);
});

test("real upstream signs for Bedrock Runtime with the GATE's credentials (offline: request function injected)", async () => {
  const sent = [];
  const up = bedrockUpstream({ region: "ap-southeast-1", aiServiceDir: AI_DIR,
    credentials: async () => ({ accessKeyId: "AKIDEXAMPLEONLY", secretAccessKey: "example-secret-not-real" }),
    request: async (r) => { sent.push(r); return converseOk(); } });
  await up({ method: "POST", path: CONVERSE, headers: { "content-type": "application/json", authorization: "AWS4-HMAC-SHA256 Credential=gate-only-fake/x" }, body: Buffer.from("{}") });
  const h = sent[0].headers;
  assert.equal(sent[0].hostname, "bedrock-runtime.ap-southeast-1.amazonaws.com");
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLEONLY\/\d{8}\/ap-southeast-1\/bedrock\/aws4_request/);
  assert.doesNotMatch(h.authorization, /gate-only-fake/, "the ai-service's fake signature is discarded");
  assert.ok(h["x-amz-date"]);
});
