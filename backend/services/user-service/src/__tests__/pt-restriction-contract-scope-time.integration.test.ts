/**
 * CONTRACT-scope PT restriction, part 2 — the time given back. Overlapping episodes (a contract
 * restriction inside / next to an account suspension, lifted in either order, or one raised into the
 * other) must extend each contract by the LENGTH OF THE UNION of the blocked intervals - never by the
 * sum. The interval rule lives in pt-restriction-intervals.ts (pure) and closeEpisode (database).
 *
 * Worked case from the owner (D38): a contract restricted on days 1-10 and the account suspended on
 * days 5-20 blocked the contract for days 1-20 = 20 days. Here an "episode on days a-b" covers the
 * whole days a..b inclusive, i.e. the instants [a days, (b+1) days) after the base instant B:
 *   contract [1, 11), account [5, 21)  →  union [1, 21) = 20 days   (adding the two would give 26)
 *
 * Evidence label: pure functions = TEST FIXTURE-free unit tests; the rest is BACKEND INTEGRATION against
 * gymcoach_user_test (payment-service and the notification push stubbed at the client boundary).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-contract-scope-time.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../repositories/profile.repository";
import { mergeSpans, totalGiveBackMs, uncoveredMs } from "../services/pt-restriction-intervals";
import { computeBlockedMs, getEffectiveContractStatus, ptRestrictionService } from "../services/pt-restriction.service";
import { DAY, addSession, cleanup, flagMatchesRecord, skip, stubs } from "./pt-restriction.test-helpers";
import { ADMIN, makeAn } from "./pt-contract-scope.test-helpers";

const d = (n: number) => n * DAY;

// ── pure maths ───────────────────────────────────────────────────────────────────────────────

test("mergeSpans / uncoveredMs: union length, touching spans merge, empty spans vanish", () => {
  assert.deepEqual(mergeSpans([{ start: d(5), end: d(21) }, { start: d(1), end: d(11) }, { start: d(30), end: d(30) }]), [{ start: d(1), end: d(21) }]);
  assert.deepEqual(mergeSpans([{ start: d(1), end: d(2) }, { start: d(2), end: d(3) }]), [{ start: d(1), end: d(3) }], "touching = one span");
  assert.deepEqual(mergeSpans([{ start: d(1), end: d(2) }, { start: d(4), end: d(5) }]).length, 2);
  assert.equal(uncoveredMs({ start: d(5), end: d(21) }, [{ start: d(1), end: d(11) }]), d(10), "[5,21) minus [1,11) = [11,21)");
  assert.equal(uncoveredMs({ start: d(5), end: d(8) }, [{ start: d(1), end: d(11) }]), 0, "fully covered");
  assert.equal(uncoveredMs({ start: d(5), end: d(8) }, []), d(3));
});

test("totalGiveBackMs: the union, clipped to activation, and only while the contract had not run out", () => {
  const A = { start: d(1), end: d(11) };
  const B = { start: d(5), end: d(21) };
  // the owner's case: activated before day 1, original end day 100
  assert.equal(totalGiveBackMs(d(100), d(-20), [A, B]), d(20), "union, not 10 + 16");
  assert.equal(totalGiveBackMs(d(100), d(-20), [B, A]), d(20), "order of the list does not matter");
  assert.equal(totalGiveBackMs(d(100), d(-20), [A]), d(10));
  assert.equal(totalGiveBackMs(d(100), d(-20), []), 0);
  // activation clips the front of the union
  assert.equal(totalGiveBackMs(d(100), d(8), [A, B]), d(13), "activated day 8: only [8,21) counts");
  // the contract had already run out when the block began: nothing, and it is not revived
  assert.equal(totalGiveBackMs(d(3), d(-20), [A]), d(10), "2 days were left when the block began on day 1: the whole block is given back");
  assert.equal(totalGiveBackMs(d(-5), d(-20), [A]), 0, "it ended on day -5, long before the block");
  assert.equal(totalGiveBackMs(d(1), d(-20), [A]), 0, "end date == start of the block: nothing left to block");
  // a second block that begins after the (extended) end date is not counted either
  assert.equal(totalGiveBackMs(d(30), d(-20), [A, { start: d(45), end: d(50) }]), d(10), "ended day 40; the block on 45-50 found it over");
  assert.equal(totalGiveBackMs(d(30), d(-20), [A, { start: d(35), end: d(38) }]), d(13), "day 35 is inside the extended run (ends day 40)");
  // the single-episode form still agrees
  assert.equal(totalGiveBackMs(d(30), d(0), [{ start: d(20), end: d(41) }]), computeBlockedMs(new Date(d(20)), new Date(d(41)), new Date(d(0)), new Date(d(30))));
});

// ── database: the owner's day 1-10 / 5-20 case, both lift orders ───────────────────────────────

const ADD = (B: number, n: number) => new Date(B + n * DAY);

async function endDateOf(id: string) {
  return (await prisma.contract.findUniqueOrThrow({ where: { id } })).endDate!.getTime();
}

const restrictAt = (pt: string, contractId: string, at: Date, reasonText = "rà soát") =>
  ptRestrictionService.restrictContract({ ptUserId: pt, contractId, adminId: ADMIN, reasonCategory: "COMPLAINT_REVIEW", reasonText, at });
const suspendAt = (pt: string, at: Date) =>
  ptRestrictionService.suspend({ ptUserId: pt, adminId: ADMIN, reasonCategory: "CONDUCT_REVIEW", reasonText: "nội bộ", at });
const liftAccountAt = (pt: string, at: Date) => ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong", at });
const liftContractAt = (pt: string, contractId: string, at: Date) =>
  ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId, adminId: ADMIN, reason: "xong", at });

async function fixture() {
  const B = Date.now() - 200 * DAY;
  const an = await makeAn({ startDate: ADD(B, -20), endDate: ADD(B, 100) });
  return { B, ...an, END: an.contracts.binh.endDate!.getTime() };
}

test("(13) contract on days 1-10, account on days 5-20, contract lifted FIRST: Bình is extended by exactly 20 days (not 26); Chi only by the account's 16", { skip }, async () => {
  const { B, pt, contracts: c, ids, END } = await fixture();
  const s = stubs();
  try {
    await restrictAt(pt, c.binh.id, ADD(B, 1));
    await suspendAt(pt, ADD(B, 5));
    const l1 = await liftContractAt(pt, c.binh.id, ADD(B, 11));
    assert.equal(l1.summary!.extendedContracts[0].blockedMs, d(10), "the contract's own days 1-10");
    assert.equal(l1.stillPausedByAccount, true);
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN", "the account suspension still holds it");
    const l2 = await liftAccountAt(pt, ADD(B, 21));
    const byContract = new Map(l2.summary!.extendedContracts.map((e) => [e.contractId, e.blockedMs]));
    assert.equal(byContract.get(c.binh.id), d(10), "only days 11-20 are new for Bình (days 5-10 were already paid back)");
    assert.equal(byContract.get(c.chi.id), d(16), "Chi was blocked only by the account: days 5-20");

    assert.equal(await endDateOf(c.binh.id), END + d(20), "exactly 20 days: the union of days 1-20");
    for (const n of ["chi", "dung", "em"] as const) assert.equal(await endDateOf(c[n].id), END + d(16), n);
    const sum = (await prisma.ptRestrictionContractExtension.findMany({ where: { contractId: c.binh.id } })).reduce((a, e) => a + Number(e.blockedMs), 0);
    assert.equal(sum, d(20), "the markers add up to the same 20 days");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 0);
    assert.ok(await flagMatchesRecord(pt));

    // repeating either lift changes nothing
    assert.equal((await liftContractAt(pt, c.binh.id, ADD(B, 30))).changed, false);
    assert.equal((await liftAccountAt(pt, ADD(B, 30))).changed, false);
    assert.equal(await endDateOf(c.binh.id), END + d(20));
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(13) the same overlap lifted in the OTHER order (account first): still exactly 20 days for Bình", { skip }, async () => {
  const { B, pt, contracts: c, ids, END } = await fixture();
  const s = stubs();
  try {
    // contract days 1-20, account days 5-10: the account is lifted first
    await restrictAt(pt, c.binh.id, ADD(B, 1));
    await suspendAt(pt, ADD(B, 5));
    const l1 = await liftAccountAt(pt, ADD(B, 11));
    const byContract = new Map(l1.summary!.extendedContracts.map((e) => [e.contractId, e.blockedMs]));
    assert.equal(byContract.get(c.binh.id), d(6), "days 5-10 are the first closed blocked time of Bình");
    assert.equal(byContract.get(c.chi.id), d(6));
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN", "lifting the account does not lift the contract restriction");
    assert.equal(await getEffectiveContractStatus(c.chi), "ACTIVE");
    const l2 = await liftContractAt(pt, c.binh.id, ADD(B, 21));
    assert.equal(l2.summary!.extendedContracts[0].blockedMs, d(14), "[1,21) is 20 days; 6 were already given back");
    assert.equal(await endDateOf(c.binh.id), END + d(20));
    assert.equal(await endDateOf(c.chi.id), END + d(6), "Chi: only the account's days 5-10");
    assert.equal(await getEffectiveContractStatus(c.binh), "ACTIVE");
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(13) raising a contract restriction to an account restriction: recorded (reason, time, who), the contract is not double counted, other contracts are paused from the raise", { skip }, async () => {
  const { B, pt, contracts: c, ids, END } = await fixture();
  const s = stubs();
  try {
    await restrictAt(pt, c.binh.id, ADD(B, 1), "khiếu nại riêng");
    s.notified.length = 0;
    const raised = await ptRestrictionService.changeScope({
      ptUserId: pt,
      adminId: "admin-raise",
      to: "ACCOUNT",
      contractId: c.binh.id,
      reason: "Có thêm căn cứ rủi ro rộng",
      at: ADD(B, 11),
    });
    assert.equal(raised.changed, true);

    // history: the contract episode is closed as SCOPE_RAISED by the admin, with the reason and the instant;
    // the account episode that replaces it says so
    const contractRow = await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id } });
    assert.equal(contractRow.endKind, "SCOPE_RAISED");
    assert.equal(contractRow.liftedBy, "admin-raise");
    assert.equal(contractRow.liftReason, "Có thêm căn cứ rủi ro rộng");
    assert.equal(contractRow.endedAt!.getTime(), ADD(B, 11).getTime());
    const accountRow = await prisma.ptRestriction.findFirstOrThrow({ where: { ptUserId: pt, scope: "ACCOUNT", endedAt: null } });
    assert.equal(accountRow.supersedesRestrictionId, contractRow.id);
    assert.equal(accountRow.imposedBy, "admin-raise");
    assert.equal(accountRow.reasonText, "Có thêm căn cứ rủi ro rộng");
    assert.equal(accountRow.startedAt.getTime(), ADD(B, 11).getTime(), "the account episode starts exactly where the contract one ended: no gap, no overlap");
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    assert.ok(await flagMatchesRecord(pt));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PT_RESTRICTION_SCOPE_RAISED", entityId: pt } });
    assert.equal(audit.actorUserId, "admin-raise");
    assert.equal((audit.metadata as any).contractId, c.binh.id);
    // notifications: the other clients and An hear about the account pause; Bình (already told) does not
    assert.ok(!s.notified.some((n) => n.userId === c.binh.clientUserId), "Bình was already told");
    for (const n of ["chi", "dung", "em"] as const) assert.ok(s.notified.some((x) => x.userId === c[n].clientUserId && x.eventType === "CONTRACT_PAUSED_PT_SUSPENDED"), n);
    assert.match(s.notified.find((n) => n.userId === pt).text, /4 hợp đồng/);
    // a repeated raise is a no-op
    assert.equal((await ptRestrictionService.changeScope({ ptUserId: pt, adminId: ADMIN, to: "ACCOUNT", contractId: c.binh.id, reason: "lặp", at: ADD(B, 12) })).changed, false);

    await liftAccountAt(pt, ADD(B, 21));
    assert.equal(await endDateOf(c.binh.id), END + d(20), "days 1-10 (contract) + 11-20 (account): 20, each day once");
    for (const n of ["chi", "dung", "em"] as const) assert.equal(await endDateOf(c[n].id), END + d(10), `${n}: only the account days 11-20`);
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(13) raising while the account is ALREADY suspended folds the contract episode in (no second account episode, still 20 days for days 1-20)", { skip }, async () => {
  const { B, pt, contracts: c, ids, END } = await fixture();
  const s = stubs();
  try {
    await restrictAt(pt, c.binh.id, ADD(B, 1));
    await suspendAt(pt, ADD(B, 5));
    const raised = await ptRestrictionService.changeScope({ ptUserId: pt, adminId: ADMIN, to: "ACCOUNT", contractId: c.binh.id, reason: "gộp vào hạn chế tài khoản", at: ADD(B, 11) });
    assert.equal(raised.changed, true);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, scope: "ACCOUNT" } }), 1, "no second account episode");
    assert.equal((await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id } })).endKind, "SCOPE_RAISED");
    await liftAccountAt(pt, ADD(B, 21));
    assert.equal(await endDateOf(c.binh.id), END + d(20), "[1,11) ∪ [5,21) = 20 days");
    assert.equal(await endDateOf(c.chi.id), END + d(16));
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(13) narrowing an account suspension to one contract: everyone else resumes and is told, the named contract carries on as a contract restriction, no day is counted twice", { skip }, async () => {
  const { B, pt, contracts: c, ids, END } = await fixture();
  const s = stubs();
  try {
    await suspendAt(pt, ADD(B, 1));
    s.notified.length = 0;
    const narrowed = await ptRestrictionService.changeScope({
      ptUserId: pt,
      adminId: "admin-narrow",
      to: "CONTRACT",
      contractIds: [c.binh.id],
      reason: "Chỉ khiếu nại của Bình còn hiệu lực",
      at: ADD(B, 11),
    });
    assert.equal(narrowed.changed, true);
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false, "An is no longer suspended as a whole");
    assert.ok(await flagMatchesRecord(pt));
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN");
    for (const n of ["chi", "dung", "em"] as const) assert.equal(await getEffectiveContractStatus(c[n]), "ACTIVE", n);

    const accountRow = await prisma.ptRestriction.findFirstOrThrow({ where: { ptUserId: pt, scope: "ACCOUNT" } });
    assert.equal(accountRow.endKind, "SCOPE_NARROWED");
    assert.equal(accountRow.liftedBy, "admin-narrow");
    assert.equal(accountRow.liftReason, "Chỉ khiếu nại của Bình còn hiệu lực");
    const binhRow = await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id, endedAt: null } });
    assert.equal(binhRow.supersedesRestrictionId, accountRow.id);
    assert.equal(binhRow.startedAt.getTime(), ADD(B, 11).getTime());
    assert.equal(binhRow.imposedBy, "admin-narrow");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PT_RESTRICTION_SCOPE_NARROWED", entityId: pt } });
    assert.deepEqual((audit.metadata as any).contractIds, [c.binh.id]);

    // the released contracts got days 1-10 back now; Bình too (its account part is closed)
    for (const n of ["chi", "dung", "em"] as const) assert.equal(await endDateOf(c[n].id), END + d(10), n);
    assert.equal(await endDateOf(c.binh.id), END + d(10));
    // notices: Chi/Dũng/Em resumed, An told one contract stays paused, Bình nothing new
    const resumed = s.notified.filter((n) => n.eventType === "CONTRACT_RESUMED_PT_REINSTATED");
    for (const n of ["chi", "dung", "em"] as const) assert.ok(resumed.some((x) => x.userId === c[n].clientUserId), n);
    assert.ok(!s.notified.some((n) => n.userId === c.binh.clientUserId));
    assert.match(resumed.find((n) => n.userId === pt).text, /1 hợp đồng vẫn tạm dừng/);
    // repeated: no-op
    assert.equal((await ptRestrictionService.changeScope({ ptUserId: pt, adminId: ADMIN, to: "CONTRACT", contractIds: [c.binh.id], reason: "lặp", at: ADD(B, 12) })).changed, false);

    await liftContractAt(pt, c.binh.id, ADD(B, 21));
    assert.equal(await endDateOf(c.binh.id), END + d(20), "account days 1-10 + contract days 11-20, each once");
    assert.equal(await endDateOf(c.chi.id), END + d(10), "Chi is not extended again");
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("a contract that had already run out before it was blocked is not extended or revived; one activated mid-episode counts from its activation", { skip }, async () => {
  const B = Date.now() - 200 * DAY;
  const { pt, contracts: c, ids } = await makeAn({ startDate: ADD(B, -20), endDate: ADD(B, 100) });
  const s = stubs();
  try {
    // Bình's end date is day 3 (still ACTIVE, the expiry sweep has not run); Chi was activated on day 8
    await prisma.contract.update({ where: { id: c.binh.id }, data: { endDate: ADD(B, 3) } });
    await prisma.contract.update({ where: { id: c.chi.id }, data: { startDate: ADD(B, 8) } });
    await restrictAt(pt, c.binh.id, ADD(B, 5));
    await liftContractAt(pt, c.binh.id, ADD(B, 15));
    assert.equal(await endDateOf(c.binh.id), ADD(B, 3).getTime(), "its run was over before the block began: nothing to give back");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).status, "ACTIVE", "and nothing revived or ended here");

    await suspendAt(pt, ADD(B, 5));
    await liftAccountAt(pt, ADD(B, 21));
    assert.equal(await endDateOf(c.chi.id), ADD(B, 100).getTime() + d(13), "Chi counts [8,21) only");
    assert.equal(await endDateOf(c.dung.id), ADD(B, 100).getTime() + d(16));
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(13) a client's confirmation window is given back for the UNION too (20 days, not 26) whichever lifts first", { skip }, async () => {
  for (const order of ["contract-first", "account-first"] as const) {
    const { B, pt, contracts: c, ids } = await fixture();
    const s = stubs();
    try {
      const pending = await addSession(c.binh, "PENDING_CLIENT_CONFIRMATION", ADD(B, 0), { clientConfirmDeadline: ADD(B, 30) });
      const other = await addSession(c.chi, "PENDING_CLIENT_CONFIRMATION", ADD(B, 0), { clientConfirmDeadline: ADD(B, 30) });
      if (order === "contract-first") {
        await restrictAt(pt, c.binh.id, ADD(B, 1));
        await suspendAt(pt, ADD(B, 5));
        await liftContractAt(pt, c.binh.id, ADD(B, 11));
        await liftAccountAt(pt, ADD(B, 21));
      } else {
        await restrictAt(pt, c.binh.id, ADD(B, 1));
        await suspendAt(pt, ADD(B, 5));
        await liftAccountAt(pt, ADD(B, 11));
        await liftContractAt(pt, c.binh.id, ADD(B, 21));
      }
      const got = (await prisma.session.findUniqueOrThrow({ where: { id: pending.id } })).clientConfirmDeadline!.getTime();
      assert.equal(got, ADD(B, 30).getTime() + d(20), `${order}: +20 days`);
      const chi = (await prisma.session.findUniqueOrThrow({ where: { id: other.id } })).clientConfirmDeadline!.getTime();
      assert.equal(chi, ADD(B, 30).getTime() + (order === "contract-first" ? d(16) : d(6)), `${order}: Chi only for the account's days`);
    } finally {
      s.restore();
      await cleanup([pt], ids);
    }
  }
});

test("history lists contract-scope episodes with the contract and what each added; the admin list shows them too and can filter by scope", { skip }, async () => {
  const { B, pt, contracts: c, ids } = await fixture();
  const s = stubs();
  try {
    await restrictAt(pt, c.binh.id, ADD(B, 1));
    await suspendAt(pt, ADD(B, 5));
    await liftContractAt(pt, c.binh.id, ADD(B, 11));
    const history = await ptRestrictionService.history(pt);
    assert.equal(history.length, 2);
    const contractRow = history.find((h) => h.scope === "CONTRACT")!;
    assert.equal(contractRow.contractId, c.binh.id);
    assert.equal(contractRow.contract?.packageName, "Gói binh");
    assert.equal(contractRow.contractsExtended, 1);
    assert.equal(contractRow.totalExtendedMs, d(10));
    assert.equal(history.find((h) => h.scope === "ACCOUNT")!.endedAt, null);

    const all = await ptRestrictionService.listActive({ now: ADD(B, 12) });
    assert.ok(all.items.some((i) => i.ptUserId === pt && i.scope === "ACCOUNT" && i.pausedContracts === 4));
    const onlyContract = await ptRestrictionService.listActive({ scope: "CONTRACT" });
    assert.ok(!onlyContract.items.some((i) => i.ptUserId === pt), "the contract episode is closed; only the account one is active");
    await restrictAt(pt, c.chi.id, ADD(B, 12));
    const again = await ptRestrictionService.listActive({ scope: "CONTRACT" });
    const row = again.items.find((i) => i.ptUserId === pt)!;
    assert.deepEqual([row.scope, row.contractId, row.pausedContracts], ["CONTRACT", c.chi.id, 1]);
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});
