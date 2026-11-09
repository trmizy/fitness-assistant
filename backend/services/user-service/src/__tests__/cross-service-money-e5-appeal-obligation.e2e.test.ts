/**
 * E5 (Ngài, 05/11/2026) - the FORMAL obligation after a WON APPEAL, through REAL HTTP into user-service and the REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service app + Case service + executor, real payment-service child, isolated *_test databases). TEST FIXTURES (named where used): the contract / session rows,
 * the token -> identity table, the admin-account lookup (every id is an active ADMIN), the stopped payment-service, and the SQL that stands for the FH-8 lifecycle having verified the external payment.
 * Opt-in; run ALONE (same command shape as the other cross-service files).
 *
 * Hand-computed: a 1,000,000 / 4 contract; the appeal's NEW finding VERIFIED_PT_ABSENT establishes 250,000 owed by the PT -> ONE obligation owed 250,000 / paid 0 / unpaid 250,000, kind APPEAL_AWARD,
 * owed to the CLIENT, responsible PT. NO wallet, ledger entry or ledger operation changes when it is created (whole-ledger snapshot compared). Without an established amount + party, or with a finding that
 * does not establish them, NOTHING is created and the consequence stays NEEDS_RECONCILIATION.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness } from "./cross-service-money.harness";

process.env.NODE_ENV = "test";
process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const PRICE = 1_000_000;

let H: Harness;
let X: { helpers: typeof import("./dispute-case-exec.test-helpers"); closure: typeof import("../services/dispute-case/dispute-case.service") };
test.before(async () => {
  if (skip) return;
  process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  process.env.DISPUTE_CASE_APPEALS_ENABLED = "true";
  H = await startHarness();
  const { setAdminAccountLookupForTests } = await import("../services/dispute-case/admin-account");
  setAdminAccountLookupForTests(async () => ({ role: "ADMIN", isActive: true }));
  X = { helpers: await import("./dispute-case-exec.test-helpers"), closure: await import("../services/dispute-case/dispute-case.service") };
});
test.after(async () => {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  if (H) await H.close();
});
async function scenario(fn: () => Promise<void>) {
  await H.resetPayment();
  try {
    await fn();
  } finally {
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}
const prisma = () => H.m.prisma;
let k = 0;
const key = () => ({ "Idempotency-Key": `e5-${++k}-${randomUUID().slice(0, 8)}` });
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(H.userUrl + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}
const A = (id: string) => H.tokenFor(id, "ADMIN");
const obligations = (txnId: string) =>
  H.payDb.$queryRawUnsafe(`SELECT id, key, kind::text AS kind, party, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid, responsible_party, source_ref FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at`, txnId) as Promise<any[]>;

/** A paid 1,000,000 / 4 contract, a DISPUTED session, an executed COMPLETED decision, the client's appeal and its reviewer: everything up to the reviewer's decision. */
async function appealReady() {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
  const T = Date.now();
  const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
  assert.equal((await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" })).status, 200);
  const a = await X.helpers.approvedCaseFor(S.id, "VERIFIED_DELIVERED");
  const ex = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(X.helpers.admin().id), {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  const ap = (await call("POST", `/dispute-cases/${a.caseId}/appeals`, c.clientToken, { reason: "PT không đến" }, key())).json;
  assert.ok(ap.appealId, JSON.stringify(ap));
  const R = X.helpers.admin();
  const assigned = await call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/assign-reviewer`, A(X.helpers.admin().id), { reviewerId: R.id });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  const decide = (body: unknown, h = key()) => call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/decision`, A(R.id), body, h);
  return { c, S, a, ap, R, decide };
}
const WON = (money: Record<string, unknown>) => ({
  result: "NEW_FINDING",
  reasoning: "Dữ liệu phòng cho thấy PT không có mặt",
  finding: "VERIFIED_PT_ABSENT",
  consequences: [{ kind: "MONEY", note: "Khách được hoàn một buổi", ...money }],
});
const moneyConsequence = (caseId: string) => prisma().disputeCaseAppealConsequence.findFirstOrThrow({ where: { caseId, kind: "MONEY" } });

test("E5 happy path: amount + responsible party ESTABLISHED -> ONE obligation (250,000 owed, 0 paid, OPEN, to the CLIENT, responsible PT), no money moves, idempotent, the money axis is NOT settled until the obligation is", { skip }, async () => {
  await scenario(async () => {
    const f = await appealReady();
    const snap = await H.snapshot();
    const body = WON({ amountVnd: 250_000, responsibleParty: "PT" });
    const won = await f.decide(body, { "Idempotency-Key": "e5-fixed-key" });
    assert.equal(won.status, 200, JSON.stringify(won.json));
    const m = won.json.consequences.find((x: any) => x.kind === "MONEY");
    assert.equal(m.status, "OBLIGATION_OPEN");
    assert.equal(won.json.fullyResolved, false);
    const obs = await obligations(f.c.txnId);
    assert.equal(obs.length, 1);
    assert.deepEqual([obs[0].kind, obs[0].party, obs[0].status, obs[0].owed, obs[0].paid, obs[0].unpaid, obs[0].responsible_party, obs[0].source_ref], ["APPEAL_AWARD", "CLIENT", "OPEN", "250000.00", "0.00", "250000.00", "PT", m.id]);
    assert.deepEqual(await H.snapshot(), snap, "creating the obligation moved NO money (whole ledger snapshot)");
    const ev = await H.payDb.$queryRawUnsafe(`SELECT action::text AS action, actor, approval_ref FROM contract_unpaid_obligation_events WHERE obligation_id = $1`, obs[0].id);
    assert.deepEqual((ev as any[]).map((e) => [e.action, e.actor, e.approval_ref]), [["CREATE_FROM_APPEAL", f.R.id, m.id]], "ONE append-only event");
    assert.equal(await prisma().disputeCaseEvent.count({ where: { caseId: f.a.caseId, action: "APPEAL_OBLIGATION_CREATED" } }), 1);
    // replay of the same decision and the retry route: nothing new
    const replay = await f.decide(body, { "Idempotency-Key": "e5-fixed-key" });
    assert.equal(replay.status, 200);
    const retry = await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${m.id}/create-obligation`, A(f.R.id), {});
    assert.deepEqual([retry.status, retry.json.status, retry.json.replayed], [200, "OBLIGATION_OPEN", true]);
    assert.equal((await obligations(f.c.txnId)).length, 1);
    assert.deepEqual(await H.snapshot(), snap);

    // the financial axis never shows "done" while the obligation is unsettled
    const rows = await prisma().disputeCaseAppeal.findMany({ where: { caseId: f.a.caseId }, include: { consequences: true } });
    const cl = X.closure.closureOf({ status: "DECISION_APPROVED", closeReason: null }, rows as any);
    assert.deepEqual([cl.fullyResolved, cl.moneyAxisSettled], [false, false]);
    const sync1 = await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${m.id}/sync-obligation`, A(f.R.id), {});
    assert.deepEqual([sync1.status, sync1.json.status, sync1.json.obligation.status], [200, "OBLIGATION_OPEN", "OPEN"], "still owed: the consequence stays open");
    // TEST FIXTURE: the FH-8 lifecycle verified the external payment (the obligation is PAID_VERIFIED, nothing unpaid)
    await H.payDb.$executeRawUnsafe(`UPDATE contract_unpaid_obligations SET status = 'PAID_VERIFIED', paid = owed, unpaid = 0, verified_paid = owed WHERE id = $1`, obs[0].id);
    const sync2 = await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${m.id}/sync-obligation`, A(f.R.id), {});
    assert.deepEqual([sync2.status, sync2.json.status], [200, "RESOLVED"]);
    const rows2 = await prisma().disputeCaseAppeal.findMany({ where: { caseId: f.a.caseId }, include: { consequences: true } });
    assert.equal(X.closure.closureOf({ status: "DECISION_APPROVED", closeReason: null }, rows2 as any).moneyAxisSettled, true, "only now");
    await H.invariant("E5");
  });
});

test("E5 NOT established -> NOTHING is created, the consequence stays NEEDS_RECONCILIATION: no amount, a finding that does not establish it, an amount above the contract; a malformed amount is refused", { skip }, async () => {
  await scenario(async () => {
    // (a) no amount / party at all
    const a = await appealReady();
    const snapA = await H.snapshot();
    const wa = await a.decide(WON({}));
    assert.equal(wa.status, 200, JSON.stringify(wa.json));
    assert.equal((await moneyConsequence(a.a.caseId)).status, "NEEDS_RECONCILIATION");
    assert.equal((await obligations(a.c.txnId)).length, 0);
    const noRetry = await call("POST", `/admin/dispute-cases/${a.a.caseId}/appeal-consequences/${(await moneyConsequence(a.a.caseId)).id}/create-obligation`, A(a.R.id), {});
    assert.deepEqual([noRetry.status, noRetry.json.code], [409, "MONEY_NOT_ESTABLISHED"]);
    assert.deepEqual(await H.snapshot(), snapA);

    // (b) amount + party with a finding that does not establish them; party other than the PT; amount without party; body amount outside consequences
    const b = await appealReady();
    const bad: Array<[string, unknown, number, string]> = [
      ["finding not PT_ABSENT", { ...WON({ amountVnd: 250_000, responsibleParty: "PT" }), finding: "VERIFIED_NOT_DELIVERED_NO_FAULT" }, 400, "MONEY_NOT_ESTABLISHED_BY_FINDING"],
      ["party is the platform", WON({ amountVnd: 250_000, responsibleParty: "PLATFORM" }), 400, "MONEY_NOT_ESTABLISHED_BY_FINDING"],
      ["amount without a party", WON({ amountVnd: 250_000 }), 400, "INVALID_INPUT"],
      ["party without an amount", WON({ responsibleParty: "PT" }), 400, "INVALID_INPUT"],
      ["fractional amount", WON({ amountVnd: 250_000.5, responsibleParty: "PT" }), 400, "INVALID_INPUT"],
      ["zero amount", WON({ amountVnd: 0, responsibleParty: "PT" }), 400, "INVALID_INPUT"],
      ["amount on a QUOTA consequence", { ...WON({}), consequences: [{ kind: "QUOTA", note: "x", amountVnd: 1, responsibleParty: "PT" }] }, 400, "INVALID_INPUT"],
      ["free-text party", WON({ amountVnd: 250_000, responsibleParty: "ông Nguyễn" }), 400, "INVALID_INPUT"],
    ];
    for (const [why, body, status, code] of bad) {
      const r = await b.decide(body);
      assert.deepEqual([r.status, r.json.code], [status, code], why);
    }
    assert.equal((await obligations(b.c.txnId)).length, 0);
    assert.equal(await prisma().disputeCaseAppealConsequence.count({ where: { caseId: b.a.caseId } }), 0, "a refused decision recorded no consequence");

    // (c) an amount above the contract's value: the decision is recorded (the finding is), nothing is created, the retry says why
    const c = await appealReady();
    const wc = await c.decide(WON({ amountVnd: 2_000_000, responsibleParty: "PT" }));
    assert.equal(wc.status, 200, JSON.stringify(wc.json));
    const cons = await moneyConsequence(c.a.caseId);
    assert.equal(cons.status, "NEEDS_RECONCILIATION");
    assert.equal((await obligations(c.c.txnId)).length, 0);
    const over = await call("POST", `/admin/dispute-cases/${c.a.caseId}/appeal-consequences/${cons.id}/create-obligation`, A(c.R.id), {});
    assert.deepEqual([over.status, over.json.code], [422, "AMOUNT_EXCEEDS_CONTRACT"]);
    await H.invariant("E5 not established");
  });
});

test("E5 payment-service DOWN at the decision: the consequence stays NEEDS_RECONCILIATION (no fake debt), the retry creates ONE obligation once it is back; another contract's context is never used", { skip }, async () => {
  await scenario(async () => {
    const f = await appealReady();
    const other = await H.paidContract(await H.makePt(), { price: PRICE, totalSessions: 4 });
    await H.stopPayment();
    const won = await f.decide(WON({ amountVnd: 250_000, responsibleParty: "PT" }));
    await H.startPayment();
    assert.equal(won.status, 200, JSON.stringify(won.json));
    const cons = await moneyConsequence(f.a.caseId);
    assert.equal(cons.status, "NEEDS_RECONCILIATION");
    assert.equal((await obligations(f.c.txnId)).length, 0);
    const snap = await H.snapshot();
    const retry = await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${cons.id}/create-obligation`, A(f.R.id), {});
    assert.deepEqual([retry.status, retry.json.status, retry.json.replayed], [200, "OBLIGATION_OPEN", false], JSON.stringify(retry.json));
    const obs = await obligations(f.c.txnId);
    assert.deepEqual([obs.length, obs[0].owed, obs[0].responsible_party], [1, "250000.00", "PT"]);
    assert.deepEqual(await H.snapshot(), snap, "no money moved");
    assert.equal((await obligations(other.txnId)).length, 0, "the other contract has no obligation");
    // identity: a non-admin and an anonymous caller cannot use the retry/sync routes
    assert.equal((await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${cons.id}/sync-obligation`, f.c.clientToken, {})).status, 403);
    assert.equal((await call("POST", `/admin/dispute-cases/${f.a.caseId}/appeal-consequences/${cons.id}/sync-obligation`, null, {})).status, 401);
    await H.invariant("E5 down");
  });
});
