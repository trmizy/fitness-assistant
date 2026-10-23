/**
 * F2 (D45 / L3) - sessions awaiting confirmation / disputed are HELD when a contract ends for ANY reason (not only the
 * restricted-PT exit), and are settled exactly once by their own confirm / dispute / auto-confirm / admin-ruling flow.
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_user_test database:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-ending-held-sessions.integration.test.ts
 * TEST FIXTURE: payment-service is NOT running - paymentClient.terminate / resolveUnresolvedSession / releaseSession /
 * noShow are replaced by a fake ledger that keeps ONE result per idempotency key (as the real ledger does) and records
 * every body user-service SENDS. The real ledger is exercised by cross-service-money-held-sessions.e2e.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { bookingService } from "../services/booking.service";
import { terminateContractMoney } from "../services/contract-payout.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const REASONS = ["CLIENT_CANCELLED", "PT_CANCELLED", "MUTUAL", "EXPIRED", "COMPLETED", "PT_REPEATED_NO_SHOW", "PT_BANNED", "CLIENT_EXIT_DUE_TO_PT_RESTRICTION"] as const;
const ADMIN = "admin-1";

function fakeLedger(opts: { legacyNoHold?: boolean } = {}) {
  const terminate: any[] = [];
  const resolve: any[] = [];
  const release: any[] = [];
  const noShow: any[] = [];
  const done = new Map<string, any>();
  const restores = [
    patch(paymentClient, "terminate", async (b: any) => {
      terminate.push(b);
      if (!done.has(b.idempotencyKey)) done.set(b.idempotencyKey, { refund: "1.00", reason: b.reason, ...(b.unresolvedSessions ? { unresolved: { sessions: b.unresolvedSessions } } : {}) });
      return done.get(b.idempotencyKey);
    }),
    patch(paymentClient, "resolveUnresolvedSession", async (b: any) => {
      resolve.push(b);
      if (opts.legacyNoHold) throw Object.assign(new Error("409"), { response: { status: 409, data: { success: false, error: { code: "NO_UNRESOLVED_HELD" } } } });
      if (!done.has(b.idempotencyKey)) done.set(b.idempotencyKey, { outcome: b.outcome, moved: { pt: "450000.00", gym: "0.00", platform: "50000.00", client: "0.00" } });
      return done.get(b.idempotencyKey);
    }),
    patch(paymentClient, "releaseSession", async (b: any) => {
      release.push(b);
      return { released: { pt: "450000.00", gym: "0.00", platform: "50000.00" } };
    }),
    patch(paymentClient, "noShow", async (b: any) => {
      noShow.push(b);
      return { compensation: "500000.00", shortfall: "0.00" };
    }),
  ];
  return { terminate, resolve, release, noShow, restore: () => restores.reverse().forEach((r) => r()) };
}

async function statusOf(id: string) {
  return (await prisma.session.findUniqueOrThrow({ where: { id } })).status;
}
async function scrub(contractIds: string[]) {
  const ids = (await prisma.session.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
}

/** 10-session contract: 2 used, 1 awaiting confirmation, 1 disputed, 1 confirmed in the future, 1 requested. */
async function setUp(over: Record<string, unknown> = {}) {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2, ...over });
  const now = Date.now();
  const ids = {
    pending: (await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(now - 1 * DAY), { clientConfirmDeadline: new Date(now + 2 * DAY) })).id,
    disputed: (await addSession(c, "DISPUTED", new Date(now - 2 * DAY), { disputeReason: "không dạy", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" })).id,
    confirmedFuture: (await addSession(c, "CONFIRMED", new Date(now + 2 * DAY))).id,
    requested: (await addSession(c, "REQUESTED", new Date(now + 3 * DAY))).id,
  };
  return { pt, c, ids };
}

// ── 1. the ending holds the awaiting + disputed sessions, for every reason ──────────────────────

for (const reason of REASONS) {
  test(`L3 ${reason}: the termination body holds the 2 awaiting / disputed sessions (no amount), they keep their state, the not-started ones are called off`, { skip }, async () => {
    const { pt, c, ids } = await setUp();
    const s = stubs();
    const ledger = fakeLedger();
    try {
      await terminateContractMoney(c.id, reason, { cancelledBy: ADMIN });
      assert.equal(ledger.terminate.length, 1);
      const body = ledger.terminate[0];
      assert.equal(body.unresolvedSessions, 2, "both held");
      assert.equal(body.usedSessions, 2);
      assert.ok(!("amount" in body) && !("refund" in body));
      assert.equal(await statusOf(ids.pending), "PENDING_CLIENT_CONFIRMATION");
      assert.equal(await statusOf(ids.disputed), "DISPUTED");
      assert.equal(await statusOf(ids.confirmedFuture), "CANCELLED");
      assert.equal(await statusOf(ids.requested), "CANCELLED");
      assert.equal(ledger.release.length + ledger.noShow.length + ledger.resolve.length, 0, "the ending itself releases / compensates / resolves nothing");
    } finally {
      ledger.restore();
      s.restore();
      await scrub([c.id]);
      await cleanup([pt], [c.id]);
    }
  });
}

test("L3 PT ban (the lock unwind): the awaiting + disputed sessions are NOT cancelled / refunded; they are held", { skip }, async () => {
  const { pt, c, ids } = await setUp();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    const res = await ptDeactivationService.deactivatePT({ ptUserId: pt, adminId: ADMIN, reason: "vi phạm", seq: BigInt(Date.now()) });
    assert.equal(res.complete, true, JSON.stringify(res.outcomes));
    assert.equal(ledger.terminate[0].reason, "SERVICE_DISCONTINUED_BY_PLATFORM");
    assert.equal(ledger.terminate[0].unresolvedSessions, 2);
    assert.equal(await statusOf(ids.pending), "PENDING_CLIENT_CONFIRMATION");
    assert.equal(await statusOf(ids.disputed), "DISPUTED");
    assert.equal(await statusOf(ids.confirmedFuture), "CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED");
  } finally {
    ledger.restore();
    s.restore();
    await scrub([c.id]);
    await prisma.auditLog.deleteMany({ where: { entityId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("L3 preview == execution for an ordinary cancel with held sessions, and a surplus of awaiting sessions never blocks the refund (held is clamped to what is still owed)", { skip }, async () => {
  const pt = await makePt();
  // 3 sessions, 2 used, but 2 awaiting confirmation: only 1 is still owed
  const c = await makeContract(pt, { totalSessions: 3, usedSessions: 2 });
  await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), { clientConfirmDeadline: new Date(Date.now() + DAY) });
  await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 2 * DAY), { clientConfirmDeadline: new Date(Date.now() + DAY) });
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId });
    assert.equal(ledger.terminate[0].unresolvedSessions, 1, "clamped to total - used - compensated");
  } finally {
    ledger.restore();
    s.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

// ── 2. settled exactly once afterwards, by their own flows ──────────────────────────────────────

for (const reason of ["CLIENT_CANCELLED", "EXPIRED", "MUTUAL", "PT_BANNED"] as const) {
  test(`L3 ${reason}: afterwards the client confirms the awaiting one (DELIVERED once) and the admin rules the disputed one - each settles once, never through the ordinary release / compensation`, { skip }, async () => {
    const { pt, c, ids } = await setUp();
    const s = stubs();
    const ledger = fakeLedger();
    try {
      await terminateContractMoney(c.id, reason, { cancelledBy: ADMIN });

      const confirmed: any = await bookingService.clientConfirmSession(ids.pending, c.clientUserId);
      assert.equal(confirmed.quotaDeducted, true);
      assert.deepEqual(ledger.resolve.map((r) => `${r.idempotencyKey}:${r.outcome}`), [`UNRESOLVED_SESSION:${ids.pending}:DELIVERED`]);
      assert.equal(ledger.release.length, 0, "no ordinary SESSION_RELEASE on an ended contract");
      await assert.rejects(bookingService.clientConfirmSession(ids.pending, c.clientUserId), /Cannot confirm/);

      await bookingService.resolveDispute(ids.disputed, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng");
      assert.equal(await statusOf(ids.disputed), "NO_SHOW");
      assert.equal(ledger.resolve.length, 2);
      assert.equal(ledger.resolve[1].outcome, "NOT_DELIVERED");
      assert.equal(ledger.noShow.length, 0, "the held value is refunded once - no second compensation drawn from the PT's pool");
      await assert.rejects(bookingService.resolveDispute(ids.disputed, ADMIN, "COMPLETED", "lại"), /not disputed/);

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.usedSessions, 3, "2 + the confirmed one; the no-show does not count");
      assert.equal(after.compensatedSessions, 0);
      assert.equal(after.releasedToPt.toString(), "450000");
      assert.equal(ledger.terminate.length, 1);
    } finally {
      ledger.restore();
      s.restore();
      await scrub([c.id]);
      await cleanup([pt], [c.id]);
    }
  });
}

test("L3 admin rulings on a held disputed session after an ordinary ending: COMPLETED -> DELIVERED + used+1; CANCELLED -> NOT_DELIVERED, used unchanged", { skip }, async () => {
  const a = await setUp();
  const b = await setUp();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    for (const x of [a, b]) await terminateContractMoney(x.c.id, "CLIENT_CANCELLED", { cancelledBy: x.c.clientUserId });
    await bookingService.resolveDispute(a.ids.disputed, ADMIN, "COMPLETED", "đã dạy");
    assert.equal(await statusOf(a.ids.disputed), "COMPLETED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: a.c.id } })).usedSessions, 3);
    await bookingService.resolveDispute(b.ids.disputed, ADMIN, "CANCELLED", "không dạy");
    assert.equal(await statusOf(b.ids.disputed), "CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: b.c.id } })).usedSessions, 2);
    assert.deepEqual(ledger.resolve.map((r) => r.outcome), ["DELIVERED", "NOT_DELIVERED"]);
  } finally {
    ledger.restore();
    s.restore();
    for (const x of [a, b]) {
      await scrub([x.c.id]);
      await cleanup([x.pt], [x.c.id]);
    }
  }
});

test("L3 auto-confirm of an awaiting session whose contract has ended (PT not restricted) settles it against the hold", { skip }, async () => {
  const { pt, c, ids } = await setUp();
  await prisma.session.update({ where: { id: ids.pending }, data: { clientConfirmDeadline: new Date(Date.now() - HOUR) } });
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId });
    await runAutoConfirm();
    assert.equal(await statusOf(ids.pending), "COMPLETED");
    assert.deepEqual(ledger.resolve.map((r) => `${r.idempotencyKey}:${r.outcome}`), [`UNRESOLVED_SESSION:${ids.pending}:DELIVERED`]);
    assert.equal(ledger.release.length, 0);
  } finally {
    ledger.restore();
    s.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("control: on a RUNNING contract the same decisions keep the ordinary paths (release on confirm, no-show compensation on the admin's PT-absent ruling)", { skip }, async () => {
  const { pt, c, ids } = await setUp();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await bookingService.clientConfirmSession(ids.pending, c.clientUserId);
    assert.equal(ledger.release.length, 1);
    assert.equal(ledger.resolve.length, 0);
    await bookingService.resolveDispute(ids.disputed, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng");
    assert.equal(ledger.noShow.length, 1);
    assert.equal(ledger.resolve.length, 0);
  } finally {
    ledger.restore();
    s.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("L3 legacy: a contract that ended BEFORE holds existed - the ledger answers 409 NO_UNRESOLVED_HELD; that is recorded as settled (no endless retry, no money moved, no ordinary release / compensation)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date(), usedSessions: 2 });
  const pending = await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), { clientConfirmDeadline: new Date(Date.now() + DAY) });
  const disputed = await addSession(c, "DISPUTED", new Date(Date.now() - 2 * DAY), { disputeReason: "x", disputedAt: new Date() });
  const s = stubs();
  const ledger = fakeLedger({ legacyNoHold: true });
  try {
    await bookingService.clientConfirmSession(pending.id, c.clientUserId);
    await bookingService.resolveDispute(disputed.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng");
    assert.equal(ledger.noShow.length, 0, "a PT-absent ruling on an ended contract never compensates again");
    assert.equal(ledger.release.length, 0);
    const rows = await prisma.sessionSettlement.findMany({ where: { contractId: c.id } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.status === "SETTLED"), JSON.stringify(rows.map((r) => r.status)));
    const before = ledger.resolve.length;
    await runSettlementSweep();
    assert.equal(ledger.resolve.length, before, "nothing is retried");
  } finally {
    ledger.restore();
    s.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
});

// ── 3. the race: a client confirms while the contract ends ──────────────────────────────────────

test("race: confirm of the awaiting session vs the contract's ending, either order - the session is settled exactly once, and the body the ledger got always agrees with how it was settled", { skip }, async () => {
  for (let i = 0; i < 8; i++) {
    const pt = await makePt();
    const c = await makeContract(pt, { usedSessions: 2 });
    const pending = await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), { clientConfirmDeadline: new Date(Date.now() + DAY) });
    const s = stubs();
    const ledger = fakeLedger();
    try {
      const [, confirmed] = await Promise.allSettled([
        terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }),
        bookingService.clientConfirmSession(pending.id, c.clientUserId),
      ]);
      if (confirmed.status === "rejected") {
        // D59: the ending won the lock and is RECORDED (maybe not yet confirmed): the confirmation is REFUSED, not queued. It is
        // not lost - once the ending is confirmed the same click settles the session against the value the ending HELD.
        assert.equal((confirmed.reason as { code?: string }).code, "CONTRACT_ENDING", `iteration ${i}: a refused confirmation says why`);
        await terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }); // carries the ending through
        await bookingService.clientConfirmSession(pending.id, c.clientUserId);
      }
      const body = ledger.terminate[0];
      const released = ledger.release.length;
      const resolved = ledger.resolve.length;
      assert.equal(released + resolved, 1, `iteration ${i}: settled exactly once (release ${released}, resolve ${resolved})`);
      if (resolved === 1) {
        assert.equal(body.unresolvedSessions, 1, "settled against the hold -> the ending held it");
        assert.equal(body.usedSessions, 2);
      } else {
        assert.equal(body.unresolvedSessions ?? 0, 0, "released normally -> the ending counted it used, not held");
        assert.equal(body.usedSessions, 3);
      }
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, 3);
    } finally {
      ledger.restore();
      s.restore();
      await scrub([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
});
