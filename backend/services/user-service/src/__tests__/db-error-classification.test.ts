import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { logDbError } from "../utils/db-error.util";

/**
 * TASK 6 — proves logDbError() actually differentiates the Prisma error families CloudWatch
 * needs to distinguish (P1000 auth, P1001 can't reach database, P2021 table missing, generic),
 * and that nothing credential-shaped ever reaches the log call. This does NOT — and cannot —
 * conclude which of these AWS is actually hitting; it only guarantees that whichever one it is,
 * the next real invocation's CloudWatch output will say so plainly.
 */

function captureLoggerError(fn: () => void): Record<string, unknown> {
  const original = logger.error;
  let captured: Record<string, unknown> | undefined;
  (logger as any).error = (obj: Record<string, unknown>, _msg?: string) => {
    captured = obj;
  };
  try {
    fn();
  } finally {
    (logger as any).error = original;
  }
  if (!captured) throw new Error("logger.error was not called");
  return captured;
}

test("P1001 (cannot reach database server) is classified as PrismaClientInitializationError with errorCode P1001", () => {
  const err = new Prisma.PrismaClientInitializationError(
    "Can't reach database server at `aurora-host`:`5432`",
    "5.22.0",
    "P1001",
  );
  const logged = captureLoggerError(() => logDbError(err, "test.p1001"));
  assert.strictEqual(logged.errorType, "PrismaClientInitializationError");
  assert.strictEqual(logged.errorCode, "P1001");
  assert.strictEqual(logged.context, "test.p1001");
});

test("P1000 (authentication failed) is classified as PrismaClientInitializationError with errorCode P1000", () => {
  const err = new Prisma.PrismaClientInitializationError(
    "Authentication failed against database server",
    "5.22.0",
    "P1000",
  );
  const logged = captureLoggerError(() => logDbError(err, "test.p1000"));
  assert.strictEqual(logged.errorType, "PrismaClientInitializationError");
  assert.strictEqual(logged.errorCode, "P1000");
});

test("P2021 (table does not exist) is classified as PrismaClientKnownRequestError with code P2021 and table meta", () => {
  const err = new Prisma.PrismaClientKnownRequestError("The table `public.vietnam_provinces` does not exist", {
    code: "P2021",
    clientVersion: "5.22.0",
    meta: { table: "public.vietnam_provinces" },
  });
  const logged = captureLoggerError(() => logDbError(err, "test.p2021"));
  assert.strictEqual(logged.errorType, "PrismaClientKnownRequestError");
  assert.strictEqual(logged.code, "P2021");
  assert.deepStrictEqual(logged.meta, { table: "public.vietnam_provinces" });
});

test("a generic (non-Prisma) error still gets a name/message/stack, distinguishable as not a known Prisma error", () => {
  const err = new TypeError("something else entirely");
  const logged = captureLoggerError(() => logDbError(err, "test.generic"));
  assert.strictEqual(logged.errorType, "TypeError");
  assert.strictEqual(logged.message, "something else entirely");
  assert.ok(typeof logged.stack === "string" && logged.stack.length > 0);
});

test("never logs a credential-bearing connection string, even if the raw Prisma message contains one", () => {
  const err = new Prisma.PrismaClientInitializationError(
    "Can't reach database server. Connection string: postgresql://myuser:sup3rSecr3t@aurora-host:5432/fitness_assistant_user",
    "5.22.0",
    "P1001",
  );
  const logged = captureLoggerError(() => logDbError(err, "test.redaction"));
  const serialized = JSON.stringify(logged);
  assert.ok(!serialized.includes("sup3rSecr3t"), "password must never appear in the logged object");
  assert.ok(!serialized.includes("myuser:sup3rSecr3t"), "credentials segment must be redacted");
  assert.ok(serialized.includes("[REDACTED]"), "redaction marker should be present in place of credentials");
});

test("location.controller.ts getProvinces logs via logDbError and still returns the generic public 500", async () => {
  delete require.cache[require.resolve("../repositories/location.repository")];
  delete require.cache[require.resolve("../controllers/location.controller")];
  const repoModule = require("../repositories/location.repository");
  const originalFind = repoModule.locationRepository.findAllProvinces;
  const dbError = new Prisma.PrismaClientInitializationError("Can't reach database server", "5.22.0", "P1001");
  repoModule.locationRepository.findAllProvinces = async () => {
    throw dbError;
  };

  const { locationController } = require("../controllers/location.controller");

  let statusCode: number | undefined;
  let body: unknown;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };

  // getProvinces is async, so drive the logger.error spy manually here rather than through
  // captureLoggerError (which assumes a synchronous call).
  const original = logger.error;
  let capturedLog: Record<string, unknown> | undefined;
  (logger as any).error = (obj: Record<string, unknown>) => {
    capturedLog = obj;
  };
  try {
    await locationController.getProvinces({} as any, res);
  } finally {
    (logger as any).error = original;
    repoModule.locationRepository.findAllProvinces = originalFind;
  }

  assert.strictEqual(statusCode, 500);
  assert.deepStrictEqual(body, { error: "Failed to fetch provinces" }, "public response must stay generic — no Prisma internals leaked to the browser");
  assert.ok(capturedLog, "the real Prisma error must have been logged server-side");
  assert.strictEqual(capturedLog!.errorCode, "P1001");
  assert.strictEqual(capturedLog!.context, "locationController.getProvinces");
});
