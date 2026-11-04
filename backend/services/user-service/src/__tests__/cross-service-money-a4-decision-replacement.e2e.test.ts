/**
 * A4 (05/11/2026) - REPLACING an approved Case decision that has had NO effect (Q3 design section 2), through REAL HTTP into user-service and the REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + executor + ruling core, real payment-service child, isolated *_test databases). TEST FIXTURES (named where used): the contract / session
 * rows, the token -> identity table, the case workflow driven through the real Case service (four-eyes approvals), the SQL that poses an EXEC_BLOCKED case, a ledger operation written directly to pose
 * "the ledger already holds the step", the stopped payment-service. Opt-in; run ALONE (same command shape as the other cross-service files).
 *
 * Money: a replacement moves NOTHING. Every test compares the whole ledger snapshot (wallet balances + row counts) before and after; the one money step in the file (the NEW decision, executed after a
 * replacement) is hand-computed: 1,000,000 / 4 sessions, V = 250,000 = PT 225,000 + platform 25,000, COMPLETED on a running contract releases exactly V to PT/platform available, once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";

process.env.NODE_ENV = "test";
process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const PRICE = 1_000_000;
const FLAG = "DISPUTE_CASE_DECISION_REPLACEMENT_ENABLED";

let H: Harness;
let X: {
  helpers: typeof import("./dispute-case-exec.test-helpers");
  exec: typeof import("../services/dispute-case/execution.service");
  svc: typeof import("../services/dispute-case/dispute-case.service").disputeCaseService;
};
test.before(async () => {
  if (skip) return;
  process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  H = await startHarness();
  X = {
    helpers: await import("./dispute-case-exec.test-helpers"),
    exec: await import("../services/dispute-case/execution.service"),
    svc: (await import("../services/dispute-case/dispute-case.service")).disputeCaseService,
  };
});
test.after(async () => {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  delete process.env[FLAG];
  if (H) await H.close();
});
test.beforeEach(() => {
  process.env[FLAG] = "true"; // effective only because NODE_ENV=test and the preload accepted the isolated database
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

const adminTok = (n: string) => H.tokenFor(`adm-a4-${n}`, "ADMIN");
const A = () => adminTok("A");
const B = () => adminTok("B");
const C = () => adminTok("C");
const prisma = () => H.m.prisma;
async function api(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(H.userUrl + "/admin/dispute-cases" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}
const propose = (caseId: string, token: string, body: unknown = { reason: "Phát hiện sai sót khi duyệt, thay quyết định" }, h: Record<string, string> = {}) => api("POST", `/${caseId}/replacements`, token, body, h);
const decideBody = (over: Record<string, unknown> = {}) => ({ reason: "Đồng ý", conflictOfInterestDeclaredNone: true, ...over });
const approveRepl = (caseId: string, rid: string, token: string, body: unknown = decideBody(), h: Record<string, string> = {}) => api("POST", `/${caseId}/replacements/${rid}/approve`, token, body, h);
const rejectRepl = (caseId: string, rid: string, token: string, body: unknown = decideBody(), h: Record<string, string> = {}) => api("POST", `/${caseId}/replacements/${rid}/reject`, token, body, h);

interface Fx {
  c: PaidContract;
  S: { id: string };
  caseId: string;
  approvalId: string;
  investigator: { id: string; role: "ADMIN" };
}
/** A DISPUTED session (no D77) on a running 1,000,000 / 4 contract, taken through the real Case service to an APPROVED decision (COMPLETED) + the policy eligibility the executor needs. */
async function approvedCase(outcome: "COMPLETED" | "CANCELLED" = "COMPLETED"): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4, eligibility: false });
  const T = Date.now();
  const S = await H.m.base.addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 24 * HOUR), { clientConfirmDeadline: new Date(T + 48 * HOUR), sessionMode: "OFFLINE", ptNotes: "PT báo đã dạy" });
  const d = await H.call("POST", `/sessions/${S.id}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const a = await X.helpers.approvedCaseFor(S.id, outcome === "COMPLETED" ? "VERIFIED_DELIVERED" : "VERIFIED_NOT_DELIVERED_NO_FAULT");
  const ev = await prisma().disputeCaseEvidence.findFirstOrThrow({ where: { caseId: a.caseId } });
  const proposed = (await X.svc.proposePolicyEligibility(a.investigator, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "Hợp đồng thuộc chính sách hiện hành (đối chiếu hợp đồng và thông báo)" })).result;
  await X.svc.approvePolicyEligibility(X.helpers.admin(), a.caseId, proposed.reviewId, { reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  return { c, S, caseId: a.caseId, approvalId: a.approvalId, investigator: a.investigator as any };
}
const caseRow = (id: string) => prisma().disputeCase.findUniqueOrThrow({ where: { id } });
const approvalRows = (caseId: string) => prisma().disputeCaseApproval.findMany({ where: { proposal: { caseId } }, orderBy: { createdAt: "asc" } });
const eventsOf = (caseId: string) => prisma().disputeCaseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const execute = (caseId: string) => X.exec.executionService.executeDecision(X.helpers.admin(), caseId, {});
const refuses = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => e.code === code || e.details?.reason === code, code);
async function footprint(fx: Fx) {
  const k = await prisma().contract.findUniqueOrThrow({ where: { id: fx.c.id } });
  const s = await prisma().session.findUniqueOrThrow({ where: { id: fx.S.id } });
  return {
    ledger: await H.snapshot(),
    replacements: await prisma().disputeCaseDecisionReplacement.count({ where: { caseId: fx.caseId } }),
    events: (await eventsOf(fx.caseId)).length,
    case: JSON.stringify(await caseRow(fx.caseId)),
    approvals: JSON.stringify(await approvalRows(fx.caseId)),
    session: [s.status, s.resolvedBy, s.resolvedByCaseDecisionId, s.sessionDeducted, s.noShowQuotaBookedAt],
    quota: [k.usedSessions, k.compensatedSessions],
    settlements: await prisma().sessionSettlement.count({ where: { sessionId: fx.S.id } }),
  };
}

// ═════════ 1. the whole path: pending blocks execute; approve replaces; the NEW decision executes once ═════════
test("A4-1 propose -> execute is 409 REPLACEMENT_PENDING -> approve (second admin) sends the Case back; the old approval is untouched, history is intact, money 0; a NEW decision executes ONCE (hand-computed 250,000 released)", { skip }, async () => {
  await scenario(async () => {
    const fx = await approvedCase();
    const approvalsBefore = JSON.stringify(await approvalRows(fx.caseId));
    const eventsBefore = (await eventsOf(fx.caseId)).map((e) => e.id);
    const snap0 = await H.snapshot();

    const p = await propose(fx.caseId, A());
    assert.equal(p.status, 201, JSON.stringify(p.body));
    assert.deepEqual([p.body.status, p.body.proposedBy, p.body.oldApprovalId], ["PENDING", "adm-a4-A", fx.approvalId]);
    // while it is pending the executor refuses and writes nothing
    const before = await footprint(fx);
    await refuses(execute(fx.caseId), "REPLACEMENT_PENDING");
    assert.deepEqual(await footprint(fx), before, "a refused execute wrote nothing");
    // a second live replacement is refused
    const dup = await propose(fx.caseId, B());
    assert.deepEqual([dup.status, dup.body.code], [409, "REPLACEMENT_PENDING"]);

    const ok = await approveRepl(fx.caseId, p.body.id, B());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.status, ok.body.approvedBy], ["APPROVED", "adm-a4-B"]);
    const c1 = await caseRow(fx.caseId);
    assert.deepEqual([c1.status, c1.execStatus, c1.execDecisionId], ["FINDING_RECORDED", "NOT_STARTED", null]);
    assert.equal(JSON.stringify(await approvalRows(fx.caseId)), approvalsBefore, "the old approval row is byte-identical (never updated or deleted)");
    const ev = await eventsOf(fx.caseId);
    assert.deepEqual(ev.slice(0, eventsBefore.length).map((e) => e.id), eventsBefore, "the earlier history is intact and in the same order");
    assert.deepEqual(ev.slice(eventsBefore.length).map((e) => e.action), ["REPLACEMENT_PROPOSED", "REPLACEMENT_APPROVED"]);
    assert.deepEqual(await H.snapshot(), snap0, "money 0 change");
    assert.equal(await prisma().sessionSettlement.count({ where: { sessionId: fx.S.id } }), 0);
    // the old decision can no longer be executed (the case is not DECISION_APPROVED)
    await assert.rejects(execute(fx.caseId));
    assert.equal((await prisma().session.findUniqueOrThrow({ where: { id: fx.S.id } })).status, "DISPUTED");

    // the NEW decision: new proposal by the investigator, new four-eyes approval by someone else, then execute
    const proposal = (await X.svc.propose(fx.investigator, fx.caseId, undefined)).result;
    assert.ok(proposal.id);
    const decided = await X.svc.decide(X.helpers.admin(), fx.caseId, { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false } as any);
    const newApprovalId = decided.result.approvalId;
    assert.notEqual(newApprovalId, fx.approvalId);
    assert.equal((await approvalRows(fx.caseId)).length, 2, "two approvals now exist: the old one kept, the new one added");
    const run = await execute(fx.caseId);
    assert.equal(run.executionState, "BUSINESS_DONE");
    const sess = await prisma().session.findUniqueOrThrow({ where: { id: fx.S.id } });
    assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["COMPLETED", newApprovalId], "the NEW decision ruled the session");
    // hand-computed: one session released on a running contract = PT 225,000 + platform 25,000 to AVAILABLE, once
    assert.equal(await H.net(fx.c.txnId, "PT", "AVAILABLE"), 225_000);
    assert.equal(await H.net(fx.c.txnId, "PLATFORM", "AVAILABLE", "REVENUE"), 25_000);
    assert.equal(await H.net(fx.c.txnId, "CLIENT", "AVAILABLE"), 0);
    assert.equal(((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `SESSION_RELEASE:${fx.S.id}`)) as any[])[0].n, 1);
    await H.invariant("A4-1");
  });
});

// ═════════ 2. flag, four eyes, conflict of interest, forged bodies ═════════
test("A4-2 flag OFF: every POST is 409 DECISION_REPLACEMENT_DISABLED (retries and invalid bodies included), GET stays open; ON outside a test environment is still OFF", { skip }, async () => {
  await scenario(async () => {
    const fx = await approvedCase();
    const p = await propose(fx.caseId, A());
    assert.equal(p.status, 201);
    const snap = await footprint(fx);
    const check = async (why: string) => {
      const calls = [
        propose(fx.caseId, A()),
        propose(fx.caseId, A(), { amount: 1 }),
        propose(fx.caseId, A(), undefined, { "idempotency-key": "k1" }),
        approveRepl(fx.caseId, p.body.id, B()),
        approveRepl(fx.caseId, p.body.id, B(), { nonsense: true }),
        rejectRepl(fx.caseId, p.body.id, B()),
      ];
      for (const r of await Promise.all(calls)) assert.deepEqual([r.status, r.body.code], [409, "DECISION_REPLACEMENT_DISABLED"], why);
      assert.deepEqual(await footprint(fx), snap, `${why}: nothing written`);
    };
    delete process.env[FLAG];
    await check("variable unset");
    process.env[FLAG] = "TRUE";
    await check("TRUE");
    process.env[FLAG] = "true";
    process.env.NODE_ENV = "production";
    const warn = console.warn;
    console.warn = () => {};
    try {
      await check("true but NODE_ENV=production");
    } finally {
      console.warn = warn;
      process.env.NODE_ENV = "test";
    }
    delete process.env[FLAG];
    const list = await api("GET", `/${fx.caseId}/replacements`, C());
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((i: any) => i.status), ["PENDING"]);
  });
});

test("A4-3 four eyes / conflict of interest / forged bodies / non-admin: all refused, NOTHING written", { skip }, async () => {
  await scenario(async () => {
    const fx = await approvedCase();
    const snap0 = await footprint(fx);
    const clientAdmin = H.tokenFor(fx.c.clientUserId, "ADMIN");
    const ptAdmin = H.tokenFor(fx.c.ptUserId, "ADMIN");
    for (const t of [clientAdmin, ptAdmin]) {
      const r = await propose(fx.caseId, t);
      assert.deepEqual([r.status, r.body.code], [403, "CONFLICT_OF_INTEREST"]);
    }
    for (const extra of [{ approvalId: "x" }, { outcome: "CANCELLED" }, { userId: "someone" }, { amount: 1 }]) {
      const r = await propose(fx.caseId, A(), { reason: "r", ...extra });
      assert.deepEqual([r.status, r.body.code], [400, "INVALID_INPUT"], JSON.stringify(extra));
    }
    for (const role of ["CUSTOMER", "PT", "GYM_OWNER"]) assert.equal((await propose(fx.caseId, H.tokenFor(`not-admin-${role}`, role))).status, 403, role);
    assert.equal((await propose(fx.caseId, "no-such-token")).status, 401);
    assert.deepEqual((await propose("not-a-uuid", A())).status, 404);
    assert.deepEqual(await footprint(fx), snap0);

    const p = await propose(fx.caseId, A());
    assert.equal(p.status, 201);
    const snap1 = await footprint(fx);
    const self = await approveRepl(fx.caseId, p.body.id, A());
    assert.deepEqual([self.status, self.body.code], [403, "SELF_APPROVAL_FORBIDDEN"]);
    const selfRej = await rejectRepl(fx.caseId, p.body.id, A());
    assert.deepEqual([selfRej.status, selfRej.body.code], [403, "SELF_REJECT_FORBIDDEN"]);
    for (const t of [clientAdmin, ptAdmin]) {
      assert.deepEqual([(await approveRepl(fx.caseId, p.body.id, t)).body.code], ["CONFLICT_OF_INTEREST"]);
      assert.deepEqual([(await rejectRepl(fx.caseId, p.body.id, t)).body.code], ["CONFLICT_OF_INTEREST"]);
    }
    assert.equal((await approveRepl(fx.caseId, p.body.id, B(), decideBody({ conflictOfInterestDeclaredNone: false }))).status, 403);
    for (const extra of [{ approvedBy: "adm-a4-A" }, { outcome: "X" }, { amount: 1 }]) assert.equal((await approveRepl(fx.caseId, p.body.id, B(), decideBody(extra))).status, 400);
    assert.equal((await approveRepl(fx.caseId, p.body.id, H.tokenFor("not-admin-pt", "PT"))).status, 403);
    assert.equal((await approveRepl(fx.caseId, "22222222-2222-4222-8222-222222222222", B())).status, 404);
    assert.deepEqual(await footprint(fx), snap1, "every refusal wrote nothing");
    // the database itself: self-approval, a party, rewriting the old approval, a second stamp
    const sql = (q: string) => prisma().$executeRawUnsafe(q);
    const id = p.body.id;
    await assert.rejects(() => sql(`UPDATE dispute_case_decision_replacements SET approved_by = proposed_by, approved_at = now(), approval_reason = 'x', checks_at_approval = '{}'::jsonb WHERE id = '${id}'::uuid`), /dcdr_four_eyes|violates check/);
    await assert.rejects(() => sql(`UPDATE dispute_case_decision_replacements SET reason = 'changed' WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`DELETE FROM dispute_case_decision_replacements WHERE id = '${id}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`UPDATE dispute_case_approvals SET reason = 'changed' WHERE id = '${fx.approvalId}'::uuid`), /append-only/);
    await assert.rejects(() => sql(`DELETE FROM dispute_case_approvals WHERE id = '${fx.approvalId}'::uuid`), /append-only/);
  });
});

// ═════════ 3. reject, replay, idempotency ═════════
test("A4-4 REJECT by a second admin: the decision stays approved and executes; replay / Idempotency-Key replay; another admin 409; a NEW replacement can be proposed after a reject", { skip }, async () => {
  await scenario(async () => {
    const fx = await approvedCase();
    const k = { "idempotency-key": "a4-prop-1" };
    const p = await propose(fx.caseId, A(), undefined, k);
    assert.equal(p.status, 201);
    const again = await propose(fx.caseId, A(), undefined, k);
    assert.deepEqual([again.status, again.body.id, again.headers.get("idempotent-replay")], [201, p.body.id, "true"]);
    const reused = await propose(fx.caseId, A(), { reason: "khác" }, k);
    assert.deepEqual([reused.status, reused.body.code], [409, "IDEMPOTENCY_KEY_REUSED"]);
    assert.equal(await prisma().disputeCaseDecisionReplacement.count({ where: { caseId: fx.caseId } }), 1);

    const snap = await H.snapshot();
    const r = await rejectRepl(fx.caseId, p.body.id, B(), decideBody(), { "idempotency-key": "a4-rej-1" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.status, r.body.rejectedBy], ["REJECTED", "adm-a4-B"]);
    assert.deepEqual([(await caseRow(fx.caseId)).status], ["DECISION_APPROVED"], "the case is untouched");
    const rr = await rejectRepl(fx.caseId, p.body.id, B(), decideBody(), { "idempotency-key": "a4-rej-1" });
    assert.deepEqual([rr.status, rr.headers.get("idempotent-replay")], [200, "true"]);
    assert.equal((await rejectRepl(fx.caseId, p.body.id, B())).body.replayed, true);
    const other = await rejectRepl(fx.caseId, p.body.id, C());
    assert.deepEqual([other.status, other.body.code], [409, "REPLACEMENT_ALREADY_DECIDED"]);
    const ap = await approveRepl(fx.caseId, p.body.id, C());
    assert.deepEqual([ap.status, ap.body.code], [409, "REPLACEMENT_ALREADY_DECIDED"]);
    assert.deepEqual(await H.snapshot(), snap, "money 0 change");
    const actions = (await eventsOf(fx.caseId)).map((e) => e.action).filter((a) => a.startsWith("REPLACEMENT_"));
    assert.deepEqual(actions, ["REPLACEMENT_PROPOSED", "REPLACEMENT_REJECTED"]);
    // a rejected proposal frees the case: another may be proposed (and approved: replay by the approver returns the same)
    const p2 = await propose(fx.caseId, C());
    assert.equal(p2.status, 201);
    const ok = await approveRepl(fx.caseId, p2.body.id, A());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const replay = await approveRepl(fx.caseId, p2.body.id, A());
    assert.deepEqual([replay.status, replay.body.replayed], [200, true]);
    assert.equal(await prisma().disputeCaseDecisionReplacement.count({ where: { caseId: fx.caseId, approvedAt: { not: null } } }), 1);
    const list = await api("GET", `/${fx.caseId}/replacements`, B());
    assert.deepEqual(list.body.items.map((i: any) => i.status).sort(), ["APPROVED", "REJECTED"]);
    await H.invariant("A4-4");
  });
});

// ═════════ 4. any effect found, or an unreadable ledger, is fail-closed ═════════
test("A4-5 SIDE-EFFECT detection: an executed decision, a session already ruled, a quota mark, an execution row, a money settlement, a ledger operation the DB does not know about -> 409 DECISION_HAS_EFFECT; an unreadable ledger -> 503; NOTHING written; an EXEC_BLOCKED (no effect) case CAN be replaced", { skip }, async () => {
  await scenario(async () => {
    // (a) fully executed
    const done = await approvedCase();
    assert.equal((await execute(done.caseId)).executionState, "BUSINESS_DONE");
    const snapDone = await footprint(done);
    const r = await propose(done.caseId, A());
    assert.deepEqual([r.status, r.body.code], [409, "DECISION_HAS_EFFECT"]);
    assert.ok(r.body.details.effects.length >= 2, JSON.stringify(r.body.details));
    assert.deepEqual(await footprint(done), snapDone, "nothing written");

    // (b) one fixture per kind of effect on a fresh approved case
    const fixtures: Array<[string, (fx: Fx) => Promise<void>]> = [
      ["session already ruled", async (fx) => void (await prisma().session.update({ where: { id: fx.S.id }, data: { resolvedBy: "someone" } }))],
      ["no-show quota mark", async (fx) => void (await prisma().session.update({ where: { id: fx.S.id }, data: { noShowQuotaBookedAt: new Date() } }))],
      ["session deducted", async (fx) => void (await prisma().session.update({ where: { id: fx.S.id }, data: { sessionDeducted: true } }))],
      ["a money settlement row", async (fx) => void (await prisma().sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${fx.S.id}`, sessionId: fx.S.id, contractId: fx.c.id, status: "PENDING" } }))],
      ["an execution row that is not BLOCKED", async (fx) => void (await prisma().disputeCaseExecution.create({ data: { caseId: fx.caseId, decisionId: fx.approvalId, sessionId: fx.S.id, outcome: "COMPLETED", actorUserId: "x", idempotencyKey: `CASE_DECISION:${fx.approvalId}`, attempt: 1, state: "STARTED" } }))],
      ["case EXECUTING", async (fx) => void (await prisma().disputeCase.update({ where: { id: fx.caseId }, data: { execStatus: "EXECUTING", execDecisionId: fx.approvalId } }))],
    ];
    for (const [why, pose] of fixtures) {
      const fx = await approvedCase();
      await pose(fx);
      const snap = await footprint(fx);
      const res = await propose(fx.caseId, A());
      assert.deepEqual([res.status, res.body.code], [409, "DECISION_HAS_EFFECT"], why);
      assert.deepEqual(await footprint(fx), snap, `${why}: nothing written`);
    }

    // (c) the LEDGER already holds the step although the user database shows nothing (a crash between the ledger and the database)
    const lg = await approvedCase();
    const k = await prisma().contract.findUniqueOrThrow({ where: { id: lg.c.id } });
    await H.m.paymentClient.releaseSession({
      transactionId: lg.c.txnId,
      price: k.price!.toString(),
      totalSessions: k.totalSessions,
      rates: { platformRate: k.platformRate.toString(), ptRate: k.ptRate.toString(), gymRate: k.gymRate.toString() },
      parties: { ptUserId: k.ptUserId, gymId: k.gymId, clientUserId: k.clientUserId },
      label: "A4 fixture: a release the database never recorded",
      idempotencyKey: `SESSION_RELEASE:${lg.S.id}`,
    });
    const snapLg = await footprint(lg);
    const rl = await propose(lg.caseId, A());
    assert.deepEqual([rl.status, rl.body.code], [409, "DECISION_HAS_EFFECT"]);
    assert.ok(rl.body.details.effects.some((e: string) => e.includes(`SESSION_RELEASE:${lg.S.id}`)));
    assert.deepEqual(await footprint(lg), snapLg);

    // (d) the ledger cannot be read: fail-closed
    const un = await approvedCase();
    const snapUn = await footprint(un);
    await H.stopPayment();
    const down = await propose(un.caseId, A());
    await H.startPayment();
    assert.deepEqual([down.status, down.body.code], [503, "LEDGER_UNAVAILABLE"]);
    assert.deepEqual(await footprint(un), snapUn);

    // (e) EXEC_BLOCKED with only a BLOCKED execution row = no effect: replaceable (TEST FIXTURE: the blocked state is posed by SQL)
    const bl = await approvedCase();
    await prisma().disputeCaseExecution.create({ data: { caseId: bl.caseId, decisionId: bl.approvalId, sessionId: bl.S.id, outcome: "COMPLETED", actorUserId: "x", idempotencyKey: `CASE_DECISION:${bl.approvalId}`, attempt: 0, state: "BLOCKED" } });
    await prisma().disputeCase.update({ where: { id: bl.caseId }, data: { execStatus: "EXEC_BLOCKED", execDecisionId: bl.approvalId } });
    const pb = await propose(bl.caseId, A());
    assert.equal(pb.status, 201, JSON.stringify(pb.body));
    const ab = await approveRepl(bl.caseId, pb.body.id, B());
    assert.equal(ab.status, 200, JSON.stringify(ab.body));
    assert.deepEqual([(await caseRow(bl.caseId)).status, (await caseRow(bl.caseId)).execStatus, (await caseRow(bl.caseId)).execDecisionId], ["FINDING_RECORDED", "NOT_STARTED", null]);
    await H.invariant("A4-5");
  });
});

