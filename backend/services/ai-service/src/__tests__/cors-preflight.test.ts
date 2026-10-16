/**
 * AI CORS/preflight audit (AWS DEV, 2026-09-30): reproduced live that a real browser's OPTIONS
 * preflight to /plans/current and /ai/ask got a 401 (requireAuth ran before anything could
 * short-circuit OPTIONS), which makes the browser abort the real request even though API
 * Gateway decorates the response with correct access-control-* headers regardless of status.
 * Fix: app.ts now answers every OPTIONS request with 204 before any router/auth middleware
 * runs. These tests hit the real Express app in-process (no AWS, no auth token) and prove
 * OPTIONS never reaches requireAuth, while a non-OPTIONS request to the same protected route
 * still correctly requires auth (proving the fix is not an accidental auth bypass).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import app from "../app";

describe("OPTIONS preflight short-circuit", () => {
  it("OPTIONS /plans/current returns 204 with no Authorization header", async () => {
    const res = await supertest(app).options("/plans/current");
    assert.equal(res.status, 204);
  });

  it("OPTIONS /ai/ask returns 204 with no Authorization header", async () => {
    const res = await supertest(app).options("/ai/ask");
    assert.equal(res.status, 204);
  });

  it("OPTIONS /admin/ai/overview returns 204 even for an admin-only route", async () => {
    const res = await supertest(app).options("/admin/ai/overview");
    assert.equal(res.status, 204);
  });

  it("the same protected route still requires auth on a real GET (fix is not an auth bypass)", async () => {
    const res = await supertest(app).get("/plans/current");
    assert.equal(res.status, 401);
  });
});
