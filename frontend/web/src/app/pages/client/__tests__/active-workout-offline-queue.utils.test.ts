import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortWorkoutEventsChronologically,
  buildQueuedSetEvent,
  type QueuedWorkoutEvent,
} from "../active-workout-offline-queue.utils";

describe("sortWorkoutEventsChronologically", () => {
  it("orders oldest first regardless of input order", () => {
    const events: QueuedWorkoutEvent[] = [
      { eventId: "c", type: "SET_COMPLETED", createdAt: 300, method: "PATCH", url: "/x", body: {} },
      { eventId: "a", type: "SET_COMPLETED", createdAt: 100, method: "PATCH", url: "/x", body: {} },
      { eventId: "b", type: "SET_COMPLETED", createdAt: 200, method: "PATCH", url: "/x", body: {} },
    ];
    const sorted = sortWorkoutEventsChronologically(events);
    assert.deepEqual(sorted.map((e) => e.eventId), ["a", "b", "c"]);
  });

  it("never mutates the input array", () => {
    const events: QueuedWorkoutEvent[] = [
      { eventId: "b", type: "SET_COMPLETED", createdAt: 200, method: "PATCH", url: "/x", body: {} },
      { eventId: "a", type: "SET_COMPLETED", createdAt: 100, method: "PATCH", url: "/x", body: {} },
    ];
    const originalOrder = events.map((e) => e.eventId);
    sortWorkoutEventsChronologically(events);
    assert.deepEqual(events.map((e) => e.eventId), originalOrder);
  });

  it("empty queue sorts to an empty array", () => {
    assert.deepEqual(sortWorkoutEventsChronologically([]), []);
  });
});

describe("buildQueuedSetEvent", () => {
  it("builds the correct PATCH request shape, with eventId inside the body", () => {
    const event = buildQueuedSetEvent({
      eventId: "evt-1",
      setId: "set-42",
      type: "SET_COMPLETED",
      patch: { weight: 60, reps: 8, completed: true },
      now: 12345,
    });
    assert.equal(event.eventId, "evt-1");
    assert.equal(event.type, "SET_COMPLETED");
    assert.equal(event.createdAt, 12345);
    assert.equal(event.method, "PATCH");
    assert.equal(event.url, "/workouts/sets/set-42");
    assert.deepEqual(event.body, { weight: 60, reps: 8, completed: true, eventId: "evt-1" });
  });

  it("defaults createdAt to the current time when not given", () => {
    const before = Date.now();
    const event = buildQueuedSetEvent({
      eventId: "evt-2",
      setId: "set-1",
      type: "SET_UNDONE",
      patch: { completed: false },
    });
    const after = Date.now();
    assert.ok(event.createdAt >= before && event.createdAt <= after);
  });

  it("a caller-supplied eventId key in patch is overridden by the real eventId (never trusts the patch's own value)", () => {
    const event = buildQueuedSetEvent({
      eventId: "real-id",
      setId: "set-1",
      type: "SET_COMPLETED",
      patch: { eventId: "spoofed-id", weight: 50 },
    });
    assert.equal(event.body.eventId, "real-id");
  });
});
