/** TEST FIXTURE only: fake credentials and injected IO; no AWS or real credential resolution. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ACCOUNT_CHECKS, assertCountOnlyAccountReady, prepareCountOnlyProbe, parseCountOnlyProbe, type CountAccount } from "../evaluation/bedrock-pilot/count-only-probe";
import { assertImplementationCheckout, createMockCountOnlyClient, executeAuthorizedCountOnlyProbe } from "../evaluation/bedrock-pilot/mantle-count-client";
import { MANTLE_MODEL, serializeMantle } from "../evaluation/bedrock-pilot/mantle-transport";
import { issueFixtureLedger, openBudgetLedger } from "../evaluation/bedrock-pilot/ledger";
import { digest } from "../evaluation/evaluation-kit/identity";

const clock = new Date(); clock.setMilliseconds(0);
const fakeCredentials = { accessKeyId: "TESTACCESSKEY12345", secretAccessKey: "TEST_ONLY_SECRET_FOR_SIGV4_NEVER_REAL", sessionToken: "TEST_ONLY_SESSION_TOKEN" };
const input = () => ({ modelId: MANTLE_MODEL, system: [{ text: "Synthetic COUNT-only test policy." }],
  messages: [{ role: "user" as const, content: [{ text: "Synthetic calibration input; no reviewer notes or gold." }] }], inferenceConfig: { maxTokens: 2048, temperature: 0.2 } });
const FIXTURE_ACCOUNT = "111122223333";
function verifiedAccount(overrides: Partial<CountAccount> = {}): CountAccount {
  return { principalArn: `arn:aws:iam::${FIXTURE_ACCOUNT}:user/count-probe-fixture`, projectArn: `arn:aws:bedrock-mantle:us-east-2:${FIXTURE_ACCOUNT}:project/default`,
    checks: Object.fromEntries(ACCOUNT_CHECKS.map(k => [k, { status: "VERIFIED", evidenceSha256: "9".repeat(64), verifiedAt: new Date(clock.getTime() - 60000).toISOString() }])) as CountAccount["checks"], ...overrides };
}
function probe(timeoutMs = 10000, account?: CountAccount) {
  return prepareCountOnlyProbe({ input: input(), selection: { caseId: "CAL01", caseKey: "case-warmup-cal01", requestCaseId: "dev-cal-01", arm: "LAYERED_CONTEXT", policy: "MINIMAL", repeatIndex: 0,
    requestHash: "a".repeat(64), promptHash: digest({ system: input().system[0].text, user: input().messages[0].content[0].text }) },
    sourcePins: { commit: "b".repeat(40), implementationCommit: "7".repeat(40), code: "c".repeat(64), corpus: "d".repeat(64), cases: "e".repeat(64), ownerAmendments: "f".repeat(64) },
    preparedAt: clock.toISOString(), expiresAt: new Date(clock.getTime() + 3600000).toISOString(), timeoutMs, account });
}
type Options = Parameters<typeof createMockCountOnlyClient>[0];
type SignedRequest = Parameters<Options["post"]>[0];
function fixture(overrides: Partial<Options> = {}) {
  const requests: SignedRequest[] = []; let credentialResolutions = 0;
  const client = createMockCountOnlyClient({ kind: "MOCK", now: () => new Date(clock), credentials: async () => { credentialResolutions++; return { ...fakeCredentials }; },
    async post(request) { requests.push(request); return { status: 200, body: { input_tokens: 123 }, headers: { "x-amzn-requestid": "request-fixture" } }; }, ...overrides });
  return { client, requests, get credentialResolutions() { return credentialResolutions; } };
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

test("probe package binds exact canonical COUNT-only body and calibration selection", () => {
  const p = probe(), b = JSON.parse(p.request.body);
  assert.equal(p.purpose, "COUNT_ONLY_VALIDATION");
  assert.equal(b.model, MANTLE_MODEL); assert.deepEqual(Object.keys(b), ["model", "system", "messages"]);
  assert.equal(p.request.sha256, sha(p.request.body));
  assert.equal(p.selection.caseId, "CAL01"); assert.equal(p.selection.arm, "LAYERED_CONTEXT"); assert.equal(p.selection.repeatIndex, 0);
  assert.ok(!/max_tokens|temperature|top_p|expectedAssessment|reviewerNotes|scoringRationale/.test(p.request.body));
  assert.doesNotThrow(() => parseCountOnlyProbe(p));
});

test("SigV4 signing matches an independent canonical-request/HMAC calculation", async () => {
  const f = fixture(), p = probe(), result = await f.client.count(p);
  assert.equal(f.requests.length, 1); assert.equal(f.credentialResolutions, 1);
  const r = f.requests[0], headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  assert.equal(r.method, "POST"); assert.equal(r.hostname, "bedrock-mantle.us-east-2.api.aws");
  assert.equal(r.path, "/anthropic/v1/messages/count_tokens"); assert.equal(r.body, p.request.body);
  assert.equal(headers["anthropic-version"], "2023-06-01"); assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["host"], "bedrock-mantle.us-east-2.api.aws"); assert.equal(headers["x-amz-content-sha256"], sha(p.request.body));
  assert.equal(headers["x-amz-security-token"], fakeCredentials.sessionToken);
  const authorization = headers.authorization;
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
  assert.ok(match); assert.equal(match[1], fakeCredentials.accessKeyId);
  const date = headers["x-amz-date"].slice(0, 8);
  assert.equal(match[2], date + "/us-east-2/bedrock-mantle/aws4_request");
  const signedHeaders = match[3].split(";");
  for (const h of ["anthropic-version", "content-type", "host", "x-amz-date", "x-amz-security-token"]) assert.ok(signedHeaders.includes(h));
  const canonicalHeaders = signedHeaders.map(h => h + ":" + headers[h].trim().replace(/\s+/g, " ") + "\n").join("");
  const canonicalRequest = ["POST", "/anthropic/v1/messages/count_tokens", "", canonicalHeaders, match[3], sha(p.request.body)].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", headers["x-amz-date"], match[2], sha(canonicalRequest)].join("\n");
  const hmac = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + fakeCredentials.secretAccessKey, date), "us-east-2"), "bedrock-mantle"), "aws4_request");
  assert.equal(match[4], createHmac("sha256", signingKey).update(stringToSign).digest("hex"));
  assert.equal(result.inputTokens, 123); assert.equal(result.requestHash, p.request.sha256);
});

test("one client instance cannot dispatch a second request or infer after a count", async () => {
  const f = fixture(), p = probe(); await f.client.count(p);
  await assert.rejects(f.client.count(p));
  assert.equal(f.requests.length, 1); assert.equal(f.credentialResolutions, 1);
  assert.ok(!/converse|global\.|\/messages$/.test(f.requests[0].path));
});

test("payload hash drift and unexpected fields fail before credentials or HTTP", async () => {
  const p = probe();
  const invalidBody = JSON.stringify({ ...JSON.parse(p.request.body), max_tokens: 2048 });
  const wrongModel = JSON.stringify({ ...JSON.parse(p.request.body), model: "global.anthropic.claude-haiku-4-5-20251001-v1:0" });
  const noncanonical = JSON.stringify(JSON.parse(p.request.body), null, 2);
  const labelUser = JSON.stringify({ expectedAssessment: "NO_OBSERVED_CHANGE", reviewerNotes: "PRIVATE_FIXTURE_MUST_NOT_LEAK" });
  const labelBody = JSON.stringify({ ...JSON.parse(p.request.body), messages: [{ role: "user", content: [{ type: "text", text: labelUser }] }] });
  for (const invalid of [{ ...p, request: { ...p.request, body: p.request.body + " " } }, { ...p, purpose: "INFERENCE" }, { ...p, unexpected: true },
    { ...p, selection: { ...p.selection, caseId: "CAL06" } }, { ...p, selection: { ...p.selection, arm: "UNKNOWN" } },
    { ...p, endpoint: "https://example.invalid/count_tokens" }, { ...p, maxCountRequests: 2 }, { ...p, maxInferenceCalls: 1 },
    ...[invalidBody, wrongModel, noncanonical].map(body => ({ ...p, request: { ...p.request, body, sha256: sha(body) } })),
    { ...p, request: { ...p.request, body: labelBody, sha256: sha(labelBody) }, selection: { ...p.selection, promptHash: digest({ system: input().system[0].text, user: labelUser }) } }]) {
    const f = fixture(); await assert.rejects(f.client.count(invalid)); assert.equal(f.credentialResolutions, 0); assert.equal(f.requests.length, 0);
  }
});

test("CountTokens parses finite integer input_tokens and rejects malformed count replies", async () => {
  for (const body of [{}, { input_tokens: -1 }, { input_tokens: 1.5 }, { input_tokens: 12001 }, { input_tokens: Number.POSITIVE_INFINITY }, { input_tokens: Number.MAX_SAFE_INTEGER + 1 }, { input_tokens: "12" }, { input_tokens: null }, "not JSON", { type: "error", error: { type: "invalid_request_error", message: "fixture" } }]) {
    let posts = 0;
    const f = fixture({ async post() { posts++; return { status: 200, body }; } });
    await assert.rejects(f.client.count(probe())); assert.equal(posts, 1);
  }
});

test("expired packages fail before resolving credentials", async () => {
  const p = probe(), f = fixture();
  await assert.rejects(f.client.count({ ...p, expiresAt: new Date(clock.getTime() - 1000).toISOString() }));
  assert.equal(f.credentialResolutions, 0); assert.equal(f.requests.length, 0);
});

test("timeout aborts the one mock request and never retries", { timeout: 2000 }, async () => {
  let posts = 0, aborted = false;
  const f = fixture({ async post(_r, signal) { posts++; return await new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("MOCK_ABORTED")); }, { once: true });
  }); } });
  await assert.rejects(f.client.count(probe(10))); assert.equal(posts, 1); assert.equal(aborted, true);
  await assert.rejects(f.client.count(probe(10))); assert.equal(posts, 1);
});

test("an already-aborted count cannot resolve credentials or send", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.client.count(probe(), controller.signal));
  assert.equal(f.credentialResolutions, 0); assert.equal(f.requests.length, 0);
});

test("HTTP validation/authentication/throttling/server failures never retry or fall back", async () => {
  const expected: Record<number, string> = { 400: "COUNT_VALIDATION_ERROR", 401: "COUNT_AUTHENTICATION_ERROR", 403: "COUNT_AUTHENTICATION_ERROR", 429: "COUNT_THROTTLED", 500: "COUNT_PROVIDER_ERROR", 503: "COUNT_PROVIDER_ERROR", 302: "COUNT_REDIRECT_REFUSED" };
  for (const status of [400, 401, 403, 429, 500, 503, 302]) {
    const requests: SignedRequest[] = [];
    const f = fixture({ async post(r) { requests.push(r); return { status, body: { type: "error", request_id: "req-fixture", error: { type: "fixture_error", message: "TEST FIXTURE error" } } }; } });
    await assert.rejects(f.client.count(probe()), (e: { code?: string; details?: { requestHash?: string } }) => e.code === expected[status] && e.details?.requestHash === probe().request.sha256); assert.equal(requests.length, 1);
    assert.equal(requests[0].hostname, "bedrock-mantle.us-east-2.api.aws"); assert.equal(requests[0].path, "/anthropic/v1/messages/count_tokens");
    await assert.rejects(f.client.count(probe())); assert.equal(requests.length, 1);
  }
});

test("credential failures are generic and cannot expose provider error secrets", async () => {
  let posts = 0;
  const f = fixture({ async credentials() { throw new Error("Credential failure " + fakeCredentials.secretAccessKey + " " + fakeCredentials.sessionToken); }, async post() { posts++; return { status: 200, body: { input_tokens: 1 } }; } });
  await assert.rejects(f.client.count(probe()), e => {
    const printable = JSON.stringify(e) + String(e);
    assert.ok(!printable.includes(fakeCredentials.secretAccessKey)); assert.ok(!printable.includes(fakeCredentials.sessionToken)); return true;
  }); assert.equal(posts, 0);
});

test("returned count artifacts exclude signed headers and exact resolved credential values", async () => {
  const f = fixture({ async post() { return { status: 200, body: { input_tokens: 3, fixtureEcho: Object.values(fakeCredentials).join(" / ") },
    headers: { "x-amzn-requestid": "req-fixture", authorization: "SIGNATURE_MUST_NOT_BE_LOGGED", "x-amz-security-token": fakeCredentials.sessionToken } }; } });
  const result = await f.client.count(probe()), printed = JSON.stringify(result);
  for (const value of Object.values(fakeCredentials)) assert.ok(!printed.includes(value));
  assert.ok(!printed.includes("SIGNATURE_MUST_NOT_BE_LOGGED")); assert.ok(!printed.includes("AWS4-HMAC-SHA256"));
  assert.equal(result.inputTokens, 3); assert.ok(result.response.receipt);
});

test("unverified account package cannot authorize the native client", async () => {
  await assert.rejects(executeAuthorizedCountOnlyProbe(probe(), null, { workspaceRoot: process.cwd(), runDirectory: path.join(process.cwd(), "must-not-create-count-run") }), /COUNT_ACCOUNT_READINESS_BLOCKED/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "must-not-create-count-run")), false);
});

test("package pins the divuzha profile, Ohio Mantle target and the count body identity shared with inference", () => {
  const p = probe(), wire = serializeMantle(input());
  assert.equal(p.awsProfile, "divuzha"); assert.equal(p.region, "us-east-2"); assert.equal(p.service, "bedrock-mantle");
  assert.equal(p.endpoint, "https://bedrock-mantle.us-east-2.api.aws/anthropic/v1/messages/count_tokens");
  assert.equal(p.request.sha256, wire.identity.countBodyHash); assert.equal(p.request.sha256, wire.identity.tokenPayloadHash);
  const { max_tokens: _m, temperature: _t, ...tokenBearing } = JSON.parse(wire.inferenceBody);
  assert.equal(JSON.stringify(tokenBearing), p.request.body);
  for (const awsProfile of ["default", "gymini-admin", ""]) assert.throws(() => parseCountOnlyProbe({ ...p, awsProfile }), /COUNT_PROBE_INVALID/);
  for (const field of [{ region: "ap-southeast-1" }, { model: "anthropic.claude-haiku-4-5-20251001-v1:0" }, { service: "bedrock" }, { retries: 1 }, { maxInputTokens: 13000 }, { timeoutMs: 30001 }])
    assert.throws(() => parseCountOnlyProbe({ ...p, ...field }), /COUNT_PROBE_INVALID/);
});

test("account readiness requires evidence-backed checks for one Ohio default project account", () => {
  assert.throws(() => assertCountOnlyAccountReady(probe()), /COUNT_ACCOUNT_READINESS_BLOCKED/);
  assert.equal(assertCountOnlyAccountReady(probe(10000, verifiedAccount())), FIXTURE_ACCOUNT);
  const ok = verifiedAccount(), earlier = new Date(clock.getTime() - 60000).toISOString();
  // Bare attestations without an evidence hash are not accepted.
  assert.throws(() => probe(10000, { ...ok, checks: { ...ok.checks, quotas: "VERIFIED" as never } }), /COUNT_PROBE_INVALID/);
  assert.throws(() => probe(10000, { ...ok, checks: { ...ok.checks, quotas: { status: "VERIFIED", evidenceSha256: "0".repeat(64), verifiedAt: earlier } } }), /COUNT_PROBE_INVALID/);
  assert.throws(() => probe(10000, { ...ok, checks: { ...ok.checks, marketplaceEula: { status: "VERIFIED", evidenceSha256: "9".repeat(64), verifiedAt: new Date(clock.getTime() + 60000).toISOString() } } }), /COUNT_ACCOUNT_EVIDENCE_AFTER_PREPARATION/);
  for (const account of [{ ...ok, checks: { ...ok.checks, billingProtection: "NOT_VERIFIED" as const } }, { ...ok, principalArn: "arn:aws:iam::999988887777:user/other" },
    { ...ok, projectArn: `arn:aws:bedrock-mantle:us-east-2:${FIXTURE_ACCOUNT}:project/proj_other` }, { ...ok, projectArn: `arn:aws:bedrock-mantle:us-east-1:${FIXTURE_ACCOUNT}:project/default` },
    { ...ok, principalArn: `arn:aws:iam::${FIXTURE_ACCOUNT}:*` }])
    assert.throws(() => assertCountOnlyAccountReady(probe(10000, account)), /COUNT_ACCOUNT_READINESS_BLOCKED/);
});

test("credentials reporting another account stop before signing or HTTP", async () => {
  const f = fixture({ expectedAccount: FIXTURE_ACCOUNT, credentials: async () => ({ ...fakeCredentials, accountId: "999988887777" }) });
  await assert.rejects(f.client.count(probe()), /COUNT_CREDENTIAL_ACCOUNT_MISMATCH/); assert.equal(f.requests.length, 0);
  const g = fixture({ expectedAccount: FIXTURE_ACCOUNT, credentials: async () => ({ ...fakeCredentials, accountId: FIXTURE_ACCOUNT }) });
  assert.equal((await g.client.count(probe())).inputTokens, 123);
});

test("executor requires a clean checkout at the pinned implementation commit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "count-checkout-")), git = (...a: string[]) => spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q"); fs.writeFileSync(path.join(dir, "a.txt"), "a"); git("add", "a.txt"); git("commit", "-q", "-m", "fixture");
    const head = git("rev-parse", "HEAD").stdout.trim();
    assert.doesNotThrow(() => assertImplementationCheckout(head, dir));
    assert.throws(() => assertImplementationCheckout("7".repeat(40), dir), /COUNT_IMPLEMENTATION_COMMIT_MISMATCH/);
    fs.writeFileSync(path.join(dir, "b.txt"), "dirty");
    assert.throws(() => assertImplementationCheckout(head, dir), /WORKING_TREE_DIRTY/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("LIVE ledger accepts only an OWNER_SIGNED issue and can be claimed once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "count-ledger-")), ledgerDir = path.join(root, "ledger"), runs = path.join(root, "runs");
  try {
    fs.mkdirSync(runs); issueFixtureLedger(ledgerDir, "count-fixture", "c".repeat(64), "a".repeat(64));
    const args = { directory: ledgerDir, approvalId: "count-fixture", approvalHash: "a".repeat(64), configHash: "c".repeat(64), runDirectory: path.join(runs, "one"), resume: false };
    assert.throws(() => openBudgetLedger({ ...args, mode: "LIVE" }), /APPROVAL_LEDGER_BINDING_MISMATCH/);
    const ledger = openBudgetLedger({ ...args, mode: "FAKE" });
    ledger.save({ ...ledger.state(), countCalls: 1, stopped: true }, "COUNT_ONLY_RESERVED"); ledger.close();
    assert.throws(() => openBudgetLedger({ ...args, mode: "FAKE", runDirectory: path.join(runs, "two") }), /APPROVAL_ALREADY_USED/);
    assert.throws(() => openBudgetLedger({ ...args, mode: "FAKE", configHash: "d".repeat(64) }), /APPROVAL_LEDGER_BINDING_MISMATCH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("count client source has a single fixed count route and no inference or Runtime fallback", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../evaluation/bedrock-pilot/mantle-count-client.ts"), "utf8");
  assert.equal((source.match(/https\.request\(/g) ?? []).length, 1);
  assert.match(source, /hostname: "bedrock-mantle\.us-east-2\.api\.aws", port: 443, path: "\/anthropic\/v1\/messages\/count_tokens"/);
  assert.doesNotMatch(source, /bedrock-runtime|Converse(Command)?\(|InvokeModel|inferenceBody|createInference|x-api-key|global\./);
});

test("count CLI: inspect is file-only and execute fails closed before credentials for an unverified package", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "count-cli-")), pkg = path.join(dir, "probe.json"), run = path.join(dir, "run");
  const cli = path.resolve(__dirname, "../evaluation/bedrock-pilot/count-only-cli.ts");
  try {
    fs.writeFileSync(pkg, JSON.stringify(probe()));
    const env = { ...process.env, AWS_PROFILE: "must-not-be-read", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" };
    const inspect = spawnSync(process.execPath, ["--import", "tsx", cli, "inspect", "--package", pkg], { encoding: "utf8", timeout: 60000, env });
    assert.equal(inspect.status, 0, inspect.stderr);
    const s = JSON.parse(inspect.stdout);
    assert.equal(s.readiness, "ACCOUNT_NOT_VERIFIED"); assert.equal(s.requestSha256, probe().request.sha256); assert.equal(s.packageDigest, digest(probe()));
    assert.equal(s.unsignedApprovalTemplate.configHash, s.packageDigest); assert.equal(s.maxInferenceCalls, 0);
    const approval = path.join(dir, "approval.json"); fs.writeFileSync(approval, "null");
    const exec = spawnSync(process.execPath, ["--import", "tsx", cli, "execute", "--package", pkg, "--approval", approval, "--run-dir", run], { encoding: "utf8", timeout: 60000, env });
    assert.equal(exec.status, 1); assert.match(exec.stderr, /COUNT_ACCOUNT_READINESS_BLOCKED/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, "count-error.json"), "utf8")).code, "COUNT_ACCOUNT_READINESS_BLOCKED");
    assert.equal(fs.existsSync(path.join(run, "count-receipt.json")), false);
    for (const bad of [["inspect"], ["execute", "--package", pkg], ["inspect", "--package", pkg, "--live", "true"], ["infer", "--package", pkg]])
      assert.equal(spawnSync(process.execPath, ["--import", "tsx", cli, ...bad], { encoding: "utf8", timeout: 60000, env }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("existing inference CLI rejects LIVE before loading any config or dispatching", () => {
  const cli = path.resolve(__dirname, "../evaluation/bedrock-pilot/run.ts");
  const r = spawnSync(process.execPath, ["--import", "tsx", cli, "--live"], { encoding: "utf8", timeout: 30000, env: { ...process.env, LIVE: "true", BEDROCK_EVALUATION_LIVE: "true" } });
  assert.equal(r.status, 1); assert.match(r.stderr, /CLI_LIVE_LOCKED/);
});
