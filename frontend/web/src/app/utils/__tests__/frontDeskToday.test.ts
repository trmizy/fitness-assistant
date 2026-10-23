/**
 * CODE/UNIT — D15b helper của quầy lễ tân. Chạy: npx tsx --test src/app/utils/__tests__/frontDeskToday.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockLabel, filterByName, normalizeFrontDeskToday, normalizeTodayPts, presenceOf } from "../frontDeskToday";

describe("frontDeskToday", () => {
  it("keeps ONLY display name + times: id / phone / e-mail / health fields are dropped even if the server sent them", () => {
    const v = normalizeFrontDeskToday({
      localDate: "2026-10-21",
      bookingsAvailable: true,
      clients: [{ displayName: "Nguyễn An", checkedInAt: "2026-10-21T02:15:00Z", bookedAt: null, clientId: "c1", email: "a@b.c", phone: "09", inbody: { bmr: 1 } }],
    });
    assert.deepEqual(Object.keys(v.clients[0]).sort(), ["bookedAt", "checkedInAt", "displayName"]);
    assert.equal(JSON.stringify(v).includes("a@b.c"), false);
    assert.equal(JSON.stringify(v).includes("c1"), false);
  });

  it("is defensive about malformed payloads and missing names (neutral label, never an id)", () => {
    assert.deepEqual(normalizeFrontDeskToday(null), { localDate: null, bookingsAvailable: true, clients: [] });
    assert.equal(normalizeFrontDeskToday({ clients: [{}] }).clients[0].displayName, "Hội viên");
    assert.equal(normalizeFrontDeskToday({ bookingsAvailable: false, clients: [] }).bookingsAvailable, false);
    assert.deepEqual(normalizeTodayPts({ pts: [{ id: "x", ptName: "", ptUserId: "secret", scanCount: 9 }] }), [{ id: "x", ptName: "Huấn luyện viên", firstScanAt: null }]);
  });

  it("clock label is Vietnam time regardless of the device zone", () => {
    assert.equal(clockLabel("2026-10-21T02:15:00Z"), "09:15");
    assert.equal(clockLabel("2026-10-21T17:30:00Z"), "00:30");
    assert.equal(clockLabel(null), "");
    assert.equal(clockLabel("nope"), "");
  });

  it("checked-in wins over booked; booked-only shows the booking time", () => {
    assert.deepEqual(presenceOf({ displayName: "A", checkedInAt: "2026-10-21T02:15:00Z", bookedAt: "2026-10-21T01:00:00Z" }), { kind: "CHECKED_IN", label: "Đã vào 09:15" });
    assert.deepEqual(presenceOf({ displayName: "A", checkedInAt: null, bookedAt: "2026-10-21T03:00:00Z" }), { kind: "BOOKED", label: "Có lịch 10:00" });
  });

  it("name filter is case-insensitive and empty query returns everyone", () => {
    const rows = [{ displayName: "Nguyễn An" }, { displayName: "Trần Bình" }];
    assert.equal(filterByName(rows, " an ").length, 1);
    assert.equal(filterByName(rows, "").length, 2);
  });
});
