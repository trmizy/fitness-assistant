import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import app from "../app";
import { authRepository, prisma } from "../repositories/auth.repository";
import { authService } from "../services/auth.service";
import {
  registerSchema,
  registerVerifySchema,
  registerResendSchema,
  passwordResetRequestSchema,
  loginSchema,
} from "../models/auth.models";

/**
 * C4-01 / C1-01 — email letter case. Schemas normalise (trim + lowercase); lookups are
 * case-insensitive; a legacy pair of accounts that differ only by case is never guessed at.
 * The DB-backed block runs only against an isolated *_test database.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const safeDb = (() => {
  try {
    return /_test$/.test(new URL(process.env.DATABASE_URL ?? "").pathname);
  } catch {
    return false;
  }
})();
const dbOptions = { skip: safeDb ? false : "Requires an isolated *_test database" };

test("schemas: register / verify / resend / reset-request trim + lowercase the email", () => {
  const pw = "Aa123456!";
  assert.equal(registerSchema.parse({ email: "  QA.Mixed@Example.COM ", password: pw }).email, "qa.mixed@example.com");
  assert.equal(registerVerifySchema.parse({ email: "Foo@X.com", otp: "123456" }).email, "foo@x.com");
  assert.equal(registerResendSchema.parse({ email: "Foo@X.com" }).email, "foo@x.com");
  assert.equal(passwordResetRequestSchema.parse({ email: " FOO@x.com" }).email, "foo@x.com");
});

test("schema: login only trims, so the typed case can still pick the exact legacy account", () => {
  assert.equal(loginSchema.parse({ email: "  Foo@X.com ", password: "x" }).email, "Foo@X.com");
});

test("POST /auth/register stores the lowercased email and looks the account up with it", async () => {
  const server: http.Server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const lookups: string[] = [];
  const upserts: any[] = [];
  const restores = [
    patch(authRepository, "findUserByEmail", async (e: string) => (lookups.push(e), null)),
    patch(authRepository, "findEmailVerificationByEmail", async () => null),
    patch(authRepository, "upsertEmailVerification", async (d: any) => (upserts.push(d), d)),
  ];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "QA.C24.REG1@Example.com", password: "Aa123456!" }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(lookups, ["qa.c24.reg1@example.com"]);
    assert.equal(upserts[0].email, "qa.c24.reg1@example.com");
  } finally {
    restores.forEach((r) => r());
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("repository.findUserByEmail: exact match wins; otherwise a unique case-insensitive match; several -> 409 EMAIL_CASE_AMBIGUOUS", async () => {
  const restores = [
    patch(prisma.user, "findUnique", async ({ where }: any) => (where.email === "Exact@x.com" ? { id: "exact" } : null)),
    patch(prisma.user, "findMany", async ({ where }: any) => {
      const wanted = where.email.equals.toLowerCase();
      if (wanted === "single@x.com") return [{ id: "s" }];
      if (wanted === "dup@x.com") return [{ id: "a" }, { id: "b" }];
      return [];
    }),
  ];
  try {
    assert.deepEqual(await authRepository.findUserByEmail("Exact@x.com"), { id: "exact" });
    assert.deepEqual(await authRepository.findUserByEmail("SINGLE@x.com"), { id: "s" });
    assert.equal(await authRepository.findUserByEmail("nobody@x.com"), null);
    await assert.rejects(authRepository.findUserByEmail("DUP@x.com"), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "EMAIL_CASE_AMBIGUOUS");
      return true;
    });
  } finally {
    restores.forEach((r) => r());
  }
});

test("requestPasswordReset answers uniformly (no leak) when the email is case-ambiguous", async () => {
  const restore = patch(authRepository, "findUserByEmail", async () => {
    throw { status: 409, code: "EMAIL_CASE_AMBIGUOUS", message: "x" };
  });
  try {
    const result = await authService.requestPasswordReset("dup@x.com", "https://app.example.com");
    assert.match(result.message, /Nếu email này có tài khoản/);
    assert.equal(result.devResetLink, undefined);
  } finally {
    restore();
  }
});

test("DB: case-variant register is refused 409; login works in any case; legacy duplicates are refused, never merged", dbOptions, async () => {
  const tag = randomUUID().slice(0, 8);
  const pwHash = await bcrypt.hash("Aa123456!", 4);
  const single = `Single.${tag}@Case.test`;
  const dupLower = `dup.${tag}@case.test`;
  const dupUpper = `Dup.${tag}@case.test`;
  const made = await Promise.all(
    [single, dupLower, dupUpper].map((email) => prisma.user.create({ data: { email, password: pwHash, role: "CUSTOMER" } })),
  );
  try {
    // register in another case of an existing account -> 409, no second account
    await assert.rejects(
      authService.register({ email: single.toLowerCase(), password: "Aa123456!" }),
      (e: any) => e.status === 409,
    );
    // login in any case reaches the single account
    for (const typed of [single, single.toLowerCase(), single.toUpperCase()]) {
      const r = await authService.login(typed, "Aa123456!");
      assert.equal(r.user.id, made[0].id);
    }
    // legacy pair: exact spelling picks that account
    assert.equal((await authService.login(dupLower, "Aa123456!")).user.id, made[1].id);
    assert.equal((await authService.login(dupUpper, "Aa123456!")).user.id, made[2].id);
    // legacy pair: a third spelling is ambiguous -> refused, with a clear message
    await assert.rejects(authService.login(`DUP.${tag}@CASE.test`, "Aa123456!"), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "EMAIL_CASE_AMBIGUOUS");
      return true;
    });
    // register for the ambiguous email is refused too
    await assert.rejects(authService.register({ email: `DUP.${tag}@Case.test`.toLowerCase(), password: "Aa123456!" }), (e: any) => e.status === 409);
    // nothing merged or deleted
    assert.equal(await prisma.user.count({ where: { email: { in: [single, dupLower, dupUpper] } } }), 3);
  } finally {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: made.map((u) => u.id) } } });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
