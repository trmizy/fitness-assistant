/**
 * F4 (D56) - the race family around a contract ENDING. Every session path that can move money (late cancel by the
 * client, PT late cancel, PT admits no-show, PT date block, room-close sweep, answering a no-show report, settlement
 * retries) must produce exactly ONE valid business outcome next to a contract ending, with the ending's snapshot
 * {usedSessions, compensatedSessions, alreadyReleased, held sessions} seeing the session's FINAL state, no money step
 * duplicated or lost, and a loser that gets a clear business error (409 + code), never a silent no-op.
 *
 * Evidence label: BACKEND INTEGRATION against the isolated gymcoach_user_test database, REAL concurrency (Promise.all /
 * staggered starts), real advisory locks. TEST FIXTURE: payment-service is NOT running - every paymentClient money method
 * is replaced at the client boundary by a SLOW stub (money 250 ms, termination 250 ms) that records each call in order, so
 * the interleavings are forced, not hoped for. The real ledger is exercised by cross-service-money-f4-races.e2e.test.ts.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/contract-race-family.integration.test.ts
 *
 * Lanes: ending-first (the ending holds the lock, the action must be REFUSED), op-first (the action holds the lock, the
 * ending must SEE it), simultaneous x3 (either order, the invariant must hold).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { bookingService } from "../services/booking.service";
import { availabilityService } from "../services/availability.service";
import { contractService } from "../services/contract.service";
import { terminateContractMoney } from "../services/contract-payout.service";
import { runRoomCloseResolution } from "../services/room-close-resolution.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { withContractLock, withRunningContract, TX_TIMEOUT_MS, LOCK_WAIT_MS } from "../services/contract-lock";
import { contractRepository } from "../repositories/contract.repository";
import { sessionRepository } from "../repositories/session.repository";
import { SETTLEMENT_DRAIN_LIMIT } from "../services/contract-payout.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs, type Stubs } from "./pt-restriction.test-helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MONEY_MS = 250;
const TERMINATE_MS = 250;

function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** stubs() with realistic results and a delay on every money call, so a racing action really overlaps it. */
function slowMoney(over: { noShow?: () => Promise<unknown> } = {}): Stubs {
  const base = stubs({ refund: "1.00" });
  const slow = (method: string, result: (body: any) => unknown) =>
    patch(paymentClient as any, method, async (body: any) => {
      base.payments.push({ method, body });
      await sleep(method === "terminate" ? TERMINATE_MS : MONEY_MS);
      return result(body);
    });
  const restores = [
    // like the real ledger, the answer echoes the reason and how many sessions' value was HELD (user-service checks it)
    slow("terminate", (b) => ({ refund: "1.00", reason: b.reason, ...(b.unresolvedSessions > 0 ? { unresolved: { sessions: b.unresolvedSessions } } : {}) })),
    slow("releaseSession", () => ({ released: { pt: "450000", gym: "0", platform: "50000" } })),
    patch(paymentClient as any, "noShow", async (body: any) => {
      base.payments.push({ method: "noShow", body });
      if (over.noShow) return over.noShow();
      await sleep(MONEY_MS);
      return { compensation: "500000", shortfall: "0" };
    }),
    slow("lateArrival", () => ({ shortfall: "0" })),
    patch(paymentClient as any, "resolveUnresolvedSession", async (body: any) => {
      base.payments.push({ method: "resolveUnresolvedSession", body });
      await sleep(MONEY_MS);
      return { moved: { pt: "450000", gym: "0", platform: "50000", client: body.outcome === "NOT_DELIVERED" ? "500000" : "0" } };
    }),
  ];
  return { ...base, restore: () => { restores.reverse().forEach((r) => r()); base.restore(); } };
}

/** Payment calls of one contract (the room-close sweep may also touch other leftovers in a shared test DB). */
const callsFor = (s: Stubs, contractId: string, method?: string) =>
  s.payments.filter((p) => (!method || p.method === method) && JSON.stringify(p.body).includes(contractId));
const idxOf = (s: Stubs, contractId: string, method: string) => s.payments.findIndex((p) => p.method === method && JSON.stringify(p.body).includes(contractId));
const terminateBody = (s: Stubs, contractId: string) => callsFor(s, contractId, "terminate")[0]?.body;
const ending = (c: { id: string; clientUserId: string }) => () => terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId });

type Lane = "ending-first" | "op-first" | "simultaneous";
const LANES: Lane[] = ["ending-first", "op-first", "simultaneous", "simultaneous", "simultaneous"];

/** Which payment call proves the action is INSIDE the lock (op-first lane); undefined: the action has no money step, so it is simply awaited. */
let OP_METHOD: string | undefined;
let CURRENT: { stub: Stubs; contractId: string } | undefined;
async function until(cond: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(5);
}

