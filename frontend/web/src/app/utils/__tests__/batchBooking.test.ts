/**
 * Several-slot booking logic of the client booking page (pure). TEST FIXTURE - no browser run.
 * Run: npx tsx --test src/app/utils/__tests__/batchBooking.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_SESSIONS,
  addSlot,
  buildBatchPayload,
  readBatchRejection,
  slotKey,
  slotLabel,
  toggleSlot,
  type PickedSlot,
} from "../batchBooking";

const p = (dateStr: string, slot: string): PickedSlot => ({ dateStr, slot });

describe("addSlot / toggleSlot", () => {
  it("keeps slots chronological across days", () => {
    let list: PickedSlot[] = [];
    list = addSlot(list, p("2030-05-12", "07:00"), { sessionsLeft: 9 }).list;
    list = addSlot(list, p("2030-05-10", "18:00"), { sessionsLeft: 9 }).list;
    assert.deepEqual(list.map(slotKey), ["2030-05-10 18:00", "2030-05-12 07:00"]);
  });

  it("toggle removes a picked slot and adds an unpicked one", () => {
    const first = toggleSlot([], p("2030-05-10", "07:00"), { sessionsLeft: 5 });
    assert.equal(first.list.length, 1);
    const second = toggleSlot(first.list, p("2030-05-10", "07:00"), { sessionsLeft: 5 });
    assert.equal(second.list.length, 0);
    assert.equal(second.error, null);
  });

  it("refuses a 3rd slot on one day, more than the contract has left, and more than the batch maximum", () => {
    const day = [p("2030-05-10", "07:00"), p("2030-05-10", "09:00")];
    assert.match(addSlot(day, p("2030-05-10", "11:00"), { sessionsLeft: 9 }).error!, /tối đa 2 buổi/);
    assert.match(addSlot(day, p("2030-05-11", "11:00"), { sessionsLeft: 2 }).error!, /Gói chỉ còn 2 buổi/);
    const many = Array.from({ length: MAX_BATCH_SESSIONS }, (_, i) => p(`2030-06-${String(i + 1).padStart(2, "0")}`, "07:00"));
    assert.match(addSlot(many, p("2030-07-01", "07:00"), { sessionsLeft: 99 }).error!, /tối đa 10 buổi/);
  });
});

describe("buildBatchPayload / readBatchRejection / slotLabel", () => {
  it("payload is sorted date/time pairs; notes trimmed, empty omitted", () => {
    assert.deepEqual(
      buildBatchPayload({ slots: [p("2030-05-11", "07:00"), p("2030-05-10", "09:00")], sessionMode: "ONLINE", notes: "  " }),
      {
        slots: [
          { scheduledDate: "2030-05-10", scheduledTime: "09:00" },
          { scheduledDate: "2030-05-11", scheduledTime: "07:00" },
        ],
        sessionMode: "ONLINE",
      },
    );
  });

  it("a refused batch maps the per-slot reasons to slot keys", () => {
    const r = readBatchRejection({
      response: {
        data: {
          error: "Chưa đặt được: 1/2 khung giờ không hợp lệ.",
          slotErrors: [{ index: 1, scheduledDate: "2030-05-10", scheduledTime: "11:00", error: "Khung giờ này trùng với một buổi tập khác" }],
        },
      },
    });
    assert.deepEqual(r.bySlot, { "2030-05-10 11:00": "Khung giờ này trùng với một buổi tập khác" });
    assert.match(r.headline!, /Chưa đặt được/);
    assert.deepEqual(readBatchRejection(new Error("x")), { bySlot: {}, headline: null });
  });

  it("labels a slot in Vietnamese", () => {
    assert.equal(slotLabel(p("2030-05-10", "07:00")), "Th 6, 10/05 · 07:00");
  });
});
