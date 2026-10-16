/**
 * Temporary PT suspension (slices 2-3), part 3 — how the temporary suspension and the existing
 * permanent lock (auth-service's lock/unlock command stream, slice 1) share ONE record:
 *   · the permanent lock/unlock now leave PERMANENT_BAN history rows;
 *   · a lock that finds a temporary suspension active CONVERTS it, then runs the unwind;
 *   · an account unlock never lifts a temporary suspension, and a temporary suspension never lifts a ban;
 *   · the profile flag (ptSuspended) is only the mirror of the record — never the other way round;
 *   · a flag set with no row (legacy data) fails CLOSED.
 *
 * Evidence label: BACKEND INTEGRATION against gymcoach_user_test; payment-service and the notification
 * push are stubbed at the client boundary (TEST FIXTURE) — see pt-restriction.test-helpers.ts.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-lock-stream.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import {
  assertPtAcceptsNewBusiness,
  assertPtMayAct,
  getActiveRestriction,
  ptRestrictionService,
} from "../services/pt-restriction.service";
import { DAY, addSession, cleanup, flagMatchesRecord, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";

const cmd = (ptUserId: string, seq: number, extra: Record<string, unknown> = {}) => ({
  ptUserId,
  adminId: "admin-9",
  reason: "vi phạm điều khoản" as string | null,
  seq: BigInt(seq),
  ...extra,
});
const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: "admin-1",
  reasonCategory: "CONDUCT_REVIEW" as const,
  reasonText: "đang xem xét",
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
const episodes = (pt: string) => prisma.ptRestriction.findMany({ where: { ptUserId: pt }, orderBy: { startedAt: "asc" } });

test("the permanent lock and unlock leave PERMANENT_BAN history; repeats and stale commands add nothing; the flag follows the record", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  try {
    const lock = await ptDeactivationService.deactivatePT(cmd(pt, 1));
    assert.equal(lock.complete, true);
    let rows = await episodes(pt);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "PERMANENT_BAN");
    assert.equal(rows[0].imposedBy, "admin-9");
    assert.equal(rows[0].reasonText, "vi phạm điều khoản");
    assert.equal(rows[0].lockSeq, 1n);
    assert.equal(rows[0].endedAt, null);
    assert.ok(await flagMatchesRecord(pt));
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).terminationReason, "PT_BANNED", "the existing unwind still runs");

    await ptDeactivationService.deactivatePT(cmd(pt, 1)); // retry of the very same command
    await ptDeactivationService.deactivatePT(cmd(pt, 2)); // newer lock while already locked
    assert.equal((await episodes(pt)).length, 1, "no second row for a repeat");

    await ptDeactivationService.reactivatePT(cmd(pt, 3, { reason: "khoá nhầm" }));
    rows = await episodes(pt);
    assert.equal(rows[0].endKind, "LIFTED");
    assert.equal(rows[0].liftedBy, "admin-9");
    assert.equal(rows[0].liftReason, "khoá nhầm");
    assert.ok(rows[0].endedAt);
    assert.ok(await flagMatchesRecord(pt));
    await ptDeactivationService.reactivatePT(cmd(pt, 3));
    await ptDeactivationService.reactivatePT(cmd(pt, 4));
    assert.equal((await episodes(pt)).length, 1, "repeated unlocks change nothing");

    const stale = await ptDeactivationService.deactivatePT(cmd(pt, 2)); // old lock arrives after the unlock
    assert.equal(stale.stale, true);
    assert.equal((await episodes(pt)).length, 1, "a stale lock opens nothing");
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);

    await ptDeactivationService.deactivatePT(cmd(pt, 5)); // a later, genuine lock: its own row
    rows = await episodes(pt);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].lockSeq, 5n);
    assert.ok(await flagMatchesRecord(pt));
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("temporary → permanent: the temporary episode is closed at that instant, a permanent one opened, the existing unwind refunds each contract; duplicates and stale commands behave", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const c1 = await makeContract(pt);
  const c2 = await makeContract(pt);
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T - 3 * DAY)));
    const open = await addSession(c1, "PT_NO_SHOW_REPORTED", new Date(T - DAY), { disputeReason: "z" }); // in-flight during the suspension
    assert.equal(s.payments.length, 0);

    const res = await ptDeactivationService.deactivatePT(cmd(pt, 10));
    assert.equal(res.complete, true);
    assert.equal(res.outcomes.length, 2);
    assert.equal(s.payments.filter((p) => p.method === "terminate").length, 2, "each contract is refunded once, through the shared path");

    const rows = await episodes(pt);
    assert.equal(rows.length, 2);
    const [temp, perm] = rows;
    assert.equal(temp.type, "TEMPORARY_SUSPENSION");
    assert.equal(temp.endKind, "CONVERTED_TO_PERMANENT");
    assert.ok(temp.endedAt);
    assert.equal(perm.type, "PERMANENT_BAN");
    assert.equal(perm.endedAt, null);
    assert.ok(perm.startedAt.getTime() >= temp.endedAt!.getTime() - 1 && Math.abs(perm.startedAt.getTime() - temp.endedAt!.getTime()) < 2000, "closed and opened at the same instant");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 1, "never two active");
    assert.ok(await flagMatchesRecord(pt));
    for (const id of [c1.id, c2.id]) {
      const after = await prisma.contract.findUniqueOrThrow({ where: { id } });
      assert.equal(after.status, "CANCELLED");
      assert.equal(after.terminationReason, "PT_BANNED");
    }
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: open.id } })).status, "DISPUTED", "Decision A: the unwind HOLDS the in-flight report for the admin");

    // duplicates / stale
    s.payments.length = 0;
    await ptDeactivationService.deactivatePT(cmd(pt, 10));
    await ptDeactivationService.deactivatePT(cmd(pt, 11));
    assert.equal((await episodes(pt)).length, 2, "no extra row");
    assert.equal(s.payments.length, 0, "no second refund");
    const stale = await ptDeactivationService.deactivatePT(cmd(pt, 9));
    assert.equal(stale.stale, true);

    // while banned: a temporary suspension is refused, and the ban can't be lifted through the suspension endpoint
    let e = await refused(() => ptRestrictionService.suspend(suspendInput(pt)));
    assert.equal(e.code, "PT_ALREADY_BANNED");
    e = await refused(() => ptRestrictionService.lift({ ptUserId: pt, adminId: "admin-1", reason: "x" }));
    assert.equal(e.code, "PT_BAN_LIFTS_VIA_ACCOUNT_UNLOCK");

    // the account unlock ends the ban; then a suspension can start again: three rows of history
    await ptDeactivationService.reactivatePT(cmd(pt, 12));
    assert.ok(await flagMatchesRecord(pt));
    await ptRestrictionService.suspend(suspendInput(pt));
    const history = await ptRestrictionService.history(pt);
    assert.deepEqual(history.map((h) => h.type).sort(), ["PERMANENT_BAN", "TEMPORARY_SUSPENSION", "TEMPORARY_SUSPENSION"]);
  } finally {
    s.restore();
    await cleanup([pt], [c1.id, c2.id]);
  }
});

test("an account UNLOCK never lifts a temporary suspension (only the ban it replaces)", { skip }, async () => {
  const pt = await makePt();
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    const res = await ptDeactivationService.reactivatePT(cmd(pt, 5));
    assert.equal(res.duplicate, true, "no ban was active: nothing changed");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null, type: "TEMPORARY_SUSPENSION" } }), 1);
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true, "still suspended");
    assert.ok(await flagMatchesRecord(pt));
  } finally {
    s.restore();
    await cleanup([pt], []);
  }
});

test("a contract whose unwind fails after the conversion keeps the time the temporary suspension blocked (given back at the conversion)", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const E0 = new Date(T + 20 * DAY);
  const c = await makeContract(pt, { startDate: new Date(T - 30 * DAY), endDate: E0 });
  const s = stubs(); // then make terminate fail
  const { paymentClient } = await import("../clients/payment.client");
  const original = paymentClient.terminate;
  (paymentClient as any).terminate = async () => {
    throw new Error("payment-service down");
  };
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T - 10 * DAY)));
    const res = await ptDeactivationService.deactivatePT(cmd(pt, 20));
    assert.equal(res.complete, false, "the unwind failed: the command stays retryable");
    const mid = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(mid.status, "ACTIVE");
    assert.ok(Math.abs(mid.endDate!.getTime() - (E0.getTime() + 10 * DAY)) < 5000, "the 10 suspended days were given back at the conversion (± the clock between suspend and now)");
    const ext = await prisma.ptRestrictionContractExtension.findMany({ where: { contractId: c.id } });
    assert.equal(ext.length, 1);
  } finally {
    (paymentClient as any).terminate = original;
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("a flag set with NO record (legacy lock) fails CLOSED; an account unlock clears it; the helper guards refuse with the ban code", { skip }, async () => {
  const pt = await makePt({ ptSuspended: true });
  const s = stubs();
  try {
    const r = await getActiveRestriction(pt);
    assert.equal(r?.id, "LEGACY_FLAG");
    assert.equal(r?.type, "PERMANENT_BAN");
    let e = await refused(() => assertPtAcceptsNewBusiness(pt, "BOOK_SESSION"));
    assert.equal(e.code, "PT_ACCOUNT_LOCKED");
    e = await refused(() => assertPtMayAct(pt));
    assert.equal(e.code, "PT_ACCOUNT_LOCKED");
    assert.equal(await flagMatchesRecord(pt), false, "the drift is detectable");

    await ptDeactivationService.reactivatePT(cmd(pt, 30));
    assert.equal(await getActiveRestriction(pt), null);
    assert.ok(await flagMatchesRecord(pt));
  } finally {
    s.restore();
    await cleanup([pt], []);
  }
});
