import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app";
import { authRepository } from "../repositories/auth.repository";
import { adminAccountGuard } from "../services/admin-account-guard";

/**
 * B42 — an admin must not be able to lock themselves out through the API (the web only hid the
 * button), nor re-role their own account, nor disable the last active admin.
 */

const SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_in_production";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const sign = (userId: string, role: string) =>
  jwt.sign({ userId, role, email: `${userId}@example.com` }, SECRET, { expiresIn: "15m" });

let server: http.Server;
let baseUrl = "";

test.before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Row = { id: string; email: string; role: string; isActive: boolean };
const users: Record<string, Row> = {
  "admin-1": { id: "admin-1", email: "a1@example.com", role: "ADMIN", isActive: true },
  "admin-2": { id: "admin-2", email: "a2@example.com", role: "ADMIN", isActive: true },
  "pt-1": { id: "pt-1", email: "pt@example.com", role: "PT", isActive: true },
};

function setup(activeAdmins: number) {
  const writes: unknown[] = [];
  const restores = [
    patch(authRepository, "findUserById", async (id: string) => users[id] ?? null),
    patch(authRepository, "updateUser", async (id: string, data: any) => {
      writes.push(["updateUser", id, data]);
      return { ...users[id], ...data };
    }),
    patch(authRepository, "updateUserRoleById", async (id: string, role: string) => {
      writes.push(["role", id, role]);
      return { ...users[id], role };
    }),
    patch(authRepository, "createAuditLog", async () => ({})),
    patch(adminAccountGuard, "countActiveAdmins", async () => activeAdmins),
  ];
  return { writes, restore: () => restores.forEach((r) => r()) };
}

async function call(path: string, userId: string, body: object = {}) {
  const res = await fetch(`${baseUrl}/auth/users/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sign(userId, "ADMIN")}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("admin disabling their own account -> 403 CANNOT_DISABLE_SELF, no write", async () => {
  const { writes, restore } = setup(2);
  try {
    const r = await call("admin-1/disable", "admin-1");
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "CANNOT_DISABLE_SELF");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("admin sending isActive:false to the enable route for themselves is also blocked", async () => {
  const { writes, restore } = setup(2);
  try {
    const r = await call("admin-1/enable", "admin-1", { isActive: false });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "CANNOT_DISABLE_SELF");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("admin changing their own role -> 403 CANNOT_CHANGE_OWN_ROLE, no write", async () => {
  const { writes, restore } = setup(2);
  try {
    const r = await call("admin-1/role", "admin-1", { role: "CUSTOMER" });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "CANNOT_CHANGE_OWN_ROLE");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("disabling the last active admin -> 409 LAST_ADMIN, no write", async () => {
  const { writes, restore } = setup(1);
  try {
    const r = await call("admin-2/disable", "admin-1");
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "LAST_ADMIN");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});

test("disabling another admin while two are active still works", async () => {
  const { writes, restore } = setup(2);
  try {
    const r = await call("admin-2/disable", "admin-1");
    assert.equal(r.status, 200);
    assert.equal(writes.length, 1);
  } finally {
    restore();
  }
});

test("disabling / re-roling a non-admin by an admin is unchanged (200)", async () => {
  const { writes, restore } = setup(1);
  try {
    const d = await call("pt-1/disable", "admin-1");
    assert.equal(d.status, 200);
    const e = await call("pt-1/role", "admin-1", { role: "CUSTOMER" });
    assert.equal(e.status, 200);
    assert.equal(writes.length, 2);
  } finally {
    restore();
  }
});
