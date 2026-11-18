/**
 * PT-05 / PT-02,03,06,09 (partner retest 2026-11-18): after a reload the weekly schedule was empty ("Nghỉ") because the server returns
 * "MONDAY" while the editor keys its cards "Mon", and raw English/enums reached the screen. Pure model test.
 * Run: npx tsx --test src/app/utils/__tests__/ptApplicationDisplay.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_KEYS,
  certStatusLabel,
  dayLabelVi,
  experienceLabel,
  normalizeAvailabilityBlocks,
  normalizeDayKey,
} from "../ptApplicationDisplay";

describe("normalizeDayKey", () => {
  it("maps the server's full names and any case to the editor key", () => {
    const full = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    assert.deepEqual(full.map(normalizeDayKey), [...DAY_KEYS]);
    assert.deepEqual(["monday", "Mon", "MON", " sat "].map(normalizeDayKey), ["Mon", "Mon", "Mon", "Sat"]);
  });
  it("never drops or invents a value it does not know", () => {
    assert.equal(normalizeDayKey("Funday"), "Funday");
    assert.equal(normalizeDayKey(undefined), "");
    assert.equal(normalizeDayKey(null), "");
  });
});

describe("dayLabelVi", () => {
  it("shows a Vietnamese day name for either spelling, never the raw enum", () => {
    assert.equal(dayLabelVi("MONDAY"), "Thứ 2");
    assert.equal(dayLabelVi("Sun"), "Chủ nhật");
    assert.doesNotMatch(dayLabelVi("MONDAY"), /MONDAY/);
  });
});

describe("normalizeAvailabilityBlocks (restore after reload)", () => {
  it("turns a server draft into blocks every editor day card can find, keeping the times", () => {
    const fromServer = [
      { dayOfWeek: "MONDAY", startTime: "17:00", endTime: "20:00" },
      { dayOfWeek: "SATURDAY", startTime: "08:00", endTime: "11:00" },
    ];
    const blocks = normalizeAvailabilityBlocks(fromServer);
    assert.deepEqual(blocks, [
      { dayOfWeek: "Mon", startTime: "17:00", endTime: "20:00" },
      { dayOfWeek: "Sat", startTime: "08:00", endTime: "11:00" },
    ]);
    // the editor renders card `day.value` with blocks.filter(b => b.dayOfWeek === day.value)
    for (const day of DAY_KEYS) assert.equal(blocks.filter((b) => b.dayOfWeek === day).length, day === "Mon" || day === "Sat" ? 1 : 0);
    assert.equal(fromServer[0].dayOfWeek, "MONDAY", "the input is not mutated");
  });
  it("tolerates a missing list", () => {
    assert.deepEqual(normalizeAvailabilityBlocks(undefined), []);
    assert.deepEqual(normalizeAvailabilityBlocks(null), []);
  });
});

describe("labels", () => {
  it("certificate status and experience read in Vietnamese; unknown values stay visible", () => {
    assert.deepEqual(["Valid", "Expired", "Lifetime"].map(certStatusLabel), ["Còn hiệu lực", "Đã hết hạn", "Vô thời hạn"]);
    assert.equal(certStatusLabel(undefined), "Còn hiệu lực");
    assert.equal(certStatusLabel("Other"), "Other");
    assert.equal(experienceLabel("3-5"), "3 - 5 năm");
    assert.equal(experienceLabel("10+"), "Hơn 10 năm");
    assert.equal(experienceLabel(undefined), "");
  });
});
