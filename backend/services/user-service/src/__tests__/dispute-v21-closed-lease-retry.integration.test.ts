/**
 * DISPUTE V2.1 (Ngai 05/11/2026) - A5 CLOSED, C1, C3 (evidence-source retry / backoff / escalation), C4 (lease). BACKEND INTEGRATION over REAL HTTP into the real user-service app
 * (auth-service = TEST FIXTURE "ROLE:id"; payment-service = stub: ledger lookup answers nothing, every WRITE throws; chat evidence client = TEST FIXTURE where a test needs it; the
 * clock is injectable). Session / contract rows are inserted (TEST FIXTURE). Not a browser. Run ALONE (it truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { disputeEvidenceClient } from "../clients/dispute-evidence.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { setAdminAccountLookupForTests } from "../services/dispute-case/admin-account";
import { setClockForTests } from "../services/dispute-case/clock";
import { executionService, defaultExecDeps, type ExecDeps } from "../services/dispute-case/execution.service";
import { runDisputeExecutionSweep } from "../services/dispute-case/execution-sweep.service";
import { admin, approvedCaseFor, caseRow, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
const writeCalls: string[] = [];
let base = "";
let server: any;

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async () => null
        : async () => {
            writeCalls.push(name);
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  const originalVerify = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const [role, id] = header.replace(/^Bearer /, "").split(":");
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  restores.push(() => ((authServiceClient as any).verifyToken = originalVerify));
  setAdminAccountLookupForTests(async () => ({ role: "ADMIN", isActive: true }));
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_case_deadlines, dispute_case_party_notices, dispute_case_agreement_confirmations, dispute_case_agreements, dispute_case_quota_corrections, dispute_case_appeal_consequences, dispute_case_appeals, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  setClockForTests();
  setAdminAccountLookupForTests();
  for (const r of restores) r();
  server?.close();
  await prisma.notification.deleteMany({ where: { entityType: "DISPUTE_CASE" } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  writeCalls.length = 0;
  setClockForTests();
  disableExecutionFlags();
  enableExecutionFlags({ execution: true });
});

async function mkSession(over: { status?: string } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: "DELIVERY_DISPUTE",
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session, ptUserId, clientUserId: contract.clientUserId };
}
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}
const A = (a: { id: string }) => `ADMIN:${a.id}`;
const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({ ...defaultExecDeps(), ...over });

// ═══ A5 + C1 ═════════════════════════════════════════════════════════════════════════════════════════════════════════

test("A5/C1: close-executed (HTTP) - one non-party admin closes a case whose decision was EXECUTED; closing never executes, never releases money, never changes the session; CLOSED never reopens", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const closer = admin();
  const close = (token: string, reason = "Đã thực thi xong") => call("POST", `/admin/dispute-cases/${a.caseId}/close-executed`, token, { reason });

  // an approved decision that was NOT executed cannot be "closed" - closing is never a way to skip it
  const early = await close(A(closer));
  assert.deepEqual([early.status, early.json.code], [409, "DECISION_NOT_EXECUTED"]);
  const detailEarly = (await call("GET", `/admin/dispute-cases/${a.caseId}`, A(closer))).json;
  assert.equal(detailEarly.actions.closeExecuted.code, "DECISION_NOT_EXECUTED");
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal(writeCalls.length, 0);

  const ex = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(admin()), {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  const sessionAfterExec = await sessionRow(s.session.id);
  const settlementsBefore = await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } });
  writeCalls.length = 0;

  assert.equal((await close(`CUSTOMER:${s.clientUserId}`)).status, 403);
  assert.equal((await call("POST", `/admin/dispute-cases/${a.caseId}/close-executed`, A(closer), {})).status, 400, "reason required");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { ptUserId: closer.id } });
  assert.equal((await close(A(closer))).json.code, "CONFLICT_OF_INTEREST");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { ptUserId: s.ptUserId } });

  const done = await close(A(closer));
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual([done.json.closed, done.json.from, done.json.to, done.json.closeReason, done.json.moneyMoved], [true, "DECISION_APPROVED", "CLOSED", "EXECUTED", false]);
  const row = await caseRow(a.caseId);
  assert.deepEqual([row.status, row.closeReason, row.execStatus], ["CLOSED", "EXECUTED", "BUSINESS_DONE"]);
  const after = await sessionRow(s.session.id);
  assert.deepEqual([after.status, after.resolvedByCaseDecisionId, after.sessionDeducted], [sessionAfterExec.status, sessionAfterExec.resolvedByCaseDecisionId, sessionAfterExec.sessionDeducted], "session untouched by the close");
  assert.equal(await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } }), settlementsBefore, "no settlement row");
  assert.equal(writeCalls.length, 0, "no payment write");
  const evt = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: a.caseId, action: "CASE_CLOSED_EXECUTED" } });
  assert.deepEqual([evt.actorUserId, evt.fromStatus, evt.toStatus], [closer.id, "DECISION_APPROVED", "CLOSED"]);
  // the money axis is not declared "done" by closing: the financial view is still the derived one
  assert.equal((await call("GET", `/admin/dispute-cases/${a.caseId}`, A(closer))).json.financial.derived, true);

  // CLOSED is final: no second close, no transition, no execute, no reopen
  assert.equal((await close(A(admin()))).json.code, "CASE_STATE_NOT_ALLOWED");
  assert.equal((await call("POST", `/admin/dispute-cases/${a.caseId}/transition`, A(closer), { to: "COLLECTING" })).json.code, "CASE_STATE_NOT_ALLOWED");
  const reexec = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(admin()), {});
  assert.equal(reexec.status, 409);
  assert.equal((await caseRow(a.caseId)).status, "CLOSED");
});

test("A5: orphan and NOT_A_DISPUTE close to CLOSED (never REJECTED_INTAKE), a CLOSED case is never replaced by a new one for the same session, and a real intake rejection stays REJECTED_INTAKE", async () => {
  const s = await mkSession();
  const P = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "COLLECTING" });
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "ASSESSING" });
  await call("POST", `/admin/dispute-cases/${caseId}/findings`, A(P), { finding: "NOT_A_DISPUTE", reasoning: "Khách rút khiếu nại" });
  const closed = await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(P), { reason: "Khách rút khiếu nại" });
  assert.deepEqual([closed.json.to, closed.json.closeReason], ["CLOSED", "NOT_A_DISPUTE"]);
  // E2 (Ngai, 05/11): the session is still DISPUTED, so it may get exactly ONE new case through the normal path (the link to the closed case is audited) - never a loop
  const again = await call("POST", "/admin/dispute-cases", A(admin()), { sessionId: s.session.id });
  assert.equal(again.status < 300, true, JSON.stringify(again.json));
  assert.deepEqual([again.json.created, again.json.case.previousCaseId], [true, caseId]);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 2);
  await prisma.disputeCase.update({ where: { id: again.json.case.id }, data: { status: "CLOSED", closeReason: "NOT_A_DISPUTE" } }); // TEST FIXTURE: the second case is also closed NOT_A_DISPUTE
  const third = await call("POST", "/admin/dispute-cases", A(admin()), { sessionId: s.session.id });
  assert.deepEqual([third.status, third.json.code], [409, "CASE_CLOSED_NO_REOPEN"]);
  assert.equal(third.json.details.closeReason, "NOT_A_DISPUTE");
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 2);

  // orphan
  const s2 = await mkSession();
  const c2 = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s2.session.id })).json.case.id;
  await prisma.session.update({ where: { id: s2.session.id }, data: { status: "CANCELLED", cancelledBy: "ADMIN" } });
  const orphan = await call("POST", `/admin/dispute-cases/${c2}/close-orphan`, A(admin()), { reason: "Buổi đã được phán qua đường cũ" });
  assert.deepEqual([orphan.json.to, orphan.json.closeReason], ["CLOSED", "ORPHAN_SESSION_LEFT_DISPUTE"]);

  // a REAL intake rejection keeps REJECTED_INTAKE
  const s3 = await mkSession();
  const c3 = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s3.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${c3}/transition`, A(P), { to: "REJECTED_INTAKE", reason: "Không đủ căn cứ" });
  const r3 = await caseRow(c3);
  assert.deepEqual([r3.status, r3.closeReason], ["REJECTED_INTAKE", "INTAKE_REJECTED"]);

  // "open case" filters (late-open / contract-payout / the one-open-per-session index) treat CLOSED as closed
  const openFilter = { status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] as any } };
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: { in: [s.session.id, s2.session.id, s3.session.id] }, ...openFilter } }), 0);
  await prisma.disputeCase.create({ data: { sessionId: s2.session.id, contractId: s2.contract.id, clientUserId: s2.clientUserId, ptUserId: s2.ptUserId, type: "PT_DELIVERY", status: "INTAKE", createdBy: P.id } });
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s2.session.id, ...openFilter } }), 1, "the unique index allows one open case next to a CLOSED one");
});

// ═══ C3 ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("C3: an unreadable evidence source is counted, backed off (30/60/120/240/480 s) and ESCALATED after 5 attempts with the responsible admin named; success ends the streak", async () => {
  const saved = disputeEvidenceClient.getCallSessions;
  const savedFlag = process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED;
  delete process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED;
  const chat = { down: false };
  (disputeEvidenceClient as any).getCallSessions = async () => {
    if (chat.down) throw new Error("connect ECONNREFUSED");
    return [{ id: "call-1", status: "ENDED", startedAt: "2026-11-02T01:00:00.000Z", answeredAt: null, endedAt: null, endReason: null, callerId: "u1", calleeId: "u2", origin: "test" }];
  };
  try {
    const s = await mkSession();
    const P = admin();
    const caseId = (await (await import("../services/dispute-case/dispute-case.service")).disputeCaseService.openCase(P, s.session.id)).result.case.id;
    const svc = (await import("../services/dispute-case/dispute-case.service")).disputeCaseService;
    await svc.assign(P, caseId, undefined);
    await svc.transition(P, caseId, "COLLECTING", {});
    const claim = await svc.addClaim(P, caseId, { claimantRole: "CLIENT", text: "PT không có mặt", moves: ["MONEY"] });
    await svc.transition(P, caseId, "ASSESSING", {});
    const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
    await svc.addAssessment(P, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" });
    await svc.recordFinding(P, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "ok" });
    await svc.propose(P, caseId, undefined);

    chat.down = true;
    const approver = admin();
    const approve = () => call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(approver), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
    const wait = [30, 60, 120, 240, 480, 480];
    for (let i = 1; i <= 6; i++) {
      const r = await approve();
      assert.deepEqual([r.status, r.json.code], [503, "EVIDENCE_SOURCE_UNAVAILABLE"], `attempt ${i}`);
      const d = r.json.details;
      assert.equal(d.retryable, true);
      assert.deepEqual([d.attempt, d.retryAfterSeconds, d.maxAttempts, d.responsibleAdminId], [i, wait[i - 1], 5, P.id], `attempt ${i}`);
      assert.equal(d.escalated, i >= 5, `escalated at attempt ${i}`);
    }
    const row = await caseRow(caseId);
    assert.equal(row.escalated, true);
    assert.equal(row.status, "AWAITING_APPROVAL", "fail-closed the whole time");
    assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "EVIDENCE_SOURCE_UNAVAILABLE" } }), 6);
    assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "EVIDENCE_SOURCE_ESCALATED" } }), 1, "escalated ONCE per streak");
    assert.ok(await prisma.notification.findFirst({ where: { userId: P.id, entityType: "DISPUTE_CASE", entityId: caseId, text: { contains: "chuyển cấp" } } }), "the responsible admin was told");

    chat.down = false;
    const ok = await approve();
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    // the streak is over: nothing of it counts against a later outage
    assert.equal((await caseRow(caseId)).status, "DECISION_APPROVED");
  } finally {
    (disputeEvidenceClient as any).getCallSessions = saved;
    if (savedFlag === undefined) process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED = "true";
    else process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED = savedFlag;
  }
});

// ═══ C4 ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

const crash = () => new Error("simulated process death");

test("C4: two runners on one crashed EXECUTING case - exactly ONE re-enters the core (the other gets LEASE_HELD); quota and settlement exactly once; the lease is freed", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterExecutingCas: async () => Promise.reject(crash()) })), /simulated process death/);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");

  let entered!: () => void;
  const enteredP = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const real = defaultExecDeps().resolveCore;
  const slow = deps({ resolveCore: (async (...args: Parameters<typeof real>) => {
    entered();
    await gate;
    return real(...args);
  }) as typeof real });

  const first = executionService.reconcileExecution(admin(), a.caseId, slow);
  await enteredP; // the first runner is INSIDE the core, holding the lease
  const second = await executionService.reconcileExecution(admin(), a.caseId, deps());
  assert.equal(second.action, "LEASE_HELD");
  const viaSweep = await runDisputeExecutionSweep({ staleMs: 0 });
  assert.equal(viaSweep.results.filter((r) => r.caseId === a.caseId && (r.result as any).action === "RERAN_CORE").length, 0, "the sweep does not re-enter either");
  release();
  const r1 = await first;
  assert.equal(r1.action, "RERAN_CORE");

  const row = await caseRow(a.caseId);
  assert.deepEqual([row.execStatus, row.execLeaseOwner, row.execLeaseUntil], ["BUSINESS_DONE", null, null]);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1, "quota once");
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), 1, "one settlement intent");
  assert.equal((await executionService.reconcileExecution(admin(), a.caseId, deps())).action, "NOTHING_TO_RECONCILE", "replay does nothing");
  assert.equal(await prisma.disputeCaseExecution.count({ where: { caseId: a.caseId, state: "BUSINESS_DONE" } }), 1);
});

test("C4: a lease left by a dead runner blocks others until it EXPIRES (injectable clock), then the next runner re-reads the real state and finishes exactly once; many concurrent runners still make one effect", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterExecutingCas: async () => Promise.reject(crash()) })), /simulated process death/);
  const t0 = new Date();
  setClockForTests(() => t0);
  // a runner took the lease and died: the lease row says so
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { execLeaseOwner: "dead-runner", execLeaseUntil: new Date(t0.getTime() + 120_000) } });
  assert.equal((await executionService.reconcileExecution(admin(), a.caseId, deps())).action, "LEASE_HELD");
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0, "nothing ran while the lease was valid");

  // 3 minutes later the lease is expired; five runners race: the real state decides (one wins the lease, the core's CAS allows one ruling)
  setClockForTests(() => new Date(t0.getTime() + 180_000));
  const results = await Promise.all(Array.from({ length: 5 }, () => executionService.reconcileExecution(admin(), a.caseId, deps()).catch((e) => ({ action: `ERR:${e.code}` }))));
  const actions = results.map((r: any) => r.action);
  assert.equal(actions.filter((x) => x === "RERAN_CORE").length, 1, JSON.stringify(actions));
  assert.ok(actions.every((x) => ["RERAN_CORE", "LEASE_HELD", "NOTHING_TO_RECONCILE"].includes(x)), JSON.stringify(actions));
  assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1, "no double quota");
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), 1, "no double intent");
  assert.equal((await sessionRow(s.session.id)).status, "COMPLETED");
});

test("C4: a crash AFTER the core returned (before BUSINESS_DONE) is finished by the lease holder from the real state - no second ruling, no second quota", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterCore: async () => Promise.reject(crash()) })), /simulated process death/);
  const usedAfterCrash = (await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions;
  assert.equal(usedAfterCrash, 1);
  const rs = await Promise.all([executionService.reconcileExecution(admin(), a.caseId, deps()), executionService.reconcileExecution(admin(), a.caseId, deps())]);
  assert.equal(rs.filter((r: any) => r.action === "BUSINESS_DONE").length, 1, JSON.stringify(rs.map((r: any) => r.action)));
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1);
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), 1);
  assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
});