/**
 * The orders are FORCED, not timed: the second request is started only once the first is provably inside its critical
 * section (its payment-service call has begun - the stub is slow), so a loaded machine cannot flip the lane.
 */
async function launch(lane: Lane, end: () => Promise<unknown>, op: () => Promise<unknown>) {
  const has = (method: string) => !!CURRENT && CURRENT.stub.payments.some((p) => p.method === method && JSON.stringify(p.body).includes(CURRENT!.contractId));
  if (lane === "ending-first") {
    const e = end();
    await until(() => has("terminate"));
    const o = op();
    const [er, or] = await Promise.allSettled([e, o]);
    return { er, or };
  }
  if (lane === "op-first") {
    const o = op();
    if (OP_METHOD) await until(() => has(OP_METHOD!));
    else await Promise.allSettled([o]);
    const e = end();
    const [or, er] = await Promise.allSettled([o, e]);
    return { er, or };
  }
  const [er, or] = await Promise.allSettled([end(), op()]);
  return { er, or };
}
const code = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as any)?.code : undefined);
/**
 * The loser of a race against the ending is told WHY with a code: the ending already called the session off (400
 * SESSION_STATE_NOT_ALLOWED), the contract is already settled (409 CONTRACT_ENDED) or - D59 - the ending is RECORDED and its
 * money not confirmed yet (409 CONTRACT_ENDING: refused, never queued).
 */
function assertRefused(r: PromiseSettledResult<unknown>, lane: string) {
  assert.equal(r.status, "rejected", lane);
  const e = (r as PromiseRejectedResult).reason as any;
  assert.ok(
    (e.status === 409 && (e.code === "CONTRACT_ENDED" || e.code === "CONTRACT_ENDING")) || (e.status === 400 && e.code === "SESSION_STATE_NOT_ALLOWED"),
    `${lane}: not a clear business error: ${e.status} ${e.code} ${e.message}`,
  );
}
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as any)?.status : 200);

async function scrubSessions(contractIds: string[]) {
  const ids = (await prisma.session.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } }).catch(() => {});
}

