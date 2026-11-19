/**
 * Q8 / N14G-03 - opening hours on the public gym detail. CODE/UNIT only.
 * Run: npx tsx --test src/app/utils/__tests__/gymHours.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closedDaysLabel, hoursLabel, normalizeHours, openNowStatus, vietnamClock } from "../gymHours";

const WEEK = [
  { day: "MONDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 },
  { day: "TUESDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 },
  { day: "WEDNESDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 },
  { day: "THURSDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 },
  { day: "FRIDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 },
  { day: "SATURDAY", type: "ALL_DAY", openMinute: null, closeMinute: null },
  { day: "SUNDAY", type: "CLOSED", openMinute: null, closeMinute: null },
];
// 2026-11-16 is a Monday. Vietnam = UTC+7.
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("gymHours", () => {
  it("reads the clock in Vietnam time regardless of the machine zone", () => {
    assert.deepEqual(vietnamClock(new Date("2026-11-15T17:30:00Z")), { day: "MONDAY", minute: 30 });
    assert.deepEqual(vietnamClock(vn("2026-11-16T23:59:00")), { day: "MONDAY", minute: 1439 });
  });
  it("no data -> unknown (section hidden), never closed", () => {
    assert.equal(openNowStatus([]).state, "unknown");
    assert.equal(openNowStatus(undefined).state, "unknown");
    assert.deepEqual(normalizeHours(null), []);
  });
  it("open inside the interval, closes at the end minute", () => {
    assert.deepEqual(openNowStatus(WEEK, vn("2026-11-16T10:00:00")), { state: "open", label: "Đang mở cửa · đóng lúc 21:00" });
    assert.equal(openNowStatus(WEEK, vn("2026-11-16T21:00:00")).state, "closed");
  });
  it("before opening -> reopens today; after closing -> tomorrow; Friday night -> Saturday (24h)", () => {
    assert.equal(openNowStatus(WEEK, vn("2026-11-16T04:00:00")).label, "Đang đóng cửa · mở lại 05:00 hôm nay");
    assert.equal(openNowStatus(WEEK, vn("2026-11-16T22:00:00")).label, "Đang đóng cửa · mở lại 05:00 ngày mai");
    assert.equal(openNowStatus(WEEK, vn("2026-11-20T22:00:00")).label, "Đang đóng cửa · mở lại 00:00 ngày mai");
  });
  it("ALL_DAY is open; Sunday closed points at Monday", () => {
    assert.equal(openNowStatus(WEEK, vn("2026-11-21T03:00:00")).label, "Đang mở cửa · 24 giờ");
    assert.equal(openNowStatus(WEEK, vn("2026-11-22T12:00:00")).label, "Đang đóng cửa · mở lại 05:00 ngày mai");
  });
  it("labels and closed days", () => {
    assert.equal(hoursLabel(WEEK[0] as any), "05:00 - 21:00");
    assert.equal(hoursLabel(WEEK[5] as any), "Mở 24 giờ");
    assert.equal(hoursLabel(WEEK[6] as any), "Đóng cửa");
    assert.equal(closedDaysLabel(WEEK), "Nghỉ: Chủ nhật");
    assert.equal(closedDaysLabel(WEEK.map((d) => ({ ...d, type: "ALL_DAY" }))), "");
  });
  it("a malformed OPEN row degrades to closed instead of NaN", () => {
    const out = normalizeHours([{ day: "MONDAY", type: "OPEN", openMinute: null, closeMinute: 10 }]);
    assert.equal(out[0].type, "CLOSED");
    assert.equal(out.length, 7);
  });
});
