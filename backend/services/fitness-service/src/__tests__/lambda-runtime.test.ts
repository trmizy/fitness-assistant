import test from "node:test";
import assert from "node:assert/strict";

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    prev[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(env)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

test("isLambdaRuntime reflects AWS_LAMBDA_FUNCTION_NAME", async () => {
  const { isLambdaRuntime } = await import("../utils/runtime.util");
  await withEnv({ AWS_LAMBDA_FUNCTION_NAME: undefined }, () => {
    assert.equal(isLambdaRuntime(), false);
  });
  await withEnv({ AWS_LAMBDA_FUNCTION_NAME: "fitness-assistant-dev-fitness" }, () => {
    assert.equal(isLambdaRuntime(), true);
  });
});

test("validateRequiredRuntimeConfig fails closed without an internal service secret", async () => {
  const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
  await withEnv(
    { INTERNAL_SERVICE_SECRET: undefined, INTERNAL_API_SECRET: undefined },
    () => {
      assert.throws(() => validateRequiredRuntimeConfig(), /INTERNAL_SERVICE_SECRET/);
    },
  );
});

test("fitness Lambda handler imports and serves /health without Redis", async () => {
  await withEnv(
    {
      AWS_LAMBDA_FUNCTION_NAME: "fitness-assistant-dev-fitness",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/fitness_assistant_fitness",
      INTERNAL_SERVICE_SECRET: "test_internal_service_secret_32_chars_minimum",
      REDIS_HOST: undefined,
    },
    async () => {
      delete require.cache[require.resolve("../lambda")];
      const { handler } = require("../lambda");
      const response = await handler(
        {
          version: "2.0",
          routeKey: "GET /health",
          rawPath: "/health",
          rawQueryString: "",
          headers: { host: "example.com" },
          requestContext: {
            http: {
              method: "GET",
              path: "/health",
              sourceIp: "127.0.0.1",
              userAgent: "node-test",
            },
            requestId: "req-1",
          },
          isBase64Encoded: false,
        },
        {},
      );
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /fitness-service/);
    },
  );
});
