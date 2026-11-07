/**
 * DISPUTE CASE Slice 2 / S2.0 - the D77 x three-outcome reconciliation matrix (B-1) on the REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service) - real HTTP between user-service's Express app (this process) and a spawned
 * payment-service child, real ledger, isolated *_test databases. TEST FIXTURE: the contract row (PENDING_PAYMENT, then really paid through
 * contractService.pay + a signed gateway IPN), session rows born CONFIRMED / online / already over with the room-attendance timestamps the
 * scenario needs, auth-service's token table, the NEEDS_HUMAN status given to a late-arrival row (stands for 12 failed attempts),
 * and the OPEN-on-ACTIVE state (the late-arrival row given the UNCONFIRMED status, then the REAL record-only door settleEndedCompensationRow writes the OPEN
 * obligation; no wallet is cut by hand any more). The ruling itself goes through the REAL OLD EXIT: POST /admin/sessions/:id/resolve
 * (bookingService.resolveDispute).
 *
 * 31/10/2026 FINAL REMEDIATION: Ngai decided I5 = A + C1 and I6 = A; the expectations below are those decisions (the 30/10 version of this file pinned the
 * observed, wrong behaviour as LECH). V = 250,000, L = 125,000:
 *   COMPLETED   parties receive V - L (112,500 + 12,500) whether L was paid or was OPEN; the client's cash for the session is L; nothing from other sessions.
 *               D77 FINAL (01/11/2026, phuong an A): an OPEN L is PAID to the client INSIDE the settlement of the session (obligation PAID_VIA_LEDGER); nothing is held back.
 *   NO_SHOW     the client's TOTAL for the session is V (in cash after the final fix; the OPEN L is paid inside the no-show), never V + L; parties receive 0;
 *               ACTIVE: compensated +1; ENDED: compensated unchanged.
 *   CANCELLED   refused 409 CANCELLED_BLOCKED_BY_D77 with nothing written (status, money, quota).
 *
 * Opt-in; run ALONE (it spawns payment-service and TRUNCATEs its ledger tables):
 *   cd backend/services/user-service
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL="...gymcoach_user_<x>_test?schema=public" \
 *   E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_<x>_test?schema=public" \
 *     ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-dispute-d77.e2e.test.ts
 *
 * EXPECTATIONS COME FROM POLICY, NOT FROM THE CODE (DQ-2(a), D77, D48, D85, D88) - the invariants I1-I6 of the S2.0 brief:
 *   V = price / totalSessions (one session's unit value, from the contract snapshot), L = the late-arrival compensation (D77), Rates = the contract's
 *   snapshot rates. Contract: 1,000,000 / 4 sessions, platform 0.10 / PT 0.90 / no gym / no holdback  =>  V = 250,000, L = 125,000.
 *   I1 cash to the client FOR THIS SESSION (everything paid + everything still owed as OPEN):  COMPLETED = L;  PT_NO_SHOW_CONFIRMED = V (the L already
 *      received counts INSIDE V, never V + L);  CANCELLED -> I6.
 *   I2 what PT / gym / platform end up with for this session:  COMPLETED = V - L split by Rates;  PT_NO_SHOW_CONFIRMED = 0;  nobody charged twice.
 *   I3 quota:  COMPLETED usedSessions +1;  PT_NO_SHOW_CONFIRMED compensatedSessions +1 (DQ-2(a));  CANCELLED unchanged;  never +2.
 *   I4 the ledger agrees: the buckets of the contract's transaction add up to the price, no bucket is negative, escrow = claims, no pooled wallet / other contract touched.
 *   I5 an OPEN D77 obligation stays OPEN and unchanged (never disappears, never reported paid); with PT_NO_SHOW_CONFIRMED
 *      (L paid + L open + new refund) must not exceed V.  Whether the OPEN L is MERGED into the V refund or kept separate is a POLICY QUESTION - recorded, not decided.
 *   I6 CANCELLED after a D77: policy UNDEFINED -> the observed behaviour is only RECORDED, verdict POLICY_DECISION_REQUIRED, no expected value.
 *
 * The verdict of each case (KHOP / LECH / POLICY_DECISION_REQUIRED) is computed from those invariants and PINNED below (`PINNED`) so a change of the
 * money exit's behaviour makes this file fail loudly. A pinned LECH is a documented finding, NOT an approval: every D77 combination stays EXEC_BLOCKED
 * for the Case executor until Ngai approves the table (see the dispute-case-execution tests).
 * Set S2_0_REPORT=<path> to also write the full table (JSON) to a file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type GymTerms, type Harness, type PaidContract } from "./cross-service-money.harness";
// Fail-closed late-open switch (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, user-service gate AND the payment-service child it spawns): this suite PAYS an OPEN late-arrival obligation, so it is turned on in-process before the harness starts (the child inherits it at spawn).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const SESSIONS = 4;
const V = 250_000;
const L = 125_000;
const HELD_ERROR = "CANCELLED_BLOCKED_BY_D77";

type Outcome = "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED";
type ContractState = "ACTIVE" | "ENDED";
type D77State = "SETTLED" | "PENDING" | "OPEN";
type Verdict = "KHOP" | "LECH" | "BLOCKED_409";

let H: Harness;
let restoreGym: () => void = () => {};
test.before(async () => {
  if (skip) return;
  H = await startHarness({ paymentAuth: true });
  // TEST FIXTURE (same as cross-service-money-d77-boundary): the gym-tied contract of the C1 gym cases is confirmed against a stubbed gym-service answer.
  const { gymClient } = await import("../clients/gym.client");
  const original = gymClient.getActiveCollaboration;
  const originalMembership = gymClient.getClientMembershipAtGym;
  (gymClient as any).getActiveCollaboration = async () => ({ collaborationId: "agr-d77-fr", platformRate: "0.10", ptRate: "0.55", gymRate: "0.35", brandId: null, agreementScope: null });
  (gymClient as any).getClientMembershipAtGym = async () => ({
    hasActiveMembership: true,
    brandId: null,
    membership: { membershipId: "mem-d77-fr", planName: "fixture", purchaseGymId: "gym", startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 365 * 86_400_000).toISOString() },
  });
  restoreGym = () => {
    (gymClient as any).getActiveCollaboration = original;
    (gymClient as any).getClientMembershipAtGym = originalMembership;
  };
});
test.after(async () => {
  restoreGym();
  if (H) await H.close();
});

const num = (v: unknown) => Number(v ?? 0);
const OPEN_STATUSES = ["OPEN", "UNDER_REVIEW", "APPROVED_FOR_PAYMENT", "AWAITING_EVIDENCE"];

async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ key: r.key as string, kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function opResult(key: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(`SELECT kind, result FROM ledger_operations WHERE key = $1`, key);
  return rows[0] ? { kind: rows[0].kind as string, result: rows[0].result as any } : null;
}
async function cutPending(ownerType: "PT" | "PLATFORM", ownerId: string, cut: number) {
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET pending_balance = pending_balance - ${cut} WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`, ownerType, ownerId);
  await H.payDb.$executeRawUnsafe(`UPDATE wallets SET available_balance = available_balance - ${cut} WHERE owner_type = 'PLATFORM' AND owner_id = 'ESCROW'`);
}
const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
/** TEST FIXTURE: "time passes" - the back-off of every unsettled row of the contract has elapsed - then the settlement sweep runs (three ticks). */
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}

