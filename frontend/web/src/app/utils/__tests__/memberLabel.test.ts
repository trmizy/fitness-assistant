/** TEST FIXTURE: pure label helper. Run: npx tsx --test src/app/utils/__tests__/memberLabel.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { memberLabel } from "../memberLabel";

test("memberLabel prefers the display name and falls back to the short id", () => {
  assert.equal(memberLabel("1234567890abcdef", "Nguyễn Văn An"), "Nguyễn Văn An");
  assert.equal(memberLabel("1234567890abcdef", "  Lê Bình "), "Lê Bình");
  assert.equal(memberLabel("1234567890abcdef"), "12345678...");
  assert.equal(memberLabel("1234567890abcdef", "   "), "12345678...");
  assert.equal(memberLabel("1234567890abcdef", null), "12345678...");
  assert.equal(memberLabel(null), "Hội viên");
});
