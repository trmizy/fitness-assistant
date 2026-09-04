import test from "node:test";
import assert from "node:assert/strict";
import { authMiddleware } from "../middleware/auth.middleware";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";

/**
 * auth.middleware.ts, now routed through clients/auth-service.client.ts. Business semantics to
 * preserve exactly (per this task): 401 stays 401, 403 stays 403 (auth-service doesn't emit it
 * today, but the mapping must not collapse it if it ever does), auth-unavailable maps to 503,
 * and an unrecognized failure shape still falls back to the same generic 401 this middleware
 * always returned — not a blanket 500.
 *
 * authServiceClient.verifyToken is mocked directly here (the client's OWN transport behavior —
 * Lambda invoke vs HTTP fallback — is covered exhaustively in auth-service-client.test.ts) so
 * this file is purely about the middleware's response-mapping logic.
 */

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test("no Authorization header -> 401 without ever calling authServiceClient", async () => {
  const original = authServiceClient.verifyToken;
  let called = false;
  authServiceClient.verifyToken = (async () => {
    called = true;
    return { status: 200, data: {} };
  }) as any;
  try {
    const req: any = { headers: {} };
    const res = fakeRes();
    await authMiddleware(req, res, () => assert.fail("next() should not be called"));
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(called, false);
  } finally {
    authServiceClient.verifyToken = original;
  }
});

test("authServiceClient resolves 200 -> req.user set, next() called", async () => {
  const original = authServiceClient.verifyToken;
  let forwardedHeader: string | undefined;
  authServiceClient.verifyToken = (async (header: string) => {
    forwardedHeader = header;
    return { status: 200, data: { user: { id: "u1", email: "a@b.com", role: "CUSTOMER" } } };
  }) as any;
  try {
    const req: any = { headers: { authorization: "Bearer good-token" } };
    const res = fakeRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.user.id, "u1");
    assert.strictEqual(forwardedHeader, "Bearer good-token");
  } finally {
    authServiceClient.verifyToken = original;
  }
});

test("authServiceClient throws .response.status=401 -> middleware returns 401 with auth-service's message", async () => {
  const original = authServiceClient.verifyToken;
  authServiceClient.verifyToken = (async () => {
    throw Object.assign(new Error("401"), { response: { status: 401, data: { error: "Invalid token" } } });
  }) as any;
  try {
    const req: any = { headers: { authorization: "Bearer bad" } };
    const res = fakeRes();
    await authMiddleware(req, res, () => assert.fail("next() should not be called"));
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error, "Invalid token");
  } finally {
    authServiceClient.verifyToken = original;
  }
});

test("authServiceClient throws .response.status=403 -> middleware preserves 403 (not collapsed to 401)", async () => {
  const original = authServiceClient.verifyToken;
  authServiceClient.verifyToken = (async () => {
    throw Object.assign(new Error("403"), { response: { status: 403, data: { error: "Forbidden" } } });
  }) as any;
  try {
    const req: any = { headers: { authorization: "Bearer x" } };
    const res = fakeRes();
    await authMiddleware(req, res, () => assert.fail("next() should not be called"));
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.error, "Forbidden");
  } finally {
    authServiceClient.verifyToken = original;
  }
});

test("AuthServiceUnavailableError -> 503 Auth service unavailable", async () => {
  const original = authServiceClient.verifyToken;
  authServiceClient.verifyToken = (async () => {
    throw new AuthServiceUnavailableError(new Error("boom"));
  }) as any;
  try {
    const req: any = { headers: { authorization: "Bearer x" } };
    const res = fakeRes();
    await authMiddleware(req, res, () => assert.fail("next() should not be called"));
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.error, "Auth service unavailable");
  } finally {
    authServiceClient.verifyToken = original;
  }
});

test("unrecognized error shape (no .response, not AuthServiceUnavailableError) -> falls back to generic 401, not 500", async () => {
  const original = authServiceClient.verifyToken;
  authServiceClient.verifyToken = (async () => {
    throw new Error("something truly unexpected");
  }) as any;
  try {
    const req: any = { headers: { authorization: "Bearer x" } };
    const res = fakeRes();
    await authMiddleware(req, res, () => assert.fail("next() should not be called"));
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error, "Invalid or expired token");
  } finally {
    authServiceClient.verifyToken = original;
  }
});