interface Fx {
  c: PaidContract;
  S: { id: string };
  adminToken: string;
  adminId: string;
  contractState: ContractState;
  d77: D77State;
}

/** An online session that is already over; the PT joined 16 min late, the client on time -> the room-close sweep records D77. */
const lateSession = (c: PaidContract) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
};

/** Builds a DISPUTED session in the requested contract state and D77 state, entirely through the real doors (sweep, dispute, terminate). */
async function build(contractState: ContractState, d77: D77State, gym?: GymTerms): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: SESSIONS, ...(gym ? { gym } : {}) });
  const adminId = randomUUID();
  const adminToken = H.tokenFor(adminId, "ADMIN");
  const S = await lateSession(c);
  // PENDING / OPEN-on-ended: payment-service is down when the sweep decides, so the intent is recorded and the money step fails.
  const payDown = d77 === "PENDING" || d77 === "OPEN";
  if (payDown) await H.stopPayment();
  const swept = await runSweep();
  assert.deepEqual(swept, { scanned: 1, resolved: 1 }, "the sweep decided the late session");
  if (payDown) await H.startPayment();
  const afterSweep = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
  assert.equal(afterSweep.status, "PENDING_CLIENT_CONFIRMATION");
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  if (d77 === "OPEN" && contractState === "ENDED") {
    assert.notEqual(row.status, "SETTLED", "fixture: the compensation did not happen");
    await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
  }
  if (d77 === "OPEN" && contractState === "ACTIVE") {
    // The ledger never performed the step (payment-service was down): the SAME record-only door the ending uses writes the OPEN obligation. No wallet is touched.
    assert.notEqual(row.status, "SETTLED", "fixture: the compensation did not happen");
    await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
    assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  }
  if (d77 === "PENDING") assert.notEqual(row.status, "SETTLED", "fixture: D77 intent recorded, settlement not SETTLED");
  const disp = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(disp.status, 200, JSON.stringify(disp.body));
  if (contractState === "ENDED") {
    const end = await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
    assert.equal(end.status, 200, JSON.stringify(end.body));
  }
  return { c, S, adminToken, adminId, contractState, d77 };
}

