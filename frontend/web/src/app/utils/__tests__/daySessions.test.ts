/**
 * The client's own sessions on a calendar day (pure). TEST FIXTURE - no browser run.
 * Local-time constructors are used on purpose: the helper keys days by the viewer's local date, so the tests hold in any TZ.
 * Run: npx tsx --test src/app/utils/__tests__/daySessions.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bookedDayKeys,
  localDayKey,
  sessionDayKey,
  sessionTabFor,
  sessionTimeRange,
  sessionsOnDay,
} from "../daySessions";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const s = (id: string, status: string, start: string, end?: string) => ({
  id,
  status,
  scheduledStartAt: start,
  scheduledEndAt: end,
});

describe("day keys", () => {
  it("zero-pads month and day", () => {
    assert.equal(localDayKey(new Date(2026, 10, 5)), "2026-11-05");
    assert.equal(sessionDayKey(at(2026, 11, 25, 9)), "2026-11-25");
  });

  it("is null for missing or invalid input", () => {
    assert.equal(sessionDayKey(null), null);
    assert.equal(sessionDayKey(undefined), null);
    assert.equal(sessionDayKey("not a date"), null);
  });

  it("a late-evening local session stays on its own local day", () => {
    assert.equal(sessionDayKey(at(2026, 11, 25, 23, 30)), "2026-11-25");
    assert.equal(sessionDayKey(at(2026, 11, 26, 0, 30)), "2026-11-26");
  });
});

describe("sessionsOnDay", () => {
  const list = [
    s("a", "REQUESTED", at(2026, 11, 25, 9), at(2026, 11, 25, 10)),
    s("b", "CONFIRMED", at(2026, 11, 26, 9), at(2026, 11, 26, 10)),
    s("c", "CANCELLED", at(2026, 11, 25, 11), at(2026, 11, 25, 12)),
    s("d", "CONFIRMED", at(2026, 11, 25, 7), at(2026, 11, 25, 8)),
  ];

  it("keeps only that day, drops cancelled, earliest first", () => {
    assert.deepEqual(sessionsOnDay(list, "2026-11-25").map((x) => x.id), ["d", "a"]);
  });

  it("returns nothing for a day without sessions or without a selection", () => {
    assert.deepEqual(sessionsOnDay(list, "2026-11-27"), []);
    assert.deepEqual(sessionsOnDay(list, null), []);
  });

  it("lists a session once when two sources overlap, keeping the first copy", () => {
    const first = { ...s("a", "REQUESTED", at(2026, 11, 25, 9)), marker: "upcoming" };
    const second = { ...s("a", "REQUESTED", at(2026, 11, 25, 9)), marker: "contract" };
    const out = sessionsOnDay([first, second], "2026-11-25");
    assert.equal(out.length, 1);
    assert.equal(out[0].marker, "upcoming");
  });

  it("ignores rows without a usable start", () => {
    assert.deepEqual(sessionsOnDay([s("x", "REQUESTED", "garbage")], "2026-11-25"), []);
  });

  it("agrees with the calendar dots: a day is dotted exactly when sessionsOnDay is non-empty", () => {
    const dots = bookedDayKeys(list);
    for (const key of ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) {
      assert.equal(dots.has(key), sessionsOnDay(list, key).length > 0, key);
    }
  });
});

describe("bookedDayKeys", () => {
  it("skips cancelled sessions and sessions with no start", () => {
    const days = bookedDayKeys([
      s("a", "CANCELLED", at(2026, 11, 20, 9)),
      s("b", "COMPLETED", at(2026, 11, 21, 9)),
      { id: "c", status: "CONFIRMED" },
    ]);
    assert.deepEqual([...days], ["2026-11-21"]);
  });
});

describe("sessionTimeRange", () => {
  it("formats the local range as HH:mm–HH:mm", () => {
    assert.equal(sessionTimeRange(s("a", "REQUESTED", at(2026, 11, 25, 9), at(2026, 11, 25, 10))), "09:00–10:00");
    assert.equal(sessionTimeRange(s("a", "REQUESTED", at(2026, 11, 25, 17, 30), at(2026, 11, 25, 18, 15))), "17:30–18:15");
  });

  it("falls back to the start alone when the end is missing", () => {
    assert.equal(sessionTimeRange({ scheduledStartAt: at(2026, 11, 25, 9) }), "09:00");
  });

  it("is empty without a start", () => {
    assert.equal(sessionTimeRange({}), "");
  });
});

describe("sessionTabFor", () => {
  const now = new Date(2026, 10, 21, 12);
  it("routes by what the target tab actually lists", () => {
    assert.equal(sessionTabFor(s("a", "REQUESTED", at(2026, 11, 25, 9)), now), "upcoming");
    assert.equal(sessionTabFor(s("b", "CONFIRMED", at(2026, 11, 25, 9)), now), "upcoming");
    assert.equal(sessionTabFor(s("c", "PENDING_CLIENT_CONFIRMATION", at(2026, 11, 20, 9)), now), "confirm");
    assert.equal(sessionTabFor(s("d", "COMPLETED", at(2026, 11, 20, 9)), now), "past");
    assert.equal(sessionTabFor(s("e", "DISPUTED", at(2026, 11, 20, 9)), now), "past");
    assert.equal(sessionTabFor(s("f", "CONFIRMED", at(2026, 11, 20, 9)), now), "past");
  });
});