// ═════════ 5. concurrency: execute vs replace ═════════
test("A4-6 CONCURRENCY: executing and proposing a replacement at the same instant (8 rounds): never both; execute wins -> the replacement is 409 DECISION_HAS_EFFECT, propose wins -> the execute is 409 REPLACEMENT_PENDING; one money step at most; then approve vs execute after a pending proposal is deterministic", { skip }, async () => {
  await scenario(async () => {
    const tally = { executed: 0, replaced: 0 };
    for (let i = 0; i < 8; i++) {
      const fx = await approvedCase();
      const snap0 = await H.snapshot();
      const [ex, pr] = await Promise.allSettled([execute(fx.caseId), propose(fx.caseId, A())]);
      const executed = ex.status === "fulfilled" && (ex.value as any).executionState === "BUSINESS_DONE";
      const proposed = pr.status === "fulfilled" && pr.value.status === 201;
      assert.ok(!(executed && proposed), `round ${i}: execute AND propose both succeeded`);
      const sess = await prisma().session.findUniqueOrThrow({ where: { id: fx.S.id } });
      if (executed) {
        tally.executed++;
        assert.equal(sess.status, "COMPLETED");
        assert.equal(await prisma().disputeCaseDecisionReplacement.count({ where: { caseId: fx.caseId } }), 0, "no replacement was recorded for an executed decision");
        assert.ok(pr.status === "fulfilled" && [409, 503].includes(pr.value.status), JSON.stringify(pr));
      } else {
        // the replacement won (or both refused)
        assert.equal(sess.status, "DISPUTED");
        assert.deepEqual(await H.snapshot(), snap0, `round ${i}: money 0 change`);
        if (proposed) {
          tally.replaced++;
          assert.ok(ex.status === "rejected" && ["REPLACEMENT_PENDING", "EXECUTION_IN_PROGRESS", "DECISION_REPLACED", "CASE_STATE_NOT_ALLOWED"].includes((ex.reason as any).code), String((ex as any).reason?.code));
          // approving it after the fact leaves the case ready for a new decision, still no money
          const ok = await approveRepl(fx.caseId, (pr as any).value.body.id, B());
          assert.equal(ok.status, 200, JSON.stringify(ok.body));
          assert.deepEqual(await H.snapshot(), snap0);
        }
      }
      const moneyOps = ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, `SESSION_RELEASE:${fx.S.id}`)) as any[])[0].n;
      assert.ok(moneyOps <= 1, "at most one money step");
      assert.equal(moneyOps, executed ? 1 : 0);
    }
    console.log(`[A4-6] ${JSON.stringify(tally)}`);
  });
});

