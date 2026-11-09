/**
 * LATE GATE on UNDISPUTED sessions (policy guard fix, Q1/Q2) - BACKEND INTEGRATION on an isolated *_test database; payment-service is NOT started here: paymentClient is a recording stand-in
 * that always succeeds. The real-ledger money cases are in cross-service-money-policy-guard.e2e.test.ts.
 *
 * What is pinned: a session of an ORDINARY contract (never disputed, so it can never have a D-NEW-12 policy review) that has a D77 step is NOT held for the missing review. The step goes to the
 * ledger (release / no-show / ending) WITHOUT the settleLateOpen flag; with an approved ELIGIBLE review the flag is sent. The policy guard itself lives only at the dispute ruling and the Case Executor.
 * Fixture: makeContract(..., { eligibility: "none" }) = no review (the ordinary contract); "fixture" = the default approved ELIGIBLE review (TEST FIXTURE).
 *
 *   TEST_DATABASE_URL=...gymcoach_user_<x>_test... npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/late-gate-undisputed.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { bookingService } from "../services/booking.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { terminateContractMoney } from "../services/contract-payout.service";
import { disputeCaseService } from "../services/dispute-case/dispute-case.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";
// Fail-closed gate (lateOpenGate, DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED): the cases here expect an approved ELIGIBLE review to give settleLateOpen, so the suite turns the flag on in-process (effective only with NODE_ENV=test + the isolated *_test database).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

const created: { pts: string[]; contracts: string[] } = { pts: [], contracts: [] };
const OBS: Record<string, unknown> = {};
const obs = (key: string, v: unknown) => {
  OBS[key] = v;
  void v;
};

function fakeLedger() {
  const calls: Record<string, any[]> = { releaseSession: [], noShow: [], terminate: [], lateArrival: [], resolveUnresolvedSession: [] };
  const restores = [
    patch(paymentClient, "releaseSession", async (b: any) => {
      calls.releaseSession.push(b);
      return { released: { pt: "225000.00", gym: "0.00", platform: "25000.00" } };
    }),
    patch(paymentClient, "noShow", async (b: any) => {
      calls.noShow.push(b);
      return { compensation: "250000.00", paid: "250000.00", owed: "250000.00", unpaid: "0.00", shortfall: "0.00" };
    }),
    patch(paymentClient, "terminate", async (b: any) => {
      calls.terminate.push(b);
      // the real ledger answers with the held sessions it was asked to hold (`unresolved`); echoing the request keeps the stand-in honest
      return {
        refund: "750000.00", owed: "750000.00", paid: "750000.00", unpaid: "0.00", shortfall: "0.00",
        ...(b.unresolvedSessions ? { unresolved: { sessions: b.unresolvedSessions, amountHeld: "250000.00", byParty: { pt: "225000.00", gym: "0.00", platform: "25000.00" } } } : {}),
      };
    }),
    patch(paymentClient, "lateArrival", async (b: any) => {
      calls.lateArrival.push(b);
      return { compensation: "125000.00", paid: "125000.00", owed: "125000.00", unpaid: "0.00", shortfall: "0.00" };
    }),
    patch(paymentClient, "resolveUnresolvedSession", async (b: any) => {
      calls.resolveUnresolvedSession.push(b);
      return { moved: { pt: "0.00", gym: "0.00", platform: "0.00", client: "0.00" } };
    }),
    patch(paymentClient, "lookupLedgerOperation", async () => null),
  ];
  return { calls, restore: () => restores.reverse().forEach((r) => r()) };
}

/** A PT, a contract (1,000,000 / 4, ACTIVE) and ONE undisputed session that has a D77 row (the late-arrival compensation was already SETTLED). */
async function mk(eligibility: "none" | "fixture", status: "PENDING_CLIENT_CONFIRMATION" | "CONFIRMED") {
  const pt = await makePt();
  const c = await makeContract(pt, { totalSessions: 4, price: 1_000_000, usedSessions: 0 }, eligibility === "none" ? { eligibility: "none" } : {});
  created.pts.push(pt);
  created.contracts.push(c.id);
  const s = await addSession(c, status, new Date(Date.now() - 2 * DAY), {
    sessionMode: "ONLINE",
    ...(status === "PENDING_CLIENT_CONFIRMATION" ? { clientConfirmDeadline: new Date(Date.now() - HOUR) } : {}),
  });
  await prisma.sessionSettlement.create({
    data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.id}`, sessionId: s.id, contractId: c.id, status: "SETTLED" },
  });
  return { pt, c, s };
}

async function snapshot(sessionId: string, contractId: string, calls: Record<string, any[]>) {
  const sess = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  const k = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const rows = await prisma.sessionSettlement.findMany({ where: { sessionId }, orderBy: { idempotencyKey: "asc" } });
  return {
    session: { status: sess.status, sessionDeducted: sess.sessionDeducted, autoConfirmed: sess.autoConfirmed },
    contract: { used: k.usedSessions, compensated: k.compensatedSessions, status: k.status },
    settlements: rows.map((r) => ({ key: r.idempotencyKey.replace(sessionId, "<S>"), status: r.status, lastError: (r.lastError ?? "").slice(0, 200) })),
    ledgerCalls: Object.fromEntries(Object.entries(calls).map(([m, v]) => [m, v.length])),
    releaseSentSettleLateOpen: calls.releaseSession.map((b) => b.settleLateOpen ?? null),
    noShowSentSettleLateOpen: calls.noShow.map((b) => b.settleLateOpen ?? null),
  };
}

test.after(async () => {
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: created.contracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: created.contracts } } }).catch(() => {});
  await cleanup(created.pts, created.contracts).catch(() => {});
  await prisma.$disconnect();
});

for (const eligibility of ["none", "fixture"] as const) {
  const label = eligibility === "none" ? "NO review (the ordinary contract, never disputed)" : "approved review (TEST FIXTURE)";

  test(`(a) clientConfirmSession on an undisputed session with a SETTLED D77 row - ${label}`, { skip }, async () => {
    const x = await mk(eligibility, "PENDING_CLIENT_CONFIRMATION");
    const st = stubs();
    const ledger = fakeLedger();
    try {
      let threw: unknown = null;
      try {
        await bookingService.clientConfirmSession(x.s.id, x.c.clientUserId);
      } catch (e: any) {
        threw = { status: e?.status, code: e?.code, message: String(e?.message).slice(0, 160) };
      }
      const snap = { threw, ...(await snapshot(x.s.id, x.c.id, ledger.calls)) };
      obs(`a.${eligibility}`, snap);
      assert.equal(snap.threw, null);
      assert.equal(snap.ledgerCalls.releaseSession, 1, "the release reaches the ledger (never held for the missing review)");
      assert.equal(snap.session.status, "COMPLETED");
      assert.deepEqual(snap.settlements.map((r) => [r.key, r.status]), [["PT_LATE_ARRIVAL:<S>", "SETTLED"], ["SESSION_RELEASE:<S>", "SETTLED"]]);
      assert.deepEqual(snap.releaseSentSettleLateOpen, [eligibility === "none" ? null : true], "the flag is sent only with an approved ELIGIBLE review");
      assert.deepEqual([snap.contract.used, snap.contract.compensated], [1, 0]);
    } finally {
      ledger.restore();
      st.restore();
    }
  });

  test(`(b) runAutoConfirm on an undisputed session with a SETTLED D77 row - ${label}`, { skip }, async () => {
    const x = await mk(eligibility, "PENDING_CLIENT_CONFIRMATION");
    const st = stubs();
    const ledger = fakeLedger();
    try {
      const result = await runAutoConfirm({
        findExpiredPendingConfirmation: async () => [{ id: x.s.id, contractId: x.c.id, clientUserId: x.c.clientUserId, ptUserId: x.c.ptUserId }],
        deductQuotaOnce: async (sid, cid, transition) => (await import("../services/booking.service")).deductQuotaOnce(sid, cid, undefined, transition),
        notify: async () => undefined,
      });
      const snap = { result, ...(await snapshot(x.s.id, x.c.id, ledger.calls)) };
      obs(`b.${eligibility}`, snap);
      assert.equal(snap.ledgerCalls.releaseSession, 1, "auto-confirm: the release reaches the ledger");
      assert.equal(snap.session.status, "COMPLETED");
      assert.deepEqual(snap.settlements.map((r) => [r.key, r.status]), [["PT_LATE_ARRIVAL:<S>", "SETTLED"], ["SESSION_RELEASE:<S>", "SETTLED"]]);
      assert.deepEqual(snap.releaseSentSettleLateOpen, [eligibility === "none" ? null : true]);
    } finally {
      ledger.restore();
      st.restore();
    }
  });

  test(`(c) markNoShow (PT admits) on a CONFIRMED session with a SETTLED D77 row - ${label}`, { skip }, async () => {
    const x = await mk(eligibility, "CONFIRMED");
    const st = stubs();
    const ledger = fakeLedger();
    try {
      let threw: unknown = null;
      try {
        await bookingService.markNoShow(x.s.id, x.pt, "PT");
      } catch (e: any) {
        threw = { status: e?.status, code: e?.code, message: String(e?.message).slice(0, 160) };
      }
      const snap = { threw, ...(await snapshot(x.s.id, x.c.id, ledger.calls)) };
      obs(`c.${eligibility}`, snap);
      assert.equal(snap.ledgerCalls.noShow, 1, "the no-show compensation reaches the ledger");
      assert.deepEqual(snap.settlements.map((r) => [r.key, r.status]), [["PT_LATE_ARRIVAL:<S>", "SETTLED"], ["PT_NO_SHOW:<S>", "SETTLED"]]);
      assert.deepEqual(snap.noShowSentSettleLateOpen, [eligibility === "none" ? null : true]);
      assert.deepEqual([snap.contract.used, snap.contract.compensated], [0, 1]);
    } finally {
      ledger.restore();
      st.restore();
    }
  });

  test(`(d) after (a), the contract ending (CLIENT_CANCELLED) - ${label}`, { skip }, async () => {
    const x = await mk(eligibility, "PENDING_CLIENT_CONFIRMATION");
    const st = stubs();
    const ledger = fakeLedger();
    try {
      await bookingService.clientConfirmSession(x.s.id, x.c.clientUserId).catch(() => undefined);
      let threw: unknown = null;
      try {
        await terminateContractMoney(x.c.id, "CLIENT_CANCELLED", { cancelledBy: x.c.clientUserId });
      } catch (e: any) {
        threw = { status: e?.status, code: e?.code, message: String(e?.message).slice(0, 200) };
      }
      const k = await prisma.contract.findUniqueOrThrow({ where: { id: x.c.id } });
      const rows = await prisma.sessionSettlement.findMany({ where: { contractId: x.c.id }, orderBy: { idempotencyKey: "asc" } });
      const snap = { threw, terminateCalls: ledger.calls.terminate.length, terminateBody: ledger.calls.terminate[0] ? { usedSessions: ledger.calls.terminate[0].usedSessions, unresolvedSessions: ledger.calls.terminate[0].unresolvedSessions ?? 0, heldIds: (ledger.calls.terminate[0].unresolvedSessionIds ?? []).length } : null, contractStatus: k.status, rows: rows.map((r) => [r.idempotencyKey.replace(x.s.id, "<S>").replace(x.c.id, "<C>"), r.status]) };
      obs(`d.${eligibility}`, snap);
      assert.equal(snap.threw, null);
      assert.equal(snap.terminateCalls, 1);
      assert.equal(snap.contractStatus, "CANCELLED");
      assert.equal(snap.terminateBody?.unresolvedSessions, 0, "nothing held: the release was performed before the ending");
    } finally {
      ledger.restore();
      st.restore();
    }
  });
}

test("(f) NO API path creates a policy review for a contract that has no disputed session: openCase refuses a CONFIRMED / PENDING_CLIENT_CONFIRMATION session and a review needs an existing case (documented fact, not a recovery path)", { skip }, async () => {
  const x = await mk("none", "PENDING_CLIENT_CONFIRMATION");
  const admin = { id: randomUUID(), role: "ADMIN" };
  let open: unknown = null;
  try {
    await disputeCaseService.openCase(admin, x.s.id);
    open = "OPENED";
  } catch (e: any) {
    open = { status: e?.status, code: e?.code, message: String(e?.message).slice(0, 160) };
  }
  let propose: unknown = null;
  try {
    await disputeCaseService.proposePolicyEligibility(admin, randomUUID(), { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [randomUUID()], reasoning: "x" });
  } catch (e: any) {
    propose = { status: e?.status, code: e?.code };
  }
  const cases = await prisma.disputeCase.count({ where: { contractId: x.c.id } });
  const reviews = await prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId: x.c.id } });
  obs("f", { openCase: open, proposeWithoutCase: propose, casesForContract: cases, reviewsForContract: reviews });
  assert.deepEqual(open, { status: 409, code: "SESSION_NOT_DISPUTED", message: "Chỉ mở hồ sơ cho buổi tập đang bị khiếu nại hoặc đang chờ PT phản hồi báo vắng mặt" });
  assert.equal(cases, 0);
  assert.equal(reviews, 0);
});
