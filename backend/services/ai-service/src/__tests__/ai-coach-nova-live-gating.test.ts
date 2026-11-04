/**
 * TEST FIXTURE only. Nova LIVE gating: fixture Ed25519 keys generated in-test, FAKE_TEST_ONLY ledger issues in a temp
 * directory, a fixture send. No AWS request, no credential resolution, no installed trust root, no owner signature.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { BedrockRuntimeClient, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { approvedConfigurationHash, NOVA_ACCEPTED, parseConfiguration, type SessionConfig } from "../evaluation/bedrock-pilot/config";
import { approvalFromTrust, assertNovaLedgerScope, installedTrustFile, novaLedgerScope } from "../evaluation/bedrock-pilot/ledger";
import { converseInput, openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins, implementationRoot } from "../evaluation/bedrock-pilot/pins";
import { createFakeNovaTransport, NOVA_MODEL, NOVA_REGION, serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { createNovaRuntimeClient, type NovaSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig, pilotPrompt } from "./fixtures/pilot";

const answer = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [],
  rationaleSummary: "Synthetic rehearsal fixture, no scientific conclusion.", proposedAction: null }, sourceLinks: [], claimLinks: [] };
const keys = generateKeyPairSync("ed25519"), otherKeys = generateKeyPairSync("ed25519");
const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
const hour = 3600 * 1000;
function signApproval(c: SessionConfig, key: KeyObject = keys.privateKey, patch: Record<string, unknown> = {}) {
  const body = { approvalId: randomUUID(), issuer: "fixture-issuer", approvedBy: "TEST FIXTURE owner", scope: "BEDROCK_EVALUATION_PILOT" as const, configHash: approvedConfigurationHash(c), expiresAt: new Date(Date.now() + hour).toISOString(), ...patch };
  return { ...body, signature: sign(null, Buffer.from(canonical(body)), key).toString("base64") };
}
function liveBase(sources: SessionConfig["sources"]): SessionConfig {
  const c = pilotConfig();
  Object.assign(c, { mode: "LIVE", liveOptIn: true, profileModelConfirmed: true, transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null,
    outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion: "CLAIM_PROMPT_V2", design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
    budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 }, sources });
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner" });
  c.novaScope = { tokenPayloadHashes: ["1", "2", "3", "4"].map(d => d.repeat(64)), measureCalls: 4, inferenceCalls: 8, awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED } };
  return c;
}
const signed = (c: SessionConfig, key?: KeyObject, patch?: Record<string, unknown>) => { const x: SessionConfig = structuredClone({ ...c, approval: null }); x.approval = signApproval(x, key, patch); return x; };
/** JSON has no undefined: drop the key the way a real config file would omit it. */
function without<T extends object>(o: T, key: keyof T): T { const x = { ...o }; delete x[key]; return x; }

test("signed Nova LIVE config: scope is required, acknowledgements must be accepted, approval lifetime is bounded, other protocols cannot carry it", () => {
  const base = liveBase({ workspaceRoot: os.tmpdir(), casesFile: path.join(os.tmpdir(), "c.json"), claimRegistryConfigFile: path.join(os.tmpdir(), "r.json") });
  assert.doesNotThrow(() => parseConfiguration(signed(base)));
  const bad: [SessionConfig, RegExp][] = [
    [signed(without(base, "novaScope")), /NOVA_LIVE_SCOPE_REQUIRED/],
    [signed({ ...base, novaScope: { ...base.novaScope!, tokenPayloadHashes: base.novaScope!.tokenPayloadHashes.slice(0, 3), measureCalls: 3 } }), /NOVA_LIVE_SCOPE_REQUIRED/],
    [signed({ ...base, novaScope: { ...base.novaScope!, inferenceCalls: 7 } }), /NOVA_LIVE_SCOPE_REQUIRED/],
    [signed({ ...base, novaScope: { ...base.novaScope!, measureCalls: 3 } }), /NOVA_SCOPE_INVALID/],
    [signed({ ...base, novaScope: { ...base.novaScope!, ownerAcknowledgements: { ...NOVA_ACCEPTED, pricing: "PENDING_OWNER" } } }), /NOVA_OWNER_ACKNOWLEDGEMENT_REQUIRED/],
    [signed({ ...base, novaScope: { ...base.novaScope!, ownerAcknowledgements: { ...NOVA_ACCEPTED, retentionLogging: "PENDING_OWNER" } } }), /NOVA_OWNER_ACKNOWLEDGEMENT_REQUIRED/],
    [signed(base, undefined, { expiresAt: new Date(Date.now() + 73 * hour).toISOString() }), /NOVA_APPROVAL_LIFETIME_EXCEEDED/],
    [{ ...signed(base), novaScope: { ...base.novaScope!, awsProfile: "another-profile" } }, /LiveNotApproved/],
    [{ ...base, approval: null }, /LiveNotApproved/],
    [signed({ ...base, novaScope: { ...base.novaScope!, awsProfile: "default" } }), /CONFIG_INVALID/],
    [signed({ ...base, novaScope: { ...base.novaScope!, awsProfile: "../x" } }), /CONFIG_INVALID/],
    [signed({ ...base, novaScope: { ...base.novaScope!, tokenPayloadHashes: ["1".repeat(64), "1".repeat(64), "3".repeat(64), "4".repeat(64)] } }), /CONFIG_INVALID/],
    [signed({ ...base, modelId: "anthropic.claude-haiku-4-5", transportProtocol: "MANTLE_MESSAGES", region: "us-east-2" } as SessionConfig), /NOVA_SCOPE_PROTOCOL_MISMATCH/],
  ];
  for (const [value, code] of bad) assert.throws(() => parseConfiguration(value), code);
  // FAKE Nova configs without a scope are unchanged.
  const fake = { ...without(base, "novaScope"), mode: "FAKE" as const, liveOptIn: false, approval: null, pricing: { ...base.pricing, authority: "FAKE_TEST_ONLY" as const } };
  assert.doesNotThrow(() => parseConfiguration(fake));
});

