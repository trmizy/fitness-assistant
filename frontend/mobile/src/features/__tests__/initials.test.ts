/** N15M-13 — Chạy: npx tsx --test src/features/__tests__/initials.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { initialsOf } from "../../utils/initials";

describe("initialsOf", () => {
  it("hai chữ cái đầu của hai từ đầu — cùng kết quả cho cuộc gọi và chat", () => {
    assert.equal(initialsOf("Trần Hà Vi"), "TH");
    assert.equal(initialsOf("Tuấn Hưng"), "TH");
    assert.equal(initialsOf("  linh   nguyễn "), "LN");
  });
  it("một từ, rỗng, null", () => {
    assert.equal(initialsOf("Sơn"), "S");
    assert.equal(initialsOf(""), "");
    assert.equal(initialsOf(undefined), "");
  });
});
