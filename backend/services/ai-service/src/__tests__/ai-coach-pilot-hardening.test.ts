import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { parseConfiguration } from "../evaluation/bedrock-pilot/config";
import { initialState, issueFixtureLedger, verifySignedApproval } from "../evaluation/bedrock-pilot/ledger";
import { openEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { pilotConfig, pilotPrompt, pilotTransport } from "./fixtures/pilot";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gymini-pilot-hardening-"));
const child = path.join(__dirname, "fixtures/pilot-ledger-child.ts");

test("pricing fails closed for missing, zero, negative, non-finite, expired or mismatched prices", () => {
  for (const field of ["inputUsdPerMillion", "outputUsdPerMillion"] as const) for (const value of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
    const c = pilotConfig(); c.mode = "LIVE"; (c.pricing as unknown as Record<string, unknown>)[field] = value;
    assert.throws(() => parseConfiguration(c), /CONFIG_INVALID/);
  }
  for (const patch of [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, { checkedAt: new Date(Date.now() + 7200000).toISOString() }, { region: "wrong" }, { modelId: "wrong" }, { inferenceProfile: "wrong" }]) {
    const c = pilotConfig(); Object.assign(c.pricing, patch); assert.throws(() => parseConfiguration(c), /PricingNotValid/);
  }
  const c = pilotConfig(); delete (c.pricing as Partial<typeof c.pricing>).tokenUnit; assert.throws(() => parseConfiguration(c));
});
test("approval signature binds issuer, id, configuration and expiry; caller JSON is insufficient", () => {
  const keys = generateKeyPairSync("ed25519"), trust = { issuer: "TEST_OWNER", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const body = { approvalId: randomUUID(), issuer: trust.issuer, approvedBy: "TEST_FIXTURE", scope: "BEDROCK_EVALUATION_PILOT", configHash: digest("config"), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const approval = { ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") };
  assert.equal(verifySignedApproval(approval, trust).approvalId, body.approvalId);
  assert.throws(() => verifySignedApproval({ ...approval, configHash: digest("changed") }, trust), /SIGNATURE_INVALID/);
  assert.throws(() => verifySignedApproval(approval, { ...trust, issuer: "OTHER" }), /SIGNATURE_INVALID/);
  const expired = { ...body, expiresAt: new Date(Date.now() - 1000).toISOString() };
  assert.throws(() => verifySignedApproval({ ...expired, signature: sign(null, Buffer.from(canonical(expired)), keys.privateKey).toString("base64") }, trust), /APPROVAL_EXPIRED/);
});
test("one approval cannot open concurrent sessions, a new directory or changed configuration", async () => {
  const root = temp(), c = pilotConfig(), options = { fixtureLedgerDirectory: path.join(root, "ledger"), fixtureApprovalId: "fixture-shared" };
  const s = openEvaluationSession(c, path.join(root, "run"), pilotTransport(), options);
  assert.throws(() => openEvaluationSession(c, path.join(root, "other"), pilotTransport(), options), /LOCK_UNAVAILABLE/);
  await s.evaluate(pilotPrompt, "first"); const before = s.state(); await s.close();
  assert.throws(() => openEvaluationSession(c, path.join(root, "new"), pilotTransport(), options), /APPROVAL_ALREADY_USED/);
  const changed = structuredClone(c); changed.budget.maxCalls++;
  assert.throws(() => openEvaluationSession(changed, path.join(root, "new"), pilotTransport(), options), /BINDING_MISMATCH/);
  const resumed = openEvaluationSession(c, path.join(root, "run"), pilotTransport(), { ...options, resume: true });
  assert.equal(resumed.state().inputTokens, before.inputTokens);
  await assert.rejects(() => resumed.evaluate(pilotPrompt, "first"), /ALREADY_RESERVED/); await resumed.close();
  fs.unlinkSync(path.join(options.fixtureLedgerDirectory, "fixture-shared.jsonl"));
  assert.throws(() => openEvaluationSession(c, path.join(root, "run"), pilotTransport(), { ...options, resume: true }), /UNVERIFIABLE/);
});
test("OS process lock admits only one concurrent claimant", async () => {
  const root = temp(), directory = path.join(root, "ledger"), configHash = digest("same-config"), approvalHash = digest("same-approval");
  issueFixtureLedger(directory, "fixture-shared", configHash, approvalHash);
  const file = path.join(root, "args.json"); fs.writeFileSync(file, JSON.stringify({ ledger: { directory, approvalId: "fixture-shared", approvalHash, configHash, runDirectory: path.join(root, "run"), mode: "FAKE", resume: false } }));
  const run = () => new Promise<number | null>((resolve, reject) => { const p = spawn(process.execPath, ["--import", "tsx", child, "concurrent", file], { stdio: "ignore" }); p.on("error", reject); p.on("exit", resolve); });
  const exits = (await Promise.all([run(), run()])).sort(); assert.deepEqual(exits, [0, 23]);
});
test("crash probes retain reservations and orphan lock; no new run or automatic restart refund", () => {
  for (const mode of ["crash-before-response", "crash-before-raw", "crash-after-raw"]) {
    const root = temp(), c = pilotConfig(), file = path.join(root, "args.json"); fs.writeFileSync(file, JSON.stringify({ root, config: c }));
    const result = spawnSync(process.execPath, ["--import", "tsx", child, mode, file], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, mode === "crash-before-response" ? 73 : 74, result.stderr);
    const records = openJournal(path.join(root, "ledger/fixture-shared.jsonl")).records as { state?: ReturnType<typeof initialState> }[];
    assert.equal(records.at(-1)!.state!.inputTokens, 12); assert.equal(records.at(-1)!.state!.outputTokens, c.parameters.maxTokens);
    const rows = openJournal(path.join(root, "run/results.jsonl")).records as { event: string }[];
    assert.equal(rows.some((r) => r.event === "RAW_RESPONSE"), mode === "crash-after-raw");
    assert.throws(() => openEvaluationSession(c, path.join(root, "new"), pilotTransport(), { fixtureLedgerDirectory: path.join(root, "ledger"), fixtureApprovalId: "fixture-shared" }), /LOCK_UNAVAILABLE/);
    assert.throws(() => openEvaluationSession(c, path.join(root, "run"), pilotTransport(), { fixtureLedgerDirectory: path.join(root, "ledger"), fixtureApprovalId: "fixture-shared", resume: true }), /LOCK_UNAVAILABLE/);
  }
});
test("timeout reservations survive restart and cumulative USD is checked before each invocation", async () => {
  const root = temp(), c = pilotConfig(); c.budget.maxCalls = 1; c.parameters.timeoutMs = 10;
  const options = { fixtureLedgerDirectory: path.join(root, "ledger"), fixtureApprovalId: "timeout-shared" };
  const s = openEvaluationSession(c, path.join(root, "run"), { ...pilotTransport(), async invoke() { return new Promise(() => undefined); } }, options);
  assert.equal((await s.evaluate(pilotPrompt)).providerError, "TIMEOUT"); assert.equal(s.state().outputTokens, c.parameters.maxTokens); await s.close();
  const resumed = openEvaluationSession(c, path.join(root, "run"), pilotTransport(), { ...options, resume: true }); await assert.rejects(() => resumed.evaluate(pilotPrompt), /BudgetStopped/); await resumed.close();
  const priced = pilotConfig(); priced.parameters.maxTokens = 20; priced.budget.maxEstimatedUsd = 0.000052;
  const secondRoot = temp(), limited = openEvaluationSession(priced, path.join(secondRoot, "run"), pilotTransport());
  assert.equal((await limited.evaluate(pilotPrompt)).providerError, null); assert.equal((await limited.evaluate(pilotPrompt)).providerError, "BUDGET_REJECTED"); assert.equal(limited.state().inferenceCalls, 1); await limited.close();
});
test("missing or altered ledger/lock fails closed rather than recreating accounting", async () => {
  const root = temp(), options = { fixtureLedgerDirectory: path.join(root, "ledger"), fixtureApprovalId: "tamper-shared" }, c = pilotConfig();
  const s = openEvaluationSession(c, path.join(root, "run"), pilotTransport(), options);
  fs.appendFileSync(path.join(options.fixtureLedgerDirectory, "tamper-shared.jsonl"), "unverified partial tail");
  await assert.rejects(() => s.evaluate(pilotPrompt), /PersistenceFailure/); assert.equal(s.state().inferenceCalls, 0); await s.close();
  assert.throws(() => openEvaluationSession(c, path.join(root, "run"), pilotTransport(), { ...options, resume: true }), /JOURNAL_INCOMPLETE/);
});
