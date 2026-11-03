/** TEST FIXTURE only: mocked SDK send; no AWS request, credential resolution, trust root or real ledger. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ConverseCommandInput, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { NOVA_MODEL, NOVA_REGION } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { createLiveNovaTransport, createNovaRuntimeClient, NOVA_AWS_PROFILE, NOVA_LIVE_EXECUTION_LOCKED, type NovaSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import { approvedConfigurationHash, parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { assertIssuedLedger, installedApproval, installedTrustFile } from "../evaluation/bedrock-pilot/ledger";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { pilotConfig, pilotPrompt } from "./fixtures/pilot";

const input = (): ConverseCommandInput => ({ modelId: NOVA_MODEL, system: [{ text: "Synthetic system — tiếng Việt." }],
  messages: [{ role: "user", content: [{ text: "Synthetic user — no labels." }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } });
const signal = () => new AbortController().signal;
function sdkOutput(text: string, inputTokens: number, outputTokens: number, patch: Partial<ConverseCommandOutput> & Record<string, unknown> = {}): ConverseCommandOutput {
  return { $metadata: { httpStatusCode: 200, requestId: "req-fixture-nova" }, output: { message: { role: "assistant", content: [{ text }] } }, stopReason: "end_turn",
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, metrics: { latencyMs: 5 }, ...patch } as ConverseCommandOutput;
}
function mock(handler: (i: ConverseCommandInput) => ConverseCommandOutput | Promise<ConverseCommandOutput>) {
  const calls: ConverseCommandInput[] = [];
  const send: NovaSend = async (i, _s) => { calls.push(structuredClone(i)); return handler(i); };
  return { transport: createLiveNovaTransport(send), calls };
}
const sdkError = (name: string, status?: number, message = "TEST FIXTURE error") => Object.assign(new Error(message), { name, $fault: status && status >= 500 ? "server" : "client", ...(status ? { $metadata: { httpStatusCode: status, requestId: "req-err" } } : {}) });

test("runtime client is pinned to us-east-1 with SDK retries disabled; constructing it sends nothing", async () => {
  const client = createNovaRuntimeClient();
  assert.equal(await client.config.region(), "us-east-1"); assert.equal(NOVA_REGION, "us-east-1");
  assert.equal(await client.config.maxAttempts(), 1); assert.equal(NOVA_AWS_PROFILE, "divuzha");
  client.destroy();
  const source = fs.readFileSync(path.resolve(__dirname, "../evaluation/bedrock-pilot/nova-live-transport.ts"), "utf8");
  assert.doesNotMatch(source, /process\.env|CountTokensCommand|InvokeModelCommand|bedrock-mantle|global\.|us\.amazon|apac\./);
});

test("LIVE transport sends exactly the measured (maxTokens=1) and inference Converse payloads, differing only in maxTokens", async () => {
  const m = mock(i => i.inferenceConfig!.maxTokens === 1 ? sdkOutput("{", 321, 1, { stopReason: "max_tokens" }) : sdkOutput("{\"ok\":true}", 321, 9));
  assert.equal(m.transport.kind, "LIVE"); assert.equal(m.transport.protocol, "NOVA_CONVERSE_MEASURED"); assert.equal(m.transport.billedCount, true);
  const counted = await m.transport.count(input(), signal()), answer = await m.transport.invoke(input(), signal());
  assert.equal(typeof counted === "number" ? counted : counted.inputTokens, 321);
  assert.ok(typeof counted !== "number" && JSON.stringify(counted.providerResponse).includes("req-fixture-nova"));
  assert.equal(answer.usage!.inputTokens, 321); assert.equal(answer.stopReason, "end_turn");
  assert.equal(m.calls.length, 2); assert.equal(m.calls[0].inferenceConfig!.maxTokens, 1); assert.equal(m.calls[1].inferenceConfig!.maxTokens, 2048);
  const { inferenceConfig: a, ...measured } = m.calls[0], { inferenceConfig: b, ...inferred } = m.calls[1];
  assert.deepEqual(measured, inferred); assert.equal(a!.temperature, b!.temperature);
  assert.ok(m.calls.every(c => c.modelId === NOVA_MODEL && !("toolConfig" in c) && !JSON.stringify(c).includes("cachePoint")));
});

test("SDK errors map to typed failures without retry; network/unknown outcomes are marked unknownUsage", async () => {
  const cases: [Error, RegExp, boolean][] = [[sdkError("AccessDeniedException", 403), /NOVA_AUTHORIZATION/, false], [sdkError("ThrottlingException", 429), /NOVA_THROTTLED/, false],
    [sdkError("ValidationException", 400), /NOVA_REQUEST_VALIDATION/, false], [sdkError("InternalServerException", 500), /NOVA_PROVIDER_ERROR/, false],
    [sdkError("ServiceUnavailableException", 503), /NOVA_PROVIDER_ERROR/, false], [sdkError("TimeoutError"), /NOVA_NETWORK_UNKNOWN_OUTCOME/, true]];
  for (const [error, code, unknown] of cases) for (const op of ["count", "invoke"] as const) {
    const m = mock(() => { throw error; });
    await assert.rejects(m.transport[op](input(), signal()), (e: { code?: string; details?: { unknownUsage?: boolean } }) => code.test(String(e.code)) && (e.details?.unknownUsage === true) === unknown);
    assert.equal(m.calls.length, 1);
  }
  const long = mock(() => { throw sdkError("ValidationException", 400, "x".repeat(5000)); });
  await assert.rejects(long.transport.invoke(input(), signal()), (e: { details?: { providerResponse?: { body?: { error?: { message?: string } } } } }) => e.details?.providerResponse?.body?.error?.message?.length === 500);
});

test("an aborted/timed-out LIVE call is rethrown as abort and never retried", async () => {
  let calls = 0; const controller = new AbortController();
  const transport = createLiveNovaTransport(async (_i, s) => { calls++; return await new Promise<never>((_r, reject) => s.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true })); });
  const pending = transport.invoke(input(), controller.signal); controller.abort();
  await assert.rejects(pending, /aborted/); assert.equal(calls, 1);
  const pre = new AbortController(); pre.abort(); await assert.rejects(transport.count(input(), pre.signal), /Aborted/); assert.equal(calls, 1);
});

test("LIVE replies fail closed on cache usage, extra usage fields, non-text blocks and non end_turn stops", async () => {
  const bad: [ConverseCommandOutput, RegExp][] = [
    [sdkOutput("{}", 10, 2, { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadInputTokens: 4 } }), /NOVA_UNSUPPORTED_CACHE_USAGE/],
    [sdkOutput("{}", 10, 2, { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheWriteInputTokens: 4 } }), /NOVA_UNSUPPORTED_CACHE_USAGE/],
    [sdkOutput("{}", 10, 2, { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, serverToolUsage: {} } as never }), /NOVA_USAGE_UNKNOWN/],
    [sdkOutput("{}", 10, 2, { output: { message: { role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "hidden" } } } as never] } } }), /NOVA_/],
    [sdkOutput("{}", 10, 2, { stopReason: "max_tokens" }), /NOVA_STOP_REASON_MAX_TOKENS/], [sdkOutput("{}", 10, 2, { stopReason: "guardrail_intervened" }), /NOVA_STOP_REASON/]];
  for (const [reply, code] of bad) { const m = mock(() => reply); await assert.rejects(m.transport.invoke(input(), signal()), code); assert.equal(m.calls.length, 1); }
  const measure = mock(() => sdkOutput("{", 10, 1, { usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11, cacheReadInputTokens: 3 }, stopReason: "max_tokens" }));
  await assert.rejects(measure.transport.count(input(), signal()), /NOVA_UNSUPPORTED_CACHE_USAGE/);
});

function liveConfig(root: string) {
  const c = pilotConfig();
  Object.assign(c, { mode: "LIVE", liveOptIn: true, profileModelConfirmed: true, transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null,
    outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion: "CLAIM_PROMPT_V2", design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
    budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    sources: { workspaceRoot: root, casesFile: path.join(root, "cases.json"), claimRegistryConfigFile: path.join(root, "registry.json") } });
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner" });
  // Structurally valid approval bound to this config; its signature is a fixture and verifies against nothing installed.
  c.approval = { approvalId: randomUUID(), issuer: "fixture-issuer", approvedBy: "fixture-owner", scope: "BEDROCK_EVALUATION_PILOT", configHash: approvedConfigurationHash(c), expiresAt: new Date(Date.now() + 3600000).toISOString(), signature: "VEVTVCBGSVhUVVJF" };
  return c;
}

test("Nova LIVE config parses only with the full signed-configuration conditions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-live-"));
  try {
    const c = liveConfig(root); assert.doesNotThrow(() => parseConfiguration(c));
    for (const v of [{ ...c, approval: null }, { ...c, liveOptIn: false }, { ...c, profileModelConfirmed: false }, { ...c, pricing: { ...c.pricing, authority: "FAKE_TEST_ONLY" } },
      { ...c, approval: { ...c.approval!, configHash: "f".repeat(64) } }, { ...c, approval: { ...c.approval!, expiresAt: new Date(Date.now() - 1000).toISOString() } },
      { ...c, region: "us-east-2" }, { ...c, inferenceProfile: "us.amazon.nova-pro-v1:0" }, { ...c, budget: { ...c.budget, maxEstimatedUsd: 2 } }, { ...c, sources: { ...c.sources!, claimRegistryConfigFile: undefined } }])
      assert.throws(() => parseConfiguration(v));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("LIVE session stops at the pinned-input gate first; cannot take an injected transport; runner stays LIVE-locked", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-live-"));
  try {
    const c = liveConfig(root), dir = path.join(root, "run");
    assert.throws(() => openEvaluationSession(c, dir), /VERIFIED_INPUTS_REQUIRED/);
    assert.throws(() => openEvaluationSession(c, dir, mock(() => sdkOutput("{}", 1, 1)).transport), /LiveTransportCannotBeOverridden/);
    assert.equal(fs.existsSync(dir), false);
    await assert.rejects(runControlledPilot({ config: c, directory: dir }), /RUNNER_LIVE_LOCKED/);
    void pilotPrompt;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("session source orders every owner gate before the execution lock, and the lock before any claim or transport", () => {
  assert.equal(NOVA_LIVE_EXECUTION_LOCKED, true);
  const s = fs.readFileSync(path.resolve(__dirname, "../evaluation/bedrock-pilot/session.ts"), "utf8");
  const order = ["const config = parseConfiguration(value)", "assertVerifiedPins(config, options.verifiedPins);","installedApproval(config) : null", "assertIssuedLedger({", "if (NOVA_LIVE_EXECUTION_LOCKED) throw", "const ledger = openBudgetLedger(", "createLiveNovaTransport()"].map(k => s.indexOf(k));
  assert.ok(order.every(i => i >= 0), JSON.stringify(order)); assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("installed trust root is required (absent on this machine) and is read from a fixed path only", { skip: fs.existsSync(installedTrustFile()) ? "trust file present on this machine" : false }, () => {
  const c = liveConfig(os.tmpdir());
  assert.throws(() => installedApproval(c), /TRUSTED_APPROVAL_STORE_UNAVAILABLE/);
});

test("issued-ledger pre-check is read-only and accepts only an unused OWNER_SIGNED issue bound to approval and config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-ledger-"));
  try {
    const write = (id: string, authority: string, claims = 0) => { const j = openJournal(path.join(root, id + ".jsonl"), true); j.append({ event: "ISSUED", authority, approvalId: id, approvalHash: "a".repeat(64), configHash: "c".repeat(64) }); for (let i = 0; i < claims; i++) j.append({ event: "CLAIMED", runDirectory: "x", state: {} }); };
    write("owner-ok", "OWNER_SIGNED"); write("fake", "FAKE_TEST_ONLY"); write("used", "OWNER_SIGNED", 1);
    const args = (approvalId: string, patch = {}) => ({ directory: root, approvalId, approvalHash: "a".repeat(64), configHash: "c".repeat(64), ...patch });
    const before = fs.readFileSync(path.join(root, "owner-ok.jsonl"));
    assert.doesNotThrow(() => assertIssuedLedger(args("owner-ok")));
    assert.deepEqual(fs.readFileSync(path.join(root, "owner-ok.jsonl")), before); assert.equal(fs.existsSync(path.join(root, "owner-ok.lock")), false);
    assert.throws(() => assertIssuedLedger(args("fake")), /APPROVAL_LEDGER_BINDING_MISMATCH/);
    assert.throws(() => assertIssuedLedger(args("used")), /APPROVAL_ALREADY_USED/);
    assert.throws(() => assertIssuedLedger(args("owner-ok", { configHash: "d".repeat(64) })), /APPROVAL_LEDGER_BINDING_MISMATCH/);
    assert.throws(() => assertIssuedLedger(args("owner-ok", { approvalHash: "b".repeat(64) })), /APPROVAL_LEDGER_BINDING_MISMATCH/);
    assert.throws(() => assertIssuedLedger(args("missing")), /LEDGER_UNVERIFIABLE/);
    assert.throws(() => assertIssuedLedger(args("../escape")), /APPROVAL_ID_INVALID/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
