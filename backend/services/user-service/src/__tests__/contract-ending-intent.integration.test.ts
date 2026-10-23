/**
 * Phase 0 / D58 + D59 (units 2 and 3) - the DURABLE TERMINATION INTENT and the 409 CONTRACT_ENDING block.
 *
 * What is proved here (each test says which):
 *   1. the accepted ending (reason, who/why text) is RECORDED before the payment-service call; while payment-service has not
 *      confirmed it the contract is ENDING: it is never reported as ended, and EVERY money-changing action on it answers
 *      409 CONTRACT_ENDING (book, PT confirms, report done, client confirms, auto-confirm, no-show / late flows, late cancel,
 *      date block, room-close, admin ruling, release) - refused, never queued - while reads keep working;
 *   2. retries and other callers carry on with the SAME recorded reason and the SAME key; the terminate body is identical on
 *      every attempt (nothing is recomputed);
 *   3. a contract is never stuck: the settlement sweep completes the ending when payment-service is back, attempts are counted,
 *      and past the attention threshold it shows up in the "needs a human" query - it keeps being retried;
 *   4. payment-service answering something else than what was recorded is a CONFLICT: parked, not written over, not retried,
 *      the contract stays ENDING for a human;
 *   5. unpaid contracts (nothing to move) are untouched by all of this.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database (real locks, real SQL, real sweep). payment-service
 * is replaced at the paymentClient boundary (TEST FIXTURE) - the same flows against the REAL ledger are in
 * cross-service-money-timeout-faults.e2e.test.ts and cross-service-money-restart-recovery.e2e.test.ts. Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/contract-ending-intent.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { bookingService } from "../services/booking.service";
import { availabilityService } from "../services/availability.service";
import { contractService } from "../services/contract.service";
import { settleContractTermination, terminateContractMoney } from "../services/contract-payout.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { runRoomCloseResolution } from "../services/room-close-resolution.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs, type Stubs } from "./pt-restriction.test-helpers";

const ADMIN = "admin-ending-intent";
const DOWN = new Error("payment-service down");

function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

/** A paid contract whose ending is RECORDED but not confirmed: payment-service is down for the first attempt. */
async function endingContract(opts: { held?: boolean } = {}) {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  // held states exist BEFORE the first attempt (they cannot appear while the ending is recorded: the actions that create them are refused)
  const pending = opts.held ? await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 2 * DAY), { clientConfirmDeadline: new Date(Date.now() - HOUR) }) : null;
  const disputed = opts.held ? await addSession(c, "DISPUTED", new Date(Date.now() - 3 * DAY), { disputeReason: "x", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" }) : null;
  const s = stubs();
  let down = true;
  const terminateBodies: any[] = [];
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    terminateBodies.push(body);
    s.payments.push({ method: "terminate", body });
    if (down) throw DOWN;
    return { reason: body.reason, refund: "3600000.00", ...(body.unresolvedSessions > 0 ? { unresolved: { sessions: body.unresolvedSessions } } : {}) };
  });
  const first = await terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId, cancellationReason: "bận việc" }).then(
    () => null,
    (e) => e,
  );
  return {
    pt,
    c,
    pending,
    disputed,
    first,
    s,
    terminateBodies,
    payUp: () => {
      down = false;
    },
    payDown: () => {
      down = true;
    },
    restore: () => {
      restoreTerminate();
      s.restore();
    },
  };
}