async function snap(fx: Fx) {
  const { c, S } = fx;
  const contract = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
  const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: S.id } });
  const rows = await H.m.prisma.sessionSettlement.findMany({ where: { sessionId: S.id }, orderBy: { createdAt: "asc" } });
  const obs = await obligations(c.txnId);
  const entries = await H.entries(c.txnId);
  const sumNet = entries.filter((e) => !(e.ownerType === "PLATFORM" && e.ownerId === "ESCROW")).reduce((s, e) => s + (e.type === "CREDIT" ? e.amount : -e.amount), 0);
  const late = await opResult(`PT_LATE_ARRIVAL:${S.id}`);
  const bucket = async (ownerType: string, b: "PENDING" | "AVAILABLE", id?: string) => H.net(c.txnId, ownerType, b, id);
  return {
    contractStatus: contract.status as string,
    used: contract.usedSessions as number,
    comp: contract.compensatedSessions as number,
    session: { status: sess.status as string, deducted: sess.sessionDeducted, ptAtFault: sess.ptAtFault },
    settlements: rows.map((r) => `${r.kind}:${r.status}`),
    obligations: obs,
    openUnpaidLate: obs.filter((o) => o.key === `PT_LATE_ARRIVAL:${S.id}` && OPEN_STATUSES.includes(o.status)).reduce((s, o) => s + o.unpaid, 0),
    openUnpaidOther: obs.filter((o) => o.key !== `PT_LATE_ARRIVAL:${S.id}` && OPEN_STATUSES.includes(o.status)).reduce((s, o) => s + o.unpaid, 0),
    clientWallet: (await H.wallet("CLIENT", c.clientUserId)).a,
    ptAvail: await bucket("PT", "AVAILABLE"),
    ptPend: await bucket("PT", "PENDING"),
    platAvail: await bucket("PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await bucket("PLATFORM", "PENDING", "REVENUE"),
    sumNet,
    lateOp: late ? { kind: late.kind, charged: late.result?.charged ?? null, paid: late.result?.paid ?? null, owed: late.result?.owed ?? null, unpaid: late.result?.unpaid ?? null } : null,
    ops: ((await H.payDb.$queryRawUnsafe(`SELECT key FROM ledger_operations WHERE key LIKE '%:${S.id}' ORDER BY key`)) as any[]).map((r) => r.key as string),
  };
}
type Snap = Awaited<ReturnType<typeof snap>>;

interface CaseRow {
  id: string;
  outcome: Outcome;
  contract: ContractState;
  d77: D77State;
  d77Reached: string;
  resolveStatus: number;
  resolveBody: string;
  expected: Record<string, string>;
  observed: Record<string, unknown>;
  violations: string[];
  notes: string[];
  verdict: Verdict;
}
const TABLE: CaseRow[] = [];

