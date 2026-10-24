/** Runs with: tsx --test src/lib/__tests__/personName.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fullName, givenName } from "../personName";

describe("name convention (B21): firstName = họ, lastName = the rest", () => {
  it("greets by the last word of the full name", () => {
    assert.equal(givenName({ firstName: "Nguyễn", lastName: "Thị Uyên" }), "Uyên");
    assert.equal(givenName({ firstName: "Trần", lastName: "Huy" }), "Huy");
  });
  it("a single-word name stored with the '.' placeholder is not a second word", () => {
    assert.equal(givenName({ firstName: "Uyên", lastName: "." }), "Uyên");
    assert.equal(fullName({ firstName: "Uyên", lastName: "." }), "Uyên");
  });
  it("falls back when there is no name", () => {
    assert.equal(givenName(null, "Bạn"), "Bạn");
    assert.equal(fullName({ firstName: "", lastName: null }, "Bạn"), "Bạn");
    assert.equal(fullName({ firstName: "Nguyễn", lastName: "Thị Uyên" }), "Nguyễn Thị Uyên");
  });
});
