import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * The database side of notification-event-types-in-enum.test.ts: every event type the session
 * settlement / dispute / trainer-deactivation / trainer-application code sends must actually be
 * storable. Before migration 20261008010000 each of these inserts threw.
 *
 * Run with (from backend/services/user-service):
 *   DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_user_test" \
 *     npx tsx --test src/__tests__/notification-new-event-types.integration.test.ts
 */

const canUseIntegrationDb = /_test(\?|$)/i.test(process.env.DATABASE_URL ?? "");
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires DATABASE_URL pointing at a *_test database." };

const CASES: [eventType: string, entityType: string][] = [
  ["SESSION_PENDING_CONFIRMATION", "SESSION"],
  ["SESSION_AUTO_CONFIRMED", "SESSION"],
  ["SESSION_DISPUTED", "SESSION"],
  ["SESSION_DISPUTE_RESOLVED", "SESSION"],
  ["SESSION_PT_NO_SHOW_REPORTED", "SESSION"],
  ["CONTRACT_CANCELLED_PT_DEACTIVATED", "CONTRACT"],
  ["REFUND_NEEDS_MANUAL_SETTLEMENT", "CONTRACT"],
  ["PT_APPLICATION_REVIEWED", "PT_APPLICATION"],
];

test("every session-settlement / application-review notification type is stored", skipOpts, async () => {
  const { prisma } = await import("../repositories/profile.repository");
  const { notificationService } = await import("../services/notification.service");
  const userId = randomUUID();
  try {
    for (const [eventType, entityType] of CASES) {
      const row = await notificationService.create({ userId, text: `test ${eventType}`, eventType, entityType, entityId: randomUUID() });
      assert.equal(row?.eventType, eventType);
    }
    const stored = await prisma.notification.findMany({ where: { userId } });
    assert.deepEqual(stored.map((n) => n.eventType).sort(), CASES.map(([e]) => e).sort());
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  }
});