test("ledger scope must equal the signed configuration (order-insensitive payload set)", () => {
  const c = liveBase(undefined), scope = novaLedgerScope(c);
  assert.doesNotThrow(() => assertNovaLedgerScope({ scope: { ...scope, tokenPayloadHashes: [...scope.tokenPayloadHashes].reverse() } }, c));
  for (const s of [undefined, { ...scope, modelId: "amazon.nova-lite-v1:0" }, { ...scope, region: "us-west-2" }, { ...scope, inferenceCalls: 7 }, { ...scope, measureCalls: 3 },
    { ...scope, maxEstimatedUsd: 2 }, { ...scope, tokenPayloadHashes: scope.tokenPayloadHashes.slice(1) }, { ...scope, tokenPayloadHashes: [...scope.tokenPayloadHashes.slice(1), "f".repeat(64)] }])
    assert.throws(() => assertNovaLedgerScope({ scope: s }, c), /NOVA_LEDGER_SCOPE_MISMATCH/);
  assert.throws(() => novaLedgerScope({ ...c, novaScope: undefined }), /NOVA_LIVE_SCOPE_REQUIRED/);
});

test("Ed25519 approval verification against a trust root: signature, issuer, expiry and ledger placement", () => {
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-gate-ledger-")), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-gate-ws-"));
  try {
    const c = liveBase({ workspaceRoot: workspace, casesFile: path.join(workspace, "c.json"), claimRegistryConfigFile: path.join(workspace, "r.json") });
    const trust = { version: "owner-trust-v1", issuer: "fixture-issuer", publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
    assert.equal(approvalFromTrust(signed(c), trust).directory, path.resolve(ledger));
    assert.throws(() => approvalFromTrust(signed(c, otherKeys.privateKey), trust), /APPROVAL_SIGNATURE_INVALID/);
    assert.throws(() => approvalFromTrust(signed(c), { ...trust, issuer: "someone-else" }), /APPROVAL_SIGNATURE_INVALID/);
    const tampered = signed(c); tampered.approval = { ...tampered.approval!, approvedBy: "tampered" };
    assert.throws(() => approvalFromTrust(tampered, trust), /APPROVAL_SIGNATURE_INVALID/);
    assert.throws(() => approvalFromTrust(signed(c, undefined, { expiresAt: new Date(Date.now() - 1000).toISOString() }), trust), /APPROVAL_EXPIRED/);
    assert.throws(() => approvalFromTrust(signed(c), { ...trust, ledgerDirectory: workspace }), /LedgerMustBeOutsideRun/);
    assert.throws(() => approvalFromTrust(signed(c), { ...trust, version: "v0" }), /TRUSTED_APPROVAL_STORE_UNAVAILABLE/);
  } finally { fs.rmSync(ledger, { recursive: true, force: true }); fs.rmSync(workspace, { recursive: true, force: true }); }
});