/** Runs one race over every lane with a fresh PT + contract (2 sessions already used) and a fresh session each time. */
async function raceOver(
  makeSession: (c: Awaited<ReturnType<typeof makeContract>>, pt: string) => Promise<{ id: string }>,
  op: (ctx: { c: Awaited<ReturnType<typeof makeContract>>; pt: string; sessionId: string }) => Promise<unknown>,
  check: (ctx: {
    lane: Lane;
    c: Awaited<ReturnType<typeof makeContract>>;
    pt: string;
    sessionId: string;
    er: PromiseSettledResult<unknown>;
    or: PromiseSettledResult<unknown>;
    stub: Stubs;
  }) => Promise<void>,
  opts: { onlineRoom?: boolean } = {},
) {
  void opts;
  for (const lane of LANES) {
    const pt = await makePt();
    const c = await makeContract(pt, { usedSessions: 2 });
    const s = await makeSession(c, pt);
    const stub = slowMoney();
    CURRENT = { stub, contractId: c.id };
    try {
      const { er, or } = await launch(lane, ending(c), () => op({ c, pt, sessionId: s.id }));
      assert.equal(er.status, "fulfilled", `${lane}: the ending itself never fails: ${er.status === "rejected" ? String((er as any).reason?.stack) : ""}`);
      const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(row.status, "CANCELLED", `${lane}: ended exactly once`);
      assert.equal(callsFor(stub, c.id, "terminate").length, 1, `${lane}: one termination call`);
      await check({ lane, c, pt, sessionId: s.id, er, or, stub });
    } finally {
      stub.restore();
      await prisma.pTScheduleException.deleteMany({ where: { ptUserId: pt } }).catch(() => {});
      await scrubSessions([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
}

// ── 1. client late cancel (DEDUCT + release) vs ending ──────────────────────────────────────────

test("F4 race 1: client late cancel (<24h: charged + PT paid) vs the ending - the ending's snapshot sees the charge AND the release, or the cancel is refused CONTRACT_ENDED", { skip }, async () => {
  OP_METHOD = "releaseSession";
  const seen = new Set<string>();
  await raceOver(
    (c) => addSession(c, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    ({ c, sessionId }) => bookingService.cancelSession(sessionId, c.clientUserId, "bận"),
    async ({ lane, c, sessionId, or, stub }) => {
      const won = or.status === "fulfilled";
      seen.add(`${lane}:${won ? "won" : "lost"}`);
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      if (won) {
        assert.equal(t.usedSessions, 3, `${lane}: the ending's snapshot includes the charged session`);
        assert.equal(t.alreadyReleased.pt, "450000", `${lane}: ...and the PT's release (so the top-up is not paid twice)`);
        assert.equal(callsFor(stub, c.id, "releaseSession").length, 1, `${lane}: the release happened once`);
        assert.ok(idxOf(stub, c.id, "releaseSession") < idxOf(stub, c.id, "terminate"), `${lane}: release before the ending's money call`);
        assert.deepEqual([sess.status, sess.cancelledBy, sess.sessionDeducted], ["CANCELLED", c.clientUserId, true]);
        assert.equal(after.usedSessions, 3);
      } else {
        assertRefused(or, lane);
        assert.equal(t.usedSessions, 2, `${lane}: no charge`);
        assert.equal(callsFor(stub, c.id, "releaseSession").length, 0, `${lane}: no release`);
        assert.deepEqual([sess.status, sess.cancelledBy, sess.sessionDeducted], ["CANCELLED", "SYSTEM", false], `${lane}: called off by the ending`);
        assert.equal(after.usedSessions, 2);
      }
      if (lane === "ending-first") assert.equal(won, false);
      if (lane === "op-first") assert.equal(won, true);
    },
  );
  assert.ok(seen.has("ending-first:lost") && seen.has("op-first:won"));
});

// ── 2. PT late cancel (compensation) vs ending ──────────────────────────────────────────────────

test("F4 race 2: PT cancels <24h (client compensated) vs the ending - compensatedSessions in the ending's snapshot, or the cancel is refused CONTRACT_ENDED", { skip }, async () => {
  OP_METHOD = "noShow";
  await raceOver(
    (c) => addSession(c, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    ({ pt, sessionId }) => bookingService.cancelSession(sessionId, pt, "bận"),
    async ({ lane, c, sessionId, or, stub }) => {
      const won = or.status === "fulfilled";
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      if (won) {
        assert.equal(callsFor(stub, c.id, "noShow").length, 1, `${lane}: compensated once`);
        assert.equal(t.compensatedSessions, 1, `${lane}: the ending's snapshot includes the compensation`);
        assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
        assert.equal(after.compensatedSessions, 1);
        assert.equal(sess.status, "NO_SHOW");
      } else {
        assertRefused(or, lane);
        assert.equal(callsFor(stub, c.id, "noShow").length, 0, `${lane}: nothing compensated on top of the ending`);
        assert.equal(t.compensatedSessions, 0);
        assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"]);
        assert.equal(after.compensatedSessions, 0);
      }
      if (lane === "ending-first") assert.equal(won, false);
      if (lane === "op-first") assert.equal(won, true);
    },
  );
});

// ── 3. PT admits no-show vs ending ──────────────────────────────────────────────────────────────

test("F4 race 3: PT admits its own no-show (markNoShow) vs the ending - one compensation counted in the snapshot, or CONTRACT_ENDED", { skip }, async () => {
  OP_METHOD = "noShow";
  await raceOver(
    (c) => addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR)),
    ({ pt, sessionId }) => bookingService.markNoShow(sessionId, pt, "PT"),
    async ({ lane, c, sessionId, or, stub }) => {
      const won = or.status === "fulfilled";
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      if (won) {
        assert.equal(callsFor(stub, c.id, "noShow").length, 1);
        assert.equal(t.compensatedSessions, 1);
        assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
        assert.deepEqual([sess.status, sess.ptAtFault], ["NO_SHOW", true]);
      } else {
        assertRefused(or, lane);
        assert.equal(callsFor(stub, c.id, "noShow").length, 0);
        assert.equal(t.compensatedSessions, 0);
        assert.deepEqual([sess.status, sess.ptAtFault], ["CANCELLED", false], `${lane}: never a PT no-show conclusion for a called-off session`);
      }
      if (lane === "ending-first") assert.equal(won, false);
      if (lane === "op-first") assert.equal(won, true);
    },
  );
});

// ── 4. PT date block vs ending ──────────────────────────────────────────────────────────────────

test("F4 race 4: PT blocks the day (addException) vs the ending - the compensation is in the snapshot, or the session is left to the ending (skipped, no second payout)", { skip }, async () => {
  OP_METHOD = "noShow";
  let start!: Date;
  await raceOver(
    async (c) => {
      start = new Date(Date.now() + 3 * HOUR);
      return addSession(c, "CONFIRMED", start);
    },
    ({ pt }) => availabilityService.addException(pt, localDay(start), "bận"),
    async ({ lane, c, sessionId, stub }) => {
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const noShow = callsFor(stub, c.id, "noShow").length;
      if (sess.status === "NO_SHOW") {
        assert.equal(noShow, 1, `${lane}: compensated once`);
        assert.equal(t.compensatedSessions, 1, `${lane}: the ending's snapshot includes it`);
        assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
      } else {
        assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"], `${lane}: called off by the ending`);
        assert.equal(noShow, 0, `${lane}: no compensation on an ended contract`);
        assert.equal(t.compensatedSessions, 0);
      }
      if (lane === "ending-first") assert.equal(sess.status, "CANCELLED");
      if (lane === "op-first") assert.equal(sess.status, "NO_SHOW");
    },
  );
});

// ── 5. room-close sweep vs ending ───────────────────────────────────────────────────────────────

test("F4 race 5: the room-close sweep (PT never joined -> no-show compensation) vs the ending - compensated once inside the snapshot, or skipped", { skip }, async () => {
  OP_METHOD = "noShow";
  await raceOver(
    (c) =>
      addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR), {
        sessionMode: "ONLINE",
        roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000),
      }),
    () => runRoomCloseResolution(),
    async ({ lane, c, sessionId, stub }) => {
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const noShow = callsFor(stub, c.id, "noShow").length;
      if (sess.status === "NO_SHOW") {
        assert.equal(noShow, 1);
        assert.equal(t.compensatedSessions, 1, `${lane}: snapshot includes the sweep's compensation`);
        assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
      } else {
        assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"]);
        assert.equal(noShow, 0, `${lane}: the sweep paid nothing on an ended contract`);
        assert.equal(t.compensatedSessions, 0);
      }
      if (lane === "ending-first") assert.equal(sess.status, "CANCELLED");
      if (lane === "op-first") assert.equal(sess.status, "NO_SHOW");
    },
  );
});

test("F4 race 5b: the room-close sweep's late-arrival top-up (both joined, PT late) vs the ending", { skip }, async () => {
  OP_METHOD = "lateArrival";
  await raceOver(
    (c) => {
      const start = new Date(Date.now() - 2 * HOUR);
      return addSession(c, "CONFIRMED", start, {
        sessionMode: "ONLINE",
        roomClientJoinedAt: new Date(start.getTime() + 60_000),
        roomPtJoinedAt: new Date(start.getTime() + 30 * 60_000), // 30 min late: past the grace window
      });
    },
    () => runRoomCloseResolution(),
    async ({ lane, c, sessionId, stub }) => {
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      const late = callsFor(stub, c.id, "lateArrival").length;
      if (sess.status === "PENDING_CLIENT_CONFIRMATION") {
        assert.equal(late, 1);
        assert.ok(idxOf(stub, c.id, "lateArrival") < idxOf(stub, c.id, "terminate"), `${lane}: the top-up is paid before the ending, never after it`);
        assert.equal(terminateBody(stub, c.id).unresolvedSessions, 1, `${lane}: the awaiting session is HELD by the ending`);
      } else {
        assert.equal(sess.status, "CANCELLED");
        assert.equal(late, 0, `${lane}: no top-up on an ended contract`);
      }
      if (lane === "ending-first") assert.equal(sess.status, "CANCELLED");
      if (lane === "op-first") assert.equal(sess.status, "PENDING_CLIENT_CONFIRMATION");
    },
  );
});

// ── 6-8. no-show REPORT paths vs ending (with Decision A) ──────────────────────────────────────

test("F4 race 6: the PT AGREES to the client's no-show report vs the ending - settled as a PT no-show inside the snapshot, or refused CONTRACT_ENDED and the report is HELD", { skip }, async () => {
  OP_METHOD = "noShow";
  await raceOver(
    (c) => addSession(c, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * HOUR), { disputeReason: "PT không đến", disputedAt: new Date() }),
    ({ pt, sessionId }) => bookingService.respondToNoShowReport(sessionId, pt, "AGREE"),
    async ({ lane, c, sessionId, or, stub }) => {
      const won = or.status === "fulfilled";
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      if (won) {
        assert.equal(sess.status, "NO_SHOW");
        assert.equal(callsFor(stub, c.id, "noShow").length, 1);
        assert.equal(t.compensatedSessions, 1);
        assert.equal(t.unresolvedSessions, undefined, `${lane}: nothing held - it was answered before the ending`);
      } else {
        assertRefused(or, lane);
        assert.deepEqual([sess.status, sess.disputeType, sess.ptAtFault, sess.sessionDeducted], ["DISPUTED", "PT_NO_SHOW_CLAIM", false, false], `${lane}: HELD for the admin, no conclusion`);
        assert.equal(callsFor(stub, c.id, "noShow").length, 0, `${lane}: no compensation before the obligation is determined`);
        assert.equal(t.compensatedSessions, 0);
        assert.equal(t.unresolvedSessions, 1, `${lane}: its value is held with payment-service`);
      }
      if (lane === "ending-first") assert.equal(won, false);
      if (lane === "op-first") assert.equal(won, true);
    },
  );
});

