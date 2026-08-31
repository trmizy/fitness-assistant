import test from "node:test";
import assert from "node:assert/strict";

/**
 * AWS Lambda deployment prep (docs/features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md).
 * Covers only the pure/local logic in config/lambda-runtime.ts — never calls
 * real AWS Secrets Manager (forbidden for this task; also not needed to
 * verify these code paths).
 */

test("validateRequiredRuntimeConfig: throws when neither INTERNAL_SERVICE_SECRET nor INTERNAL_API_SECRET is set", async () => {
  const prevPrimary = process.env.INTERNAL_SERVICE_SECRET;
  const prevSecondary = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_SERVICE_SECRET;
  delete process.env.INTERNAL_API_SECRET;
  try {
    const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
    assert.throws(() => validateRequiredRuntimeConfig(), /INTERNAL_SERVICE_SECRET/);
  } finally {
    if (prevPrimary !== undefined) process.env.INTERNAL_SERVICE_SECRET = prevPrimary;
    if (prevSecondary !== undefined) process.env.INTERNAL_API_SECRET = prevSecondary;
  }
});

test("validateRequiredRuntimeConfig: passes when INTERNAL_SERVICE_SECRET is set", async () => {
  const prev = process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = "a-real-looking-secret-value-for-this-test";
  try {
    const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
    assert.doesNotThrow(() => validateRequiredRuntimeConfig());
  } finally {
    if (prev === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = prev;
  }
});

test("validateRequiredRuntimeConfig: passes when only INTERNAL_API_SECRET is set (either name accepted, matching serviceSecret.middleware.ts)", async () => {
  const prevPrimary = process.env.INTERNAL_SERVICE_SECRET;
  const prevSecondary = process.env.INTERNAL_API_SECRET;
  delete process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_API_SECRET = "a-real-looking-secret-value-for-this-test";
  try {
    const { validateRequiredRuntimeConfig } = await import("../config/lambda-runtime");
    assert.doesNotThrow(() => validateRequiredRuntimeConfig());
  } finally {
    if (prevPrimary !== undefined) process.env.INTERNAL_SERVICE_SECRET = prevPrimary;
    if (prevSecondary !== undefined) process.env.INTERNAL_API_SECRET = prevSecondary;
    else delete process.env.INTERNAL_API_SECRET;
  }
});

test("ensureDatabaseUrlConfigured: no-op when DATABASE_URL is already set (never overwrites an explicit value)", async () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevSecretId = process.env.DATABASE_SECRET_ID;
  process.env.DATABASE_URL = "postgresql://explicit:explicit@localhost:5433/explicit_db";
  delete process.env.DATABASE_SECRET_ID;
  try {
    const { ensureDatabaseUrlConfigured } = await import("../config/lambda-runtime");
    await ensureDatabaseUrlConfigured();
    assert.equal(process.env.DATABASE_URL, "postgresql://explicit:explicit@localhost:5433/explicit_db");
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevSecretId !== undefined) process.env.DATABASE_SECRET_ID = prevSecretId;
  }
});

test("ensureDatabaseUrlConfigured: throws a clear error when neither DATABASE_URL nor DATABASE_SECRET_ID is set (never silently falls through to an undefined connection string)", async () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevSecretId = process.env.DATABASE_SECRET_ID;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SECRET_ID;
  try {
    const { ensureDatabaseUrlConfigured } = await import("../config/lambda-runtime");
    await assert.rejects(() => ensureDatabaseUrlConfigured(), /DATABASE_SECRET_ID/);
  } finally {
    if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
    if (prevSecretId !== undefined) process.env.DATABASE_SECRET_ID = prevSecretId;
  }
});
