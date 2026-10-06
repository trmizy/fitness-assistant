/**
 * Live AWS DEV bug (2026-09-30): real users saw "Invalid or expired token" while their access
 * token was perfectly valid. Root cause, confirmed via CloudWatch: `verifyToken()`'s direct
 * Lambda invoke of auth-service (see clients/lambda-http.client.ts) was being throttled by AWS
 * (fitness-assistant-dev-auth showed ~130 Throttles in one 5-minute window matching the reported
 * errors) — the invoke throws before auth-service ever answers, and the old catch-all mapped
 * that identically to a genuine 401 rejection. `isDefiniteTokenRejection()` is the extracted,
 * pure classifier auth.middleware.ts now uses to tell the two apart — these tests exercise it
 * directly with the exact error shapes each real failure mode produces, no mocking needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isDefiniteTokenRejection } from "../middleware/auth.middleware";

test("a real 401 from auth-service (throwForLambdaHttpError's shape) is a definite rejection", () => {
  const err = { message: "Invalid or expired token", response: { status: 401 } };
  assert.equal(isDefiniteTokenRejection(err), true);
});

test("a real 403 from auth-service is also a definite rejection", () => {
  const err = { response: { status: 403 } };
  assert.equal(isDefiniteTokenRejection(err), true);
});

test("AWS Lambda invoke throttle (TooManyRequestsException, 'Rate Exceeded.') has no .response — NOT a definite rejection", () => {
  const err = new Error("Rate Exceeded.");
  (err as { name: string }).name = "TooManyRequestsException";
  assert.equal(isDefiniteTokenRejection(err), false);
});

test("a network/timeout error (no HTTP response at all) is NOT a definite rejection", () => {
  const err = { message: "timeout of 5000ms exceeded", code: "ECONNABORTED" };
  assert.equal(isDefiniteTokenRejection(err), false);
});

test("auth-service itself returning 500 is NOT a definite token rejection (its own failure, not the caller's fault)", () => {
  const err = { response: { status: 500 } };
  assert.equal(isDefiniteTokenRejection(err), false);
});

test("a plain thrown string/undefined/null is NOT a definite rejection (never throws itself)", () => {
  assert.equal(isDefiniteTokenRejection("boom"), false);
  assert.equal(isDefiniteTokenRejection(undefined), false);
  assert.equal(isDefiniteTokenRejection(null), false);
});
