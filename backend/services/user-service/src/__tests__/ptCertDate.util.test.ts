/**
 * Regression: a PT application draft with a certificate date ("2024-03-15", as sent by the web
 * date input and the mobile wizard) failed with a raw Prisma "Expected ISO-8601 DateTime" error,
 * so the applicant could never save or submit once a date was entered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCertDate } from "../utils/ptCertDate.util";

test("bare calendar date becomes UTC midnight of that day", () => {
  assert.equal(normalizeCertDate("2024-03-15", "x")!.toISOString(), "2024-03-15T00:00:00.000Z");
});

test("full ISO timestamp (what the server returns) round-trips", () => {
  assert.equal(normalizeCertDate("2024-03-15T00:00:00.000Z", "x")!.toISOString(), "2024-03-15T00:00:00.000Z");
});

test("cleared and absent values", () => {
  assert.equal(normalizeCertDate("", "x"), null);
  assert.equal(normalizeCertDate(null, "x"), null);
  assert.equal(normalizeCertDate(undefined, "x"), undefined);
});

test("garbage and impossible days are rejected with a readable message, not stored", () => {
  assert.throws(() => normalizeCertDate("15/03/2024", "Ngày cấp chứng chỉ"), /Ngày cấp chứng chỉ không hợp lệ/);
  assert.throws(() => normalizeCertDate("2024-02-31", "x"), /không hợp lệ/);
  assert.throws(() => normalizeCertDate(20240315, "x"), /không hợp lệ/);
});
