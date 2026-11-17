/**
 * user-service → gym/payment on AWS Lambda (partner report 2026-11-17: GET /contracts/gym-options 503).
 * The Lambda has no internal HTTP, so gym.client / payment.client must reach the other Lambda by invoke.
 * No network, no DB: the Lambda invoke itself is replaced through __setLambdaInvokeForTests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  __setLambdaInvokeForTests,
  installLambdaAdapter,
  parseLambdaUrl,
  serviceBaseUrl,
} from "../clients/lambda-http.client";

installLambdaAdapter();

type Call = { functionName: string; method: string; path: string; headers: Record<string, string>; query: Record<string, string>; body: unknown };
let calls: Call[] = [];
let answer: { statusCode: number; body: unknown } = { statusCode: 200, body: { data: { ok: true } } };
let delayMs = 0;

test.beforeEach(() => {
  calls = [];
  answer = { statusCode: 200, body: { data: { ok: true } } };
  delayMs = 0;
  __setLambdaInvokeForTests(async (c) => {
    calls.push(c);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return answer;
  });
});
test.after(() => __setLambdaInvokeForTests(null));

test("serviceBaseUrl: *_LAMBDA_NAME wins, then *_SERVICE_URL, then the default", () => {
  assert.equal(serviceBaseUrl("GYM", "http://d", { GYM_LAMBDA_NAME: "Fn-Gym", GYM_SERVICE_URL: "http://x" }), "lambda://Fn-Gym");
  assert.equal(serviceBaseUrl("GYM", "http://d", { GYM_SERVICE_URL: "http://x" }), "http://x");
  assert.equal(serviceBaseUrl("PAYMENT", "http://d", {}), "http://d");
  assert.equal(serviceBaseUrl("PAYMENT", "http://d", { PAYMENT_LAMBDA_NAME: "p" }), "lambda://p");
});

test("parseLambdaUrl keeps the function-name case, the path and the query", () => {
  assert.deepEqual(parseLambdaUrl("lambda://Fitness-Dev-Gym/internal/x/1?a=b&c=d%20e"), {
    functionName: "Fitness-Dev-Gym",
    path: "/internal/x/1",
    query: { a: "b", c: "d e" },
  });
  assert.equal(parseLambdaUrl("http://localhost:3006/x"), null);
});

test("GET: path, params, secret header and no body reach the Lambda; response data is returned like axios", async () => {
  const r = await axios.get("lambda://fn-gym/internal/collaborations/active", {
    params: { gymId: "g1", ptUserId: "p1" },
    headers: { "x-service-secret": "s3cret" },
    timeout: 3000,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { data: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].functionName, "fn-gym");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/internal/collaborations/active");
  assert.deepEqual(calls[0].query, { gymId: "g1", ptUserId: "p1" });
  assert.equal(calls[0].headers["x-service-secret"], "s3cret");
  assert.equal(calls[0].body, undefined);
});

test("POST: the JSON body arrives as an object", async () => {
  await axios.post("lambda://fn-pay/internal/contracts/no-show", { contractId: "c1", n: 2 }, { headers: { "x-service-secret": "s" }, timeout: 5000 });
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { contractId: "c1", n: 2 });
});

test("404 rejects with err.response.status = 404 (gymClient reads that as 'no collaboration')", async () => {
  answer = { statusCode: 404, body: { error: "not found" } };
  await assert.rejects(
    () => axios.get("lambda://fn-gym/internal/collaborations/active", { timeout: 3000 }),
    (e: any) => e.response?.status === 404 && e.response?.data?.error === "not found" && e.isAxiosError === true,
  );
});

test("503 rejects with err.response.status = 503", async () => {
  answer = { statusCode: 503, body: { error: "down" } };
  await assert.rejects(
    () => axios.post("lambda://fn-pay/internal/payments/checkout", {}, { timeout: 3000 }),
    (e: any) => e.response?.status === 503,
  );
});

test("timeout: a slow Lambda is cut at config.timeout like the HTTP path", async () => {
  delayMs = 200;
  await assert.rejects(() => axios.get("lambda://fn-gym/x", { timeout: 30 }), /timeout of 30ms/);
});

test("the real clients build lambda:// URLs when *_LAMBDA_NAME is set", async () => {
  process.env.GYM_LAMBDA_NAME = "fitness-assistant-dev-gym";
  process.env.INTERNAL_SERVICE_SECRET = "s";
  answer = { statusCode: 200, body: { data: { collaborationId: "c", platformRate: "0.1", ptRate: "0.7", gymRate: "0.2" } } };
  try {
    // module-level constant: this file imports gym.client only after the env is set
    const { gymClient } = await import("../clients/gym.client");
    const rates = await gymClient.getActiveCollaboration("g1", "p1");
    assert.equal(rates?.collaborationId, "c");
    assert.equal(calls[0].functionName, "fitness-assistant-dev-gym");
    assert.equal(calls[0].path, "/internal/collaborations/active");
    answer = { statusCode: 404, body: {} };
    assert.equal(await gymClient.getActiveCollaboration("g1", "p1"), null);
  } finally {
    delete process.env.GYM_LAMBDA_NAME;
  }
});