/** Runs the ruling through the OLD exit and evaluates the invariants. */
async function runCase(outcome: Outcome, contractState: ContractState, d77: D77State, hooks: { afterResolve?: (fx: Fx) => Promise<void> } = {}): Promise<{ fx: Fx; row: CaseRow; before: Snap; after: Snap }> {
  const fx = await build(contractState, d77);
  const before = await snap(fx);
  const res = await H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, fx.adminToken, { resolution: outcome, note: `S2.0 ${outcome}` });
  if (hooks.afterResolve) await hooks.afterResolve(fx);
  const immediate = await snap(fx);
  // The CONVERGED state: the settlement sweep retries whatever the ruling (or the D77 step) left unsettled. The invariants are judged here.
  await drain(fx.c.id);
  const after = await snap(fx);
  const lateRow = before.settlements.find((s) => s.startsWith("PT_LATE_ARRIVAL_COMPENSATION")) ?? "none";
  const d77Reached = `${lateRow}${before.openUnpaidLate > 0 ? ` + OPEN obligation unpaid ${before.openUnpaidLate}` : ""}`;

  // ── facts, in money terms (the converged state, `after`) ──
  const paidOf = (d: Snap["lateOp"]) => (d ? num(d.paid ?? (d.charged ? num(d.charged.pt) + num(d.charged.gym) + num(d.charged.platform) : 0)) : 0);
  const lPaid = paidOf(after.lateOp); // everything the late-arrival step paid the client, whenever it did (before or after the ruling)
  const lPaidLater = lPaid - paidOf(before.lateOp); // ... of which paid only AFTER the ruling (a D77 step that was still unsettled)
  const lOpen = after.openUnpaidLate; // still owed to the client for the late arrival, as OPEN (converged state)
  const refundDelta = after.clientWallet - before.clientWallet - lPaidLater; // what the RULING itself credited the client (late money counted once, in lPaid)
  const newOpen = after.openUnpaidOther - before.openUnpaidOther;
  const partiesDelta = after.ptAvail + after.platAvail - (before.ptAvail + before.platAvail);
  const clientTotal = lPaid + lOpen + refundDelta + newOpen;

  const violations: string[] = [];
  const notes: string[] = [];
  const expected: Record<string, string> = {};
  // The part of the session's own money that corresponds to an OPEN L and was therefore paid to nobody: it stays in the contract's pending.
  const heldForOpenL = 0; // D77 FINAL: nothing is held back for an OPEN L any more - it is paid inside the settlement of the session
  const takenOther = contractState === "ACTIVE" && outcome !== "CANCELLED" ? before.ptPend + before.platPend - (after.ptPend + after.platPend) - (V - paidOf(before.lateOp)) + heldForOpenL : 0;
  if (outcome === "CANCELLED") {
    const code = (res.body as any)?.error?.code ?? (res.body as any)?.code;
    expected.I6 = `409 ${HELD_ERROR}; session still DISPUTED; no money, no obligation, no quota, no settlement row changed`;
    if (res.status !== 409 || code !== HELD_ERROR) violations.push(`I6: the old exit answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    for (const k of ["used", "comp", "clientWallet", "ptAvail", "platAvail", "ptPend", "platPend"] as const) {
      if (immediate[k] !== before[k]) violations.push(`I6: ${k} changed ${before[k]} -> ${immediate[k]} by a refused ruling`);
    }
    if (immediate.session.status !== "DISPUTED") violations.push(`I6: session status ${before.session.status} -> ${immediate.session.status}`);
    if (JSON.stringify(immediate.settlements) !== JSON.stringify(before.settlements)) violations.push("I6: the settlement rows changed");
    if (JSON.stringify(immediate.obligations) !== JSON.stringify(before.obligations)) violations.push("I6: the obligations changed");
    if (after.used !== before.used || after.comp !== before.comp || after.session.status !== "DISPUTED") violations.push("I6: quota / status moved after the sweeps");
  } else if (outcome === "COMPLETED") {
    expected.I1 = `client cash for the session = L = ${L} (paid + OPEN); nothing more`;
    expected.I2 = `PT+gym+platform receive V - L = ${V - L}, whether L was paid or is still OPEN; nothing from other sessions`;
    expected.I3 = "usedSessions +1, compensatedSessions unchanged";
    if (clientTotal !== L) violations.push(`I1: client total ${clientTotal} (L paid ${lPaid} + L open ${lOpen} + refund ${refundDelta} + new open ${newOpen}) != L ${L}`);
    if (partiesDelta !== V - L) violations.push(`I2: parties received ${partiesDelta} != V - L ${V - L}`);
    if (after.used !== before.used + 1 || after.comp !== before.comp) violations.push(`I3: used ${before.used}->${after.used}, compensated ${before.comp}->${after.comp}`);
  } else if (outcome === "PT_NO_SHOW_CONFIRMED") {
    expected.I1 = `client cash for the session = V = ${V} (the L already received counts inside V); L paid + L open + new refund <= V`;
    expected.I2 = "PT/gym/platform receive 0 for this session";
    const compDelta = contractState === "ACTIVE" ? 1 : 0;
    expected.I3 = contractState === "ACTIVE" ? "compensatedSessions +1, usedSessions unchanged" : "ENDED contract: compensatedSessions NOT increased (deliberate), usedSessions unchanged";
    if (clientTotal !== V) violations.push(`I1: client total ${clientTotal} (L paid ${lPaid} + L open ${lOpen} + refund ${refundDelta} + new open ${newOpen}) != V ${V}`);
    if (clientTotal > V) violations.push(`I5: L paid + L open + new refund ${clientTotal} exceeds V ${V}`);
    if (partiesDelta !== 0) violations.push(`I2: parties received ${partiesDelta} != 0`);
    if (after.comp !== before.comp + compDelta || after.used !== before.used) violations.push(`I3: used ${before.used}->${after.used}, compensated ${before.comp}->${after.comp}`);
  }
  // I4b: the contract's own pending must still fund exactly the sessions that are still to be delivered (a ledger that sums to the price can still
  // have spent the NEXT session's money). ACTIVE: pending = remaining sessions x V.  ENDED: every held session was settled, nothing is left in pending.
  // An OPEN L is paid to nobody, so its V-share stays in pending (DESIGN REQUIRED) - judged separately as `heldForOpenL`.
  const pendingTotal = after.ptPend + after.platPend;
  if (outcome !== "CANCELLED") {
    const remaining = SESSIONS - after.used - after.comp;
    const expectPending = (contractState === "ACTIVE" ? remaining * V : 0) + heldForOpenL;
    expected.I4b = contractState === "ACTIVE" ? `pending = remaining x V${heldForOpenL ? ` + ${heldForOpenL} held for the OPEN L` : ""}` : `nothing left in pending after the held session is settled${heldForOpenL ? ` except ${heldForOpenL} held for the OPEN L` : ""}`;
    if (pendingTotal !== expectPending) violations.push(`I4b: contract pending is ${pendingTotal}, expected ${expectPending} (${contractState === "ACTIVE" ? `${remaining} remaining x V` : "ended contract"}${heldForOpenL ? ` + ${heldForOpenL} held for the OPEN L` : ""})`);
  }
  // I4 / I5 apply to every case, including the recorded-only CANCELLED ones (a ledger that does not add up is never a policy question).
  expected.I4 = `buckets of the transaction add up to the price ${PRICE}; no negative bucket; escrow = claims`;
  if (Math.round(after.sumNet) !== PRICE) violations.push(`I4: buckets of the transaction add up to ${after.sumNet}, not the price ${PRICE}`);
  if (before.openUnpaidLate > 0) {
    const lateOb = after.obligations.find((o) => o.key === `PT_LATE_ARRIVAL:${fx.S.id}`);
    if (outcome === "CANCELLED") {
      expected.I5 = `the OPEN late-arrival obligation (unpaid ${before.openUnpaidLate}) is untouched by a refused ruling`;
    } else {
      expected.I5 = `the OPEN late-arrival obligation (unpaid ${before.openUnpaidLate}) is PAID to the client inside the settlement: PAID_VIA_LEDGER, paid ${L}, unpaid 0, one SETTLE_VIA_LEDGER event`;
      if (!lateOb || lateOb.status !== "PAID_VIA_LEDGER" || lateOb.paid !== L || lateOb.unpaid !== 0) violations.push(`I4/I5: late obligation is ${JSON.stringify(lateOb)} (expected PAID_VIA_LEDGER ${L}/0)`);
      const events = (await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM contract_unpaid_obligation_events e JOIN contract_unpaid_obligations o ON o.id = e.obligation_id WHERE o.key = $1 AND e.action::text = 'SETTLE_VIA_LEDGER'`, `PT_LATE_ARRIVAL:${fx.S.id}`)) as any[];
      if (events[0].n !== 1) violations.push(`I8: ${events[0].n} SETTLE_VIA_LEDGER events (expected 1)`);
    }
  }
  if (outcome !== "CANCELLED" && res.status !== 200) violations.push(`the old exit answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  if (outcome === "CANCELLED" && before.openUnpaidLate > 0 && after.openUnpaidLate !== before.openUnpaidLate) violations.push("the OPEN late-arrival obligation changed by a refused ruling");
  // Nothing may be taken from the OTHER sessions (ACTIVE): what left pending = the session own money that was paid out (V - L paid before - the OPEN L share).
  if (outcome !== "CANCELLED" && contractState === "ACTIVE" && takenOther !== 0) violations.push(`taken from other sessions: ${takenOther}`);
  await H.invariant(`S2.0 ${outcome}/${contractState}/${d77}`);

  const verdict: Verdict = violations.length ? "LECH" : outcome === "CANCELLED" ? "BLOCKED_409" : "KHOP";
  const row: CaseRow = {
    id: `${outcome}/${contractState}/${d77}`,
    outcome,
    contract: contractState,
    d77,
    d77Reached,
    resolveStatus: res.status,
    resolveBody: JSON.stringify(res.body).slice(0, 200),
    expected,
    observed: {
      "L paid": lPaid,
      "L open (OPEN obligation)": lOpen,
      "refund to client wallet by the ruling (late money excluded)": refundDelta,
      "late-arrival money paid only AFTER the ruling (D77 step still unsettled at the ruling)": lPaidLater,
      "new OPEN obligation by the ruling": newOpen,
      "client total for the session": clientTotal,
      "PT+platform AVAILABLE received by the ruling": partiesDelta,
      quota: `used ${before.used}->${after.used}, compensated ${before.comp}->${after.comp}`,
      session: after.session,
      settlements: after.settlements,
      obligations: after.obligations,
      "contract pending (PT+platform) after": pendingTotal,
      "PT AVAILABLE received by the ruling": after.ptAvail - before.ptAvail,
      "platform AVAILABLE received by the ruling": after.platAvail - before.platAvail,
      "gym AVAILABLE received by the ruling": 0, // no gym on this contract (rates 10 / 90 / 0)
      "contract pending (PT+platform) before the ruling": before.ptPend + before.platPend,
      "pending taken out by the ruling + the sweeps": before.ptPend + before.platPend - pendingTotal,
      "L already paid before the ruling": paidOf(before.lateOp),
      "session's own funding left in pending (V - L paid before)": V - paidOf(before.lateOp),
      "held in pending for an OPEN L (paid to nobody, DESIGN REQUIRED)": heldForOpenL,
      "taken from OTHER sessions' pending (ACTIVE only; an ended contract keeps the money apart)":
        contractState === "ACTIVE" && outcome !== "CANCELLED" ? Math.max(0, takenOther) : null,
      "immediately after the ruling (before the sweep)": { clientWallet: immediate.clientWallet - before.clientWallet, settlements: immediate.settlements, openOther: immediate.openUnpaidOther },
      "transaction buckets sum": after.sumNet,
      contract: `${before.contractStatus}->${after.contractStatus}`,
    },
    violations,
    notes,
    verdict,
  };
  TABLE.push(row);
  if (process.env.S2_0_PRINT) console.log(`[S2.0] ${JSON.stringify({ ...row, before, after })}`);
  return { fx, row, before, after };
}

async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

/** The pinned verdict of every base case after the I5 = A + C1 / I6 = A remediation (31/10): KHOP everywhere except CANCELLED, which must be refused (BLOCKED_409). */
const PINNED: Record<string, Verdict> = {};
for (const o of ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as Outcome[])
  for (const c of ["ACTIVE", "ENDED"] as ContractState[]) for (const d of ["SETTLED", "PENDING", "OPEN"] as D77State[]) PINNED[`${o}/${c}/${d}`] = o === "CANCELLED" ? "BLOCKED_409" : "KHOP";

for (const outcome of ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as Outcome[]) {
  for (const contractState of ["ACTIVE", "ENDED"] as ContractState[]) {
    for (const d77 of ["SETTLED", "PENDING", "OPEN"] as D77State[]) {
      test(`D77 matrix: ${outcome} x contract ${contractState} x D77 ${d77}`, { skip }, async () => {
        await scenario(async () => {
          const { row } = await runCase(outcome, contractState, d77);
          if (PINNED[row.id]) assert.equal(row.verdict, PINNED[row.id], `${row.id}: ${row.violations.join(" | ")}`);
        });
      });
    }
  }
}

// ── C1 with a GYM (gymRate > 0): D77 is split between the THREE parties, each by its own rate ──
// Contract 1,000,000 / 4 sessions, platform 0.10 / PT 0.55 / gym 0.35 => V = 250,000 = PT 137,500 + gym 87,500 + platform 25,000; L = 125,000 = PT 68,750 + gym 43,750 + platform 12,500.
const GYM_TERMS: GymTerms = { gymId: randomUUID(), platformRate: "0.10", ptRate: "0.55", gymRate: "0.35" };
const GYM_ROWS: Array<Record<string, unknown>> = [];
for (const [outcome, d77] of [["COMPLETED", "SETTLED"], ["COMPLETED", "PENDING"], ["COMPLETED", "OPEN"], ["PT_NO_SHOW_CONFIRMED", "SETTLED"], ["PT_NO_SHOW_CONFIRMED", "OPEN"]] as Array<[Outcome, D77State]>) {
  test(`D77 gym contract (55/35/10): ${outcome} x ACTIVE x D77 ${d77} -> each of the three parties by its own rate share, nothing from other sessions`, { skip }, async () => {
    await scenario(async () => {
      const fx = await build("ACTIVE", d77, GYM_TERMS);
      const gymAt = async () => ({ a: await H.net(fx.c.txnId, "GYM", "AVAILABLE", GYM_TERMS.gymId), p: await H.net(fx.c.txnId, "GYM", "PENDING", GYM_TERMS.gymId) });
      const before = await snap(fx);
      const gymBefore = await gymAt();
      const res = await resolveOnce(fx, outcome);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      await drain(fx.c.id);
      const after = await snap(fx);
      const gymAfter = await gymAt();
      const got = { pt: after.ptAvail - before.ptAvail, gym: gymAfter.a - gymBefore.a, platform: after.platAvail - before.platAvail };
      const pendingAll = after.ptPend + after.platPend + gymAfter.p;
      const heldForOpenL = 0;
      const clientTotal = after.clientWallet + after.openUnpaidLate + after.openUnpaidOther; // the client wallet starts at 0 in this fixture: everything it holds came from L and the ruling
      const lPaid = after.lateOp && after.lateOp.charged ? num(after.lateOp.charged.pt) + num(after.lateOp.charged.gym) + num(after.lateOp.charged.platform) : 0;
      if (outcome === "COMPLETED") {
        assert.deepEqual(got, { pt: 68_750, gym: 43_750, platform: 12_500 }, "V - L split by the contract's own rates, the gym included");
        assert.equal(after.used, before.used + 1);
        assert.equal(clientTotal, L, "the client's total for the session is L (paid + OPEN)");
      } else {
        assert.deepEqual(got, { pt: 0, gym: 0, platform: 0 }, "nobody is paid for a session the PT did not attend");
        assert.equal(after.comp, before.comp + 1);
        assert.equal(clientTotal, V, "the client's total for the session (cash + OPEN) is V, never V + L");
      }
      assert.equal(pendingAll, 3 * V + heldForOpenL, "pending of the three other sessions (+ the share held for an OPEN L): nothing was taken from them");
      assert.equal(lPaid, d77 === "OPEN" ? 0 : L, "L paid by the ledger");
      await H.invariant(`gym ${outcome} ${d77}`);
      GYM_ROWS.push({ outcome, d77, parties: got, clientCash: after.clientWallet - before.clientWallet, openL: after.openUnpaidLate, clientTotal, pendingAfter: pendingAll, quota: `used ${before.used}->${after.used}, compensated ${before.comp}->${after.comp}` });
    });
  });
}

// ── OPEN PARTIAL: only a TEST FIXTURE can build it (the fixed ledger cannot spend a contract's pending below one L; see the probe report) ──
// FIXTURE: the PT wallet pending is cut by 850,000 and the platform REVENUE pending by 100,000 (escrow by the same total) BEFORE the late-arrival sweep, so the REAL
// late-arrival step charges PT 50,000 / platform 0 and records OPEN 75,000. With no pending left, the ruling's own step cannot pay the rest: it must stay OPEN with the
// money it could not find - NOT faked as PAID_VIA_LEDGER. This is NOT a product path; it states what the ledger does with a legacy over-spent contract.
for (const [outcome, contractState] of [["COMPLETED", "ACTIVE"], ["PT_NO_SHOW_CONFIRMED", "ACTIVE"], ["COMPLETED", "ENDED"], ["PT_NO_SHOW_CONFIRMED", "ENDED"]] as Array<[Outcome, ContractState]>) {
  test(`D77 OPEN PARTIAL [TEST FIXTURE, wallet cut by hand]: ${outcome} x ${contractState}: the obligation stays OPEN (paid 50,000 / unpaid 75,000), never PAID_VIA_LEDGER, books sound`, { skip }, async () => {
    await scenario(async () => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: SESSIONS });
      await cutPending("PT", pt, 850_000);
      await cutPending("PLATFORM", "REVENUE", 100_000);
      const S = await lateSession(c);
      assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
      const late = await opResult(`PT_LATE_ARRIVAL:${S.id}`);
      assert.deepEqual([num(late?.result?.paid), num(late?.result?.unpaid)], [50_000, 75_000], "the REAL late-arrival step charged what existed");
      const adminToken = H.tokenFor(randomUUID(), "ADMIN");
      const disp = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
      assert.equal(disp.status, 200, JSON.stringify(disp.body));
      if (contractState === "ENDED") assert.equal((await H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" })).status, 200);
      const res = await H.call("POST", `/admin/sessions/${S.id}/resolve`, adminToken, { resolution: outcome, note: "partial fixture" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      await drain(c.id);
      const obs = await obligations(c.txnId);
      const lateOb = obs.find((o) => o.key === `PT_LATE_ARRIVAL:${S.id}`)!;
      assert.equal(lateOb.status, "OPEN", "no money exists to pay it, so it is not paid and not faked");
      assert.deepEqual([lateOb.paid, lateOb.unpaid], [50_000, 75_000]);
      assert.equal(num(((await H.payDb.$queryRawUnsafe("SELECT count(*)::text AS n FROM contract_unpaid_obligation_events WHERE action::text = 'SETTLE_VIA_LEDGER'")) as any[])[0].n), 0);
      assert.equal(num(((await H.payDb.$queryRawUnsafe("SELECT count(*)::text AS n FROM partner_receivables")) as any[])[0].n), 0, "no PT debt, nothing fronted");
      await H.invariant(`partial ${outcome} ${contractState}`);
    });
  });
}

// ── boundary cases (each one asserts only what must hold whatever the policy: exactly-once effects, a ledger that adds up, a loser that changes nothing) ──
const EDGES: Array<Record<string, unknown>> = [];
const opCount = async (key: string) => ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
const resolveOnce = (fx: Fx, resolution: Outcome) => H.call("POST", `/admin/sessions/${fx.S.id}/resolve`, fx.adminToken, { resolution, note: `S2.0 edge ${resolution}` });

test("D77 edge: the money step retried (settlement sweep run again and again, the keys replayed) after a ruling -> not one ledger row, wallet or operation moves", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("ACTIVE", "SETTLED");
    assert.equal((await resolveOnce(fx, "PT_NO_SHOW_CONFIRMED")).status, 200);
    await drain(fx.c.id);
    const settled = await H.snapshot();
    const state = await snap(fx);
    await drain(fx.c.id, 5);
    await H.m.payout.compensateNoShowMoney(fx.c.id, fx.S.id);
    await H.m.payout.compensateLateArrivalMoney(fx.c.id, fx.S.id);
    assert.deepEqual(await H.snapshot(), settled, "replays of PT_NO_SHOW / PT_LATE_ARRIVAL by key and five more sweeps changed nothing");
    const again = await snap(fx);
    assert.equal(again.clientWallet, state.clientWallet);
    assert.deepEqual(again.ops, state.ops);
    for (const key of [`PT_NO_SHOW:${fx.S.id}`, `PT_LATE_ARRIVAL:${fx.S.id}`]) assert.equal(await opCount(key), 1, key);
    await H.invariant("retry");
    EDGES.push({ case: "retry of the money step after PT_NO_SHOW_CONFIRMED (ACTIVE, D77 SETTLED)", result: "idempotent: snapshot unchanged, one ledger op per key" });
  });
});

test("D77 edge: the same ruling asked twice -> the second is refused (the session is no longer DISPUTED) and changes nothing", { skip }, async () => {
  await scenario(async () => {
    const fx = await build("ACTIVE", "SETTLED");
    const first = await resolveOnce(fx, "COMPLETED");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const snapshot = await H.snapshot();
    const state = await snap(fx);
    const second = await resolveOnce(fx, "COMPLETED");
    assert.equal(second.status, 400, JSON.stringify(second.body));
    const third = await resolveOnce(fx, "PT_NO_SHOW_CONFIRMED");
    assert.equal(third.status, 400, "a different ruling on a ruled session is refused too");
    assert.deepEqual(await H.snapshot(), snapshot);
    const again = await snap(fx);
    assert.deepEqual([again.used, again.comp, again.session.status], [state.used, state.comp, state.session.status]);
    EDGES.push({ case: "the same / a different ruling asked again", result: "400 both times, ledger and quota untouched" });
  });
});

test("D77 edge: two rulings at the same moment (COMPLETED vs PT_NO_SHOW_CONFIRMED) -> exactly one wins, the loser changes nothing, quota never moves twice, the ledger adds up", { skip }, async () => {
  for (let i = 0; i < 3; i++) {
    await scenario(async () => {
      const fx = await build("ACTIVE", "SETTLED");
      const [a, b] = await Promise.all([resolveOnce(fx, "COMPLETED"), resolveOnce(fx, "PT_NO_SHOW_CONFIRMED")]);
      assert.equal([a.status, b.status].filter((x) => x === 200).length, 1, `exactly one ruling won: ${JSON.stringify([a.body, b.body])}`);
      const winner = a.status === 200 ? "COMPLETED" : "PT_NO_SHOW_CONFIRMED";
      const st = await snap(fx);
      assert.equal(st.used + st.comp, 1, "one session consumed, never two");
      assert.equal(st.session.status, winner === "COMPLETED" ? "COMPLETED" : "NO_SHOW");
      assert.equal(st.ops.filter((k) => k.startsWith("SESSION_RELEASE:") || k.startsWith("PT_NO_SHOW:")).length, 1, `only the winner's money step ran: ${st.ops.join(",")}`);
      await H.invariant("two rulings");
      EDGES.push({ case: `two rulings at once, round ${i + 1}`, winner, ops: st.ops, quota: `used ${st.used}, compensated ${st.comp}` });
    });
  }
});

