/** TEST FIXTURE: no signing, keys, ledger, filesystem persistence or network. */
import test from "node:test";
import assert from "node:assert/strict";
import { assertCurrentInferenceRelease, dispatchWithInferenceRelease } from "../evaluation/bedrock-pilot/inference-release-deadline";
import { PilotError } from "../evaluation/bedrock-pilot/config";

const code = (expected: string) => (error: unknown) => error instanceof PilotError && error.code === expected;
const epoch = Date.parse("2026-11-04T00:00:00Z");
test("release guard requires an already-verified descriptor and rejects malformed deadlines", () => {
  assert.throws(() => assertCurrentInferenceRelease(null, epoch), code("INFERENCE_RELEASE_REQUIRED"));
  assert.throws(() => assertCurrentInferenceRelease({ expiresAt: "not-a-date" }, epoch), code("INFERENCE_RELEASE_INVALID"));
  assert.throws(() => assertCurrentInferenceRelease({ expiresAt: new Date(epoch + 1).toISOString() }, NaN), code("INFERENCE_RELEASE_INVALID"));
});
test("release must be strictly in the future, including the exact expiry boundary", () => {
  const release = { expiresAt: new Date(epoch).toISOString() };
  assertCurrentInferenceRelease(release, epoch - 1);
  assert.throws(() => assertCurrentInferenceRelease(release, epoch), code("INFERENCE_RELEASE_EXPIRED"));
  assert.throws(() => assertCurrentInferenceRelease(release, epoch + 1), code("INFERENCE_RELEASE_EXPIRED"));
});
test("a release valid before delayed preflight cannot dispatch after it expires", async () => {
  const original = Date.now; let now = epoch, sends = 0;
  Date.now = () => now;
  try {
    const release = { expiresAt: new Date(epoch + 1000).toISOString() };
    assertCurrentInferenceRelease(release);
    // Represents a cached-count/pins await crossing expiry. No session/ledger/signature is manufactured.
    await Promise.resolve().then(() => { now += 1001; });
    assert.throws(() => dispatchWithInferenceRelease(release, () => { sends++; }), code("INFERENCE_RELEASE_EXPIRED"));
    assert.equal(sends, 0);
  } finally { Date.now = original; }
});
test("expiry during reservation-to-dispatch work is caught even after a fresh authorization check", () => {
  const original = Date.now; let now = epoch, sends = 0;
  Date.now = () => now;
  try {
    const release = { expiresAt: new Date(epoch + 1000).toISOString() };
    assertCurrentInferenceRelease(release); now += 1000;
    assert.throws(() => dispatchWithInferenceRelease(release, () => { sends++; }), code("INFERENCE_RELEASE_EXPIRED"));
    assert.equal(sends, 0);
  } finally { Date.now = original; }
});
test("a current release dispatches once, preserving the callback result and descriptor", () => {
  const release = Object.freeze({ expiresAt: new Date(Date.now() + 60000).toISOString() }), result = { raw: "TEST_RAW" }; let sends = 0;
  assert.equal(dispatchWithInferenceRelease(release, () => { sends++; return result; }), result);
  assert.equal(sends, 1);
});
test("dispatch preserves async provider errors and does not retry", async () => {
  const release = { expiresAt: new Date(Date.now() + 60000).toISOString() }, error = new Error("TEST_PROVIDER_ERROR"); let sends = 0;
  await assert.rejects(dispatchWithInferenceRelease(release, async () => { sends++; throw error; }), e => e === error);
  assert.equal(sends, 1);
});
