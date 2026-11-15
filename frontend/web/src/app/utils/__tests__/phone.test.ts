/**
 * N14G-02 - the wizard's phone rule mirrors gym-service phone.util.ts. CODE/UNIT only.
 * Run: npx tsx --test src/app/utils/__tests__/phone.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidPhoneNumber } from "../phone";

describe("isValidPhoneNumber", () => {
  it("accepts usual Vietnamese formats", () => {
    for (const v of ["0901234567", "0901 234 567", "+84 901 234 567", "(028) 3822 1234", " 0901.234.567 "]) assert.equal(isValidPhoneNumber(v), true, v);
  });
  it("rejects letters, symbols-only, too short/long, misplaced plus", () => {
    for (const v of ["abc", "12", "<script>", "+++-----", "0901-abc-567", "090123456789012345", "12 345 67", "09+01234567", "", "   "]) assert.equal(isValidPhoneNumber(v), false, v);
  });
  it("non-strings are invalid", () => {
    assert.equal(isValidPhoneNumber(null), false);
    assert.equal(isValidPhoneNumber(901234567), false);
  });
});
