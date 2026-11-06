/** TEST FIXTURE: installed AWS SDK, synthetic credentials and an in-memory HTTP handler. No AWS/owner authority. */
import test from "node:test";
import assert from "node:assert/strict";
import { BedrockRuntimeClient, ConverseCommand, CountTokensCommand, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { novaRuntimeSend, createLiveNovaTransport } from "../evaluation/bedrock-pilot/nova-live-transport";
import { type NovaHttpAuthorization, type NovaHttpSessionBinding } from "../evaluation/bedrock-pilot/nova-http-boundary";
import { serializeNova } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { PilotError } from "../evaluation/bedrock-pilot/config";

const epoch = Date.parse("2026-11-06T00:00:00Z"), signal = () => new AbortController().signal;
const input = (maxTokens = 2048): ConverseCommandInput => ({ modelId: "amazon.nova-pro-v1:0", system: [{ text: "TEST FIXTURE" }],
  messages: [{ role: "user", content: [{ text: "SYNTHETIC ONLY" }] }], inferenceConfig: { maxTokens, temperature: 0.2 } });
const category = (code: string) => (e: unknown) => e instanceof PilotError && e.code === code;
const wireBody = (body: string | Uint8Array) => typeof body === "string" ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
type Phase = NovaHttpAuthorization["phase"];

function fixture(options: { scope?: NovaHttpSessionBinding["scope"]; approval?: number; release?: number;
  credentials?: () => Promise<void>; signing?: () => Promise<void>; maxAttempts?: number; status?: number } = {}) {
  const original = Date.now; let now = epoch, handlerCalls = 0, credentials = 0, checks = 0;
  Date.now = () => now;
  const trace: string[] = [], requests: any[] = [];
  const binding: NovaHttpSessionBinding = Object.freeze({ approvalId: "SYNTHETIC_APPROVAL", approvalHash: "a".repeat(64), configHash: "c".repeat(64),
    ledgerDirectory: "SYNTHETIC_LEDGER_DIRECTORY", approvalExpiresAt: new Date(options.approval ?? epoch + 1000).toISOString(),
    inferenceReleaseExpiresAt: new Date(options.release ?? epoch + 1000).toISOString(), scope: options.scope ?? "ONE_SHOT" });
  const client = new BedrockRuntimeClient({ region: "us-east-1", maxAttempts: options.maxAttempts ?? 1,
    credentials: async () => { credentials++; trace.push("credentials:start"); await options.credentials?.(); trace.push("credentials:resolved");
      return { accessKeyId: "TESTFIXTUREACCESSKEY", secretAccessKey: "TEST_FIXTURE_NOT_REAL" }; },
    requestHandler: { async handle(request: any) {
      handlerCalls++; trace.push("handler"); requests.push(request);
      const measure = JSON.parse(wireBody(request.body)).inferenceConfig?.maxTokens === 1;
      return { response: { statusCode: options.status ?? 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(options.status ?
        { message: "TEST FIXTURE retryable error" } : { output: { message: { role: "assistant", content: [{ text: measure ? "{" : "{}" }] } },
          stopReason: measure ? "max_tokens" : "end_turn", usage: { inputTokens: 10, outputTokens: measure ? 1 : 2, totalTokens: measure ? 11 : 12 }, metrics: { latencyMs: 1 } })) } };
    }, destroy() {} } });
  // Wrap the actual SDK signer's asynchronous sign(), not a guessed middleware priority.
  if (options.signing) {
    const config = client.config as any;
    config.httpAuthSchemes = config.httpAuthSchemes.map((scheme: any) => ({ ...scheme, signer: { ...scheme.signer,
      async sign(...args: any[]) { trace.push("sign:start"); const result = await scheme.signer.sign(...args); await options.signing!(); trace.push("sign:resolved"); return result; },
    } }));
  }
  const send = novaRuntimeSend(client, binding), transport = createLiveNovaTransport(send);
  const authority = (phase: Phase, ordinal = 1, value = input(phase === "MEASURE" ? 1 : 2048)): NovaHttpAuthorization => {
    const wire = serializeNova(value);
    return Object.freeze({ binding, phase, reservationId: `${phase}:${ordinal}`, reservationOrdinal: ordinal, promptHash: "d".repeat(64),
      tokenPayloadHash: wire.identity.tokenPayloadHash, requestHash: wire.identity.inferenceRequestHash,
      assertCurrent: () => { checks++; trace.push("session:checked"); },
    });
  };
  return { client, send, transport, binding, authority, trace, requests,
    now: (value: number) => { now = value; }, handlerCalls: () => handlerCalls, credentials: () => credentials, checks: () => checks,
    close: () => { client.destroy(); Date.now = original; } };
}

