/**
 * TEST FIXTURE only. Two-phase Nova LIVE (owner decision E3_NOVA_V4_1_TWO_PHASE_OPTION_A): a measure-only run, then the
 * inference phase admitted only by an owner-signed inference release. Fixture Ed25519 keys, FAKE_TEST_ONLY ledger issues in
 * a temp directory and a fixture send through the LIVE rehearsal path; no AWS request, no installed trust root, no owner key.
 * LIVE pins require a clean checkout of the executing code, so the rehearsal cases run only in a clean checkout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { BedrockRuntimeClient, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { approvedConfigurationHash, NOVA_ACCEPTED, NOVA_TWO_PHASE, parseConfiguration, PilotError, type SessionConfig } from "../evaluation/bedrock-pilot/config";
import { inferenceReleaseFile, measurementPhaseRecord, novaLedgerScope, verifyInferenceRelease } from "../evaluation/bedrock-pilot/ledger";
import { converseInput } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins, implementationRoot } from "../evaluation/bedrock-pilot/pins";
import { NOVA_MODEL, NOVA_REGION, serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { createNovaRuntimeClient, novaRuntimeSend, type NovaSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import type { NovaCredentialFixture } from "../evaluation/bedrock-pilot/nova-credentials";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { verifyReviewerExport } from "../evaluation/evaluation-kit/reviewer-export";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";

const keys = generateKeyPairSync("ed25519"), otherKeys = generateKeyPairSync("ed25519");
const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
const hour = 3600 * 1000, ISSUER = "fixture-issuer";
const answer = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [],
  rationaleSummary: "Synthetic two-phase fixture, no scientific conclusion.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
const A = "case-two-phase-cal01", B = "case-two-phase-cal06", CTX = "LAYERED_CONTEXT", RAG = "LAYERED_CONTEXT_RAG";
const OWNER_ORDER = [`${A}/${CTX}`, `${B}/${RAG}`, `${A}/${RAG}`, `${B}/${CTX}`, `${B}/${CTX}`, `${A}/${RAG}`, `${B}/${RAG}`, `${A}/${CTX}`];
const clean = !execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: implementationRoot, encoding: "utf8", windowsHide: true }).trim();
const needsClean = { skip: clean ? false : "LIVE pins require a clean checkout of the executing code; run in a clean checkout" };

function signApproval(c: SessionConfig, expiresAt = new Date(Date.now() + hour).toISOString()) {
  const body = { approvalId: randomUUID(), issuer: ISSUER, approvedBy: "TEST FIXTURE owner", scope: "BEDROCK_EVALUATION_PILOT" as const, configHash: approvedConfigurationHash(c), expiresAt };
  return { ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") };
}
const signed = (c: SessionConfig, expiresAt?: string) => { const x: SessionConfig = structuredClone({ ...c, approval: null }); x.approval = signApproval(x, expiresAt); return x; };
function output(text: string, inputTokens: number, outputTokens: number, stopReason: string): ConverseCommandOutput {
  return { $metadata: { httpStatusCode: 200, requestId: "req-two-phase" }, output: { message: { role: "assistant", content: [{ text }] } }, stopReason,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, metrics: { latencyMs: 3 } } as ConverseCommandOutput;
}
const tokensOf = (i: ConverseCommandInput) => Math.ceil(Buffer.byteLength(JSON.stringify(serializeNova(i).canonical), "utf8") / 4);

async function fixture(options: { phases?: boolean; budget?: Partial<SessionConfig["budget"]>;
  sdk?: { credentials?: () => Promise<void>; signing?: () => Promise<void> }; credentialAdmission?: boolean } = {}) {
  const a = fixturePilotInput(claimDevScenarios[0].request, A), b = fixturePilotInput(claimDevScenarios[1].request, B);
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const synthetic = syntheticClaimData(), file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(synthetic.input)); fs.writeFileSync(file("map.json"), JSON.stringify(synthetic.map)); fs.writeFileSync(file("owner.json"), synthetic.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: synthetic.pins }));
  const c = pilotConfig();
  Object.assign(c, { mode: "LIVE", liveOptIn: true, profileModelConfirmed: true, transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null,
    outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion: "CLAIM_PROMPT_V4_1", design: { arms: [CTX, RAG], policies: ["MINIMAL"], repeats: 2 },
    budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2, ...options.budget },
    sources: { workspaceRoot: implementationRoot, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") } });
  // This suite expires authorization independently of pricing; do not change the shared pilot fixture.
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner", expiresAt: new Date(Date.now() + 24 * hour).toISOString() });
  const p = await calculatePilotPins(implementationRoot, a.casesFile, c.design, c.sources, c.promptVersion); c.pins = p.pins;
  c.novaScope = { tokenPayloadHashes: [...new Set(p.preparation.rows.map(r => serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash))], measureCalls: 4, inferenceCalls: 8,
    awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED }, ...(options.phases === false ? {} : { phases: NOVA_TWO_PHASE }) };
  const label = new Map(p.preparation.rows.map(r => [serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash, `${r.caseKey}/${r.arm}`]));
  const ledger = path.join(a.root, "ledger"); fs.mkdirSync(ledger);
  const trust = { version: "owner-trust-v1", issuer: ISSUER, publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
  const sent: ConverseCommandInput[] = [];
  const httpRequests: ConverseCommandInput[] = [], clients: BedrockRuntimeClient[] = [], sdkSends = new Map<string, NovaSend>();
  let reply = (i: ConverseCommandInput): ConverseCommandOutput => i.inferenceConfig!.maxTokens === 1 ? output("{", tokensOf(i), 1, "max_tokens") : output(answer, tokensOf(i), 40, "end_turn");
  const send: NovaSend = async (i, signal, authority) => {
    sent.push(structuredClone(i));
    if (!options.sdk) return reply(i);
    assert.ok(authority, "actual session must provide its reservation-bound HTTP authorization");
    const binding = digest(authority.binding);
    if (!sdkSends.has(binding)) {
      const client = new BedrockRuntimeClient({ region: NOVA_REGION, maxAttempts: 1,
        credentials: async () => { await options.sdk!.credentials?.(); return { accessKeyId: "TESTFIXTUREACCESSKEY", secretAccessKey: "TEST_FIXTURE_NOT_REAL" }; },
        requestHandler: { async handle(request: any) {
          const raw = typeof request.body === "string" ? request.body : Buffer.from(request.body.buffer, request.body.byteOffset, request.body.byteLength).toString("utf8");
          const input = { modelId: NOVA_MODEL, ...JSON.parse(raw) } as ConverseCommandInput;
          httpRequests.push(structuredClone(input));
          const { $metadata: _metadata, ...body } = reply(input);
          return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) } };
        }, destroy() {} } });
      if (options.sdk.signing) {
        const config = client.config as any;
        config.httpAuthSchemes = config.httpAuthSchemes.map((scheme: any) => ({ ...scheme, signer: { ...scheme.signer,
          async sign(...args: any[]) { const signed = await scheme.signer.sign(...args); await options.sdk!.signing!(); return signed; },
        } }));
      }
      clients.push(client); sdkSends.set(binding, novaRuntimeSend(client, authority.binding));
    }
    return sdkSends.get(binding)!(i, signal, authority);
  };
  const issue = (x: SessionConfig) => openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl"), true)
    .append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), scope: novaLedgerScope(x) });
  const records = (x: SessionConfig) => openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl")).records as { event: string }[];
  const credentialCalls: { ledgerEvents: string[]; at: number }[] = [];
  let activeConfig: SessionConfig, credentialHook = () => {};
  const credentialFixture: NovaCredentialFixture = { metadataDisabled: "true", loadFiles: async () => ({
    configFile: { "gymini-fixture-profile": { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "fixture-source" } },
    credentialsFile: { "fixture-source": { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } },
  }), assumeRole: async () => { credentialCalls.push({ ledgerEvents: records(activeConfig).map(r => r.event), at: Date.now() }); await Promise.resolve(); credentialHook();
    return { accessKeyId: "TESTFIXTUREACCESSKEY", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 2 * hour) }; } };
  const resolvedSend: NonNullable<import("../evaluation/bedrock-pilot/session").LiveRehearsal["resolvedSend"]> = (credentials, binding) => {
    const client = createNovaRuntimeClient("gymini-fixture-profile", credentials); clients.push(client);
    client.config.requestHandler = { async handle(request: any) {
      const body = typeof request.body === "string" ? request.body : Buffer.from(request.body.buffer, request.body.byteOffset, request.body.byteLength).toString("utf8");
      const i = { modelId: NOVA_MODEL, ...JSON.parse(body) } as ConverseCommandInput; httpRequests.push(i);
      const { $metadata: _, ...result } = reply(i);
      return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(result)) } };
    }, updateHttpClientConfig() {}, httpHandlerConfigs() { return {}; } };
    const sender = novaRuntimeSend(client, binding); return async (i, signal, authority) => { sent.push(i); return sender(i, signal, authority); };
  };
  /** The owner's inference release (fixture key), bound to the recorded measurement phase; `patch` builds invalid ones. */
  const release = (x: SessionConfig, patch: Record<string, unknown> = {}, key: KeyObject = keys.privateKey) => {
    const m = measurementPhaseRecord(ledger, x.approval!.approvalId)!;
    const body = { version: "nova-inference-release-v1", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), issuer: ISSUER,
      releasedBy: "TEST FIXTURE owner", measurementRecordHash: m.hash, measuredCounts: m.state.counts, expiresAt: x.approval!.expiresAt, ...patch };
    const f = inferenceReleaseFile(ledger, x.approval!.approvalId); if (fs.existsSync(f)) fs.unlinkSync(f);
    fs.writeFileSync(f, JSON.stringify({ ...body, signature: sign(null, Buffer.from(canonical(body)), key).toString("base64") }));
  };
  const run = (x: SessionConfig, dir: string, o: { measureOnly?: boolean; resume?: boolean; onStage?: (s: string) => void } = {}) => {
    activeConfig = x;
    return runControlledPilot({ config: x, directory: dir, liveRehearsal: { trust, send, ...(options.credentialAdmission ? { credentialFixture, resolvedSend } : {}) }, measureOnly: o.measureOnly, resume: o.resume, onStage: o.onStage as never });
  };
  const inferences = () => sent.filter(i => i.inferenceConfig!.maxTokens !== 1), measures = () => sent.filter(i => i.inferenceConfig!.maxTokens === 1);
  return { root: a.root, base: c, ledger, sent, httpRequests, issue, records, release, run, inferences, measures, label, credentialCalls, credentialFixture, setCredentialHook: (hook: () => void) => { credentialHook = hook; }, setReply: (r: typeof reply) => { reply = r; },
    close: () => { for (const client of clients) client.destroy(); fs.rmSync(a.root, { recursive: true, force: true }); } };
}

