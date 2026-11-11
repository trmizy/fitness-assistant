/**
 * Phase 3 R2 — N5: a mutation-capable test suite must refuse to run against
 * anything but the isolated `*_test` Postgres (port 55433) under
 * NODE_ENV=test. Same convention as ai-service's own
 * src/test-utils/safe-test-db.ts (extracted from
 * plan-generation-equipment.integration.test.ts's pre-existing
 * `assertSafeTestDatabase`) — duplicated per-service rather than added to
 * `@gym-coach/shared` because it is test-only code and that package ships in
 * the production runtime bundle.
 */
export class UnsafeTestDatabaseTargetError extends Error {
  code = "UNSAFE_TEST_DATABASE_TARGET" as const;
  constructor(reason: string) {
    super(`UNSAFE_TEST_DATABASE_TARGET: ${reason}`);
    this.name = "UnsafeTestDatabaseTargetError";
  }
}

const TEST_DB_PORT = "55433";

/** Throws UnsafeTestDatabaseTargetError (never includes the credential
 * portion of the URL in its message) if `urlValue` is not the isolated test
 * Postgres on TEST_DB_PORT with a `*_test` database name, or if NODE_ENV is
 * not "test". Call this before any mutation in a DB-backed integration test. */
export function assertSafeTestDatabase(urlValue: string, expectedDatabase?: string): void {
  if (process.env.NODE_ENV !== "test") {
    throw new UnsafeTestDatabaseTargetError(`NODE_ENV must be "test" for a mutation-capable suite (was ${JSON.stringify(process.env.NODE_ENV)})`);
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new UnsafeTestDatabaseTargetError("DATABASE_URL is not a valid URL");
  }
  const dbName = url.pathname.slice(1).split("?")[0];
  if (url.hostname !== "localhost") {
    throw new UnsafeTestDatabaseTargetError(`DB host must be the isolated localhost test Postgres (was host=${url.hostname})`);
  }
  if (url.port !== TEST_DB_PORT) {
    throw new UnsafeTestDatabaseTargetError(`DB port must be the isolated postgres-test port ${TEST_DB_PORT} (was port=${url.port || "(default)"})`);
  }
  if (!/_test$/.test(dbName)) {
    throw new UnsafeTestDatabaseTargetError(`database name must end in "_test" (was db=${dbName})`);
  }
  if (expectedDatabase && dbName !== expectedDatabase) {
    throw new UnsafeTestDatabaseTargetError(`expected database "${expectedDatabase}", got "${dbName}"`);
  }
}
