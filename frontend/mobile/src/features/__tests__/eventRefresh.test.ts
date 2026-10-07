import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { queryKeysForEvent } from "../notifications/eventRefresh";

const has = (keys: string[][], name: string) => keys.some((k) => k[0] === name);

describe("queryKeysForEvent", () => {
  // Regression (real phone, 7/10): the trainer's phone announced a new coaching request while
  // Hợp đồng and Tổng quan kept showing none until pulled to refresh.
  it("a contract event refreshes the contract lists on both sides, and the bell", () => {
    const keys = queryKeysForEvent("CONTRACT_REQUESTED", "CONTRACT");
    for (const name of ["pt-contracts", "pt-earnings", "client-contracts", "notifications", "notifications-unread"]) {
      assert.ok(has(keys, name), name);
    }
  });

  it("a session event refreshes session lists and the contracts whose counts it moves", () => {
    const keys = queryKeysForEvent("SESSION_BOOKED", "SESSION");
    for (const name of ["pt-sessions-upcoming", "sessions-upcoming", "sessions-pending-confirmation", "pt-contracts", "client-contracts"]) {
      assert.ok(has(keys, name), name);
    }
  });

  it("a PT application result refreshes the applicant's status screen", () => {
    assert.ok(has(queryKeysForEvent("PT_APPLICATION_REVIEWED", "PT_APPLICATION"), "pt-application-me"));
  });

  it("falls back to the entity when the event name is missing, and to the bell alone when unknown", () => {
    assert.ok(has(queryKeysForEvent(null, "CONTRACT"), "pt-contracts"));
    assert.ok(has(queryKeysForEvent(undefined, "SESSION"), "sessions-upcoming"));
    assert.deepEqual(queryKeysForEvent("WORKOUT_UPCOMING", "WORKOUT_SCHEDULE"), [["notifications"], ["notifications-unread"]]);
    assert.deepEqual(queryKeysForEvent(null, null), [["notifications"], ["notifications-unread"]]);
  });
});
