import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import pino from "pino";
import jwt from "jsonwebtoken";
import { logRedactOptions } from "@gym-coach/shared";
import app from "../app";
import { authRepository } from "../repositories/auth.repository";

/**
 * V-T001 — central log redaction. pino-http's default `req` serializer copies `req.headers`
 * verbatim onto every logged request (see pino-std-serializers' reqSerializer —
 * `_req.headers = req.headers`), so before this fix every Authorization bearer token, cookie
 * and the gateway's internal x-gateway-secret sent to this service was written to stdout in
 * plain text on every request. A second path: this codebase mostly calls
 * `logger.error(err, "message")` with the caught Error itself as pino's top-level merging
 * object (not wrapped as `{ err }`), so any enumerable own property an HTTP client attaches to
 * its errors — axios puts the outgoing request config, headers included, on `.config` — landed
 * at the TOP level of the log object with no serializer applied at all.
 *
 * These tests exercise the REAL `logRedactOptions` exported from backend/shared/src/index.ts
 * (the exact config the production `logger` singleton is built with) through the REAL
 * `pino-http` middleware, so they fail if the fix regresses. They deliberately do NOT capture
 * the production singleton's actual stdout: pino's default destination writes to fd 1 below
 * the Node stream layer, and overriding `process.stdout.write` around it races with the test
 * runner's own TAP reporter (confirmed experimentally — a test using that approach silently
 * disappeared from the test-runner's own report). A second pino instance built with the exact
 * same `logRedactOptions`, pointed at an in-memory stream, is deterministic and avoids that.
 */

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function signAccessToken(userId: string, role: string, email: string): string {
  return jwt.sign({ userId, role, email }, ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
}

function makeCollectingLogger(): { testLogger: pino.Logger; getLines: () => Record<string, unknown>[]; getRaw: () => string } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  const testLogger = pino({ redact: logRedactOptions }, dest);
  return {
    testLogger,
    getRaw: () => chunks.join(""),
    getLines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l)),
  };
}

/** Same middleware shape as auth-service's real app.ts (helmet + pinoHttp({ logger }) + routes),
 * wired to a test-controlled logger instead of stdout, so the actual pino-http
 * request/response serialization plus our redact config can be exercised deterministically. */
function buildProbeApp(testLogger: pino.Logger): express.Express {
  const probe = express();
  probe.disable("x-powered-by");
  probe.use(helmet());
  probe.use(express.json());
  probe.use(pinoHttp({ logger: testLogger }));
  probe.get("/health", (_req, res) => res.json({ status: "ok" }));
  probe.post("/echo", (_req, res) => res.json({ ok: true }));
  return probe;
}

