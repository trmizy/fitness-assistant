import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app";
import { authRepository } from "../repositories/auth.repository";

/**
 * Money-flow plan 5.4 — minimum auth-service test coverage: "blocking a non-admin from
 * changing roles". The authorization check for this lives in authController.updateUserRole,
 * NOT in authService.updateUserRole (the service function performs the update unconditionally
 * — it trusts its caller entirely). A service-level test would therefore never actually
 * exercise the guard; these tests go through the real HTTP route via app.ts instead.
 *
 * app.ts never calls dotenv.config() itself (only server.ts does) — but the `import app`
 * above transitively imports authRepository, which instantiates PrismaClient, which
 * auto-loads this service's .env as a side effect of Prisma's own behavior. By the time
 * ACCESS_TOKEN_SECRET is read here,
 * process.env.JWT_SECRET already holds whatever auth.service.ts's own module-level constant
 * resolved to, so these tests sign against the real running secret rather than guessing the
 * fallback default — a real, valid-shaped token is genuinely checked end to end.
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

let server: http.Server;
let baseUrl = "";

test.before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a non-admin (CUSTOMER) token cannot change another user's role — 403, and the update never runs", async () => {
  const updateCalls: unknown[] = [];
  const restoreFindById = patch(authRepository, "findUserById", async () => ({
    id: "customer-1",
    email: "customer@example.com",
    role: "CUSTOMER",
    isActive: true,
  }));
  const restoreUpdate = patch(authRepository, "updateUserRoleById", async (id: string, role: string) => {
    updateCalls.push([id, role]);
    return { id, email: "victim@example.com", firstName: null, lastName: null, role };
  });

  try {
    const token = signAccessToken("customer-1", "CUSTOMER", "customer@example.com");
    const res = await fetch(`${baseUrl}/auth/users/victim-1/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "PT" }),
    });
    assert.equal(res.status, 403);
    assert.equal(updateCalls.length, 0, "a forbidden request must never reach the repository update");
  } finally {
    restoreFindById();
    restoreUpdate();
  }
});

test("a PT token also cannot change roles — the guard is ADMIN-only, not just non-CUSTOMER", async () => {
  const restoreFindById = patch(authRepository, "findUserById", async () => ({
    id: "pt-1",
    email: "pt@example.com",
    role: "PT",
    isActive: true,
  }));

  try {
    const token = signAccessToken("pt-1", "PT", "pt@example.com");
    const res = await fetch(`${baseUrl}/auth/users/victim-1/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "GYM_OWNER" }),
    });
    assert.equal(res.status, 403);
  } finally {
    restoreFindById();
  }
});

test("with no Authorization header at all, the role-change route is rejected 401", async () => {
  const res = await fetch(`${baseUrl}/auth/users/victim-1/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "PT" }),
  });
  assert.equal(res.status, 401);
});

test("a real ADMIN token CAN change another user's role, and the correct id/role reach the repository", async () => {
  const updateCalls: unknown[] = [];
  const restoreFindById = patch(authRepository, "findUserById", async () => ({
    id: "admin-1",
    email: "admin@example.com",
    role: "ADMIN",
    isActive: true,
  }));
  const restoreUpdate = patch(authRepository, "updateUserRoleById", async (id: string, role: string) => {
    updateCalls.push([id, role]);
    return { id, email: "victim@example.com", firstName: "V", lastName: "Ictim", role };
  });

  try {
    const token = signAccessToken("admin-1", "ADMIN", "admin@example.com");
    const res = await fetch(`${baseUrl}/auth/users/victim-1/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "PT" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { role: string } };
    assert.equal(body.user.role, "PT");
    assert.deepEqual(updateCalls, [["victim-1", "PT"]]);
  } finally {
    restoreFindById();
    restoreUpdate();
  }
});

test("even an ADMIN cannot grant the ADMIN role itself — privilege escalation is blocked regardless of caller", async () => {
  const updateCalls: unknown[] = [];
  const restoreFindById = patch(authRepository, "findUserById", async () => ({
    id: "admin-1",
    email: "admin@example.com",
    role: "ADMIN",
    isActive: true,
  }));
  const restoreUpdate = patch(authRepository, "updateUserRoleById", async (id: string, role: string) => {
    updateCalls.push([id, role]);
    return {};
  });

  try {
    const token = signAccessToken("admin-1", "ADMIN", "admin@example.com");
    const res = await fetch(`${baseUrl}/auth/users/victim-1/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "ADMIN" }),
    });
    assert.equal(res.status, 403);
    assert.equal(updateCalls.length, 0);
  } finally {
    restoreFindById();
    restoreUpdate();
  }
});
