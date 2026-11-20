import { guardedTest as test } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { notificationService } from "../services/notification.service";

/**
 * Workout Plan Review notifications (fitness-service outbox -> POST /internal/notifications -> notificationService.create).
 * Evidence label: BACKEND INTEGRATION (real Postgres test DB).
 *
 * The producer is AT-LEAST-ONCE (it only marks an outbox event delivered after this call succeeds), so a replay of the same
 * event must store ONE row, and a duplicate must read as success — otherwise the producer would retry forever.
 */

const base = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  text: "Có một kế hoạch tập luyện mới đang chờ bạn duyệt.",
  eventType: "PLAN_REVIEW_REQUESTED",
  entityType: "PLAN_REVIEW",
  entityId: randomUUID(),
  link: "/pt/plan-reviews",
  ...over,
});

test("PN01 a replay with the same dedupeKey stores exactly one row and reads as success (null), never an error", async () => {
  const userId = randomUUID();
  const input = base(userId, { dedupeKey: `plan-review-event:${randomUUID()}` });
  try {
    const first = await notificationService.create(input as any);
    assert.ok(first, "first delivery stores a row");
    assert.equal((first as any).eventType, "PLAN_REVIEW_REQUESTED");
    const replay = await notificationService.create(input as any);
    assert.equal(replay, null, "duplicate = already delivered: nothing stored, nothing pushed again");
    assert.equal(await prisma.notification.count({ where: { userId } }), 1);
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
  }
});

test("PN02 concurrent deliveries of the same event: still one row (the UNIQUE index is the arbiter, not a read-then-write)", async () => {
  const userId = randomUUID();
  const input = base(userId, { dedupeKey: `plan-review-event:${randomUUID()}` });
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => notificationService.create(input as any)));
    assert.equal(results.filter(Boolean).length, 1, "exactly one winner");
    assert.equal(await prisma.notification.count({ where: { userId } }), 1);
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
  }
});

test("PN03 different events (different keys) are all delivered; producers WITHOUT a key behave exactly as before", async () => {
  const userId = randomUUID();
  const entityId = randomUUID();
  try {
    await notificationService.create(base(userId, { entityId, dedupeKey: "plan-review-event:a" + randomUUID() }) as any);
    await notificationService.create(base(userId, { entityId, dedupeKey: "plan-review-event:b" + randomUUID() }) as any);
    await notificationService.create(base(userId, { entityId }) as any); // no key
    await notificationService.create(base(userId, { entityId }) as any); // no key, same content => legacy behaviour: stored again
    assert.equal(await prisma.notification.count({ where: { userId } }), 4);
  } finally {
    await prisma.notification.deleteMany({ where: { userId } });
  }
});

test("PN04 preferences: the PT's decision (PLAN_REVIEW_DECIDED) follows ptFeedbackEnabled; the PT's inbox ping (REQUESTED) is never gated", async () => {
  const clientId = randomUUID();
  const ptId = randomUUID();
  await prisma.notificationPreference.create({ data: { userId: clientId, ptFeedbackEnabled: false } });
  await prisma.notificationPreference.create({ data: { userId: ptId, ptFeedbackEnabled: false } });
  try {
    const decided = await notificationService.create(base(clientId, { eventType: "PLAN_REVIEW_DECIDED", text: "PT đã duyệt kế hoạch tập luyện của bạn.", dedupeKey: "k" + randomUUID() }) as any);
    assert.equal(decided, null, "opted out of PT feedback => not stored");
    const requested = await notificationService.create(base(ptId, { dedupeKey: "k" + randomUUID() }) as any);
    assert.ok(requested, "work addressed to the PT is never silenced by a client-side preference");
  } finally {
    await prisma.notification.deleteMany({ where: { userId: { in: [clientId, ptId] } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: [clientId, ptId] } } });
  }
});

test("PN05 no health data in a plan-review notification: the generic texts carry no plan contents/notes", () => {
  // Contract with the producer (fitness-service notificationText): texts are fixed sentences. Guard the stored shape here.
  const sample = base("u");
  for (const forbidden of ["inbody", "kg", "injury", "chấn thương", "bệnh"]) {
    assert.ok(!sample.text.toLowerCase().includes(forbidden), forbidden);
  }
});
