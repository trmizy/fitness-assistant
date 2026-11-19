/**
 * Several-slot booking logic (pure, no React).
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/batchBooking.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BATCH_SESSIONS,
  MAX_SESSIONS_PER_DAY,
  addSlot,
  batchBlockedReason,
  buildBatchPayload,
  readBatchRejection,
  removeSlot,
  slotKey,
  slotLabel,
  sortSlots,
  type PickedSlot,
} from "../services/batchBooking";

const s = (date: string, time: string): PickedSlot => ({ date, time });

describe("addSlot", () => {
  it("adds in chronological order, across days", () => {
    let list: PickedSlot[] = [];
    list = addSlot(list, s("2030-05-12", "07:00"), { sessionsLeft: 9 }).list;
    list = addSlot(list, s("2030-05-10", "18:00"), { sessionsLeft: 9 }).list;
    list = addSlot(list, s("2030-05-10", "07:00"), { sessionsLeft: 9 }).list;
    assert.deepEqual(list.map(slotKey), ["2030-05-10 07:00", "2030-05-10 18:00", "2030-05-12 07:00"]);
  });

  it("refuses a duplicate, leaving the list as it was", () => {
    const list = [s("2030-05-10", "07:00")];
    const r = addSlot(list, s("2030-05-10", "07:00"), { sessionsLeft: 9 });
    assert.equal(r.list, list);
    assert.match(r.error!, /đã có trong danh sách/);
  });

  it("refuses a third slot on one day (the daily cap, pending sessions included server-side)", () => {
    let list: PickedSlot[] = [];
    list = addSlot(list, s("2030-05-10", "07:00"), { sessionsLeft: 9 }).list;
    list = addSlot(list, s("2030-05-10", "09:00"), { sessionsLeft: 9 }).list;
    const r = addSlot(list, s("2030-05-10", "11:00"), { sessionsLeft: 9 });
    assert.equal(MAX_SESSIONS_PER_DAY, 2);
    assert.match(r.error!, /tối đa 2 buổi/);
    assert.equal(r.list.length, 2);
  });

  it("refuses more than the contract has left", () => {
    const list = [s("2030-05-10", "07:00"), s("2030-05-11", "07:00")];
    const r = addSlot(list, s("2030-05-12", "07:00"), { sessionsLeft: 2 });
    assert.match(r.error!, /Gói chỉ còn 2 buổi/);
  });

  it("refuses more than MAX_BATCH_SESSIONS", () => {
    const list = Array.from({ length: MAX_BATCH_SESSIONS }, (_, i) => s(`2030-06-${String(i + 1).padStart(2, "0")}`, "07:00"));
    const r = addSlot(list, s("2030-07-01", "07:00"), { sessionsLeft: 99 });
    assert.match(r.error!, /tối đa 10 buổi/);
  });
});

describe("removeSlot / sortSlots", () => {
  it("removes by date+time", () => {
    const list = [s("2030-05-10", "07:00"), s("2030-05-11", "07:00")];
    assert.deepEqual(removeSlot(list, s("2030-05-10", "07:00")), [s("2030-05-11", "07:00")]);
  });
  it("sortSlots does not mutate", () => {
    const list = [s("2030-05-11", "07:00"), s("2030-05-10", "07:00")];
    sortSlots(list);
    assert.equal(list[0].date, "2030-05-11");
  });
});

describe("buildBatchPayload", () => {
  it("sends date/time pairs sorted, trims text, omits empties", () => {
    const p = buildBatchPayload({
      slots: [s("2030-05-11", "07:00"), s("2030-05-10", "09:00")],
      sessionMode: "OFFLINE",
      location: "  ",
      notes: " ghi chú ",
    });
    assert.deepEqual(p, {
      slots: [
        { scheduledDate: "2030-05-10", scheduledTime: "09:00" },
        { scheduledDate: "2030-05-11", scheduledTime: "07:00" },
      ],
      sessionMode: "OFFLINE",
      notes: "ghi chú",
    });
  });
});

describe("readBatchRejection", () => {
  it("maps slotErrors to slot keys and keeps the headline", () => {
    const error = {
      response: {
        status: 409,
        data: {
          error: "Chưa đặt được: 1/2 khung giờ không hợp lệ.",
          code: "BATCH_BOOKING_REJECTED",
          slotErrors: [{ index: 1, scheduledDate: "2030-05-10", scheduledTime: "11:00", error: "Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập" }],
        },
      },
    };
    const r = readBatchRejection(error);
    assert.deepEqual(r.bySlot, { "2030-05-10 11:00": "Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập" });
    assert.match(r.headline!, /Chưa đặt được/);
  });
  it("is safe on a network error", () => {
    assert.deepEqual(readBatchRejection(new Error("Network Error")), { bySlot: {}, headline: null });
  });
});

describe("batchBlockedReason / slotLabel", () => {
  it("explains why the button is off", () => {
    assert.match(batchBlockedReason({ contractStatus: "EXPIRED", sessionsLeft: 3, count: 1 })!, /hiệu lực/);
    assert.match(batchBlockedReason({ contractStatus: "ACTIVE", sessionsLeft: 0, count: 1 })!, /hết số buổi/);
    assert.match(batchBlockedReason({ contractStatus: "ACTIVE", sessionsLeft: 3, count: 0 })!, /Chọn ngày/);
    assert.equal(batchBlockedReason({ contractStatus: "ACTIVE", sessionsLeft: 3, count: 2 }), null);
  });
  it("labels a slot in Vietnamese", () => {
    assert.equal(slotLabel(s("2030-05-10", "07:00")), "Th 6, 10/05 · 07:00");
  });
});