for (const phase of ["MEASURE", "INFERENCE"] as const) for (const gap of ["credentials", "signing"] as const) {
  test(`${phase}: expiry during asynchronous ${gap} never reaches the HTTP handler`, async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ scope: phase === "MEASURE" ? "MEASURE_ONLY" : "INFERENCE_ONLY", [gap]: async () => { await Promise.resolve(); f.now(epoch + 1000); } });
    try {
      await assert.rejects(f.send(input(phase === "MEASURE" ? 1 : 2048), signal(), f.authority(phase)), category("LiveNotApproved"));
      assert.equal(f.handlerCalls(), 0); assert.equal(f.credentials(), 1);
      if (gap === "signing") assert.ok(f.trace.includes("sign:resolved"));
    } finally { f.close(); }
  });
}
for (const gap of ["credentials", "signing"] as const) test(`INFERENCE: independently earlier release expiry during ${gap} is typed and blocks HTTP`, async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture({ scope: "INFERENCE_ONLY", approval: epoch + 2000, release: epoch + 1000, [gap]: async () => { await Promise.resolve(); f.now(epoch + 1000); } });
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("INFERENCE_RELEASE_EXPIRED")); assert.equal(f.handlerCalls(), 0); }
  finally { f.close(); }
});

for (const phase of ["MEASURE", "INFERENCE"] as const) for (const offset of [-1, 0, 1]) test(`${phase}: exact expiry boundary offset ${offset}`, async () => {
  const f = fixture({ scope: phase === "MEASURE" ? "MEASURE_ONLY" : "INFERENCE_ONLY" });
  try {
    f.now(epoch + 1000 + offset);
    if (offset < 0) { await f.send(input(phase === "MEASURE" ? 1 : 2048), signal(), f.authority(phase)); assert.equal(f.handlerCalls(), 1); }
    else { await assert.rejects(f.send(input(phase === "MEASURE" ? 1 : 2048), signal(), f.authority(phase)), category("LiveNotApproved")); assert.equal(f.handlerCalls(), 0); assert.equal(f.credentials(), 0); }
  } finally { f.close(); }
});
for (const offset of [0, 1]) test(`INFERENCE: exact release boundary offset ${offset}`, async () => {
  const f = fixture({ scope: "INFERENCE_ONLY", approval: epoch + 2000 });
  try { f.now(epoch + 1000 + offset); await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("INFERENCE_RELEASE_EXPIRED")); assert.equal(f.handlerCalls(), 0); }
  finally { f.close(); }
});

test("valid measurement/count and inference both pass the actual guarded handler once, preserving transport usage", async () => {
  const f = fixture();
  try {
    const count = await f.transport.count(input(), signal(), f.authority("MEASURE"));
    const result = await f.transport.invoke(input(), signal(), f.authority("INFERENCE"));
    assert.equal(typeof count === "number" ? count : count.inputTokens, 10); assert.equal(result.usage?.outputTokens, 2);
    assert.equal(f.handlerCalls(), 2); assert.ok(f.checks() >= 4);
    assert.deepEqual(f.requests.map(r => JSON.parse(wireBody(r.body)).inferenceConfig.maxTokens), [1, 2048]);
    assert.ok(f.requests.every(r => r.headers.authorization.startsWith("AWS4-HMAC-SHA256 ")));
  } finally { f.close(); }
});

