import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { bookingService } from "../services/booking.service";

/**
 * Money-flow redesign plan item 3.3 — "giao diện dời lịch dùng trạng thái không tồn tại".
 *
 * `BookingPage.tsx` gated the accept/reject buttons on `s.status === "RESCHEDULE_PENDING"` — a
 * status the backend never sets (it deliberately keeps a session CONFIRMED while a proposal is
 * pending, per booking.service.ts's own comment). Fixing only that dead check would still leave
 * the buttons broken: `getMyUpcoming`'s underlying query never included `rescheduleRequests` at
 * all, so `s.rescheduleRequests` was always `undefined` regardless of the status check. Both
 * had to be fixed together.
 *
 * Integration test (real dev DB) — the fix is a Prisma `include`, best verified against a real
 * row rather than re-asserting a mock's own configuration.
 */

async function makeContract(ptUserId: string, clientUserId: string) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId,
      clientUserId,
      packageName: "Test Package",
      totalSessions: 10,
      status: "ACTIVE",
    },
  });
}

async function makeConfirmedSession(contractId: string, ptUserId: string, clientUserId: string, startAt: Date) {
  return prisma.session.create({
    data: {
      id: randomUUID(),
      contractId,
      ptUserId,
      clientUserId,
      status: "CONFIRMED",
      scheduledStartAt: startAt,
      scheduledEndAt: new Date(startAt.getTime() + 60 * 60 * 1000),
    },
  });
}

test("getMyUpcoming attaches the session's pending reschedule request", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const contract = await makeContract(ptUserId, clientUserId);
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const session = await makeConfirmedSession(contract.id, ptUserId, clientUserId, startAt);
  const proposedStart = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
  const request = await prisma.sessionRescheduleRequest.create({
    data: {
      id: randomUUID(),
      sessionId: session.id,
      requestedBy: "PT",
      originalStartAt: startAt,
      originalEndAt: session.scheduledEndAt,
      proposedStartAt: proposedStart,
      proposedEndAt: new Date(proposedStart.getTime() + 60 * 60 * 1000),
      reason: "Lịch bận đột xuất",
      status: "PENDING",
    },
  });

  try {
    const upcoming = await bookingService.getMyUpcoming(clientUserId);
    const found = upcoming.find((s: any) => s.id === session.id);

    assert.ok(found, "the session must appear in the upcoming list");
    assert.ok(Array.isArray((found as any).rescheduleRequests), "rescheduleRequests must be attached, not undefined");
    assert.equal((found as any).rescheduleRequests.length, 1);
    assert.equal((found as any).rescheduleRequests[0].id, request.id);
    assert.equal((found as any).rescheduleRequests[0].requestedBy, "PT");

    // The session's own status is UNCHANGED — still CONFIRMED, never "RESCHEDULE_PENDING"
    // (that status does not exist). The frontend must gate on rescheduleRequests, not status.
    assert.equal((found as any).status, "CONFIRMED");
  } finally {
    await prisma.sessionRescheduleRequest.delete({ where: { id: request.id } }).catch(() => {});
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("a session with no reschedule request gets an empty array, not undefined", async () => {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const contract = await makeContract(ptUserId, clientUserId);
  const session = await makeConfirmedSession(contract.id, ptUserId, clientUserId, new Date(Date.now() + 48 * 60 * 60 * 1000));

  try {
    const upcoming = await bookingService.getMyUpcoming(clientUserId);
    const found = upcoming.find((s: any) => s.id === session.id);

    assert.ok(found);
    assert.deepEqual((found as any).rescheduleRequests, []);
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});