test("config: two-phase is a LIVE-only signed scope field; historical scopes and ledger scopes have no phases key", async () => {
  const c = pilotConfig();
  assert.throws(() => parseConfiguration({ ...c, transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY",
    promptVersion: "CLAIM_PROMPT_V4_1", design: { arms: [CTX, RAG], policies: ["MINIMAL"], repeats: 2 }, budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    pricing: { ...c.pricing, modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null }, sources: { workspaceRoot: implementationRoot, casesFile: path.join(implementationRoot, "c.json"), claimRegistryConfigFile: path.join(implementationRoot, "r.json") },
    novaScope: { tokenPayloadHashes: ["1", "2", "3", "4"].map(d => d.repeat(64)), measureCalls: 4, inferenceCalls: 8, awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED }, phases: NOVA_TWO_PHASE } }), /NOVA_TWO_PHASE_LIVE_ONLY/);
  const f = await fixture({ phases: false });
  try { assert.equal("phases" in novaLedgerScope(signed(f.base)), false); assert.equal(novaLedgerScope(signed({ ...f.base, novaScope: { ...f.base.novaScope!, phases: NOVA_TWO_PHASE } })).phases, NOVA_TWO_PHASE); }
  finally { f.close(); }
});

test("measure-only: 4 billed measurements, 0 inference, a durable ledger phase record and report; repeating it sends nothing", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    const dir = path.join(f.root, "run"), report = await f.run(c, dir, { measureOnly: true });
    assert.equal(f.measures().length, 4); assert.equal(f.inferences().length, 0);
    assert.equal(report.status, "MEASURED_AWAITING_OWNER_INFERENCE_RELEASE"); assert.equal(report.measurements.length, 4);
    assert.ok(report.measurements.every((m: { withinCap: boolean; inputTokens: number }) => m.withinCap && m.inputTokens > 0));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "measurement-report.json"), "utf8")), report);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false, "no run summary: the run is not finished");
    const phase = measurementPhaseRecord(f.ledger, c.approval!.approvalId)!;
    assert.equal(phase.hash, report.ledgerRecordHash); assert.equal(phase.state.inferenceCalls, 0); assert.equal(phase.state.countCalls, 4);
    assert.equal(f.records(c).filter(r => r.event === "MEASUREMENT_PHASE_COMPLETED").length, 1);
    const again = await f.run(c, dir, { measureOnly: true, resume: true });
    assert.deepEqual(again, report); assert.equal(f.sent.length, 4, "no new measurement");
    assert.equal(f.records(c).filter(r => r.event === "MEASUREMENT_PHASE_COMPLETED").length, 1, "phase record is not duplicated");
  } finally { f.close(); }
});

