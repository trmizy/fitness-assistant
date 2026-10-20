/**
 * DQ-2(a) follow-up - the refund state of a PT-fault (NO_SHOW) session, derived from the data that already exists.
 *
 * UNIT (no database): deriveRefundInfo - the three states and the owner's wording rules (OPEN is never "paid", WAIVED is never FULL).
 * BACKEND INTEGRATION (isolated *_test user database, real session_settlements rows, real bookingService.getContractSessions);
 * payment-service is a TEST FIXTURE at the client boundary (the ledger lookup answers a scripted record, the money calls record
 * their bodies). The REAL ledger + HTTP flow is in cross-service-money-d77-obligation.e2e.test.ts.
 *
 * Money: a 1,000,000 / 4 session contract, one session = 250,000.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { deriveRefundInfo, refundInfoFor } from "../services/session-refund-state";
import { bookingService } from "../services/booking.service";
import { compensateNoShowMoney } from "../services/contract-payout.service";
import { addSession, cleanup, makeContract, makePt, skip, stubs } from "./pt-restriction.test-helpers";

const money = (paid: string, owed: string) => ({ paid, owed, unpaid: String(Number(owed) - Number(paid)) });

// ── UNIT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("deriveRefundInfo: paid = owed -> FULL; 0 < paid < owed -> PARTIAL with the remainder pending; paid = 0 -> PENDING with everything pending", () => {
  assert.deepEqual(deriveRefundInfo(money("250000.00", "250000.00")), { refundState: "FULL", refundedAmount: "250000.00", refundPendingAmount: "0.00" });
  assert.deepEqual(deriveRefundInfo(money("125000.00", "250000.00")), { refundState: "PARTIAL", refundedAmount: "125000.00", refundPendingAmount: "125000.00" });
  assert.deepEqual(deriveRefundInfo(money("0.00", "250000.00")), { refundState: "PENDING", refundedAmount: "0.00", refundPendingAmount: "250000.00" });
});

test("deriveRefundInfo: an OPEN obligation is never shown as paid; RESOLVED is FULL; WAIVED is never FULL and has nothing pending", () => {
  assert.equal(deriveRefundInfo(money("125000.00", "250000.00"), "OPEN").refundState, "PARTIAL");
  assert.equal(deriveRefundInfo(money("0.00", "250000.00"), "OPEN").refundState, "PENDING");
  assert.deepEqual(deriveRefundInfo(money("125000.00", "250000.00"), "RESOLVED"), { refundState: "FULL", refundedAmount: "125000.00", refundPendingAmount: "0.00" });
  assert.deepEqual(deriveRefundInfo(money("125000.00", "250000.00"), "WAIVED"), { refundState: "PARTIAL", refundedAmount: "125000.00", refundPendingAmount: "0.00" });
  assert.deepEqual(deriveRefundInfo(money("0.00", "250000.00"), "WAIVED"), { refundState: "PENDING", refundedAmount: "0.00", refundPendingAmount: "0.00" });
});

// ── BACKEND INTEGRATION ──────────────────────────────────────────────────────────────────────────────────────────────

const record = (key: string, result: Record<string, unknown>, obligation?: { id: string; status: string }) => ({
  key,
  kind: "NO_SHOW",
  transactionId: "txn",
  result,
  createdAt: new Date().toISOString(),
  fingerprinted: true,
  ...(obligation ? { obligation: { ...obligation, owed: "250000.00", paid: "0.00", unpaid: "250000.00" } } : {}),
});

/** A 4-session contract with `n` NO_SHOW sessions, each with a PT_NO_SHOW row in the given status/result. */
async function scenario(rows: Array<{ status: string; result?: Record<string, unknown> | null }>) {
  const pt = await makePt();
  const contract = await makeContract(pt, { totalSessions: 4, price: 1_000_000, compensatedSessions: rows.length });
  const sessions: Array<{ id: string }> = [];
  for (const r of rows) {
    const s = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000), { ptAtFault: true });
    await prisma.sessionSettlement.create({
      data: {
        kind: "PT_NO_SHOW_COMPENSATION",
        idempotencyKey: `PT_NO_SHOW:${s.id}`,
        contractId: contract.id,
        sessionId: s.id,
        status: r.status as any,
        ...(r.result ? { result: r.result as any } : {}),
      },
    });
    sessions.push(s);
  }
  return { pt, contract, sessions };
}

