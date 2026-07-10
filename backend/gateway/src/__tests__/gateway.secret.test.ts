import test from "node:test";
import assert from "node:assert/strict";
import { validateInternalSecret } from "../utils/internal-secret";

test("production + default secret → throws", () => {
  assert.throws(
    () =>
      validateInternalSecret(
        "dev_internal_service_secret_change_in_production",
        "production",
      ),
    /INTERNAL_SERVICE_SECRET/,
  );
});

test("production + undefined secret → throws", () => {
  assert.throws(
    () => validateInternalSecret(undefined, "production"),
    /INTERNAL_SERVICE_SECRET/,
  );
});

test("production + secret shorter than 32 chars → throws", () => {
  assert.throws(
    () => validateInternalSecret("tooshort", "production"),
    /INTERNAL_SERVICE_SECRET/,
  );
});

test("production + valid secret (32+ chars) → does not throw", () => {
  assert.doesNotThrow(() =>
    validateInternalSecret(
      "a-valid-production-secret-that-is-long!",
      "production",
    ),
  );
});

test("development + default secret → does not throw", () => {
  assert.doesNotThrow(() =>
    validateInternalSecret(
      "dev_internal_service_secret_change_in_production",
      "development",
    ),
  );
});

test("test environment + undefined → does not throw", () => {
  assert.doesNotThrow(() => validateInternalSecret(undefined, "test"));
});
