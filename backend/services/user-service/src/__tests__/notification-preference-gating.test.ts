import test from "node:test";
import assert from "node:assert/strict";
import { notificationRepository } from "../repositories/notification.repository";
import { notificationService } from "../services/notification.service";

/**
 * Notification preferences are ONE account setting (NotificationPreference, user-service) that web and the mobile
 * app both read and write; the server honours it when a notification is CREATED, so a switched-off type
 * produces neither an in-app row, a socket push nor a phone push. TEST FIXTURE level (repository patched);
 * the real-DB version is notification-preferences-and-pt-feedback.integration.test.ts.
 */
const GATED: Array<[string, string]> = [
  ["WORKOUT_UPCOMING", "workoutUpcomingEnabled"],
  ["WORKOUT_RESCHEDULED", "workoutRescheduledEnabled"],
  ["WORKOUT_UNFINISHED", "workoutUnfinishedEnabled"],
  ["TRAINING_PLAN_UPDATED", "planUpdatedEnabled"],
  ["PT_FEEDBACK_RECEIVED", "ptFeedbackEnabled"],
];

function withPreference(row: Record<string, boolean> | null) {
  const original = notificationRepository.findPreference;
  (notificationRepository as any).findPreference = async () => row;
  return () => {
    (notificationRepository as any).findPreference = original;
  };
}

for (const [eventType, field] of GATED) {
  test(`${eventType} is NOT stored (so not pushed to web or phone) when ${field} is off, and is stored when it is on or unset`, async () => {
    const created: unknown[] = [];
    const tx = { notification: { create: async ({ data }: { data: unknown }) => (created.push(data), data) } };
    const input = { userId: "u1", text: "x", eventType, entityType: "WORKOUT_SCHEDULE", entityId: "e1" };

    let restore = withPreference({ [field]: false });
    try {
      assert.equal(await notificationService.createInTx(tx as any, input), null);
      assert.equal(created.length, 0, "an opted-out type must create no row");
    } finally {
      restore();
    }

    for (const row of [{ [field]: true }, null]) {
      restore = withPreference(row);
      try {
        assert.ok(await notificationService.createInTx(tx as any, input), "enabled (or no row yet) must store the notification");
      } finally {
        restore();
      }
    }
    assert.equal(created.length, 2);
  });
}

test("turning one type off leaves the other types untouched", async () => {
  const created: unknown[] = [];
  const tx = { notification: { create: async ({ data }: { data: unknown }) => (created.push(data), data) } };
  const restore = withPreference({ ptFeedbackEnabled: false, planUpdatedEnabled: true });
  try {
    assert.equal(await notificationService.createInTx(tx as any, { userId: "u1", text: "x", eventType: "PT_FEEDBACK_RECEIVED", entityType: "TRAINING_PROGRAM", entityId: "e" }), null);
    assert.ok(await notificationService.createInTx(tx as any, { userId: "u1", text: "x", eventType: "TRAINING_PLAN_UPDATED", entityType: "TRAINING_PROGRAM", entityId: "e" }));
  } finally {
    restore();
  }
});