test("owner boundary: no release → inference refused before anything is sent or resumed; a valid release admits 8 inferences in the owner order with 0 new measurements; flags alone grant nothing", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    await assert.rejects(f.run(c, path.join(f.root, "one-shot")), /TWO_PHASE_STARTS_WITH_MEASURE_ONLY/);
    assert.equal(f.records(c).length, 1, "not claimed"); assert.equal(f.sent.length, 0);
    const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true });
    const before = f.records(c).length;
    await assert.rejects(f.run(c, dir, { resume: true }), /INFERENCE_RELEASE_REQUIRED/);
    assert.equal(f.records(c).length, before, "no RESUMED record"); assert.equal(f.inferences().length, 0);
    f.release(c, {}, otherKeys.privateKey);
    await assert.rejects(f.run(c, dir, { resume: true }), /INFERENCE_RELEASE_SIGNATURE_INVALID/, "end-to-end: a release from another key");
    assert.equal(f.records(c).length, before); assert.equal(f.inferences().length, 0);
    f.release(c);
    const summary = await f.run(c, dir, { resume: true });
    assert.equal(f.measures().length, 4, "measurements are reused from the ledger"); assert.equal(f.inferences().length, 8);
    assert.deepEqual(f.inferences().map(i => f.label.get(serializeNova(i).identity.tokenPayloadHash)), OWNER_ORDER);
    assert.equal(summary.status, "LIVE_REHEARSAL_FIXTURE_COMPLETED_REVIEW_ONLY"); assert.equal(summary.budget.countCalls, 4); assert.equal(summary.budget.inferenceCalls, 8); assert.equal(summary.scientificPass, null);
    assert.deepEqual(fs.readdirSync(f.ledger).filter(n => n.endsWith(".jsonl")), [c.approval!.approvalId + ".jsonl"], "one ledger");
    assert.deepEqual(await f.run(c, dir, { resume: true }), summary); assert.equal(f.sent.length, 12, "completed run resumes to its stored summary");
    await assert.rejects(f.run(c, path.join(f.root, "elsewhere"), { resume: true }), /APPROVAL_ALREADY_USED|RESUME_MANIFEST|ENOENT/);
    assert.equal(f.sent.length, 12);
    // --measure-only on a one-shot (historical) scope is refused before anything is claimed.
    const g = await fixture({ phases: false });
    try { const o = signed(g.base); g.issue(o); await assert.rejects(g.run(o, path.join(g.root, "run"), { measureOnly: true }), /MEASURE_ONLY_REQUIRES_TWO_PHASE_SCOPE/); assert.equal(g.records(o).length, 1); assert.equal(g.sent.length, 0); }
    finally { g.close(); }
  } finally { f.close(); }
});

