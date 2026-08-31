import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { LambdaClient } from "@aws-sdk/client-lambda";

/**
 * clients/auth-service.client.ts — direct Lambda invoke for the auth Lambda (TASK: replace the
 * public API Gateway URL for /auth/verify and /auth/internal/* with lambda:InvokeFunction), with
 * an HTTP fallback for local/Docker dev. Every scenario here is mocked at the SDK/axios layer —
 * no real AWS call, no real HTTP server, matching this task's "không tạo AWS test resource"
 * constraint.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function fakePayload(statusCode: number, body: unknown) {
  return Buffer.from(
    JSON.stringify({
      statusCode,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      isBase64Encoded: false,
    }),
  );
}

test("AUTH_LAMBDA_NAME set: verifyToken uses Lambda transport, forwards Authorization, returns 200 data", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth", AUTH_SERVICE_URL: undefined }, async () => {
    let capturedEvent: any;
    let capturedFunctionName: string | undefined;
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async function (command: any) {
      capturedFunctionName = command.input.FunctionName;
      capturedEvent = JSON.parse(Buffer.from(command.input.Payload).toString("utf8"));
      return { Payload: fakePayload(200, { user: { id: "u1", email: "a@b.com", role: "CUSTOMER" } }) };
    };
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      const { status, data } = await authServiceClient.verifyToken("Bearer abc.def.ghi");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.user.id, "u1");
      assert.strictEqual(capturedFunctionName, "fitness-assistant-dev-auth");
      assert.strictEqual(capturedEvent.version, "2.0");
      assert.strictEqual(capturedEvent.routeKey, "POST /auth/verify");
      assert.strictEqual(capturedEvent.rawPath, "/auth/verify");
      assert.strictEqual(capturedEvent.headers.Authorization, "Bearer abc.def.ghi");
      assert.strictEqual(capturedEvent.requestContext.http.method, "POST");
      assert.strictEqual(capturedEvent.isBase64Encoded, false);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("AUTH_LAMBDA_NAME set: internal calls attach x-service-secret from INTERNAL_SERVICE_SECRET", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth", INTERNAL_SERVICE_SECRET: "s3cr3t-value" }, async () => {
    let capturedEvent: any;
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async function (command: any) {
      capturedEvent = JSON.parse(Buffer.from(command.input.Payload).toString("utf8"));
      return { Payload: fakePayload(200, { user: { id: "u1" } }) };
    };
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      await authServiceClient.internalGet("/auth/internal/users/u1");
      assert.strictEqual(capturedEvent.headers["x-service-secret"], "s3cr3t-value");
      assert.strictEqual(capturedEvent.routeKey, "GET /auth/internal/users/u1");

      await authServiceClient.internalPost("/auth/internal/send-email", { to: "x@y.com", subject: "s", text: "t" });
      assert.strictEqual(capturedEvent.headers["x-service-secret"], "s3cr3t-value");
      assert.strictEqual(JSON.parse(capturedEvent.body).to, "x@y.com");

      await authServiceClient.internalPatch("/auth/internal/users/u1/role", { role: "PT" });
      assert.strictEqual(capturedEvent.routeKey, "PATCH /auth/internal/users/u1/role");
      assert.strictEqual(JSON.parse(capturedEvent.body).role, "PT");
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("Auth 401 from the Lambda is preserved as a thrown error with .response.status === 401", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({ Payload: fakePayload(401, { error: "Invalid token" }) });
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      await assert.rejects(
        authServiceClient.verifyToken("Bearer bad"),
        (err: any) => err.response?.status === 401 && err.response?.data?.error === "Invalid token",
      );
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("Auth 403 from the Lambda is preserved as-is (not collapsed to 401 or 500)", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({ Payload: fakePayload(403, { error: "Forbidden" }) });
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      await assert.rejects(
        authServiceClient.verifyToken("Bearer x"),
        (err: any) => err.response?.status === 403,
      );
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("FunctionError from the Lambda invoke -> AuthServiceUnavailableError", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({
      FunctionError: "Unhandled",
      Payload: Buffer.from(JSON.stringify({ errorType: "Error", errorMessage: "boom" })),
    });
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("missing Payload -> AuthServiceUnavailableError", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({});
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("malformed (non-JSON) Payload envelope -> AuthServiceUnavailableError, not a crash", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({ Payload: Buffer.from("{not json") });
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("Payload envelope missing statusCode -> AuthServiceUnavailableError", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({ Payload: Buffer.from(JSON.stringify({ notAnEnvelope: true })) });
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("2xx response with a non-JSON body string is returned as-is, not treated as invalid", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => ({
      Payload: Buffer.from(JSON.stringify({ statusCode: 200, body: "ok-plain-text", isBase64Encoded: false })),
    });
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      const { status, data } = await authServiceClient.verifyToken("Bearer x");
      assert.strictEqual(status, 200);
      assert.strictEqual(data, "ok-plain-text");
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

test("SDK throwing (network/permissions/etc.) -> AuthServiceUnavailableError, never crashes the caller", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: "fitness-assistant-dev-auth" }, async () => {
    const originalSend = LambdaClient.prototype.send;
    LambdaClient.prototype.send = async () => {
      throw new Error("AccessDeniedException: not authorized to invoke");
    };
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      LambdaClient.prototype.send = originalSend;
    }
  });
});

// ── HTTP fallback (AUTH_LAMBDA_NAME unset) ──────────────────────────────────────────────────

test("AUTH_LAMBDA_NAME missing: uses HTTP fallback against AUTH_SERVICE_URL, forwards Authorization", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: undefined, AUTH_SERVICE_URL: "http://fake-auth:3001" }, async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: any;
    const originalPost = axios.post;
    (axios as any).post = async (url: string, _body: any, config: any) => {
      capturedUrl = url;
      capturedHeaders = config.headers;
      return { status: 200, data: { user: { id: "u1" } } };
    };
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      const { status, data } = await authServiceClient.verifyToken("Bearer xyz");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.user.id, "u1");
      assert.strictEqual(capturedUrl, "http://fake-auth:3001/auth/verify");
      assert.strictEqual(capturedHeaders.Authorization, "Bearer xyz");
    } finally {
      (axios as any).post = originalPost;
    }
  });
});

test("HTTP fallback: internal calls attach x-service-secret and hit AUTH_SERVICE_URL", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: undefined, AUTH_SERVICE_URL: "http://fake-auth:3001", INTERNAL_SERVICE_SECRET: "s3cr3t" }, async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: any;
    const originalPatch = axios.patch;
    (axios as any).patch = async (url: string, _body: any, config: any) => {
      capturedUrl = url;
      capturedHeaders = config.headers;
      return { status: 200, data: { user: { id: "u1", role: "PT" } } };
    };
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      await authServiceClient.internalPatch("/auth/internal/users/u1/role", { role: "PT" });
      assert.strictEqual(capturedUrl, "http://fake-auth:3001/auth/internal/users/u1/role");
      assert.strictEqual(capturedHeaders["x-service-secret"], "s3cr3t");
    } finally {
      (axios as any).patch = originalPatch;
    }
  });
});

test("HTTP fallback: a real axios error with a response is rethrown unchanged (.response.status preserved)", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: undefined, AUTH_SERVICE_URL: "http://fake-auth:3001" }, async () => {
    const originalPost = axios.post;
    (axios as any).post = async () => {
      const err: any = new Error("Request failed with status code 401");
      err.isAxiosError = true;
      err.response = { status: 401, data: { error: "Invalid or expired token" } };
      throw err;
    };
    try {
      const { authServiceClient } = await import("../clients/auth-service.client");
      await assert.rejects(
        authServiceClient.verifyToken("Bearer bad"),
        (err: any) => err.response?.status === 401,
      );
    } finally {
      (axios as any).post = originalPost;
    }
  });
});

test("HTTP fallback: ECONNREFUSED (no response) -> AuthServiceUnavailableError", async () => {
  await withEnv({ AUTH_LAMBDA_NAME: undefined, AUTH_SERVICE_URL: "http://fake-auth:3001" }, async () => {
    const originalPost = axios.post;
    (axios as any).post = async () => {
      const err: any = new Error("connect ECONNREFUSED 127.0.0.1:3001");
      err.isAxiosError = true;
      err.code = "ECONNREFUSED";
      throw err;
    };
    try {
      const { authServiceClient, AuthServiceUnavailableError } = await import("../clients/auth-service.client");
      await assert.rejects(authServiceClient.verifyToken("Bearer x"), AuthServiceUnavailableError);
    } finally {
      (axios as any).post = originalPost;
    }
  });
});
