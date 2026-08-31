import { Prisma } from "../generated/prisma";
import { logger } from "@gym-coach/shared";

/**
 * Structured, credential-safe server-side logging for a caught database error. The public HTTP
 * response stays generic ("Failed to fetch provinces" etc.) — this is purely for CloudWatch, so
 * the actual Prisma error (P1000 auth failure, P1001 can't reach database, P2021 table doesn't
 * exist, ...) is visible to whoever reads the logs instead of being silently swallowed.
 *
 * Never logs: DATABASE_URL, username, password, JWT/service secrets, AWS credentials, or the
 * full Secrets Manager payload. Prisma error messages can occasionally embed a connection
 * string; `redact()` strips any `postgres(ql)://...@` substring defensively regardless of which
 * error path produced the message, rather than trusting Prisma's own formatting not to include
 * one.
 */

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 2000;

function redact(value: string): string {
  return value.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@");
}

function safeMessage(message: string | undefined | null): string {
  return redact(message || "").slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Logs a caught database error with as much diagnostic detail as is safe to put in CloudWatch,
 * classified by Prisma error type. `context` should identify the call site (e.g.
 * "locationController.getProvinces") so multiple call sites sharing this helper stay
 * distinguishable in the logs.
 */
export function logDbError(err: unknown, context: string): void {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    // Connection-level failure — never got a query off. errorCode is the P1xxx family: P1000
    // (auth failed), P1001 (can't reach database server), P1002 (timed out), P1003 (database
    // does not exist), P1008 (operations timed out), P1010 (access denied), ...
    logger.error(
      {
        context,
        errorType: "PrismaClientInitializationError",
        errorCode: err.errorCode,
        message: safeMessage(err.message),
      },
      `Database connection failed in ${context}`,
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Connected fine, the query itself failed — the P2xxx family: P2021 (table does not exist),
    // P2022 (column does not exist), P2002 (unique constraint), etc. `meta` from Prisma is
    // structural (table/column/constraint names), not credentials — safe to log as-is.
    logger.error(
      {
        context,
        errorType: "PrismaClientKnownRequestError",
        code: err.code,
        meta: err.meta,
        message: safeMessage(err.message),
      },
      `Database query failed in ${context}`,
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    logger.error(
      { context, errorType: "PrismaClientRustPanicError", message: safeMessage(err.message) },
      `Prisma engine panicked in ${context}`,
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    logger.error(
      { context, errorType: "PrismaClientUnknownRequestError", message: safeMessage(err.message) },
      `Unknown Prisma error in ${context}`,
    );
    return;
  }

  const e = err as { name?: string; message?: string; stack?: string } | undefined;
  logger.error(
    {
      context,
      errorType: e?.name || "UnknownError",
      message: safeMessage(e?.message ?? String(err)),
      stack: e?.stack ? safeMessage(e.stack).slice(0, MAX_STACK_LENGTH) : undefined,
    },
    `Unexpected error in ${context}`,
  );
}
