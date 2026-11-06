/**
 * TEST FIXTURE (developer regression for the dual-endpoint completion). The REAL STS client/boundary and the REAL
 * Bedrock client run against in-memory prototype stubs of @smithy/node-http-handler; synthetic keys and files only.
 * No STS/Bedrock/IMDS network request is possible: every handler call is captured before any socket is created.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadSharedConfigFiles } from "@smithy/core/config";
import { resolveNovaCredentials, consumeNovaCredentials, NOVA_CREDENTIAL_MARGIN_MS, type NovaCredentialFixture } from "../evaluation/bedrock-pilot/nova-credentials";
import { createNovaRuntimeClient, novaRuntimeSend } from "../evaluation/bedrock-pilot/nova-live-transport";
import { assertNoObservedClockRollback, NOVA_CLOCK_ROLLBACK_TOLERANCE_MS } from "../evaluation/bedrock-pilot/nova-clock";
import { serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { PilotError } from "../evaluation/bedrock-pilot/config";

// STS and Bedrock clients may resolve different @smithy/node-http-handler instances: stub every instance actually loaded.
const handlerModules = [...new Set(["@aws-sdk/client-sts", "@aws-sdk/client-bedrock-runtime"].map((m) => createRequire(require.resolve(m)).resolve("@smithy/node-http-handler")))].map((p) => require(p));
const handlers = {
  NodeHttpHandler: { prototype: { get handle() { return handlerModules.map((m) => m.NodeHttpHandler.prototype.handle); }, set handle(f: any) { for (const [i, m] of handlerModules.entries()) m.NodeHttpHandler.prototype.handle = Array.isArray(f) ? f[i] : f; } } },
  NodeHttp2Handler: { prototype: { get handle() { return handlerModules.map((m) => m.NodeHttp2Handler.prototype.handle); }, set handle(f: any) { for (const [i, m] of handlerModules.entries()) m.NodeHttp2Handler.prototype.handle = Array.isArray(f) ? f[i] : f; } } },
} as any;
const is = (code: string) => (e: unknown) => e instanceof PilotError && e.code === code;
const ROLE = "arn:aws:iam::123456789012:role/TEST_FIXTURE", ASSUMED = "arn:aws:sts::123456789012:assumed-role/TEST_FIXTURE/gymini-e3-nova-eval";
type Sts = { status?: number; arn?: string; expiresInMs?: number; location?: string };
function stubTransports(sts: Sts = {}) {
  const calls = { sts: [] as any[], bedrock: [] as any[] };
  const h1 = handlers.NodeHttpHandler.prototype.handle, h2 = handlers.NodeHttp2Handler.prototype.handle;
  handlers.NodeHttpHandler.prototype.handle = async function (request: any) {
    calls.sts.push({ protocol: request.protocol, hostname: request.hostname, port: request.port, path: request.path, auth: String(request.headers.authorization ?? "") });
    const status = sts.status ?? 200;
    if (status !== 200) return { response: { statusCode: status, headers: { "content-type": "text/xml", ...(sts.location ? { location: sts.location } : {}) }, body: Buffer.from('<ErrorResponse><Error><Type>Receiver</Type><Code>ServiceUnavailable</Code><Message>TEST FIXTURE</Message></Error><RequestId>t</RequestId></ErrorResponse>') } };
    const xml = `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials><AccessKeyId>ASIATESTFIXTURE</AccessKeyId><SecretAccessKey>TEST_FIXTURE_NOT_REAL</SecretAccessKey><SessionToken>TEST_FIXTURE_TOKEN</SessionToken><Expiration>${new Date(Date.now() + (sts.expiresInMs ?? 3600000)).toISOString()}</Expiration></Credentials><AssumedRoleUser><Arn>${sts.arn ?? ASSUMED}</Arn><AssumedRoleId>AROATESTFIXTURE:gymini-e3-nova-eval</AssumedRoleId></AssumedRoleUser></AssumeRoleResult><ResponseMetadata><RequestId>t</RequestId></ResponseMetadata></AssumeRoleResponse>`;
    return { response: { statusCode: 200, headers: { "content-type": "text/xml" }, body: Buffer.from(xml) } };
  };
  handlers.NodeHttp2Handler.prototype.handle = async function (request: any) {
    calls.bedrock.push({ hostname: request.hostname, auth: String(request.headers.authorization ?? "") });
    return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "{}" }] } }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } })) } };
  };
  return { calls, restore: () => { handlers.NodeHttpHandler.prototype.handle = h1; handlers.NodeHttp2Handler.prototype.handle = h2; } };
}
const files = (role: Record<string, string> = {}) => ({ configFile: { fixture: { role_arn: ROLE, source_profile: "source", region: "us-east-1", ...role } }, credentialsFile: { source: { aws_access_key_id: "AKIATESTFIXTURE00000", aws_secret_access_key: "TEST_FIXTURE_NOT_REAL" } } });
/** No assumeRole override: the production STS client + STS boundary run (in-memory transport only). */
const realStsFixture = (f = files()) => ({ metadataDisabled: "true", loadFiles: async () => f } as unknown as NovaCredentialFixture);
const args = (o: Record<string, unknown> = {}) => ({ profile: "fixture", binding: "b", validUntil: new Date(Date.now() + 72 * 3600000).toISOString(), assertAuthority() {}, phaseWindowMs: 13 * 60000, ...o });
async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>) {
  const prior: Record<string, string | undefined> = {}; for (const k of Object.keys(vars)) { prior[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await run(); } finally { for (const k of Object.keys(prior)) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; } }
}