test("F4 race 7: the PT DENIES the report vs the ending - DISPUTED and held either way, never money", { skip }, async () => {
  OP_METHOD = undefined;
  await raceOver(
    (c) => addSession(c, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * HOUR), { disputeReason: "PT không đến", disputedAt: new Date() }),
    ({ pt, sessionId }) => bookingService.respondToNoShowReport(sessionId, pt, "DENY", "tôi đã có mặt"),
    async ({ lane, c, sessionId, or, stub }) => {
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      assert.equal(sess.status, "DISPUTED", lane);
      assert.equal(sess.disputeType, "PT_NO_SHOW_CLAIM");
      assert.equal(terminateBody(stub, c.id).unresolvedSessions, 1, `${lane}: held exactly once`);
      assert.equal(callsFor(stub, c.id, "noShow").length, 0);
      if (or.status === "rejected") assertRefused(or, lane);
    },
  );
});

test("F4 race 8: the client REPORTS the PT no-show vs the ending - held as a dispute if reported first, or refused CONTRACT_ENDED and the session called off", { skip }, async () => {
  OP_METHOD = undefined;
  await raceOver(
    (c) => addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR)),
    ({ c, sessionId }) => bookingService.reportPtNoShow(sessionId, c.clientUserId, "PT không đến"),
    async ({ lane, c, sessionId, or, stub }) => {
      const won = or.status === "fulfilled";
      const t = terminateBody(stub, c.id);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      if (won) {
        assert.equal(sess.status, "DISPUTED", `${lane}: the report is HELD by the ending, not lost`);
        assert.equal(t.unresolvedSessions, 1);
      } else {
        assertRefused(or, lane);
        assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"]);
        assert.equal(t.unresolvedSessions, undefined);
      }
      assert.equal(callsFor(stub, c.id, "noShow").length, 0);
      if (lane === "ending-first") assert.equal(won, false);
      if (lane === "op-first") assert.equal(won, true);
    },
  );
});