test("release verification refuses every mismatch (key, issuer, counts, record, binding, expiry, lifetime, shape)", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    await f.run(c, path.join(f.root, "run"), { measureOnly: true });
    const m = measurementPhaseRecord(f.ledger, c.approval!.approvalId)!, firstHash = Object.keys(m.state.counts)[0], file = inferenceReleaseFile(f.ledger, c.approval!.approvalId);
    const check = (patch: Record<string, unknown>, key?: KeyObject) => { f.release(c, patch, key); return () => verifyInferenceRelease({ release: JSON.parse(fs.readFileSync(file, "utf8")), trust: { issuer: ISSUER, publicKeyPem: pem(keys.publicKey) }, approval: c.approval!, configHash: approvedConfigurationHash(c), measurement: m }); };
    assert.equal(check({})().measurementRecordHash, m.hash, "the valid release verifies");
    const cases: [string, Record<string, unknown>, RegExp, KeyObject?][] = [
      ["another key", {}, /INFERENCE_RELEASE_SIGNATURE_INVALID/, otherKeys.privateKey],
      ["another issuer", { issuer: "someone-else" }, /INFERENCE_RELEASE_SIGNATURE_INVALID/],
      ["tampered count", { measuredCounts: { ...m.state.counts, [firstHash]: m.state.counts[firstHash] + 1 } }, /INFERENCE_RELEASE_MEASUREMENT_MISMATCH/],
      ["missing count", { measuredCounts: Object.fromEntries(Object.entries(m.state.counts).slice(1)) }, /INFERENCE_RELEASE_MEASUREMENT_MISMATCH/],
      ["other measurement row", { measurementRecordHash: "a".repeat(64) }, /INFERENCE_RELEASE_MEASUREMENT_MISMATCH/],
      ["other approval", { approvalId: randomUUID() }, /INFERENCE_RELEASE_BINDING_MISMATCH/],
      ["other approval hash", { approvalHash: "b".repeat(64) }, /INFERENCE_RELEASE_BINDING_MISMATCH/],
      ["other config", { configHash: "c".repeat(64) }, /INFERENCE_RELEASE_BINDING_MISMATCH/],
      ["expired", { expiresAt: new Date(Date.now() - 1000).toISOString() }, /INFERENCE_RELEASE_EXPIRED/],
      ["outlives the approval", { expiresAt: new Date(Date.parse(c.approval!.expiresAt) + 60000).toISOString() }, /INFERENCE_RELEASE_OUTLIVES_APPROVAL/],
      ["extra field", { note: "x" }, /INFERENCE_RELEASE_INVALID/],
    ];
    for (const [name, patch, code, key] of cases) assert.throws(check(patch, key), code, name);
    assert.throws(() => verifyInferenceRelease({ release: {}, trust: { issuer: ISSUER, publicKeyPem: pem(keys.publicKey) }, approval: c.approval!, configHash: approvedConfigurationHash(c), measurement: m }), /INFERENCE_RELEASE_INVALID/);
    assert.equal(f.inferences().length, 0);
  } finally { f.close(); }
});

