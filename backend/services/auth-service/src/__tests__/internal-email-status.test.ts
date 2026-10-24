import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app";
import { prisma } from "../repositories/auth.repository";

/** B10 - POST /auth/internal/partner-auth/email-status. BACKEND INTEGRATION (real route, prisma read patched). */

const SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
let server: http.Server;
let baseUrl = "";
const asks: unknown[] = [];

test.before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  (prisma.user as any).findFirst = async (args: any) => {
    asks.push(args);
    const e = String(args.where.email.equals);
    return e === "owner@example.com" ? { role: "GYM_OWNER" } : e === "pt@example.com" ? { role: "PT" } : null;
  };
});
test.after(async () => {
  delete (prisma.user as any).findFirst;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/auth/internal/partner-auth/email-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("no / wrong service secret -> 401 and the database is never read", async () => {
  asks.length = 0;
  assert.equal((await call({ email: "pt@example.com" })).status, 401);
  assert.equal((await call({ email: "pt@example.com" }, { "x-service-secret": "wrong" })).status, 401);
  assert.equal(asks.length, 0);
});

test("unknown email -> exists:false, role:null", async () => {
  const r = await call({ email: "nobody@example.com" }, { "x-service-secret": SECRET });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { exists: false, role: null });
});

test("known email -> exists:true plus the role, and nothing else", async () => {
  const r = await call({ email: "pt@example.com" }, { "x-service-secret": SECRET });
  assert.deepEqual(await r.json(), { exists: true, role: "PT" });
});

test("the email is trimmed and lowercased before lookup", async () => {
  const r = await call({ email: "  Owner@Example.COM " }, { "x-service-secret": SECRET });
  assert.deepEqual(await r.json(), { exists: true, role: "GYM_OWNER" });
});

test("missing / malformed email -> 400", async () => {
  assert.equal((await call({}, { "x-service-secret": SECRET })).status, 400);
  assert.equal((await call({ email: "not-an-email" }, { "x-service-secret": SECRET })).status, 400);
});