test("D77 edge: PT absent confirmed on a contract whose pending cannot fund the refund (no D77) -> the shortfall is an OPEN obligation, nothing is taken from the pooled AVAILABLE wallet, no PT debt, quota right, ledger adds up", { skip }, async () => {
  await scenario(async () => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: SESSIONS });
    const adminToken = H.tokenFor(randomUUID(), "ADMIN");
    // TEST FIXTURE: this contract's pending is already short (PT wallet pending lowered by 800,000; escrow by the same amount, so the invariant holds)
    await cutPending("PT", pt, 800_000); // PT pending 900,000 -> 100,000: the PT share (225,000) is only 100,000 fundable, the platform share (25,000) fully
    const S = await H.m.base.addSession(c, "DISPUTED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE", disputeReason: "PT không đến", disputedAt: new Date(), disputeType: "DELIVERY_DISPUTE" });
    const walletBefore = (await H.wallet("CLIENT", c.clientUserId)).a;
    const res = await H.call("POST", `/admin/sessions/${S.id}/resolve`, adminToken, { resolution: "PT_NO_SHOW_CONFIRMED", note: "edge: insufficient funds" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await drain(c.id);
    const contract = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(contract.compensatedSessions, 1);
    assert.equal(contract.usedSessions, 0);
    const paid = (await H.wallet("CLIENT", c.clientUserId)).a - walletBefore;
    const obs = await obligations(c.txnId);
    const open = obs.filter((o) => OPEN_STATUSES.includes(o.status)).reduce((x, o) => x + o.unpaid, 0);
    assert.equal(paid + open, V, "the refund of one session: what the ledger could pay + what is recorded as OPEN, never more, never less");
    assert.ok(open > 0, "the shortfall exists");
    assert.equal(num(((await H.payDb.$queryRawUnsafe("SELECT count(*)::text AS n FROM partner_receivables")) as any[])[0].n), 0, "no PT debt, no platform fronting (D48)");
    assert.equal((await H.wallet("PT", pt)).a, 0, "the PT's pooled AVAILABLE wallet was not drawn on");
    await H.invariant("insufficient funds");
    EDGES.push({ case: "PT absent confirmed, contract pending short, no D77", paidToClient: paid, openObligation: open, obligations: obs });
  });
});