test("crash/resume never duplicates: an interrupted measurement phase and an interrupted inference phase resume without re-sending", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    const dir = path.join(f.root, "run");
    await assert.rejects(f.run(c, dir, { measureOnly: true, onStage: (s) => { if (s === "PREVIEWED") throw new Error("TEST CRASH after measurements"); } }), /TEST CRASH/);
    assert.equal(f.measures().length, 4); assert.equal(measurementPhaseRecord(f.ledger, c.approval!.approvalId), null, "phase not closed by a crash");
    await f.run(c, dir, { measureOnly: true, resume: true }); assert.equal(f.measures().length, 4, "no measurement re-sent");
    f.release(c);
    let n = 0;
    await assert.rejects(f.run(c, dir, { resume: true, onStage: (s) => { if (s === "PERSISTED" && ++n === 3) throw new Error("TEST CRASH mid inference"); } }), /TEST CRASH/);
    assert.equal(f.inferences().length, 3);
    const summary = await f.run(c, dir, { resume: true });
    assert.equal(f.inferences().length, 8, "remaining 5 only");
    assert.deepEqual(f.inferences().map(i => f.label.get(serializeNova(i).identity.tokenPayloadHash)), OWNER_ORDER, "each scheduled row sent exactly once, in order");
    assert.equal(summary.budget.inferenceCalls, 8); assert.equal(f.measures().length, 4);
    const reviewerDir = path.join(dir + "-reviewers", "R1");
    const receipts = fs.readdirSync(reviewerDir).filter(n => n.endsWith(".json"));
    assert.equal(receipts.length, 8, "crash/resume preserves exactly eight reviewer exports");
    const receiptPins = new Map<string, string>();
    for (const file of fs.readdirSync(dir).filter(n => n.startsWith("answer-") && n.endsWith(".json"))) {
      const stored = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const p of stored.packets.reviewers) if (p.reviewerSlot === "R1") receiptPins.set(p.body.instanceId, p.reviewerExportHashes.R1);
    }
    for (const file of receipts) { const exported = JSON.parse(fs.readFileSync(path.join(reviewerDir, file), "utf8")); verifyReviewerExport(exported, receiptPins.get(exported.opaqueId)!); }
  } finally { f.close(); }
});

test("fail closed: a measurement above 12,000 input tokens closes nothing and the run cannot continue", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    f.setReply(() => output("{", 12001, 1, "max_tokens"));
    const dir = path.join(f.root, "run");
    await assert.rejects(f.run(c, dir, { measureOnly: true }), /TokenPreflightFailed/);
    assert.equal(f.measures().length, 1); assert.equal(measurementPhaseRecord(f.ledger, c.approval!.approvalId), null);
    await assert.rejects(f.run(c, dir, { measureOnly: true, resume: true }), /BudgetStopped|TokenPreflightFailed|UNRESOLVED_MEASUREMENT/);
    assert.equal(f.sent.length, 1);
  } finally { f.close(); }
});

test("fail closed in the inference phase: token parity mismatch stops; two failures stop; budget below the reservation stops measuring", needsClean, async () => {
  const mismatch = await fixture();
  try {
    const c = signed(mismatch.base); mismatch.issue(c); const dir = path.join(mismatch.root, "run");
    await mismatch.run(c, dir, { measureOnly: true }); mismatch.release(c);
    mismatch.setReply(i => i.inferenceConfig!.maxTokens === 1 ? output("{", tokensOf(i), 1, "max_tokens") : output(answer, tokensOf(i) + 1, 40, "end_turn"));
    const s = await mismatch.run(c, dir, { resume: true });
    assert.equal(s.status, "STOPPED"); assert.equal(mismatch.inferences().length, 1, "stops after the first mismatch");
  } finally { mismatch.close(); }
  const failing = await fixture();
  try {
    const c = signed(failing.base); failing.issue(c); const dir = path.join(failing.root, "run");
    await failing.run(c, dir, { measureOnly: true }); failing.release(c);
    failing.setReply(i => i.inferenceConfig!.maxTokens === 1 ? output("{", tokensOf(i), 1, "max_tokens") : output("not json", tokensOf(i), 5, "end_turn"));
    const s = await failing.run(c, dir, { resume: true });
    assert.equal(s.status, "STOPPED"); assert.equal(s.budget.failures, 2); assert.equal(failing.inferences().length, 2);
    assert.deepEqual(await failing.run(c, dir, { resume: true }), s); assert.equal(failing.inferences().length, 2);
  } finally { failing.close(); }
  const tight = await fixture({ budget: { maxInputTokens: 12500 } });
  try {
    const c = signed(tight.base); tight.issue(c);
    await assert.rejects(tight.run(c, path.join(tight.root, "run"), { measureOnly: true }), /TokenPreflightFailed/);
    assert.equal(tight.inferences().length, 0); assert.ok(tight.measures().length < 4);
  } finally { tight.close(); }
});

test("approval expiry ends both phases: after the approval expires the inference phase is refused", needsClean, async () => {
  const original = Date.now; let now = original(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c);
    const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true }); f.release(c);
    now = Date.parse(c.approval!.expiresAt) + 1;
    assert.ok(Date.parse(c.pricing.expiresAt) > now);
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && ["LiveNotApproved", "INFERENCE_RELEASE_EXPIRED"].includes(e.code));
    assert.equal(f.inferences().length, 0);
  } finally { Date.now = original; f.close(); }
});