test("unknown/missing authority and a different session binding are rejected before credentials or HTTP", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.send(input(), signal()), category("NOVA_HTTP_AUTHORIZATION_REQUIRED"));
    await assert.rejects(f.send(input(), signal(), { ...f.authority("INFERENCE"), assertCurrent: undefined } as never), category("NOVA_HTTP_AUTHORIZATION_REQUIRED"));
    for (const patch of [{ approvalId: "other" }, { approvalHash: "b".repeat(64) }, { configHash: "b".repeat(64) }, { ledgerDirectory: "other" }, { approvalExpiresAt: new Date(epoch + 9999).toISOString() }])
      await assert.rejects(f.send(input(), signal(), { ...f.authority("INFERENCE"), binding: { ...f.binding, ...patch } }), category("NOVA_HTTP_AUTHORITY_MISMATCH"));
    assert.equal(f.handlerCalls(), 0); assert.equal(f.credentials(), 0);
  } finally { f.close(); }
});

test("scope, reservation, token payload and exact request identity cannot be substituted", async () => {
  const f = fixture({ scope: "MEASURE_ONLY" });
  try {
    await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_PHASE_MISMATCH"));
    for (const patch of [{ reservationOrdinal: 0 }, { reservationId: "" }, { promptHash: "bad" }])
      await assert.rejects(f.send(input(1), signal(), { ...f.authority("MEASURE"), ...patch }), category("NOVA_HTTP_RESERVATION_INVALID"));
    for (const patch of [{ tokenPayloadHash: "b".repeat(64) }, { requestHash: "b".repeat(64) }])
      await assert.rejects(f.send(input(1), signal(), { ...f.authority("MEASURE"), ...patch }), category("NOVA_HTTP_REQUEST_MISMATCH"));
    assert.equal(f.handlerCalls(), 0);
  } finally { f.close(); }
});

test("raw SDK sends, including CountTokens, cannot bypass the missing per-request context", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.client.send(new ConverseCommand(input())), category("NOVA_HTTP_AUTHORIZATION_REQUIRED"));
    await assert.rejects(f.client.send(new CountTokensCommand({ modelId: "amazon.nova-pro-v1:0", input: { converse: { messages: input().messages! } } })), category("NOVA_HTTP_AUTHORIZATION_REQUIRED"));
    assert.equal(f.handlerCalls(), 0); // Run-4 measurement is Converse maxTokens=1; no new CountTokens authority.
  } finally { f.close(); }
});

test("late asynchronous middleware cannot move expiry past the final handler guard", async () => {
  const f = fixture({ scope: "INFERENCE_ONLY", approval: epoch + 2000 });
  f.client.middlewareStack.addRelativeTo((next: (args: any) => Promise<any>) => async (args: any) => { await Promise.resolve(); f.now(epoch + 1000); return next(args); },
    { name: "fixtureLateDelay", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("INFERENCE_RELEASE_EXPIRED")); assert.equal(f.handlerCalls(), 0); }
  finally { f.close(); }
});

test("middleware removal or unsigned serialization cannot silently bypass the handler guard", async () => {
  const f = fixture(); f.client.middlewareStack.remove("httpSigningMiddleware");
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_UNSIGNED_REQUEST")); assert.equal(f.handlerCalls(), 0); }
  finally { f.close(); }
});

