/**
 * F1 (D45 / L1 + L2) - every contract ending handles the contract's SESSIONS BY STATE, and a session left behind on
 * an ended contract can never trigger a compensation / payout again.
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_user_test database (pass DATABASE_URL
 * explicitly - user-service's .env points at dev):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-ending-sessions.integration.test.ts
 * TEST FIXTURE: payment-service is NOT running - every paymentClient money method is stubbed at the client boundary
 * (stubs() records each call), so these tests pin what user-service SENDS and what it writes. The real ledger is
 * exercised by cross-service-money-session-closure.e2e.test.ts. Session rows are inserted at the state a scenario
 * starts from.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../repositories/profile.repository";
import { bookingService } from "../services/booking.service";
import { contractService } from "../services/contract.service";
import { availabilityService } from "../services/availability.service";
import { terminateContractMoney } from "../services/contract-payout.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { runRoomCloseResolution } from "../services/room-close-resolution.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";

const REASONS = [
  "CLIENT_CANCELLED",
  "PT_CANCELLED",
  "MUTUAL",
  "EXPIRED",
  "COMPLETED",
  "PT_REPEATED_NO_SHOW",
  "PT_BANNED",
  "CLIENT_EXIT_DUE_TO_PT_RESTRICTION",
] as const;

const MONEY_METHODS_THAT_MUST_NOT_RUN = ["noShow", "lateArrival", "releaseSession"];

/** The calendar day (local time, YYYY-MM-DD) a PT would block to hit this instant: addException reads it as UTC midnight and widens to the local day. */
function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function statusOf(id: string) {
  return (await prisma.session.findUniqueOrThrow({ where: { id } })).status;
}
async function scrub(contractIds: string[]) {
  const ids = (await prisma.session.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
}
const moneyCalls = (s: ReturnType<typeof stubs>) => s.payments.filter((p) => MONEY_METHODS_THAT_MUST_NOT_RUN.includes(p.method));

// ── L1: every ending handles the sessions by state ──────────────────────────────────────────────

for (const reason of REASONS) {
  test(`L1 ${reason}: not-started sessions are called off (never a no-show, no quota, no compensation), an unanswered PT-no-show report is held; delivered / settled sessions keep their state`, { skip }, async () => {
    const pt = await makePt();
    const c = await makeContract(pt, { usedSessions: 1 });
    const now = Date.now();
    const s = {
      requested: await addSession(c, "REQUESTED", new Date(now + 3 * DAY)),
      confirmedFuture: await addSession(c, "CONFIRMED", new Date(now + 2 * DAY)),
      confirmedPast: await addSession(c, "CONFIRMED", new Date(now - 2 * DAY)),
      ptNoShowReported: await addSession(c, "PT_NO_SHOW_REPORTED", new Date(now - 3 * DAY), { disputeReason: "PT không đến", disputedAt: new Date() }),
      completed: await addSession(c, "COMPLETED", new Date(now - 5 * DAY), { sessionDeducted: true, completedAt: new Date() }),
      noShow: await addSession(c, "NO_SHOW", new Date(now - 6 * DAY), { ptAtFault: true }),
      cancelledEarlier: await addSession(c, "CANCELLED", new Date(now - 7 * DAY), { cancelledBy: "someone-else", cancellationReason: "cũ" }),
    };
    const stub = stubs();
    try {
      await terminateContractMoney(c.id, reason, { cancelledBy: "admin-1" });

      for (const k of ["requested", "confirmedFuture", "confirmedPast"] as const) {
        const row = await prisma.session.findUniqueOrThrow({ where: { id: s[k].id } });
        assert.equal(row.status, "CANCELLED", `${reason}/${k}`);
        assert.equal(row.cancelledBy, "SYSTEM", "administrative: not the PT's id, so the idle-holdback clock does not count it");
        assert.ok(row.cancellationReason && row.cancellationReason.length > 10, "the ending's reason is written on the session");
        assert.equal(row.sessionDeducted, false, "quota is kept");
        assert.equal(row.ptAtFault, false, "never a PT no-show");
      }
      // Decision A (D52): the client's unanswered "PT never came" report is HELD like a disputed session - not cancelled, not refunded at the
      // ending's rate, not completed, not concluded as a PT no-show - and shows in the admin dispute queue.
      const held = await prisma.session.findUniqueOrThrow({ where: { id: s.ptNoShowReported.id } });
      assert.equal(held.status, "DISPUTED", `${reason}: held, not cancelled`);
      assert.equal(held.disputeType, "PT_NO_SHOW_CLAIM");
      assert.equal(held.sessionDeducted, false);
      assert.equal(held.ptAtFault, false, "no PT no-show conclusion");
      assert.equal(held.disputeReason, "PT không đến", "the report itself is kept");
      assert.ok(held.disputedAt, "report time kept for aging");
      assert.ok((await bookingService.listDisputed()).some((d) => d.id === held.id), "it is in the admin dispute queue");
      // delivered / already-final sessions are untouched
      const completed = await prisma.session.findUniqueOrThrow({ where: { id: s.completed.id } });
      assert.deepEqual([completed.status, completed.sessionDeducted], ["COMPLETED", true]);
      const noShow = await prisma.session.findUniqueOrThrow({ where: { id: s.noShow.id } });
      assert.deepEqual([noShow.status, noShow.ptAtFault], ["NO_SHOW", true]);
      const earlier = await prisma.session.findUniqueOrThrow({ where: { id: s.cancelledEarlier.id } });
      assert.deepEqual([earlier.status, earlier.cancelledBy, earlier.cancellationReason], ["CANCELLED", "someone-else", "cũ"]);

      assert.equal(moneyCalls(stub).length, 0, "calling sessions off triggers no compensation / release");
      assert.equal(stub.payments.filter((p) => p.method === "terminate").length, 1, "exactly one termination call");
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.usedSessions, 1, "called-off sessions do not touch the quota");
      assert.equal(after.compensatedSessions, 0);

      // the audit trail says what happened to each called-off session
      const audits = await prisma.auditLog.findMany({ where: { entityId: { in: [s.requested.id, s.ptNoShowReported.id] } } });
      assert.equal(audits.length, 2);
      assert.equal(audits.find((a) => a.entityId === s.requested.id)!.action, "SESSION_CANCELLED_CONTRACT_ENDED");
      assert.equal(audits.find((a) => a.entityId === s.ptNoShowReported.id)!.action, "SESSION_NO_SHOW_REPORT_HELD_CONTRACT_ENDED");

      // a repeat of the same ending changes nothing and cancels nothing twice
      const before = await prisma.auditLog.count({ where: { entityId: { in: Object.values(s).map((x) => x.id) } } });
      await terminateContractMoney(c.id, reason, { cancelledBy: "admin-1" });
      assert.equal(await prisma.auditLog.count({ where: { entityId: { in: Object.values(s).map((x) => x.id) } } }), before);
    } finally {
      stub.restore();
      await scrub([c.id]);
      await cleanup([pt], [c.id]);
    }
  });
}

