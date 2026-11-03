/** TEST FIXTURE only: injected Mantle-shaped replies; no HTTP/AWS SDK dispatch. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { MANTLE_MODEL, MANTLE_REGION, serializeMantle, createFakeMantleTransport } from "../evaluation/bedrock-pilot/mantle-transport";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { openEvaluationSession, inferenceTarget } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { digest } from "../evaluation/evaluation-kit/identity";
import { validatePacketContract } from "../evaluation/evaluation-kit/annotations";
import { verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { ClaimAnalysisSchema, type ClaimAnalysis } from "../evaluation/ai-coach-claim-dev/pipeline";
import type { ClaimContext } from "../evaluation/ai-coach-claim-dev/context";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { projectClaimAnalysis } from "../evaluation/ai-coach-claim-dev/projection";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig, pilotPrompt, pilotTransport } from "./fixtures/pilot";

type WireRequest = { url: string; method: string; headers: Record<string, string>; body: string; identity: unknown };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const input = (): ConverseCommandInput => ({ modelId: MANTLE_MODEL, system: [{ text: "Synthetic system — giữ nguyên tiếng Việt." }],
  messages: [{ role: "user", content: [{ text: "Synthetic user — no labels." }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } });
const answer = () => ({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [],
  missingInformation: [], rationaleSummary: "Synthetic fixture, no scientific conclusion.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
function native(text = JSON.stringify(answer()), patch: Record<string, unknown> = {}) {
  return { id: "msg-synthetic-mantle", type: "message", model: MANTLE_MODEL, role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 8 }, fixture_native_metadata: "PRESERVE_THIS_NATIVE_FIELD", ...patch };
}
function transport(options: { count?: unknown; reply?: Reply; infer?: (request: WireRequest) => Reply | Promise<Reply> } = {}) {
  const requests: WireRequest[] = [];
  const provider = createFakeMantleTransport({ kind: "FAKE", async post(request, _signal) {
    requests.push(structuredClone(request));
    if (request.url.endsWith("/count_tokens")) return { status: 200, body: { input_tokens: options.count ?? 12 } };
    return options.infer ? options.infer(request) : options.reply ?? { status: 200, body: native() };
  } });
  return { provider, requests, get inferenceCalls() { return requests.filter(r => !r.url.endsWith("/count_tokens")).length; } };
}
function mantleConfig(root: string) {
  const c = pilotConfig();
  c.transportProtocol = "MANTLE_MESSAGES"; c.modelId = MANTLE_MODEL; c.region = MANTLE_REGION; c.inferenceProfile = null;
  c.outputContract = "CLAIM_MAP_V3"; c.reviewerMode = "OWNER_ONLY_EXPLORATORY";
  c.design = { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 };
  c.budget = { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 96000, maxOutputTokens: 16384, maxEstimatedUsd: 1, maxFailures: 2 };
  c.pricing.modelId = MANTLE_MODEL; c.pricing.region = MANTLE_REGION; c.pricing.inferenceProfile = null;
  c.sources = { workspaceRoot: root, casesFile: path.join(root, "unused-cases.json"), claimRegistryConfigFile: path.join(root, "unused-registry.json") };
  return c;
}
function temporary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-mantle-test-"));
  return { root, close() {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("gymini-mantle-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  } };
}
const signal = () => new AbortController().signal;

test("Mantle count and inference share exactly one canonical token-bearing projection", async () => {
  const i = input(), wire = serializeMantle(i), count = JSON.parse(wire.countBody), inference = JSON.parse(wire.inferenceBody);
  assert.deepEqual(count, wire.canonical);
  const { max_tokens, temperature, ...tokenBearing } = inference;
  assert.equal(max_tokens, 2048); assert.equal(temperature, 0.2); assert.deepEqual(tokenBearing, count);
  assert.equal(count.model, MANTLE_MODEL); assert.equal(count.system![0].type, "text");
  assert.equal(count.system![0].text, i.system![0].text); assert.equal(count.messages[0].content[0].text, i.messages![0].content![0].text);
  assert.equal(wire.identity.protocol, "MANTLE_MESSAGES"); assert.equal(wire.identity.modelId, MANTLE_MODEL); assert.equal(wire.identity.region, MANTLE_REGION);
  assert.equal(wire.identity.tokenPayloadHash, createHash("sha256").update(wire.countBody, "utf8").digest("hex"));
  assert.notEqual(wire.identity.countBodyHash, wire.identity.inferenceBodyHash);
  const t = transport(); await t.provider.count(i, signal()); await t.provider.invoke(i, signal());
  assert.equal(t.requests.length, 2); assert.ok(t.requests.every(r => r.method === "POST" && r.url.startsWith("https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages")));
  assert.equal(t.requests[0].url, "https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages/count_tokens");
  assert.equal(t.requests[1].url, "https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages");
  assert.ok(t.requests.every(r => r.headers["anthropic-version"] === "2023-06-01"));
  assert.ok(!t.requests.some(r => /converse|global\.|anthropic_version|bedrock-2023-05-31/.test(JSON.stringify(r))));
});

test("serialization rejects different models and token-bearing features outside the bounded text contract", () => {
  for (const patch of [
    { modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0" },
    { modelId: "anthropic.claude-haiku-4-5-20251001-v1:0" },
    { additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 1024 } } },
    { toolConfig: { tools: [] } },
    { messages: [{ role: "user", content: [{ image: { format: "png", source: { bytes: new Uint8Array([1]) } } }] }] },
    { system: [{ text: "ok", cachePoint: { type: "default" } }] },
    { inferenceConfig: { maxTokens: 2049 } },
    { inferenceConfig: { maxTokens: 2048, temperature: 0.2, topP: 0.9 } },
  ]) assert.throws(() => serializeMantle({ ...input(), ...patch } as ConverseCommandInput), /MANTLE|Mantle/);
});

test("adapter requires explicit FAKE IO and never creates a network transport", () => {
  assert.throws(() => createFakeMantleTransport({ kind: "LIVE", async post() { throw new Error("must not dispatch"); } } as never), /FAKE|Fake|MANTLE/);
});

test("an already aborted request cannot dispatch even to the injected FAKE seam", async () => {
  const controller = new AbortController(); controller.abort(); const t = transport();
  await assert.rejects(t.provider.count(input(), controller.signal), /Aborted/);
  await assert.rejects(t.provider.invoke(input(), controller.signal), /Aborted/);
  assert.equal(t.requests.length, 0);
});

test("count replies fail closed for missing, negative or noninteger input tokens", async () => {
  for (const count of [-1, 1.5, "12"]) {
    const t = transport({ count }); await assert.rejects(t.provider.count(input(), signal()), /MANTLE|Mantle/); assert.equal(t.inferenceCalls, 0); assert.equal(t.requests.length, 1);
  }
  const t = createFakeMantleTransport({ kind: "FAKE", async post() { return { status: 200, body: {} }; } });
  await assert.rejects(t.count(input(), signal()), /MANTLE|Mantle/);
});

test("native response normalization retains the complete provider envelope and usage", async () => {
  const t = transport(), r = await t.provider.invoke(input(), signal());
  assert.equal(r.output!.message!.content![0].text, JSON.stringify(answer()));
  assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  assert.equal(r.stopReason, "end_turn");
  assert.ok(JSON.stringify(r).includes("PRESERVE_THIS_NATIVE_FIELD"));
  assert.ok(JSON.stringify(r).includes("msg-synthetic-mantle"));
});

test("unsupported native stops, blocks, model and usage are rejected without retry", async () => {
  const bad = [
    native("{}", { stop_reason: "max_tokens" }), native("{}", { stop_reason: "refusal" }), native("{}", { stop_reason: "tool_use" }),
    native("{}", { model: "another-model" }), native("{}", { usage: {} }), native("{}", { usage: { input_tokens: 12 } }),
    native("{}", { usage: { input_tokens: 12, output_tokens: -1 } }), native("{}", { usage: { input_tokens: 12, output_tokens: 8, cache_read_input_tokens: 1 } }),
    native("{}", { usage: { input_tokens: 12, output_tokens: 8, cache_creation_input_tokens: 1 } }),
    native("{}", { content: [{ type: "tool_use", id: "tool-fixture", name: "never_run", input: {} }] }),
  ];
  for (const reply of bad) {
    const t = transport({ reply: { status: 200, body: reply } });
    await assert.rejects(t.provider.invoke(input(), signal()), /MANTLE|Mantle/); assert.equal(t.requests.length, 1);
  }
});

test("HTTP/Anthropic error envelopes are not retried or silently converted to text answers", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const t = transport({ reply: { status, body: { type: "error", request_id: "req-fixture", error: { type: "fixture_error", message: "TEST FIXTURE error" } } } });
    await assert.rejects(t.provider.invoke(input(), signal()), /MANTLE|Mantle/); assert.equal(t.requests.length, 1);
  }
});

test("Mantle config cannot fall back to Global/runtime, raise caps, change arms or unlock LIVE", () => {
  const f = temporary();
  try {
    const c = mantleConfig(f.root); assert.doesNotThrow(() => parseConfiguration(c));
    assert.equal(inferenceTarget(c).identifier, MANTLE_MODEL);
    const variants = [
      { ...c, mode: "LIVE", liveOptIn: true }, { ...c, inferenceProfile: "global.anthropic.claude-haiku-4-5-20251001-v1:0" },
      { ...c, region: "ap-southeast-1" }, { ...c, transportProtocol: undefined },
      ...[{ maxCalls: 9 }, { maxInputTokensPerCall: 13000 }, { maxEstimatedUsd: 2 }, { maxFailures: 3 }, { maxInputTokens: 100000 }, { maxOutputTokens: 20000 }].map(b => ({ ...c, budget: { ...c.budget, ...b } })),
      { ...c, parameters: { ...c.parameters, maxTokens: 2049 } }, { ...c, design: { ...c.design, repeats: 3 } },
      { ...c, reviewerMode: "TWO_RATER" },
    ];
    for (const v of variants) assert.throws(() => parseConfiguration(v));
    assert.throws(() => openEvaluationSession(c, path.join(f.root, "wrong-transport"), pilotTransport()), /MANTLE_TRANSPORT_REQUIRED/);
    assert.equal(fs.existsSync(path.join(f.root, "wrong-transport")), false);
  } finally { f.close(); }
});

test("session rejects over-cap count before inference and preserves failed-preflight accounting", async () => {
  const f = temporary(), t = transport({ count: 12001 }); let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(mantleConfig(f.root), path.join(f.root, "run"), t.provider);
    await assert.rejects(session.evaluate(pilotPrompt), /TokenPreflightFailed/);
    assert.equal(t.inferenceCalls, 0); assert.equal(session.state().inferenceCalls, 0); assert.equal(session.state().failures, 1); assert.equal(session.state().stopped, true);
    assert.ok(JSON.stringify(session.records()).includes('"input_tokens":12001'), "over-cap preflight keeps its native count reply");
  } finally { await session?.close(); f.close(); }
});

test("session rejects input usage that differs from its counted payload and retains the reservation", async () => {
  const f = temporary(), t = transport({ reply: { status: 200, body: native(JSON.stringify(answer()), { usage: { input_tokens: 13, output_tokens: 8 } }) } });
  let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(mantleConfig(f.root), path.join(f.root, "mismatch"), t.provider);
    const r = await session.evaluate(pilotPrompt);
    assert.equal(r.providerError, "USAGE_MISMATCH_OR_UNKNOWN"); assert.equal(r.conservativeReservationRetained, true);
    assert.equal(session.state().stopped, true); assert.equal(session.state().outputTokens, 2048); assert.equal(t.inferenceCalls, 1);
    await assert.rejects(session.evaluate(pilotPrompt), /BudgetStopped/); assert.equal(t.inferenceCalls, 1);
  } finally { await session?.close(); f.close(); }
});

test("session reserves USD before dispatch, retains unknown usage and stops ordinary parse failures at two", async () => {
  const f = temporary(); let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    const c = mantleConfig(f.root); c.budget.maxEstimatedUsd = 0.000001;
    const t = transport(); session = openEvaluationSession(c, path.join(f.root, "budget"), t.provider);
    const denied = await session.evaluate(pilotPrompt); assert.equal(denied.providerError, "BUDGET_REJECTED"); assert.equal(t.inferenceCalls, 0); await session.close(); session = undefined;
    const invalid = transport({ reply: { status: 200, body: native("not JSON") } });
    session = openEvaluationSession(mantleConfig(f.root), path.join(f.root, "parse"), invalid.provider);
    const a = await session.evaluate(pilotPrompt), b = await session.evaluate(pilotPrompt);
    assert.equal(a.parseError, "INVALID_JSON"); assert.equal(b.parseError, "INVALID_JSON"); assert.equal(session.state().failures, 2); assert.equal(session.state().stopped, true);
    await assert.rejects(session.evaluate(pilotPrompt), /BudgetStopped/); assert.equal(invalid.inferenceCalls, 2); await session.close(); session = undefined;
    const unknown = transport({ reply: { status: 200, body: native("{}", { usage: {} }) } });
    session = openEvaluationSession(mantleConfig(f.root), path.join(f.root, "unknown"), unknown.provider);
    const u = await session.evaluate(pilotPrompt); assert.ok(u.providerError); assert.equal(u.conservativeReservationRetained, true); assert.equal(session.state().outputTokens, 2048);
    assert.ok(JSON.stringify(session.records()).includes("msg-synthetic-mantle"));
  } finally { await session?.close(); f.close(); }
});

test("session keeps native/raw claim envelopes while redacting secrets before journal persistence", async () => {
  const f = temporary(), value = answer(); value.analysis.rationaleSummary = "Synthetic token=FAKE_TOKEN_987654321";
  const t = transport({ reply: { status: 200, body: native(JSON.stringify(value), { diagnostic: "aws_secret_access_key=FAKE_SECRET_123456789" }), headers: { authorization: "Basic dGVzdDpmYWtlcGFzc3dvcmQ=" } } });
  let session: ReturnType<typeof openEvaluationSession> | undefined;
  try {
    session = openEvaluationSession(mantleConfig(f.root), path.join(f.root, "redaction"), t.provider);
    const r = await session.evaluate(pilotPrompt);
    assert.ok(ClaimAnalysisSchema.safeParse(r.parsedCandidate).success);
    assert.ok(JSON.stringify(r).includes("claimLinks")); assert.ok(JSON.stringify(r).includes("PRESERVE_THIS_NATIVE_FIELD"));
    const persisted = fs.readFileSync(path.join(f.root, "redaction/results.jsonl"), "utf8");
    assert.ok(!/FAKE_TOKEN_987654321|FAKE_SECRET_123456789|dGVzdDpmYWtlcGFzc3dvcmQ=/.test(persisted));
    assert.ok(persisted.includes("[REDACTED]")); assert.ok("representation" in r); assert.equal(r.representation.scoringDisposition, "REDACTED_NOT_SCORED");
  } finally { await session?.close(); f.close(); }
});

async function prepared() {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-mantle-cal01-fixture"), b = fixturePilotInput(claimDevScenarios[1].request, "case-mantle-cal06-fixture");
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const synthetic = syntheticClaimData(), file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(synthetic.input)); fs.writeFileSync(file("map.json"), JSON.stringify(synthetic.map)); fs.writeFileSync(file("owner.json"), synthetic.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: synthetic.pins }));
  const c = mantleConfig(a.root); c.sources = { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") };
  c.pins = (await calculatePilotPins(a.root, a.casesFile, c.design, c.sources)).pins;
  return { ...a, b, config: c };
}
function candidateFor(user: string): ClaimAnalysis {
  const p = JSON.parse(user), knowledge = p.approvedScientificKnowledge[0], refs = knowledge ? p.evidenceProvenance.filter((r: { knowledgeClaimId: string }) => r.knowledgeClaimId === knowledge.id && "excerptId" in r) : [];
  const facts: ClaimContext["personal"]["facts"] = [...p.userFacts.facts, ...p.trainingObservations.facts];
  const observations: ClaimAnalysis["analysis"]["claims"] = facts.map(f => ({ claimType: "OBSERVATION", text: (f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? "e1RM là ước tính; projection: " : "Projection ghi nhận: ") + JSON.stringify(f.evidence.value), factIds: [f.id], evidenceIds: [],
    ...(f.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: f.id, measurement: "ESTIMATED_1RM" as const, baselineKg: Number(f.evidence.value.baselineKg), currentKg: Number(f.evidence.value.currentKg), changePct: Number(f.evidence.value.changePct) } } : {}) }));
  const claimIndex = observations.length, sourceIds = [...new Set<string>(refs.map((r: { sourceId: string }) => r.sourceId))];
  return { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [...observations, ...(knowledge ? [{ claimType: "GENERAL_PRINCIPLE" as const, text: knowledge.displayTextVi, factIds: [], evidenceIds: sourceIds }] : [])], missingInformation: [{ key: "other", question: "Có thêm dữ liệu theo cùng protocol không?" }], rationaleSummary: "Cần thêm dữ liệu để xác nhận kết quả cá nhân.", proposedAction: null },
    sourceLinks: sourceIds.map(sourceId => ({ claimIndex, sourceId, excerptIds: refs.filter((r: { sourceId: string }) => r.sourceId === sourceId).map((r: { excerptId: string }) => r.excerptId) })),
    claimLinks: knowledge ? [{ claimIndex, knowledgeClaimId: knowledge.id, knowledgeClaimHash: knowledge.claimHash }] : [] };
}

test("eight synthetic Mantle calls retain E2 grounding/full envelopes and sealed R1 receipts; completed resume adds no calls", async () => {
  const f = await prepared(), t = transport({ infer(request) {
    const wire = JSON.parse(request.body); return { status: 200, body: native(JSON.stringify(candidateFor(wire.messages[0].content[0].text))) };
  } }), directory = path.join(f.root, "mantle-run");
  const summary = await runControlledPilot({ config: f.config, directory, transport: t.provider });
  assert.equal(t.inferenceCalls, 8); assert.equal(summary.denominators.failed, 0); assert.equal(summary.denominators.blocked, 0); assert.equal(summary.denominators.postGateEligible, 8);
  assert.equal(summary.actualBedrockCalls, 0); assert.equal(summary.reviewAuthority, "EXPLORATORY_OWNER_REVIEWED"); assert.equal(summary.scientificPass, null);
  const records = fs.readdirSync(directory).filter(n => n.startsWith("answer-")).map(n => JSON.parse(fs.readFileSync(path.join(directory, n), "utf8")));
  assert.equal(records.length, 8); assert.ok(records.some(r => r.raw.parsedCandidate.claimLinks.length));
  for (const r of records) {
    assert.ok(ClaimAnalysisSchema.safeParse(r.raw.parsedCandidate).success); assert.deepEqual(r.claimRepresentation, projectClaimAnalysis(r.raw.parsedCandidate));
    assert.equal(r.candidateHash, digest(r.raw.parsedCandidate)); assert.ok(JSON.stringify(r.raw).includes("msg-synthetic-mantle"));
    for (const packet of r.packets.reviewers) validatePacketContract(packet);
    const packet = r.packets.reviewers[0], exported = JSON.parse(fs.readFileSync(path.join(directory + "-reviewers/R1", packet.body.instanceId + ".json"), "utf8"));
    verifyReviewerExport(exported, packet.reviewerExportHashes.R1);
    assert.ok(!/claimContext|claimLinks|fixture_native_metadata|msg-synthetic-mantle|LAYERED_CONTEXT|PRIVATE_GOLD_FIXTURE/.test(JSON.stringify(exported)));
  }
  assert.equal(fs.existsSync(directory + "-reviewers/R2"), false);
  const countBodies = t.requests.filter(r => r.url.endsWith("/count_tokens")).map(r => JSON.parse(r.body));
  for (const request of t.requests.filter(r => !r.url.endsWith("/count_tokens"))) {
    const { max_tokens, temperature, ...bearing } = JSON.parse(request.body); assert.equal(max_tokens, 2048); assert.equal(temperature, 0.2);
    assert.ok(countBodies.some(c => digest(c) === digest(bearing))); assert.ok(!request.body.includes("PRIVATE_GOLD_FIXTURE"));
  }
  const resumed = await runControlledPilot({ config: f.config, directory, transport: t.provider, resume: true }); assert.deepEqual(resumed, summary); assert.equal(t.inferenceCalls, 8);
});
