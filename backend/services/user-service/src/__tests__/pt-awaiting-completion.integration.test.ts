import { guardedTest as test } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { bookingService } from "../services/booking.service";

/**
 * N15B-06 (BACKEND INTEGRATION): a CONFIRMED session whose end has passed is dropped from getMyUpcoming (end >= now), so the PT's
 * schedule could not show it and "Hoàn thành" was only reachable from the contract page. listAwaitingCompletionForPT returns exactly
 * those sessions - and only for the PT, only CONFIRMED, only past the end, only on a running contract.
 */

const H = 60 * 60 * 1000;

async function makeContract(ptUserId: string, clientUserId: string, status: "ACTIVE" | "COMPLETED" = "ACTIVE") {
  return prisma.contract.create({
    data: { id: randomUUID(), ptUserId, clientUserId, packageName: "Gói thử", totalSessions: 10, status },
  });
}

async function makeSession(contractId: string, ptUserId: string, clientUserId: string, status: "CONFIRMED" | "REQUESTED" | "COMPLETED", startOffsetMs: number) {
  const start = new Date(Date.now() + startOffsetMs);
  return prisma.session.create({
    data: { id: randomUUID(), contractId, ptUserId, clientUserId, status, scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + H) },
  });
}

test("a CONFIRMED session whose end passed is listed for its PT (and is not in the upcoming list)", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  const contract = await makeContract(pt, client);
  const past = await makeSession(contract.id, pt, client, "CONFIRMED", -5 * H);
  const running = await makeSession(contract.id, pt, client, "CONFIRMED", -30 * 60 * 1000); // started 30 min ago, still running
  const future = await makeSession(contract.id, pt, client, "CONFIRMED", 24 * H);
  const requested = await makeSession(contract.id, pt, client, "REQUESTED", -5 * H);
  const done = await makeSession(contract.id, pt, client, "COMPLETED", -6 * H);
  try {
    const awaiting = await bookingService.listAwaitingCompletionForPT(pt);
    assert.deepEqual(awaiting.map((s) => s.id), [past.id], "only the over-and-still-CONFIRMED session");
    const upcoming = await bookingService.getMyUpcoming(pt);
    assert.ok(!upcoming.some((s: any) => s.id === past.id), "it is NOT in the upcoming list - that is the bug being closed");
    assert.ok(upcoming.some((s: any) => s.id === running.id) && upcoming.some((s: any) => s.id === future.id));
    assert.ok(!awaiting.some((s) => [running.id, future.id, requested.id, done.id].includes(s.id)));
  } finally {
    await prisma.session.deleteMany({ where: { contractId: contract.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("another PT, the client and a contract that is no longer running do not get the session", async () => {
  const pt = randomUUID();
  const client = randomUUID();
  const live = await makeContract(pt, client);
  const ended = await makeContract(pt, client, "COMPLETED");
  const mine = await makeSession(live.id, pt, client, "CONFIRMED", -5 * H);
  const onEnded = await makeSession(ended.id, pt, client, "CONFIRMED", -5 * H);
  try {
    assert.deepEqual((await bookingService.listAwaitingCompletionForPT(randomUUID())).length, 0, "another PT sees nothing");
    assert.deepEqual((await bookingService.listAwaitingCompletionForPT(client)).length, 0, "the client is not the PT");
    const ids = (await bookingService.listAwaitingCompletionForPT(pt)).map((s) => s.id);
    assert.deepEqual(ids, [mine.id]);
    assert.ok(!ids.includes(onEnded.id), "completeSession refuses a session of an ended contract, so it is not offered");
  } finally {
    await prisma.session.deleteMany({ where: { contractId: { in: [live.id, ended.id] } } }).catch(() => {});
    await prisma.contract.deleteMany({ where: { id: { in: [live.id, ended.id] } } }).catch(() => {});
  }
});
