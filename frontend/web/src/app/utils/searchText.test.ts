import { test } from "node:test";
import assert from "node:assert/strict";
import { searchKey, rankEntries } from "./searchText";

test("searchKey strips Vietnamese diacritics and đ", () => {
  assert.equal(searchKey("  Dinh   dưỡng "), "dinh duong");
  assert.equal(searchKey("Đặt lịch"), "dat lich");
  assert.equal(searchKey("Khiếu nại của tôi"), "khieu nai cua toi");
});

const E = [
  { label: "Tổng quan", to: "/a", keywords: ["trang chủ"] },
  { label: "Tập luyện", to: "/b", keywords: ["lịch tập", "bài tập"] },
  { label: "Kế hoạch AI", to: "/c", keywords: ["ai coach"] },
  { label: "Dinh dưỡng", to: "/d", keywords: ["calo", "món ăn"] },
];

test("rankEntries: accent-free query, label prefix first, keywords count, all words must match", () => {
  assert.deepEqual(rankEntries(E, "dinh duong").map((e) => e.to), ["/d"]);
  assert.deepEqual(rankEntries(E, "tap").map((e) => e.to), ["/b"]); // label prefix
  assert.deepEqual(rankEntries(E, "lich tap").map((e) => e.to), ["/b"]); // keyword
  assert.deepEqual(rankEntries(E, "ai").map((e) => e.to), ["/c"]);
  assert.deepEqual(rankEntries(E, "calo zzz"), []);
  assert.equal(rankEntries(E, "   ").length, 4);
});
