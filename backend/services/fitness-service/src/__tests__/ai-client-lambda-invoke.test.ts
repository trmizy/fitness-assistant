/**
 * On AWS DEV there is no ai-service host, so fitness-service's ai.client used to
 * fail every call (default http://ai-service:3003). When AI_LAMBDA_NAME is set the
 * client must deliver the same request by direct Lambda invoke, with the same
 * internal-token / x-user-id headers, and unwrap the proxy response exactly like
 * the HTTP path does.
 *
 * The AWS SDK is pointed at a local fake Lambda endpoint, so the real
 * invokeHttpLambda + InvokeCommand code path runs.
 *
 * Run with: npx tsx --test src/__tests__/ai-client-lambda-invoke.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { explainExerciseProgressionSafe } from "../clients/ai.client";

async function withFakeLambda(
  respond: (event: any) => { statusCode: number; body: unknown },
  run: (seen: { fn: string; event: any }[]) => Promise<void>,
): Promise<void> {
  const seen: { fn: string; event: any }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const fn = decodeURIComponent(req.url?.split("/functions/")[1]?.split("/")[0] ?? "");
      const event = JSON.parse(raw);
      seen.push({ fn, event });
      const out = respond(event);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: out.statusCode, body: JSON.stringify(out.body) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const prev = {
    lambda: process.env.AI_LAMBDA_NAME,
    endpoint: process.env.AWS_ENDPOINT_URL_LAMBDA,
    region: process.env.AWS_REGION,
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    internal: process.env.INTERNAL_SERVICE_SECRET,
  };
  process.env.AI_LAMBDA_NAME = "fitness-assistant-dev-ai";
  process.env.AWS_ENDPOINT_URL_LAMBDA = `http://127.0.0.1:${port}`;
  process.env.AWS_REGION = "ap-southeast-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.INTERNAL_SERVICE_SECRET = "internal-test-secret";
  try {
    await run(seen);
  } finally {
    for (const [k, v] of Object.entries({
      AI_LAMBDA_NAME: prev.lambda,
      AWS_ENDPOINT_URL_LAMBDA: prev.endpoint,
      AWS_REGION: prev.region,
      AWS_ACCESS_KEY_ID: prev.key,
      AWS_SECRET_ACCESS_KEY: prev.secret,
      INTERNAL_SERVICE_SECRET: prev.internal,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const payload = {
  userId: "user-1",
  exerciseName: "Squat",
  loggingMode: "REPS_LOAD" as const,
  status: "KEEP" as const,
  currentPerformance: null,
  nextTarget: null,
  reasonCodes: [],
  cycleContext: "test",
};

test("ai.client still uses plain HTTP to AI_SERVICE_URL when AI_LAMBDA_NAME is unset", async () => {
  let seenHeaders: http.IncomingHttpHeaders = {};
  let seenUrl = "";
  const server = http.createServer((req, res) => {
    seenHeaders = req.headers;
    seenUrl = req.url ?? "";
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { explanation: "via-http", source: "ai" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const prev = { lambda: process.env.AI_LAMBDA_NAME, url: process.env.AI_SERVICE_URL };
  delete process.env.AI_LAMBDA_NAME;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${port}`;
  try {
    const result = await explainExerciseProgressionSafe("user-9", payload);
    assert.deepEqual(result, { explanation: "via-http", source: "ai" });
    assert.equal(seenUrl, "/ai/explain-exercise-progression");
    assert.equal(seenHeaders["x-user-id"], "user-9");
  } finally {
    if (prev.lambda !== undefined) process.env.AI_LAMBDA_NAME = prev.lambda;
    if (prev.url === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = prev.url;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// One fake endpoint serves both scenarios: lambda-http.client caches its
// LambdaClient (and so the endpoint/port) for the life of the process.
test("ai.client delivers calls by Lambda invoke when AI_LAMBDA_NAME is set", async () => {
  await withFakeLambda(
    (event) =>
      JSON.parse(event.body).exerciseName === "Boom"
        ? { statusCode: 502, body: { error: "upstream" } }
        : { statusCode: 200, body: { success: true, data: { explanation: "ok", source: "ai" } } },
    async (seen) => {
      const result = await explainExerciseProgressionSafe("user-1", payload);
      assert.deepEqual(result, { explanation: "ok", source: "ai" });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].fn, "fitness-assistant-dev-ai");
      assert.equal(seen[0].event.rawPath, "/ai/explain-exercise-progression");
      assert.equal(seen[0].event.requestContext.http.method, "POST");
      assert.equal(seen[0].event.headers["x-user-id"], "user-1");
      assert.equal(seen[0].event.headers["x-internal-token"], "internal-test-secret");
      assert.equal(JSON.parse(seen[0].event.body).exerciseName, "Squat");

      // A non-2xx Lambda response is a failure: the Safe wrapper returns null.
      const failed = await explainExerciseProgressionSafe("user-1", { ...payload, exerciseName: "Boom" });
      assert.equal(failed, null);
      assert.equal(seen.length, 2);
    },
  );
});
