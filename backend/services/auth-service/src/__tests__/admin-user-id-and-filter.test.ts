import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app";
import { authRepository } from "../repositories/auth.repository";
import { adminAccountGuard } from "../services/admin-account-guard";

/**
 * C1-05 — admin disable/enable/role/name on a malformed id -> 400, on an unknown id -> 404 (was 500).
 * C1-09 — GET /auth/users honours ?role=, and an unrecognised value is a 400 instead of being ignored.
 */

const SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const adminToken = jwt.sign({ userId: ADMIN_ID, role: "ADMIN", email: "a@example.com" }, SECRET, { expiresIn: "15m" });

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

let server: http.Server;
let baseUrl = "";
const restores: Array<() => void> = [];
const listCalls: unknown[] = [];
const prismaMissing = Object.assign(new Error("Record to update not found."), { code: "P2025" });

test.before(async () => {
  restores.push(
    patch(authRepository, "findUserById", async (id: string) =>
      id === ADMIN_ID ? { id, email: "a@example.com", role: "ADMIN", isActive: true } : null,
    ),
    patch(authRepository, "updateUser", async () => {
      throw prismaMissing;
    }),
    patch(authRepository, "updateUserRoleById", async () => {
      throw prismaMissing;
    }),
    patch(authRepository, "updateUserById", async () => {
      throw prismaMissing;
    }),
    patch(authRepository, "createAuditLog", async () => ({})),
    patch(adminAccountGuard, "countActiveAdmins", async () => 2),
    patch(authRepository, "listUsers", async (role?: string) => {
      listCalls.push(role);
      return [];
    }),
  );
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.after(async () => {
  restores.forEach((r) => r());
  await new Promise<void>((r) => server.close(() => r()));
});

const call = (path: string, method: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const cases: Array<[string, string, unknown]> = [
  ["disable", "disable", {}],
  ["enable", "enable", {}],
  ["role", "role", { role: "PT" }],
  ["name", "name", { firstName: "X" }],
];

for (const [label, suffix, body] of cases) {
  test(`admin ${label} with a malformed userId -> 400 INVALID_USER_ID`, async () => {
    const res = await call(`/auth/users/not-a-uuid/${suffix}`, "PATCH", body);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).code, "INVALID_USER_ID");
  });
  test(`admin ${label} with an unknown (well-formed) userId -> 404, not 500`, async () => {
    const res = await call(`/auth/users/${UNKNOWN_ID}/${suffix}`, "PATCH", body);
    assert.equal(res.status, 404);
  });
}

test("GET /auth/users?role=pt (any case) filters to PT", async () => {
  listCalls.length = 0;
  const res = await call("/auth/users?role=pt", "GET");
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls, ["PT"]);
});

test("GET /auth/users without a role keeps the original behaviour (no filter)", async () => {
  listCalls.length = 0;
  assert.equal((await call("/auth/users", "GET")).status, 200);
  assert.deepEqual(listCalls, [undefined]);
});

test("GET /auth/users with an unknown / repeated / ADMIN role -> 400, repository never queried", async () => {
  listCalls.length = 0;
  for (const q of ["role=BOGUS", "role=PT&role=CUSTOMER", "role=ADMIN"]) {
    const res = await call(`/auth/users?${q}`, "GET");
    assert.equal(res.status, 400, q);
    assert.equal(((await res.json()) as any).code, "INVALID_ROLE_FILTER");
  }
  assert.equal(listCalls.length, 0);
});
