/** TEST FIXTURE: actual STS SDK, fake long-term credentials/XML, in-memory HTTP only. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { SignatureV4 } from "@smithy/signature-v4";
import { installNovaStsBoundary } from "../evaluation/bedrock-pilot/nova-sts-boundary";
import { resolveNovaCredentials, consumeNovaCredentials } from "../evaluation/bedrock-pilot/nova-credentials";
import { PilotError } from "../evaluation/bedrock-pilot/config";

const key = "TESTFIXTURELONGTERMKEY", source = { accessKeyId: key, secretAccessKey: "TEST_FIXTURE_NOT_REAL" };
const input = { RoleArn: "arn:aws:iam::123456789012:role/OFFLINE", RoleSessionName: "gymini-e3-nova-eval", DurationSeconds: 3600 };
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
const is = (code: string) => (e: unknown) => e instanceof PilotError && e.code === code;
const xml = (mode = "ok") => `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials><AccessKeyId>FAKETEMPORARYKEY</AccessKeyId><SecretAccessKey>TEST_FIXTURE_NOT_REAL</SecretAccessKey><SessionToken>TEST_FIXTURE_TOKEN</SessionToken><Expiration>${new Date(Date.now() + (mode === "short" ? 1000 : 7200000)).toISOString()}</Expiration></Credentials><AssumedRoleUser><Arn>arn:aws:sts::123456789012:assumed-role/${mode === "forged" ? "OTHER" : "OFFLINE"}/gymini-e3-nova-eval</Arn><AssumedRoleId>FAKE:session</AssumedRoleId></AssumedRoleUser></AssumeRoleResult></AssumeRoleResponse>`;
function fixture(config: any = {}, mutate?: (r: any) => void, status = 200, authority: () => void = () => {}) {
  let calls = 0; const destinations: string[] = [];
  const client = new STSClient({ region: "us-east-1", endpoint: "https://sts.us-east-1.amazonaws.com", credentials: source, maxAttempts: 1, ...config, requestHandler: { async handle(r: any) {
    calls++; destinations.push(`${r.protocol}//${r.hostname}:${r.port ?? 443}${r.path}`); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.headers));
    return { response: { statusCode: status, headers: { "content-type": "text/xml" }, body: Buffer.from(status === 200 ? xml() : "<ErrorResponse><Error><Code>ServiceUnavailable</Code></Error></ErrorResponse>") } };
  }, destroy() {} } });
  if (mutate) client.middlewareStack.addRelativeTo((next: any) => (a: any) => { mutate(a.request); return next(a); }, { name: "syntheticStsMutation", relation: "after", toMiddleware: "httpSigningMiddleware" });
  installNovaStsBoundary(client, key, input, authority);
  return { client, calls: () => calls, send: () => client.send(new AssumeRoleCommand(input)), receipt(t: any, category: string) { t.diagnostic(JSON.stringify({ commit: sha, authority: "SYNTHETIC_COMPONENT", expectedDestination: "https://sts.us-east-1.amazonaws.com:443/", actualDestinations: destinations, stsHandlerCalls: calls, bedrockHandlerCalls: 0, credentialResolutionCount: 0, ledgerMutations: 0, category, result: "PASS" })); } };
}
test("STS regional endpoint and source key are pinned; maxAttempts=1 is one total dispatch", async t => {
  const f = fixture(); try { assert.equal(await f.client.config.maxAttempts(), 1); await f.send(); assert.equal(f.calls(), 1); f.receipt(t, "OK"); } finally { f.client.destroy(); }
});
for (const [name, config] of [
  ["global endpoint", { endpoint: "https://sts.amazonaws.com" }], ["custom host", { endpoint: "https://unapproved.invalid" }], ["HTTP", { endpoint: "http://sts.us-east-1.amazonaws.com" }], ["port", { endpoint: "https://sts.us-east-1.amazonaws.com:444" }],
  ["region", { region: "us-west-2" }], ["FIPS", { endpoint: undefined, useFipsEndpoint: true }], ["dual stack", { endpoint: undefined, useDualstackEndpoint: true }],
] as [string, any][]) test("STS rejects " + name + " before handler", async t => {
  const f = fixture(config); try { await assert.rejects(f.send(), (e: unknown) => e instanceof PilotError && ["NOVA_STS_ENDPOINT_MISMATCH", "NOVA_SIGNING_SCOPE_MISMATCH"].includes(e.code)); assert.equal(f.calls(), 0); f.receipt(t, "ENDPOINT_OR_SCOPE_REJECTED"); } finally { f.client.destroy(); }
});
for (const [name, mutate, category] of [
  ["hostname", (r: any) => { r.hostname = "unapproved.invalid"; }, "NOVA_STS_ENDPOINT_MISMATCH"],
  ["host header", (r: any) => { r.headers.host = "unapproved.invalid"; }, "NOVA_STS_ENDPOINT_MISMATCH"],
  ["query", (r: any) => { r.query = { other: "1" }; }, "NOVA_STS_ENDPOINT_MISMATCH"],
  ["path", (r: any) => { r.path = "/other"; }, "NOVA_STS_ENDPOINT_MISMATCH"],
  ["body role", (r: any) => { r.body = String(r.body).replace("OFFLINE", "OTHER"); }, "NOVA_STS_REQUEST_MISMATCH"],
  ["duplicate role", (r: any) => { r.body = String(r.body) + "&RoleArn=other"; }, "NOVA_STS_REQUEST_MISMATCH"],
  ["source signing key", (r: any) => { r.headers.authorization = r.headers.authorization.replace(key, "OTHER_KEY"); }, "NOVA_SIGNING_SCOPE_MISMATCH"],
  ["signing service", (r: any) => { r.headers.authorization = r.headers.authorization.replace("/sts/", "/bedrock/"); }, "NOVA_SIGNING_SCOPE_MISMATCH"],
  ["signing region", (r: any) => { r.headers.authorization = r.headers.authorization.replace("/us-east-1/", "/us-west-2/"); }, "NOVA_SIGNING_SCOPE_MISMATCH"],
] as [string, (r: any) => void, string][]) test("STS post-signing mutation: " + name, async t => {
  const f = fixture({}, mutate); try { await assert.rejects(f.send(), is(category)); assert.equal(f.calls(), 0); f.receipt(t, category); } finally { f.client.destroy(); }
});
for (const maxAttempts of [1, 3]) test("STS retryable failure still reaches handler only once at SDK maxAttempts=" + maxAttempts, async t => {
  const f = fixture({ maxAttempts }, undefined, 503); try { await assert.rejects(f.send()); assert.equal(f.calls(), 1); f.receipt(t, "STS_ERROR_ONE_DISPATCH"); } finally { f.client.destroy(); }
});
test("STS request handler is immutable after boundary installation", async t => {
  const f = fixture(); try { assert.throws(() => Object.defineProperty(f.client.config, "requestHandler", { value: {} }), TypeError); await f.send(); assert.equal(f.calls(), 1); f.receipt(t, "HANDLER_PINNED"); } finally { f.client.destroy(); }
});
test("STS refuses asynchronous authority instead of dispatching before its result", async () => {
  const f = fixture({}, undefined, 200, async () => { await Promise.resolve(); });
  try { await assert.rejects(f.send(), is("NOVA_STS_ASYNC_AUTHORITY_FORBIDDEN")); assert.equal(f.calls(), 0); } finally { f.client.destroy(); }
});
test("STS root config cannot be replaced to skip its guarded handler", async () => {
  const f = fixture(); let bypass = 0;
  try {
    assert.throws(() => Object.defineProperty(f.client, "config", { value: { ...f.client.config, requestHandler: { async handle() { bypass++; return { response: { statusCode: 200, headers: { "content-type": "text/xml" }, body: Buffer.from(xml()) } }; } } } }), TypeError);
    assert.equal(bypass, 0); assert.equal(f.calls(), 0);
  } finally { f.client.destroy(); }
});

// Exercise production credential resolution (no injected assumeRole), with only fake INI paths and a fake NodeHttpHandler.
const req = createRequire(__filename), handlers = require(createRequire(req.resolve("@aws-sdk/client-sts")).resolve("@smithy/node-http-handler"));
for (const mode of ["ok", "malformed", "forged", "deny", "reset", "short", "late", "rollback"] as const) test("production STS resolution: " + mode, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-real-sdk-fake-sts-")), config = path.join(temp, "config"), creds = path.join(temp, "credentials");
  fs.writeFileSync(config, "[profile fixture]\nrole_arn = " + input.RoleArn + "\nsource_profile = source\nregion = us-east-1\n");
  fs.writeFileSync(creds, "[source]\naws_access_key_id = " + key + "\naws_secret_access_key = TEST_FIXTURE_NOT_REAL\n");
  const envKeys = ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_EC2_METADATA_DISABLED", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_STS", "AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "AWS_USE_FIPS_ENDPOINT", "AWS_USE_DUALSTACK_ENDPOINT"];
  const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]])); for (const k of envKeys) delete process.env[k];
  Object.assign(process.env, { AWS_CONFIG_FILE: config, AWS_SHARED_CREDENTIALS_FILE: creds, AWS_EC2_METADATA_DISABLED: "true" });
  const realNow = Date.now; let now = realNow(), calls = 0; Date.now = () => now;
  const expiry = now + 3600000, handle = handlers.NodeHttpHandler.prototype.handle;
  handlers.NodeHttpHandler.prototype.handle = async (r: any) => {
    calls++; assert.equal(r.hostname, "sts.us-east-1.amazonaws.com"); assert.equal(r.protocol, "https:"); assert.ok(Object.isFrozen(r));
    if (mode === "reset") throw Object.assign(Error("FAKE socket reset"), { code: "ECONNRESET" });
    if (mode === "late") now = expiry;
    if (mode === "rollback") now -= 1000;
    return { response: { statusCode: mode === "deny" ? 403 : 200, headers: { "content-type": "text/xml" }, body: Buffer.from(mode === "deny" ? "<ErrorResponse><Error><Code>AccessDenied</Code><Message>FAKE</Message></Error></ErrorResponse>" : mode === "malformed" ? "<AssumeRoleResponse/>" : xml(mode)) } };
  };
  const expected = { malformed: "NOVA_CREDENTIAL_RESPONSE_INVALID", forged: "NOVA_CREDENTIAL_IDENTITY_MISMATCH", deny: "NOVA_STS_ASSUME_ROLE_FAILED", reset: "NOVA_STS_ASSUME_ROLE_FAILED", short: "NOVA_CREDENTIAL_VALIDITY_INSUFFICIENT", late: "LiveNotApproved", rollback: "NOVA_CLOCK_ROLLBACK" };
  try {
    const promise = resolveNovaCredentials({ profile: "fixture", binding: "fake-binding", validUntil: new Date(expiry).toISOString(), assertAuthority: () => { if (Date.now() >= expiry) throw new PilotError("LiveNotApproved"); } });
    if (mode === "ok") { const receipt = await promise; consumeNovaCredentials(receipt, "fake-binding"); } else await assert.rejects(promise, is(expected[mode]));
    assert.equal(calls, 1); t.diagnostic(JSON.stringify({ commit: sha, expectedDestination: "https://sts.us-east-1.amazonaws.com:443/", stsHandlerCalls: calls, bedrockHandlerCalls: 0, credentialResolutionCount: 1, ledgerMutations: 0, category: mode === "ok" ? "OK" : expected[mode], result: "PASS" }));
  } finally { handlers.NodeHttpHandler.prototype.handle = handle; Date.now = realNow; for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } fs.rmSync(temp, { recursive: true }); }
});
test("SigV4 Host binding: a request signed for a foreign host does not have the genuine STS Host signature", async t => {
  const bytes = (data: string | ArrayBuffer | ArrayBufferView) => typeof data === "string" ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  class Sha256 { private h; constructor(secret?: string | ArrayBuffer | ArrayBufferView) { this.h = secret ? createHmac("sha256", bytes(secret)) : createHash("sha256"); } update(data: string | ArrayBuffer | ArrayBufferView) { this.h.update(bytes(data)); } async digest() { return this.h.digest(); } }
  const signer = new SignatureV4({ credentials: source, region: "us-east-1", service: "sts", sha256: Sha256 });
  const request = { method: "POST", protocol: "https:", hostname: "foreign.invalid", path: "/", headers: { host: "foreign.invalid" }, body: "Action=AssumeRole&Version=2011-06-15" };
  const date = new Date("2026-11-06T00:00:00Z"), foreign = await signer.sign(request, { signingDate: date }), genuine = await signer.sign({ ...request, hostname: "sts.us-east-1.amazonaws.com", headers: { host: "sts.us-east-1.amazonaws.com" } }, { signingDate: date });
  assert.notEqual(foreign.headers.authorization, genuine.headers.authorization);
  t.diagnostic(JSON.stringify({ commit: sha, result: "LOCAL_CANONICAL_SIGNATURES_DIFFER_NOT_A_REAL_REPLAY_TEST", awsCalls: 0 }));
});