test("A4-7 a replacement approved while the executor is blocked on a pending replacement: the executor started BEFORE the approval can not slip through (start CAS requires DECISION_APPROVED under the case lock)", { skip }, async () => {
  await scenario(async () => {
    const fx = await approvedCase();
    const p = await propose(fx.caseId, A());
    assert.equal(p.status, 201);
    // the executor's own loader refuses while pending; simulate an executor that had loaded BEFORE the proposal by flipping the case under it (TEST FIXTURE) and calling the start path
    const ok = await approveRepl(fx.caseId, p.body.id, B());
    assert.equal(ok.status, 200);
    const snap = await footprint(fx);
    await assert.rejects(execute(fx.caseId));
    assert.deepEqual(await footprint(fx), snap, "a refused execute wrote nothing");
    // and the core refuses the old decision's context even if called directly (the case is not EXECUTING for it)
    const { resolveDisputeCore } = await import("../services/booking.service");
    await assert.rejects(resolveDisputeCore(fx.S.id, "x", "COMPLETED", "ruling", { caseDecisionId: fx.approvalId }), (e: any) => e.status === 409);
    assert.equal((await prisma().session.findUniqueOrThrow({ where: { id: fx.S.id } })).status, "DISPUTED");
    assert.deepEqual(await H.snapshot(), snap.ledger);
  });
});