test("dispatch boundary: approval expiring after a measurement reservation sends no request", needsClean, async () => {
  const originalNow = Date.now, originalWrite = fs.writeFileSync; let now = originalNow(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); let reservations = 0;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      originalWrite(...args);
      if (typeof args[1] === "string" && args[1].includes('"event":"MEASURE_RESERVED"')) {
        const { record } = JSON.parse(args[1]);
        if (record?.event === "MEASURE_RESERVED" && record.state) { reservations++; now = Date.parse(c.approval!.expiresAt) + 1; }
      }
    }) as typeof fs.writeFileSync;
    await assert.rejects(f.run(c, dir, { measureOnly: true }), e => e instanceof PilotError && e.code === "TokenPreflightFailed");
    assert.equal(reservations, 1); assert.ok(Date.parse(c.pricing.expiresAt) > now);
    assert.equal(f.sent.length, 0, "approval checked after durable reservation, before measurement send");
    const results = openJournal(path.join(dir, "results.jsonl")).records as { event: string; category?: string }[];
    assert.ok(results.some(r => r.event === "TOKEN_PREFLIGHT_FAILED" && r.category === "LiveNotApproved"), "measurement fails for authorization, not pricing");
    const records = openJournal(path.join(f.ledger, c.approval!.approvalId + ".jsonl")).records as { event: string; state?: { countCalls: number; stopped: boolean } }[];
    assert.ok(records.some(r => r.event === "COUNT_FAILED" && r.state?.stopped));
    assert.equal(measurementPhaseRecord(f.ledger, c.approval!.approvalId), null);
    await assert.rejects(f.run(c, dir, { measureOnly: true, resume: true }), e => e instanceof PilotError && e.code === "LiveNotApproved");
    assert.equal(f.sent.length, 0);
  } finally { fs.writeFileSync = originalWrite; Date.now = originalNow; f.close(); }
});

test("dispatch boundary: separate release expiry after inference reservation blocks dispatch and survives resume", needsClean, async () => {
  const originalNow = Date.now, originalWrite = fs.writeFileSync; let now = originalNow(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true });
    const expiresAt = new Date(now + 60000).toISOString(); f.release(c, { expiresAt }); let reservations = 0;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      originalWrite(...args);
      if (typeof args[1] === "string" && args[1].includes('"event":"INFERENCE_RESERVED"')) {
        const { record } = JSON.parse(args[1]);
        if (record?.event === "INFERENCE_RESERVED" && record.state) { reservations++; now = Date.parse(expiresAt) + 1; }
      }
    }) as typeof fs.writeFileSync;
    await assert.rejects(f.run(c, dir, { resume: true }), /INFERENCE_RELEASE_EXPIRED/);
    fs.writeFileSync = originalWrite;
    assert.equal(reservations, 1); assert.equal(f.measures().length, 4); assert.equal(f.inferences().length, 0);
    const records = openJournal(path.join(dir, "results.jsonl")).records as { event: string; providerError?: string; conservativeReservationRetained?: boolean }[];
    assert.ok(records.some(r => r.event === "ATTEMPT_FINISHED" && r.providerError === "INFERENCE_RELEASE_EXPIRED" && r.conservativeReservationRetained));
    const before = f.records(c).length;
    await assert.rejects(f.run(c, dir, { resume: true }), /INFERENCE_RELEASE_EXPIRED/);
    assert.equal(f.records(c).length, before, "expired release cannot create a new RESUMED record"); assert.equal(f.sent.length, 4);
  } finally { fs.writeFileSync = originalWrite; Date.now = originalNow; f.close(); }
});

test("approval expiring between inferences blocks every subsequent dispatch without remeasurement", needsClean, async () => {
  const original = Date.now; let now = original(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true }); f.release(c);
    let persisted = false;
    await assert.rejects(f.run(c, dir, { resume: true, onStage: s => { if (s === "PERSISTED") { persisted = true; now = Date.parse(c.approval!.expiresAt) + 1; } } }), e => e instanceof PilotError && ["LiveNotApproved", "INFERENCE_RELEASE_EXPIRED"].includes(e.code));
    assert.equal(persisted, true); assert.equal(f.inferences().length, 1); assert.equal(f.measures().length, 4);
    assert.ok(Date.parse(c.pricing.expiresAt) > now);
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && ["LiveNotApproved", "INFERENCE_RELEASE_EXPIRED"].includes(e.code));
    assert.equal(f.inferences().length, 1);
  } finally { Date.now = original; f.close(); }
});

test("two-phase inference cache usage fails closed with no retry or remeasurement", needsClean, async () => {
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true }); f.release(c);
    f.setReply(i => ({ ...output(answer, tokensOf(i), 40, "end_turn"), usage: { inputTokens: tokensOf(i), outputTokens: 40, totalTokens: tokensOf(i) + 40, cacheReadInputTokens: 1 } }));
    const summary = await f.run(c, dir, { resume: true });
    assert.equal(summary.status, "STOPPED"); assert.equal(f.inferences().length, 1); assert.equal(f.measures().length, 4);
    assert.deepEqual(await f.run(c, dir, { resume: true }), summary); assert.equal(f.inferences().length, 1);
  } finally { f.close(); }
});

test("one-shot LIVE is unchanged: no phases key, no release needed, and a used approval still cannot be resumed", needsClean, async () => {
  const f = await fixture({ phases: false });
  try {
    const c = signed(f.base); f.issue(c);
    const dir = path.join(f.root, "run"), summary = await f.run(c, dir);
    assert.equal(f.measures().length, 4); assert.equal(f.inferences().length, 8); assert.equal(summary.status, "LIVE_REHEARSAL_FIXTURE_COMPLETED_REVIEW_ONLY");
    await assert.rejects(f.run(c, dir, { resume: true }), /APPROVAL_ALREADY_USED/);
    assert.equal(f.sent.length, 12);
  } finally { f.close(); }
});

