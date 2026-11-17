/**
 * N13A-13 - thời lượng mỗi buổi của bước "Lịch tập" khớp luật backend (số nguyên 10-240 phút).
 * Chạy: npx tsx --test src/app/pages/client/__tests__/onboarding.validation.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SESSION_DURATION_MAX, SESSION_DURATION_MIN, validateSessionDuration } from "../onboarding.validation";

describe("validateSessionDuration", () => {
  it("matches the backend bounds 10-240", () => {
    assert.equal(SESSION_DURATION_MIN, 10);
    assert.equal(SESSION_DURATION_MAX, 240);
  });
  it("accepts the boundary values and a normal value", () => {
    for (const v of ["10", "60", "240", " 45 "]) assert.equal(validateSessionDuration(v), null, v);
  });
  it("rejects out-of-range values with a Vietnamese message", () => {
    for (const v of ["0", "9", "241", "1000", "-5"]) {
      const msg = validateSessionDuration(v);
      assert.ok(msg && /10–240 phút/.test(msg), `${v} -> ${msg}`);
    }
  });
  it("rejects empty and non-integer input", () => {
    for (const v of ["", "  ", "abc", "45.5", "1e2"]) assert.notEqual(validateSessionDuration(v), null, v);
  });
});
