/** TEST FIXTURE only: injected Converse-shaped Nova replies; no AWS SDK dispatch or credentials. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { NOVA_MODEL, NOVA_REGION, serializeNova, createFakeNovaTransport, type NovaFakeRequest, type NovaFakeReply } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { createScriptedMantleTransport } from "../evaluation/bedrock-pilot/mantle-transport";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { openEvaluationSession, inferenceTarget } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { digest } from "../evaluation/evaluation-kit/identity";
import { ClaimAnalysisSchema } from "../evaluation/ai-coach-claim-dev/pipeline";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig, pilotPrompt, pilotTransport } from "./fixtures/pilot";

const input = (): ConverseCommandInput => ({ modelId: NOVA_MODEL, system: [{ text: "Synthetic system — giữ nguyên tiếng Việt." }],
  messages: [{ role: "user", content: [{ text: "Synthetic user — no labels." }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } });
const answer = () => ({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [],
  missingInformation: [], rationaleSummary: "Synthetic fixture, no scientific conclusion.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
function converse(text: string, inputTokens: number, outputTokens: number, patch: Record<string, unknown> = {}) {
  return { output: { message: { role: "assistant", content: [{ text }] } }, stopReason: "end_turn", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    metrics: { latencyMs: 7 }, fixture_native_metadata: "PRESERVE_THIS_NATIVE_FIELD", ...patch };
}
function transport(options: { measured?: number; measure?: (r: NovaFakeRequest) => NovaFakeReply; infer?: (r: NovaFakeRequest) => NovaFakeReply } = {}) {
  const requests: NovaFakeRequest[] = [];
  const provider = createFakeNovaTransport({ kind: "FAKE", async converse(request) {
    requests.push(structuredClone(request));
    if (request.purpose === "MEASURE") return options.measure ? options.measure(request) : { status: 200, body: converse("{", options.measured ?? 12, 1, { stopReason: "max_tokens" }) };
    return options.infer ? options.infer(request) : { status: 200, body: converse(JSON.stringify(answer()), options.measured ?? 12, 8) };
  } });
  return { provider, requests, get measureCalls() { return requests.filter(r => r.purpose === "MEASURE").length; }, get inferenceCalls() { return requests.filter(r => r.purpose === "INFERENCE").length; } };
}
function novaConfig(root: string) {
  const c = pilotConfig();
  c.transportProtocol = "NOVA_CONVERSE_MEASURED"; c.modelId = NOVA_MODEL; c.region = NOVA_REGION; c.inferenceProfile = null;
  c.outputContract = "CLAIM_MAP_V3"; c.reviewerMode = "OWNER_ONLY_EXPLORATORY";
  c.design = { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 };
  c.budget = { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 };
  c.pricing.modelId = NOVA_MODEL; c.pricing.region = NOVA_REGION; c.pricing.inferenceProfile = null;
  c.sources = { workspaceRoot: root, casesFile: path.join(root, "unused-cases.json"), claimRegistryConfigFile: path.join(root, "unused-registry.json") };
  return c;
}
function temporary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-test-"));
  return { root, close() { assert.ok(path.basename(root).startsWith("gymini-nova-test-")); fs.rmSync(root, { recursive: true, force: true }); } };
}
const signal = () => new AbortController().signal;

test("measured preflight and inference share one token-bearing payload; only maxTokens differs", async () => {
  const i = input(), wire = serializeNova(i), measure = JSON.parse(wire.measureBody), inference = JSON.parse(wire.inferenceBody);
  assert.equal(measure.inferenceConfig.maxTokens, 1); assert.equal(inference.inferenceConfig.maxTokens, 2048);
  assert.equal(measure.inferenceConfig.temperature, 0.2); assert.equal(inference.inferenceConfig.temperature, 0.2);
  const { inferenceConfig: _a, ...m } = measure, { inferenceConfig: _b, ...n } = inference;
  assert.deepEqual(m, n); assert.deepEqual(m, wire.canonical); assert.equal(m.modelId, NOVA_MODEL);
  assert.equal(wire.identity.protocol, "NOVA_CONVERSE_MEASURED"); assert.equal(wire.identity.region, "us-east-1");
  assert.notEqual(wire.identity.measureRequestHash, wire.identity.inferenceRequestHash);
  const t = transport(); await t.provider.count(i, signal()); await t.provider.invoke(i, signal());
  assert.deepEqual(t.requests.map(r => [r.operation, r.region, r.purpose]), [["Converse", "us-east-1", "MEASURE"], ["Converse", "us-east-1", "INFERENCE"]]);
  assert.ok(!t.requests.some(r => /count_tokens|bedrock-mantle|global\.|us\.amazon|apac\.|cachePoint|toolConfig/.test(JSON.stringify(r))));
});

test("serialization rejects other models/profiles and token-bearing features outside the bounded text contract", () => {
  for (const patch of [{ modelId: "us.amazon.nova-pro-v1:0" }, { modelId: "apac.amazon.nova-pro-v1:0" }, { modelId: "amazon.nova-2-lite-v1:0" }, { modelId: "anthropic.claude-haiku-4-5" },
    { toolConfig: { tools: [] } }, { additionalModelRequestFields: { reasoningConfig: { type: "enabled" } } },
    { messages: [{ role: "user", content: [{ image: { format: "png", source: { bytes: new Uint8Array([1]) } } }] }] },
    { system: [{ text: "ok", cachePoint: { type: "default" } }] }, { inferenceConfig: { maxTokens: 2049 } }, { inferenceConfig: { maxTokens: 2048, temperature: 0.2, topP: 0.9 } }])
    assert.throws(() => serializeNova({ ...input(), ...patch } as ConverseCommandInput), /NOVA_UNSUPPORTED_INPUT/);
});

test("adapter requires explicit FAKE IO and an aborted request never dispatches", async () => {
  assert.throws(() => createFakeNovaTransport({ kind: "LIVE", async converse() { throw new Error("must not dispatch"); } } as never), /NOVA_FAKE_IO_REQUIRED/);
  const controller = new AbortController(); controller.abort(); const t = transport();
  await assert.rejects(t.provider.count(input(), controller.signal), /Aborted/); await assert.rejects(t.provider.invoke(input(), controller.signal), /Aborted/);
  assert.equal(t.requests.length, 0);
});

test("measure replies fail closed for unknown, inconsistent, cached or over-1 output usage without retry", async () => {
  for (const body of [converse("{", 12, 2, { stopReason: "max_tokens" }), converse("{", 12, 1, { stopReason: "guardrail_intervened" }), converse("{", -1, 1, { stopReason: "max_tokens" }),
    converse("{", 12, 1, { stopReason: "max_tokens", usage: { inputTokens: 12, outputTokens: 1, totalTokens: 99 } }),
    converse("{", 12, 1, { stopReason: "max_tokens", usage: { inputTokens: 12, outputTokens: 1, totalTokens: 13, cacheReadInputTokens: 5 } }),
    converse("{", 12, 1, { stopReason: "max_tokens", usage: { inputTokens: 12, outputTokens: 1, totalTokens: 13, cacheWriteInputTokens: 5 } }),
    converse("{", 12, 1, { stopReason: "max_tokens", usage: {} }), { output: null }]) {
    const t = transport({ measure: () => ({ status: 200, body }) });
    await assert.rejects(t.provider.count(input(), signal()), /NOVA_/); assert.equal(t.requests.length, 1);
  }
  for (const status of [400, 403, 429, 500]) { const t = transport({ measure: () => ({ status, body: { message: "TEST FIXTURE error" } }) }); await assert.rejects(t.provider.count(input(), signal()), /NOVA_/); assert.equal(t.requests.length, 1); }
});

test("inference normalization keeps the full provider envelope; non end_turn stops are failures", async () => {
  const t = transport(), r = await t.provider.invoke(input(), signal());
  assert.equal(r.output!.message!.content![0].text, JSON.stringify(answer())); assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  assert.ok(JSON.stringify(r).includes("PRESERVE_THIS_NATIVE_FIELD"));
  for (const stopReason of ["max_tokens", "guardrail_intervened", "content_filtered", "tool_use"]) {
    const bad = transport({ infer: () => ({ status: 200, body: converse("{}", 12, 8, { stopReason }) }) });
    await assert.rejects(bad.provider.invoke(input(), signal()), /NOVA_STOP_REASON/); assert.equal(bad.requests.length, 1);
  }
  const over = transport({ infer: () => ({ status: 200, body: converse("{}", 12, 2049) }) });
  await assert.rejects(over.provider.invoke(input(), signal()), /NOVA_USAGE_OUT_OF_BOUNDS/);
});

test("Nova config cannot use a profile/other Region, raise caps, change arms or unlock LIVE; transports must match", () => {
  const f = temporary();
  try {
    const c = novaConfig(f.root); assert.doesNotThrow(() => parseConfiguration(c));
    assert.equal(inferenceTarget(c).identifier, NOVA_MODEL); assert.equal(inferenceTarget(c).kind, "NOVA_CONVERSE_MEASURED");
    assert.throws(() => inferenceTarget({ ...c, mode: "LIVE" }), /NOVA_LIVE_LOCKED/);
    for (const v of [{ ...c, mode: "LIVE", liveOptIn: true }, { ...c, liveOptIn: true }, { ...c, inferenceProfile: "us.amazon.nova-pro-v1:0" }, { ...c, region: "ap-southeast-1" },
      { ...c, outputContract: "LEGACY_V3" }, { ...c, reviewerMode: "TWO_RATER" }, { ...c, parameters: { ...c.parameters, maxTokens: 2049 } }, { ...c, design: { ...c.design, repeats: 3 } },
      ...[{ maxCalls: 9 }, { maxInputTokensPerCall: 13000 }, { maxInputTokens: 144001 }, { maxOutputTokens: 16389 }, { maxEstimatedUsd: 1.01 }, { maxFailures: 3 }].map(b => ({ ...c, budget: { ...c.budget, ...b } }))])
      assert.throws(() => parseConfiguration(v));
    assert.throws(() => openEvaluationSession(c, path.join(f.root, "generic"), pilotTransport()), /NOVA_TRANSPORT_REQUIRED/);
    assert.throws(() => openEvaluationSession(c, path.join(f.root, "mantle"), createScriptedMantleTransport("{}")), /NOVA_TRANSPORT_REQUIRED/);
    const undeclared = { ...transport().provider, billedCount: false };
    assert.throws(() => openEvaluationSession(c, path.join(f.root, "undeclared"), undeclared), /BILLED_COUNT_DECLARATION_MISMATCH/);
    assert.throws(() => openEvaluationSession(pilotConfig(), path.join(f.root, "generic-nova"), transport().provider), /NOVA_TRANSPORT_REQUIRED/);
    for (const d of ["generic", "mantle", "undeclared", "generic-nova"]) assert.equal(fs.existsSync(path.join(f.root, d)), false);
  } finally { f.close(); }
});

test("session reserves the measured preflight spend before dispatch and reconciles it to AWS-reported usage", async () => {
  const f = temporary(), t = transport({ measured: 321 }); let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(novaConfig(f.root), path.join(f.root, "run"), t.provider);
    const r = await session.evaluate(pilotPrompt);
    assert.equal(r.providerError, null); assert.equal(r.parseError, null); assert.equal(r.inputTokens, 321);
    assert.equal(t.measureCalls, 1); assert.equal(t.inferenceCalls, 1);
    const s = session.state();
    assert.equal(s.countCalls, 1); assert.equal(s.inferenceCalls, 1); assert.equal(s.inputTokens, 321 + 321); assert.equal(s.outputTokens, 1 + 8);
    assert.equal(s.estimatedUsd, Math.ceil(((321 + 321) * 1 + 9 * 2) * 1000) / 1e9);
    const events = session.records().map(x => (x as { event: string }).event);
    assert.ok(events.includes("MEASURE_BILLED")); assert.ok(events.indexOf("MEASURE_BILLED") < events.indexOf("INFERENCE_RESERVED"));
    // A repeat of the same prompt reuses the measurement: no second billed preflight.
    await session.evaluate(pilotPrompt); assert.equal(t.measureCalls, 1); assert.equal(t.inferenceCalls, 2);
  } finally { await session?.close(); f.close(); }
});

test("over-cap measurement records the billed actual usage and stops before inference", async () => {
  const f = temporary(), t = transport({ measured: 12001 }); let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(novaConfig(f.root), path.join(f.root, "over"), t.provider);
    await assert.rejects(session.evaluate(pilotPrompt), /TokenPreflightFailed/);
    assert.equal(t.inferenceCalls, 0); assert.equal(session.state().stopped, true); assert.equal(session.state().inputTokens, 12001); assert.equal(session.state().outputTokens, 1);
    await assert.rejects(session.evaluate(pilotPrompt), /BudgetStopped/); assert.equal(t.measureCalls, 1);
  } finally { await session?.close(); f.close(); }
});

test("measure budget is checked before dispatch; unknown measure usage keeps the conservative reservation", async () => {
  const f = temporary(); let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    const c = novaConfig(f.root); c.budget.maxEstimatedUsd = 0.000001;
    const denied = transport(); session = openEvaluationSession(c, path.join(f.root, "denied"), denied.provider);
    await assert.rejects(session.evaluate(pilotPrompt), /TokenPreflightFailed/); assert.equal(denied.requests.length, 0); assert.equal(session.state().stopped, true);
    await session.close(); session = undefined;
    const unknown = transport({ measure: () => ({ status: 200, body: converse("{", 12, 1, { stopReason: "max_tokens", usage: {} }) }) });
    session = openEvaluationSession(novaConfig(f.root), path.join(f.root, "unknown"), unknown.provider);
    await assert.rejects(session.evaluate(pilotPrompt), /TokenPreflightFailed/);
    assert.equal(session.state().inputTokens, 12000); assert.equal(session.state().outputTokens, 1); assert.equal(unknown.inferenceCalls, 0);
    assert.ok(JSON.stringify(session.records()).includes("PRESERVE_THIS_NATIVE_FIELD"), "rejected measure reply is retained");
  } finally { await session?.close(); f.close(); }
});

test("inference input usage must equal the measured count exactly; mismatch stops and keeps the reservation", async () => {
  const f = temporary(), t = transport({ measured: 50, infer: () => ({ status: 200, body: converse(JSON.stringify(answer()), 51, 8) }) });
  let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(novaConfig(f.root), path.join(f.root, "mismatch"), t.provider);
    const r = await session.evaluate(pilotPrompt);
    assert.equal(r.providerError, "USAGE_MISMATCH_OR_UNKNOWN"); assert.equal(r.conservativeReservationRetained, true);
    assert.equal(session.state().stopped, true); assert.equal(session.state().outputTokens, 1 + 2048);
    await assert.rejects(session.evaluate(pilotPrompt), /BudgetStopped/); assert.equal(t.inferenceCalls, 1);
  } finally { await session?.close(); f.close(); }
});

async function prepared() {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-nova-cal01-fixture"), b = fixturePilotInput(claimDevScenarios[1].request, "case-nova-cal06-fixture");
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const synthetic = syntheticClaimData(), file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(synthetic.input)); fs.writeFileSync(file("map.json"), JSON.stringify(synthetic.map)); fs.writeFileSync(file("owner.json"), synthetic.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: synthetic.pins }));
  const c = novaConfig(a.root); c.sources = { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") };
  c.pins = (await calculatePilotPins(a.root, a.casesFile, c.design, c.sources)).pins;
  return { ...a, config: c };
}

test("runner: 4 billed measurements + 8 synthetic Nova calls keep E2 claim envelopes; preview includes preflight spend; resume adds no calls", async () => {
  const f = await prepared(), size = (body: string) => { const { inferenceConfig: _c, ...bearing } = JSON.parse(body); return Math.ceil(Buffer.byteLength(JSON.stringify(bearing), "utf8") / 4); };
  const t = transport({ measure: r => ({ status: 200, body: converse("{", size(r.body), 1, { stopReason: "max_tokens" }) }),
    infer: r => ({ status: 200, body: converse(JSON.stringify({ ...answer(), claimLinks: [] }), size(r.body), 40) }) });
  let preview: { measuredPreflight?: { calls: number; inputTokens: number }; inputTokenCeiling: number } | undefined;
  const directory = path.join(f.root, "nova-run"), summary = await runControlledPilot({ config: f.config, directory, transport: t.provider, onPreview: v => { preview = v as typeof preview; } });
  assert.equal(t.measureCalls, 4); assert.equal(t.inferenceCalls, 8); assert.equal(summary.denominators.failed, 0); assert.equal(summary.actualBedrockCalls, 0);
  assert.equal(summary.reviewAuthority, "EXPLORATORY_OWNER_REVIEWED"); assert.equal(preview?.measuredPreflight?.calls, 4);
  const records = fs.readdirSync(directory).filter(n => n.startsWith("answer-")).map(n => JSON.parse(fs.readFileSync(path.join(directory, n), "utf8")));
  assert.equal(records.length, 8);
  for (const r of records) { assert.ok(ClaimAnalysisSchema.safeParse(r.raw.parsedCandidate).success); assert.ok(JSON.stringify(r.raw).includes("PRESERVE_THIS_NATIVE_FIELD")); }
  const bearing = (body: string) => { const { inferenceConfig: _c, ...rest } = JSON.parse(body); return digest(rest); };
  const measured = new Set(t.requests.filter(r => r.purpose === "MEASURE").map(r => bearing(r.body)));
  for (const r of t.requests.filter(r => r.purpose === "INFERENCE")) { assert.ok(measured.has(bearing(r.body))); assert.equal(JSON.parse(r.body).inferenceConfig.maxTokens, 2048); }
  for (const r of t.requests.filter(r => r.purpose === "MEASURE")) assert.equal(JSON.parse(r.body).inferenceConfig.maxTokens, 1);
  const resumed = await runControlledPilot({ config: f.config, directory, transport: t.provider, resume: true }); assert.deepEqual(resumed, summary);
  assert.equal(t.measureCalls, 4); assert.equal(t.inferenceCalls, 8);
});