test("a rehearsal is LIVE-Nova only; LIVE without verified pins stops before any send; an unapproved payload is never sent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-gate-"));
  try {
    let sends = 0; const send: NovaSend = async () => { sends++; throw new Error("TEST: must not send"); };
    const live = signed(liveBase({ workspaceRoot: root, casesFile: path.join(root, "c.json"), claimRegistryConfigFile: path.join(root, "r.json") }));
    assert.throws(() => openEvaluationSession(live, path.join(root, "run"), undefined, { liveRehearsal: { trust: {}, send } }), /VERIFIED_INPUTS_REQUIRED/);
    const fakeNova = { ...without(live, "novaScope"), mode: "FAKE" as const, liveOptIn: false, approval: null, pricing: { ...live.pricing, authority: "FAKE_TEST_ONLY" as const } };
    let io = 0; const transport = createFakeNovaTransport({ kind: "FAKE", async converse() { io++; return { status: 500, body: null }; } });
    assert.throws(() => openEvaluationSession(fakeNova, path.join(root, "run"), transport, { liveRehearsal: { trust: {}, send } }), /REHEARSAL_SCOPE_INVALID/);
    // FAKE session with a scope that does not contain the prompt's token-bearing payload: refused before dispatch.
    const scoped = { ...fakeNova, novaScope: { tokenPayloadHashes: ["f".repeat(64)], measureCalls: 1, inferenceCalls: 1, awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED } } };
    const session = openEvaluationSession(scoped, path.join(root, "fake-run"), transport, { fixtureLedgerDirectory: path.join(root, "ledger") });
    try { await assert.rejects(session.previewTokenCounts([pilotPrompt]), /NOVA_PAYLOAD_NOT_APPROVED/); } finally { await session.close(); }
    assert.equal(sends, 0); assert.equal(io, 0); assert.equal(fs.existsSync(path.join(root, "run")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the runtime client takes only a valid named profile; constructing it sends nothing", async () => {
  const client = createNovaRuntimeClient("gymini-fixture-profile");
  assert.equal(await client.config.region(), "us-east-1"); assert.equal(await client.config.maxAttempts(), 1); client.destroy();
  for (const p of ["default", "", "a b", "../x", "x".repeat(65)]) assert.throws(() => createNovaRuntimeClient(p), /NOVA_PROFILE_INVALID/);
  for (const f of ["session.ts", "runner.ts", "config.ts", "ledger.ts", "nova-live-transport.ts", "nova-live-cli.ts", "run.ts"])
    assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, "../evaluation/bedrock-pilot", f), "utf8"), /process\.env/, f);
});