async function withServer(probe: express.Express, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = probe.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("TEST-01 — a synthetic Authorization bearer token sent on a real request never reaches the log", async () => {
  const { testLogger, getRaw, getLines } = makeCollectingLogger();
  const synthToken = "SYN_BEARER_9f3a7c21e4";
  await withServer(buildProbeApp(testLogger), async (baseUrl) => {
    await fetch(`${baseUrl}/health`, { headers: { Authorization: `Bearer ${synthToken}` } });
  });
  const raw = getRaw();
  assert.ok(!raw.includes(synthToken), "raw synthetic token must not appear anywhere in the log");
  const reqLine = getLines().find((l) => (l as any).req) as any;
  assert.ok(reqLine, "pino-http must still emit a request log line");
  assert.equal(reqLine.req.headers.authorization, "[REDACTED]");
});

test("TEST-02 — nested structured-log properties (1 and 2 levels deep) are redacted", () => {
  const { testLogger, getRaw, getLines } = makeCollectingLogger();
  const synthPassword = "SYN_PW_b81c";
  const synthRefresh = "SYN_REFRESH_77ee";
  testLogger.info({ user: { password: synthPassword } }, "nested one level");
  testLogger.info({ payload: { body: { refreshToken: synthRefresh } } }, "nested two levels");
  const raw = getRaw();
  assert.ok(!raw.includes(synthPassword));
  assert.ok(!raw.includes(synthRefresh));
  const lines = getLines();
  assert.equal((lines[0] as any).user.password, "[REDACTED]");
  assert.equal((lines[1] as any).payload.body.refreshToken, "[REDACTED]");
});

test("TEST-03 — Cookie and the gateway's internal x-gateway-secret header are redacted", async () => {
  const { testLogger, getRaw, getLines } = makeCollectingLogger();
  const synthCookie = "session=SYN_COOKIE_4d2a";
  const synthGatewaySecret = "SYN_GW_SECRET_0091";
  await withServer(buildProbeApp(testLogger), async (baseUrl) => {
    await fetch(`${baseUrl}/health`, {
      headers: { Cookie: synthCookie, "x-gateway-secret": synthGatewaySecret },
    });
  });
  const raw = getRaw();
  assert.ok(!raw.includes(synthCookie));
  assert.ok(!raw.includes(synthGatewaySecret));
  const reqLine = getLines().find((l) => (l as any).req) as any;
  assert.ok(reqLine);
  assert.equal(reqLine.req.headers.cookie, "[REDACTED]");
  assert.equal(reqLine.req.headers["x-gateway-secret"], "[REDACTED]");
});

test("TEST-04 — an axios-style error (credentials on .config.headers) is redacted, both call styles", () => {
  const { testLogger, getRaw, getLines } = makeCollectingLogger();
  const synthAxiosToken = "SYN_AXIOS_TOKEN_c5f1";
  const fakeAxiosError: any = new Error("downstream call failed");
  fakeAxiosError.isAxiosError = true;
  fakeAxiosError.config = { headers: { Authorization: `Bearer ${synthAxiosToken}` } };

  // Mirrors this codebase's actual call style: the raw Error as pino's top-level merging
  // object, e.g. auth.controller.ts's `logger.error(error, "Verify token error")`. Pino itself
  // auto-wraps a bare Error into `{ err }` (see pino/lib/proto.js's `write()`), so this and the
  // explicitly-wrapped style below both end up serialized under the same `err` key.
  testLogger.error(fakeAxiosError, "downstream call failed (unwrapped)");
  // The less common but still-present explicitly-wrapped style.
  testLogger.error({ err: fakeAxiosError }, "downstream call failed (wrapped)");

  const raw = getRaw();
  assert.ok(!raw.includes(synthAxiosToken), "axios Authorization header must not leak from either call style");
  const lines = getLines();
  assert.equal((lines[0] as any).err.config.headers.Authorization, "[REDACTED]");
  assert.equal((lines[1] as any).err.config.headers.Authorization, "[REDACTED]");
});

test("TEST-05 — operational metadata survives redaction (method, path, status, request id, duration)", async () => {
  const { testLogger, getLines } = makeCollectingLogger();
  await withServer(buildProbeApp(testLogger), async (baseUrl) => {
    await fetch(`${baseUrl}/health`);
  });
  const lines = getLines();
  const reqLine = lines.find((l) => (l as any).req) as any;
  const resLine = lines.find((l) => (l as any).res) as any;
  assert.ok(reqLine, "request log line present");
  assert.equal(reqLine.req.method, "GET");
  assert.equal(reqLine.req.url, "/health");
  assert.ok(reqLine.req.id !== undefined && reqLine.req.id !== null, "request id preserved");
  assert.ok(resLine, "response log line present");
  assert.equal(resLine.res.statusCode, 200);
  assert.ok(typeof resLine.responseTime === "number", "duration preserved");
});

test("TEST-06/07 — an authenticated request flow still works end to end, and no synthetic credential leaks across repeated calls", async () => {
  // Part A — functional/backward-compatibility check against the REAL app + REAL auth routes.
  const restoreFindById = patch(authRepository, "findUserById", async () => ({
    id: "user-logredact-1",
    email: "logredact@example.test",
    role: "CUSTOMER",
    isActive: true,
  }));
  let server: import("node:http").Server | undefined;
  try {
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    const synthToken = signAccessToken("user-logredact-1", "CUSTOMER", "logredact@example.test");

    const res = await fetch(`${baseUrl}/auth/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${synthToken}` },
    });
    assert.equal(res.status, 200, "authenticated route behavior must be unaffected by the logging change");
    const body: any = await res.json();
    assert.equal(body.user.id, "user-logredact-1");
  } finally {
    restoreFindById();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }

  // Part B — leak-free check across several repeated authenticated-shaped requests, using the
  // exact same pino-http + redact-config mechanism (see buildProbeApp), deterministically
  // observed via the in-memory collecting logger instead of racing the real stdout fd.
  const { testLogger, getRaw } = makeCollectingLogger();
  const synthToken2 = "SYN_FLOW_TOKEN_22bb";
  const synthCookie2 = "session=SYN_FLOW_COOKIE_11aa";
  await withServer(buildProbeApp(testLogger), async (baseUrl) => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/echo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${synthToken2}`, Cookie: synthCookie2, "Content-Type": "application/json" },
        body: JSON.stringify({ i }),
      });
      assert.equal(res.status, 200);
    }
  });
  const raw = getRaw();
  assert.ok(!raw.includes(synthToken2), "access token must never appear across repeated authenticated calls");
  assert.ok(!raw.includes(synthCookie2), "cookie must never appear across repeated authenticated calls");
});

test("TEST-08 — concurrent requests do not mix identifiers or leak each other's credentials", async () => {
  const { testLogger, getRaw, getLines } = makeCollectingLogger();
  const synthSecretA = "SYN_CONCURRENT_A_001";
  const synthSecretB = "SYN_CONCURRENT_B_002";

  await withServer(buildProbeApp(testLogger), async (baseUrl) => {
    await Promise.all([
      fetch(`${baseUrl}/health`, { headers: { "x-gateway-secret": synthSecretA } }),
      fetch(`${baseUrl}/echo`, {
        method: "POST",
        headers: { Authorization: `Bearer dummy`, "x-gateway-secret": synthSecretB, "Content-Type": "application/json" },
        body: "{}",
      }),
    ]);
  });

  const raw = getRaw();
  assert.ok(!raw.includes(synthSecretA));
  assert.ok(!raw.includes(synthSecretB));

  const reqLines = getLines().filter((l) => (l as any).req) as any[];
  assert.ok(reqLines.length >= 2, "both concurrent requests must be logged");
  const ids = reqLines.map((l) => l.req.id);
  assert.equal(new Set(ids).size, ids.length, "each concurrent request must get a distinct request id");
  const healthLine = reqLines.find((l) => l.req.url === "/health");
  const echoLine = reqLines.find((l) => l.req.url === "/echo");
  assert.ok(healthLine && echoLine, "each request's own path must be attributed to the correct log line");
  assert.equal(healthLine.req.headers["x-gateway-secret"], "[REDACTED]");
  assert.equal(echoLine.req.headers["x-gateway-secret"], "[REDACTED]");
  assert.equal(echoLine.req.headers.authorization, "[REDACTED]");
});
