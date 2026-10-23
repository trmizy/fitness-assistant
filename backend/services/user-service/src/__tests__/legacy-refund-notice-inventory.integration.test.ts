/**
 * Legacy refund-notice inventory (src/scripts/legacy-refund-notice-inventory.ts) - READ ONLY, aggregates only.
 *
 * Evidence label: TEST FIXTURE + BACKEND INTEGRATION against TWO isolated databases (never dev):
 *   INVENTORY_TEST_USER_DATABASE_URL    = .../gymcoach_user_g3_test     (prisma migrate deploy of user-service)
 *   INVENTORY_TEST_PAYMENT_DATABASE_URL = .../gymcoach_payment_g3_test  (prisma migrate deploy of payment-service)
 * Both database names must end in `_test`, otherwise the DB part skips (the pure-rule tests always run). Run (from backend/services/user-service):
 *   INVENTORY_TEST_USER_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_g3_test?schema=public" \
 *   INVENTORY_TEST_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_g3_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/legacy-refund-notice-inventory.integration.test.ts
 *
 * The fixture rows are inserted directly at the state the old code left them in (OLD-style ledger result `compensation/shortfall`,
 * NEW-style `paid/owed/unpaid`); payment-service is not running - the ledger side is rows of the real `ledger_operations` /
 * `contract_unpaid_obligations` tables. This suite TRUNCATEs/DELETEs those tables of the two test databases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PROMISE_DIFFERS,
  buildInventory,
  classifyOutcome,
  dbNameOf,
  formatInventory,
  main,
  makeClient,
  parseLedgerResult,
  readOnly,
  type Inventory,
} from "../scripts/legacy-refund-notice-inventory";

const USER_URL = process.env.INVENTORY_TEST_USER_DATABASE_URL ?? "";
const PAYMENT_URL = process.env.INVENTORY_TEST_PAYMENT_DATABASE_URL ?? "";
const usable = /_test$/.test(dbNameOf(USER_URL)) && /_test$/.test(dbNameOf(PAYMENT_URL));
const skip = usable ? false : "Requires INVENTORY_TEST_USER_DATABASE_URL / INVENTORY_TEST_PAYMENT_DATABASE_URL pointing at *_test databases.";

// ───────────────────────────────────────────────────────────── pure rules (always run) ──
test("parseLedgerResult reads the NEW shape (paid/owed/unpaid) and the OLD shape (compensation|refund + shortfall)", () => {
  const n = parseLedgerResult({ compensation: "30000.00", charged: {}, shortfall: "20000.00", owed: "50000.00", paid: "30000.00", unpaid: "20000.00", obligationId: "x" });
  assert.deepEqual([n.version, n.paid, n.owed, n.unpaid, n.legacyFronted], ["NEW", 30000, 50000, 20000, 0]);
  const old = parseLedgerResult({ compensation: "100000.00", charged: { pt: "1" }, shortfall: "40000.00" });
  assert.deepEqual([old.version, old.paid, old.owed, old.unpaid, old.legacyFronted], ["LEGACY", 100000, null, 0, 40000], "old `shortfall` is what the platform fronted, NOT owed to the client");
  assert.equal(parseLedgerResult({ refund: "5.00", shortfall: "0.00" }).paid, 5);
  assert.equal(parseLedgerResult({ recordedOnly: true, paid: "0.00", owed: "9.00", unpaid: "9.00" }).recordedOnly, true);
  for (const junk of [null, undefined, {}, "x", 5, { paid: "abc" }]) assert.equal(parseLedgerResult(junk).version, "UNKNOWN");
});

test("classifyOutcome: every outcome, and which of them mean 'the promise differs'", () => {
  const base = { sessionExists: true, contractExists: true, settlementStatuses: [] as string[], op: null as any, obligationStatus: null as string | null };
  const op = (o: Record<string, unknown>) => parseLedgerResult(o);
  const full = op({ paid: "10.00", owed: "10.00", unpaid: "0.00" });
  const short = op({ paid: "4.00", owed: "10.00", unpaid: "6.00" });
  const cases: Array<[string, any, string]> = [
    ["no session", { ...base, sessionExists: false }, "SUBJECT_MISSING"],
    ["no contract", { ...base, contractExists: false }, "SUBJECT_MISSING"],
    ["session gone but the ledger paid it in full", { ...base, sessionExists: false, op: full }, "PAID_IN_FULL"],
    ["nothing at all", base, "NO_SETTLEMENT_ROW"],
    ["pending row", { ...base, settlementStatuses: ["PENDING"] }, "SETTLEMENT_NOT_SETTLED"],
    ["settled without op", { ...base, settlementStatuses: ["SETTLED"] }, "SETTLED_NO_LEDGER_OP"],
    ["junk result", { ...base, op: op({}) }, "LEDGER_RESULT_UNREADABLE"],
    ["paid in full (new)", { ...base, op: full }, "PAID_IN_FULL"],
    ["paid in full (old)", { ...base, op: op({ compensation: "10.00", shortfall: "3.00" }) }, "PAID_IN_FULL"],
    ["recorded only", { ...base, op: op({ recordedOnly: true, paid: "0.00", owed: "10.00", unpaid: "10.00" }) }, "PAID_NOTHING_RECORDED_ONLY"],
    ["short, open", { ...base, op: short, obligationStatus: "OPEN" }, "PAID_SHORT_OPEN"],
    ["short, under review", { ...base, op: short, obligationStatus: "UNDER_REVIEW" }, "PAID_SHORT_OPEN"],
    ["short, paid externally", { ...base, op: short, obligationStatus: "PAID_EXTERNALLY" }, "PAID_SHORT_PAID_EXTERNALLY"],
    ["short, waived", { ...base, op: short, obligationStatus: "WAIVED" }, "PAID_SHORT_WAIVED"],
    ["short, legacy resolved", { ...base, op: short, obligationStatus: "RESOLVED" }, "PAID_SHORT_LEGACY_RESOLVED"],
    ["short, no obligation row", { ...base, op: short }, "PAID_SHORT_NO_OBLIGATION"],
  ];
  for (const [name, facts, expected] of cases) assert.equal(classifyOutcome(facts), expected, name);
  const matches = ["PAID_IN_FULL", "PAID_SHORT_PAID_EXTERNALLY"];
  for (const [, , o] of cases) assert.equal(PROMISE_DIFFERS.has(o as any), !matches.includes(o), o);
});

// ───────────────────────────────────────────────────────────── database fixture ──
const P = {
  user: usable ? makeClient(USER_URL) : (null as never),
  payment: usable ? makeClient(PAYMENT_URL) : (null as never),
};
test.after(async () => {
  if (usable) {
    await P.user.$disconnect();
    await P.payment.$disconnect();
  }
});

const DAY = 24 * 3600 * 1000;
const T_REFUND = "Huấn luyện viên vắng mặt. Bạn được hoàn tiền một buổi vào ví và buổi tập không bị trừ.";
const T_REFUND_ADMIN = "Quản trị viên xác nhận huấn luyện viên vắng mặt — khách được hoàn tiền một buổi, buổi tập không bị trừ";
const T_LATE = "Huấn luyện viên vào muộn — bạn được bồi thường một phần vào ví, buổi tập không bị trừ.";
const T_COMP = "Bạn không vào phòng học trước khi hết giờ — buổi tập được ghi nhận vắng mặt, khách được bồi thường, buổi không bị trừ.";
const T_CONTRACT = "Hợp đồng được kết thúc theo yêu cầu; bạn được hoàn tiền và các buổi chưa diễn ra không bị trừ.";
const T_UNRELATED = ["Buổi tập đã được xác nhận.", "Buổi tập của bạn không bị trừ nhưng không có tiền nào liên quan."];

interface Fx {
  ids: Record<string, string>;
}

async function wipe() {
  await P.user.notification.deleteMany({});
  await P.user.sessionSettlement.deleteMany({});
  await P.user.session.deleteMany({});
  await P.user.contract.deleteMany({});
  await P.payment.$executeRawUnsafe("TRUNCATE contract_unpaid_obligation_events, contract_unpaid_obligations, ledger_operations, payment_transactions CASCADE");
}

async function seed(): Promise<Fx> {
  await wipe();
  const ids: Record<string, string> = {};
  const now = Date.now();
  const mkContract = async (extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await P.user.contract.create({
      data: {
        id, ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "Gói 10 buổi", totalSessions: 10, price: 5_000_000,
        paymentTransactionId: `txn-${randomUUID()}`, status: "ACTIVE", ...extra,
      } as any,
    });
    return id;
  };
  const mkSession = async (name: string, contractId: string, extra: Record<string, unknown> = {}) => {
    const c = await P.user.contract.findUniqueOrThrow({ where: { id: contractId } });
    const id = randomUUID();
    ids[name] = id;
    await P.user.session.create({
      data: {
        id, contractId, ptUserId: c.ptUserId, clientUserId: c.clientUserId, status: "NO_SHOW" as any,
        scheduledStartAt: new Date(now - 5 * DAY), scheduledEndAt: new Date(now - 5 * DAY + 3600_000), ...extra,
      } as any,
    });
    return { id, c };
  };
  const notice = async (userId: string, text: string, entityType: "SESSION" | "CONTRACT", entityId: string) =>
    P.user.notification.create({ data: { userId, text, eventType: "SESSION_NO_SHOW_PT", entityType, entityId } as any });
  const settlement = (kind: string, key: string, sessionId: string | null, contractId: string, status: string) =>
    P.user.sessionSettlement.create({ data: { kind, idempotencyKey: key, sessionId, contractId, status } as any });
  const txn = async () => {
    const id = randomUUID();
    await P.payment.$executeRawUnsafe(
      `INSERT INTO payment_transactions (id, payer_id, purpose, amount, idempotency_key, updated_at) VALUES ($1, 'fixture-payer', 'PT_CONTRACT'::"PurposeType", 1000000, $2, now())`,
      id, `fixture-${id}`,
    );
    return id;
  };
  const op = (key: string, result: Record<string, unknown>) =>
    P.payment.$executeRawUnsafe(`INSERT INTO ledger_operations (id, key, result) VALUES ($1, $2, $3::jsonb)`, randomUUID(), key, JSON.stringify(result));
  const obligation = async (key: string, owed: number, paid: number, status: string, external = 0) => {
    const unpaid = owed - paid;
    await P.payment.$executeRawUnsafe(
      `INSERT INTO contract_unpaid_obligations (id, key, transaction_id, kind, party, owed, paid, unpaid, status, externally_paid)
       VALUES ($1, $2, $3, 'NO_SHOW'::"ContractUnpaidObligationKind", 'CLIENT', $4, $5, $6, $7::"ContractUnpaidObligationStatus", $8)`,
      randomUUID(), key, await txn(), owed, paid, status === "PAID_EXTERNALLY" ? 0 : unpaid, status, external,
    );
  };
  const full = (n: number) => ({ compensation: n.toFixed(2), charged: { pt: "0.00", gym: "0.00", platform: "0.00" }, shortfall: "0.00", owed: n.toFixed(2), paid: n.toFixed(2), unpaid: "0.00" });

  // A contract with compensated_sessions > 0 (a TRAP: this per-contract counter must not make any single session look compensated)
  const cA = await mkContract({ compensatedSessions: 3 });
  const client = (c: { clientUserId: string }) => c.clientUserId;

  // S1 REFUND promise, settled, NEW-style op paid in full. Two notices (client + admin) to two recipients.
  const s1 = await mkSession("s1_paid_full", cA);
  await notice(client(s1.c), T_REFUND, "SESSION", s1.id);
  await notice(randomUUID(), T_REFUND_ADMIN, "SESSION", s1.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s1.id}`, s1.id, cA, "SETTLED");
  await op(`PT_NO_SHOW:${s1.id}`, full(100000));

  // S2 LATE promise, NEW-style op short 20.000, obligation OPEN
  const s2 = await mkSession("s2_late_short_open", cA);
  await notice(client(s2.c), T_LATE, "SESSION", s2.id);
  await settlement("PT_LATE_ARRIVAL_COMPENSATION", `PT_LATE_ARRIVAL:${s2.id}`, s2.id, cA, "SETTLED");
  await op(`PT_LATE_ARRIVAL:${s2.id}`, { compensation: "30000.00", charged: {}, shortfall: "20000.00", owed: "50000.00", paid: "30000.00", unpaid: "20000.00", obligationId: "o2" });
  await obligation(`PT_LATE_ARRIVAL:${s2.id}`, 50000, 30000, "OPEN");

  // S3 REFUND promise, OLD-style op: compensation 100.000 credited in full, shortfall 40.000 FRONTED by the platform (not owed to the client)
  const s3 = await mkSession("s3_legacy", cA);
  await notice(client(s3.c), T_REFUND, "SESSION", s3.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s3.id}`, s3.id, cA, "SETTLED");
  await op(`PT_NO_SHOW:${s3.id}`, { compensation: "100000.00", charged: { pt: "60000.00", gym: "0.00", platform: "0.00" }, shortfall: "40000.00" });

  // S4 REFUND promise, NO settlement row, session actually deducted
  const s4 = await mkSession("s4_no_row_deducted", cA, { sessionDeducted: true });
  await notice(client(s4.c), T_REFUND, "SESSION", s4.id);

  // S5 settlement PENDING
  const s5 = await mkSession("s5_pending", cA);
  await notice(client(s5.c), T_REFUND, "SESSION", s5.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s5.id}`, s5.id, cA, "PENDING");

  // S6 settlement SETTLED but payment-service holds no operation
  const s6 = await mkSession("s6_settled_no_op", cA);
  await notice(client(s6.c), T_REFUND, "SESSION", s6.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s6.id}`, s6.id, cA, "SETTLED");

  // S7 the session (and its contract) were deleted afterwards: notice only
  const cGone = await mkContract();
  const s7 = await mkSession("s7_deleted", cGone);
  await notice(client(s7.c), T_REFUND, "SESSION", s7.id);
  // S7b deleted too, but the ledger still holds the paid operation under its key
  const s7b = await mkSession("s7b_deleted_but_paid", cGone);
  await notice(client(s7b.c), T_REFUND, "SESSION", s7b.id);
  await op(`PT_NO_SHOW:${s7b.id}`, full(80000));
  // contract-level notice on a contract that is gone, and one on a live contract with a termination settlement
  await notice(randomUUID(), T_CONTRACT, "CONTRACT", cGone);
  await P.user.contract.delete({ where: { id: cGone } }); // cascades the two sessions away

  // S9 generic "bồi thường" (not late): the paid operation sits under the LATE key; paid externally after a short payment
  const s9 = await mkSession("s9_generic_comp_external", cA);
  await notice(client(s9.c), T_COMP, "SESSION", s9.id);
  await op(`PT_LATE_ARRIVAL:${s9.id}`, { compensation: "30000.00", charged: {}, shortfall: "20000.00", owed: "50000.00", paid: "30000.00", unpaid: "20000.00", obligationId: "o9" });
  await obligation(`PT_LATE_ARRIVAL:${s9.id}`, 50000, 30000, "PAID_EXTERNALLY", 20000);
  await settlement("PT_LATE_ARRIVAL_COMPENSATION", `PT_LATE_ARRIVAL:${s9.id}`, s9.id, cA, "SETTLED");

  // S10 recorded only (contract ended before the step), obligation WAIVED
  const s10 = await mkSession("s10_recorded_only_waived", cA);
  await notice(client(s10.c), T_REFUND, "SESSION", s10.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s10.id}`, s10.id, cA, "SETTLED");
  await op(`PT_NO_SHOW:${s10.id}`, { compensation: "0.00", charged: {}, shortfall: "100000.00", owed: "100000.00", paid: "0.00", unpaid: "100000.00", recordedOnly: true });
  await obligation(`PT_NO_SHOW:${s10.id}`, 100000, 0, "WAIVED");

  // S11 short, obligation closed as legacy RESOLVED. S12 short, no obligation row at all.
  const s11 = await mkSession("s11_short_resolved", cA);
  await notice(client(s11.c), T_REFUND, "SESSION", s11.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s11.id}`, s11.id, cA, "SETTLED");
  await op(`PT_NO_SHOW:${s11.id}`, { compensation: "10000.00", charged: {}, shortfall: "40000.00", owed: "50000.00", paid: "10000.00", unpaid: "40000.00" });
  await obligation(`PT_NO_SHOW:${s11.id}`, 50000, 10000, "RESOLVED");
  const s12 = await mkSession("s12_short_no_obligation", cA);
  await notice(client(s12.c), T_REFUND, "SESSION", s12.id);
  await settlement("PT_NO_SHOW_COMPENSATION", `PT_NO_SHOW:${s12.id}`, s12.id, cA, "SETTLED");
  await op(`PT_NO_SHOW:${s12.id}`, { compensation: "10000.00", charged: {}, shortfall: "40000.00", owed: "50000.00", paid: "10000.00", unpaid: "40000.00" });

  // Live contract notice with a CONTRACT_TERMINATION settlement
  await notice(randomUUID(), T_CONTRACT, "CONTRACT", cA);
  await settlement("CONTRACT_TERMINATION", `CONTRACT_TERMINATION:${cA}`, null, cA, "SETTLED");

  // Notices that must NOT be counted
  for (const t of T_UNRELATED) await notice(randomUUID(), t, "SESSION", s1.id);

  return { ids };
}

async function inventory(): Promise<Inventory> {
  return readOnly(P.user, (uq) => readOnly(P.payment, (pq) => buildInventory(uq, pq)));
}

const counts = async () => ({
  notifications: await P.user.notification.count(),
  sessions: await P.user.session.count(),
  contracts: await P.user.contract.count(),
  settlements: await P.user.sessionSettlement.count(),
  ops: Number((await P.payment.$queryRawUnsafe<any[]>("SELECT count(*)::int AS c FROM ledger_operations"))[0].c),
  obligations: Number((await P.payment.$queryRawUnsafe<any[]>("SELECT count(*)::int AS c FROM contract_unpaid_obligations"))[0].c),
  creditedSum: String((await P.payment.$queryRawUnsafe<any[]>("SELECT coalesce(sum(unpaid),0)::text AS s FROM contract_unpaid_obligations"))[0].s),
});

test("inventory: old-style and new-style rows, missing sessions/contracts, per-session deduction, outcomes and promise-vs-outcome", { skip }, async () => {
  await seed();
  const before = await counts();
  const inv = await inventory();

  // notices: the 2 unrelated ones are not counted; 3 on S1(2)+... count them: s1:2, s2,s3,s4,s5,s6,s7,s7b,s9,s10,s11,s12 = 13 session notices, + 2 contract notices
  assert.equal(inv.noticesByEntity.SESSION, 13);
  assert.equal(inv.noticesByEntity.CONTRACT, 2);
  assert.equal(inv.noticesSent, 15);
  assert.equal(inv.noticesByPromise.LATE, 1);
  assert.equal(inv.noticesByPromise.COMPENSATION, 1, "the generic bồi thường notice");
  assert.equal(inv.noticesByPromise.REFUND, 13, "11 refund session notices + the 2 contract notices that say hoàn tiền");

  // sessions: 12 distinct; 2 were deleted with their contract (S7, S7b); the rest exist
  assert.equal(inv.sessions.distinct, 12);
  assert.equal(inv.sessions.missing, 2);
  assert.equal(inv.sessions.existing, 10);
  assert.equal(inv.sessions.existingButContractMissing, 0, 'sessions cascade with their contract');
  // deduction is per SESSION (session_deducted), not the contract counter (cA.compensated_sessions = 3 must not matter)
  assert.equal(inv.sessions.deducted, 1);
  assert.equal(inv.sessions.notDeducted, 9);

  // settlement rows under the promised key
  assert.deepEqual(inv.settlementRows, { none: 3 /* s4, s7, s7b (op only) */, notSettled: 1 /* s5 PENDING */, settled: 8 });
  assert.equal(inv.settlementRows.none + inv.settlementRows.notSettled + inv.settlementRows.settled, 12);

  // ledger: both shapes read. New-shape: s1, s2, s9, s10, s11, s12 (+ s7b); old-shape: s3
  assert.equal(inv.ledger.operationsFound, 8);
  assert.equal(inv.ledger.legacyShape, 1);
  assert.equal(inv.ledger.newShape, 7);
  assert.equal(inv.ledger.unreadable, 0);

  // outcomes (sessions / notices)
  const o = inv.outcomes;
  assert.deepEqual(o.PAID_IN_FULL, { sessions: 3 /* s1, s3 legacy, s7b deleted-but-paid */, notices: 4 /* s1 has 2 */ });
  assert.deepEqual(o.PAID_SHORT_OPEN, { sessions: 1, notices: 1 });
  assert.deepEqual(o.PAID_SHORT_PAID_EXTERNALLY, { sessions: 1, notices: 1 });
  assert.deepEqual(o.PAID_NOTHING_RECORDED_ONLY, { sessions: 1, notices: 1 });
  assert.deepEqual(o.PAID_SHORT_LEGACY_RESOLVED, { sessions: 1, notices: 1 });
  assert.deepEqual(o.PAID_SHORT_NO_OBLIGATION, { sessions: 1, notices: 1 });
  assert.deepEqual(o.NO_SETTLEMENT_ROW, { sessions: 1, notices: 1 }, 'S4: promised, nothing recorded - and it WAS deducted');
  assert.deepEqual(o.SETTLEMENT_NOT_SETTLED, { sessions: 1, notices: 1 });
  assert.deepEqual(o.SETTLED_NO_LEDGER_OP, { sessions: 1, notices: 1 });
  assert.deepEqual(o.SUBJECT_MISSING, { sessions: 1, notices: 1 }, 'S7 deleted, nothing in the ledger either');
  assert.equal(Object.values(o).reduce((a, x) => a + x.sessions, 0), 12, 'every session lands in exactly one outcome');

  // promise differs = everything except PAID_IN_FULL and PAID_SHORT_PAID_EXTERNALLY
  assert.deepEqual(inv.promiseDiffers, { sessions: 12 - 3 - 1, notices: 13 - 4 - 1 });

  // money: only what the ledger shows
  assert.equal(inv.money.creditedToClients, (100000 + 30000 + 100000 + 80000 + 30000 + 0 + 10000 + 10000).toFixed(2));
  assert.equal(inv.money.unpaidStillOwedOpen, "20000.00");
  assert.equal(inv.money.paidExternally, "20000.00");
  assert.equal(inv.money.waivedUnpaid, "100000.00");
  assert.equal(inv.money.legacyFrontedByPlatform, "40000.00");

  // contract-level notices
  assert.equal(inv.contractNotices.distinct, 2);
  assert.equal(inv.contractNotices.contractsMissing, 1);
  assert.deepEqual(inv.contractNotices.terminationSettlement, { SETTLED: 1, NO_ROW: 1 });

  // READ ONLY: nothing in either database changed
  assert.deepEqual(await counts(), before);
});

