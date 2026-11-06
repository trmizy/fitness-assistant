/** TEST FIXTURE: actual SDK, synthetic credentials/files, in-memory handler; no account/provider network IO. */
import nodeTest, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BedrockRuntimeClient, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { loadSharedConfigFiles } from "@smithy/core/config";
import { createNovaRuntimeClient, novaRuntimeSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import { resolveNovaCredentials, consumeNovaCredentials, type NovaCredentialFixture } from "../evaluation/bedrock-pilot/nova-credentials";
import { NOVA_ENDPOINT, NOVA_HOST } from "../evaluation/bedrock-pilot/nova-endpoint";
import { serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { type NovaHttpSessionBinding, type NovaHttpAuthorization } from "../evaluation/bedrock-pilot/nova-http-boundary";
import { PilotError } from "../evaluation/bedrock-pilot/config";

let audit: { authorization: string; providerCalls: number; bedrockHandlerCalls: number; ledgerReservations: number; journal: string; networkDestinations: string[]; categories: string[] };
const test = (name: string, run: (t: TestContext) => unknown) => nodeTest(name, async t => {
  audit = { authorization: "SYNTHETIC_COMPONENT_AUTHORITY_NO_OWNER", providerCalls: 0, bedrockHandlerCalls: 0, ledgerReservations: 0, journal: "NOT_CREATED_COMPONENT_PROBE", networkDestinations: [], categories: [] };
  let pass = false; try { await run(t); pass = true; } finally { t.diagnostic(JSON.stringify({ ...audit, result: pass ? "PASS" : "FAIL" })); }
});
const is = (code: string) => (e: unknown) => { const match = e instanceof PilotError && e.code === code; if (match) audit.categories.push(code); return match; };
const input = (maxTokens = 2048): ConverseCommandInput => ({ modelId: "amazon.nova-pro-v1:0", messages: [{ role: "user", content: [{ text: "SYNTHETIC ONLY" }] }], inferenceConfig: { maxTokens, temperature: 0.2 } });
const credentials = () => ({ accessKeyId: "TESTFIXTUREACCESSKEY", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 7200000) });
function fixture(options: { endpoint?: string; fips?: boolean; status?: number; delayHandler?: boolean } = {}) {
  let calls = 0; const requests: any[] = [], binding: NovaHttpSessionBinding = { approvalId: "FAKE_APPROVAL", approvalHash: "a".repeat(64), configHash: "c".repeat(64), ledgerDirectory: "FAKE_LEDGER", scope: "ONE_SHOT", approvalExpiresAt: new Date(Date.now() + 10000).toISOString(), inferenceReleaseExpiresAt: null };
  const client = new BedrockRuntimeClient({ region: "us-east-1", credentials: credentials(), maxAttempts: 1, ...(options.endpoint ? { endpoint: options.endpoint } : {}), ...(options.fips ? { useFipsEndpoint: true } : {}), requestHandler: {
    async handle(r: any) { calls++; audit.bedrockHandlerCalls++; audit.networkDestinations.push(`${r.protocol}//${r.hostname}:${r.port ?? 443}${r.path}`); if (options.delayHandler) await Promise.resolve(); requests.push(r); return { response: { statusCode: options.status ?? 200, headers: { "content-type": "application/json", ...(options.status ? { location: "https://unapproved.invalid" } : {}) }, body: Buffer.from(JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "{}" }] } }, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 }, metrics: { latencyMs: 1 } })) } }; }, destroy() {} } });
  const send = novaRuntimeSend(client, binding), authority = (ordinal = 1): NovaHttpAuthorization => ({ binding, phase: "INFERENCE", reservationId: "fake-" + ordinal, reservationOrdinal: ordinal, promptHash: "d".repeat(64), ...(() => { const w = serializeNova(input()).identity; return { tokenPayloadHash: w.tokenPayloadHash, requestHash: w.inferenceRequestHash }; })(), assertCurrent() {} });
  return { client, send, authority, calls: () => calls, requests, binding, close: () => client.destroy() };
}
const signal = () => new AbortController().signal;
test("approved regional endpoint passes; actual HTTP body is distinct from serialized SDK input and cannot be mutated", async () => {
  const f = fixture({ delayHandler: true });
  f.client.middlewareStack.addRelativeTo((next: any) => (args: any) => { const pending = next(args); args.request.hostname = "unapproved.invalid"; args.request.headers.host = "unapproved.invalid"; if (args.request.body instanceof Uint8Array) args.request.body.fill(0); return pending; }, { name: "retainAndMutate", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try { await f.send(input(), signal(), f.authority()); assert.equal(f.calls(), 1); const r = f.requests[0]; assert.equal(r.hostname, NOVA_HOST); assert.equal(r.protocol, "https:"); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.headers)); assert.equal(typeof r.body, "string"); const { modelId: _, ...body } = input(); assert.deepEqual(JSON.parse(r.body), body); assert.notEqual(r.body, serializeNova(input()).inferenceBody); }
  finally { f.close(); }
});
for (const [name, endpoint] of [["wrong host", "https://unapproved.invalid"], ["suffix attack", "https://" + NOVA_HOST + ".unapproved.invalid"], ["wrong scheme", "http://" + NOVA_HOST], ["wrong port", NOVA_ENDPOINT + ":444"]]) test(name + " is rejected before HTTP", async () => {
  const f = fixture({ endpoint }); try { await assert.rejects(f.send(input(), signal(), f.authority()), is("NOVA_HTTP_ENDPOINT_MISMATCH")); assert.equal(f.calls(), 0); } finally { f.close(); }
});
test("FIPS resolved endpoint is rejected before HTTP", async () => { const f = fixture({ fips: true }); try { await assert.rejects(f.send(input(), signal(), f.authority()), is("NOVA_HTTP_ENDPOINT_MISMATCH")); assert.equal(f.calls(), 0); } finally { f.close(); } });
test("signed destination mutation is rejected before delegate invocation", async () => {
  const f = fixture(); f.client.middlewareStack.addRelativeTo((next: any) => (args: any) => { args.request.hostname = "unapproved.invalid"; return next(args); }, { name: "mutateDestination", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try { await assert.rejects(f.send(input(), signal(), f.authority()), is("NOVA_HTTP_ENDPOINT_MISMATCH")); assert.equal(f.calls(), 0); } finally { f.close(); }
});
test("redirect response is rejected and never followed", async () => { const f = fixture({ status: 307 }); try { await assert.rejects(f.send(input(), signal(), f.authority()), is("NOVA_HTTP_REDIRECT_FORBIDDEN")); assert.equal(f.calls(), 1); } finally { f.close(); } });
for (const key of ["AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "AWS_ENDPOINT_URL_STS", "AWS_USE_FIPS_ENDPOINT", "AWS_USE_DUALSTACK_ENDPOINT"]) test(key + " override fails at client construction", () => {
  const prior = process.env[key]; process.env[key] = key.includes("ENDPOINT_URL") ? "https://unapproved.invalid" : "true";
  try { assert.throws(() => createNovaRuntimeClient("fixture", credentials()), is("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN")); } finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
});
test("wall-clock rollback cannot revive observed expired authority in the same client", async () => {
  const real = Date.now; let now = real(); Date.now = () => now; const f = fixture();
  try { now += 10001; await assert.rejects(f.send(input(), signal(), f.authority()), is("LiveNotApproved")); now -= 10001; await assert.rejects(f.send(input(), signal(), f.authority(2)), is("NOVA_CLOCK_ROLLBACK")); assert.equal(f.calls(), 0); }
  finally { Date.now = real; f.close(); }
});

function provider(options: { profile?: Record<string, string>; source?: Record<string, string>; failure?: string; result?: () => ReturnType<typeof credentials>; hook?: () => void } = {}) {
  let loads = 0, calls = 0; const files = { configFile: { fixture: { role_arn: "arn:aws:iam::123456789012:role/TEST_FIXTURE", source_profile: "source", region: "us-east-1", ...options.profile } }, credentialsFile: { source: { aws_access_key_id: "TESTFIXTUREACCESSKEY", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL", ...options.source } } };
  const fixture: NovaCredentialFixture = { metadataDisabled: "true", loadFiles: async () => { loads++; return files; }, assumeRole: async (_source, params, check) => { calls++; audit.providerCalls++; audit.networkDestinations.push("FAKE_STS_PROVIDER_NO_NETWORK"); assert.equal(params.RoleArn, files.configFile.fixture.role_arn); check(); await Promise.resolve(); options.hook?.(); if (options.failure) throw Error(options.failure); return options.result?.() ?? credentials(); } };
  return { fixture, files, loads: () => loads, calls: () => calls };
}
const args = () => ({ profile: "fixture", binding: "test-binding", validUntil: new Date(Date.now() + 3600000).toISOString(), assertAuthority() {} });
test("one explicit STS resolution is consumed once; SDK requests use a credential object without refreshing the provider", async () => {
  const p = provider(), receipt = await resolveNovaCredentials(args(), p.fixture);
  assert.throws(() => consumeNovaCredentials(receipt, "test-binding"), is("NOVA_PRE_RESOLVED_CREDENTIALS_REQUIRED"));
  const lease = consumeNovaCredentials(receipt, "test-binding", true);
  const client = createNovaRuntimeClient("fixture", lease.credentials); try { for (let i = 0; i < 8; i++) await client.config.credentials(); assert.equal(p.calls(), 1); assert.equal(p.loads(), 1); assert.throws(() => consumeNovaCredentials(receipt, "test-binding"), is("NOVA_PRE_RESOLVED_CREDENTIALS_REQUIRED")); } finally { client.destroy(); }
});
test("STS failure has a pre-session credential category, never a Bedrock provider response", async () => { const p = provider({ failure: "TEST FIXTURE secret omitted" }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_STS_ASSUME_ROLE_FAILED")); assert.equal(p.calls(), 1); });
test("file-resolution failure is distinct from STS failure", async () => { const p = provider(); p.fixture.loadFiles = async () => { throw Error("TEST FIXTURE"); }; await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CREDENTIAL_RESOLUTION_FAILED")); assert.equal(p.calls(), 0); });
for (const patch of ([{ credential_source: "Ec2InstanceMetadata" }, { credential_source: "EcsContainer" }, { credential_source: "Environment" }, { credential_process: "FAKE_ONLY" }, { web_identity_token_file: "FAKE_ONLY" }, { sso_session: "FAKE_ONLY" }, { source_profile: "missing" }] as Record<string, string>[])) test("unsupported profile cannot activate fallback: " + Object.keys(patch)[0] + ":" + Object.values(patch)[0], async () => {
  const p = provider({ profile: patch }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CREDENTIAL_PROFILE_UNSUPPORTED")); assert.equal(p.calls(), 0);
});
for (const patch of ([{ endpoint_url: "https://unapproved.invalid" }, { services: "unapproved" }, { use_fips_endpoint: "true" }] as Record<string, string>[])) test("profile endpoint override blocked before STS: " + Object.keys(patch)[0], async () => {
  const p = provider({ profile: patch }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN")); assert.equal(p.calls(), 0);
});
test("IMDS must be disabled explicitly; there is no metadata fallback", async () => { const p = provider(); p.fixture.metadataDisabled = "false"; await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_IMDS_MUST_BE_DISABLED")); assert.equal(p.loads(), 0); assert.equal(p.calls(), 0); });
test("credentials too short for the signed phase fail closed", async () => { const p = provider({ result: () => ({ ...credentials(), expiration: new Date(Date.now() + 1000) }) }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CREDENTIAL_VALIDITY_INSUFFICIENT")); assert.equal(p.calls(), 1); });
test("credentials expiring during provider preflight are rejected", async () => { const p = provider({ result: () => ({ ...credentials(), expiration: new Date(Date.now() - 1) }) }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CREDENTIALS_EXPIRED")); assert.equal(p.calls(), 1); });
for (const expiryCategory of ["LiveNotApproved", "INFERENCE_RELEASE_EXPIRED"] as const) test(expiryCategory + " during already-running STS discards credentials before claim", async () => {
  const real = Date.now; let now = real(); Date.now = () => now; const a = { ...args(), validUntil: new Date(now + 1000).toISOString(), expiryCategory }, p = provider({ hook: () => { now += 1001; } });
  try { await assert.rejects(resolveNovaCredentials(a, p.fixture), is(expiryCategory)); assert.equal(p.calls(), 1); } finally { Date.now = real; }
});
test("clock rollback during STS invalidates the lease rather than reviving it", async () => {
  const real = Date.now; let now = real(); Date.now = () => now; const p = provider({ hook: () => { now -= 1000; } });
  try { await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CLOCK_ROLLBACK")); assert.equal(p.calls(), 1); } finally { Date.now = real; }
});
test("real INI loader reads only fixture files; explicit profile endpoint is rejected without any provider network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-profile-")), config = path.join(dir, "config"), creds = path.join(dir, "credentials"), p = provider();
  fs.writeFileSync(config, "[profile fixture]\nrole_arn = arn:aws:iam::123456789012:role/TEST_FIXTURE\nsource_profile = source\nendpoint_url = https://unapproved.invalid\n"); fs.writeFileSync(creds, "[source]\naws_access_key_id = TESTFIXTUREACCESSKEY\naws_secret_access_key = TEST_FIXTURE_NOT_REAL\n");
  p.fixture.loadFiles = () => loadSharedConfigFiles({ configFilepath: config, filepath: creds, ignoreCache: true });
  try { await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_ENDPOINT_OVERRIDE_FORBIDDEN")); assert.equal(p.calls(), 0); } finally { fs.rmSync(dir, { recursive: true }); }
});
test("environment credentials and another default profile cannot replace the explicit source profile", async () => {
  const p = provider(), original = p.fixture.assumeRole, prior = { key: process.env.AWS_ACCESS_KEY_ID, profile: process.env.AWS_PROFILE };
  process.env.AWS_ACCESS_KEY_ID = "OTHER_FAKE_KEY"; process.env.AWS_PROFILE = "unapproved-default";
  p.fixture.assumeRole = async (source, ...rest) => { assert.equal(source.accessKeyId, "TESTFIXTUREACCESSKEY"); return original(source, ...rest); };
  try { const receipt = await resolveNovaCredentials(args(), p.fixture); consumeNovaCredentials(receipt, "test-binding", true); assert.equal(p.calls(), 1); }
  finally { if (prior.key === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = prior.key; if (prior.profile === undefined) delete process.env.AWS_PROFILE; else process.env.AWS_PROFILE = prior.profile; }
});
test("a source profile with a process/metadata/role fallback is rejected even when it also has static keys", async () => {
  for (const source of [{ credential_process: "FAKE_ONLY" }, { credential_source: "Ec2InstanceMetadata" }, { role_arn: "arn:aws:iam::123456789012:role/OTHER_FAKE" }] as Record<string, string>[]) {
    const p = provider({ source }); await assert.rejects(resolveNovaCredentials(args(), p.fixture), is("NOVA_CREDENTIAL_PROFILE_UNSUPPORTED")); assert.equal(p.calls(), 0);
  }
});
