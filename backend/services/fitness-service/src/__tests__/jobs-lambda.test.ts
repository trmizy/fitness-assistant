import test from "node:test";
import assert from "node:assert/strict";

function withRuntimeEnv(fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of ["DATABASE_URL", "INTERNAL_SERVICE_SECRET", "NODE_ENV"]) {
    prev[key] = process.env[key];
  }
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/fitness_assistant_fitness";
  process.env.INTERNAL_SERVICE_SECRET = "test_internal_service_secret_32_chars_minimum";
  process.env.NODE_ENV = "test";
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

test("jobs Lambda rejects unknown jobs without starting interval workers", async () => {
  await withRuntimeEnv(async () => {
    delete require.cache[require.resolve("../jobs-lambda")];
    const { handler } = require("../jobs-lambda");
    const result = await handler({ job: "unknown-job" });
    assert.equal(result.statusCode, 400);
    assert.match(result.body, /Unknown fitness-service job/);
  });
});
