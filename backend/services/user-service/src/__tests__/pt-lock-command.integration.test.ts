/**
 * PT lock, slice 1 — a lock/unlock command is ordered durably, applied completely, retried safely
 * and audited.
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_user_test database (never the
 * dev one — user-service's .env points at dev, so pass DATABASE_URL explicitly):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-lock-command.integration.test.ts
 * payment-service is NOT running: paymentClient.terminate is stubbed at the client boundary
 * (TEST FIXTURE for that half), so these tests pin what user-service SENDS and what it records.
 * notificationService.create is stubbed (it would try to push to chat-service).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { sessionRepository } from "../repositories/session.repository";
import { paymentClient } from "../clients/payment.client";
import { notificationService } from "../services/notification.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";

const DAY = 24 * 3600 * 1000;
import { skip } from "./test-db-guard"; // D57-6-5: the database NAME must end with _test (was a loose /_test/ match on the whole URL)

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

async function makePt(): Promise<string> {
  const userId = randomUUID();
  await prisma.userProfile.create({ data: { userId, isPT: true } });
  return userId;
}

async function makeContract(ptUserId: string, overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId,
      clientUserId: randomUUID(),
      packageName: "Gói 10 buổi",
      totalSessions: 10,
      price: 5_000_000,
      status: "ACTIVE",
      paymentTransactionId: `txn-${randomUUID()}`,
      startDate: new Date(Date.now() - 40 * DAY),
      ...overrides,
    },
  });
}

async function addSession(c: { id: string; ptUserId: string; clientUserId: string }, status: string, startOffsetDays = 2) {
  const start = new Date(Date.now() + startOffsetDays * DAY);
  return prisma.session.create({
    data: {
      id: randomUUID(),
      contractId: c.id,
      ptUserId: c.ptUserId,
      clientUserId: c.clientUserId,
      status: status as any,
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + 3600 * 1000),
    },
  });
}

async function cleanup(ptUserId: string, contractIds: string[]) {
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.auditLog
    .deleteMany({ where: { entityId: { in: [...contractIds, ptUserId] } } })
    .catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: ptUserId } }).catch(() => {});
}

const cmd = (ptUserId: string, seq: number, extra: Record<string, unknown> = {}) => ({
  ptUserId,
  adminId: "admin-1",
  reason: "vi phạm điều khoản" as string | null,
  seq: BigInt(seq),
  ...extra,
});

function stubs(terminate?: (body: any) => Promise<any>, notified: any[] = []) {
  const calls: any[] = [];
  const restores = [
    patch(notificationService, "create", async (n: any) => {
      notified.push(n);
      return {} as any;
    }),
    patch(paymentClient, "terminate", async (body: any) => {
      calls.push(body);
      const r = terminate ? await terminate(body) : { refund: "1000000.00" };
      // like the real ledger: it echoes the reason and reports how many sessions' value it HELD (user-service checks the answer)
      return {
        reason: body.reason,
        ...(body.unresolvedSessions > 0 ? { unresolved: { sessions: body.unresolvedSessions } } : {}),
        ...r,
      };
    }),
  ];
  return { calls, notified, restore: () => restores.forEach((r) => r()) };
}

const profileOf = (userId: string) =>
  prisma.userProfile.findUniqueOrThrow({ where: { userId }, select: { ptSuspended: true, ptLockSeq: true } });

// ── item 2: ordering ─────────────────────────────────────────────────────────────────────────

test("lock → unlock → a late/retried LOCK with the older seq does NOT lock again and touches no contract", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  try {
    // Lock #5 fails half way (payment-service down) so the relay will keep it around…
    const failing = stubs(async () => {
      throw new Error("payment-service down");
    });
    const first = await ptDeactivationService.deactivatePT(cmd(pt, 5));
    failing.restore();
    assert.equal(first.complete, false);

    // …the admin then unlocks (#6)…
    const unlock = await ptDeactivationService.reactivatePT(cmd(pt, 6));
    assert.equal(unlock.reactivated, true);
    assert.deepEqual(await profileOf(pt), { ptSuspended: false, ptLockSeq: 6n });

    // …and the old lock #5 arrives again (relay sweep / network retry).
    s.calls.length = 0;
    const late = await ptDeactivationService.deactivatePT(cmd(pt, 5));
    assert.equal(late.stale, true);
    assert.equal(late.complete, true, "a superseded command has nothing left to do");
    assert.deepEqual(late.outcomes, []);
    assert.deepEqual(await profileOf(pt), { ptSuspended: false, ptLockSeq: 6n }, "the PT stays unlocked");
    assert.equal(s.calls.length, 0, "no money call for a stale lock");
    const stillOpen = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(stillOpen.status, "ACTIVE", "the contract was not cancelled by the stale lock");

    const trail = await prisma.auditLog.findMany({ where: { entityId: pt }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      trail.map((t) => t.action),
      ["PT_LOCKED", "PT_UNLOCKED", "PT_LOCK_COMMAND_IGNORED_STALE"],
    );
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("a stale UNLOCK (older than the last applied lock) changes nothing", { skip }, async () => {
  const pt = await makePt();
  const s = stubs();
  try {
    await ptDeactivationService.deactivatePT(cmd(pt, 9));
    const res = await ptDeactivationService.reactivatePT(cmd(pt, 8));
    assert.equal(res.stale, true);
    assert.equal(res.reactivated, false);
    assert.deepEqual(await profileOf(pt), { ptSuspended: true, ptLockSeq: 9n });
  } finally {
    s.restore();
    await cleanup(pt, []);
  }
});

test("duplicate lock and duplicate unlock are no-ops (no second money call, no second state change)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  try {
    const a = await ptDeactivationService.deactivatePT(cmd(pt, 1));
    assert.equal(a.complete, true);
    assert.equal(s.calls.length, 1);

    // The very same command again (a retry) and a newer lock while already locked.
    const retry = await ptDeactivationService.deactivatePT(cmd(pt, 1));
    const dup = await ptDeactivationService.deactivatePT(cmd(pt, 2));
    assert.equal(retry.complete, true);
    assert.equal(dup.complete, true);
    assert.deepEqual(retry.outcomes, [], "the contract is already done — nothing to redo");
    assert.equal(s.calls.length, 1, "the contract is not refunded twice");

    const u1 = await ptDeactivationService.reactivatePT(cmd(pt, 3));
    const u1again = await ptDeactivationService.reactivatePT(cmd(pt, 3));
    const u2 = await ptDeactivationService.reactivatePT(cmd(pt, 4));
    assert.equal(u1.duplicate, false);
    assert.equal(u1again.duplicate, true);
    assert.equal(u2.duplicate, true, "already unlocked → no state change");
    assert.deepEqual(await profileOf(pt), { ptSuspended: false, ptLockSeq: 4n });
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("a lock superseded WHILE it is running stops before the next contract and reports stale", { skip }, async () => {
  const pt = await makePt();
  const c1 = await makeContract(pt, { createdAt: new Date(Date.now() - 2000) });
  const c2 = await makeContract(pt, { createdAt: new Date(Date.now() - 1000) });
  const s = stubs(async () => {
    // The admin unlocks while the first contract is being refunded.
    await ptDeactivationService.reactivatePT(cmd(pt, 11));
    return { refund: "1000000.00" };
  });
  try {
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 10));
    assert.equal(res.stale, true);
    assert.equal(res.complete, true);
    // contracts are processed newest first: c2 then c1
    assert.deepEqual(res.outcomes.map((o) => o.status).sort(), ["NOT_ATTEMPTED_SUPERSEDED", "REFUNDED"]);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(await profileOf(pt), { ptSuspended: false, ptLockSeq: 11n });
    const open = await prisma.contract.count({ where: { id: { in: [c1.id, c2.id] }, status: "ACTIVE" } });
    assert.equal(open, 1, "the untouched contract stays ACTIVE");
  } finally {
    s.restore();
    await cleanup(pt, [c1.id, c2.id]);
  }
});

// ── item 1: per-unit outcomes, partial failure, retry ────────────────────────────────────────

test("one contract's refund fails → the command is NOT complete, that contract stays open, the others finish, the admin is told once; the retry finishes it with the same idempotency key", { skip }, async () => {
  const pt = await makePt();
  const bad = await makeContract(pt, { createdAt: new Date(Date.now() - 2000) });
  const good = await makeContract(pt, { createdAt: new Date(Date.now() - 1000) });
  let failBad = true;
  const notified: any[] = [];
  const s = stubs(async (body) => {
    if (failBad && body.transactionId === bad.paymentTransactionId) throw new Error("payment-service 503");
    return { refund: "2500000.00" };
  }, notified);
  try {
    const first = await ptDeactivationService.deactivatePT(cmd(pt, 20));
    assert.equal(first.complete, false);
    const byId = Object.fromEntries(first.outcomes.map((o) => [o.contractId, o]));
    assert.equal(byId[bad.id].status, "FAILED");
    assert.match(byId[bad.id].reason ?? "", /503/);
    assert.equal(byId[good.id].status, "REFUNDED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } })).status, "ACTIVE", "needs processing == still open");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: good.id } })).status, "CANCELLED");
    assert.equal(notified.filter((n) => n.eventType === "REFUND_NEEDS_MANUAL_SETTLEMENT").length, 1);

    // Retry (what the relay sweep does): same seq, payment-service is back.
    failBad = false;
    s.calls.length = 0;
    const second = await ptDeactivationService.deactivatePT(cmd(pt, 20));
    assert.equal(second.complete, true);
    assert.deepEqual(second.outcomes.map((o) => [o.contractId, o.status]), [[bad.id, "REFUNDED"]]);
    assert.equal(s.calls.length, 1, "only the unfinished contract is sent again");
    assert.equal(s.calls[0].idempotencyKey, `CONTRACT_TERMINATE:${bad.id}`);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: bad.id } })).status, "CANCELLED");

    // A third call changes nothing.
    s.calls.length = 0;
    const third = await ptDeactivationService.deactivatePT(cmd(pt, 20));
    assert.equal(third.complete, true);
    assert.equal(s.calls.length, 0);

    // The per-contract outcomes are in the audit trail.
    const trail = await prisma.auditLog.findMany({ where: { entityId: { in: [bad.id, good.id] } }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      trail.map((t) => [t.entityId === bad.id ? "bad" : "good", t.action]).sort().map((x) => x.join(":")),
      ["bad:PT_LOCK_CONTRACT_UNWIND_FAILED", "bad:PT_LOCK_CONTRACT_UNWOUND", "good:PT_LOCK_CONTRACT_UNWOUND"],
    );
  } finally {
    s.restore();
    await cleanup(pt, [bad.id, good.id]);
  }
});

test("a repeated failure of the same contract under the same command does not re-notify the admin", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const notified: any[] = [];
  const s = stubs(async () => {
    throw new Error("boom");
  }, notified);
  try {
    await ptDeactivationService.deactivatePT(cmd(pt, 30));
    await ptDeactivationService.deactivatePT(cmd(pt, 30));
    await ptDeactivationService.deactivatePT(cmd(pt, 30));
    assert.equal(notified.length, 1);
    const failures = await prisma.auditLog.count({ where: { entityId: c.id, action: "PT_LOCK_CONTRACT_UNWIND_FAILED" } });
    assert.equal(failures, 3, "every failed attempt is still recorded");
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

// ── item 3: actor and reason ─────────────────────────────────────────────────────────────────

test("lock and unlock store the admin and the reason; a missing reason is stored as null, not rejected", { skip }, async () => {
  const pt = await makePt();
  const s = stubs();
  try {
    await ptDeactivationService.deactivatePT(cmd(pt, 40, { reason: "gian lận" }));
    await ptDeactivationService.reactivatePT(cmd(pt, 41, { reason: null, adminId: "admin-2" }));
    const trail = await prisma.auditLog.findMany({ where: { entityId: pt, entityType: "PT_PROFILE" }, orderBy: { createdAt: "asc" } });
    assert.equal(trail.length, 2);
    assert.equal(trail[0].action, "PT_LOCKED");
    assert.equal(trail[0].actorUserId, "admin-1");
    assert.equal((trail[0].metadata as any).reason, "gian lận");
    assert.equal((trail[0].metadata as any).seq, "40");
    assert.equal(trail[1].action, "PT_UNLOCKED");
    assert.equal(trail[1].actorUserId, "admin-2");
    assert.equal((trail[1].metadata as any).reason, null);
  } finally {
    s.restore();
    await cleanup(pt, []);
  }
});

test("the admin's reason becomes the client-facing cancellation reason; with none, the default text", { skip }, async () => {
  const pt = await makePt();
  const withReason = await makeContract(pt, { createdAt: new Date(Date.now() - 2000) });
  const s = stubs();
  try {
    await ptDeactivationService.deactivatePT(cmd(pt, 50, { reason: "  vi phạm  " }));
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: withReason.id } })).cancellationReason, "vi phạm");

    const pt2 = await makePt();
    const noReason = await makeContract(pt2);
    await ptDeactivationService.deactivatePT(cmd(pt2, 51, { reason: null }));
    assert.equal(
      (await prisma.contract.findUniqueOrThrow({ where: { id: noReason.id } })).cancellationReason,
      "Tài khoản huấn luyện viên bị khoá",
    );
    await cleanup(pt2, [noReason.id]);
  } finally {
    s.restore();
    await cleanup(pt, [withReason.id]);
  }
});

// ── item 4 + item 5 (sessions) ───────────────────────────────────────────────────────────────

test("Decision A (D52): a PT_NO_SHOW_REPORTED session is HELD by the ban (DISPUTED / PT_NO_SHOW_CLAIM): quota untouched, nobody marked at fault, report left on the row, audited", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2, compensatedSessions: 1 });
  const reported = await addSession(c, "PT_NO_SHOW_REPORTED", -1);
  await prisma.session.update({ where: { id: reported.id }, data: { disputeReason: "PT không tới", disputedAt: new Date() } });
  const confirmed = await addSession(c, "CONFIRMED");
  const done = await addSession(c, "COMPLETED", -5);
  const s = stubs();
  try {
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 60));
    assert.equal(res.complete, true);
    assert.equal(res.outcomes[0].cancelledSessions, 1, "only the not-started session is called off; the unanswered report is held");

    const after = await prisma.session.findMany({ where: { contractId: c.id } });
    const get = (id: string) => after.find((x) => x.id === id)!;
    assert.equal(get(reported.id).status, "DISPUTED");
    assert.equal(get(reported.id).disputeType, "PT_NO_SHOW_CLAIM");
    assert.equal(get(reported.id).cancelledBy, null, "not cancelled by anyone");
    assert.equal(get(reported.id).ptAtFault, false, "the PT is not penalised for an unanswered report");
    assert.equal(get(reported.id).disputeReason, "PT không tới", "the client's report stays on record");
    assert.equal(get(confirmed.id).status, "CANCELLED");
    assert.equal(get(done.id).status, "COMPLETED", "a delivered session is not touched");

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(contract.usedSessions, 2, "quota untouched");
    assert.equal(contract.compensatedSessions, 1, "no no-show compensation recorded");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: reported.id, action: "SESSION_NO_SHOW_REPORT_HELD_CONTRACT_ENDED" } });
    assert.equal((audit.metadata as any).statusBefore, "PT_NO_SHOW_REPORTED");
    assert.equal((audit.metadata as any).decision, "HELD_FOR_ADMIN_RULING");
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("session cancellation is conditional on the session's current state: a session that moved on after it was read is not overwritten", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const racing = await addSession(c, "PENDING_CLIENT_CONFIRMATION", -1);
  const s = stubs();
  // The unwind reads the session as PENDING_CLIENT_CONFIRMATION; before it writes, the client
  // confirms it (COMPLETED). The CAS must lose and the COMPLETED status must survive.
  const original = sessionRepository.findByContractInStatuses;
  let first = true;
  const restoreFind = patch(sessionRepository, "findByContractInStatuses", async (contractId: string, statuses: any) => {
    const rows = await original(contractId, statuses);
    if (first) {
      first = false;
      await prisma.session.update({ where: { id: racing.id }, data: { status: "COMPLETED" } });
    }
    return rows;
  });
  try {
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 70));
    assert.equal(res.complete, true);
    assert.equal(res.outcomes[0].cancelledSessions, 0);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: racing.id } });
    assert.equal(after.status, "COMPLETED");
    assert.equal(after.cancelledBy, null);
  } finally {
    restoreFind();
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("sessions the unwind cancels are SYSTEM cancellations: the idle-holdback clock does not count them as PT activity", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { ptHoldbackRate: "0.10", startDate: new Date(Date.now() - 60 * DAY) });
  // Cancelled-by-PT-id counts as activity in findIdleHoldbackCandidates; cancelledBy SYSTEM must not.
  const recent = await addSession(c, "CONFIRMED", -3);
  const s = stubs();
  try {
    // Only the sessions' state matters here: cancel through the unwind's own helper (not the whole
    // lock, which would also terminate the contract and take it out of the candidate list).
    await ptDeactivationService.cancelOpenSessions(c, "Tài khoản huấn luyện viên bị khoá");
    const row = await prisma.session.findUniqueOrThrow({ where: { id: recent.id } });
    assert.equal(row.status, "CANCELLED");
    assert.equal(row.cancelledBy, "SYSTEM");
    assert.notEqual(row.cancelledBy, row.ptUserId);

    const cutoff = new Date(Date.now() - 30 * DAY);
    const candidates = await contractRepository.findIdleHoldbackCandidates({ activatedBefore: cutoff, sessionsSince: cutoff, id: c.id });
    assert.equal(candidates.length, 1, "the unwind's cancellation does not keep the idle clock from running");

    // Control: the same session cancelled BY THE PT would have counted.
    await prisma.session.update({ where: { id: recent.id }, data: { cancelledBy: pt } });
    const counted = await contractRepository.findIdleHoldbackCandidates({ activatedBefore: cutoff, sessionsSince: cutoff, id: c.id });
    assert.equal(counted.length, 0, "control: a PT-id cancellation does count");
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("a contract that is only waiting for payment (no money) is cancelled with no refund, and the client is told", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null });
  const notified: any[] = [];
  const s = stubs(undefined, notified);
  try {
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 80));
    assert.equal(res.complete, true);
    assert.equal(res.outcomes[0].status, "CANCELLED_NO_REFUND");
    assert.equal(s.calls.length, 0);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, "PT_BANNED");
    assert.equal(after.cancelledBy, "SYSTEM");
    assert.equal(notified.filter((n) => n.eventType === "CONTRACT_CANCELLED_PT_DEACTIVATED").length, 1);
  } finally {
    s.restore();
    await cleanup(pt, [c.id]);
  }
});

test("payment activates a PENDING_PAYMENT contract DURING the lock: it is refunded through the ledger and the run is complete", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null });
  const txn = `txn-${randomUUID()}`;
  const s = stubs();
  const original = contractRepository.findById;
  let reads = 0;
  const restoreFind = patch(contractRepository, "findById", async (id: string) => {
    const row = await original(id);
    if (id === c.id && ++reads === 1) await contractRepository.activateIfPendingGuarded(c.id, txn);
    return row;
  });
  try {
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 90));
    assert.equal(res.complete, true);
    assert.equal(res.outcomes[0].status, "REFUNDED");
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].transactionId, txn);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.paymentTransactionId, txn);
  } finally {
    restoreFind();
    s.restore();
    await cleanup(pt, [c.id]);
  }
});