test("signed HTTP body mutation is rejected; request handler cannot be replaced", async () => {
  const f = fixture();
  f.client.middlewareStack.addRelativeTo((next: (args: any) => Promise<any>) => async (args: any) => { args.request.body = "{}"; return next(args); },
    { name: "fixtureBodyMutation", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try {
    assert.throws(() => { (f.client.config as any).requestHandler = { handle() { throw Error("must not run"); } }; }, TypeError);
    await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_REQUEST_MISMATCH")); assert.equal(f.handlerCalls(), 0);
  } finally { f.close(); }
});

test("reservation remains consumed after HTTP expiry; retrying the same authorization never dispatches", async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture({ credentials: async () => { f.now(epoch + 1001); } });
  try {
    const authority = f.authority("INFERENCE");
    await assert.rejects(f.send(input(), signal(), authority), category("LiveNotApproved")); assert.equal(f.handlerCalls(), 0);
    f.now(epoch); await assert.rejects(f.send(input(), signal(), authority), category("NOVA_HTTP_RESERVATION_REPLAY")); assert.equal(f.handlerCalls(), 0);
  } finally { f.close(); }
});

test("SDK internal retries re-enter the guard but cannot create a second billed dispatch", async () => {
  const f = fixture({ maxAttempts: 3, status: 503 });
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_DISPATCH_REPLAY")); assert.equal(f.handlerCalls(), 1); assert.ok(f.checks() >= 3); }
  finally { f.close(); }
});

test("concurrent authorized/unauthorized requests cannot borrow AsyncLocalStorage context", async () => {
  let resolve!: () => void;
  const ready = new Promise<void>(r => { resolve = r; });
  const f = fixture({ credentials: async () => { await ready; } });
  try {
    const valid = f.send(input(), signal(), f.authority("INFERENCE"));
    const invalid = assert.rejects(f.client.send(new ConverseCommand(input())), category("NOVA_HTTP_AUTHORIZATION_REQUIRED"));
    resolve();
    await Promise.all([valid, invalid]); assert.equal(f.handlerCalls(), 1);
    await assert.rejects(f.client.send(new ConverseCommand(input())), category("NOVA_HTTP_AUTHORIZATION_REQUIRED")); assert.equal(f.handlerCalls(), 1);
  } finally { f.close(); }
});

test("measurement authority expiring between calls prevents any additional HTTP dispatch", async () => {
  const f = fixture({ scope: "MEASURE_ONLY" });
  try {
    await f.send(input(1), signal(), f.authority("MEASURE")); assert.equal(f.handlerCalls(), 1);
    f.now(epoch + 1000); await assert.rejects(f.send(input(1), signal(), f.authority("MEASURE", 2)), category("LiveNotApproved")); assert.equal(f.handlerCalls(), 1);
  } finally { f.close(); }
});

test("approval expiring while the session release check runs is rechecked immediately before HTTP", async () => {
  const f = fixture({ scope: "INFERENCE_ONLY" }); let checks = 0;
  try {
    const authority = { ...f.authority("INFERENCE"), assertCurrent: () => { if (++checks === 2) f.now(epoch + 1000); } };
    await assert.rejects(f.send(input(), signal(), authority), category("LiveNotApproved")); assert.equal(checks, 2); assert.equal(f.handlerCalls(), 0);
  } finally { f.close(); }
});

test("unknown clock and asynchronous authorization callbacks fail closed", async () => {
  const f = fixture();
  try {
    f.now(NaN); await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID")); assert.equal(f.handlerCalls(), 0);
    f.now(epoch); await assert.rejects(f.send(input(), signal(), { ...f.authority("INFERENCE"), assertCurrent: async () => {} }), category("NOVA_HTTP_ASYNC_AUTHORITY_FORBIDDEN")); assert.equal(f.handlerCalls(), 0);
  } finally { f.close(); }
});

test("SDK-internal retry rechecks expiry before considering another handler dispatch", async () => {
  const f = fixture({ maxAttempts: 3, status: 503 }); let passes = 0;
  f.client.middlewareStack.addRelativeTo((next: (args: any) => Promise<any>) => async (args: any) => { if (++passes === 2) f.now(epoch + 1000); return next(args); },
    { name: "fixtureExpiryOnRetry", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("LiveNotApproved")); assert.equal(passes, 2); assert.equal(f.handlerCalls(), 1); }
  finally { f.close(); }
});

test("duplicate-key signed body cannot change request interpretation", async () => {
  const f = fixture();
  f.client.middlewareStack.addRelativeTo((next: (args: any) => Promise<any>) => async (args: any) => {
    args.request.body = wireBody(args.request.body).replace('"messages":', '"messages":[],"messages":'); return next(args);
  }, { name: "fixtureDuplicateBodyKey", relation: "after", toMiddleware: "httpSigningMiddleware" });
  try { await assert.rejects(f.send(input(), signal(), f.authority("INFERENCE")), category("NOVA_HTTP_REQUEST_MISMATCH")); assert.equal(f.handlerCalls(), 0); }
  finally { f.close(); }
});

test("authorized concurrent sends retain their own frozen request identities", async () => {
  const f = fixture();
  try {
    const a = input(), b = input(); b.messages![0].content = [{ text: "SECOND SYNTHETIC REQUEST" }];
    const pending = [f.send(a, signal(), f.authority("INFERENCE", 1, a)), f.send(b, signal(), f.authority("INFERENCE", 2, b))];
    a.messages![0].content = [{ text: "MUTATED CALLER OBJECT" }]; await Promise.all(pending);
    assert.equal(f.handlerCalls(), 2);
    const bodies = f.requests.map(r => wireBody(r.body)); assert.ok(bodies.some(b => b.includes("SYNTHETIC ONLY"))); assert.ok(bodies.some(b => b.includes("SECOND SYNTHETIC REQUEST")));
    assert.ok(bodies.every(b => !b.includes("MUTATED CALLER")));
  } finally { f.close(); }
});

test("changing a reservation label cannot reuse an already consumed ordinal", async () => {
  const f = fixture();
  try {
    const a = f.authority("INFERENCE"); await f.send(input(), signal(), a); assert.equal(f.handlerCalls(), 1);
    await assert.rejects(f.send(input(), signal(), { ...a, reservationId: "new-label-same-reservation" }), category("NOVA_HTTP_RESERVATION_REPLAY")); assert.equal(f.handlerCalls(), 1);
  } finally { f.close(); }
});

for (const phase of ["MEASURE", "INFERENCE"] as const) test(`${phase}: actual execution trace ends with synchronous authority check then HTTP handler`, async t => {
  const f = fixture({ scope: phase === "MEASURE" ? "MEASURE_ONLY" : "INFERENCE_ONLY", signing: async () => { await Promise.resolve(); } });
  try {
    await f.send(input(phase === "MEASURE" ? 1 : 2048), signal(), f.authority(phase)); assert.equal(f.handlerCalls(), 1);
    assert.ok(f.trace.indexOf("credentials:resolved") < f.trace.indexOf("sign:resolved"));
    assert.ok(f.trace.indexOf("sign:resolved") < f.trace.lastIndexOf("session:checked"));
    assert.deepEqual(f.trace.slice(-2), ["session:checked", "handler"]);
    t.diagnostic(JSON.stringify({ phase, trace: f.trace }));
  } finally { f.close(); }
});

for (const phase of ["MEASURE", "INFERENCE"] as const) test(`old-commit control: ${phase} SDK-invocation-only check lets expired authority reach handler`, async () => {
  const real = Date.now; let now = epoch, calls = 0;
  Date.now = () => now;
  const client = new BedrockRuntimeClient({ region: "us-east-1", maxAttempts: 1, credentials: async () => { await Promise.resolve(); now += 1001; return { accessKeyId: "TESTFIXTUREACCESSKEY", secretAccessKey: "TEST_FIXTURE_NOT_REAL" }; },
    requestHandler: { async handle() { calls++; return { response: { statusCode: 200, headers: {}, body: Buffer.from("{}") } }; }, destroy() {} } });
  try { assert.ok(now < epoch + 1000); await client.send(new ConverseCommand(input(phase === "MEASURE" ? 1 : 2048))); assert.equal(calls, 1); assert.ok(now > epoch + 1000); }
  finally { client.destroy(); Date.now = real; }
});