// ── 9. three actors on ONE session ──────────────────────────────────────────────────────────────

test("F4 race 9: the client's late cancel, the PT's no-show admission and the room-close sweep on the SAME session at once - exactly one wins, ONE money step in total", { skip }, async () => {
  for (let i = 0; i < 6; i++) {
    const pt = await makePt();
    const c = await makeContract(pt, { usedSessions: 2 });
    const s = await addSession(c, "CONFIRMED", new Date(Date.now() - 2 * HOUR), {
      sessionMode: "ONLINE",
      roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000),
    });
    const stub = slowMoney();
    try {
      const [cancel, noShow] = await Promise.allSettled([
        bookingService.cancelSession(s.id, c.clientUserId, "bận"),
        bookingService.markNoShow(s.id, pt, "PT"),
        runRoomCloseResolution(),
      ]);
      await sleep(50);
      const sess = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      const releases = callsFor(stub, c.id, "releaseSession").length;
      const comps = callsFor(stub, c.id, "noShow").length;
      assert.equal(releases + comps, 1, `iteration ${i}: exactly one money step (release=${releases} comp=${comps})`);
      assert.equal(after.usedSessions + after.compensatedSessions, 2 + 1, "exactly one session consumed on top of the 2 already used");
      const winners = [cancel.status === "fulfilled", noShow.status === "fulfilled"].filter(Boolean).length + (sess.ptNotes === "PT không vào phòng học" ? 1 : 0);
      assert.equal(winners, 1, `iteration ${i}: exactly one winner`);
      for (const r of [cancel, noShow]) {
        if (r.status === "rejected") assert.equal(code(r), "SESSION_ALREADY_PROCESSED", "the loser gets a clear business error, not a silent no-op");
      }
      assert.equal(after.status, "ACTIVE");
    } finally {
      stub.restore();
      await scrubSessions([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
});

test("F4 race 10: the SAME cancel twice at once (a double click / a retry) - one charge, one release; the second gets 409 SESSION_ALREADY_PROCESSED", { skip }, async () => {
  for (let i = 0; i < 4; i++) {
    const pt = await makePt();
    const c = await makeContract(pt, { usedSessions: 2 });
    const s = await addSession(c, "CONFIRMED", new Date(Date.now() + 3 * HOUR));
    const stub = slowMoney();
    try {
      const [a, b] = await Promise.allSettled([
        bookingService.cancelSession(s.id, c.clientUserId, "bận"),
        bookingService.cancelSession(s.id, c.clientUserId, "bận"),
      ]);
      const ok = [a, b].filter((r) => r.status === "fulfilled").length;
      assert.equal(ok, 1);
      const lost = [a, b].find((r) => r.status === "rejected")!;
      assert.equal(httpStatus(lost), 409);
      assert.equal(code(lost), "SESSION_ALREADY_PROCESSED");
      assert.equal(callsFor(stub, c.id, "releaseSession").length, 1);
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).usedSessions, 3);
    } finally {
      stub.restore();
      await scrubSessions([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
});

/** The shared test DB keeps FAILED settlement rows from other suites; the sweep only retries the 50 oldest, so park them. */
async function parkLeftoverSettlements() {
  await prisma.sessionSettlement.updateMany({
    where: { status: { not: "SETTLED" }, NOT: { lastError: { startsWith: "ENDED_UNSETTLED:" } } },
    data: { lastError: "ENDED_UNSETTLED: parked leftover of another suite" },
  });
}

// ── 11. unsettled compensations: the ending settles them first / refuses ───────────────────────

async function failedCompensationFixture() {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = await addSession(c, "NO_SHOW", new Date(Date.now() - 2 * DAY), { ptAtFault: true });
  await prisma.sessionSettlement.create({
    data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.id}`, sessionId: s.id, contractId: c.id, status: "FAILED", lastError: "payment-service down" },
  });
  return { pt, c, s };
}

test("F4 settlement 1: a FAILED no-show compensation is settled BEFORE the ending reads the contract - the snapshot counts it, the retry cannot pay it again afterwards", { skip }, async () => {
  const { pt, c, s } = await failedCompensationFixture();
  const stub = slowMoney();
  try {
    await ending(c)();
    assert.equal(callsFor(stub, c.id, "noShow").length, 1);
    assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
    assert.equal(terminateBody(stub, c.id).compensatedSessions, 1, "the refund formula knows the session was compensated");
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${s.id}` } });
    assert.equal(row.status, "SETTLED");
    await runSettlementSweep();
    assert.equal(callsFor(stub, c.id, "noShow").length, 1, "nothing left to retry");
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("F4 settlement 2: a compensation that still cannot be paid REFUSES the ending (409 SESSION_SETTLEMENT_PENDING): contract stays ACTIVE, no termination call, nothing priced wrongly", { skip }, async () => {
  const { pt, c } = await failedCompensationFixture();
  const stub = slowMoney({ noShow: async () => { throw new Error("payment-service down"); } });
  try {
    await assert.rejects(ending(c)(), (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING");
    assert.equal(callsFor(stub, c.id, "terminate").length, 0);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("F4 settlement 3: the settlement sweep NEVER pays a compensation of a contract that has ended (it would be drawn from the PT's pooled available) - the row is marked ENDED_UNSETTLED and not retried", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date() });
  const s = await addSession(c, "NO_SHOW", new Date(Date.now() - 2 * DAY), { ptAtFault: true });
  await prisma.sessionSettlement.create({
    data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.id}`, sessionId: s.id, contractId: c.id, status: "FAILED", lastError: "old failure" },
  });
  await parkLeftoverSettlements();
  await prisma.sessionSettlement.updateMany({ where: { contractId: c.id }, data: { lastError: "old failure" } });
  const stub = slowMoney();
  try {
    await runSettlementSweep();
    assert.equal(callsFor(stub, c.id).length, 0, "no payment call at all");
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${s.id}` } });
    assert.equal(row.status, "FAILED");
    assert.ok(row.lastError?.startsWith("ENDED_UNSETTLED:"), row.lastError ?? "");
    await runSettlementSweep();
    assert.equal(callsFor(stub, c.id).length, 0);
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("F4 settlement 4: the settlement sweep's retry vs the ending at the same time - paid once, inside the snapshot", { skip }, async () => {
  await parkLeftoverSettlements();
  for (const lane of LANES) {
    const { pt, c, s } = await failedCompensationFixture();
    const stub = slowMoney();
    CURRENT = { stub, contractId: c.id };
    OP_METHOD = "noShow";
    try {
      const { er } = await launch(lane, ending(c), () => runSettlementSweep());
      assert.equal(er.status, "fulfilled");
      const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${s.id}` } });
      const noShow = callsFor(stub, c.id, "noShow").length;
      assert.equal(noShow, 1, `${lane}: the compensation is paid exactly once`);
      assert.equal(row.status, "SETTLED");
      assert.equal(terminateBody(stub, c.id).compensatedSessions, 1, `${lane}: the ending priced it as compensated`);
      assert.ok(idxOf(stub, c.id, "noShow") < idxOf(stub, c.id, "terminate"));
    } finally {
      stub.restore();
      await scrubSessions([c.id]);
      await cleanup([pt], [c.id]);
    }
  }
});

// ── 12. completion vs another ending ────────────────────────────────────────────────────────────

test("F4 completion: checkAndCompleteContract with a STALE read (the contract was ended another way between its read and its write) never rewrites the ended contract to COMPLETED", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { totalSessions: 3, usedSessions: 3 }); // looks finished ...
  const stub = slowMoney();
  let restore = () => {};
  try {
    await ending(c)(); // ... but another path cancelled it first
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED");
    const before = stub.payments.length;
    // the stale read: checkAndCompleteContract saw the contract ACTIVE a moment before the ending wrote its status
    restore = patch(contractRepository as any, "findById", async (id: string) => ({ ...(await prisma.contract.findUniqueOrThrow({ where: { id } })), status: "ACTIVE" }));
    const r = await contractService.checkAndCompleteContract(c.id);
    restore();
    assert.equal(r, null, "the guarded write matched nothing");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.status, after.terminationReason], ["CANCELLED", "CLIENT_CANCELLED"], "not rewritten");
    assert.equal(stub.payments.length, before, "and no second settlement was started for it");
  } finally {
    restore();
    stub.restore();
    await cleanup([pt], [c.id]);
  }
});

test("F4 in-lock check: withRunningContract refuses an ended contract (fn never runs); a stale list cannot make the PT block compensate it", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date() });
  const start = new Date(Date.now() + 3 * HOUR);
  const s = await addSession(c, "CONFIRMED", start); // a leftover behind the ending's back
  const stub = slowMoney();
  let ran = false;
  // the list of the day's sessions was read before the ending
  const restore = patch(sessionRepository as any, "findConflictsByDate", async () => [await prisma.session.findUniqueOrThrow({ where: { id: s.id } })]);
  try {
    await assert.rejects(withRunningContract(c.id, async () => { ran = true; }), (e: any) => e.status === 409 && e.code === "CONTRACT_ENDED");
    assert.equal(ran, false);
    await assert.rejects(withRunningContract("no-such-contract", async () => { ran = true; }), (e: any) => e.status === 404);
    await availabilityService.addException(pt, localDay(start), "bận");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status, "CONFIRMED", "untouched");
    assert.equal(callsFor(stub, c.id).length, 0, "no compensation on an ended contract");
  } finally {
    restore();
    stub.restore();
    await prisma.pTScheduleException.deleteMany({ where: { ptUserId: pt } }).catch(() => {});
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

// ── 13. Decision A: rulings on a held PT-no-show report settle ONCE ────────────────────────────

async function heldReport() {
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = await addSession(c, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 2 * HOUR), { disputeReason: "PT không đến", disputedAt: new Date() });
  const stub = slowMoney();
  await ending(c)();
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status, "DISPUTED");
  assert.equal(terminateBody(stub, c.id).unresolvedSessions, 1);
  return { pt, c, s, stub };
}

test("Decision A: admin rules NOT_DELIVERED (PT_NO_SHOW_CONFIRMED) - the held value is refunded ONCE, no extra compensation, no quota; a repeat / a second admin is refused", { skip }, async () => {
  const { pt, c, s, stub } = await heldReport();
  try {
    const rulings = await Promise.allSettled([
      bookingService.resolveDispute(s.id, "admin-1", "PT_NO_SHOW_CONFIRMED", "PT thật sự vắng"),
      bookingService.resolveDispute(s.id, "admin-2", "CANCELLED", "ruling 2"),
    ]);
    assert.equal(rulings.filter((r) => r.status === "fulfilled").length, 1, "two admins cannot rule it two ways");
    const lost = rulings.find((r) => r.status === "rejected")!;
    assert.ok(["SESSION_ALREADY_PROCESSED"].includes(code(lost) ?? "") || httpStatus(lost) === 400 || httpStatus(lost) === 409);
    const resolves = callsFor(stub, c.id, "resolveUnresolvedSession");
    assert.equal(resolves.length, 1, "settled once");
    assert.equal(resolves[0].body.outcome, "NOT_DELIVERED");
    assert.equal(resolves[0].body.idempotencyKey, `UNRESOLVED_SESSION:${s.id}`);
    assert.equal(callsFor(stub, c.id, "noShow").length, 0, "no separate no-show compensation (it would pay the session twice)");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([after.usedSessions, after.compensatedSessions], [2, 0]);
    await assert.rejects(bookingService.resolveDispute(s.id, "admin-3", "COMPLETED", "late"), (e: any) => e.status === 400 || e.status === 409);
    assert.equal(callsFor(stub, c.id, "resolveUnresolvedSession").length, 1);
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("Decision A: admin rules DELIVERED (COMPLETED) - the held value is released ONCE to the PT / platform and the session counts as used", { skip }, async () => {
  const { pt, c, s, stub } = await heldReport();
  try {
    await bookingService.resolveDispute(s.id, "admin-1", "COMPLETED", "buổi có diễn ra");
    const resolves = callsFor(stub, c.id, "resolveUnresolvedSession");
    assert.equal(resolves.length, 1);
    assert.equal(resolves[0].body.outcome, "DELIVERED");
    assert.equal(callsFor(stub, c.id, "releaseSession").length, 0, "not the ordinary release");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.usedSessions, 3);
    assert.equal(after.status, "CANCELLED", "an ended contract stays ended");
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    assert.deepEqual([sess.status, sess.sessionDeducted], ["COMPLETED", true]);
    await assert.rejects(bookingService.resolveDispute(s.id, "admin-2", "CANCELLED", "again"), (e: any) => e.status === 400 || e.status === 409);
    assert.equal(callsFor(stub, c.id, "resolveUnresolvedSession").length, 1);
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

test("Decision A: the held report appears in the admin dispute queue with its report time, type and reason; the PT cannot answer it any more", { skip }, async () => {
  const { pt, c, s, stub } = await heldReport();
  try {
    const queue = await bookingService.listDisputed();
    const row = queue.find((q) => q.id === s.id);
    assert.ok(row, "listed where admins already look");
    assert.equal(row!.disputeType, "PT_NO_SHOW_CLAIM");
    assert.ok(row!.disputedAt && row!.disputeReason === "PT không đến");
    await assert.rejects(bookingService.respondToNoShowReport(s.id, pt, "AGREE"), (e: any) => e.status === 409 && e.code === "CONTRACT_ENDED");
    await assert.rejects(bookingService.markNoShow(s.id, pt, "PT"), (e: any) => e.status === 409 && e.code === "CONTRACT_ENDED");
    assert.equal(callsFor(stub, c.id, "noShow").length, 0);
  } finally {
    stub.restore();
    await scrubSessions([c.id]);
    await cleanup([pt], [c.id]);
  }
});

// ── 14. the lock itself ─────────────────────────────────────────────────────────────────────────

test("lock: callers of one contract are serialised (FIFO) and WAITERS HOLD NO DATABASE CONNECTION", { skip }, async () => {
  const id = `lock-${Date.now()}`;
  let inside = 0;
  let maxInside = 0;
  const order: number[] = [];
  const work = Array.from({ length: 24 }, (_, i) =>
    withContractLock(id, async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      order.push(i);
      await sleep(40);
      inside--;
    }),
  );
  await sleep(150);
  const open: any[] = await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'",
  );
  await Promise.all(work);
  assert.equal(maxInside, 1, "mutual exclusion");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "FIFO");
  assert.ok(open[0].n <= 1, `24 callers are queued but only ${open[0].n} transaction(s) are open (they used to be one connection per waiter)`);
});

test("lock: a lock held by another process is waited for at most CONTRACT_LOCK_WAIT_MS, then 503 CONTRACT_LOCK_BUSY - the connection is released", { skip }, async () => {
  const id = `busy-${Date.now()}`;
  process.env.CONTRACT_LOCK_WAIT_MS = "300";
  try {
    // another "process": a bare transaction on its own connection that holds the same advisory lock
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let acquired!: () => void;
    const got = new Promise<void>((r) => (acquired = r));
    const other = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        acquired();
        await holding;
      },
      { timeout: 20_000 },
    );
    await got;
    const t0 = Date.now();
    await assert.rejects(withContractLock(id, async () => "never"), (e: any) => e.status === 503 && e.code === "CONTRACT_LOCK_BUSY");
    assert.ok(Date.now() - t0 < 3000, "bounded wait");
    release();
    await other;
    assert.equal(await withContractLock(id, async () => "ok"), "ok", "free again");
  } finally {
    delete process.env.CONTRACT_LOCK_WAIT_MS;
  }
});

test("lock bounds (CODE AUDIT pinned): every payment-service call is bounded by an HTTP timeout, and the worst case inside the lock stays far below the lock transaction's timeout", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../clients/payment.client.ts"), "utf8");
  const timeouts = [...src.matchAll(/timeout:\s*([\d_]+)/g)].map((m) => Number(m[1].replace(/_/g, "")));
  assert.ok(timeouts.length >= 8, "every money method names its timeout");
  const worstCall = Math.max(...timeouts);
  const releaseSrc = src.slice(src.indexOf("async releaseSession"), src.indexOf("async moneyBreakdown"));
  const moneyCalls = [...releaseSrc.matchAll(/timeout:\s*([\d_]+)/g)].map((m) => Number(m[1].replace(/_/g, "")));
  assert.ok(moneyCalls.every((t) => t > 0 && t <= worstCall));
  // an ending: drain retries + the termination call (+ generous 20 s for queries) must fit well inside the lock transaction
  const endingWorst = SETTLEMENT_DRAIN_LIMIT * 15_000 + 20_000 + 20_000;
  assert.ok(endingWorst < TX_TIMEOUT_MS, `${endingWorst} ms < ${TX_TIMEOUT_MS} ms`);
  assert.ok(LOCK_WAIT_MS + endingWorst < TX_TIMEOUT_MS * 2, "waiting for the lock never eats the holder's budget (the wait is bounded by lock_timeout)");
});