test("CLIs: no flag or environment variable unlocks LIVE; the old CLI refuses LIVE configs; the Nova CLI accepts only a signed Nova LIVE config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-nova-cli-"));
  try {
    const env = { ...process.env, LIVE: "true", BEDROCK_EVALUATION_LIVE: "true", NOVA_LIVE: "true" }, novaCli = path.resolve(__dirname, "../evaluation/bedrock-pilot/nova-live-cli.ts"), oldCli = path.resolve(__dirname, "../evaluation/bedrock-pilot/run.ts");
    const run = (cli: string, args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", timeout: 60000, env });
    const live = signed(liveBase({ workspaceRoot: dir, casesFile: path.join(dir, "c.json"), claimRegistryConfigFile: path.join(dir, "r.json") })), liveFile = path.join(dir, "live.json");
    const fake = { ...live, mode: "FAKE", liveOptIn: false, approval: null, novaScope: undefined, pricing: { ...live.pricing, authority: "FAKE_TEST_ONLY" } }, fakeFile = path.join(dir, "fake.json");
    fs.writeFileSync(liveFile, JSON.stringify(live)); fs.writeFileSync(fakeFile, JSON.stringify(fake));
    for (const [cli, args, code] of [[novaCli, [], /USAGE_NOVA_LIVE/], [novaCli, ["--live"], /USAGE_NOVA_LIVE/], [novaCli, [liveFile, path.join(dir, "r1"), "--live"], /USAGE_NOVA_LIVE/],
      [novaCli, [fakeFile, path.join(dir, "r2")], /NOVA_LIVE_CLI_SCOPE/], [oldCli, ["--live"], /CLI_LIVE_LOCKED/], [oldCli, [liveFile, path.join(dir, "r3")], /CLI_LIVE_LOCKED/]] as [string, string[], RegExp][]) {
      const r = run(cli, args); assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, code);
    }
    // A structurally valid signed Nova LIVE config still stops at the first owner gate (pins/clean checkout here); no run directory is created.
    const r = run(novaCli, [liveFile, path.join(dir, "r4")]); assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /summary/); assert.equal(fs.existsSync(path.join(dir, "r4")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("session source orders every owner gate before the ledger claim and the AWS client", () => {
  const s = fs.readFileSync(path.resolve(__dirname, "../evaluation/bedrock-pilot/session.ts"), "utf8");
  const order = ["const config = parseConfiguration(value)", "assertVerifiedPins(config, options.verifiedPins);", "const approval = config.mode === \"LIVE\" ? currentApproval() : null", "assertIssuedLedger({",
    "assertNovaLedgerScope(issued, config)", "const ledger = openBudgetLedger(", "createNovaRuntimeClient(config.novaScope!.awsProfile)"].map(k => s.indexOf(k));
  assert.ok(order.every(i => i >= 0), JSON.stringify(order)); assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(s.split("createNovaRuntimeClient(").length - 1, 1); assert.match(s, /rehearsal \? rehearsal\.send : novaRuntimeSend\(createNovaRuntimeClient/);
});

// ---- Full gate sequence. LIVE pins require the executing checkout to be clean, so these run in a clean pinned checkout. ----
const clean = !execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: implementationRoot, encoding: "utf8", windowsHide: true }).trim();
const needsClean = { skip: clean ? false : "LIVE pins require a clean checkout of the executing code; run in the clean pinned Nova checkout" };
function output(text: string, inputTokens: number, outputTokens: number, stopReason: string): ConverseCommandOutput {
  return { $metadata: { httpStatusCode: 200, requestId: "req-rehearsal" }, output: { message: { role: "assistant", content: [{ text }] } }, stopReason,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, metrics: { latencyMs: 3 } } as ConverseCommandOutput;
}
async function rehearsalFixture() {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-rehearsal-cal01"), b = fixturePilotInput(claimDevScenarios[1].request, "case-rehearsal-cal06");
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const synthetic = syntheticClaimData(), file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(synthetic.input)); fs.writeFileSync(file("map.json"), JSON.stringify(synthetic.map)); fs.writeFileSync(file("owner.json"), synthetic.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: synthetic.pins }));
  const c = liveBase({ workspaceRoot: implementationRoot, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") });
  const p = await calculatePilotPins(implementationRoot, a.casesFile, c.design, c.sources, c.promptVersion); c.pins = p.pins;
  c.novaScope = { ...c.novaScope!, tokenPayloadHashes: [...new Set(p.preparation.rows.map(r => serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash))] };
  const ledger = path.join(a.root, "ledger"); fs.mkdirSync(ledger);
  const trust = { version: "owner-trust-v1", issuer: "fixture-issuer", publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
  const sent: ConverseCommandInput[] = [];
  const send: NovaSend = async (i) => { sent.push(structuredClone(i)); const t = Math.ceil(Buffer.byteLength(JSON.stringify(serializeNova(i).canonical), "utf8") / 4);
    return i.inferenceConfig!.maxTokens === 1 ? output("{", t, 1, "max_tokens") : output(JSON.stringify(answer), t, 40, "end_turn"); };
  const issue = (x: SessionConfig, patch: Record<string, unknown> = {}, withScope = true) => { const j = openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl"), true);
    j.append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), ...(withScope ? { scope: novaLedgerScope(x) } : {}), ...patch }); };
  const records = (x: SessionConfig) => openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl")).records;
  return { root: a.root, base: c, trust, sent, send, issue, records, approved: c.novaScope.tokenPayloadHashes };
}

