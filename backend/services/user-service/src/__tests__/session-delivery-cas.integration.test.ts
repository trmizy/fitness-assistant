/**
 * F3 - the client's confirmation, the auto-confirm sweep and the admin's COMPLETED ruling are ONE compare-and-set on the
 * session (status must still be what was read AND sessionDeducted false -> true, in the same UPDATE). A session that
 * is CANCELLED, DISPUTED, ruled or already settled is never overwritten, charged or paid by a stale confirmation.
 * (Before: the only guard was `sessionDeducted`; the status was then written UNCONDITIONALLY - a cancelled / disputed
 * session ended up COMPLETED, or COMPLETED with the money already gone.)
 *
 * Evidence labels: BACKEND INTEGRATION against the isolated gymcoach_user_test database (real services, real races
 * via Promise.all):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/session-delivery-cas.integration.test.ts
 * TEST FIXTURE: payment-service is NOT running; paymentClient is a fake that records every call and keeps one result per
 * idempotency key. The real ledger is exercised by cross-service-money-delivery-cas.e2e.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { sessionRepository } from "../repositories/session.repository";
import { bookingService } from "../services/booking.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const ADMIN = "admin-1";

function fakeLedger() {
  const release: any[] = [];
  const resolve: any[] = [];
  const noShow: any[] = [];
  const restores = [
    patch(paymentClient, "releaseSession", async (b: any) => {
      release.push(b);
      return { released: { pt: "450000.00", gym: "0.00", platform: "50000.00" } };
    }),
    patch(paymentClient, "resolveUnresolvedSession", async (b: any) => {
      resolve.push(b);
      return { moved: { pt: "450000.00", gym: "0.00", platform: "50000.00", client: "0.00" } };
    }),
    patch(paymentClient, "noShow", async (b: any) => {
      noShow.push(b);
      return { compensation: "500000.00", shortfall: "0.00" };
    }),
  ];
  return { release, resolve, noShow, money: () => release.length + resolve.length + noShow.length, restore: () => restores.reverse().forEach((r) => r()) };
}

const rowOf = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const used = async (id: string) => (await prisma.contract.findUniqueOrThrow({ where: { id } })).usedSessions;
async function scrub(contractIds: string[]) {
  const ids = (await prisma.session.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
}

async function withPending<T>(fn: (x: { pt: string; c: any; s: any }) => Promise<T>, over: { status?: string; extra?: Record<string, unknown> } = {}) {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = await addSession(c, over.status ?? "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - DAY), {
    clientConfirmDeadline: new Date(Date.now() - HOUR),
    ...(over.extra ?? {}),
  });
  const st = stubs();
  const ledger = fakeLedger();
  try {
    return await fn({ pt, c, s });
  } finally {
    ledger.restore();
    st.restore();
    await scrub([c.id]);
    await cleanup([pt], [c.id]);
  }
}

// ── a stale confirmation can never overwrite a session that moved on ────────────────────────────

for (const moved of [
  { name: "DISPUTED (the client disputed it)", status: "DISPUTED", extra: { disputeReason: "x", disputedAt: new Date() } },
  { name: "CANCELLED (an admin / the contract's ending closed it)", status: "CANCELLED", extra: { cancelledBy: "ADMIN", cancellationReason: "huỷ" } },
  { name: "NO_SHOW (ruled the PT absent)", status: "NO_SHOW", extra: { ptAtFault: true } },
]) {
  test(`F3 client confirm with a STALE read of a session that is now ${moved.name}: refused 409, status / quota / money untouched`, { skip }, async () => {
    await withPending(
      async ({ c, s }) => {
        const ledger = fakeLedger();
        const stale = { ...s, status: "PENDING_CLIENT_CONFIRMATION" };
        const restore = patch(sessionRepository, "findById", async () => stale as any);
        try {
          // the guard at the top of clientConfirmSession reads PENDING (stale); only the compare-and-set can save the row
          await assert.rejects(bookingService.clientConfirmSession(s.id, c.clientUserId), (e: any) => e.status === 409);
        } finally {
          restore();
          ledger.restore();
        }
        const row = await rowOf(s.id);
        assert.equal(row.status, moved.status, "not overwritten");
        assert.equal(row.sessionDeducted, false);
        assert.equal(await used(c.id), 2, "no quota");
        assert.equal(ledger.money(), 0, "no money");
      },
      { status: moved.status, extra: moved.extra },
    );
  });

  test(`F3 auto-confirm sweep with a STALE row of a session that is now ${moved.name}: not confirmed, not overwritten, no money`, { skip }, async () => {
    await withPending(
      async ({ c, s }) => {
        const ledger = fakeLedger();
        try {
          const result = await runAutoConfirm({
            findExpiredPendingConfirmation: async () => [{ id: s.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId }],
            deductQuotaOnce: async (sid, cid, transition) => (await import("../services/booking.service")).deductQuotaOnce(sid, cid, undefined, transition),
            notify: async () => undefined,
          });
          assert.equal(result.confirmed, 0);
        } finally {
          ledger.restore();
        }
        const row = await rowOf(s.id);
        assert.equal(row.status, moved.status);
        assert.equal(row.autoConfirmed, false);
        assert.equal(await used(c.id), 2);
        assert.equal(ledger.money(), 0);
      },
      { status: moved.status, extra: moved.extra },
    );
  });
}

test("F3 admin COMPLETED ruling with a STALE read of a session that is no longer disputed (already ruled CANCELLED): refused 409, nothing overwritten, no quota, no money", { skip }, async () => {
  await withPending(
    async ({ c, s }) => {
      const ledger = fakeLedger();
      const stale = { ...s, status: "DISPUTED" };
      const restore = patch(sessionRepository, "findById", async () => stale as any);
      try {
        await assert.rejects(bookingService.resolveDispute(s.id, ADMIN, "COMPLETED", "đã dạy"), (e: any) => e.status === 409);
        await assert.rejects(bookingService.resolveDispute(s.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng"), (e: any) => e.status === 409);
        await assert.rejects(bookingService.resolveDispute(s.id, ADMIN, "CANCELLED", "huỷ"), (e: any) => e.status === 409);
      } finally {
        restore();
        ledger.restore();
      }
      assert.equal((await rowOf(s.id)).status, "CANCELLED");
      assert.equal(await used(c.id), 2);
      assert.equal(ledger.money(), 0);
    },
    { status: "CANCELLED", extra: { cancelledBy: "ADMIN", cancellationReason: "huỷ" } },
  );
});

test("F3 a session that is already settled (COMPLETED + deducted) is never settled a second time: confirm again is an idempotent no-op, a ruling is refused", { skip }, async () => {
  await withPending(async ({ c, s }) => {
    const ledger = fakeLedger();
    try {
      const first: any = await bookingService.clientConfirmSession(s.id, c.clientUserId);
      assert.equal(first.quotaDeducted, true);
      assert.equal(ledger.release.length, 1);
      assert.equal(await used(c.id), 3);
      // a stale second click (the page still showed PENDING)
      // only the FIRST read is stale (the page still showed PENDING); the re-read after the claim sees the truth
      const real = sessionRepository.findById;
      let reads = 0;
      const restore = patch(sessionRepository, "findById", async (id: string) => {
        const row = await real(id);
        return (reads++ === 0 ? { ...row, status: "PENDING_CLIENT_CONFIRMATION" } : row) as any;
      });
      try {
        const again: any = await bookingService.clientConfirmSession(s.id, c.clientUserId);
        assert.equal(again.quotaDeducted, false);
      } finally {
        restore();
      }
      await assert.rejects(bookingService.resolveDispute(s.id, ADMIN, "COMPLETED", "lại"), /không ở trạng thái đang khiếu nại/);
      assert.equal(ledger.release.length, 1, "exactly one ledger transaction for the session");
      assert.equal(await used(c.id), 3);
    } finally {
      ledger.restore();
    }
  });
});

// ── real races ──────────────────────────────────────────────────────────────────────────────────

test("race: the client confirms while the client disputes the same session - exactly one wins, and the loser changes nothing", { skip }, async () => {
  for (let i = 0; i < 10; i++) {
    await withPending(async ({ c, s }) => {
      const ledger = fakeLedger();
      try {
        const [conf, disp] = await Promise.allSettled([
          bookingService.clientConfirmSession(s.id, c.clientUserId),
          bookingService.disputeSession(s.id, c.clientUserId, "không đúng"),
        ]);
        const row = await rowOf(s.id);
        assert.equal([conf.status, disp.status].filter((x) => x === "fulfilled").length, 1, `iteration ${i}: exactly one side won`);
        if (conf.status === "fulfilled") {
          assert.deepEqual([row.status, row.sessionDeducted], ["COMPLETED", true]);
          assert.equal(ledger.release.length, 1);
          assert.equal(await used(c.id), 3);
        } else {
          assert.deepEqual([row.status, row.sessionDeducted], ["DISPUTED", false]);
          assert.equal(ledger.money(), 0, "a disputed session moves no money and no quota");
          assert.equal(await used(c.id), 2);
        }
      } finally {
        ledger.restore();
      }
    });
  }
});

test("race: the auto-confirm sweep vs the client's dispute - the dispute is never overwritten and never paid; if the sweep won, the dispute is refused", { skip }, async () => {
  for (let i = 0; i < 10; i++) {
    await withPending(async ({ c, s }) => {
      const ledger = fakeLedger();
      try {
        const sweep = runAutoConfirm({
          findExpiredPendingConfirmation: async () => [{ id: s.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId }],
          deductQuotaOnce: async (sid, cid, transition) => (await import("../services/booking.service")).deductQuotaOnce(sid, cid, undefined, transition),
          notify: async () => undefined,
        });
        const [, disp] = await Promise.allSettled([sweep, bookingService.disputeSession(s.id, c.clientUserId, "không đúng")]);
        const row = await rowOf(s.id);
        if (disp.status === "fulfilled") {
          assert.deepEqual([row.status, row.autoConfirmed], ["DISPUTED", false], `iteration ${i}`);
          assert.equal(ledger.money(), 0);
          assert.equal(await used(c.id), 2);
        } else {
          assert.deepEqual([row.status, row.autoConfirmed, row.sessionDeducted], ["COMPLETED", true, true]);
          assert.equal(ledger.release.length, 1);
        }
      } finally {
        ledger.restore();
      }
    });
  }
});

test("race: two admins rule the same disputed session two ways at once - exactly one ruling, one money step", { skip }, async () => {
  for (let i = 0; i < 8; i++) {
    await withPending(
      async ({ c, s }) => {
        const ledger = fakeLedger();
        try {
          const [a, b] = await Promise.allSettled([
            bookingService.resolveDispute(s.id, ADMIN, "COMPLETED", "đã dạy"),
            bookingService.resolveDispute(s.id, "admin-2", "PT_NO_SHOW_CONFIRMED", "PT vắng"),
          ]);
          assert.equal([a.status, b.status].filter((x) => x === "fulfilled").length, 1, `iteration ${i}`);
          const row = await rowOf(s.id);
          if (a.status === "fulfilled") {
            assert.deepEqual([row.status, row.sessionDeducted], ["COMPLETED", true]);
            assert.equal(ledger.release.length, 1);
            assert.equal(ledger.noShow.length, 0);
            assert.equal(await used(c.id), 3);
          } else {
            assert.equal(row.status, "NO_SHOW");
            assert.equal(ledger.noShow.length, 1, "compensated once");
            assert.equal(ledger.release.length, 0);
            assert.equal(await used(c.id), 2);
          }
        } finally {
          ledger.restore();
        }
      },
      { status: "DISPUTED", extra: { disputeReason: "x", disputedAt: new Date() } },
    );
  }
});

test("race: confirm x2 and the sweep all at once on one awaiting session - one claim, one release, used +1", { skip }, async () => {
  for (let i = 0; i < 6; i++) {
    await withPending(async ({ c, s }) => {
      const ledger = fakeLedger();
      try {
        await Promise.allSettled([
          bookingService.clientConfirmSession(s.id, c.clientUserId),
          bookingService.clientConfirmSession(s.id, c.clientUserId),
          runAutoConfirm({
            findExpiredPendingConfirmation: async () => [{ id: s.id, contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId }],
            deductQuotaOnce: async (sid, cid, transition) => (await import("../services/booking.service")).deductQuotaOnce(sid, cid, undefined, transition),
            notify: async () => undefined,
          }),
        ]);
        assert.equal(ledger.release.length, 1, `iteration ${i}`);
        assert.equal(await used(c.id), 3);
        assert.equal((await rowOf(s.id)).status, "COMPLETED");
      } finally {
        ledger.restore();
      }
    });
  }
});

/**
 * Three outcomes of the unforced race (owner decisions D58/D59), each fully asserted on the final state AND the money:
 *   1. the ruling commits BEFORE the ending's snapshot -> compensated like on a running contract, not held;
 *   2. the ruling commits AFTER the ending is confirmed -> refunds the held value, no second compensation;
 *   3. the ruling arrives while the ending is recorded but not yet confirmed -> REFUSED 409 CONTRACT_ENDING (D59: no money
 *      step may change an obligation of an ending in flight). Nothing moves, the session stays DISPUTED, the ending holds
 *      its value, and a FRESH ruling after the ending is confirmed settles that held value exactly once.
 * The branch 3 is accepted ONLY with that exact rejection; any other rejection of the ruling fails the test.
 * (The terminate stand-in is honest like payment-service: it echoes the reason and the number of held sessions. A stand-in
 * that answers "nothing held" for a held session is - correctly - parked by the product as CONTRACT_ENDING_CONFLICT.)
 */