test("the report prints only aggregates: no id, no notification text, no URL, no password", { skip }, async () => {
  await seed();
  const inv = await inventory();
  const text = formatInventory(inv, { user: dbNameOf(USER_URL), payment: dbNameOf(PAYMENT_URL) }).join("\n");
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), "no uuid");
  assert.ok(!/PT_NO_SHOW:|PT_LATE_ARRIVAL:/.test(text), "no idempotency key");
  assert.ok(!/postgresql:\/\/|gymcoach_test_password|localhost:55433/.test(text), "no connection string");
  assert.ok(!/Huấn luyện viên vắng mặt|được hoàn tiền một buổi/.test(text), "no notification text");
  assert.ok(text.includes(dbNameOf(USER_URL)) && text.includes(dbNameOf(PAYMENT_URL)), "the database NAMES are shown");
  assert.ok(text.includes("PROMISE DIFFERS FROM OUTCOME: 8 sessions / 8 notices"));
});

test("CLI: refuses without --confirm-read-only (nothing connected), refuses without both URLs, prints DB names not URLs, exit 0 and writes nothing", { skip }, async () => {
  await seed();
  const before = await counts();
  const env = { USER_DATABASE_URL: USER_URL, PAYMENT_DATABASE_URL: PAYMENT_URL } as NodeJS.ProcessEnv;

  const refused: string[] = [];
  assert.equal(await main([], env, (l) => refused.push(l)), 2);
  assert.ok(refused[0].startsWith("REFUSED"));
  assert.ok(!refused.some((l) => /postgresql:\/\//.test(l)));

  const noUrl: string[] = [];
  assert.equal(await main(["--confirm-read-only"], { USER_DATABASE_URL: USER_URL } as NodeJS.ProcessEnv, (l) => noUrl.push(l)), 2);
  assert.ok(noUrl[0].startsWith("REFUSED"));
  assert.equal(await main(["--confirm-read-only"], { USER_DATABASE_URL: "not a url", PAYMENT_DATABASE_URL: PAYMENT_URL } as NodeJS.ProcessEnv, () => {}), 2);

  const out: string[] = [];
  assert.equal(await main(["--confirm-read-only"], env, (l) => out.push(l)), 0);
  const all = out.join("\n");
  assert.ok(all.includes(`user database "${dbNameOf(USER_URL)}"`) && all.includes(`payment database "${dbNameOf(PAYMENT_URL)}"`));
  assert.ok(!/postgresql:\/\/|gymcoach_test_password/.test(all));
  assert.deepEqual(await counts(), before, "the CLI wrote nothing");
});

test("every statement runs inside a READ ONLY transaction: a write through the same path is refused by Postgres", { skip }, async () => {
  await seed();
  await assert.rejects(readOnly(P.user, (q) => q("UPDATE notifications SET unread = false")), /read-only transaction/i);
  await assert.rejects(readOnly(P.payment, (q) => q("DELETE FROM ledger_operations")), /read-only transaction/i);
  // an empty database still gives a clean zero report
  await wipe();
  const inv = await inventory();
  assert.equal(inv.noticesSent, 0);
  assert.deepEqual(inv.promiseDiffers, { sessions: 0, notices: 0 });
});
