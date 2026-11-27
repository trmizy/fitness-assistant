/**
 * pickNextPtSession (pure). TEST FIXTURE - no device run.
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/nextPtSession.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickNextPtSession } from "../services/nextPtSession";

const at = (d: number, h: number, min = 0) => new Date(2026, 10, d, h, min).toISOString();
const s = (id: string, status: string, startAt: string | null, endAt: string | null) => ({ id, status, startAt, endAt });
const now = new Date(2026, 10, 21, 10, 0);

describe("pickNextPtSession", () => {
  it("returns null for empty / non-array input", () => {
    assert.equal(pickNextPtSession([], now), null);
    assert.equal(pickNextPtSession(null, now), null);
    assert.equal(pickNextPtSession(undefined, now), null);
  });

  it("ignores statuses other than REQUESTED / CONFIRMED / PENDING_CLIENT_CONFIRMATION", () => {
    const list = [
      s("a", "CANCELLED", at(22, 9), at(22, 10)),
      s("b", "COMPLETED", at(22, 9), at(22, 10)),
      s("c", "NO_SHOW", at(22, 9), at(22, 10)),
      s("d", "DISPUTED", at(22, 9), at(22, 10)),
    ];
    assert.equal(pickNextPtSession(list, now), null);
  });

  it("picks the earliest upcoming one regardless of input order", () => {
    const list = [
      s("late", "CONFIRMED", at(25, 9), at(25, 10)),
      s("early", "REQUESTED", at(22, 9), at(22, 10)),
      s("mid", "PENDING_CLIENT_CONFIRMATION", at(23, 9), at(23, 10)),
    ];
    assert.equal(pickNextPtSession(list, now)?.id, "early");
  });

  it("drops sessions that already ended but keeps one still running today", () => {
    const list = [
      s("past", "CONFIRMED", at(21, 7), at(21, 8)),
      s("running", "CONFIRMED", at(21, 9, 30), at(21, 10, 30)),
      s("later", "CONFIRMED", at(21, 18), at(21, 19)),
    ];
    assert.equal(pickNextPtSession(list, now)?.id, "running");
    assert.equal(pickNextPtSession([list[0]], now), null);
  });

  it("skips rows without a usable start time", () => {
    const list = [s("x", "CONFIRMED", null, null), s("y", "CONFIRMED", "garbage", null), s("z", "CONFIRMED", at(22, 9), null)];
    assert.equal(pickNextPtSession(list, now)?.id, "z");
  });
});