test("HTTP boundary signed rehearsal: actual session reservations admit 4 measurements, durable stop, separate release and 8 inferences without duplicates", needsClean, async () => {
  const f = await fixture({ sdk: {} });
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run");
    await f.run(c, dir, { measureOnly: true }); assert.equal(f.httpRequests.length, 4);
    const before = f.records(c).length;
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && e.code === "INFERENCE_RELEASE_REQUIRED");
    assert.equal(f.httpRequests.length, 4); assert.equal(f.records(c).length, before);
    f.release(c); const summary = await f.run(c, dir, { resume: true });
    assert.equal(f.httpRequests.length, 12); assert.equal(summary.budget.countCalls, 4); assert.equal(summary.budget.inferenceCalls, 8);
    assert.equal(summary.scientificPass, null);
    assert.deepEqual(f.httpRequests.filter(i => i.inferenceConfig!.maxTokens !== 1).map(i => f.label.get(serializeNova(i).identity.tokenPayloadHash)), OWNER_ORDER);
    const reviewerDir = path.join(dir + "-reviewers", "R1"), receiptPins = new Map<string, string>();
    for (const file of fs.readdirSync(dir).filter(n => n.startsWith("answer-") && n.endsWith(".json"))) {
      const stored = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const packet of stored.packets.reviewers) if (packet.reviewerSlot === "R1") receiptPins.set(packet.body.instanceId, packet.reviewerExportHashes.R1);
    }
    const receipts = fs.readdirSync(reviewerDir).filter(n => n.endsWith(".json")); assert.equal(receipts.length, 8);
    for (const file of receipts) { const exported = JSON.parse(fs.readFileSync(path.join(reviewerDir, file), "utf8")); verifyReviewerExport(exported, receiptPins.get(exported.opaqueId)!); }
    assert.deepEqual(await f.run(c, dir, { resume: true }), summary); assert.equal(f.httpRequests.length, 12);
  } finally { f.close(); }
});

test("HTTP boundary measurement: approval expiring in actual SDK credentials consumes one reservation, records authorization failure and sends zero HTTP", needsClean, async () => {
  const original = Date.now; let now = original(), expires = Infinity; Date.now = () => now;
  const f = await fixture({ sdk: { credentials: async () => { await Promise.resolve(); now = expires + 1; } } });
  try {
    const c = signed(f.base); expires = Date.parse(c.approval!.expiresAt); f.issue(c); const dir = path.join(f.root, "run");
    await assert.rejects(f.run(c, dir, { measureOnly: true }), e => e instanceof PilotError && e.code === "TokenPreflightFailed");
    assert.equal(f.httpRequests.length, 0); assert.equal(f.sent.length, 1);
    const results = openJournal(path.join(dir, "results.jsonl")).records as { event: string; category?: string }[];
    assert.ok(results.some(r => r.event === "TOKEN_PREFLIGHT_FAILED" && r.category === "LiveNotApproved"));
    assert.ok(!results.some(r => r.event === "COUNT_RESPONSE" || r.event === "RAW_RESPONSE"));
    const ledger = openJournal(path.join(f.ledger, c.approval!.approvalId + ".jsonl")).records as { event: string; state?: { countCalls: number; inputTokens: number; stopped: boolean } }[];
    assert.equal(ledger.filter(r => r.event === "MEASURE_RESERVED" && r.state).length, 1);
    const failed = ledger.find(r => r.event === "COUNT_FAILED")!; assert.equal(failed.state!.countCalls, 1); assert.equal(failed.state!.inputTokens, 12000); assert.equal(failed.state!.stopped, true);
    await assert.rejects(f.run(c, dir, { measureOnly: true, resume: true }), e => e instanceof PilotError && e.code === "LiveNotApproved"); assert.equal(f.httpRequests.length, 0);
  } finally { Date.now = original; f.close(); }
});

test("HTTP boundary inference: release expiring in actual signing preserves the attempt reservation, records no success and expired resume cannot dispatch", needsClean, async () => {
  const original = Date.now; let now = original(), enabled = false, expires = Infinity; Date.now = () => now;
  const f = await fixture({ sdk: { signing: async () => { await Promise.resolve(); if (enabled) now = expires + 1; } } });
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true });
    expires = now + 60000; f.release(c, { expiresAt: new Date(expires).toISOString() }); enabled = true;
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && e.code === "INFERENCE_RELEASE_EXPIRED");
    assert.equal(f.httpRequests.length, 4); assert.ok(f.httpRequests.every(i => i.inferenceConfig!.maxTokens === 1));
    const results = openJournal(path.join(dir, "results.jsonl")).records as { event: string; providerError?: string; conservativeReservationRetained?: boolean; rawText?: unknown; attemptKey?: string }[];
    const failed = results.find(r => r.event === "ATTEMPT_FINISHED")!;
    assert.equal(failed.providerError, "INFERENCE_RELEASE_EXPIRED"); assert.equal(failed.conservativeReservationRetained, true); assert.equal(failed.rawText, null);
    assert.ok(!results.some(r => r.event === "RAW_RESPONSE"));
    const ledger = openJournal(path.join(f.ledger, c.approval!.approvalId + ".jsonl")).records as { event: string; state?: { inferenceCalls: number; attemptKeys: string[] } }[];
    assert.equal(ledger.filter(r => r.event === "INFERENCE_RESERVED" && r.state).length, 1);
    assert.equal(ledger.at(-1)!.state!.inferenceCalls, 1); assert.ok(ledger.at(-1)!.state!.attemptKeys.includes(failed.attemptKey!));
    const before = f.records(c).length;
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && e.code === "INFERENCE_RELEASE_EXPIRED");
    assert.equal(f.records(c).length, before); assert.equal(f.httpRequests.length, 4);
  } finally { Date.now = original; f.close(); }
});

