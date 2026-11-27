import assert from "node:assert/strict";
import test from "node:test";
import { foldVietnamese, nameMatchesQuery } from "../utils/vi-search";

const user = (firstName: string | null, lastName: string | null) => ({ firstName, lastName });

test("folds accents, đ, case, NFC/NFD and repeated spaces", () => {
  assert.equal(foldVietnamese("  Nguyễn   Đức "), "nguyen duc");
  assert.equal(foldVietnamese("Nguyễn".normalize("NFD")), "nguyen");
  assert.equal(foldVietnamese("ĐẶNG"), "dang");
});

test("matches a substring of the display name in both accent directions", () => {
  assert.ok(nameMatchesQuery(user("Nguyễn Văn", "An"), foldVietnamese("nguyen")));
  assert.ok(nameMatchesQuery(user("nguyen van", "an"), foldVietnamese("Nguyễn")));
  assert.ok(nameMatchesQuery(user("Nguyễn", "Văn An"), foldVietnamese("văn an")));
  assert.ok(!nameMatchesQuery(user("Trần", "Bình"), foldVietnamese("nguyen")));
});

test("% and _ are literal, and a user without a name never matches", () => {
  assert.ok(!nameMatchesQuery(user("Nguyễn", "An"), foldVietnamese("%%")));
  assert.ok(!nameMatchesQuery(user("Nguyễn", "An"), foldVietnamese("__")));
  assert.ok(!nameMatchesQuery(user(null, null), foldVietnamese("an")));
});