test("rehearsal: with every gate valid the full warmup sends exactly 4 measures + 8 inferences, all owner-approved payloads, and never builds the AWS client", needsClean, async () => {
  const f = await rehearsalFixture();
  try {
    const c = signed(f.base); f.issue(c);
    const original = BedrockRuntimeClient.prototype.send; let sdk = 0;
    BedrockRuntimeClient.prototype.send = async function () { sdk++; throw new Error("TEST: AWS SDK must not be used"); };
    let summary;
    try { summary = await runControlledPilot({ config: c, directory: path.join(f.root, "run"), liveRehearsal: { trust: f.trust, send: f.send } }); }
    finally { BedrockRuntimeClient.prototype.send = original; }
    assert.equal(sdk, 0); assert.equal(f.sent.length, 12);
    assert.equal(f.sent.filter(i => i.inferenceConfig!.maxTokens === 1).length, 4); assert.equal(f.sent.filter(i => i.inferenceConfig!.maxTokens === 2048).length, 8);
    assert.ok(f.sent.every(i => i.modelId === NOVA_MODEL && f.approved.includes(serializeNova(i).identity.tokenPayloadHash)));
    assert.equal(new Set(f.sent.map(i => serializeNova(i).identity.tokenPayloadHash)).size, 4);
    assert.equal(summary.status, "LIVE_REHEARSAL_FIXTURE_COMPLETED_REVIEW_ONLY"); assert.equal(summary.mode, "LIVE"); assert.equal(summary.actualBedrockCalls, 0);
    assert.equal(summary.budget.countCalls, 4); assert.equal(summary.budget.inferenceCalls, 8); assert.equal(summary.denominators.failed, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "run", "manifest.json"), "utf8")).rehearsal, "TEST_FIXTURE_NO_AWS_CALL");
    assert.equal(f.records(c).length > 1, true);
    // The single-use issue is consumed: a second run with the same approval is refused before any send.
    await assert.rejects(runControlledPilot({ config: c, directory: path.join(f.root, "run-again"), liveRehearsal: { trust: f.trust, send: f.send } }), /APPROVAL_ALREADY_USED/);
    assert.equal(f.sent.length, 12);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("rehearsal: each missing or mismatched gate stops before any send and before the ledger is claimed", needsClean, async () => {
  const f = await rehearsalFixture();
  try {
    const cases: [string, () => SessionConfig, RegExp][] = [
      ["owner-signed issue cannot drive a rehearsal", () => { const c = signed(f.base); f.issue(c, { authority: "OWNER_SIGNED" }); return c; }, /APPROVAL_LEDGER_BINDING_MISMATCH/],
      ["ledger without scope", () => { const c = signed(f.base); f.issue(c, {}, false); return c; }, /NOVA_LEDGER_SCOPE_MISMATCH/],
      ["ledger scope with other call budget", () => { const c = signed(f.base); f.issue(c, { scope: { ...novaLedgerScope(c), inferenceCalls: 7 } }); return c; }, /NOVA_LEDGER_SCOPE_MISMATCH/],
      ["no issued ledger", () => signed(f.base), /LEDGER_UNVERIFIABLE/],
      ["signature from another key", () => { const c = signed(f.base, otherKeys.privateKey); f.issue(c); return c; }, /APPROVAL_SIGNATURE_INVALID/],
      ["config edited after signing", () => { const c = signed(f.base); f.issue(c); return { ...c, budget: { ...c.budget, maxEstimatedUsd: 0.5 } }; }, /LiveNotApproved/],
      ["pending owner acknowledgement", () => { const c = signed({ ...f.base, novaScope: { ...f.base.novaScope!, ownerAcknowledgements: { ...NOVA_ACCEPTED, pricing: "PENDING_OWNER" } } }); f.issue(c); return c; }, /NOVA_OWNER_ACKNOWLEDGEMENT_REQUIRED/],
      ["payloads other than the approved set", () => { const c = signed({ ...f.base, novaScope: { ...f.base.novaScope!, tokenPayloadHashes: [...f.approved.slice(1), "f".repeat(64)] } }); f.issue(c); return c; }, /NOVA_PAYLOAD_NOT_APPROVED/],
      ["prompt pins differ", () => { const c = signed({ ...f.base, pins: { ...f.base.pins, promptHashes: [...f.base.pins.promptHashes].reverse().map((h, i) => i === 0 ? "f".repeat(64) : h) } }); f.issue(c); return c; }, /PIN_MISMATCH/],
    ];
    for (const [name, make, code] of cases) {
      const c = make(), dir = path.join(f.root, "run-" + randomUUID());
      await assert.rejects(runControlledPilot({ config: c, directory: dir, liveRehearsal: { trust: f.trust, send: f.send } }), code, name);
      assert.equal(f.sent.length, 0, name);
      if (fs.existsSync(path.join(f.trust.ledgerDirectory, c.approval!.approvalId + ".jsonl"))) assert.equal(f.records(c).length, 1, name);
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("without a rehearsal the installed trust root is the only authority: absent here, so the run stops and the AWS SDK is never called", { skip: !clean ? needsClean.skip : fs.existsSync(installedTrustFile()) ? "trust file present on this machine" : false }, async () => {
  const f = await rehearsalFixture();
  const original = BedrockRuntimeClient.prototype.send; let sdk = 0;
  BedrockRuntimeClient.prototype.send = async function () { sdk++; throw new Error("TEST: AWS SDK must not be used"); };
  try {
    const c = signed(f.base); f.issue(c, { authority: "OWNER_SIGNED" });
    await assert.rejects(runControlledPilot({ config: c, directory: path.join(f.root, "run") }), /TRUSTED_APPROVAL_STORE_UNAVAILABLE/);
    assert.equal(sdk, 0); assert.equal(f.records(c).length, 1); assert.equal(fs.existsSync(path.join(f.root, "run")), false);
  } finally { BedrockRuntimeClient.prototype.send = original; fs.rmSync(f.root, { recursive: true, force: true }); }
});
