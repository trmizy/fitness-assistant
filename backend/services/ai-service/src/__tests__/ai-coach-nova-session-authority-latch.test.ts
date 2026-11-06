/**
 * TEST FIXTURE: session-level authority latch (independent review E3_RUN4_P1_849851F8_INDEPENDENT_REVIEW_BLOCKED, S-GAP).
 * Invariant: once a prepared authorization context has OBSERVED expiry ANYWHERE (session check, lease or HTTP boundary),
 * neither the session nor its lease nor any HTTP guard built from that lease may reserve or dispatch again, even after a
 * wall-clock step back. Expiry "crossings" are anchored to the exact un-latched call site by stack inspection.
 * Real prepared session, production client factory (NodeHttp2Handler prototype-stubbed in memory), fixture Ed25519
 * trust, FAKE_TEST_ONLY ledgers in temp dirs. No AWS.
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
import { novaAuthorityLatch } from "../evaluation/bedrock-pilot/nova-clock";
import type { NovaHttpAuthorization, NovaHttpSessionBinding } from "../evaluation/bedrock-pilot/nova-http-boundary";
import { openJournal } from "../evaluation/bedrock-pilot/storage";
import { canonical, digest } from "../evaluation/evaluation-kit/identity";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
const errCode = (e: unknown) => e instanceof PilotError ? e.code : (e as Error)?.name ?? String(e);
const code = async (p: Promise<unknown> | (() => unknown)) => { try { await (typeof p === "function" ? p() : p); return "OK"; } catch (e) { return errCode(e); } };

// ---- deterministic wall + monotonic clocks; optional stack-anchored crossing (wall forward step at one call site) ----
const realNow = Date.now, realHr = process.hrtime.bigint;
let wall = realNow(), mono = realHr(), M0 = mono, T0 = wall;
let crossing: { site: RegExp; to: number; honest: boolean; fired: boolean } | null = null;
const monoAt = (w: number) => M0 + BigInt(Math.round(w - T0)) * 1_000_000n;
function useClock() {
  wall = T0 = realNow(); mono = M0 = realHr(); crossing = null; Error.stackTraceLimit = 80;
  Date.now = () => { if (crossing && !crossing.fired && crossing.site.test(new Error().stack ?? "")) { crossing.fired = true; wall = crossing.to; if (crossing.honest) mono = monoAt(crossing.to); } return wall; };
  (process.hrtime as any).bigint = () => mono;
}
function restoreClock() { Date.now = realNow; (process.hrtime as any).bigint = realHr; crossing = null; Error.stackTraceLimit = 10; }

// ---- in-memory Bedrock transport on every loaded node-http-handler instance ----
const handlerModules = [...new Set(["@aws-sdk/client-sts", "@aws-sdk/client-bedrock-runtime"].map((m) => createRequire(require.resolve(m)).resolve("@smithy/node-http-handler")))].map((p) => require(p));
const http = { calls: [] as { measure: boolean }[] };
const tokensOf = (i: ConverseCommandInput) => Math.ceil(Buffer.byteLength(JSON.stringify(serializeNova(i).canonical), "utf8") / 4);
const answer = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic latch fixture.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
function stubHttp() {
  const saved = handlerModules.map((m) => [m.NodeHttp2Handler.prototype.handle, m.NodeHttpHandler.prototype.handle]);
  const handle = async function (request: any) {
    const raw = typeof request.body === "string" ? request.body : Buffer.from(request.body.buffer, request.body.byteOffset, request.body.byteLength).toString("utf8");
    const i = { modelId: NOVA_MODEL, ...JSON.parse(raw) } as ConverseCommandInput, measure = i.inferenceConfig!.maxTokens === 1;
    http.calls.push({ measure });
    const body = measure ? { output: { message: { role: "assistant", content: [{ text: "{" }] } }, stopReason: "max_tokens", usage: { inputTokens: tokensOf(i), outputTokens: 1, totalTokens: tokensOf(i) + 1 }, metrics: { latencyMs: 1 } }
      : { output: { message: { role: "assistant", content: [{ text: answer }] } }, stopReason: "end_turn", usage: { inputTokens: tokensOf(i), outputTokens: 40, totalTokens: tokensOf(i) + 40 }, metrics: { latencyMs: 1 } };
    return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) } };
  };
  for (const m of handlerModules) { m.NodeHttp2Handler.prototype.handle = handle; m.NodeHttpHandler.prototype.handle = async () => { throw new Error("TEST: no STS transport expected"); }; }
  return () => { for (const [i, m] of handlerModules.entries()) { m.NodeHttp2Handler.prototype.handle = saved[i][0]; m.NodeHttpHandler.prototype.handle = saved[i][1]; } };
}

// ---- component level: real lease, production client and boundary, session-equivalent callback ----
const fixtureCreds = (): NovaCredentialFixture => ({ metadataDisabled: "true",
  loadFiles: async () => ({ configFile: { fixture: { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "source" } }, credentialsFile: { source: { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } } } as any),
  assumeRole: async () => ({ accessKeyId: "ASIATESTFIXTURE", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 2 * HOUR) }) });
async function component(o: { approvalAt: number; pricingAt?: number; phaseWindowMs?: number; afterSign?: () => void; extra?: () => void }) {
  const callback = () => { o.extra?.(); const n = Date.now(); if (o.pricingAt !== undefined && o.pricingAt <= n) throw new PilotError("PricingNotValid"); if (o.approvalAt <= n) throw new PilotError("LiveNotApproved"); };
  const receipt = await resolveNovaCredentials({ profile: "fixture", binding: "component", validUntil: new Date(o.approvalAt).toISOString(), approvalExpiresAt: new Date(o.approvalAt).toISOString(), assertAuthority: callback, phaseWindowMs: o.phaseWindowMs ?? 30 * MIN }, fixtureCreds());
  const lease = consumeNovaCredentials(receipt, "component", true);
  const binding: NovaHttpSessionBinding = Object.freeze({ approvalId: "A", approvalHash: "a".repeat(64), configHash: "c".repeat(64), ledgerDirectory: "L", approvalExpiresAt: new Date(o.approvalAt).toISOString(), inferenceReleaseExpiresAt: null, scope: "ONE_SHOT" });
  const clients: any[] = []; let ordinal = 0;
  const guard = (withLeaseCallback = true) => {
    const client = createNovaRuntimeClient("fixture", lease.credentials); clients.push(client);
    if (o.afterSign) client.middlewareStack.addRelativeTo((next: any) => async (a: any) => { o.afterSign!(); return next(a); }, { name: "testAfterSign", relation: "after", toMiddleware: "httpSigningMiddleware" });
    const send = novaRuntimeSend(client, binding);
    return (text = "SYNTHETIC " + randomUUID()) => {
      const input: ConverseCommandInput = { modelId: NOVA_MODEL, messages: [{ role: "user", content: [{ text }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } };
      const w = serializeNova(input), n = ++ordinal;
      const auth: NovaHttpAuthorization = Object.freeze({ binding, phase: "INFERENCE" as const, reservationId: `I:${n}`, reservationOrdinal: n, promptHash: "d".repeat(64), tokenPayloadHash: w.identity.tokenPayloadHash, requestHash: w.identity.inferenceRequestHash,
        assertCurrent: () => { if (withLeaseCallback) lease.assertCurrent(); callback(); } });
      return code(send(input, new AbortController().signal, auth));
    };
  };
  return { guard, lease, close: () => clients.forEach((c) => c.destroy()) };
}
function scenario(name: string, run: () => Promise<void>) { test(name, async () => { useClock(); http.calls = []; const restore = stubHttp(); try { await run(); } finally { restore(); restoreClock(); } }); }

scenario("L1 latch: the first terminal category survives a later clock rollback (reported, not replaced)", async () => {
  const latch = novaAuthorityLatch(); let t = 100;
  const observe = () => { if (t < 100) throw new PilotError("NOVA_CLOCK_ROLLBACK"); return t; };
  assert.throws(() => latch.check(observe, () => { throw new PilotError("LiveNotApproved"); }), (e: any) => e.code === "LiveNotApproved");
  t = 50; assert.throws(() => latch.check(observe, () => 1), (e: any) => e.code === "LiveNotApproved" && e.details.latchedTerminalAuthority === true && e.details.alsoObserved === "NOVA_CLOCK_ROLLBACK");
  t = 200; assert.throws(() => latch.check(() => t, () => 1), (e: any) => e.code === "LiveNotApproved"); assert.equal(latch.terminalCode, "LiveNotApproved");
});
scenario("L2 lease and HTTP boundary share ONE terminal state: expiry observed only at the handler (after signing) blocks the lease and any boundary rebuilt from it, even after rollback", async () => {
  const T = Date.now(); let jump = false;
  const c = await component({ approvalAt: T + MIN, afterSign: () => { if (jump) { jump = false; wall = T + MIN + 1; } } });
  try {
    const send = c.guard(); assert.equal(await send(), "OK"); jump = true; assert.equal(await send(), "LiveNotApproved"); assert.equal(http.calls.length, 1);
    wall = T + 30 * SEC;
    assert.throws(() => c.lease.assertCurrent(), (e: any) => e.code === "LiveNotApproved" && e.details.latchedTerminalAuthority === true);
    assert.equal(await c.guard()(), "LiveNotApproved", "a new client+boundary from the old lease must not start fresh");
    assert.equal(await c.guard(false)(), "LiveNotApproved", "even when its callback does not consult the lease");
    assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});
scenario("L3 precedence restored: pricing+approval and pricing+lease report PricingNotValid (callback first), still terminal after rollback", async () => {
  const T = Date.now();
  const a = await component({ approvalAt: T + MIN, pricingAt: T + MIN });
  try { assert.equal(await a.guard()(), "OK"); wall = T + MIN + 1; assert.equal(await a.guard()(), "PricingNotValid"); wall = T + 30 * SEC; assert.equal(await a.guard()(), "PricingNotValid"); } finally { a.close(); }
  wall = T; mono = M0;
  const b = await component({ approvalAt: T + HOUR, pricingAt: T + 200 * SEC, phaseWindowMs: 5 * MIN });
  try { wall = T + 5 * MIN + 1; mono = monoAt(wall); assert.throws(() => b.lease.assertCurrent(), (e: any) => e.code === "PricingNotValid"); wall = T + MIN; assert.throws(() => b.lease.assertCurrent(), (e: any) => e.code === "PricingNotValid"); }
  finally { b.close(); }
  assert.equal(http.calls.length, 1);
});
scenario("L4 a NON-terminal callback failure cannot hide an observed expiry: the callback category is reported once, then the latched expiry", async () => {
  const T = Date.now(); let fail = false;
  const c = await component({ approvalAt: T + MIN, extra: () => { if (fail) { fail = false; throw new PilotError("APPROVAL_AUTHORITY_CHANGED"); } } });
  try {
    const send = c.guard(); assert.equal(await send(), "OK");
    wall = T + MIN + 1; fail = true; assert.throws(() => c.lease.assertCurrent(), (e: any) => e.code === "APPROVAL_AUTHORITY_CHANGED");
    wall = T + 30 * SEC; assert.equal(await send(), "LiveNotApproved"); assert.equal(http.calls.length, 1);
  } finally { c.close(); }
});

// ---- prepared-session level ----
const clean = !execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: implementationRoot, encoding: "utf8", windowsHide: true }).trim();
const needsClean = { skip: clean ? false : "LIVE pins require a clean checkout of the executing code; run in a clean checkout" };
const keys = generateKeyPairSync("ed25519"), ISSUER = "session-latch-fixture-issuer";
const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();
async function sessionFixture() {
  const a = fixturePilotInput(claimDevScenarios[0].request, "case-latch-cal01"), b = fixturePilotInput(claimDevScenarios[1].request, "case-latch-cal06");
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
  Object.assign(c.pricing, { authority: "OWNER_CONFIRMED_AWS", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, confirmedBy: "TEST FIXTURE owner", checkedAt: new Date(Date.now() - HOUR).toISOString(), expiresAt: new Date(Date.now() + 24 * HOUR).toISOString() });
  const p = await calculatePilotPins(implementationRoot, a.casesFile, c.design, c.sources, c.promptVersion); c.pins = p.pins;
  c.novaScope = { tokenPayloadHashes: [...new Set(p.preparation.rows.map((r) => serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash))], measureCalls: 4, inferenceCalls: 8,
    awsProfile: "gymini-fixture-profile", ownerAcknowledgements: { ...NOVA_ACCEPTED }, phases: NOVA_TWO_PHASE };
  const ledger = path.join(a.root, "ledger"); fs.mkdirSync(ledger);
  const trust = { version: "owner-trust-v1", issuer: ISSUER, publicKeyPem: pem(keys.publicKey), ledgerDirectory: ledger };
  const credentialFixture: NovaCredentialFixture = { metadataDisabled: "true", loadFiles: async () => ({ configFile: { "gymini-fixture-profile": { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "fixture-source" } }, credentialsFile: { "fixture-source": { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } } } as any),
    assumeRole: async () => ({ accessKeyId: "ASIATESTFIXTURE", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 2 * HOUR) }) };
  const clients: any[] = [];
  const resolvedSend = (credentials: any, binding: NovaHttpSessionBinding) => { const client = createNovaRuntimeClient("gymini-fixture-profile", credentials); clients.push(client); return novaRuntimeSend(client, binding); };
  const unusedSend = async () => { throw new Error("TEST: legacy rehearsal send must not be used with credential admission"); };
  const signed = (expiresAt: number, mutate?: (x: SessionConfig) => void) => { const x: SessionConfig = structuredClone({ ...c, approval: null }); mutate?.(x);
    const body = { approvalId: randomUUID(), issuer: ISSUER, approvedBy: "TEST FIXTURE owner", scope: "BEDROCK_EVALUATION_PILOT" as const, configHash: approvedConfigurationHash(x), expiresAt: new Date(expiresAt).toISOString() };
    x.approval = { ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") };
    openJournal(path.join(ledger, x.approval.approvalId + ".jsonl"), true).append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId: x.approval.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), scope: novaLedgerScope(x) }); return x; };
  const release = (x: SessionConfig, expiresAt: number) => { const m = measurementPhaseRecord(ledger, x.approval!.approvalId)!;
    const body = { version: "nova-inference-release-v1", approvalId: x.approval!.approvalId, approvalHash: digest(x.approval), configHash: approvedConfigurationHash(x), issuer: ISSUER, releasedBy: "TEST FIXTURE owner", measurementRecordHash: m.hash, measuredCounts: m.state.counts, expiresAt: new Date(expiresAt).toISOString() };
    fs.writeFileSync(inferenceReleaseFile(ledger, x.approval!.approvalId), JSON.stringify({ ...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString("base64") })); };
  const open = async (x: SessionConfig, dir: string, o: { measureOnly?: boolean; resume?: boolean }) =>
    openPreparedEvaluationSession(x, dir, undefined, { verifiedPins: await verifySessionPins(x), liveRehearsal: { trust, send: unusedSend as any, credentialFixture, resolvedSend }, ...o });
  const reserved = (x: SessionConfig, kind: string) => (openJournal(path.join(ledger, x.approval!.approvalId + ".jsonl")).records as { event: string }[]).filter((r) => r.event === kind).length;
  const prompts = [...new Map(p.preparation.rows.map((r) => [r.promptHash, r.prompt])).values()];
  return { root: a.root, rows: p.preparation.rows, prompts, signed, release, open, reserved, close: () => { for (const k of clients) k.destroy(); fs.rmSync(a.root, { recursive: true, force: true }); } };
}
type Fixture = Awaited<ReturnType<typeof sessionFixture>>;
let shared: Fixture | null = null;
const fixture = async () => (shared ??= await sessionFixture());
test.after(() => shared?.close());
function sessionScenario(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, needsClean, async () => { const f = await fixture(); useClock(); http.calls = []; const restore = stubHttp(); try { await run(f); } finally { restore(); restoreClock(); } });
}
// The six observation sites reported by the independent review (S-GAP). A site is "<head> called from <caller>", either
// directly (849851f8 shape) or through the session's inAuthority() wrapper (session/nova-clock frames only: never via
// the lease or the HTTP boundary), so the crossing happens exactly at the session-level check and nowhere else.
const MID = /[^\n]*\n(?:(?:\s+at [^\n]*(?:session|nova-clock)\.ts[^\n]*\n)+\s+at inAuthority \([^\n]*\n)?\s+at /.source;
const site = (head: RegExp, caller: string) => new RegExp(head.source + MID + caller + " \\(");
const SITE_204 = site(/at assertCurrentAuthorization \(/, "authorize");
const SITE_206 = site(/at verifySignedApproval \([^\n]*\n\s+at approvalFromTrust \([^\n]*\n\s+at currentApproval \(/, "authorize");
const SITE_208 = site(/at assertCurrentInferenceRelease \(/, "authorize");
// attempt()'s own release check is its FIRST Date.now() read: directly in attempt (849851f8) or via inAuthority.
const SITE_284 = new RegExp(`(?:${/^Error\n\s+at [^\n]+\n\s+at attempt \(/.source})|(?:${site(/^Error\n\s+at [^\n]+\n\s+at [^\n]*session\.ts/, "attempt").source})`);
const SITE_DISPATCH = site(/at assertCurrentInferenceRelease \([^\n]*\n\s+at dispatchWithInferenceRelease \(/, "dispatchAuthorized");

async function measureGap(f: Fixture, site: RegExp, kind: "approval" | "pricing", honest: boolean) {
  const T = Date.now(), D = T + MIN;
  const x = kind === "pricing" ? f.signed(T + HOUR, (y) => { y.pricing.expiresAt = new Date(D).toISOString(); }) : f.signed(D);
  const s = await f.open(x, path.join(f.root, "gap-" + randomUUID()), { measureOnly: true });
  try {
    assert.equal(await code(s.previewTokenCounts([f.prompts[0]])), "OK"); assert.equal(http.calls.length, 1);
    wall = D - 2; if (honest) mono = monoAt(D - 2);
    crossing = { site, to: D + 1, honest, fired: false };
    const observed = await code(s.previewTokenCounts([f.prompts[1]]));
    assert.ok(crossing.fired, "crossing must fire at the anchored un-latched site"); crossing = null;
    assert.notEqual(observed, "OK");
    wall = D - 1; // step back above every latched observation, below the deadline
    const after = await code(s.previewTokenCounts([f.prompts[1]]));
    assert.notEqual(after, "OK", "revived after an observed expiry: " + after);
    assert.equal(after, observed, "the first terminal category is preserved");
    assert.equal(http.calls.length, 1, "no dispatch after observed expiry"); assert.equal(f.reserved(x, "MEASURE_RESERVED"), 1, "no reservation after observed expiry");
  } finally { await s.close(); }
}
sessionScenario("S-GAP-1 authorize → assertCurrentAuthorization (approval): observed expiry is terminal for the session", (f) => measureGap(f, SITE_204, "approval", false));
sessionScenario("S-GAP-1h same with an honest monotonic clock", (f) => measureGap(f, SITE_204, "approval", true));
sessionScenario("S-GAP-2 authorize → currentApproval (APPROVAL_EXPIRED): observed expiry is terminal for the session", (f) => measureGap(f, SITE_206, "approval", false));
sessionScenario("S-GAP-3 authorize → assertCurrentAuthorization (pricing): observed pricing expiry is terminal for the session", (f) => measureGap(f, SITE_204, "pricing", false));

async function inferenceGap(f: Fixture, site: RegExp) {
  const T = Date.now(), x = f.signed(T + HOUR), dir = path.join(f.root, "gapinf-" + randomUUID());
  const m = await f.open(x, dir, { measureOnly: true }); await m.previewTokenCounts(f.prompts); await m.completeMeasurementPhase(); await m.close();
  const R = T + MIN; f.release(x, R); wall = T + SEC;
  const s = await f.open(x, dir, { resume: true });
  try {
    const r1 = await s.evaluate(f.rows[0].prompt, "latch-1") as { providerError: string | null }; assert.equal(r1.providerError, null);
    const inference = () => http.calls.filter((c) => !c.measure).length; assert.equal(inference(), 1);
    wall = R - 2; crossing = { site, to: R + 1, honest: false, fired: false };
    const first = await code(async () => { const r = await s.evaluate(f.rows[1].prompt, "latch-2") as { providerError: string | null }; if (r.providerError) throw new PilotError(r.providerError); });
    assert.ok(crossing.fired, "crossing must fire at the anchored un-latched site"); crossing = null; assert.equal(first, "INFERENCE_RELEASE_EXPIRED");
    const reservedAfterObservation = f.reserved(x, "INFERENCE_RESERVED");
    wall = R - 1;
    const after = await code(async () => { const r = await s.evaluate(f.rows[2].prompt, "latch-3") as { providerError: string | null }; if (r.providerError) throw new PilotError(r.providerError); });
    assert.equal(after, "INFERENCE_RELEASE_EXPIRED", "revived after an observed release expiry: " + after);
    assert.equal(inference(), 1, "no inference dispatch after observed expiry");
    assert.equal(f.reserved(x, "INFERENCE_RESERVED"), reservedAfterObservation, "no new inference reservation after observed expiry");
  } finally { await s.close(); }
}
sessionScenario("S-GAP-4 authorize → assertCurrentInferenceRelease: observed release expiry is terminal for the session", (f) => inferenceGap(f, SITE_208));
sessionScenario("S-GAP-5 attempt() release check: observed release expiry is terminal for the session", (f) => inferenceGap(f, SITE_284));
sessionScenario("S-GAP-6 dispatchAuthorized release check (after reservation): observed release expiry is terminal for the session", (f) => inferenceGap(f, SITE_DISPATCH));

sessionScenario("S-CONCURRENT two concurrent session calls after an observed expiry: neither reserves nor dispatches, before or after rollback", async (f) => {
  const T = Date.now(), D = T + MIN, x = f.signed(D), s = await f.open(x, path.join(f.root, "conc-" + randomUUID()), { measureOnly: true });
  try {
    assert.equal(await code(s.previewTokenCounts([f.prompts[0]])), "OK");
    wall = D - 2; crossing = { site: SITE_204, to: D + 1, honest: false, fired: false };
    const [a, b] = await Promise.all([code(s.previewTokenCounts([f.prompts[1]])), code(s.previewTokenCounts([f.prompts[2]]))]);
    assert.ok(crossing.fired); crossing = null; assert.equal(a, "LiveNotApproved"); assert.equal(b, "LiveNotApproved");
    wall = D - 1; assert.equal(await code(s.previewTokenCounts([f.prompts[3]])), "LiveNotApproved");
    assert.equal(http.calls.length, 1); assert.equal(f.reserved(x, "MEASURE_RESERVED"), 1);
  } finally { await s.close(); }
});
sessionScenario("S-ISOLATION a terminal admission does not affect a separately signed admission; a new signed admission dispatches", async (f) => {
  const T = Date.now(), D = T + MIN, xa = f.signed(D), xb = f.signed(T + HOUR);
  const A = await f.open(xa, path.join(f.root, "iso-a-" + randomUUID()), { measureOnly: true }), B = await f.open(xb, path.join(f.root, "iso-b-" + randomUUID()), { measureOnly: true });
  try {
    assert.equal(await code(A.previewTokenCounts([f.prompts[0]])), "OK"); assert.equal(await code(B.previewTokenCounts([f.prompts[0]])), "OK");
    wall = D - 2; crossing = { site: SITE_204, to: D + 1, honest: false, fired: false };
    assert.equal(await code(A.previewTokenCounts([f.prompts[1]])), "LiveNotApproved"); crossing = null;
    assert.equal(await code(B.previewTokenCounts([f.prompts[1]])), "OK", "separately signed context unaffected");
    wall = D + 5; const xc = f.signed(T + HOUR), C = await f.open(xc, path.join(f.root, "iso-c-" + randomUUID()), { measureOnly: true });
    try { assert.equal(await code(C.previewTokenCounts([f.prompts[0]])), "OK", "new signed admission"); } finally { await C.close(); }
    assert.equal(await code(A.previewTokenCounts([f.prompts[2]])), "LiveNotApproved");
    assert.equal(http.calls.length, 4);
  } finally { await A.close(); await B.close(); }
});
