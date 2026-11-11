import test from "node:test";
import assert from "node:assert/strict";
import { isThrottleError, withThrottleBackoff } from "../datasets/seed/embedding-backoff";

/** Bedrock/Cohere throttled the first full ingest (HTTP 429) after ~240 rows; only throttling is retried. */
test("isThrottleError recognises the shapes seen from the AWS SDK and the wrapped LlmError", () => {
  assert.equal(isThrottleError({ name: "ThrottlingException", message: "Too many requests, please wait before trying again." }), true);
  assert.equal(isThrottleError({ $metadata: { httpStatusCode: 429 } }), true);
  assert.equal(isThrottleError({ message: "Embedding generation failed: Too many requests, please wait before trying again." }), true);
  assert.equal(isThrottleError({ message: "outer", cause: { status: 429 } }), true);
  assert.equal(isThrottleError(new Error("ValidationException: bad body")), false);
  assert.equal(isThrottleError(null), false);
});

test("withThrottleBackoff retries a throttle error once and then succeeds", async () => {
  let calls = 0;
  const result = await withThrottleBackoff(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Too many requests"), { status: 429 });
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withThrottleBackoff does not retry a non-throttle failure", async () => {
  let calls = 0;
  await assert.rejects(
    withThrottleBackoff(async () => { calls += 1; throw new Error("ValidationException"); }),
    /ValidationException/,
  );
  assert.equal(calls, 1);
});
