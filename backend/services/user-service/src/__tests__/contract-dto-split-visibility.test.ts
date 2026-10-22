import test from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_FIELDS_HIDDEN_FROM_CLIENT,
  redactBreakdownForViewer,
  redactSettlementForViewer,
  redactContractSplit,
} from "../services/contract-dto";

/**
 * The PT's share (ptRate / platformRate / gymRate and what was released to each party) is shown to the PT of the
 * contract only. Evidence label: unit (pure serializer) - the controllers call it on every contract-returning response.
 */

const PT = "pt-1";
const CLIENT = "client-1";
const OTHER_PT = "pt-2";

const row = () => ({
  id: "c1",
  ptUserId: PT,
  clientUserId: CLIENT,
  status: "PENDING_REVIEW",
  price: "4000000.00",
  totalSessions: 4,
  usedSessions: 0,
  compensatedSessions: 0,
  gymId: "g1",
  gymBrandId: "b1",
  platformRate: "0.1000",
  ptRate: "0.5500",
  gymRate: "0.3500",
  ptHoldbackRate: "0.0000",
  ptHoldbackPolicyVersion: 0,
  holdbackReleasedAt: null,
  releasedToPt: "0.00",
  releasedToGym: "0.00",
  releasedToPlatform: "0.00",
  gymAgreementId: "a1",
  gymAgreementScope: "BRAND",
});

test("the client never receives the split fields of their own contract", () => {
  const out = redactContractSplit(row(), { userId: CLIENT, role: "CLIENT" }) as Record<string, unknown>;
  for (const f of SPLIT_FIELDS_HIDDEN_FROM_CLIENT) assert.equal(f in out, false, f);
  // everything the client screens do use is still there
  assert.deepEqual(
    [out.id, out.price, out.totalSessions, out.usedSessions, out.compensatedSessions, out.gymId, out.gymBrandId, out.status],
    ["c1", "4000000.00", 4, 0, 0, "g1", "b1", "PENDING_REVIEW"],
  );
});

test("the PT of that contract keeps the full row (their own share is shown to them)", () => {
  const input = row();
  const out = redactContractSplit(input, { userId: PT, role: "PT" });
  assert.equal(out, input);
  assert.equal(out.ptRate, "0.5500");
});

test("another PT, a stranger and an unauthenticated viewer do not get the split; an admin does", () => {
  for (const viewer of [{ userId: OTHER_PT, role: "PT" }, { userId: "x", role: "CLIENT" }, {}]) {
    assert.equal("ptRate" in (redactContractSplit(row(), viewer) as object), false);
  }
  assert.equal((redactContractSplit(row(), { userId: "admin-1", role: "ADMIN" }) as any).ptRate, "0.5500");
});

test("a list: redacts per row against that row's own PT", () => {
  const mine = row();
  const theirs = { ...row(), id: "c2", ptUserId: OTHER_PT };
  const out = redactContractSplit([mine, theirs], { userId: PT, role: "PT" }) as any[];
  assert.equal(out[0].ptRate, "0.5500");
  assert.equal("ptRate" in out[1], false);
});

test("sessions that embed their contract are redacted for the client and left alone for the PT", () => {
  const session = { id: "s1", ptUserId: PT, clientUserId: CLIENT, status: "CONFIRMED", contract: row() };
  const asClient = redactContractSplit([session], { userId: CLIENT, role: "CLIENT" }) as any[];
  assert.equal("ptRate" in asClient[0].contract, false);
  assert.equal(asClient[0].contract.totalSessions, 4);
  const asPt = redactContractSplit([session], { userId: PT, role: "PT" }) as any[];
  assert.equal(asPt[0].contract.ptRate, "0.5500");
});

test("does not mutate its input, and passes non-contract values through", () => {
  const input = row();
  redactContractSplit(input, { userId: CLIENT, role: "CLIENT" });
  assert.equal(input.ptRate, "0.5500");
  assert.equal(redactContractSplit(null, {}), null);
  assert.equal(redactContractSplit("x", {}), "x");
  const plain = { id: "n1", text: "hello" };
  assert.equal(redactContractSplit(plain, {}), plain);
});

const FULL_BREAKDOWN = {
  price: "4000000.00",
  totalSessions: 4,
  usedSessions: 1,
  compensatedSessions: 1,
  unit: "1000000.00",
  remaining: "2000000.00",
  rates: { platformRate: "0.1", ptRate: "0.55", gymRate: "0.35" },
  released: { pt: "550000.00", gym: "350000.00", platform: "100000.00" },
  stillPending: { pt: "1100000.00", gym: "700000.00", platform: "200000.00" },
  actuallyReleased: { pt: "550000.00", gym: "350000.00", platform: "100000.00" },
  refundIfCancelledNow: "1800000.00",
  reasonUsed: "CLIENT_CANCELLED",
  contractId: "c1",
  paid: true,
  canExitWithoutPenalty: false,
  exitReasonIfCancelledNow: "CLIENT_CANCELLED",
  unresolvedSessions: 0,
  somethingAddedLater: "x",
};

test("money-breakdown: the client gets only client aggregates - no rates, no per-party released/pending, nothing unknown", () => {
  const out = redactBreakdownForViewer(FULL_BREAKDOWN, { userId: CLIENT, role: "CLIENT" }, PT) as Record<string, unknown>;
  for (const hidden of ["rates", "released", "stillPending", "actuallyReleased", "somethingAddedLater"]) assert.equal(hidden in out, false, hidden);
  assert.equal(JSON.stringify(out).includes("pt"), false, "no per-party keys or values leak (pt/gym/platform)");
  assert.equal(out.refundIfCancelledNow, "1800000.00");
  assert.equal(out.remaining, "2000000.00");
  assert.equal(out.unit, "1000000.00");
  assert.equal(out.paid, true);
  assert.equal(out.paidTotal, "4000000.00");
  assert.equal(out.refundedSessionsValue, "1000000.00");
  assert.equal(out.canExitWithoutPenalty, false);
});

test("money-breakdown: an unpaid contract has paidTotal 0; the contract's PT and an admin keep the whole object", () => {
  const unpaid = redactBreakdownForViewer({ ...FULL_BREAKDOWN, paid: false }, { userId: CLIENT, role: "CLIENT" }, PT) as any;
  assert.equal(unpaid.paidTotal, "0.00");
  assert.equal(redactBreakdownForViewer(FULL_BREAKDOWN, { userId: PT, role: "PT" }, PT), FULL_BREAKDOWN);
  assert.equal(redactBreakdownForViewer(FULL_BREAKDOWN, { userId: "a", role: "ADMIN" }, PT), FULL_BREAKDOWN);
});

test("terminate settlement: the client keeps refund/remaining/reason only; the PT and an admin keep everything", () => {
  const settlement = { reason: "CLIENT_CANCELLED", remaining: "3000000.00", refund: "2700000.00", withheld: "300000.00", entitlement: { pt: "165000.00", gym: "105000.00", platform: "30000.00" } };
  const asClient = redactSettlementForViewer(settlement, { userId: CLIENT, role: "CLIENT" }, PT) as any;
  assert.deepEqual(asClient, { reason: "CLIENT_CANCELLED", remaining: "3000000.00", refund: "2700000.00" });
  assert.equal(redactSettlementForViewer(settlement, { userId: PT, role: "PT" }, PT), settlement);
  assert.equal(redactSettlementForViewer(null, { userId: CLIENT }, PT), null);
});