test("production STS path: exactly one AssumeRole to https://sts.us-east-1.amazonaws.com signed with the source key, us-east-1/sts scope", async () => {
  const s = stubTransports();
  try {
    const receipt = await resolveNovaCredentials(args(), realStsFixture()), lease = consumeNovaCredentials(receipt, "b", true);
    assert.equal(s.calls.sts.length, 1); const c = s.calls.sts[0];
    assert.equal(c.protocol, "https:"); assert.equal(c.hostname, "sts.us-east-1.amazonaws.com"); assert.ok(c.port === undefined || c.port === 443); assert.equal(c.path, "/");
    assert.match(c.auth, /^AWS4-HMAC-SHA256 Credential=AKIATESTFIXTURE00000\/\d{8}\/us-east-1\/sts\/aws4_request, /);
    assert.equal(lease.credentials.accessKeyId, "ASIATESTFIXTURE");
  } finally { s.restore(); }
});
test("STS 503 is not retried (one attempt) and is a pre-session credential failure", async () => {
  const s = stubTransports({ status: 503 });
  try { await assert.rejects(resolveNovaCredentials(args(), realStsFixture()), is("NOVA_STS_ASSUME_ROLE_FAILED")); assert.equal(s.calls.sts.length, 1); } finally { s.restore(); }
});
test("STS redirect is rejected and never followed", async () => {
  const s = stubTransports({ status: 307, location: "https://unapproved.invalid/" });
  try { await assert.rejects(resolveNovaCredentials(args(), realStsFixture()), (e) => e instanceof PilotError); assert.equal(s.calls.sts.length, 1); assert.ok(s.calls.sts.every((c) => c.hostname === "sts.us-east-1.amazonaws.com")); } finally { s.restore(); }
});
test("an AssumeRole answer for a different role/session identity is rejected", async () => {
  const s = stubTransports({ arn: "arn:aws:sts::999999999999:assumed-role/OTHER/x" });
  try { await assert.rejects(resolveNovaCredentials(args(), realStsFixture()), is("NOVA_CREDENTIAL_IDENTITY_MISMATCH")); } finally { s.restore(); }
});
test("shared-config [default] endpoint_url / services section cannot move STS or Bedrock (configured endpoints ignored)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-dual-endpoint-")), config = path.join(dir, "config"), creds = path.join(dir, "credentials");
  fs.writeFileSync(config, `[default]\nendpoint_url = https://unapproved-default.invalid\nservices = svc\nauth_scheme_preference = httpBearerAuth\n[services svc]\nsts =\n  endpoint_url = https://unapproved-sts.invalid\nbedrock_runtime =\n  endpoint_url = https://unapproved-br.invalid\n[profile fixture]\nrole_arn = ${ROLE}\nsource_profile = source\nregion = us-east-1\n`);
  fs.writeFileSync(creds, "[source]\naws_access_key_id = AKIATESTFIXTURE00000\naws_secret_access_key = TEST_FIXTURE_NOT_REAL\n");
  const s = stubTransports();
  try {
    await withEnv({ AWS_CONFIG_FILE: config, AWS_SHARED_CREDENTIALS_FILE: creds, AWS_PROFILE: undefined }, async () => {
      const fixture = { metadataDisabled: "true", loadFiles: () => loadSharedConfigFiles({ configFilepath: config, filepath: creds, ignoreCache: true }) } as unknown as NovaCredentialFixture;
      const lease = consumeNovaCredentials(await resolveNovaCredentials(args(), fixture), "b", true);
      const client = createNovaRuntimeClient("fixture", lease.credentials), binding = Object.freeze({ approvalId: "A", approvalHash: "a".repeat(64), configHash: "c".repeat(64), ledgerDirectory: "L", approvalExpiresAt: new Date(Date.now() + 3600000).toISOString(), inferenceReleaseExpiresAt: null, scope: "ONE_SHOT" as const });
      const input = { modelId: "amazon.nova-pro-v1:0", messages: [{ role: "user" as const, content: [{ text: "SYNTHETIC" }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } }, w = serializeNova(input);
      await novaRuntimeSend(client, binding)(input, new AbortController().signal, Object.freeze({ binding, phase: "INFERENCE" as const, reservationId: "r", reservationOrdinal: 1, promptHash: "d".repeat(64), tokenPayloadHash: w.identity.tokenPayloadHash, requestHash: w.identity.inferenceRequestHash, assertCurrent: () => {} }));
      client.destroy();
    });
    assert.deepEqual(s.calls.sts.map((c) => c.hostname), ["sts.us-east-1.amazonaws.com"]);
    assert.deepEqual(s.calls.bedrock.map((c) => c.hostname), ["bedrock-runtime.us-east-1.amazonaws.com"]);
    assert.match(s.calls.bedrock[0].auth, /^AWS4-HMAC-SHA256 Credential=ASIATESTFIXTURE\/\d{8}\/us-east-1\/bedrock\/aws4_request, /); // SigV4, not bearer
  } finally { s.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const key of ["AWS_BEARER_TOKEN_BEDROCK", "AWS_AUTH_SCHEME_PREFERENCE"]) test(`${key} is refused before any STS request and at client construction`, async () => {
  const s = stubTransports();
  try {
    await withEnv({ [key]: "TEST_FIXTURE" }, async () => {
      await assert.rejects(resolveNovaCredentials(args(), realStsFixture()), is("NOVA_AUTH_OVERRIDE_FORBIDDEN"));
      assert.throws(() => createNovaRuntimeClient("fixture", { accessKeyId: "A", secretAccessKey: "B", sessionToken: "C", expiration: new Date(Date.now() + 3600000) }), is("NOVA_AUTH_OVERRIDE_FORBIDDEN"));
    });
    assert.equal(s.calls.sts.length, 0);
  } finally { s.restore(); }
});
test("phase lease: 1-hour credentials admit a 13-minute phase under a 72-hour approval; dispatch stops at lease end and before credential expiry margin", async () => {
  const real = Date.now; let now = real(); Date.now = () => now; const s = stubTransports({ expiresInMs: 3600000 });
  try {
    const lease = consumeNovaCredentials(await resolveNovaCredentials(args(), realStsFixture()), "b", true);
    lease.assertCurrent();
    now += 13 * 60000 + 1; assert.throws(() => lease.assertCurrent(), is("NOVA_CREDENTIAL_LEASE_EXPIRED"));
  } finally { Date.now = real; s.restore(); }
});
test("credentials shorter than lease + margin are refused before any claim; the margin is enforced at dispatch time", async () => {
  const s = stubTransports({ expiresInMs: 13 * 60000 + NOVA_CREDENTIAL_MARGIN_MS - 1000 });
  try { await assert.rejects(resolveNovaCredentials(args(), realStsFixture()), is("NOVA_CREDENTIAL_VALIDITY_INSUFFICIENT")); } finally { s.restore(); }
  const real = Date.now; let now = real(); Date.now = () => now; const t = stubTransports({ expiresInMs: 30 * 60000 });
  try {
    const lease = consumeNovaCredentials(await resolveNovaCredentials(args({ phaseWindowMs: 60 * 60000, validUntil: new Date(now + 20 * 60000).toISOString() }), realStsFixture()), "b", true);
    now += 25 * 60000; // past approval (20m) -> authority error first
    assert.throws(() => lease.assertCurrent(), is("LiveNotApproved"));
  } finally { Date.now = real; t.restore(); }
});
test("invalid phase window is rejected", async () => {
  await assert.rejects(resolveNovaCredentials(args({ phaseWindowMs: 0 }), realStsFixture()), is("NOVA_CREDENTIAL_LEASE_INVALID"));
});
test("production HTTP/2 handler (:authority, no host header) dispatches once; a re-pointed or duplicated authority is rejected before HTTP", async () => {
  const lease = { accessKeyId: "ASIATESTFIXTURE", secretAccessKey: "TEST_FIXTURE_NOT_REAL", sessionToken: "TEST_FIXTURE_TOKEN", expiration: new Date(Date.now() + 3600000) };
  const binding = Object.freeze({ approvalId: "A", approvalHash: "a".repeat(64), configHash: "c".repeat(64), ledgerDirectory: "L", approvalExpiresAt: new Date(Date.now() + 3600000).toISOString(), inferenceReleaseExpiresAt: null, scope: "ONE_SHOT" as const });
  const input = { modelId: "amazon.nova-pro-v1:0", messages: [{ role: "user" as const, content: [{ text: "SYNTHETIC" }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } }, w = serializeNova(input);
  const auth = (n: number) => Object.freeze({ binding, phase: "INFERENCE" as const, reservationId: "r" + n, reservationOrdinal: n, promptHash: "d".repeat(64), tokenPayloadHash: w.identity.tokenPayloadHash, requestHash: w.identity.inferenceRequestHash, assertCurrent: () => {} });
  const s = stubTransports();
  try {
    for (const [label, mutate, expected] of [["unchanged", null, "OK"], ["authority re-pointed", (a: any) => { a.request.headers[":authority"] = "unapproved.invalid"; }, "NOVA_HTTP_ENDPOINT_MISMATCH"],
      ["host added beside :authority", (a: any) => { a.request.headers.host = "bedrock-runtime.us-east-1.amazonaws.com"; }, "NOVA_HTTP_ENDPOINT_MISMATCH"]] as const) {
      const client = createNovaRuntimeClient("fixture", lease); assert.equal(client.config.requestHandler.metadata?.handlerProtocol, "h2", label);
      if (mutate) client.middlewareStack.addRelativeTo((next: any) => async (a: any) => { mutate(a); return next(a); }, { name: "mutateAuthority", relation: "after", toMiddleware: "httpSigningMiddleware" });
      const before = s.calls.bedrock.length; let got = "OK";
      try { await novaRuntimeSend(client, binding)(input, new AbortController().signal, auth(1)); } catch (e) { got = e instanceof PilotError ? e.code : String(e); }
      client.destroy();
      assert.equal(got, expected, label); assert.equal(s.calls.bedrock.length - before, expected === "OK" ? 1 : 0, label);
    }
    assert.match(s.calls.bedrock[0].auth, /SignedHeaders=:authority;/);
  } finally { s.restore(); }
});
test("cross-process rollback tripwire: a durable file newer than the clock fails closed; tolerance and missing files are allowed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-rollback-")), f = path.join(dir, "ledger.jsonl"); fs.writeFileSync(f, "x");
  try {
    const mtime = fs.statSync(f).mtimeMs;
    assert.doesNotThrow(() => assertNoObservedClockRollback([f, path.join(dir, "missing")], mtime));
    assert.doesNotThrow(() => assertNoObservedClockRollback([f], mtime - NOVA_CLOCK_ROLLBACK_TOLERANCE_MS + 1));
    assert.throws(() => assertNoObservedClockRollback([f], mtime - NOVA_CLOCK_ROLLBACK_TOLERANCE_MS - 1000), is("NOVA_CLOCK_ROLLBACK"));
    assert.throws(() => assertNoObservedClockRollback([f], NaN), is("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