test("refund state from the stored answer: FULL needs no ledger call; PARTIAL and PENDING carry the amounts; COMPLETED sessions get no state at all", { skip }, async () => {
  const full = { compensation: "250000.00", owed: "250000.00", paid: "250000.00", unpaid: "0.00" };
  const partial = { compensation: "125000.00", owed: "250000.00", paid: "125000.00", unpaid: "125000.00", obligationId: "obl-p" };
  const none = { compensation: "0.00", owed: "250000.00", paid: "0.00", unpaid: "250000.00", obligationId: "obl-n" };
  const { pt, contract, sessions } = await scenario([
    { status: "SETTLED", result: full },
    { status: "SETTLED", result: partial },
    { status: "SETTLED", result: none },
  ]);
  const completed = await addSession(contract, "COMPLETED", new Date(Date.now() - 2 * 86_400_000), { sessionDeducted: true });
  const s = stubs();
  s.ledger.ops.set(`PT_NO_SHOW:${sessions[1].id}`, record(`PT_NO_SHOW:${sessions[1].id}`, partial, { id: "obl-p", status: "OPEN" }));
  s.ledger.ops.set(`PT_NO_SHOW:${sessions[2].id}`, record(`PT_NO_SHOW:${sessions[2].id}`, none, { id: "obl-n", status: "OPEN" }));
  try {
    const list: any[] = await bookingService.getContractSessions(contract.id, contract.clientUserId);
    const by = (id: string) => list.find((x) => x.id === id);
    assert.deepEqual([by(sessions[0].id).refundState, by(sessions[0].id).refundedAmount, by(sessions[0].id).refundPendingAmount], ["FULL", "250000.00", "0.00"]);
    assert.deepEqual([by(sessions[1].id).refundState, by(sessions[1].id).refundedAmount, by(sessions[1].id).refundPendingAmount], ["PARTIAL", "125000.00", "125000.00"]);
    assert.deepEqual([by(sessions[2].id).refundState, by(sessions[2].id).refundedAmount, by(sessions[2].id).refundPendingAmount], ["PENDING", "0.00", "250000.00"]);
    assert.equal(by(completed.id).refundState, undefined, "a delivered session carries no refund state");
    assert.equal(by(completed.id).status, "COMPLETED");
    assert.ok(!s.ledger.lookups.includes(`PT_NO_SHOW:${sessions[0].id}`), "a fully refunded session needs no payment-service call");
    assert.deepEqual(new Set(s.ledger.lookups), new Set([`PT_NO_SHOW:${sessions[1].id}`, `PT_NO_SHOW:${sessions[2].id}`]), "only the unpaid ones are asked about (their live obligation status)");
    // and the PT sees the very same facts on the very same endpoint
    const asPt: any[] = await bookingService.getContractSessions(contract.id, contract.ptUserId);
    assert.equal(asPt.find((x) => x.id === sessions[1].id).refundState, "PARTIAL");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("the live obligation status wins: RESOLVED -> FULL (handled outside the ledger), WAIVED -> still not FULL with nothing pending, OPEN -> pending; payment-service down -> the stored remainder stays pending", { skip }, async () => {
  const partial = { compensation: "125000.00", owed: "250000.00", paid: "125000.00", unpaid: "125000.00", obligationId: "obl-x" };
  const { pt, contract, sessions } = await scenario([{ status: "SETTLED", result: partial }, { status: "SETTLED", result: partial }, { status: "SETTLED", result: partial }]);
  const s = stubs();
  const statuses = ["RESOLVED", "WAIVED", "OPEN"];
  sessions.forEach((x, i) => s.ledger.ops.set(`PT_NO_SHOW:${x.id}`, record(`PT_NO_SHOW:${x.id}`, partial, { id: `obl-${i}`, status: statuses[i] })));
  try {
    const m = await refundInfoFor(sessions.map((x) => x.id));
    assert.deepEqual(m.get(sessions[0].id), { refundState: "FULL", refundedAmount: "125000.00", refundPendingAmount: "0.00" });
    assert.deepEqual(m.get(sessions[1].id), { refundState: "PARTIAL", refundedAmount: "125000.00", refundPendingAmount: "0.00" });
    assert.deepEqual(m.get(sessions[2].id), { refundState: "PARTIAL", refundedAmount: "125000.00", refundPendingAmount: "125000.00" });
    s.ledger.unreachable = true;
    const down = await refundInfoFor(sessions.map((x) => x.id));
    for (const x of sessions) assert.equal(down.get(x.id)!.refundState, "PARTIAL", "unreachable: never upgraded to paid");
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("a step that is not SETTLED (queued, failed, parked, UNCONFIRMED) is PENDING with no amount; no row at all (no money behind the contract) is NO claim; a settled row with no stored answer is read from the ledger", { skip }, async () => {
  const { pt, contract, sessions } = await scenario([
    { status: "PENDING" },
    { status: "FAILED" },
    { status: "NEEDS_HUMAN" },
    { status: "UNCONFIRMED" },
    { status: "SETTLED" }, // legacy: settled before the answer was stored
  ]);
  const noRow = await addSession(contract, "NO_SHOW", new Date(Date.now() - 86_400_000), { ptAtFault: true });
  const s = stubs();
  s.ledger.ops.set(`PT_NO_SHOW:${sessions[4].id}`, record(`PT_NO_SHOW:${sessions[4].id}`, { compensation: "250000.00", owed: "250000.00", paid: "250000.00", unpaid: "0.00" }));
  try {
    const m = await refundInfoFor([...sessions.map((x) => x.id), noRow.id]);
    for (const x of sessions.slice(0, 4)) assert.deepEqual(m.get(x.id), { refundState: "PENDING", refundedAmount: null, refundPendingAmount: null });
    assert.equal(m.get(sessions[4].id)!.refundState, "FULL", "read from the ledger's stored answer");
    assert.deepEqual(m.get(noRow.id), { refundState: null, refundedAmount: null, refundPendingAmount: null });
    // unreachable ledger + nothing stored: no claim either way
    s.ledger.unreachable = true;
    assert.equal((await refundInfoFor([sessions[4].id])).get(sessions[4].id)!.refundState, null);
  } finally {
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});

test("the answer of a PT no-show compensation is stored on its row when it is SETTLED (what the refund state reads)", { skip }, async () => {
  const { pt, contract, sessions } = await scenario([{ status: "PENDING" }]);
  const s = stubs();
  const noShow = { compensation: "125000.00", owed: "250000.00", paid: "125000.00", unpaid: "125000.00", shortfall: "125000.00", obligationId: "obl-1" };
  const restore = (await import("./pt-restriction.test-helpers")).patch((await import("../clients/payment.client")).paymentClient, "noShow", async () => noShow);
  try {
    const out = await compensateNoShowMoney(contract.id, sessions[0].id);
    assert.equal(out?.state, "SETTLED");
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_NO_SHOW:${sessions[0].id}` } });
    assert.equal(row.status, "SETTLED");
    assert.deepEqual(row.result, noShow);
    assert.ok(row.appliedAt);
    assert.equal((await refundInfoFor([sessions[0].id])).get(sessions[0].id)!.refundState, "PARTIAL");
  } finally {
    restore();
    s.restore();
    await cleanup([pt], [contract.id]);
  }
});