const intentRow = (contractId: string) => prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${contractId}` } });
const refusedEnding = (p: Promise<unknown>, what: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.status, 409, `${what}: ${e.message}`);
    assert.equal(e.code, "CONTRACT_ENDING", what);
    return true;
  });

test("1. an accepted ending is RECORDED before the money call: payment-service down -> 409 CONTRACT_ENDING, the contract is NOT reported ended, the intent row carries the reason and the who/why text", { skip }, async () => {
  const E = await endingContract();
  try {
    assert.ok(E.first, "the caller is told the ending is not confirmed");
    assert.equal(E.first.status, 409);
    assert.equal(E.first.code, "CONTRACT_ENDING");
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: E.c.id } });
    assert.deepEqual([c.status, c.terminationReason, c.terminatedAt], ["ACTIVE", null, null], "never 'ended' while the money is unconfirmed");
    assert.deepEqual([c.cancelledBy, c.cancellationReason], [E.c.clientUserId, "bận việc"], "the who/why text was recorded with the ending");
    const row = await intentRow(E.c.id);
    assert.deepEqual([row.kind, row.reason, row.status, row.attempts], ["CONTRACT_TERMINATION", "CLIENT_CANCELLED", "FAILED", 1]);
    assert.match(row.lastError ?? "", /payment-service down/);
  } finally {
    E.restore();
    await cleanup([E.pt], [E.c.id]);
  }
});

test("2. EVERY money-changing action on an ENDING contract answers 409 CONTRACT_ENDING and changes nothing (book, PT confirm, report done, client confirm, no-show, late cancel, report / answer a no-show, admin ruling); reads keep working", { skip }, async () => {
  const E = await endingContract({ held: true });
  const { c, pt } = E;
  const slotDay = new Date(Date.now() + 3 * DAY);
  try {
    // availability so that a booking would pass every pre-check and reach the lock
    await prisma.pTAvailability.create({ data: { ptUserId: pt, dayOfWeek: DAYS[slotDay.getDay()] as any, startTime: "06:00", endTime: "22:00", isActive: true } });
    // sessions an action could target (REQUESTED / CONFIRMED ones are created AFTER the recording - fixtures; the ending's retry calls them off)
    const requested = await addSession(c, "REQUESTED", new Date(Date.now() + 5 * DAY));
    const confirmedPast = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
    const confirmedSoon = await addSession(c, "CONFIRMED", new Date(Date.now() + 2 * HOUR));
    const reported = await addSession(c, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * DAY), { disputeReason: "PT không đến" });
    const before = {
      sessions: (await prisma.session.findMany({ where: { contractId: c.id }, orderBy: { id: "asc" } })).map((x) => [x.id, x.status, x.sessionDeducted]),
      contract: await prisma.contract.findUniqueOrThrow({ where: { id: c.id } }),
      rows: await prisma.sessionSettlement.count({ where: { contractId: c.id } }),
      payments: E.s.payments.length,
    };

    const hhmm = "10:00";
    await refusedEnding(bookingService.bookSession(c.clientUserId, c.id, { scheduledDate: localDay(slotDay), scheduledTime: hhmm }), "book");
    await refusedEnding(bookingService.confirmSession(requested.id, pt), "PT confirms a request");
    await refusedEnding(bookingService.completeSession(confirmedPast.id, pt, "ok"), "PT reports done");
    await refusedEnding(bookingService.clientConfirmSession(E.pending!.id, c.clientUserId), "client confirms");
    await refusedEnding(bookingService.markNoShow(confirmedPast.id, pt, "PT"), "PT admits no-show");
    await refusedEnding(bookingService.markNoShow(confirmedPast.id, pt, "CLIENT"), "PT reports a client no-show");
    await refusedEnding(bookingService.cancelSession(confirmedSoon.id, c.clientUserId, "bận"), "client late cancel");
    await refusedEnding(bookingService.cancelSession(confirmedSoon.id, pt, "bận"), "PT late cancel");
    await refusedEnding(bookingService.reportPtNoShow(confirmedPast.id, c.clientUserId, "PT vắng"), "client reports a PT no-show");
    await refusedEnding(bookingService.respondToNoShowReport(reported.id, pt, "AGREE"), "PT agrees to a no-show report");
    await refusedEnding(bookingService.respondToNoShowReport(reported.id, pt, "DENY"), "PT denies a no-show report");
    await refusedEnding(bookingService.resolveDispute(E.disputed!.id, ADMIN, "COMPLETED", "đã dạy"), "admin rules COMPLETED");
    await refusedEnding(bookingService.resolveDispute(E.disputed!.id, ADMIN, "CANCELLED", "không diễn ra"), "admin rules CANCELLED");
    await refusedEnding(bookingService.resolveDispute(E.disputed!.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng"), "admin rules PT no-show");

    // sweeps and the date block do not error: they leave the ending's sessions to the ending
    const block = await availabilityService.addException(pt, localDay(new Date(confirmedSoon.scheduledStartAt)), "bận");
    assert.equal(block.affectedSessions >= 0, true);
    await runAutoConfirm(); // (other suites' leftovers in a shared test database may be confirmed by this tick; only OUR contract is asserted below)
    await prisma.session.update({ where: { id: confirmedPast.id }, data: { sessionMode: "ONLINE", roomClientJoinedAt: new Date(Date.now() - 2 * DAY) } });
    await runRoomCloseResolution();

    // nothing moved
    const after = {
      sessions: (await prisma.session.findMany({ where: { contractId: c.id }, orderBy: { id: "asc" } })).map((x) => [x.id, x.status, x.sessionDeducted]),
      contract: await prisma.contract.findUniqueOrThrow({ where: { id: c.id } }),
      rows: await prisma.sessionSettlement.count({ where: { contractId: c.id } }),
      payments: E.s.payments.length,
    };
    assert.deepEqual(after.sessions, before.sessions, "no session changed state");
    assert.deepEqual([after.contract.usedSessions, after.contract.compensatedSessions, after.contract.status], [2, 0, "ACTIVE"]);
    assert.equal(after.rows, before.rows, "no money intent was created");
    assert.deepEqual(E.s.payments.filter((p) => p.method !== "terminate"), [], "no release / compensation call of any kind");

    // reads keep working
    const sessions = await bookingService.getContractSessions(c.id, c.clientUserId);
    assert.ok(sessions.length >= 6);
    assert.ok(await contractService.getById(c.id));
  } finally {
    E.restore();
    await prisma.pTAvailability.deleteMany({ where: { ptUserId: pt } });
    await prisma.pTScheduleException.deleteMany({ where: { ptUserId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("3. the retry - and ANY other caller - carries on with the RECORDED ending: the same reason and key, an identical terminate body, nothing recomputed; the who/why text survives; the notices are not repeated", { skip }, async () => {
  const E = await endingContract({ held: true });
  try {
    E.payUp();
    // somebody else asks for a DIFFERENT reason (an admin MUTUAL, the expiry sweep EXPIRED): they get the recorded ending, not a re-pricing
    const done = await settleContractTermination(E.c.id, "MUTUAL");
    assert.ok(done);
    assert.equal(done.reason, "CLIENT_CANCELLED", "the recorded reason is reported");
    assert.equal(done.statusWritten, true);
    assert.equal(E.terminateBodies.length, 2);
    assert.deepEqual(E.terminateBodies[1], E.terminateBodies[0], "the second attempt sends exactly what the first one did (same reason, counters, held count, key)");
    assert.equal(E.terminateBodies[0].reason, "CLIENT_CANCELLED");
    assert.equal(E.terminateBodies[0].idempotencyKey, `CONTRACT_TERMINATE:${E.c.id}`);
    assert.equal(E.terminateBodies[0].unresolvedSessions, 2);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: E.c.id } });
    assert.deepEqual([c.status, c.terminationReason, c.cancelledBy, c.cancellationReason], ["CANCELLED", "CLIENT_CANCELLED", E.c.clientUserId, "bận việc"]);
    assert.equal((await intentRow(E.c.id)).status, "SETTLED");

    // and a further call replays: status untouched, no second write
    const again = await settleContractTermination(E.c.id, "EXPIRED");
    assert.equal(again!.statusWritten, false);
    assert.equal(again!.reason, "CLIENT_CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: E.c.id } })).terminationReason, "CLIENT_CANCELLED");
  } finally {
    E.restore();
    await cleanup([E.pt], [E.c.id]);
  }
});

test("4. a contract is never stuck: the settlement sweep completes the recorded ending as soon as payment-service is back; every failed attempt is counted and, past the threshold, the ending shows in the 'needs a human' query while it KEEPS being retried", { skip }, async () => {
  const E = await endingContract();
  process.env.SETTLEMENT_BACKOFF_BASE_MS = "0";
  try {
    for (let i = 0; i < 5; i++) await runSettlementSweep();
    const stuck = await intentRow(E.c.id);
    assert.equal(stuck.status, "FAILED");
    assert.ok(stuck.attempts >= 5, `attempts are counted (${stuck.attempts})`);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: E.c.id } })).status, "ACTIVE");
    const attention = await sessionSettlementRepository.findNeedingAttention(5);
    assert.ok(attention.some((r) => r.id === stuck.id), "visible to a human once it has failed 5 times (the threshold is a parameter of the query)");
    assert.ok(!/^(NEEDS_RECONCILIATION|CONFLICT):/.test(stuck.lastError ?? ""), "but it is NOT parked: a termination keeps being retried");

    E.payUp();
    await runSettlementSweep();
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: E.c.id } });
    assert.deepEqual([c.status, c.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"], "completed by the sweep alone");
    assert.equal((await intentRow(E.c.id)).status, "SETTLED");
    assert.deepEqual(await sessionSettlementRepository.findNeedingAttention(5), []);
  } finally {
    delete process.env.SETTLEMENT_BACKOFF_BASE_MS;
    E.restore();
    await cleanup([E.pt], [E.c.id]);
  }
});

test("5. payment-service answering with ANOTHER reason than the recorded one is a CONFLICT: parked (CONFLICT:), never written over, never retried, the contract stays ENDING for a human", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = stubs();
  let calls = 0;
  const restore = patch(paymentClient, "terminate", async () => {
    calls++;
    return { reason: "MUTUAL", refund: "4000000.00" }; // the ledger holds a different, earlier ending
  });
  try {
    await assert.rejects(
      () => terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }),
      (e: any) => e.status === 409 && e.code === "CONTRACT_ENDING_CONFLICT",
    );
    const row = await intentRow(c.id);
    assert.equal(row.status, "CONFLICT", "FH-3a: a real status, not only a text prefix");
    assert.match(row.lastError ?? "", /^CONFLICT: .*MUTUAL.*CLIENT_CANCELLED/);
    assert.equal(row.conflictNote, row.lastError, "the conflict note is kept in its own column too");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.status, after.terminationReason], ["ACTIVE", null], "not written over");
    const seen = calls;
    await runSettlementSweep();
    await runSettlementSweep();
    assert.equal(calls, seen, "a parked ending is not retried");
    // still ENDING: money actions are refused until a human decides
    const confirmed = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
    await refusedEnding(bookingService.markNoShow(confirmed.id, pt, "PT"), "ENDING stays in force");
    await assert.rejects(() => terminateContractMoney(c.id, "CLIENT_CANCELLED"), (e: any) => e.code === "CONTRACT_ENDING_CONFLICT");
    assert.ok((await sessionSettlementRepository.findNeedingAttention(1000)).some((r) => r.id === row.id), "listed for a human");
  } finally {
    restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("6. a contract with no money behind it (never paid) is not 'ending': it is ended at once, no intent row, no payment call", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const c = await makeContract(pt, { paymentTransactionId: null });
  const s = stubs();
  try {
    const done = await settleContractTermination(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId });
    assert.equal(done!.statusWritten, true);
    assert.equal(done!.result, null);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([row.status, row.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"]);
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: c.id } }), 0);
    assert.equal(s.payments.length, 0);
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("7. outstanding session-level money steps are settled BEFORE the ending is recorded: a release that failed earlier is replayed (bookkeeping applied once), and one that cannot be settled refuses the ending (409 SESSION_SETTLEMENT_PENDING) without recording it", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 3 });
  const done = await addSession(c, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
  await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${done.id}`, contractId: c.id, sessionId: done.id, status: "FAILED", attempts: 1, lastError: "payment-service down" },
  });
  const s = stubs();
  let releaseOk = false;
  const restoreRelease = patch(paymentClient, "releaseSession", async (body: any) => {
    s.payments.push({ method: "releaseSession", body });
    if (!releaseOk) throw DOWN;
    return { released: { pt: "450000", gym: "0", platform: "50000" } };
  });
  try {
    // payment-service is DOWN: the release fails AND the ledger cannot be asked (FH-3c: only an unanswerable ledger keeps the ending refused)
    s.ledger.unreachable = true;
    await assert.rejects(
      () => terminateContractMoney(c.id, "CLIENT_CANCELLED"),
      (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING",
    );
    assert.equal(await prisma.sessionSettlement.count({ where: { contractId: c.id, kind: "CONTRACT_TERMINATION" } }), 0, "refused BEFORE recording: no ending intent exists");
    assert.equal(s.payments.filter((p) => p.method === "terminate").length, 0);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");

    releaseOk = true;
    s.ledger.unreachable = false;
    await terminateContractMoney(c.id, "CLIENT_CANCELLED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.releasedToPt.toString(), "450000", "the replayed release was counted once");
    const terminate = s.payments.find((p) => p.method === "terminate")!;
    assert.deepEqual(terminate.body.alreadyReleased, { pt: "450000", gym: "0", platform: "50000" }, "the ending was priced on the settled truth");
  } finally {
    restoreRelease();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

void (null as unknown as Stubs);
