import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUploadFilename,
  validateUploadMime,
} from "../utils/upload-validation";

// ── validateUploadMime ────────────────────────────────────────────────────────

test("rejects .exe (application/x-msdownload)", () => {
  const err = validateUploadMime("application/x-msdownload", "malware.exe");
  assert.ok(err !== null, "Expected error for .exe upload");
  assert.match(err!, /not allowed/i);
});

test("accepts image/png + .png", () => {
  assert.strictEqual(validateUploadMime("image/png", "photo.png"), null);
});

test("accepts image/jpeg + .jpg", () => {
  assert.strictEqual(validateUploadMime("image/jpeg", "scan.jpg"), null);
});

test("accepts application/pdf + .pdf", () => {
  assert.strictEqual(validateUploadMime("application/pdf", "report.pdf"), null);
});

test("rejects MIME/extension mismatch (image/png + .exe)", () => {
  const err = validateUploadMime("image/png", "disguised.exe");
  assert.ok(err !== null, "Expected error for extension mismatch");
  assert.match(err!, /not allowed/i);
});

// ── validateUploadFilename ────────────────────────────────────────────────────

test("rejects path traversal: ../evil.png", () => {
  const err = validateUploadFilename("../evil.png");
  assert.ok(err !== null, "Expected error for path traversal");
  assert.match(err!, /path traversal/i);
});

test("rejects path traversal: ..\\evil.png (backslash)", () => {
  const err = validateUploadFilename("..\\.evil.png");
  assert.ok(err !== null, "Expected error for backslash path traversal");
});

test("rejects absolute path", () => {
  const err = validateUploadFilename("/etc/passwd");
  assert.ok(err !== null, "Expected error for absolute path");
});

test("rejects shell injection characters", () => {
  const err = validateUploadFilename("file;rm-rf.jpg");
  assert.ok(err !== null, "Expected error for shell injection chars");
});

test("accepts normal filename", () => {
  assert.strictEqual(validateUploadFilename("inbody_scan_2024.jpg"), null);
});

// 2026-11-11: optional visceral fat / BMR from the scan confirm form must never break the save.
test("sanitizeOptionalMetrics drops NaN/empty values and rounds BMR to the Int column", async () => {
  const { sanitizeOptionalMetrics } = await import("../services/inbody.service");
  assert.deepEqual(sanitizeOptionalMetrics({ weight: 80, bmr: 1650.5, visceralFat: 9.04 }), { weight: 80, bmr: 1651, visceralFat: 9 });
  assert.deepEqual(sanitizeOptionalMetrics({ weight: 80, bmr: Number.NaN, visceralFat: "" }), { weight: 80 });
  assert.deepEqual(sanitizeOptionalMetrics({ weight: 80 }), { weight: 80 });
});

// Vision test 2026-11-11: a day-first date read month-first lands in the future; swap it back only when that is valid and past.
test("fixDayMonthSwap repairs a future month-first reading, never a plausible date", async () => {
  const { fixDayMonthSwap } = await import("../services/inbody.service");
  const now = new Date("2026-11-11T00:00:00Z");
  assert.equal(fixDayMonthSwap("2026-12-08", now), "2026-08-12");
  assert.equal(fixDayMonthSwap("2026-08-07", now), "2026-08-07");
  assert.equal(fixDayMonthSwap("2026-12-25", now), "2026-12-25", "day > 12 cannot be a swap");
  assert.equal(fixDayMonthSwap("2027-03-04", now), "2027-03-04", "swap would still be future");
});
