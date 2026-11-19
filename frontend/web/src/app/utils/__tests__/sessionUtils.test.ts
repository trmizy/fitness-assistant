/**
 * "Tham gia buổi học" window = the server's room window (opens 15 min before the start, closes at the end), or the
 * joinOpensAt / joinClosesAt the sessions endpoints return. Run: npx tsx --test src/app/utils/__tests__/sessionUtils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getJoinSessionState, roomOpensLabel } from "../sessionUtils";

const min = 60_000;
const start = Date.parse("2026-10-01T10:00:00Z");
const base = {
  sessionMode: "ONLINE",
  status: "CONFIRMED",
  scheduledStartAt: "2026-10-01T10:00:00Z",
  scheduledEndAt: "2026-10-01T11:00:00Z",
  clientUserId: "c1",
  ptUserId: "p1",
};

describe("getJoinSessionState", () => {
  it("default rule: not enabled 16 min before (with the opening time), enabled from 15 min before until the end", () => {
    const before = getJoinSessionState(base, "c1", start - 16 * min);
    assert.equal(before.enabled, false);
    assert.equal(before.reason, roomOpensLabel(start - 15 * min, start - 16 * min));
    assert.match(before.reason!, /^Mở phòng lúc [0-9]{2}:[0-9]{2}$/);
    assert.equal(getJoinSessionState(base, "c1", start - 15 * min).enabled, true);
    assert.equal(getJoinSessionState(base, "p1", start + 59 * min).enabled, true);
    const after = getJoinSessionState(base, "c1", start + 60 * min);
    assert.equal(after.enabled, false);
    assert.equal(after.reason, "Buổi học đã kết thúc");
  });

  it("uses the server's joinOpensAt / joinClosesAt when present", () => {
    const s = { ...base, joinOpensAt: "2026-10-01T09:55:00Z", joinClosesAt: "2026-10-01T10:50:00Z" };
    assert.equal(getJoinSessionState(s, "c1", start - 6 * min).enabled, false);
    assert.equal(getJoinSessionState(s, "c1", start - 5 * min).enabled, true);
    assert.equal(getJoinSessionState(s, "c1", start + 50 * min).enabled, false);
  });

  it("hidden unless ONLINE + CONFIRMED and the viewer belongs to the session", () => {
    assert.equal(getJoinSessionState({ ...base, sessionMode: "OFFLINE" }, "c1", start).visible, false);
    assert.equal(getJoinSessionState({ ...base, status: "PENDING" }, "c1", start).visible, false);
    assert.equal(getJoinSessionState(base, "stranger", start).visible, false);
    assert.equal(getJoinSessionState(null, "c1", start).visible, false);
  });

  it("names the day when the room opens on another day", () => {
    assert.match(roomOpensLabel(start - 15 * min, start - 3 * 24 * 60 * min), /^Mở phòng lúc [0-9]{2}:[0-9]{2} [0-9]{2}[/][0-9]{2}$/);
  });
});
