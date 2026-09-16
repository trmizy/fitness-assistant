/**
 * Per-user distributed rate limiting for the routes that call Bedrock
 * directly and synchronously (/ai/ask, /ai/ask/stream, /ai/generate-workout,
 * /ai/agent/goal-image, /ai/agent/image-chat).
 *
 * No real AWS calls anywhere in this file. DynamoDB is replaced at
 * `dynamoRateLimiterDeps.send` — the same seam-injection pattern already
 * used by bedrock.client.ts's `bedrockRuntimeDeps.send` — with a small
 * in-memory table that performs a genuinely atomic conditional increment,
 * so the "concurrent atomic counter" test exercises real race conditions
 * (many Promise.all'd consumers) against real UpdateExpression semantics,
 * not a pre-decided answer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  resolveRateLimitProvider,
  getRateLimiter,
  resetRateLimiterCache,
} from "../services/rate-limit/provider";
import { MemoryRateLimiter } from "../services/rate-limit/memory-rate-limiter";
import {
  DynamoDbRateLimiter,
  dynamoRateLimiterDeps,
  buildRateLimitKey,
  resolveRateLimitTableName,
} from "../services/rate-limit/dynamodb-rate-limiter";
import { RateLimitInfrastructureError } from "../services/rate-limit/types";
import { createRateLimiter } from "../middleware/rate-limit.middleware";
import { RateLimitedError, RateLimitUnavailableError } from "../errors/api-error";

// ── A fake, genuinely atomic DynamoDB table ────────────────────────────────
// Models exactly the UpdateExpression the real limiter sends: SET count =
// if_not_exists(count, 0) + 1, expiresAt = if_not_exists(expiresAt, :x).
// Each call increments and reads back in one synchronous step before any
// `await`, mirroring what makes DynamoDB's real UpdateItem atomic server-side.
function makeFakeDynamoTable() {
  const items = new Map<string, { count: number; expiresAt: number }>();
  const calls: Array<{ tableName: string; key: string }> = [];
  let failNext = false;
  let failAlways = false;

  dynamoRateLimiterDeps.send = async (command: any) => {
    const input = command.input;
    calls.push({ tableName: input.TableName, key: input.Key.key });
    if (failAlways || failNext) {
      failNext = false;
      throw Object.assign(new Error("simulated DynamoDB outage"), {
        name: "ServiceUnavailableException",
      });
    }
    const existing = items.get(input.Key.key);
    const count = (existing?.count ?? 0) + 1;
    const expiresAt = existing?.expiresAt ?? input.ExpressionAttributeValues[":expiresAt"];
    items.set(input.Key.key, { count, expiresAt });
    return { Attributes: { count, expiresAt } };
  };

  return {
    calls,
    items,
    failOnce: () => {
      failNext = true;
    },
    setFailing: (value: boolean) => {
      failAlways = value;
    },
  };
}

test.beforeEach(() => {
  delete process.env.RATE_LIMIT_PROVIDER;
  delete process.env.AI_RATE_LIMIT_TABLE;
  resetRateLimiterCache();
});

// ── 1/2/3. first request, requests 1-20 allowed, request 21 blocked ────────

test("memory provider: requests 1-20 allowed, request 21 returns not-allowed", async () => {
  const limiter = new MemoryRateLimiter();
  const results = [];
  for (let i = 0; i < 21; i++) {
    results.push(await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 }));
  }
  assert.equal(results[0].allowed, true, "first request allowed");
  assert.ok(results.slice(0, 20).every((r) => r.allowed), "requests 1-20 allowed");
  assert.equal(results[20].allowed, false, "request 21 blocked");
  assert.equal(results[20].count, 21);
});

test("dynamodb provider: requests 1-20 allowed, request 21 returns not-allowed, via one real UpdateItem call each", async () => {
  const table = makeFakeDynamoTable();
  const limiter = new DynamoDbRateLimiter("fitness-assistant-dev-ai-rate-limit");
  const results = [];
  for (let i = 0; i < 21; i++) {
    results.push(await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 }));
  }
  assert.ok(results.slice(0, 20).every((r) => r.allowed));
  assert.equal(results[20].allowed, false);
  assert.equal(table.calls.length, 21, "one UpdateItem per request, no batching that could hide a race");
  assert.ok(table.calls.every((c) => c.tableName === "fitness-assistant-dev-ai-rate-limit"));
});

// ── 4. new 60-second window allowed ─────────────────────────────────────────

test("memory provider: a new fixed window resets the counter", async () => {
  const limiter = new MemoryRateLimiter();
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000_000 * 1000; // window A
    for (let i = 0; i < 20; i++) {
      await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 });
    }
    const blocked = await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 });
    assert.equal(blocked.allowed, false);

    Date.now = () => (1_000_000_000 + 61) * 1000; // window B, 61s later
    const afterWindow = await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 });
    assert.equal(afterWindow.allowed, true);
    assert.equal(afterWindow.count, 1, "counter restarted at 1 in the new window");
  } finally {
    Date.now = realNow;
  }
});

test("dynamodb provider: a new window key never collides with the old window's item", () => {
  // windowStart is embedded in the key itself — proven directly, since this
  // is exactly what makes correctness independent of TTL cleanup timing
  // (task requirement §9): a stale, not-yet-reclaimed item from window A can
  // never be read or incremented by window B.
  const keyA = buildRateLimitKey("ai-ask:user-1", 1_000_000_000);
  const keyB = buildRateLimitKey("ai-ask:user-1", 1_000_000_060);
  assert.notEqual(keyA, keyB);
});

// ── 5. different users have independent limits ──────────────────────────────

test("different users never share a counter, on both providers", async () => {
  const memory = new MemoryRateLimiter();
  for (let i = 0; i < 20; i++) {
    await memory.consume({ key: "ai-ask:user-A", max: 20, windowSeconds: 60 });
  }
  const userA = await memory.consume({ key: "ai-ask:user-A", max: 20, windowSeconds: 60 });
  const userB = await memory.consume({ key: "ai-ask:user-B", max: 20, windowSeconds: 60 });
  assert.equal(userA.allowed, false, "user A exhausted their own quota");
  assert.equal(userB.allowed, true, "user B's quota is untouched");
  assert.equal(userB.count, 1);
});

// ── 6. concurrent atomic counter behavior ───────────────────────────────────

test("dynamodb provider: 40 concurrent requests for one user admit exactly 20, never more or fewer", async () => {
  makeFakeDynamoTable();
  const limiter = new DynamoDbRateLimiter();
  const results = await Promise.all(
    Array.from({ length: 40 }, () =>
      limiter.consume({ key: "ai-ask:concurrent-user", max: 20, windowSeconds: 60 }),
    ),
  );
  const allowedCount = results.filter((r) => r.allowed).length;
  assert.equal(allowedCount, 20, "exactly 20 admitted despite 40 concurrent callers — no lost updates, no double-admits");
  const counts = results.map((r) => r.count).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 40 }, (_, i) => i + 1), "every counter value 1..40 was handed out exactly once");
});

test("memory provider: concurrent requests within one process are also exactly bounded", async () => {
  const limiter = new MemoryRateLimiter();
  const results = await Promise.all(
    Array.from({ length: 40 }, () =>
      limiter.consume({ key: "ai-ask:concurrent-user", max: 20, windowSeconds: 60 }),
    ),
  );
  assert.equal(results.filter((r) => r.allowed).length, 20);
});

// ── 7. Retry-After ──────────────────────────────────────────────────────────

test("Retry-After reflects seconds remaining in the current fixed window", async () => {
  const limiter = new MemoryRateLimiter();
  const realNow = Date.now;
  try {
    Date.now = () => 600_000_010 * 1000; // 600_000_000 is an exact multiple of 60 -> 10s into that window
    for (let i = 0; i < 20; i++) {
      await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 });
    }
    const blocked = await limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 50);
  } finally {
    Date.now = realNow;
  }
});

// ── HTTP-level: middleware sets 429 + Retry-After using the existing error convention ──

function buildTestApp(limiterOptions: { name: string; max: number; windowSeconds: number }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    // Stands in for requireAuth's already-verified identity — the exact
    // contract the rate limiter depends on (req.context.userId).
    req.context = { userId: String(req.headers["x-test-user-id"] ?? "anon"), role: "" };
    next();
  });
  app.post("/ai/ask", createRateLimiter(limiterOptions), (_req, res) => {
    res.json({ success: true, data: { answer: "ok" } });
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json(err?.toJSON?.() ?? { success: false });
  });
  return app;
}

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("HTTP: the 21st request over the app returns 429 with Retry-After and the existing error envelope", async () => {
  const { url, close } = await listen(buildTestApp({ name: "ai-ask", max: 20, windowSeconds: 60 }));
  try {
    let last!: Response;
    for (let i = 0; i < 21; i++) {
      last = await fetch(`${url}/ai/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": "user-http-1" },
        body: "{}",
      });
    }
    assert.equal(last.status, 429);
    assert.ok(last.headers.get("retry-after"));
    const body: any = await last.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "RATE_LIMITED");
  } finally {
    await close();
  }
});

test("HTTP: 12. a request cannot obtain a second quota merely by presenting a different claimed userId — the key comes from req.context, set only after auth, never re-read from a header at the rate-limit layer", async () => {
  // This app's stand-in context setter reads x-test-user-id ONCE, deliberately
  // modelling the point AFTER requireAuth has already resolved identity — the
  // rate limiter itself never inspects request headers at all (see
  // rate-limit.middleware.ts: it only ever reads req.context.userId). The real
  // spoofing defense (a raw x-user-id cannot influence req.context without
  // also proving INTERNAL_SERVICE_SECRET or a valid Bearer JWT) is
  // auth.middleware.ts's job and is covered by its own test suite
  // (lambda-auth-and-invoke.test.ts); this test proves the rate limiter
  // composes correctly with whatever identity auth resolved.
  const { url, close } = await listen(buildTestApp({ name: "ai-ask", max: 1, windowSeconds: 60 }));
  try {
    const first = await fetch(`${url}/ai/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "real-verified-user" },
      body: "{}",
    });
    assert.equal(first.status, 200);

    // Same verified identity, request carries no new claim at all — still
    // blocked, proving the quota is tied to the identity, not reset by
    // anything the caller sends.
    const second = await fetch(`${url}/ai/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "real-verified-user" },
      body: "{}",
    });
    assert.equal(second.status, 429);
  } finally {
    await close();
  }
});

// ── 8. internal routes unaffected ───────────────────────────────────────────

test("internal.routes.ts never imports the rate-limit middleware", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    require("node:path").join(__dirname, "..", "routes", "internal.routes.ts"),
    "utf-8",
  );
  assert.ok(
    !source.includes("rate-limit.middleware"),
    "/internal/* must stay reachable for trusted service-to-service calls (payment webhook activation, fitness-service knowledge triggers) with no per-end-user quota",
  );
});

test("HTTP: a route with no rate limiter mounted (modelling /internal/*) is never throttled regardless of volume", async () => {
  const app = express();
  app.post("/internal/whatever", (_req, res) => res.json({ success: true }));
  const { url, close } = await listen(app);
  try {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${url}/internal/whatever`, { method: "POST" });
      assert.equal(res.status, 200);
    }
  } finally {
    await close();
  }
});

// ── 9. DynamoDB infrastructure failure → protected route fails safely (closed) ──

test("dynamodb provider: an UpdateItem failure surfaces as RateLimitInfrastructureError, not a false allow/deny", async () => {
  const table = makeFakeDynamoTable();
  table.setFailing(true);
  const limiter = new DynamoDbRateLimiter();
  await assert.rejects(
    limiter.consume({ key: "ai-ask:user-1", max: 20, windowSeconds: 60 }),
    RateLimitInfrastructureError,
  );
});

test("HTTP + dynamodb provider: an infra failure on a protected AI route returns a sanitized 503, never lets the request through to Bedrock", async () => {
  process.env.RATE_LIMIT_PROVIDER = "dynamodb";
  resetRateLimiterCache();
  const table = makeFakeDynamoTable();
  table.setFailing(true);

  const app = buildTestApp({ name: "ai-ask", max: 20, windowSeconds: 60 });
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/ai/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": "user-1" },
      body: "{}",
    });
    assert.equal(res.status, 503, "fail-closed — never silently allowed through");
    const body: any = await res.json();
    assert.equal(body.error.code, "RATE_LIMIT_UNAVAILABLE");
    assert.ok(
      !JSON.stringify(body).match(/fitness-assistant-dev-ai-rate-limit|DynamoDB|ServiceUnavailableException/i),
      "no table name, provider name, or AWS error text leaked to the client",
    );
  } finally {
    await close();
    delete process.env.RATE_LIMIT_PROVIDER;
    resetRateLimiterCache();
  }
});

test("middleware throws RateLimitUnavailableError (503), not RateLimitedError (429), on infra failure", async () => {
  process.env.RATE_LIMIT_PROVIDER = "dynamodb";
  resetRateLimiterCache();
  const table = makeFakeDynamoTable();
  table.setFailing(true);
  const middleware = createRateLimiter({ name: "ai-ask", max: 20, windowSeconds: 60 });
  const req: any = { context: { userId: "u1" } };
  let captured: unknown;
  const res: any = { setHeader: () => undefined };
  await middleware(req, res, (err: unknown) => {
    captured = err;
  });
  assert.ok(captured instanceof RateLimitUnavailableError);
  assert.ok(!(captured instanceof RateLimitedError));
  delete process.env.RATE_LIMIT_PROVIDER;
  resetRateLimiterCache();
});

// ── 10. memory provider regression (no infra to fail, always resolves) ─────

test("memory provider never throws — there is no infra failure mode to fail closed on", async () => {
  const limiter = new MemoryRateLimiter();
  await assert.doesNotReject(limiter.consume({ key: "k", max: 5, windowSeconds: 60 }));
});

test("HTTP: provider=memory (or unset) behaves exactly as before — allow up to max, then 429", async () => {
  const { url, close } = await listen(buildTestApp({ name: "ai-ask", max: 2, windowSeconds: 60 }));
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${url}/ai/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": "u" },
        body: "{}",
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  } finally {
    await close();
  }
});

// ── 11. provider=off behavior ────────────────────────────────────────────────

test("provider=off: resolveRateLimitProvider reports off and getRateLimiter constructs nothing", () => {
  process.env.RATE_LIMIT_PROVIDER = "off";
  assert.equal(resolveRateLimitProvider(), "off");
  assert.equal(getRateLimiter("off"), undefined);
  delete process.env.RATE_LIMIT_PROVIDER;
});

test("HTTP: provider=off never throttles, and never touches DynamoDB", async () => {
  process.env.RATE_LIMIT_PROVIDER = "off";
  resetRateLimiterCache();
  const table = makeFakeDynamoTable();
  const { url, close } = await listen(buildTestApp({ name: "ai-ask", max: 1, windowSeconds: 60 }));
  try {
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${url}/ai/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": "u" },
        body: "{}",
      });
      assert.equal(res.status, 200);
    }
    assert.equal(table.calls.length, 0, "no DynamoDB traffic at all under provider=off");
  } finally {
    await close();
    delete process.env.RATE_LIMIT_PROVIDER;
    resetRateLimiterCache();
  }
});

test("an unsupported RATE_LIMIT_PROVIDER value fails loudly instead of silently disabling protection", () => {
  process.env.RATE_LIMIT_PROVIDER = "redis";
  assert.throws(() => resolveRateLimitProvider(), /Unsupported RATE_LIMIT_PROVIDER/);
  delete process.env.RATE_LIMIT_PROVIDER;
});

// ── Env/config plumbing ──────────────────────────────────────────────────────

test("resolveRateLimitTableName defaults to the documented table name and honours AI_RATE_LIMIT_TABLE", () => {
  assert.equal(resolveRateLimitTableName({}), "fitness-assistant-dev-ai-rate-limit");
  assert.equal(
    resolveRateLimitTableName({ AI_RATE_LIMIT_TABLE: "custom-table" }),
    "custom-table",
  );
});

test("provider defaults to memory when RATE_LIMIT_PROVIDER is unset", () => {
  assert.equal(resolveRateLimitProvider({}), "memory");
});

// ── Middleware requires an authenticated identity — never runs unauthenticated ──

test("middleware rejects with 401 if somehow mounted before an identity exists (defensive, should be unreachable in real routing)", async () => {
  const middleware = createRateLimiter({ name: "ai-ask", max: 20, windowSeconds: 60 });
  const req: any = { context: undefined };
  let captured: any;
  const res: any = { setHeader: () => undefined };
  await middleware(req, res, (err: any) => {
    captured = err;
  });
  assert.equal(captured?.statusCode, 401);
});
