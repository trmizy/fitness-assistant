/**
 * N13A-14 (web) - hiển thị họ tên khi lastName là null / rỗng / "." (tên một từ).
 * Chạy: npx tsx --test src/app/utils/__tests__/fullName.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fullName } from "../fullName";

describe("fullName", () => {
  it("joins first and last name", () => assert.equal(fullName({ firstName: "Nguyễn", lastName: "Văn A" }), "Nguyễn Văn A"));
  it("a one-word name (null last name) shows no 'null'", () => assert.equal(fullName({ firstName: "Nguyễn", lastName: null }), "Nguyễn"));
  it("legacy '.' placeholder and empty last name are hidden", () => {
    assert.equal(fullName({ firstName: "Nguyễn", lastName: "." }), "Nguyễn");
    assert.equal(fullName({ firstName: "Nguyễn", lastName: "" }), "Nguyễn");
    assert.equal(fullName({ firstName: "Nguyễn", lastName: undefined }), "Nguyễn");
  });
  it("uses the fallback when there is no user or no name", () => {
    assert.equal(fullName(null, "Client"), "Client");
    assert.equal(fullName({ firstName: null, lastName: null }, "Client"), "Client");
    assert.equal(fullName(undefined), "");
  });
});