for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"] as Outcome[]) {
  test(`D77 edge: the D77 step still PENDING is settled by the sweep IN PARALLEL with the ruling ${outcome} -> every key is written once, the ledger adds up, quota moves at most once`, { skip }, async () => {
    for (let i = 0; i < 2; i++) {
      await scenario(async () => {
        const fx = await build("ACTIVE", "PENDING");
        await H.m.prisma.sessionSettlement.updateMany({ where: { contractId: fx.c.id, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
        const [res] = await Promise.all([resolveOnce(fx, outcome), runSettlementSweep(), runSettlementSweep()]);
        assert.equal(res.status, outcome === "CANCELLED" ? 409 : 200, JSON.stringify(res.body));
        await drain(fx.c.id);
        const st = await snap(fx);
        for (const key of [`PT_LATE_ARRIVAL:${fx.S.id}`, `PT_NO_SHOW:${fx.S.id}`, `SESSION_RELEASE:${fx.S.id}`]) assert.ok((await opCount(key)) <= 1, key);
        assert.equal(await opCount(`PT_LATE_ARRIVAL:${fx.S.id}`), 1, "the D77 step ended up written exactly once");
        assert.equal(Math.round(st.sumNet), PRICE);
        assert.ok(st.used + st.comp <= 1, "quota moved at most once");
        await H.invariant("parallel sweep");
        EDGES.push({
          case: `D77 PENDING swept in parallel with ${outcome}, round ${i + 1}`,
          clientWallet: st.clientWallet,
          clientTotalForSession: st.clientWallet + st.openUnpaidLate + st.openUnpaidOther,
          partiesAvailable: st.ptAvail + st.platAvail,
          contractPending: st.ptPend + st.platPend,
          quota: `used ${st.used}, compensated ${st.comp}`,
          ops: st.ops,
        });
      });
    }
  });
}

test.after(() => {
  if (process.env.S2_0_REPORT && (TABLE.length || EDGES.length || GYM_ROWS.length)) fs.writeFileSync(process.env.S2_0_REPORT, JSON.stringify({ matrix: TABLE, edges: EDGES, gym: GYM_ROWS }, null, 2));
});
