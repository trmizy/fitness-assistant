/**
 * The client's own sessions on a calendar day (pure). TEST FIXTURE - no device run.
 * Local-time constructors on purpose: days are keyed by the device's local date, so the tests hold in any TZ.
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/daySessions.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sessionTimeRange, sessionsOnDay } from "../services/daySessions";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const s = (id: string, status: string, startAt: string | null, endAt: string | null = null) => ({ id, status, startAt, endAt });

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

  it("returns nothing for an empty day or no selection", () => {
    assert.deepEqual(sessionsOnDay(list, "2026-11-27"), []);
    assert.deepEqual(sessionsOnDay(list, null), []);
  });

  it("lists a session once when sources overlap", () => {
    const dup = [s("a", "REQUESTED", at(2026, 11, 25, 9)), s("a", "REQUESTED", at(2026, 11, 25, 9))];
    assert.equal(sessionsOnDay(dup, "2026-11-25").length, 1);
  });

  it("ignores rows without a usable start", () => {
    assert.deepEqual(sessionsOnDay([s("x", "REQUESTED", null), s("y", "REQUESTED", "garbage")], "2026-11-25"), []);
  });

  it("a late-evening session stays on its own local day", () => {
    const rows = [s("n", "CONFIRMED", at(2026, 11, 25, 23, 30))];
    assert.equal(sessionsOnDay(rows, "2026-11-25").length, 1);
    assert.equal(sessionsOnDay(rows, "2026-11-26").length, 0);
  });
});

describe("sessionTimeRange", () => {
  it("formats HH:mm–HH:mm, start alone without an end, empty without a start", () => {
    assert.equal(sessionTimeRange(s("a", "REQUESTED", at(2026, 11, 25, 9), at(2026, 11, 25, 10))), "09:00–10:00");
    assert.equal(sessionTimeRange(s("a", "REQUESTED", at(2026, 11, 25, 9))), "09:00");
    assert.equal(sessionTimeRange(s("a", "REQUESTED", null)), "");
  });
});