test("credential admission: signed phases resolve STS once before claim/resume and static SDK credentials never refresh after reservations", needsClean, async t => {
  const f = await fixture({ credentialAdmission: true });
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run");
    await f.run(c, dir, { measureOnly: true });
    assert.equal(f.credentialCalls.length, 1); assert.deepEqual(f.credentialCalls[0].ledgerEvents, ["ISSUED"]);
    assert.equal(f.httpRequests.length, 4); assert.ok(f.httpRequests.every(i => i.inferenceConfig!.maxTokens === 1));
    f.release(c); const beforeResume = f.records(c).length;
    f.setCredentialHook(() => { throw Error("TEST FIXTURE denied credential resume"); });
    await assert.rejects(f.run(c, dir, { resume: true }), e => e instanceof PilotError && e.code === "NOVA_STS_ASSUME_ROLE_FAILED");
    assert.equal(f.records(c).length, beforeResume); assert.equal(f.httpRequests.length, 4);
    f.setCredentialHook(() => {});
    await f.run(c, dir, { resume: true });
    assert.equal(f.credentialCalls.length, 3); assert.equal(f.credentialCalls[1].ledgerEvents.length, beforeResume); assert.equal(f.credentialCalls[2].ledgerEvents.length, beforeResume);
    assert.equal(f.httpRequests.length, 12); assert.deepEqual(f.httpRequests.slice(4).map(i => f.label.get(serializeNova(i).identity.tokenPayloadHash)), OWNER_ORDER);
    const rows = openJournal(path.join(dir, "results.jsonl")).records as { event: string }[];
    assert.equal(rows.filter(r => r.event === "CREDENTIALS_PRE_RESOLVED").length, 2);
    assert.equal(f.records(c).filter(r => r.event === "MEASURE_RESERVED").length, 4);
    assert.equal(f.records(c).filter(r => r.event === "INFERENCE_RESERVED").length, 8);
    t.diagnostic(JSON.stringify({ authority: "FAKE_SIGNED_PHASES", providerCalls: 3, successfulCredentialAdmissions: 2, rejectedCredentialResume: 1, bedrockHttp: 12, measureReservations: 4, inferenceReservations: 8, journal: "CREDENTIALS_PRE_RESOLVED_BEFORE_ATTEMPTS_DENIED_CREDENTIAL_RESUME_ADDS_NO_RESUMED", destination: "https://bedrock-runtime.us-east-1.amazonaws.com", scientificPass: null }));
  } finally { f.close(); }
});

test("credential admission: STS failure, approval expiry and expiring credentials do not claim/reserve or create Bedrock outcomes", needsClean, async t => {
  const original = Date.now; let now = original(); Date.now = () => now; const f = await fixture({ credentialAdmission: true });
  try {
    const start = now, assume = f.credentialFixture.assumeRole;
    for (const category of ["NOVA_STS_ASSUME_ROLE_FAILED", "LiveNotApproved", "NOVA_CREDENTIALS_EXPIRED"] as const) {
      now = start; const c = signed(f.base); f.issue(c); const dir = path.join(f.root, category);
      f.credentialFixture.assumeRole = async (...args) => {
        const result = await assume(...args);
        if (category === "NOVA_STS_ASSUME_ROLE_FAILED") throw Error("TEST FIXTURE STS error");
        if (category === "LiveNotApproved") now = Date.parse(c.approval!.expiresAt) + 1;
        else result.expiration = new Date(now - 1);
        return result;
      };
      const before = f.credentialCalls.length;
      await assert.rejects(f.run(c, dir, { measureOnly: true }), e => e instanceof PilotError && e.code === category);
      assert.deepEqual(f.records(c).map(r => r.event), ["ISSUED"]); assert.equal(f.credentialCalls.length, before + 1);
      assert.equal(f.httpRequests.length, 0); assert.equal(f.sent.length, 0); assert.equal(fs.existsSync(path.join(dir, "results.jsonl")), false);
      assert.equal(fs.existsSync(path.join(f.ledger, c.approval!.approvalId + ".lock")), false);
      t.diagnostic(JSON.stringify({ authority: "FAKE_SIGNED_MEASURE", category, providerCalls: 1, bedrockHttp: 0, reservations: 0, ledger: "ISSUED_UNCHANGED", journal: "NO_BEDROCK_JOURNAL_OR_MODEL_FAILURE", destination: "FAKE_STS_ONLY" }));
    }
  } finally { Date.now = original; f.close(); }
});
