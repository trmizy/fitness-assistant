/**
 * TEST FIXTURE: P1 authorization-revival regressions (external review E3_RUN4_DUAL_ENDPOINT_EXTERNAL_REVIEW_BLOCKED).
 * An authority context that has OBSERVED approval / release / lease expiry must never dispatch again, even if the
 * wall clock is later moved backwards. Real production factory (NodeHttp2Handler, prototype-stubbed in memory), real
 * credential lease and prepared-session entry point with fixture Ed25519 trust and FAKE_TEST_ONLY ledgers. No AWS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { approvedConfigurationHash, NOVA_ACCEPTED, NOVA_TWO_PHASE, PilotError, type SessionConfig } from "../evaluation/bedrock-pilot/config";
import { inferenceReleaseFile, measurementPhaseRecord, novaLedgerScope } from "../evaluation/bedrock-pilot/ledger";
import { converseInput, openPreparedEvaluationSession } from "../evaluation/bedrock-pilot/session";
import { calculatePilotPins, implementationRoot, verifySessionPins } from "../evaluation/bedrock-pilot/pins";
import { NOVA_MODEL, NOVA_REGION, serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { createNovaRuntimeClient, novaRuntimeSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import { resolveNovaCredentials, consumeNovaCredentials, type NovaCredentialFixture } from "../evaluation/bedrock-pilot/nova-credentials";
import type { NovaHttpAuthorization, NovaHttpSessionBinding } from "../evaluation/bedrock-pilot/nova-http-boundary";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
const code = async (p: Promise<unknown> | (() => unknown)) => { try { await (typeof p === "function" ? p() : p); return "OK"; } catch (e) { return e instanceof PilotError ? e.code : (e as Error)?.name ?? String(e); } };
const blocked = (c: string) => c !== "OK";

// ---- deterministic wall clock (and optional monotonic clock) ----
const realNow = Date.now, realHr = process.hrtime.bigint;
let wall = realNow(), mono: bigint | null = null;
function useClock() { wall = realNow(); mono = null; Date.now = () => wall; (process.hrtime as any).bigint = () => mono ?? realHr(); }
function restoreClock() { Date.now = realNow; (process.hrtime as any).bigint = realHr; }

// ---- in-memory Bedrock transport on the PRODUCTION NodeHttp2Handler (every loaded node-http-handler instance) ----
const handlerModules = [...new Set(["@aws-sdk/client-sts", "@aws-sdk/client-bedrock-runtime"].map((m) => createRequire(require.resolve(m)).resolve("@smithy/node-http-handler")))].map((p) => require(p));
const http = { calls: [] as { measure: boolean; host: string }[] };
const tokensOf = (i: ConverseCommandInput) => Math.ceil(Buffer.byteLength(JSON.stringify(serializeNova(i).canonical), "utf8") / 4);
const answer = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic revival fixture.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
function stubHttp() {
  const saved = handlerModules.map((m) => [m.NodeHttp2Handler.prototype.handle, m.NodeHttpHandler.prototype.handle]);
  const handle = async function (request: any) {
    const raw = typeof request.body === "string" ? request.body : Buffer.from(request.body.buffer, request.body.byteOffset, request.body.byteLength).toString("utf8");
    const i = { modelId: NOVA_MODEL, ...JSON.parse(raw) } as ConverseCommandInput, measure = i.inferenceConfig!.maxTokens === 1;
    http.calls.push({ measure, host: request.hostname });
    const body = measure ? { output: { message: { role: "assistant", content: [{ text: "{" }] } }, stopReason: "max_tokens", usage: { inputTokens: tokensOf(i), outputTokens: 1, totalTokens: tokensOf(i) + 1 }, metrics: { latencyMs: 1 } }
      : { output: { message: { role: "assistant", content: [{ text: answer }] } }, stopReason: "end_turn", usage: { inputTokens: tokensOf(i), outputTokens: 40, totalTokens: tokensOf(i) + 40 }, metrics: { latencyMs: 1 } };
    return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) } };
  };
  for (const m of handlerModules) { m.NodeHttp2Handler.prototype.handle = handle; m.NodeHttpHandler.prototype.handle = async () => { throw new Error("TEST: no STS transport expected"); }; }
  return () => { for (const [i, m] of handlerModules.entries()) { m.NodeHttp2Handler.prototype.handle = saved[i][0]; m.NodeHttpHandler.prototype.handle = saved[i][1]; } };
}

// ---- component level: real lease + real production client + synthetic session-like authority ----
const fixtureCreds = (assumeHook = () => {}): NovaCredentialFixture => ({ metadataDisabled: "true",
  loadFiles: async () => ({ configFile: { fixture: { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "source" } }, credentialsFile: { source: { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } } } as any),
  assumeRole: async () => { assumeHook(); return { accessKeyId: "ASIATESTFIXTURE", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 2 * HOUR) }; } });
async function component(o: { approvalAt: number; releaseAt?: number | null; scope?: NovaHttpSessionBinding["scope"]; phaseWindowMs?: number; extraCheck?: () => void; signingHook?: () => void; assumeHook?: () => void }) {
  const scope = o.scope ?? "ONE_SHOT", releaseAt = o.releaseAt ?? null;
  const validUntil = new Date(releaseAt ?? o.approvalAt).toISOString();
  // Session-equivalent authority: Date.now-based approval/release checks that THROW (like assertCurrentAuthorization).
  const authority = () => { o.extraCheck?.(); if (o.approvalAt <= Date.now()) throw new PilotError("LiveNotApproved"); if (releaseAt !== null && releaseAt <= Date.now()) throw new PilotError("INFERENCE_RELEASE_EXPIRED"); };
  const receipt = await resolveNovaCredentials({ profile: "fixture", binding: "component", validUntil, assertAuthority: authority, expiryCategory: releaseAt !== null ? "INFERENCE_RELEASE_EXPIRED" : "LiveNotApproved", phaseWindowMs: o.phaseWindowMs ?? 30 * MIN }, fixtureCreds(o.assumeHook));
  const lease = consumeNovaCredentials(receipt, "component", true);
  const binding: NovaHttpSessionBinding = Object.freeze({ approvalId: "A", approvalHash: "a".repeat(64), configHash: "c".repeat(64), ledgerDirectory: "L", approvalExpiresAt: new Date(o.approvalAt).toISOString(), inferenceReleaseExpiresAt: releaseAt === null ? null : new Date(releaseAt).toISOString(), scope });
  const client = createNovaRuntimeClient("fixture", lease.credentials);
  if (o.signingHook) { const k = client.config as any; k.httpAuthSchemes = k.httpAuthSchemes.map((s: any) => ({ ...s, signer: { ...s.signer, async sign(...a: any[]) { const r = await s.signer.sign(...a); o.signingHook!(); return r; } } })); }
  const send = novaRuntimeSend(client, binding);
  const phase: NovaHttpAuthorization["phase"] = scope === "MEASURE_ONLY" ? "MEASURE" : "INFERENCE";
  let ordinal = 0;
  const attempt = async (text = "SYNTHETIC " + randomUUID()) => {
    const input: ConverseCommandInput = { modelId: NOVA_MODEL, messages: [{ role: "user", content: [{ text }] }], inferenceConfig: { maxTokens: phase === "MEASURE" ? 1 : 2048, temperature: 0.2 } };
    const w = serializeNova(input), n = ++ordinal;
    // Session order: lease (credentials.assertCurrent) inside the reservation-bound callback, then the boundary checks.
    const auth: NovaHttpAuthorization = Object.freeze({ binding, phase, reservationId: `${phase}:${n}`, reservationOrdinal: n, promptHash: "d".repeat(64), tokenPayloadHash: w.identity.tokenPayloadHash, requestHash: w.identity.inferenceRequestHash,
      assertCurrent: () => { authority(); lease.assertCurrent(); } });
    return code(async () => { lease.assertCurrent(); authority(); return send(input, new AbortController().signal, auth); });
  };
  return { attempt, lease, close: () => client.destroy() };
}
async function scenario(name: string, run: () => Promise<void>) {
  test(name, async () => { useClock(); http.calls = []; const restore = stubHttp(); try { await run(); } finally { restore(); restoreClock(); } });
}

scenario("P1-C1 approval expiry observed, then wall rollback above the last valid observation: no revival (new ordinal, after a successful measurement)", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + MIN, scope: "MEASURE_ONLY" });
  try {
    assert.equal(await c.attempt(), "OK"); assert.equal(http.calls.length, 1);
    wall = T + MIN + 1; assert.equal(await c.attempt(), "LiveNotApproved");
    wall = T + 30 * SEC; const after = await c.attempt();
    assert.ok(blocked(after), "expired approval revived by rollback: " + after); assert.equal(http.calls.length, 1);
    wall = T + 10 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C2 inference release expiry observed, then rollback: no revival (after a successful inference)", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + 10 * MIN, releaseAt: T + MIN, scope: "INFERENCE_ONLY" });
  try {
    assert.equal(await c.attempt(), "OK");
    wall = T + MIN + 1; assert.equal(await c.attempt(), "INFERENCE_RELEASE_EXPIRED");
    wall = T + 30 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C3 credential lease expiry observed, then rollback: no revival", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + HOUR, phaseWindowMs: MIN });
  try {
    assert.equal(await c.attempt(), "OK");
    wall = T + MIN + 1; assert.equal(await c.attempt(), "NOVA_CREDENTIAL_LEASE_EXPIRED");
    wall = T + 30 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C4 rollback BEFORE any expiry fails closed and stays closed", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + HOUR });
  try {
    assert.equal(await c.attempt(), "OK"); wall = T - 5 * SEC;
    assert.equal(await c.attempt(), "NOVA_CLOCK_ROLLBACK"); wall = T + SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C5 an authority callback that throws an expiry category FIRST latches the context (pricing-like deadline earlier than the binding)", async () => {
  const T = Date.now(); let priced = T + MIN;
  const c = await component({ approvalAt: T + HOUR, extraCheck: () => { if (priced <= Date.now()) throw new PilotError("PricingNotValid"); } });
  try {
    assert.equal(await c.attempt(), "OK");
    wall = T + MIN + 1; assert.equal(await c.attempt(), "PricingNotValid");
    wall = T + 30 * SEC; priced = T + MIN; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C6/C7 expiry during asynchronous signing, then rollback: zero dispatch and still blocked", async () => {
  const T = Date.now(); let jump = false;
  const c = await component({ approvalAt: T + MIN, signingHook: () => { if (jump) { jump = false; wall = T + MIN + 1; } } });
  try {
    jump = true; assert.equal(await c.attempt(), "LiveNotApproved"); assert.equal(http.calls.length, 0);
    wall = T + 30 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 0);
  } finally { c.close(); }
});
scenario("P1-C8 expiry during credential admission (STS in flight) is rejected; nothing to revive", async () => {
  const T = Date.now();
  await assert.rejects(component({ approvalAt: T + MIN, assumeHook: () => { wall = T + MIN + 1; } }), (e) => e instanceof PilotError && e.code === "LiveNotApproved");
  assert.equal(http.calls.length, 0);
});
scenario("P1-C9 two concurrent attempts on one context: once expiry is observed neither dispatches, before or after rollback", async () => {
  const T = Date.now(); let n = 0;
  const c = await component({ approvalAt: T + MIN, signingHook: () => { if (++n === 1) wall = T + MIN + 1; } });
  try {
    const [a, b] = await Promise.all([c.attempt("A"), c.attempt("B")]);
    assert.ok(blocked(a) && blocked(b)); assert.equal(http.calls.length, 0);
    wall = T + 30 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 0);
  } finally { c.close(); }
});
scenario("P1-C10/C11 separate contexts are isolated: an expired context stays blocked while a new admission is independent", async () => {
  const T = Date.now(), a = await component({ approvalAt: T + MIN });
  try {
    assert.equal(await a.attempt(), "OK"); wall = T + MIN + 1; assert.equal(await a.attempt(), "LiveNotApproved");
    const b = await component({ approvalAt: T + HOUR }); // fresh signed admission (later approval)
    try { assert.equal(await b.attempt(), "OK"); wall = T + 30 * SEC; assert.ok(blocked(await a.attempt())); assert.equal(http.calls.length, 2); }
    finally { b.close(); }
  } finally { a.close(); }
});
scenario("P1-C12 invalid clock values fail closed without restoring an expired context", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + MIN });
  try {
    wall = NaN; assert.equal(await c.attempt(), "NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
    wall = T + SEC; assert.equal(await c.attempt(), "OK");
    wall = T + MIN + 1; assert.equal(await c.attempt(), "LiveNotApproved");
    wall = NaN; assert.ok(blocked(await c.attempt())); wall = T + 2 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C13 wall clock stalled while the monotonic clock passes the deadline: expiry is observed and sticky", async () => {
  const T = Date.now(); mono = realHr();
  const c = await component({ approvalAt: T + MIN });
  try {
    assert.equal(await c.attempt(), "OK");
    mono = mono! + BigInt(61 * SEC) * 1_000_000n; assert.ok(blocked(await c.attempt()));
    mono = mono! - BigInt(61 * SEC) * 1_000_000n; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("P1-C14 approval and release expiring together: approval category, sticky after rollback", async () => {
  const T = Date.now(), c = await component({ approvalAt: T + MIN, releaseAt: T + MIN, scope: "INFERENCE_ONLY" });
  try { wall = T + MIN; assert.equal(await c.attempt(), "LiveNotApproved"); wall = T + 30 * SEC; assert.ok(blocked(await c.attempt())); assert.equal(http.calls.length, 0); }
  finally { c.close(); }
});

// ---- prepared-session level (AX-ROLLBACK-SESSION): actual openPreparedEvaluationSession with fixture authority ----
const clean = !execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: implementationRoot, encoding: "utf8", windowsHide: true }).trim();
const needsClean = { skip: clean ? false : "LIVE pins require a clean checkout of the executing code; run in a clean checkout" };
const keys = generateKeyPairSync("ed25519"), ISSUER = "revival-fixture-issuer";
const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
async function sessionFixture() {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-revival-cal01"), b = fixturePilotInput(claimDevScenarios[1].request, "case-revival-cal06");
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const k of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[k].push(...second[k]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const syn = syntheticClaimData(), file = (n: string) => path.join(a.root, "private", n);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(syn.input)); fs.writeFileSync(file("map.json"), JSON.stringify(syn.map)); fs.writeFileSync(file("owner.json"), syn.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: syn.pins }));
  const c: SessionConfig = pilotConfig();
  Object.assign(c, { mode: "LIVE", liveOptIn: true, profileModelConfirmed: true, transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null,
    outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion: "CLAIM_PROMPT_V4_1", design: { arms: ["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"], policies: ["MINIMAL"], repeats: 2 },
    budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    sources: { workspaceRoot: implementationRoot, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") } });
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner", expiresAt: new Date(Date.now() + 24 * HOUR).toISOString() });
  const p = await calculatePilotPins(implementationRoot, a.casesFile, c.design, c.sources, c.promptVersion); c.pins = p.pins;
  c.novaScope = { tokenPayloadHashes: [...new Set(p.preparation.rows.map((r) => serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash))], measureCalls: 4, inferenceCalls: 8,
    awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED }, phases: NOVA_TWO_PHASE };
  const ledger = path.join(a.root, "ledger"); fs.mkdirSync(ledger);
  const trust = { version: "owner-trust-v1", issuer: ISSUER, publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
  let resolutions = 0;
  const credentialFixture: NovaCredentialFixture = { metadataDisabled: "true", loadFiles: async () => ({ configFile: { "gymini-fixture-profile": { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "fixture-source" } }, credentialsFile: { "fixture-source": { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } } } as any),
    assumeRole: async () => { resolutions++; return { accessKeyId: "ASIATESTFIXTURE", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 2 * HOUR) }; } };
  const clients: any[] = [];
  const resolvedSend = (credentials: any, binding: NovaHttpSessionBinding) => { const client = createNovaRuntimeClient("gymini-fixture-profile", credentials); clients.push(client); return novaRuntimeSend(client, binding); };
  const unusedSend = async () => { throw new Error("TEST: legacy rehearsal send must not be used with credential admission"); };
  const signed = (expiresAt: number) => { const x: SessionConfig = structuredClone({ ...c, approval: null }); const body = { approvalId: randomUUID(), issuer: ISSUER, approvedBy: "TEST FIXTURE owner", scope: "BEDROCK_EVALUATION_PILOT" as const, configHash: approvedConfigurationHash(x), expiresAt: new Date(expiresAt).toISOString() };
    x.approval = { ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") };
    openJournal(path.join(ledger, x.approval.approvalId + ".jsonl"), true).append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId: x.approval.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), scope: novaLedgerScope(x) }); return x; };
  const release = (x: SessionConfig, expiresAt: number) => { const m = measurementPhaseRecord(ledger, x.approval!.approvalId)!;
    const body = { version: "nova-inference-release-v1", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), issuer: ISSUER, releasedBy: "TEST FIXTURE owner", measurementRecordHash: m.hash, measuredCounts: m.state.counts, expiresAt: new Date(expiresAt).toISOString() };
    fs.writeFileSync(inferenceReleaseFile(ledger, x.approval!.approvalId), JSON.stringify({ ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") })); };
  const open = async (x: SessionConfig, dir: string, o: { measureOnly?: boolean; resume?: boolean }) =>
    openPreparedEvaluationSession(x, dir, undefined, { verifiedPins: await verifySessionPins(x), liveRehearsal: { trust, send: unusedSend as any, credentialFixture, resolvedSend }, ...o });
  const events = (x: SessionConfig) => (openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl")).records as { event: string }[]).map((r) => r.event);
  return { root: a.root, rows: p.preparation.rows, signed, release, open, events, resolutions: () => resolutions,
    close: () => { for (const k of clients) k.destroy(); fs.rmSync(a.root, { recursive: true, force: true }); } };
}
test("P1-S1 AX-ROLLBACK-SESSION: prepared measurement session never dispatches after observing approval expiry, even after rollback", needsClean, async () => {
  useClock(); http.calls = []; const restore = stubHttp(); const f = await sessionFixture();
  try {
    const T = Date.now(), x = f.signed(T + 2 * MIN), dir = path.join(f.root, "run"), prompts = [...new Map(f.rows.map((r) => [r.promptHash, r.prompt])).values()];
    const s = await f.open(x, dir, { measureOnly: true });
    assert.equal(await code(s.previewTokenCounts([prompts[0]])), "OK"); assert.equal(http.calls.length, 1);
    wall = T + 2 * MIN + 1; assert.equal(await code(s.previewTokenCounts([prompts[1]])), "LiveNotApproved");
    wall = T + 90 * SEC; const after = await code(s.previewTokenCounts([prompts[2]]));
    const ev = f.events(x);
    assert.ok(blocked(after), "prepared session revived after observed expiry: " + after);
    assert.equal(http.calls.length, 1, "no HTTP dispatch after observed expiry");
    assert.equal(ev.filter((e) => e === "MEASURE_RESERVED").length, 1, "no reservation after observed expiry: " + ev.join(">"));
    assert.equal(f.resolutions(), 1); await s.close();
  } finally { f.close(); restore(); restoreClock(); }
});
test("P1-S2 inference-release revival: prepared inference session never dispatches after observing release expiry, even after rollback", needsClean, async () => {
  useClock(); http.calls = []; const restore = stubHttp(); const f = await sessionFixture();
  try {
    const T = Date.now(), x = f.signed(T + HOUR), dir = path.join(f.root, "run"), prompts = [...new Map(f.rows.map((r) => [r.promptHash, r.prompt])).values()];
    const m = await f.open(x, dir, { measureOnly: true }); await m.previewTokenCounts(prompts); await m.completeMeasurementPhase(); await m.close();
    assert.equal(http.calls.length, 4);
    const R = Date.now() + 2 * MIN; f.release(x, R);
    const s = await f.open(x, dir, { resume: true });
    const r1 = await s.evaluate(f.rows[0].prompt, "revival-1") as { providerError: string | null }; assert.equal(r1.providerError, null); assert.equal(http.calls.length, 5);
    wall = R + 1; assert.equal(await code(s.evaluate(f.rows[1].prompt, "revival-2")), "INFERENCE_RELEASE_EXPIRED");
    wall = R - 30 * SEC; const after = await code(async () => { const r = await s.evaluate(f.rows[2].prompt, "revival-3") as { providerError: string | null }; if (r.providerError) throw new PilotError(r.providerError); });
    const ev = f.events(x);
    assert.ok(blocked(after), "inference release revived after rollback: " + after);
    assert.equal(http.calls.length, 5, "no inference HTTP after observed release expiry");
    assert.equal(ev.filter((e) => e === "INFERENCE_RESERVED").length, 1, "no new inference reservation: " + ev.join(">"));
    assert.equal(f.resolutions(), 2); await s.close();
  } finally { f.close(); restore(); restoreClock(); }
});
test("P1-S3 crash/resume: a fresh signed admission (new process equivalent) works while the signed deadline is genuinely in the future", needsClean, async () => {
  useClock(); http.calls = []; const restore = stubHttp(); const f = await sessionFixture();
  try {
    const T = Date.now(), x = f.signed(T + HOUR), dir = path.join(f.root, "run"), prompts = [...new Map(f.rows.map((r) => [r.promptHash, r.prompt])).values()];
    const a = await f.open(x, dir, { measureOnly: true }); assert.equal(await code(a.previewTokenCounts([prompts[0]])), "OK"); await a.close();
    const b = await f.open(x, dir, { measureOnly: true, resume: true }); assert.equal(await code(b.previewTokenCounts([prompts[1]])), "OK"); await b.close();
    assert.equal(http.calls.length, 2); assert.equal(f.resolutions(), 2);
  } finally { f.close(); restore(); restoreClock(); }
});
