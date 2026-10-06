import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aboutError,
  closePayload,
  closedLine,
  copyMondayTo,
  docStatus,
  hoursDirty,
  hoursIssues,
  hoursPayload,
  hoursRows,
  isPdfToken,
  minutesToTime,
  movedPhotoIds,
  nameAddressError,
  operationalActions,
  reopenDateError,
  sameFacilities,
  setDayType,
  timeToMinutes,
  toggleFacility,
} from "../gymOwner/branchManage";
import type { GymOperatingHoursDay } from "../../types";

/**
 * 14B.5 — branch management rules (web GymManagePage + gym-service validation), pinned.
 *
 * Chạy: npx tsx --test src/features/__tests__/branchManage.test.ts
 */

const day = (d: GymOperatingHoursDay["day"], type: GymOperatingHoursDay["type"], o: number | null = null, c: number | null = null): GymOperatingHoursDay => ({
  id: "x",
  gymId: "g",
  day: d,
  type,
  openMinute: o,
  closeMinute: c,
});

describe("opening hours", () => {
  it("converts minutes and HH:MM both ways, rejecting malformed times", () => {
    assert.equal(minutesToTime(360), "06:00");
    assert.equal(minutesToTime(1439), "23:59");
    assert.equal(minutesToTime(null), "");
    assert.equal(timeToMinutes("06:30"), 390);
    assert.equal(timeToMinutes("24:00"), null);
    assert.equal(timeToMinutes("6:30"), null);
  });

  it("fills missing days as CLOSED, in week order", () => {
    const rows = hoursRows([day("SUNDAY", "ALL_DAY"), day("MONDAY", "OPEN", 360, 1320)]);
    assert.deepEqual(
      rows.map((r) => `${r.day}:${r.type}:${r.open}-${r.close}`),
      ["MONDAY:OPEN:06:00-22:00", "TUESDAY:CLOSED:-", "WEDNESDAY:CLOSED:-", "THURSDAY:CLOSED:-", "FRIDAY:CLOSED:-", "SATURDAY:CLOSED:-", "SUNDAY:ALL_DAY:-"],
    );
  });

  it("opening a closed day starts at 06:00–22:00; copying Monday covers the chosen days", () => {
    let rows = hoursRows([]);
    rows = setDayType(rows, "MONDAY", "OPEN");
    assert.deepEqual([rows[0].open, rows[0].close], ["06:00", "22:00"]);
    rows = copyMondayTo(rows, ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
    assert.equal(rows.filter((r) => r.type === "OPEN").length, 5);
    assert.equal(rows[5].type, "CLOSED");
  });

  it("flags bad times and a week with no open day (same checks as gym-hours.service)", () => {
    const closed = hoursRows([]);
    assert.deepEqual(hoursIssues(closed), ["Cần ít nhất một ngày mở cửa (hoặc mở 24 giờ)"]);
    const bad = setDayType(closed, "MONDAY", "OPEN").map((r) => (r.day === "MONDAY" ? { ...r, open: "22:00", close: "06:00" } : r));
    assert.deepEqual(hoursIssues(bad), ["Thứ 2: giờ mở cửa phải trước giờ đóng cửa"]);
    const typo = setDayType(closed, "MONDAY", "OPEN").map((r) => (r.day === "MONDAY" ? { ...r, open: "6h" } : r));
    assert.deepEqual(hoursIssues(typo), ["Thứ 2: nhập giờ theo dạng HH:MM"]);
    assert.deepEqual(hoursIssues(setDayType(closed, "SUNDAY", "ALL_DAY")), []);
  });

  it("sends all 7 days with minutes only on OPEN days, and knows when nothing changed", () => {
    const saved = [day("MONDAY", "OPEN", 360, 1320)];
    const rows = setDayType(hoursRows(saved), "SATURDAY", "ALL_DAY");
    const body = hoursPayload("g", rows);
    assert.equal(body.length, 7);
    assert.deepEqual(body[0], { id: null, gymId: "g", day: "MONDAY", type: "OPEN", openMinute: 360, closeMinute: 1320 });
    assert.deepEqual(body[5], { id: null, gymId: "g", day: "SATURDAY", type: "ALL_DAY", openMinute: null, closeMinute: null });
    assert.equal(hoursDirty(hoursRows(saved), saved), false);
    assert.equal(hoursDirty(rows, saved), true);
  });
});

describe("facilities, about, name & address", () => {
  it("toggles a facility and compares sets regardless of order", () => {
    assert.deepEqual(toggleFacility(["WIFI"], "PARKING"), ["WIFI", "PARKING"]);
    assert.deepEqual(toggleFacility(["WIFI", "PARKING"], "WIFI"), ["PARKING"]);
    assert.equal(sameFacilities(["WIFI", "PARKING"], ["PARKING", "WIFI"]), true);
    assert.equal(sameFacilities(["WIFI"], null), false);
  });

  it("about: ≤ 300 chars, phone ≤ 20, valid or empty email", () => {
    assert.equal(aboutError({ description: "ok", phone: "0901", email: "" }), null);
    assert.equal(aboutError({ description: "x".repeat(301), phone: "", email: "" }), "Giới thiệu tối đa 300 ký tự");
    assert.equal(aboutError({ description: "", phone: "1".repeat(21), email: "" }), "Số điện thoại tối đa 20 ký tự");
    assert.equal(aboutError({ description: "", phone: "", email: "abc" }), "Email không đúng định dạng");
  });

  it("name and address are both required", () => {
    assert.equal(nameAddressError({ name: " ", address: "1 A" }), "Nhập tên chi nhánh");
    assert.equal(nameAddressError({ name: "Gym", address: "" }), "Nhập địa chỉ");
    assert.equal(nameAddressError({ name: "Gym", address: "1 A" }), null);
  });
});

describe("photos and documents", () => {
  it("moves a photo by one place, refusing to fall off either end", () => {
    assert.deepEqual(movedPhotoIds(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
    assert.deepEqual(movedPhotoIds(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
    assert.equal(movedPhotoIds(["a", "b"], 0, -1), null);
    assert.equal(movedPhotoIds(["a", "b"], 1, 1), null);
  });

  it("document status labels default to 'Chưa nộp'; PDFs are recognised by their token", () => {
    assert.equal(docStatus(null).label, "Chưa nộp");
    assert.equal(docStatus("REJECTED").tone, "danger");
    assert.equal(isPdfToken("abc.PDF"), true);
    assert.equal(isPdfToken("abc.jpg"), false);
  });
});

describe("operational status (gym.service.setOperationalStatus)", () => {
  it("offers only what the server allows from each status", () => {
    assert.deepEqual(operationalActions("OPEN"), { reopen: false, closeTemporarily: true, closePermanently: true });
    assert.deepEqual(operationalActions("TEMPORARILY_CLOSED"), { reopen: true, closeTemporarily: false, closePermanently: true });
    assert.deepEqual(operationalActions("PERMANENTLY_CLOSED"), { reopen: false, closeTemporarily: false, closePermanently: false });
  });

  it("reopen date is optional, YYYY-MM-DD, not in the past", () => {
    assert.equal(reopenDateError("", "2026-10-05"), null);
    assert.equal(reopenDateError("2026-10-05", "2026-10-05"), null);
    assert.equal(reopenDateError("2026-10-04", "2026-10-05"), "Ngày mở lại không thể ở quá khứ");
    assert.equal(reopenDateError("05/10/2026", "2026-10-05"), "Ngày theo dạng YYYY-MM-DD");
  });

  it("sends the reopen date only for a temporary closure", () => {
    assert.deepEqual(closePayload("TEMPORARILY_CLOSED", " sửa chữa ", "2026-10-20"), {
      operationalStatus: "TEMPORARILY_CLOSED",
      reason: "sửa chữa",
      expectedReopenAt: "2026-10-20",
    });
    assert.deepEqual(closePayload("PERMANENTLY_CLOSED", "đóng", "2026-10-20"), { operationalStatus: "PERMANENTLY_CLOSED", reason: "đóng" });
  });

  it("describes a closed branch in one line", () => {
    assert.equal(closedLine({ operationalStatus: "OPEN" }), null);
    assert.equal(closedLine({ operationalStatus: "PERMANENTLY_CLOSED", closureReason: "hết hợp đồng" }), "Đã đóng cửa vĩnh viễn — hết hợp đồng");
    assert.match(String(closedLine({ operationalStatus: "TEMPORARILY_CLOSED", closureReason: "sửa", expectedReopenAt: "2026-10-20T00:00:00" })), /^Đang tạm đóng cửa — sửa · Dự kiến mở lại: /);
  });
});
