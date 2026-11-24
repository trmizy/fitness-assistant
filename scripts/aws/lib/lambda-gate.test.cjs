"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planFor, GATED } = require("./lambda-gate.cjs");

test("close: puts concurrency 0 unless it is already 0", () => {
  assert.equal(planFor("close", null), "put0");
  assert.equal(planFor("close", undefined), "put0");
  assert.equal(planFor("close", 5), "put0");
  assert.equal(planFor("close", 0), "keep");
});

test("open: removes any reserved concurrency (including 0), keeps an unset one", () => {
  assert.equal(planFor("open", 0), "delete");
  assert.equal(planFor("open", 10), "delete");
  assert.equal(planFor("open", null), "keep");
  assert.equal(planFor("open", undefined), "keep");
});

test("unknown action is rejected", () => {
  assert.throws(() => planFor("restart", 0), /unknown action/);
});

test("only the HTTP-facing DEV functions are gated - never workers, migrate/restore/query helpers or jobs", () => {
  assert.deepEqual(GATED.map((f) => f.replace("fitness-assistant-dev-", "")).sort(), ["ai", "ai-stream", "auth", "fitness", "gym", "payment", "user"]);
  for (const f of GATED) assert.match(f, /^fitness-assistant-dev-[a-z-]+$/);
  assert.ok(!GATED.some((f) => /worker|jobs|migrate|restore|query|keep-stopped/.test(f)));
});
