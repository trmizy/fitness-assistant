"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { apiIsAt, apiTarget, cdnNeedsChange, OPEN_RATE, OPEN_BURST } = require("./web-gate.cjs");

test("api: a stage with no throttle fields is OPEN-ish but not 'at open' (open writes the defaults explicitly)", () => {
  assert.equal(apiIsAt("close", { DetailedMetricsEnabled: false }), false);
  assert.equal(apiIsAt("open", { DetailedMetricsEnabled: false }), false);
});

test("api: throttle 0/0 is closed, never open; the explicit defaults are open, never closed", () => {
  const closed = { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 };
  const open = { ThrottlingRateLimit: OPEN_RATE, ThrottlingBurstLimit: OPEN_BURST };
  assert.equal(apiIsAt("close", closed), true);
  assert.equal(apiIsAt("open", closed), false);
  assert.equal(apiIsAt("open", open), true);
  assert.equal(apiIsAt("close", open), false);
  assert.equal(apiIsAt("close", { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 5 }), false);
});

test("api: the written settings keep DetailedMetricsEnabled and only change the two throttle values", () => {
  assert.deepEqual(apiTarget("close", { DetailedMetricsEnabled: true }), { DetailedMetricsEnabled: true, ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 });
  assert.deepEqual(apiTarget("open", undefined), { DetailedMetricsEnabled: false, ThrottlingRateLimit: OPEN_RATE, ThrottlingBurstLimit: OPEN_BURST });
});

test("cdn: changes only when the Enabled flag is not already what is wanted", () => {
  assert.equal(cdnNeedsChange("close", true), true);
  assert.equal(cdnNeedsChange("close", false), false);
  assert.equal(cdnNeedsChange("open", false), true);
  assert.equal(cdnNeedsChange("open", true), false);
});