test("L1 PT lock unwind (PT_BANNED through deactivatePT): not-started sessions are called off and the contract ends once", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const a = await addSession(c, "CONFIRMED", new Date(Date.now() + 2 * DAY));
  const b = await addSession(c, "REQUESTED", new Date(Date.now() + 3 * DAY));
  const stub = stubs();
  try {
    const res = await ptDeactivationService.deactivatePT({ ptUserId: pt, adminId: "admin-1", reason: "vi phạm", seq: BigInt(Date.now()) });
    assert.equal(res.complete, true, JSON.stringify(res.outcomes));
    assert.equal(await statusOf(a.id), "CANCELLED");
    assert.equal(await statusOf(b.id), "CANCELLED");
    assert.equal(moneyCalls(stub).length, 0);
    assert.equal(stub.payments.filter((p) => p.method === "terminate").length, 1);
  } finally {
    stub.restore();
    await scrub([c.id]);
    await prisma.auditLog.deleteMany({ where: { entityId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("L1 expiry sweep (EXPIRED): an overdue contract's not-started sessions are called off by the same routine", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { endDate: new Date(Date.now() - DAY) });
  const a = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR));
  const stub = stubs();
  try {
    await contractService.expireContracts();
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "EXPIRED");
    assert.equal(await statusOf(a.id), "CANCELLED");
    assert.equal(moneyCalls(stub).length, 0);
  } finally {
    stub.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("L1 natural completion: a contract that runs out of entitlement with a stale REQUESTED session left calls it off", { skip }, async () => {
  const pt = await makePt();
  // 2 sessions: 1 used, 1 compensated -> nothing left; a REQUESTED session was booked before the compensation
  const c = await makeContract(pt, { totalSessions: 2, usedSessions: 1, compensatedSessions: 1 });
  const leftover = await addSession(c, "REQUESTED", new Date(Date.now() + 2 * DAY));
  const stub = stubs();
  try {
    await contractService.checkAndCompleteContract(c.id);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "COMPLETED");
    assert.equal(await statusOf(leftover.id), "CANCELLED");
    assert.equal(moneyCalls(stub).length, 0);
  } finally {
    stub.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("L1 static: the only place that calls payment-service terminate is completeContractTermination (reached through settleContractTermination), and it calls the sessions off first", () => {
  const dir = path.resolve(__dirname, "..");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "generated" || e.name === "__tests__" || e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".ts") && fs.readFileSync(p, "utf8").includes("paymentClient.terminate(")) hits.push(path.relative(dir, p).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  assert.deepEqual(hits, ["services/contract-payout.service.ts"], "no second path to the terminate call");
  const src = fs.readFileSync(path.join(dir, "services/contract-payout.service.ts"), "utf8");
  // Phase 0 / D58: settleContractTermination = beginContractTermination (records the ending) + completeContractTermination
  // (calls the sessions off, then the money). The terminate call lives in the latter and the call-off precedes it there.
  const fn = src.slice(src.indexOf("export async function completeContractTermination"));
  const callOff = fn.indexOf("callOffOpenSessions(");
  const terminate = fn.indexOf("paymentClient.terminate(");
  assert.ok(callOff > 0 && terminate > 0 && callOff < terminate, "the call-off runs before the money call");
  const settle = src.slice(src.indexOf("export async function settleContractTermination"));
  assert.ok(settle.indexOf("beginContractTermination(") > 0 && settle.indexOf("completeContractTermination(") > settle.indexOf("beginContractTermination("), "an ending is recorded before it is carried through");
});

// ── L2: leftovers of an ended contract cannot trigger money ─────────────────────────────────────

async function endedContractWithLeftovers() {
  const pt = await makePt();
  // the bug state: the contract ended (as before this fix) but its sessions were left open
  const c = await makeContract(pt, { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date() });
  const now = Date.now();
  const soon = new Date(now + 3 * HOUR); // <24h: a PT cancel / date block here compensates the client on a running contract
  const sessions = {
    confirmedSoon: await addSession(c, "CONFIRMED", soon),
    confirmedPast: await addSession(c, "CONFIRMED", new Date(now - 2 * DAY)),
    reported: await addSession(c, "PT_NO_SHOW_REPORTED", new Date(now - 2 * DAY), { disputeReason: "PT không đến", disputedAt: new Date() }),
    onlineClosed: await addSession(c, "CONFIRMED", new Date(now - 3 * HOUR), { sessionMode: "ONLINE", roomClientJoinedAt: new Date(now - 3 * HOUR) }),
  };
  return { pt, c, sessions, soon };
}

test("L2 an ended contract's leftover sessions: PT cancel, no-show admission, answering a report, completion report, client report, join are all refused and write nothing", { skip }, async () => {
  const { pt, c, sessions } = await endedContractWithLeftovers();
  const stub = stubs();
  try {
    const refused = (p: Promise<unknown>) => assert.rejects(p, (e: any) => e.status === 409 && e.code === "CONTRACT_ENDED");
    await refused(bookingService.cancelSession(sessions.confirmedSoon.id, pt, "bận"));
    await refused(bookingService.cancelSession(sessions.confirmedSoon.id, c.clientUserId, "bận"));
    await refused(bookingService.markNoShow(sessions.confirmedPast.id, pt, "PT"));
    await refused(bookingService.markNoShow(sessions.confirmedPast.id, pt, "CLIENT"));
    await refused(bookingService.respondToNoShowReport(sessions.reported.id, pt, "AGREE"));
    await refused(bookingService.respondToNoShowReport(sessions.reported.id, pt, "DENY"));
    await refused(bookingService.completeSession(sessions.confirmedPast.id, pt, "đã dạy"));
    await refused(bookingService.reportPtNoShow(sessions.confirmedPast.id, c.clientUserId, "PT không đến"));
    await refused(bookingService.joinSession(sessions.onlineClosed.id, c.clientUserId));

    assert.equal(await statusOf(sessions.confirmedSoon.id), "CONFIRMED");
    assert.equal(await statusOf(sessions.confirmedPast.id), "CONFIRMED");
    assert.equal(await statusOf(sessions.reported.id), "PT_NO_SHOW_REPORTED");
    assert.equal(stub.payments.length, 0, "no money call of any kind");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.usedSessions, after.compensatedSessions], [0, 0]);
  } finally {
    stub.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("L2 a PT blocking the day of an ended contract's leftover session cancels and compensates nothing - while the same block on a running contract still compensates (control)", { skip }, async () => {
  const { pt, c, sessions, soon } = await endedContractWithLeftovers();
  const running = await makeContract(pt);
  const runningSoon = await addSession(running, "CONFIRMED", new Date(soon.getTime() + 60 * 1000));
  const stub = stubs();
  try {
    // both sessions are on the same calendar day; only the RUNNING contract's may be touched
    const day = localDay(soon);
    const r = await availabilityService.addException(pt, day, "bận");
    assert.equal(r.affectedSessions, 1, "only the running contract's session is in scope");
    assert.equal(await statusOf(sessions.confirmedSoon.id), "CONFIRMED", "the ended contract's leftover is not cancelled by the block");
    const noShowCalls = stub.payments.filter((p) => p.method === "noShow");
    assert.equal(noShowCalls.length, 1, "the control: the running contract's session was compensated");
    assert.equal(noShowCalls[0].body.idempotencyKey, `PT_NO_SHOW:${runningSoon.id}`);
    assert.equal(noShowCalls[0].body.transactionId, running.paymentTransactionId, "and only ITS own transaction is touched");
  } finally {
    stub.restore();
    await prisma.pTScheduleException.deleteMany({ where: { ptUserId: pt } }).catch(() => {});
    await scrub([c.id, running.id]);
    await cleanup([pt], [c.id, running.id]);
  }
});

test("L2 the room-close sweep never compensates (no-show / late arrival) an ended contract's online leftover", { skip }, async () => {
  const { pt, c, sessions } = await endedContractWithLeftovers();
  const stub = stubs();
  try {
    // the client joined, the PT never did -> on a running contract this would be a PT no-show with compensation
    await runRoomCloseResolution();
    assert.equal(await statusOf(sessions.onlineClosed.id), "CONFIRMED");
    assert.equal(stub.payments.filter((p) => p.method === "noShow" || p.method === "lateArrival").length, 0);
  } finally {
    stub.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

// ── races ───────────────────────────────────────────────────────────────────────────────────────

test("race: the contract ends while the PT cancels a CONFIRMED session 3h before its start - never both a call-off and a compensation", { skip }, async () => {
  for (let i = 0; i < 6; i++) {
    const pt = await makePt();
    const c = await makeContract(pt);
    const sess = await addSession(c, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    const stub = stubs({ refund: "1.00" });
    try {
      const [ended, cancelled] = await Promise.allSettled([
        terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }),
        bookingService.cancelSession(sess.id, pt, "bận"),
      ]);
      assert.equal(ended.status, "fulfilled");
      const row = await prisma.session.findUniqueOrThrow({ where: { id: sess.id } });
      const noShowCalls = stub.payments.filter((p) => p.method === "noShow").length;
      if (cancelled.status === "rejected") {
        // the ending won the session: it is called off, the PT's cancel was refused, nothing was compensated
        assert.equal(row.cancelledBy, "SYSTEM");
        assert.equal(noShowCalls, 0);
      } else {
        // the PT's cancel won the session before the ending: a legitimate compensation, once
        assert.equal(row.status, "NO_SHOW");
        assert.equal(noShowCalls, 1);
      }
    } finally {
      stub.restore();
      await scrub([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
});

// ── N9: no NEW completion report after the ban ──────────────────────────────────────────────────

test("N9 a PT banned at T cannot create a completion report after T; a report made before T stands", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const before = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
  const after = await addSession(c, "CONFIRMED", new Date(Date.now() - 3 * DAY));
  const stub = stubs();
  try {
    await bookingService.completeSession(before.id, pt, "ok");
    assert.equal(await statusOf(before.id), "PENDING_CLIENT_CONFIRMATION");

    await ptDeactivationService.claimLockCommand("DEACTIVATE", { ptUserId: pt, adminId: "admin-1", reason: "vi phạm", seq: BigInt(Date.now()) });
    await assert.rejects(bookingService.completeSession(after.id, pt, "ok"), (e: any) => e.status === 409);
    assert.equal(await statusOf(after.id), "CONFIRMED", "no new report after the ban");
    await assert.rejects(bookingService.markNoShow(after.id, pt, "CLIENT"), (e: any) => e.status === 409);
    assert.equal(await statusOf(after.id), "CONFIRMED");
    assert.equal(await statusOf(before.id), "PENDING_CLIENT_CONFIRMATION", "the pre-ban report is untouched and awaits the client");
  } finally {
    stub.restore();
    await scrub([c.id]);
    await prisma.auditLog.deleteMany({ where: { entityId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("N9 race: a ban and a completion report at the same instant - the report is either refused or was made before the ban, never after it", { skip }, async () => {
  for (let i = 0; i < 6; i++) {
    const pt = await makePt();
    const c = await makeContract(pt);
    const sess = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * DAY));
    const stub = stubs();
    try {
      const [report] = await Promise.allSettled([
        bookingService.completeSession(sess.id, pt, "ok"),
        ptDeactivationService.claimLockCommand("DEACTIVATE", { ptUserId: pt, adminId: "admin-1", reason: "vi phạm", seq: BigInt(Date.now()) + BigInt(i) }),
      ]);
      const status = await statusOf(sess.id);
      if (report.status === "fulfilled") assert.equal(status, "PENDING_CLIENT_CONFIRMATION");
      else assert.equal(status, "CONFIRMED", "refused means nothing was written");
      // after the ban is committed, a second attempt is always refused
      const late = await addSession(c, "CONFIRMED", new Date(Date.now() - 4 * DAY));
      await assert.rejects(bookingService.completeSession(late.id, pt, "ok"), (e: any) => e.status === 409);
    } finally {
      stub.restore();
      await scrub([c.id]);
      await prisma.auditLog.deleteMany({ where: { entityId: pt } }).catch(() => {});
      await cleanup([pt], [c.id]);
    }
  }
});
