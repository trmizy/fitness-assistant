/**
 * Temporary PT suspension (slices 2-3), part 1 — the restriction record, what a suspension does and
 * does not touch, the end-date give-back at lift, and the overdue flag.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated gymcoach_user_test database; payment-service
 * and the notification push are stubbed at the client boundary (TEST FIXTURE) — see
 * pt-restriction.test-helpers.ts. Run with:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-suspension.integration.test.ts
 *
 * All instants are UTC; the service takes an `at` seam so a "three week" suspension is exercised
 * without waiting three weeks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractService } from "../services/contract.service";
import {
  PT_RESTRICTION_OVERDUE_DAYS,
  computeBlockedMs,
  getEffectiveContractStatus,
  idleCutoffExcludingRestrictions,
  openEpisode,
  ptRestrictionService,
} from "../services/pt-restriction.service";
import {
  DAY,
  HOUR,
  addSession,
  cleanup,
  flagMatchesRecord,
  makeContract,
  makePt,
  skip,
  stubs,
} from "./pt-restriction.test-helpers";

const ADMIN = "admin-1";
const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: ADMIN,
  reasonCategory: "COMPLAINT_REVIEW" as const,
  reasonText: "Khiếu nại đang được xem xét",
  publicReason: "Đang xem xét một phản ánh",
  at,
});

async function refused(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected the call to be refused");
}

// ── pure maths ───────────────────────────────────────────────────────────────────────────────

test("computeBlockedMs: from max(episode start, activation) to lift; nothing if the contract had already run out", () => {
  const d = (n: number) => new Date(n * DAY);
  // activated day 0, ends day 30; suspended day 20 → lifted day 41: blocked 21 days
  assert.equal(computeBlockedMs(d(20), d(41), d(0), d(30)), 21 * DAY);
  // activated INSIDE the episode (day 25): only from the activation
  assert.equal(computeBlockedMs(d(20), d(41), d(25), d(55)), 16 * DAY);
  // the contract's end date was already behind the suspension start: nothing was blocked, nothing to give back
  assert.equal(computeBlockedMs(d(20), d(41), d(0), d(15)), 0);
  assert.equal(computeBlockedMs(d(20), d(41), d(0), d(20)), 0);
  // a lift before the start (clock skew) never yields a negative extension
  assert.equal(computeBlockedMs(d(20), d(10), d(0), d(30)), 0);
});

test("idleCutoffExcludingRestrictions: walks back N ms of NON-suspended time", () => {
  const now = new Date(100 * DAY);
  const idle = 30 * DAY;
  // no episodes: plain now − 30d
  assert.equal(idleCutoffExcludingRestrictions(now, idle, []).getTime(), 70 * DAY);
  // suspended days 80..95 (15 days): the cutoff moves back 15 more days
  assert.equal(
    idleCutoffExcludingRestrictions(now, idle, [{ startedAt: new Date(80 * DAY), endedAt: new Date(95 * DAY) }]).getTime(),
    55 * DAY,
  );
  // still suspended (open episode, ends "now"): the whole open stretch is excluded
  assert.equal(
    idleCutoffExcludingRestrictions(now, idle, [{ startedAt: new Date(90 * DAY), endedAt: null }]).getTime(),
    60 * DAY,
  );
  // two episodes
  assert.equal(
    idleCutoffExcludingRestrictions(now, idle, [
      { startedAt: new Date(60 * DAY), endedAt: new Date(65 * DAY) },
      { startedAt: new Date(80 * DAY), endedAt: new Date(90 * DAY) },
    ]).getTime(),
    55 * DAY, // 100 → 90 (10 non-suspended), 90..80 skipped, 80 → 65 (15 more = 25), 65..60 skipped, 60 → 55 (5 = 30)
  );
});

// ── (a) the record: suspend / lift / idempotency / history ───────────────────────────────────

test("(a) suspend → lift → suspend → lift: one row per episode, repeats are no-ops, flag follows the record, history is kept", { skip }, async () => {
  const pt = await makePt();
  const s = stubs();
  try {
    const first = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(first.changed, true);
    assert.equal(first.restriction.type, "TEMPORARY_SUSPENSION");
    assert.equal(first.restriction.endedAt, null);
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);

    const again = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(again.changed, false, "suspending an already suspended PT is an idempotent no-op");
    assert.equal(again.restriction.id, first.restriction.id);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 1);

    const lifted = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "Đã xem xét xong" });
    assert.equal(lifted.changed, true);
    const liftedAgain = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "Đã xem xét xong" });
    assert.equal(liftedAgain.changed, false, "lifting twice is a no-op");
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);

    const second = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(second.changed, true);
    assert.notEqual(second.restriction.id, first.restriction.id, "a second suspension is its own row");
    await ptRestrictionService.lift({ ptUserId: pt, adminId: "admin-2", reason: "Hết lý do" });

    const rows = await prisma.ptRestriction.findMany({ where: { ptUserId: pt }, orderBy: { startedAt: "asc" } });
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.type, "TEMPORARY_SUSPENSION");
      assert.ok(r.endedAt, "closed, not deleted");
      assert.equal(r.endKind, "LIFTED");
      assert.ok(r.liftReason);
    }
    assert.equal(rows[0].liftedBy, ADMIN);
    assert.equal(rows[1].liftedBy, "admin-2");
    assert.equal(rows[0].imposedBy, ADMIN);
    assert.equal(rows[0].reasonCategory, "COMPLAINT_REVIEW");
    assert.equal(rows[0].reasonText, "Khiếu nại đang được xem xét");

    const history = await ptRestrictionService.history(pt);
    assert.equal(history.length, 2);
    assert.ok(await flagMatchesRecord(pt));

    const trail = await prisma.auditLog.findMany({ where: { entityId: pt }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      trail.map((t) => t.action),
      ["PT_SUSPENDED_TEMPORARILY", "PT_SUSPENSION_LIFTED", "PT_SUSPENDED_TEMPORARILY", "PT_SUSPENSION_LIFTED"],
      "every state change is audited once; the no-op repeats write nothing",
    );
  } finally {
    s.restore();
    await cleanup([pt], []);
  }
});

test("(a) the database itself refuses a second ACTIVE episode for one PT (partial unique index)", { skip }, async () => {
  const pt = await makePt();
  try {
    await prisma.$transaction(async (tx) => {
      await openEpisode(tx, {
        ptUserId: pt,
        type: "TEMPORARY_SUSPENSION",
        reasonCategory: "OTHER",
        reasonText: "x",
        imposedBy: ADMIN,
        startedAt: new Date(),
      });
    });
    const e = await refused(() =>
      prisma.$transaction(async (tx) => {
        await openEpisode(tx, {
          ptUserId: pt,
          type: "PERMANENT_BAN",
          reasonCategory: "OTHER",
          reasonText: "y",
          imposedBy: ADMIN,
          startedAt: new Date(),
        });
      }),
    );
    assert.equal(e.code, "P2002", "unique violation");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 1);
  } finally {
    await cleanup([pt], []);
  }
});

test("(a) validation: reason required, category known, only a real PT can be suspended", { skip }, async () => {
  const pt = await makePt();
  const notPt = await makePt({ isPT: false });
  const s = stubs();
  try {
    let e = await refused(() => ptRestrictionService.suspend({ ...suspendInput(pt), reasonText: "   " }));
    assert.equal(e.code, "REASON_REQUIRED");
    assert.equal(e.status, 400);
    e = await refused(() => ptRestrictionService.suspend({ ...suspendInput(pt), reasonCategory: "NOPE" as any }));
    assert.equal(e.code, "REASON_CATEGORY_INVALID");
    e = await refused(() => ptRestrictionService.suspend(suspendInput(randomUUID())));
    assert.equal(e.status, 404);
    e = await refused(() => ptRestrictionService.suspend(suspendInput(notPt)));
    assert.equal(e.status, 404);
    e = await refused(() => ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "" }));
    assert.equal(e.code, "REASON_REQUIRED", "a reason is required to lift too");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 0, "nothing was written");
  } finally {
    s.restore();
    await cleanup([pt, notPt], []);
  }
});

// ── (b)/(c) four contracts: nothing ends, sessions are called off administratively ───────────

test("(c) a PT with four ACTIVE contracts is suspended: no contract changes, no money call, future sessions are called off as an administrative interruption, in-flight ones are left alone, everyone affected is told (gap asserted)", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const mk = (n: number) => makeContract(pt, { startDate: new Date(T - 10 * DAY), endDate: new Date(T + 60 * DAY), usedSessions: n });
  const [B, C, D, E] = [await mk(2), await mk(1), await mk(3), await mk(0)];
  const sB = await addSession(B, "CONFIRMED", new Date(T + 3 * DAY));
  const sC1 = await addSession(C, "REQUESTED", new Date(T + 2 * DAY));
  const sC2 = await addSession(C, "CONFIRMED", new Date(T + 5 * DAY), { sessionMode: "ONLINE" });
  const sDdone = await addSession(D, "COMPLETED", new Date(T - 3 * DAY), { sessionDeducted: true, completedAt: new Date(T - 3 * DAY) });
  const sDnext = await addSession(D, "REQUESTED", new Date(T + 4 * DAY));
  const sEpending = await addSession(E, "PENDING_CLIENT_CONFIRMATION", new Date(T - 1 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
  const sEpastConfirmed = await addSession(E, "CONFIRMED", new Date(T - 2 * DAY));
  const sEdisputed = await addSession(E, "DISPUTED", new Date(T - 4 * DAY), { disputeReason: "x", disputedAt: new Date(T - 3 * DAY) });
  const sEnoShowReport = await addSession(E, "PT_NO_SHOW_REPORTED", new Date(T - 5 * DAY), { disputeReason: "y" });
  const resched = await prisma.sessionRescheduleRequest.create({
    data: {
      sessionId: sB.id,
      requestedBy: "CLIENT",
      originalStartAt: sB.scheduledStartAt,
      originalEndAt: sB.scheduledEndAt,
      proposedStartAt: new Date(T + 6 * DAY),
      proposedEndAt: new Date(T + 6 * DAY + HOUR),
      reason: "bận",
      status: "PENDING",
    },
  });
  const contracts = [B, C, D, E];
  const s = stubs();
  try {
    const result = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(result.changed, true);

    // contracts: nothing moved
    for (const c of contracts) {
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.status, "ACTIVE");
      assert.equal(after.terminationReason, null);
      assert.equal(after.terminatedAt, null);
      assert.equal(after.endDate?.getTime(), c.endDate?.getTime(), "the end date is untouched until the lift");
      assert.equal(after.usedSessions, c.usedSessions, "no quota consumed");
      assert.equal(after.compensatedSessions, 0, "no compensation counted");
      assert.equal(await getEffectiveContractStatus(after), "PAUSED_BY_ADMIN");
    }
    assert.equal(s.payments.length, 0, "no termination, refund, release or compensation call to payment-service");

    // sessions: the four that had not finished are cancelled administratively
    for (const called of [sB, sC1, sC2, sDnext]) {
      const after = await prisma.session.findUniqueOrThrow({ where: { id: called.id } });
      assert.equal(after.status, "CANCELLED");
      assert.equal(after.cancelledBy, "SYSTEM", "a non-PT value: the idle-holdback 'PT cancelled' rule is not triggered");
      assert.notEqual(after.cancelledBy, pt);
      assert.equal(after.ptAtFault, false);
      assert.equal(after.sessionDeducted, false);
      assert.match(after.cancellationReason ?? "", /gián đoạn hành chính/);
    }
    // sessions that already happened / are in flight are untouched
    const untouched = new Map([
      [sDdone.id, "COMPLETED"],
      [sEpending.id, "PENDING_CLIENT_CONFIRMATION"],
      [sEpastConfirmed.id, "CONFIRMED"],
      [sEdisputed.id, "DISPUTED"],
      [sEnoShowReport.id, "PT_NO_SHOW_REPORTED"],
    ]);
    for (const [id, status] of untouched) {
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id } })).status, status);
    }
    assert.equal((await prisma.sessionRescheduleRequest.findUniqueOrThrow({ where: { id: resched.id } })).status, "CANCELLED");

    // notifications: slice 4 replaced the SESSION_CANCELLED stopgap — one CONTRACT_PAUSED_PT_SUSPENDED per ACTIVE paid
    // contract (a client with only in-flight sessions, E, is told too) plus one for the PT; the full wording and
    // de-duplication are pinned in pt-suspension-notifications.integration.test.ts
    assert.equal(result.cancelled.length, 4);
    assert.ok(s.notified.every((n) => n.eventType === "CONTRACT_PAUSED_PT_SUSPENDED"));
    const toUsers = new Set(s.notified.map((n) => n.userId));
    assert.ok(toUsers.has(B.clientUserId) && toUsers.has(C.clientUserId) && toUsers.has(D.clientUserId) && toUsers.has(E.clientUserId), "every client with an ACTIVE paid contract is told");
    assert.ok(toUsers.has(pt), "the PT is told");
    assert.equal(s.notified.length, 5, "four contracts + the PT, once each");
    for (const n of s.notified) assert.doesNotMatch(n.text, /vi phạm|sai phạm|gian lận|kỷ luật|bị phạt vì/i, "the wording must not state or imply PT misconduct");

    // audit per called-off session
    const sessionAudits = await prisma.auditLog.count({
      where: { action: "SESSION_CANCELLED_PT_SUSPENSION", entityId: { in: [sB.id, sC1.id, sC2.id, sDnext.id] } },
    });
    assert.equal(sessionAudits, 4);
    assert.ok(await flagMatchesRecord(pt));

    // lift: contracts are still ACTIVE and running; the in-flight confirmation window was given back
    const deadlineBefore = (await prisma.session.findUniqueOrThrow({ where: { id: sEpending.id } })).clientConfirmDeadline!;
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    for (const c of contracts) {
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.status, "ACTIVE");
      assert.equal(await getEffectiveContractStatus(after), "ACTIVE");
    }
    const deadlineAfter = (await prisma.session.findUniqueOrThrow({ where: { id: sEpending.id } })).clientConfirmDeadline!;
    assert.ok(deadlineAfter.getTime() > deadlineBefore.getTime(), "the client's confirmation window resumes after the lift");
    assert.equal(s.payments.length, 0, "still no money call after the lift");
  } finally {
    s.restore();
    await cleanup([pt], contracts.map((c) => c.id));
  }
});

test("(c) an ONLINE session called off by a suspension is the FORCE_MAJEURE row: still CANCELLED with the quota kept (shared matrix, not a copy)", { skip }, async () => {
  const { resolveSessionOutcome } = await import("../services/session-outcome");
  const o = resolveSessionOutcome({ actor: "FORCE_MAJEURE", event: "CANCEL", hoursBeforeStart: 1 });
  assert.deepEqual(o, { sessionStatus: "CANCELLED", clientQuotaEffect: "KEEP", clientCompensation: false, ptPayout: false });
});

// ── (e) the end date is given back, exactly ──────────────────────────────────────────────────

test("(e) a three-week suspension straddling the contract's original end date: the sweep does not end it; at lift end date = original + blocked time; the client lost nothing", { skip }, async () => {
  const T = Date.now();
  const S = new Date(T - 21 * DAY); // suspension starts
  const A = new Date(T - 30 * DAY); // contract activated
  const E0 = new Date(T - 5 * DAY); // original end date: INSIDE the suspension window (S < E0 < L)
  const pt = await makePt();
  const control = await makePt();
  const c = await makeContract(pt, { startDate: A, endDate: E0 });
  const cControl = await makeContract(control, { startDate: A, endDate: E0 });
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, S));

    const expired = await contractService.expireContracts();
    const terminated = s.payments.filter((p) => p.method === "terminate").map((p) => p.body.idempotencyKey);
    assert.ok(expired >= 1);
    assert.ok(terminated.includes(`CONTRACT_TERMINATE:${cControl.id}`), "control: an unrestricted PT's overdue contract IS expired");
    assert.ok(!terminated.includes(`CONTRACT_TERMINATE:${c.id}`), "the suspended PT's contract is NOT ended as EXPIRED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok", at: new Date(T) });
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.endDate!.getTime(), E0.getTime() + 21 * DAY, "original end + exactly the 21 days it was blocked");
    // what the client had left when the pause began (E0 − S = 16 days) is what they have left now
    assert.equal(after.endDate!.getTime() - T, E0.getTime() - S.getTime());
    const ext = await prisma.ptRestrictionContractExtension.findMany({ where: { contractId: c.id } });
    assert.equal(ext.length, 1);
    assert.equal(Number(ext[0].blockedMs), 21 * DAY);

    // after the lift the sweep leaves it alone
    s.payments.length = 0;
    await contractService.expireContracts();
    assert.ok(!s.payments.some((p) => p.body?.idempotencyKey === `CONTRACT_TERMINATE:${c.id}`));
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");
  } finally {
    s.restore();
    await cleanup([pt, control], [c.id, cControl.id]);
  }
});

test("(e) lock → lift → lock → lift: the extension is the SUM of the two blocked intervals, a repeated lift changes nothing, and a contract activated mid-episode is extended only from its activation", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const A = new Date(T - 50 * DAY);
  const E0 = new Date(T + 10 * DAY);
  const c = await makeContract(pt, { startDate: A, endDate: E0 });
  const noEnd = await makeContract(pt, { startDate: A, endDate: null });
  const s = stubs();
  let late: Awaited<ReturnType<typeof makeContract>> | undefined;
  try {
    // episode 1: 10 days
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T - 40 * DAY)));
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "1", at: new Date(T - 30 * DAY) });
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).endDate!.getTime(), E0.getTime() + 10 * DAY);

    // episode 2: 10 days; a contract is activated 5 days before the end of it
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T - 10 * DAY)));
    late = await makeContract(pt, { startDate: new Date(T - 5 * DAY), endDate: new Date(T + 25 * DAY) });
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "2", at: new Date(T) });

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.endDate!.getTime(), E0.getTime() + 20 * DAY, "10 + 10 days, not more");

    // a repeated lift (and a late duplicate) changes nothing
    const repeat = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "again", at: new Date(T + HOUR) });
    assert.equal(repeat.changed, false);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).endDate!.getTime(), E0.getTime() + 20 * DAY);
    assert.equal(await prisma.ptRestrictionContractExtension.count({ where: { contractId: c.id } }), 2, "one marker per episode");

    // activated mid-episode: extended by lift − activation = 5 days only
    const lateAfter = await prisma.contract.findUniqueOrThrow({ where: { id: late.id } });
    assert.equal(lateAfter.endDate!.getTime(), T + 25 * DAY + 5 * DAY);

    // no end date → still none
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: noEnd.id } })).endDate, null);
    assert.equal(await prisma.ptRestrictionContractExtension.count({ where: { contractId: noEnd.id } }), 0);
  } finally {
    s.restore();
    await cleanup([pt], [c.id, noEnd.id, ...(late ? [late.id] : [])]);
  }
});

test("(e) a contract that ended during the suspension (completed, client-cancelled) is not extended and not revived at lift; one that had already run out before the pause began is not extended either", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const mk = (over: Record<string, unknown> = {}) =>
    makeContract(pt, { startDate: new Date(T - 30 * DAY), endDate: new Date(T + 20 * DAY), ...over });
  const stillActive = await mk();
  const completed = await mk();
  const clientCancelled = await mk();
  const alreadyLapsed = await mk({ endDate: new Date(T - 12 * DAY) }); // ran out BEFORE the episode started (T-10d)
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T - 10 * DAY)));
    // they end during the suspension (the client's confirm completing the last session; a client exit)
    await prisma.contract.update({ where: { id: completed.id }, data: { status: "COMPLETED", completedAt: new Date(T - 4 * DAY), terminationReason: "COMPLETED" } });
    await prisma.contract.update({
      where: { id: clientCancelled.id },
      data: { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date(T - 3 * DAY) },
    });

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok", at: new Date(T) });

    const get = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });
    assert.equal((await get(stillActive.id)).endDate!.getTime(), stillActive.endDate!.getTime() + 10 * DAY);
    const done = await get(completed.id);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.endDate!.getTime(), completed.endDate!.getTime(), "an ended contract keeps its end date");
    const cancelled = await get(clientCancelled.id);
    assert.equal(cancelled.status, "CANCELLED", "never revived");
    assert.equal(cancelled.endDate!.getTime(), clientCancelled.endDate!.getTime());
    const lapsed = await get(alreadyLapsed.id);
    assert.equal(lapsed.endDate!.getTime(), alreadyLapsed.endDate!.getTime(), "it had already run out before the pause: nothing was blocked, nothing is given back");
    assert.equal(await prisma.ptRestrictionContractExtension.count({ where: { contractId: { in: [completed.id, clientCancelled.id, alreadyLapsed.id] } } }), 0);
  } finally {
    s.restore();
    await cleanup([pt], [stillActive.id, completed.id, clientCancelled.id, alreadyLapsed.id]);
  }
});

// ── (g) overdue and justification ────────────────────────────────────────────────────────────

test("(g) overdue at 14 days from the start, cleared by a justification (which restarts the clock); being overdue changes nothing else", { skip }, async () => {
  assert.equal(PT_RESTRICTION_OVERDUE_DAYS, 14, "default");
  const T = Date.now();
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  try {
    const S = new Date(T - 20 * DAY);
    await ptRestrictionService.suspend(suspendInput(pt, S));
    const at = (ms: number) => new Date(S.getTime() + ms);

    const list = (now: Date, overdueOnly = false) => ptRestrictionService.listActive({ now, overdueOnly });
    const mine = (r: { items: Array<{ ptUserId: string; overdue: boolean }> }) => r.items.find((i) => i.ptUserId === pt);

    assert.equal(mine(await list(at(14 * DAY - 1)))!.overdue, false, "13d23h59m: not yet");
    assert.equal(mine(await list(at(14 * DAY)))!.overdue, true, "14 days: overdue");
    assert.ok(mine(await list(at(14 * DAY), true)), "the overdue filter returns it");
    assert.ok(!mine(await list(at(1 * DAY), true)), "…and not before");

    // an admin justifies continuing at day 14: the clock restarts from the justification
    const J = at(14 * DAY);
    const justified = await ptRestrictionService.justifyContinuing({ ptUserId: pt, adminId: ADMIN, reason: "Vẫn đang chờ kết quả xác minh", at: J });
    assert.equal(justified.overdue, false);
    assert.equal(mine(await list(at(20 * DAY)))!.overdue, false, "cleared by the justification");
    assert.equal(mine(await list(new Date(J.getTime() + 14 * DAY)))!.overdue, true, "overdue again 14 days after the justification");

    // nothing else moved: still suspended, contract untouched, no money, no auto-lift
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");
    assert.equal((await prisma.ptRestriction.findFirstOrThrow({ where: { ptUserId: pt } })).endedAt, null);
    assert.equal(s.payments.length, 0);
    assert.ok(await flagMatchesRecord(pt));
    const row = await prisma.ptRestriction.findFirstOrThrow({ where: { ptUserId: pt } });
    assert.equal(row.lastJustifiedBy, ADMIN);
    assert.equal(row.lastJustification, "Vẫn đang chờ kết quả xác minh");

    // justification needs a reason and an active suspension
    let e = await refused(() => ptRestrictionService.justifyContinuing({ ptUserId: pt, adminId: ADMIN, reason: " " }));
    assert.equal(e.code, "REASON_REQUIRED");
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    e = await refused(() => ptRestrictionService.justifyContinuing({ ptUserId: pt, adminId: ADMIN, reason: "x" }));
    assert.equal(e.code, "NO_ACTIVE_SUSPENSION");
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});
