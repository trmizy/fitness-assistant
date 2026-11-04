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
import type { ConverseCommandInput, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { approvedConfigurationHash, NOVA_ACCEPTED, NOVA_TWO_PHASE, parseConfiguration, type SessionConfig } from "../evaluation/bedrock-pilot/config";
import { inferenceReleaseFile, measurementPhaseRecord, novaLedgerScope, verifyInferenceRelease } from "../evaluation/bedrock-pilot/ledger";
import { converseInput } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins, implementationRoot } from "../evaluation/bedrock-pilot/pins";
import { NOVA_MODEL, NOVA_REGION, serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import type { NovaSend } from "../evaluation/bedrock-pilot/nova-live-transport";
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

async function fixture(options: { phases?: boolean; budget?: Partial<SessionConfig["budget"]> } = {}) {
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
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner" });
  const p = await calculatePilotPins(implementationRoot, a.casesFile, c.design, c.sources, c.promptVersion); c.pins = p.pins;
  c.novaScope = { tokenPayloadHashes: [...new Set(p.preparation.rows.map(r => serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash))], measureCalls: 4, inferenceCalls: 8,
    awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED }, ...(options.phases === false ? {} : { phases: NOVA_TWO_PHASE }) };
  const label = new Map(p.preparation.rows.map(r => [serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash, `${r.caseKey}/${r.arm}`]));
  const ledger = path.join(a.root, "ledger"); fs.mkdirSync(ledger);
  const trust = { version: "owner-trust-v1", issuer: ISSUER, publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
  const sent: ConverseCommandInput[] = [];
  let reply = (i: ConverseCommandInput): ConverseCommandOutput => i.inferenceConfig!.maxTokens === 1 ? output("{", tokensOf(i), 1, "max_tokens") : output(answer, tokensOf(i), 40, "end_turn");
  const send: NovaSend = async (i) => { sent.push(structuredClone(i)); return reply(i); };
  const issue = (x: SessionConfig) => openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl"), true)
    .append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), scope: novaLedgerScope(x) });
  const records = (x: SessionConfig) => openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl")).records as { event: string }[];
  /** The owner's inference release (fixture key), bound to the recorded measurement phase; `patch` builds invalid ones. */
  const release = (x: SessionConfig, patch: Record<string, unknown> = {}, key: KeyObject = keys.privateKey) => {
    const m = measurementPhaseRecord(ledger, x.approval!.approvalId)!;
    const body = { version: "nova-inference-release-v1", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), issuer: ISSUER,
      releasedBy: "TEST FIXTURE owner", measurementRecordHash: m.hash, measuredCounts: m.state.counts, expiresAt: x.approval!.expiresAt, ...patch };
    const f = inferenceReleaseFile(ledger, x.approval!.approvalId); if (fs.existsSync(f)) fs.unlinkSync(f);
    fs.writeFileSync(f, JSON.stringify({ ...body, signature: sign(null, Buffer.from(canonical(body)), key).toString("base64") }));
  };
  const run = (x: SessionConfig, dir: string, o: { measureOnly?: boolean; resume?: boolean; onStage?: (s: string) => void } = {}) =>
    runControlledPilot({ config: x, directory: dir, liveRehearsal: { trust, send }, measureOnly: o.measureOnly, resume: o.resume, onStage: o.onStage as never });
  const inferences = () => sent.filter(i => i.inferenceConfig!.maxTokens !== 1), measures = () => sent.filter(i => i.inferenceConfig!.maxTokens === 1);
  return { root: a.root, base: c, ledger, sent, issue, records, release, run, inferences, measures, label, setReply: (r: typeof reply) => { reply = r; }, close: () => fs.rmSync(a.root, { recursive: true, force: true }) };
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
    await assert.rejects(f.run(c, dir, { resume: true }), /LiveNotApproved|APPROVAL_EXPIRED|INFERENCE_RELEASE_EXPIRED/);
    assert.equal(f.inferences().length, 0);
  } finally { Date.now = original; f.close(); }
});

test("dispatch boundary: approval expiring after a measurement reservation sends no request", needsClean, async () => {
  const originalNow = Date.now, originalWrite = fs.writeFileSync; let now = originalNow(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); let advanced = false;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      originalWrite(...args);
      if (typeof args[1] === "string" && args[1].includes('"event":"MEASURE_RESERVED"')) { now = Date.parse(c.approval!.expiresAt) + 1; advanced = true; }
    }) as typeof fs.writeFileSync;
    await assert.rejects(f.run(c, dir, { measureOnly: true }), /TokenPreflightFailed/);
    assert.equal(advanced, true); assert.equal(f.sent.length, 0, "approval checked after durable reservation, before measurement send");
    const records = openJournal(path.join(f.ledger, c.approval!.approvalId + ".jsonl")).records as { event: string; state?: { countCalls: number; stopped: boolean } }[];
    assert.ok(records.some(r => r.event === "COUNT_FAILED" && r.state?.stopped));
    assert.equal(measurementPhaseRecord(f.ledger, c.approval!.approvalId), null);
    await assert.rejects(f.run(c, dir, { measureOnly: true, resume: true }), /LiveNotApproved|APPROVAL_EXPIRED/);
    assert.equal(f.sent.length, 0);
  } finally { fs.writeFileSync = originalWrite; Date.now = originalNow; f.close(); }
});

test("dispatch boundary: separate release expiry after inference reservation blocks dispatch and survives resume", needsClean, async () => {
  const originalNow = Date.now, originalWrite = fs.writeFileSync; let now = originalNow(); Date.now = () => now;
  const f = await fixture();
  try {
    const c = signed(f.base); f.issue(c); const dir = path.join(f.root, "run"); await f.run(c, dir, { measureOnly: true });
    const expiresAt = new Date(now + 60000).toISOString(); f.release(c, { expiresAt }); let advanced = false;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      originalWrite(...args);
      if (typeof args[1] === "string" && args[1].includes('"event":"INFERENCE_RESERVED"')) { now = Date.parse(expiresAt) + 1; advanced = true; }
    }) as typeof fs.writeFileSync;
    await assert.rejects(f.run(c, dir, { resume: true }), /INFERENCE_RELEASE_EXPIRED/);
    fs.writeFileSync = originalWrite;
    assert.equal(advanced, true); assert.equal(f.measures().length, 4); assert.equal(f.inferences().length, 0);
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
    await assert.rejects(f.run(c, dir, { resume: true, onStage: s => { if (s === "PERSISTED") { persisted = true; now = Date.parse(c.approval!.expiresAt) + 1; } } }), /LiveNotApproved|APPROVAL_EXPIRED|INFERENCE_RELEASE_EXPIRED/);
    assert.equal(persisted, true); assert.equal(f.inferences().length, 1); assert.equal(f.measures().length, 4);
    await assert.rejects(f.run(c, dir, { resume: true }), /LiveNotApproved|APPROVAL_EXPIRED|INFERENCE_RELEASE_EXPIRED/);
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
