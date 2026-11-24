"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeEnv } = require("./set-lambda-env.cjs");

test("adds the key and keeps every other variable", () => {
  const r = mergeEnv({ A: "1", SECRET: "x" }, "CHAT_SERVICE_URL", "http://alb.example");
  assert.equal(r.changed, true);
  assert.deepEqual(r.next, { A: "1", SECRET: "x", CHAT_SERVICE_URL: "http://alb.example" });
});

test("overwrites a stale value (the ALB name changes every start)", () => {
  const r = mergeEnv({ CHAT_SERVICE_URL: "http://old", B: "2" }, "CHAT_SERVICE_URL", "http://new");
  assert.deepEqual(r, { changed: true, next: { CHAT_SERVICE_URL: "http://new", B: "2" } });
});

test("no change when the value is already right, including an already-empty value", () => {
  assert.equal(mergeEnv({ K: "v" }, "K", "v").changed, false);
  assert.equal(mergeEnv({ K: "" }, "K", "").changed, false);
});

test("blanking keeps the key with an empty value; a missing map is treated as empty", () => {
  assert.deepEqual(mergeEnv({ K: "v", O: "o" }, "K", ""), { changed: true, next: { K: "", O: "o" } });
  assert.deepEqual(mergeEnv(null, "K", ""), { changed: true, next: { K: "" } });
});

test("does not mutate its input", () => {
  const cur = { A: "1" };
  mergeEnv(cur, "B", "2");
  assert.deepEqual(cur, { A: "1" });
});