test("race: the contract ends while an admin rules the disputed session - the ruling settles the HELD value exactly once, never through the ordinary compensation", { skip }, async () => {
  const { terminateContractMoney } = await import("../services/contract-payout.service");
  const branches = { before: 0, after: 0, refusedWhileEnding: 0 };
  for (let i = 0; i < 6; i++) {
    await withPending(
      async ({ c, s }) => {
        const ledger = fakeLedger();
        const termination: any[] = [];
        const r = patch(paymentClient, "terminate", async (b: any) => {
          termination.push(b);
          return {
            refund: "1.00",
            reason: b.reason,
            ...(b.unresolvedSessions > 0
              ? { unresolved: { sessions: b.unresolvedSessions, amountHeld: "500000.00", byParty: { pt: "450000.00", gym: "0.00", platform: "50000.00" } } }
              : {}),
          };
        });
        try {
          const [ending, ruling] = await Promise.allSettled([
            terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }),
            bookingService.resolveDispute(s.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng"),
          ]);
          assert.equal(ending.status, "fulfilled", `iteration ${i}: the ending itself completed (${ending.status === "rejected" ? String((ending.reason as any)?.code ?? ending.reason) : ""})`);
          assert.equal(termination.length, 1, `iteration ${i}: one termination call`);
          const body = termination[0];
          const row = await rowOf(s.id);

          if (ruling.status === "fulfilled") {
            assert.equal(row.status, "NO_SHOW", `iteration ${i}`);
            if (ledger.noShow.length === 1) {
              // ruled BEFORE the ending's snapshot: compensated like on a running contract, and not held
              branches.before++;
              assert.equal(ledger.resolve.length, 0);
              assert.equal(body.unresolvedSessions ?? 0, 0, `iteration ${i}: ruled before -> not held`);
              assert.equal(body.compensatedSessions, 1, `iteration ${i}: and the ending counted the compensation`);
            } else {
              // ruled AFTER the ending: refunds the held value, no second compensation
              branches.after++;
              assert.equal(ledger.noShow.length, 0);
              assert.equal(ledger.resolve.length, 1);
              assert.equal(body.unresolvedSessions, 1, `iteration ${i}: ruled after -> it was held`);
            }
            return;
          }

          // The ruling was rejected: the ONLY acceptable reason is the ending being in flight (D59).
          const e: any = ruling.reason;
          assert.ok(e?.status === 409 && e?.code === "CONTRACT_ENDING", `iteration ${i}: the ruling may only be refused with 409 CONTRACT_ENDING, got ${e?.status} ${e?.code} ${e?.message}`);
          branches.refusedWhileEnding++;
          // nothing moved because of the refused ruling
          assert.equal(row.status, "DISPUTED", `iteration ${i}: the refused ruling left the session DISPUTED`);
          assert.equal(row.resolvedBy, null);
          assert.equal(row.sessionDeducted, false);
          assert.equal(ledger.noShow.length, 0, `iteration ${i}: no ordinary no-show compensation`);
          assert.equal(ledger.resolve.length, 0, `iteration ${i}: no resolve call by the refused ruling`);
          assert.equal(ledger.release.length, 0, `iteration ${i}: nothing released for the disputed session`);
          assert.equal(await used(c.id), 2, "quota untouched");
          // the ending took its snapshot with the session in it: the value is HELD, not refunded / paid
          assert.equal(body.unresolvedSessions, 1, `iteration ${i}: the termination body held the session`);
          assert.equal(body.compensatedSessions ?? 0, 0, `iteration ${i}: nothing compensated by the ending`);

          // after the ending is complete, a fresh ruling settles the held value - exactly once
          await bookingService.resolveDispute(s.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng");
          const ruled = await rowOf(s.id);
          assert.equal(ruled.status, "NO_SHOW", `iteration ${i}: the fresh ruling stands`);
          assert.equal(ruled.resolvedBy, ADMIN);
          assert.equal(ledger.resolve.length, 1, `iteration ${i}: the held value is settled once`);
          assert.equal(ledger.resolve[0].outcome, "NOT_DELIVERED");
          assert.equal(ledger.resolve[0].idempotencyKey, `UNRESOLVED_SESSION:${s.id}`);
          assert.equal(ledger.noShow.length, 0, `iteration ${i}: never through the ordinary compensation`);
          assert.equal(ledger.release.length, 0);
          assert.equal(await used(c.id), 2, "quota untouched");
          // a repeated ruling (any resolution) moves nothing
          await assert.rejects(() => bookingService.resolveDispute(s.id, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng"), (x: any) => x.status === 400 || x.status === 409);
          await assert.rejects(() => bookingService.resolveDispute(s.id, "admin-2", "CANCELLED", "huỷ"), (x: any) => x.status === 400 || x.status === 409);
          assert.equal(ledger.resolve.length, 1, `iteration ${i}: the repeat moved nothing`);
          assert.equal(ledger.noShow.length, 0);
          assert.equal(termination.length, 1, "the ending is not repeated");
          assert.equal((await rowOf(s.id)).status, "NO_SHOW");
        } finally {
          r();
          ledger.restore();
        }
      },
      { status: "DISPUTED", extra: { disputeReason: "x", disputedAt: new Date() } },
    );
  }
  // which branch each iteration took (visible in the TAP output; the three together are all 6 iterations)
  console.log(`RACE-BRANCHES ${JSON.stringify(branches)}`);
});
