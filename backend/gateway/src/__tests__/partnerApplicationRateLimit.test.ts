import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createPartnerApplicationLimiter, initPartnerApplicationRateLimit } from "../middleware/partnerApplicationRateLimit.middleware";

/**
 * Giới hạn tần suất THEO IP của luồng đối tác tự đăng ký (GYM_PARTNER_SECURITY_MODEL.md §5).
 * Chạy bằng store bộ nhớ (không có REDIS_URL) — đủ để kiểm hành vi trần/mã lỗi và, quan trọng hơn,
 * để kiểm điều kiện KHỞI ĐỘNG ở production: thiếu store chia sẻ thì phải từ chối chạy.
 */

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("limiter cho qua tới trần rồi trả 429 kèm mã IP_RATE_LIMITED (JSON, không phải text)", async () => {
  const app = express();
  app.post("/start", createPartnerApplicationLimiter({ max: 2, prefix: "test:start:" }), (_req, res) => {
    res.json({ ok: true });
  });
  const { url, close } = await listen(app);
  try {
    const statuses: number[] = [];
    let last: any = null;
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${url}/start`, { method: "POST" });
      statuses.push(res.status);
      last = await res.json();
    }
    assert.deepEqual(statuses, [200, 200, 429]);
    assert.equal(last.code, "IP_RATE_LIMITED");
    assert.match(last.error, /quá nhiều lần/);
  } finally {
    await close();
  }
});

test("hai limiter (start / còn lại) đếm RIÊNG — chạm trần start không khoá verify", async () => {
  const app = express();
  const start = createPartnerApplicationLimiter({ max: 1, prefix: "test:a:" });
  const any = createPartnerApplicationLimiter({ max: 5, prefix: "test:b:" });
  app.post("/start", start, (_req, res) => res.json({ ok: true }));
  app.post("/verify", any, (_req, res) => res.json({ ok: true }));
  const { url, close } = await listen(app);
  try {
    assert.equal((await fetch(`${url}/start`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${url}/start`, { method: "POST" })).status, 429);
    assert.equal((await fetch(`${url}/verify`, { method: "POST" })).status, 200);
  } finally {
    await close();
  }
});

test("RATE_LIMIT_REQUIRE_SHARED=true mà không có REDIS_URL → từ chối khởi động", async () => {
  const saved = { shared: process.env.RATE_LIMIT_REQUIRE_SHARED, redis: process.env.REDIS_URL };
  process.env.RATE_LIMIT_REQUIRE_SHARED = "true";
  delete process.env.REDIS_URL;
  try {
    await assert.rejects(initPartnerApplicationRateLimit(), /REDIS_URL/);
  } finally {
    if (saved.shared === undefined) delete process.env.RATE_LIMIT_REQUIRE_SHARED;
    else process.env.RATE_LIMIT_REQUIRE_SHARED = saved.shared;
    if (saved.redis !== undefined) process.env.REDIS_URL = saved.redis;
  }
});

test("không yêu cầu store chia sẻ + không có Redis → chạy được (chỉ cảnh báo, dành cho local/MVP)", async () => {
  const saved = { shared: process.env.RATE_LIMIT_REQUIRE_SHARED, redis: process.env.REDIS_URL };
  delete process.env.RATE_LIMIT_REQUIRE_SHARED;
  delete process.env.REDIS_URL;
  try {
    await assert.doesNotReject(initPartnerApplicationRateLimit());
  } finally {
    if (saved.shared !== undefined) process.env.RATE_LIMIT_REQUIRE_SHARED = saved.shared;
    if (saved.redis !== undefined) process.env.REDIS_URL = saved.redis;
  }
});
