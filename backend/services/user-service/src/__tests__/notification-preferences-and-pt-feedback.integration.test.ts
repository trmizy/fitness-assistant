import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { notificationService } from "../services/notification.service";
import { contractService } from "../services/contract.service";

/**
 * Roadmap P4.1 "Notifications/reminders" (§27) — preference controls +
 * PT feedback. Integration test (real dev DB), matching this service's
 * own established convention (no separate `_test` database gating).
 */

test("notificationService.create: respects an explicit opt-out for a gated event type, never creates a row", async () => {
  const userId = randomUUID();
  await prisma.notificationPreference.create({
    data: { userId, workoutUpcomingEnabled: false },
  });

  try {
    const result = await notificationService.create({
      userId,
      text: "Should not be created",
      eventType: "WORKOUT_UPCOMING",
      entityType: "WORKOUT_SCHEDULE",
      entityId: randomUUID(),
    });
    assert.equal(result, null);

    const rows = await prisma.notification.findMany({ where: { userId } });
    assert.equal(rows.length, 0);
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.notificationPreference.deleteMany({ where: { userId } });
  }
});

test("notificationService.create: a real row is created when no preference row exists (default = enabled)", async () => {
  const userId = randomUUID();
  try {
    const result = await notificationService.create({
      userId,
      text: "Real default-enabled notification",
      eventType: "WORKOUT_RESCHEDULED",
      entityType: "WORKOUT_SCHEDULE",
      entityId: randomUUID(),
    });
    assert.ok(result);
    const rows = await prisma.notification.findMany({ where: { userId } });
    assert.equal(rows.length, 1);
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
  }
});

test("notificationService.create: pre-existing CONTRACT_*/SESSION_* event types are never gated (unaffected by this pass)", async () => {
  const userId = randomUUID();
  // Explicitly disable everything this pass's preference model controls —
  // an unrelated, pre-existing event type must still go through.
  await prisma.notificationPreference.create({
    data: {
      userId,
      workoutUpcomingEnabled: false,
      workoutRescheduledEnabled: false,
      workoutUnfinishedEnabled: false,
      planUpdatedEnabled: false,
      ptFeedbackEnabled: false,
    },
  });
  try {
    const result = await notificationService.create({
      userId,
      text: "Contract accepted",
      eventType: "CONTRACT_ACCEPTED",
      entityType: "CONTRACT",
      entityId: randomUUID(),
    });
    assert.ok(result, "an unrelated event type must never be silently swallowed by this pass's new gate");
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.notificationPreference.deleteMany({ where: { userId } });
  }
});

test("notificationService.getPreferences/updatePreferences: real round trip", async () => {
  const userId = randomUUID();
  try {
    const initial = await notificationService.getPreferences(userId);
    assert.equal(initial.ptFeedbackEnabled, true, "no row yet -> every default is true");

    const updated = await notificationService.updatePreferences(userId, { ptFeedbackEnabled: false });
    assert.equal(updated.ptFeedbackEnabled, false);
    assert.equal(updated.workoutUpcomingEnabled, true, "an untouched field keeps its default");

    const reread = await notificationService.getPreferences(userId);
    assert.equal(reread.ptFeedbackEnabled, false);
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { userId } });
  }
});

async function makeActiveContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Test Package",
      totalSessions: 12,
      status: "ACTIVE",
      startDate: new Date(),
      ...overrides,
    },
  });
}

test("contractService.sendFeedback: the real PT on an ACTIVE contract can send feedback, creating a real listable notification for the client", async () => {
  const contract = await makeActiveContract();
  try {
    const { notification } = await contractService.sendFeedback(contract.id, contract.ptUserId, "Great progress this week!");
    assert.ok(notification);
    assert.equal((notification as any).userId, contract.clientUserId);
    assert.equal((notification as any).eventType, "PT_FEEDBACK_RECEIVED");
    assert.ok((notification as any).text.includes("Great progress this week!"));

    const rows = await prisma.notification.findMany({ where: { userId: contract.clientUserId } });
    assert.equal(rows.length, 1);
  } finally {
    await prisma.notification.deleteMany({ where: { userId: contract.clientUserId } });
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});

test("contractService.sendFeedback: rejects a caller who is not the contract's real PT", async () => {
  const contract = await makeActiveContract();
  try {
    await assert.rejects(
      () => contractService.sendFeedback(contract.id, randomUUID(), "Impersonation attempt"),
      (err: any) => err.status === 403,
    );
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});

test("contractService.sendFeedback: rejects a non-ACTIVE contract", async () => {
  const contract = await makeActiveContract({ status: "PENDING_PAYMENT" });
  try {
    await assert.rejects(
      () => contractService.sendFeedback(contract.id, contract.ptUserId, "Too early"),
      (err: any) => err.status === 409,
    );
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});

test("contractService.sendFeedback: rejects empty feedback text", async () => {
  const contract = await makeActiveContract();
  try {
    await assert.rejects(
      () => contractService.sendFeedback(contract.id, contract.ptUserId, "   "),
      (err: any) => err.status === 400,
    );
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});
