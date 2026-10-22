/**
 * Temporary PT suspension (slices 2-3), part 4 — the background sweeps leave a suspended PT alone and
 * pick up again at the lift: auto-confirm, room-close/no-show automation, and the idle-holdback
 * release (whose idle clock also excludes suspended time). The expiry sweep is covered next to the
 * end-date give-back in pt-restriction-suspension.integration.test.ts.
 *
 * Every sweep test runs a CONTROL beside the suspended PT (same fixture, unrestricted PT) in the same
 * pass, so "nothing happened to the suspended one" cannot pass vacuously.
 *
 * Evidence label: BACKEND INTEGRATION against gymcoach_user_test; payment-service and the notification
 * push are stubbed at the client boundary (TEST FIXTURE) — see pt-restriction.test-helpers.ts.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-sweeps.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { contractService } from "../services/contract.service";
import { contractRepository } from "../repositories/contract.repository";
import { bookingService } from "../services/booking.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { runRoomCloseResolution } from "../services/room-close-resolution.service";
import { ptRestrictionService } from "../services/pt-restriction.service";
import { DAY, addSession, cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";

const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: "admin-1",
  reasonCategory: "OTHER" as const,
  reasonText: "t",
  at,
});
const LONG_AGO = new Date("2000-01-01T00:00:00.000Z");

test("auto-confirm: a suspended PT's pending confirmation is not auto-confirmed (no quota, no money); the control is; after the lift the window is given back", { skip }, async () => {
  const T = Date.now();
  const ptR = await makePt();
  const ptC = await makePt();
  const cR = await makeContract(ptR);
  const cC = await makeContract(ptC);
  const ptR2 = await makePt();
  const cLater = await makeContract(ptR2);
  const s = stubs();
  try {
    const sC = await addSession(cC, "PENDING_CLIENT_CONFIRMATION", LONG_AGO, { clientConfirmDeadline: LONG_AGO });
    const sR = await addSession(cR, "PENDING_CLIENT_CONFIRMATION", LONG_AGO, { clientConfirmDeadline: new Date(LONG_AGO.getTime() + 1000) });
    await ptRestrictionService.suspend(suspendInput(ptR));

    const out = await runAutoConfirm();
    assert.ok(out.confirmed >= 1);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sC.id } })).status, "COMPLETED", "control: auto-confirmed");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sR.id } })).status, "PENDING_CLIENT_CONFIRMATION", "suspended PT: left alone");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: cR.id } })).usedSessions, 0, "no quota consumed");
    assert.ok(!s.payments.some((p) => p.method === "releaseSession" && p.body.parties?.ptUserId === ptR), "no money released for the suspended PT");
    assert.ok(s.payments.some((p) => p.method === "releaseSession" && p.body.parties?.ptUserId === ptC), "control: money released");

    // resume: a window that runs out DURING the suspension is given back at the lift (own PT, own contract)
    const S2 = new Date(T - 2 * DAY);
    const D = new Date(T - 1 * DAY); // the deadline passes while suspended (the sweep skips it)
    const sLater = await addSession(cLater, "PENDING_CLIENT_CONFIRMATION", new Date(T - 3 * DAY), { clientConfirmDeadline: D });
    await ptRestrictionService.suspend(suspendInput(ptR2, S2));
    await runAutoConfirm();
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sLater.id } })).status, "PENDING_CLIENT_CONFIRMATION", "deadline passed but the PT is suspended");
    await ptRestrictionService.lift({ ptUserId: ptR2, adminId: "admin-1", reason: "ok", at: new Date(T) });
    const after = await prisma.session.findUniqueOrThrow({ where: { id: sLater.id } });
    assert.equal(after.clientConfirmDeadline!.getTime(), D.getTime() + 2 * DAY, "deadline + the 2 frozen days");
    await runAutoConfirm();
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sLater.id } })).status, "PENDING_CLIENT_CONFIRMATION", "the client still has their window after the lift");
  } finally {
    s.restore();
    await cleanup([ptR, ptR2, ptC], [cR.id, cC.id, cLater.id]);
  }
});

test("room-close automation: a suspended PT is never marked no-show (no compensation, no ptAtFault); the control is; the session is resolved normally after the lift", { skip }, async () => {
  const ptR = await makePt();
  const ptC = await makePt();
  const cR = await makeContract(ptR);
  const cC = await makeContract(ptC);
  const s = stubs();
  try {
    const mk = (c: typeof cR) =>
      addSession(c, "CONFIRMED", LONG_AGO, { sessionMode: "ONLINE", roomClientJoinedAt: new Date(LONG_AGO.getTime() + 60_000) }); // client came, PT never joined
    const sR = await mk(cR);
    const sC = await mk(cC);
    await ptRestrictionService.suspend(suspendInput(ptR));

    await runRoomCloseResolution();
    const control = await prisma.session.findUniqueOrThrow({ where: { id: sC.id } });
    assert.equal(control.status, "NO_SHOW", "control: PT never joined → no-show");
    assert.equal(control.ptAtFault, true);
    const suspended = await prisma.session.findUniqueOrThrow({ where: { id: sR.id } });
    assert.equal(suspended.status, "CONFIRMED", "the suspended PT's session is untouched");
    assert.equal(suspended.ptAtFault, false);
    assert.ok(!s.payments.some((p) => p.method === "noShow" && p.body.parties?.ptUserId === ptR), "no compensation charged to the suspended PT");
    assert.ok(s.payments.some((p) => p.method === "noShow" && p.body.parties?.ptUserId === ptC), "control: compensated");

    // after the lift the automation resumes on the original facts
    await ptRestrictionService.lift({ ptUserId: ptR, adminId: "admin-1", reason: "ok" });
    await runRoomCloseResolution();
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sR.id } })).status, "NO_SHOW", "resumed at the lift");
  } finally {
    s.restore();
    await cleanup([ptR, ptC], [cR.id, cC.id]);
  }
});

// ── idle holdback ────────────────────────────────────────────────────────────────────────────

const holdbackContract = (ptUserId: string, over: Record<string, unknown> = {}) =>
  makeContract(ptUserId, { ptHoldbackRate: "0.1000", startDate: new Date(Date.now() - 40 * DAY), endDate: new Date(Date.now() + 50 * DAY), ...over });
const released = (s: ReturnType<typeof stubs>, contractId: string) =>
  s.payments.some((p) => p.method === "releaseHoldback" && p.body.idempotencyKey === `HOLDBACK_RELEASE:${contractId}`);

test("no idle holdback release (FH-9): a RUNNING contract's held amount is never released by the sweep - suspended PT or not, quiet or not", { skip }, async () => {
  const T = Date.now();
  const ptSuspendedNow = await makePt();
  const ptLongPast = await makePt(); // 25 of the last 40 days suspended, lifted 5 days ago
  const ptShortPast = await makePt(); // control: only 3 days suspended
  const ptNever = await makePt(); // control: never suspended
  const cNow = await holdbackContract(ptSuspendedNow);
  const cLong = await holdbackContract(ptLongPast);
  const cShort = await holdbackContract(ptShortPast);
  const cNever = await holdbackContract(ptNever);
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(ptSuspendedNow, new Date(T - 1 * DAY)));
    await ptRestrictionService.suspend(suspendInput(ptLongPast, new Date(T - 30 * DAY)));
    await ptRestrictionService.lift({ ptUserId: ptLongPast, adminId: "a", reason: "ok", at: new Date(T - 5 * DAY) });
    await ptRestrictionService.suspend(suspendInput(ptShortPast, new Date(T - 20 * DAY)));
    await ptRestrictionService.lift({ ptUserId: ptShortPast, adminId: "a", reason: "ok", at: new Date(T - 17 * DAY) });

    // 40 quiet days, no sessions, rate > 0: under the old rule three of them would have been released. Now none is: the hold leaves
    // only after the contract has ended and is reconciled.
    for (const c of [cNow, cLong, cShort, cNever]) {
      assert.equal((await contractRepository.findEndedHoldbackCandidates({ id: c.id })).length, 0, "an ACTIVE contract is never a sweep candidate");
    }
    await contractService.releaseDueHoldbacks(new Date(T));
    for (const c of [cNow, cLong, cShort, cNever]) {
      assert.equal(released(s, c.id), false, "never released while the contract runs");
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).holdbackReleasedAt, null);
    }
  } finally {
    s.restore();
    await cleanup([ptSuspendedNow, ptLongPast, ptShortPast, ptNever], [cNow.id, cLong.id, cShort.id, cNever.id]);
  }
});

test("sessions called off by a suspension are SYSTEM cancellations, a genuine PT cancellation carries the PT's id; neither lets a running contract's holdback be released", { skip }, async () => {
  const T = Date.now();
  const ptAdmin = await makePt();
  const ptReal = await makePt();
  const cAdmin = await holdbackContract(ptAdmin);
  const cReal = await holdbackContract(ptReal);
  const s = stubs();
  try {
    await addSession(cAdmin, "CONFIRMED", new Date(T + 3 * DAY));
    const real = await addSession(cReal, "CONFIRMED", new Date(T + 3 * DAY));

    // administrative: suspended, then lifted straight away (≈0 suspended time, so the idle rule is judged on the sessions alone)
    await ptRestrictionService.suspend(suspendInput(ptAdmin));
    await ptRestrictionService.lift({ ptUserId: ptAdmin, adminId: "a", reason: "ok" });
    // real: the PT cancels a confirmed session himself, 3 days ahead (≥ 24h: free, no money)
    await bookingService.cancelSession(real.id, ptReal, "bận");

    const adminSession = await prisma.session.findFirstOrThrow({ where: { contractId: cAdmin.id } });
    assert.equal(adminSession.status, "CANCELLED");
    assert.equal(adminSession.cancelledBy, "SYSTEM");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: real.id } })).cancelledBy, ptReal);

    assert.equal((await contractRepository.findEndedHoldbackCandidates({ id: cAdmin.id })).length, 0);
    assert.equal((await contractRepository.findEndedHoldbackCandidates({ id: cReal.id })).length, 0);
    await contractService.releaseDueHoldbacks(new Date(T));
    assert.equal(s.payments.length, 0, "no payment-service call at all: nothing is due while the contracts run");
  } finally {
    s.restore();
    await cleanup([ptAdmin, ptReal], [cAdmin.id, cReal.id]);
  }
});
