/**
 * FIX5 / Q8 — giờ mở cửa + liên kết chia sẻ chi tiết gym (mobile).
 * Chạy: npx tsx --test src/features/__tests__/gymHours.test.ts
 * Mốc: 2026-11-16 là Thứ 2. Giờ VN = UTC+7.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  closedDaysLabel,
  gymShareContent,
  hoursLabel,
  normalizeHours,
  openNowStatus,
  publicGymUrl,
  vietnamClock,
  webOrigin,
} from "../services/gymHours";

const WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const row = (day: string, type: string, o: number | null = null, c: number | null = null) => ({ day, type, openMinute: o, closeMinute: c });
// Thứ 2–Thứ 7 05:00–21:00, Chủ nhật nghỉ.
const STANDARD = WEEK.map((d) => (d === "SUNDAY" ? row(d, "CLOSED") : row(d, "OPEN", 300, 1260)));
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("vietnamClock", () => {
  it("lấy thứ và phút theo giờ Việt Nam, không theo UTC", () => {
    assert.deepEqual(vietnamClock(new Date("2026-11-15T20:30:00Z")), { day: "MONDAY", minute: 3 * 60 + 30 }); // 03:30 Thứ 2 VN
    assert.deepEqual(vietnamClock(vn("2026-11-22T23:59:00")), { day: "SUNDAY", minute: 23 * 60 + 59 });
  });
});

describe("hoursLabel / normalizeHours", () => {
  it("nhãn giờ từng loại ngày", () => {
    assert.equal(hoursLabel({ day: "MONDAY", type: "OPEN", openMinute: 300, closeMinute: 1260 }), "05:00 - 21:00");
    assert.equal(hoursLabel({ day: "MONDAY", type: "ALL_DAY", openMinute: null, closeMinute: null }), "Mở 24 giờ");
    assert.equal(hoursLabel({ day: "SUNDAY", type: "CLOSED", openMinute: null, closeMinute: null }), "Đóng cửa");
    assert.equal(hoursLabel({ day: "FRIDAY", type: "OPEN", openMinute: 1080, closeMinute: 120 }), "18:00 - 02:00 (hôm sau)");
  });
  it("rỗng/rác → [] (không khẳng định đóng cửa); đủ 7 ngày đúng thứ tự khi có dữ liệu", () => {
    assert.deepEqual(normalizeHours(null), []);
    assert.deepEqual(normalizeHours([]), []);
    assert.deepEqual(normalizeHours("x"), []);
    const n = normalizeHours([row("SUNDAY", "ALL_DAY"), row("MONDAY", "OPEN", 300, 600)]);
    assert.deepEqual(n.map((d) => d.day), [...WEEK]);
    assert.equal(n[0].type, "OPEN");
    assert.equal(n[1].type, "CLOSED"); // thiếu dòng → đóng
    assert.equal(n[6].type, "ALL_DAY");
  });
  it("ca OPEN thiếu giờ hoặc mở = đóng → coi là đóng", () => {
    const n = normalizeHours([row("MONDAY", "OPEN", null, null), row("TUESDAY", "OPEN", 300, 300)]);
    assert.equal(n[0].type, "CLOSED");
    assert.equal(n[1].type, "CLOSED");
  });
  it("closedDaysLabel", () => {
    assert.equal(closedDaysLabel(STANDARD), "Nghỉ: Chủ nhật");
    assert.equal(closedDaysLabel(WEEK.map((d) => row(d, "ALL_DAY"))), "");
  });
});

describe("openNowStatus", () => {
  it("đang mở trong giờ", () => {
    const s = openNowStatus(STANDARD, vn("2026-11-16T10:00:00"));
    assert.equal(s.state, "open");
    assert.equal(s.label, "Đang mở cửa · đóng lúc 21:00");
  });
  it("đúng giờ đóng là đã đóng; đúng giờ mở là đang mở", () => {
    assert.equal(openNowStatus(STANDARD, vn("2026-11-16T21:00:00")).state, "closed");
    assert.equal(openNowStatus(STANDARD, vn("2026-11-16T05:00:00")).state, "open");
  });
  it("trước giờ mở → đóng, mở lại hôm nay", () => {
    const s = openNowStatus(STANDARD, vn("2026-11-16T03:00:00"));
    assert.equal(s.state, "closed");
    assert.equal(s.label, "Đang đóng cửa · mở lại 05:00 hôm nay");
  });
  it("sau giờ đóng → mở lại ngày mai", () => {
    assert.equal(openNowStatus(STANDARD, vn("2026-11-16T22:30:00")).label, "Đang đóng cửa · mở lại 05:00 ngày mai");
  });
  it("ngày nghỉ (Chủ nhật) → đóng, mở lại Thứ 2", () => {
    const s = openNowStatus(STANDARD, vn("2026-11-22T10:00:00"));
    assert.equal(s.state, "closed");
    assert.equal(s.label, "Đang đóng cửa · mở lại 05:00 ngày mai");
    // Thứ 7 sau giờ đóng: ngày mai là CN nghỉ → mở lại Thứ 2
    assert.equal(openNowStatus(STANDARD, vn("2026-11-21T22:00:00")).label, "Đang đóng cửa · mở lại 05:00 Thứ 2");
  });
  it("24 giờ luôn mở", () => {
    const s = openNowStatus(WEEK.map((d) => row(d, "ALL_DAY")), vn("2026-11-16T03:00:00"));
    assert.deepEqual(s, { state: "open", label: "Đang mở cửa · 24 giờ" });
  });
  it("ca qua đêm 18:00–02:00: mở lúc 23:00 và 01:00 sáng hôm sau, đóng lúc 03:00", () => {
    const night = WEEK.map((d) => row(d, "OPEN", 1080, 120));
    assert.equal(openNowStatus(night, vn("2026-11-16T23:00:00")).state, "open");
    const early = openNowStatus(night, vn("2026-11-17T01:00:00"));
    assert.equal(early.state, "open");
    assert.equal(early.label, "Đang mở cửa · đóng lúc 02:00");
    assert.equal(openNowStatus(night, vn("2026-11-17T03:00:00")).label, "Đang đóng cửa · mở lại 18:00 hôm nay");
  });
  it("ca qua đêm chỉ Thứ 7: sáng Chủ nhật 01:00 còn mở, Chủ nhật 23:00 thì không", () => {
    const hours = WEEK.map((d) => (d === "SATURDAY" ? row(d, "OPEN", 1200, 180) : row(d, "CLOSED")));
    assert.equal(openNowStatus(hours, vn("2026-11-22T01:00:00")).state, "open");
    assert.equal(openNowStatus(hours, vn("2026-11-22T23:00:00")).state, "closed");
  });
  it("chưa có dữ liệu → unknown", () => {
    assert.deepEqual(openNowStatus([], vn("2026-11-16T10:00:00")), { state: "unknown", label: "" });
    assert.deepEqual(openNowStatus(undefined, vn("2026-11-16T10:00:00")), { state: "unknown", label: "" });
  });
  it("cả tuần đóng → Đang đóng cửa, không có giờ mở lại", () => {
    assert.deepEqual(openNowStatus(WEEK.map((d) => row(d, "CLOSED")), vn("2026-11-16T10:00:00")), { state: "closed", label: "Đang đóng cửa" });
  });
});

describe("liên kết chia sẻ", () => {
  it("publicGymUrl cùng dạng /gyms/:id với web, mã hoá id", () => {
    assert.equal(publicGymUrl("abc-123"), "https://gymini.vn/gyms/abc-123");
    assert.equal(publicGymUrl("a b", "https://x.vn/"), "https://x.vn/gyms/a%20b");
  });
  it("webOrigin: env > suy từ api.<miền> > mặc định", () => {
    assert.equal(webOrigin({ webUrl: "https://app.example.vn/", apiUrl: "https://api.gymini.vn" }), "https://app.example.vn");
    assert.equal(webOrigin({ apiUrl: "https://api.gymini.vn" }), "https://gymini.vn");
    assert.equal(webOrigin({ apiUrl: "http://10.0.2.2:3000" }), "https://gymini.vn");
    assert.equal(webOrigin({ webUrl: "rác", apiUrl: "" }), "https://gymini.vn");
    assert.equal(webOrigin(), "https://gymini.vn");
  });
  it("gymShareContent: Android message chứa URL, iOS url tách riêng", () => {
    const c = gymShareContent({ id: "g1", name: "Gym A" });
    assert.equal(c.url, "https://gymini.vn/gyms/g1");
    assert.ok(c.messageWithUrl.endsWith(c.url));
    assert.ok(!c.text.includes("http"));
  });
});
