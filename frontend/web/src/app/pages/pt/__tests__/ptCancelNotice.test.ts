/**
 * PT cancel / block-day confirm copy (owner decision 20/11/2026, no 24-hour grace). Pure, no browser.
 * Chạy: npx tsx --test src/app/pages/pt/__tests__/ptCancelNotice.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { confirmedSessionsOnDate, ptBlockDayNotice, ptCancelNotice } from "../ptCancelNotice";

describe("ptCancelNotice", () => {
  it("warns about the cash compensation for a CONFIRMED session", () => {
    const t = ptCancelNotice("CONFIRMED", "An");
    assert.match(t, /bồi thường cho học viên 1 buổi bằng tiền/);
    assert.match(t, /Buổi với An/);
    assert.doesNotMatch(t, /24/);
  });
  it("says nothing about compensation for a REQUESTED session", () => {
    const t = ptCancelNotice("REQUESTED", "An");
    assert.doesNotMatch(t, /bồi thường/);
    assert.match(t, /Buổi với An/);
  });
});

describe("block-day confirm", () => {
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
  const list = [
    { status: "CONFIRMED", scheduledStartAt: at(25, 9) },
    { status: "CONFIRMED", scheduledStartAt: at(25, 17) },
    { status: "REQUESTED", scheduledStartAt: at(25, 12) },
    { status: "CONFIRMED", scheduledStartAt: at(26, 9) },
  ];
  it("counts only CONFIRMED sessions on the local day", () => {
    assert.equal(confirmedSessionsOnDate(list, "2026-11-25"), 2);
    assert.equal(confirmedSessionsOnDate(list, "2026-11-27"), 0);
    assert.equal(confirmedSessionsOnDate(list, ""), 0);
  });
  it("includes the count and the compensation notice", () => {
    assert.match(ptBlockDayNotice(2), /2 buổi đã xác nhận.*bồi thường/);
  });
});
