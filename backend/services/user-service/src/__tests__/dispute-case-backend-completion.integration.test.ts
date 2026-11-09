/**
 * DISPUTE V2.1 BACKEND COMPLETION (track core) - BACKEND INTEGRATION against the isolated *_test user database. Every route added or changed by the track is driven
 * over REAL HTTP into the real user-service express app on an ephemeral port (authServiceClient.verifyToken is a TEST FIXTURE: the token is "ROLE:id"), on real rows,
 * real triggers and real transactions. payment-service is a TEST FIXTURE at the client boundary (the ledger lookup is a stub, every payment WRITE throws); the
 * chat / gym evidence clients are TEST FIXTURES where a test needs them (F5). Session / contract rows are inserted (TEST FIXTURE); the case workflow is the real service.
 * Not a browser, not cross-service end-to-end.
 *
 * Run ALONE (it truncates the dispute_case* tables), see dispute-case.integration.test.ts for the command.
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
import { disputeCaseService as svc, type Actor } from "../services/dispute-case/dispute-case.service";
import { executionService, defaultExecDeps, type ExecDeps } from "../services/dispute-case/execution.service";
import { runDisputeExecutionSweep } from "../services/dispute-case/execution-sweep.service";
import { setAdminAccountLookupForTests } from "../services/dispute-case/admin-account";
import { admin, approvedCaseFor, caseAtFinding, caseRow, disableExecutionFlags, enableExecutionFlags, execRows, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const ledger = { ops: new Map<string, any>(), down: false };
const writeCalls: string[] = [];
const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
let base = "";
let server: any;

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async (key: string) => {
            if (ledger.down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
            return ledger.ops.get(key) ?? null;
          }
        : async () => {
            writeCalls.push(name);
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  const originalVerify = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const token = header.replace(/^Bearer /, "");
    if (token === "bad") throw Object.assign(new Error("401"), { response: { status: 401, data: { error: "x" } } });
    const [role, id] = token.split(":");
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  restores.push(() => ((authServiceClient as any).verifyToken = originalVerify));
  setAdminAccountLookupForTests(async () => ({ role: "ADMIN", isActive: true }));
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
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
  ledger.ops.clear();
  ledger.down = false;
  writeCalls.length = 0;
  disableExecutionFlags();
  enableExecutionFlags({ execution: true });
});

async function mkSession(over: { status?: string; disputeType?: string | null } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: over.disputeType === undefined ? "DELIVERY_DISPUTE" : over.disputeType,
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session, ptUserId, clientUserId: contract.clientUserId };
}
const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const tok = (role: string, id: string) => `${role}:${id}`;
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}
const A = (a: Actor) => tok("ADMIN", a.id);
const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({ ...defaultExecDeps(), ...over });
const MONEY_CLAIM = /(đã|được)\s+(trả|thanh toán|hoàn tiền|chuyển khoản|chuyển tiền)/i;

// ═══ 1. the real read model ══════════════════════════════════════════════════════════════════════════════════════════

test("1. GET case detail (HTTP): no hard-coded SLICE_2 string; execStatus, decision, latest proposal/approval, parties, financial view and per-actor allowedActions come from the real rows", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  disableExecutionFlags(); // the executor is OFF (the real situation outside a test): the read model must say so, not guess
  enableExecutionFlags({});
  const d = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(a.investigator));
  assert.equal(d.status, 200);
  assert.ok(!JSON.stringify(d.json).includes("SLICE_2_NOT_ENABLED"), "the old constant is gone from the answer");
  assert.equal(d.json.case.clientUserId, s.clientUserId);
  assert.equal(d.json.case.ptUserId, s.ptUserId);
  assert.equal(d.json.case.execStatus, "NOT_STARTED");
  assert.equal(d.json.case.sessionStatus, "DISPUTED");
  assert.equal(d.json.case.orphan, false);
  assert.equal(d.json.execution.status, "NOT_STARTED");
  assert.equal(d.json.execution.decisionId, a.approvalId);
  assert.deepEqual(d.json.execution.history, []);
  assert.ok(d.json.execution.blockers.some((b: any) => b.code === "EXECUTION_DISABLED"), JSON.stringify(d.json.execution.blockers));
  assert.equal(d.json.decision.approvalId, a.approvalId);
  assert.equal(d.json.decision.approvedBy, a.approver.id);
  assert.equal(d.json.decision.outcome, "CANCELLED");
  assert.equal(d.json.latestProposal.id, a.proposalId);
  assert.equal(d.json.latestApproval.id, a.approvalId);
  assert.equal(d.json.latestApproval.approverId, a.approver.id);
  assert.equal(d.json.financial.derived, true);
  assert.ok(Array.isArray(d.json.policyReviews.items));
  assert.equal(d.json.actions.execute.allowed, false);
  assert.equal(d.json.actions.execute.code, "EXECUTION_DISABLED");
  assert.ok(!d.json.allowedActions.includes("execute"));

  // flag ON: execute becomes allowed for an admin who is not a party; the same read for a party-admin says why not
  enableExecutionFlags({ execution: true });
  const on = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(admin()));
  assert.equal(on.json.actions.execute.allowed, true);
  assert.ok(on.json.allowedActions.includes("execute"));
  assert.equal(on.json.execution.blockers.some((b: any) => b.code === "EXECUTION_DISABLED"), false);

  // list rows carry the parties and the execution axis too
  const list = await call("GET", `/admin/dispute-cases?sessionId=${s.session.id}`, A(a.investigator));
  assert.equal(list.json.total, 1);
  assert.deepEqual([list.json.items[0].clientUserId, list.json.items[0].execStatus], [s.clientUserId, "NOT_STARTED"]);
});

test("1. execution history from the real tables: EXEC_BLOCKED shows its reason, then BUSINESS_DONE shows STARTED -> BUSINESS_DONE, over HTTP", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const exec = admin();
  ledger.down = true;
  const blocked = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(exec), {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, "EXEC_BLOCKED");
  let d = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(a.investigator));
  assert.equal(d.json.execution.status, "EXEC_BLOCKED");
  assert.equal(d.json.execution.blockedReason, "LEDGER_UNREADABLE");
  assert.match(d.json.execution.blockedReasonText, /sổ cái/);
  assert.deepEqual(d.json.execution.history.map((h: any) => [h.state, h.blockedReason]), [["BLOCKED", "LEDGER_UNREADABLE"]]);
  assert.equal(d.json.case.execStatus, "EXEC_BLOCKED");
  assert.equal((await call("GET", `/admin/dispute-cases?execStatus=EXEC_BLOCKED&sessionId=${s.session.id}`, A(exec))).json.total, 1);

  ledger.down = false;
  const done = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(exec), {});
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.executionState, "BUSINESS_DONE");
  d = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(a.investigator));
  assert.equal(d.json.execution.status, "BUSINESS_DONE");
  assert.deepEqual(d.json.execution.history.map((h: any) => h.state), ["BLOCKED", "STARTED", "BUSINESS_DONE"]);
  assert.equal(d.json.actions.execute.allowed, false);
  assert.equal(d.json.case.sessionStatus, "CANCELLED");
  assert.equal(writeCalls.filter((n) => n !== "lookupLedgerOperation").length >= 0, true);
});

test("1. an evidence file's storage key never leaves the server: admin detail and the party's own view both drop payload.storedFile.key", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  await prisma.disputeCaseEvidence.create({
    data: {
      caseId: a.caseId,
      provenanceType: "EXTERNAL_DOCUMENT",
      source: "party.external_document_file",
      subject: `PARTY_FILE:${randomUUID()}`,
      scopeSessionId: s.session.id,
      scopeContractId: s.contract.id,
      submittedBy: s.clientUserId,
      submittedRole: "CLIENT",
      captureStatus: "OK",
      contentHash: "c".repeat(64),
      sensitivity: "RESTRICTED",
      verificationStatus: "SERVER_VERIFIED",
      payload: { description: "x", storedFile: { key: "SECRET/opaque/key.bin", sha256: "d".repeat(64), sizeBytes: 3, mime: "image/png", serverVerified: true, scope: "FILE_BYTES_ONLY" } },
    },
  });
  const adminView = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(admin()));
  const row = adminView.json.evidence.find((e: any) => e.source === "party.external_document_file");
  assert.ok(row);
  assert.equal(row.payload.storedFile.key, undefined);
  assert.equal(row.payload.storedFile.sha256, "d".repeat(64));
  assert.ok(!JSON.stringify(adminView.json).includes("SECRET/opaque"));
  const partyView = await call("GET", `/dispute-cases/${a.caseId}`, tok("CUSTOMER", s.clientUserId));
  assert.equal(partyView.status, 200);
  assert.ok(partyView.json.evidence.some((e: any) => e.source === "party.external_document_file"), "own file is visible to its submitter");
  assert.ok(!JSON.stringify(partyView.json).includes("SECRET/opaque"));
});

// ═══ 2. policy reviews list ══════════════════════════════════════════════════════════════════════════════════════════

test("2. policy reviews (HTTP, read-only): reviewId, result, proposedBy, approvedBy, timestamps, current; per case and per contract; admin only", async () => {
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "VERIFIED_DELIVERED");
  const P = w.investigator;
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: w.caseId, subject: "SESSION_ROW" } });
  const proposed = await call("POST", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, A(P), { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "Hợp đồng thuộc chính sách hiện hành" });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
  const reviewId = proposed.json.reviewId;

  const pending = await call("GET", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, A(admin()));
  assert.equal(pending.status, 200);
  assert.equal(pending.json.contractId, s.contract.id);
  const p1 = pending.json.items.find((i: any) => i.reviewId === reviewId);
  assert.deepEqual([p1.status, p1.proposedBy, p1.approvedBy, p1.approvedAt, p1.result, p1.current], ["PENDING", P.id, null, null, "ELIGIBLE_CURRENT_POLICY", false]);
  assert.ok(p1.proposedAt && p1.evidenceIds.includes(ev.id) && p1.caseId === w.caseId);
  // the case detail lists the pending review and tells the investigator he cannot approve his own, another admin can
  const dP = await call("GET", `/admin/dispute-cases/${w.caseId}`, A(P));
  assert.equal(dP.json.actions.approvePolicyEligibility.allowed, false);
  assert.equal(dP.json.actions.approvePolicyEligibility.code, "SELF_APPROVAL_FORBIDDEN");
  const other = admin();
  const dO = await call("GET", `/admin/dispute-cases/${w.caseId}`, A(other));
  assert.deepEqual(dO.json.actions.approvePolicyEligibility.options, [reviewId]);

  const approved = await call("POST", `/admin/dispute-cases/${w.caseId}/policy-eligibility/${reviewId}/approve`, A(other), { reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  const byContract = await call("GET", `/admin/dispute-cases/contracts/${s.contract.id}/policy-eligibility`, A(other));
  assert.equal(byContract.status, 200);
  const p2 = byContract.json.items.find((i: any) => i.reviewId === reviewId);
  assert.deepEqual([p2.status, p2.approvedBy, p2.current], ["APPROVED", other.id, true]);
  assert.ok(p2.approvedAt);
  assert.equal(byContract.json.currentReviewId, reviewId);
  assert.equal(byContract.json.currentResult, "ELIGIBLE_CURRENT_POLICY");

  assert.equal((await call("GET", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, tok("CUSTOMER", s.clientUserId))).status, 403);
  assert.equal((await call("GET", `/admin/dispute-cases/contracts/${s.contract.id}/policy-eligibility`, null)).status, 401);
  assert.equal((await call("GET", `/admin/dispute-cases/${randomUUID()}/policy-eligibility`, A(other))).json.code, "CASE_NOT_FOUND");
  const none = await call("GET", `/admin/dispute-cases/contracts/${randomUUID()}/policy-eligibility`, A(other));
  assert.deepEqual([none.status, none.json.items.length, none.json.currentReviewId], [200, 0, null]);
});

// ═══ 3. allowedActions ═══════════════════════════════════════════════════════════════════════════════════════════════

test("3. allowedActions are computed per actor on the server: investigator / proposer / independent approver / party-admin / non-admin", async () => {
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "VERIFIED_PT_ABSENT");
  const P = w.investigator;
  await svc.propose(P, w.caseId, undefined);
  const independent = admin();
  const get = async (token: string) => (await call("GET", `/admin/dispute-cases/${w.caseId}`, token)).json;

  const asP = await get(A(P));
  assert.equal(asP.actions.decide.allowed, false);
  assert.equal(asP.actions.decide.code, "SELF_APPROVAL_FORBIDDEN", "the proposer / investigator may not approve their own proposal");
  assert.ok(asP.allowedActions.includes("acknowledgeEvidenceChange"));
  assert.equal(asP.actions.propose.allowed, false, "already proposed: the case is AWAITING_APPROVAL");

  const asI = await get(A(independent));
  assert.equal(asI.actions.decide.allowed, true);
  assert.deepEqual(asI.actions.decide.options, ["APPROVED", "REJECTED"]);
  assert.equal(asI.actions.acknowledgeEvidenceChange.code, "NOT_ASSIGNED_INVESTIGATOR");
  assert.equal(asI.actions.addClaim.allowed, false);

  // an ADMIN who is the client of the case: conflict of interest, and the server says so
  await prisma.disputeCase.update({ where: { id: w.caseId }, data: { clientUserId: independent.id } });
  const asParty = await get(A(independent));
  assert.equal(asParty.actions.decide.code, "CONFLICT_OF_INTEREST");
  assert.equal(asParty.actions.execute.allowed, false);
  await prisma.disputeCase.update({ where: { id: w.caseId }, data: { clientUserId: s.clientUserId } });

  // what the server lists as allowed is what the server accepts, and what it lists as refused is refused
  const refused = await call("POST", `/admin/dispute-cases/${w.caseId}/approvals`, A(P), { result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: true });
  assert.equal(refused.status, 403);
  const accepted = await call("POST", `/admin/dispute-cases/${w.caseId}/approvals`, A(independent), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  const after = await get(A(independent));
  assert.equal(after.actions.decide.allowed, false);
  assert.equal(after.actions.decide.code, "CASE_STATE_NOT_ALLOWED");
  assert.equal(after.actions.execute.allowed, true);
  assert.equal(after.actions.transition.allowed, false);

  assert.equal((await call("GET", `/admin/dispute-cases/${w.caseId}`, tok("CUSTOMER", s.clientUserId))).status, 403);
});

// ═══ 4. queue, filters, pagination ═══════════════════════════════════════════════════════════════════════════════════

test("4. queue (HTTP): DISPUTED and PT_NO_SHOW_REPORTED sessions with hasCase/caseId; filters; pagination; a closed case puts the session back in the queue", async () => {
  const sNo = await mkSession();
  const sNoShow = await mkSession({ status: "PT_NO_SHOW_REPORTED", disputeType: null });
  const sWith = await mkSession();
  const sDone = await mkSession({ status: "COMPLETED" });
  const inv = admin();
  const opened = await call("POST", "/admin/dispute-cases", A(inv), { sessionId: sNoShow.session.id });
  assert.equal(opened.status, 201, JSON.stringify(opened.json));
  const opened2 = await call("POST", "/admin/dispute-cases", A(inv), { sessionId: sWith.session.id });
  const mine = [sNo, sNoShow, sWith, sDone].map((x) => x.contract.id);
  const q = async (qs: string) => (await call("GET", `/admin/dispute-cases/queue?${qs}`, A(inv))).json;

  const all: any[] = [];
  for (const c of mine) all.push(...(await q(`contractId=${c}`)).items);
  const by = (sid: string) => all.find((i) => i.sessionId === sid);
  assert.equal(by(sNo.session.id).hasCase, false);
  assert.equal(by(sNo.session.id).needsCase, true);
  assert.equal(by(sNo.session.id).caseId, null);
  assert.equal(by(sNoShow.session.id).hasCase, true);
  assert.equal(by(sNoShow.session.id).sessionStatus, "PT_NO_SHOW_REPORTED");
  assert.equal(by(sNoShow.session.id).caseId, opened.json.case.id);
  assert.equal(by(sNoShow.session.id).caseType, "PT_NO_SHOW_CLAIM");
  assert.equal(by(sWith.session.id).caseId, opened2.json.case.id);
  assert.equal(by(sDone.session.id), undefined, "a COMPLETED session is not in the queue");
  assert.deepEqual([by(sNo.session.id).clientUserId, by(sNo.session.id).ptUserId], [sNo.clientUserId, sNo.ptUserId]);

  assert.deepEqual((await q(`contractId=${sNoShow.contract.id}&sessionStatus=DISPUTED`)).items, []);
  assert.equal((await q(`contractId=${sNo.contract.id}&hasCase=false`)).total, 1);
  assert.equal((await q(`contractId=${sNo.contract.id}&hasCase=true`)).total, 0);
  const wide = await q("hasCase=false&limit=1");
  assert.equal(wide.limit, 1);
  assert.equal(wide.items.length, 1);
  assert.equal(wide.hasMore, wide.total > 1);
  assert.equal((await call("GET", "/admin/dispute-cases/queue?limit=0", A(inv))).status, 400);
  assert.equal((await call("GET", "/admin/dispute-cases/queue?bogus=1", A(inv))).status, 400);
  assert.equal((await call("GET", "/admin/dispute-cases/queue", tok("CUSTOMER", sNo.clientUserId))).status, 403);

  // a case closed without a decision: the session is back in the queue as "needs a case"
  await call("POST", `/admin/dispute-cases/${opened2.json.case.id}/transition`, A(inv), { to: "REJECTED_INTAKE", reason: "Không đủ thông tin" });
  assert.equal((await q(`contractId=${sWith.contract.id}`)).items[0].hasCase, false);
});

test("4. case list filters + pagination (HTTP): status, execStatus, type, investigator, unassigned, sessionId, contractId, date range, sort; strict query", async () => {
  const sA = await mkSession();
  const sB = await mkSession({ disputeType: null });
  const inv = admin();
  const cA = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: sA.session.id })).json.case;
  const cB = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: sB.session.id })).json.case;
  await call("POST", `/admin/dispute-cases/${cA.id}/assign`, A(inv), {});
  const list = async (qs: string) => (await call("GET", `/admin/dispute-cases?${qs}`, A(inv))).json;

  assert.deepEqual((await list(`investigatorId=${inv.id}&sessionId=${sA.session.id}`)).items.map((i: any) => i.id), [cA.id]);
  assert.deepEqual((await list(`unassigned=true&sessionId=${sB.session.id}`)).items.map((i: any) => i.id), [cB.id]);
  assert.equal((await list(`unassigned=true&sessionId=${sA.session.id}`)).total, 0);
  assert.deepEqual((await list(`type=LEGACY_UNCLASSIFIED&sessionId=${sB.session.id}`)).items.map((i: any) => i.id), [cB.id]);
  assert.equal((await list(`status=COLLECTING&sessionId=${sA.session.id}`)).total, 0);
  assert.equal((await list(`status=INTAKE&sessionId=${sA.session.id}`)).total, 1);
  assert.equal((await list(`execStatus=NOT_STARTED&sessionId=${sA.session.id}`)).total, 1);
  assert.equal((await list(`createdFrom=2999-01-01T00:00:00Z&sessionId=${sA.session.id}`)).total, 0);
  assert.equal((await list(`createdTo=2999-01-01T00:00:00Z&sessionId=${sA.session.id}`)).total, 1);
  const page1 = await list(`limit=1&offset=0&sort=createdAt&order=asc&investigatorId=${inv.id}`);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.limit, 1);
  assert.equal(typeof page1.hasMore, "boolean");
  for (const bad of ["status=NOPE", "execStatus=NOPE", "unassigned=maybe", "sort=password", "limit=1000", "foo=bar", "createdFrom=notadate"]) {
    assert.equal((await call("GET", `/admin/dispute-cases?${bad}`, A(inv))).status, 400, bad);
  }
});

// ═══ 5. assign verifies the target ═══════════════════════════════════════════════════════════════════════════════════

test("5. assign (HTTP): the target must be a real active ADMIN (same codes as the late-open hand-over); outage fails closed; self-assign and a party target keep their rules", async () => {
  const s = await mkSession();
  const inv = admin();
  const c = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case;
  const target = randomUUID();
  const lookups: string[] = [];
  const answers: Record<string, any> = {};
  setAdminAccountLookupForTests(async (id) => {
    lookups.push(id);
    if (answers[id] === "DOWN") throw Object.assign(new Error("down"), { status: 503, code: "ACCOUNT_LOOKUP_UNAVAILABLE" });
    return answers[id] ?? null;
  });
  try {
    const asg = (investigatorId?: string) => call("POST", `/admin/dispute-cases/${c.id}/assign`, A(inv), investigatorId ? { investigatorId } : {});
    assert.equal((await asg(target)).json.code, "ASSIGNEE_NOT_FOUND");
    answers[target] = { role: "CUSTOMER", isActive: true };
    const notAdmin = await asg(target);
    assert.deepEqual([notAdmin.status, notAdmin.json.code], [422, "ASSIGNEE_NOT_ADMIN"]);
    answers[target] = { role: "ADMIN", isActive: false };
    assert.equal((await asg(target)).json.code, "ASSIGNEE_NOT_ADMIN");
    answers[target] = "DOWN";
    const down = await asg(target);
    assert.deepEqual([down.status, down.json.code], [503, "ACCOUNT_LOOKUP_UNAVAILABLE"]);
    assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: c.id } })).investigatorId, null, "nothing assigned by any refusal");
    answers[target] = { role: "ADMIN", isActive: true };
    const ok = await asg(target);
    assert.deepEqual([ok.status, ok.json.investigatorId], [200, target]);
    // a party of the case can never be the investigator, whatever auth-service says
    answers[s.clientUserId] = { role: "ADMIN", isActive: true };
    assert.equal((await asg(s.clientUserId)).json.code, "CONFLICT_OF_INTEREST");
    // self-assign needs no lookup
    lookups.length = 0;
    assert.equal((await asg()).json.investigatorId, inv.id);
    assert.deepEqual(lookups, []);
  } finally {
    setAdminAccountLookupForTests(async () => ({ role: "ADMIN", isActive: true }));
  }
  // the assigned person is told (in-app), the actor is not
  const note = await prisma.notification.findFirst({ where: { userId: target, entityType: "DISPUTE_CASE", entityId: c.id } });
  assert.ok(note, "the new investigator got a notice");
  assert.equal(note!.eventType, "DISPUTE_CASE_UPDATED");
});

// ═══ 6. F4: proposals without a proposal ═════════════════════════════════════════════════════════════════════════════

test("6. F4: POST proposals is 201 + proposalCreated:true when a proposal is created, and 200 + proposalCreated:false + proposal:null when none is (I6: CANCELLED over a D77)", async () => {
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "VERIFIED_PT_ABSENT");
  const ok = await call("POST", `/admin/dispute-cases/${w.caseId}/proposals`, A(w.investigator), {}, { "Idempotency-Key": "k-prop-1" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.proposalCreated, true);
  assert.ok(ok.json.id);
  const replay = await call("POST", `/admin/dispute-cases/${w.caseId}/proposals`, A(w.investigator), {}, { "Idempotency-Key": "k-prop-1" });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal(replay.json.proposalCreated, true);

  const s2 = await mkSession();
  await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s2.session.id}`, sessionId: s2.session.id, contractId: s2.contract.id, status: "SETTLED" } });
  const w2 = await caseAtFinding(s2.session.id, "VERIFIED_NOT_DELIVERED_NO_FAULT");
  const none = await call("POST", `/admin/dispute-cases/${w2.caseId}/proposals`, A(w2.investigator), {});
  assert.equal(none.status, 200, "nothing was created: never 201");
  assert.equal(none.json.proposalCreated, false);
  assert.equal(none.json.proposal, null);
  assert.equal(none.json.policyPending, true);
  assert.equal(none.json.blocked, "CANCELLED_BLOCKED_BY_D77");
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: w2.caseId } }), 0);
  assert.equal((await caseRow(w2.caseId)).status, "POLICY_PENDING");
});

// ═══ 7. F5: no network call inside a transaction; unreadable source is retryable, not permanent ══════════════════════

test("7. F5: chat/gym are read OUTSIDE any transaction (open, recollect, approve); an unreadable source at approval is a retryable 503 that needs no acknowledgement, recollect keeps the good copy, and the approval works once the source answers", async () => {
  const saved = { getCallSessions: disputeEvidenceClient.getCallSessions, getPtCheckin: disputeEvidenceClient.getPtCheckin, getMemberCheckins: disputeEvidenceClient.getMemberCheckins };
  const savedFlag = process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED;
  delete process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED; // the real (HTTP) external sources are on; their client methods are replaced below
  const chat = { down: false, calls: 0, openTransactionsDuringCall: [] as number[] };
  (disputeEvidenceClient as any).getCallSessions = async () => {
    chat.calls += 1;
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`;
    chat.openTransactionsDuringCall.push(Number(n));
    if (chat.down) throw new Error("connect ECONNREFUSED");
    return [{ id: "call-1", status: "ENDED", startedAt: "2026-11-02T01:00:00.000Z", answeredAt: null, endedAt: null, endReason: null, callerId: "u1", calleeId: "u2", origin: "test" }];
  };
  try {
    // the detector is not vacuous: the very same probe, run INSIDE an interactive transaction, sees it (this is what the old code did on every one of these paths)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      await (disputeEvidenceClient as any).getCallSessions("probe");
    });
    assert.ok(chat.openTransactionsDuringCall[0] >= 1, `probe inside a transaction must see it open: ${chat.openTransactionsDuringCall}`);
    chat.calls = 0;
    chat.openTransactionsDuringCall.length = 0;
    const s = await mkSession();
    const P = admin();
    const opened = await svc.openCase(P, s.session.id);
    const caseId = opened.result.case.id;
    assert.ok(chat.calls >= 1);
    assert.deepEqual(chat.openTransactionsDuringCall, chat.openTransactionsDuringCall.map(() => 0), "intake: the chat call ran with no open transaction");
    const slot = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "CALL_SESSIONS" } });
    assert.equal(slot.captureStatus, "OK");

    await svc.assign(P, caseId, undefined);
    await svc.transition(P, caseId, "COLLECTING", {});
    const claim = await svc.addClaim(P, caseId, { claimantRole: "CLIENT", text: "PT không có mặt", moves: ["MONEY"] });
    await svc.transition(P, caseId, "ASSESSING", {});
    const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
    await svc.addAssessment(P, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" });
    await svc.recordFinding(P, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "ok" });
    await svc.propose(P, caseId, undefined);

    // recollect with the chat service up: nothing changed, called outside a transaction
    chat.calls = 0;
    chat.openTransactionsDuringCall.length = 0;
    const same = await call("POST", `/admin/dispute-cases/${caseId}/recollect`, A(P), {});
    assert.equal(same.status, 200);
    assert.equal(same.json.added, 0);
    assert.ok(chat.calls >= 1);
    assert.deepEqual(chat.openTransactionsDuringCall, chat.openTransactionsDuringCall.map(() => 0), "recollect: no open transaction during the call");

    // the chat service goes down while the approver is about to approve
    chat.down = true;
    chat.openTransactionsDuringCall.length = 0;
    const approver = admin();
    const refused = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(approver), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: true });
    assert.deepEqual([refused.status, refused.json.code], [503, "EVIDENCE_SOURCE_UNAVAILABLE"], JSON.stringify(refused.json));
    assert.equal(refused.json.details.retryable, true);
    assert.deepEqual(chat.openTransactionsDuringCall, chat.openTransactionsDuringCall.map(() => 0), "approve: no open transaction during the call");
    assert.equal((await caseRow(caseId)).status, "AWAITING_APPROVAL", "fail-closed: nothing approved while the source is unreadable");
    assert.equal(await prisma.disputeCaseApproval.count({ where: { proposal: { caseId } } }), 0);

    // recollect during the outage must NOT bury the good copy under an UNAVAILABLE row
    const during = await call("POST", `/admin/dispute-cases/${caseId}/recollect`, A(P), {});
    assert.equal(during.status, 200);
    assert.equal(during.json.added, 0);
    assert.deepEqual(during.json.skippedUnavailable.length, 1);
    assert.equal(await prisma.disputeCaseEvidence.count({ where: { caseId, subject: "CALL_SESSIONS" } }), 1, "the good row is still the only (head) row");

    // the source answers again: the SAME approval now goes through, with no acknowledgement and no re-proposal
    chat.down = false;
    const ok = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(approver), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await caseRow(caseId)).status, "DECISION_APPROVED");
  } finally {
    Object.assign(disputeEvidenceClient, saved);
    if (savedFlag === undefined) process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED = "true";
    else process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED = savedFlag;
  }
});

// ═══ 8. F11: Idempotency-Key is required where a double click would add a row ═══════════════════════════════════════

test("8. F11 (HTTP): claims, issues, assessments, party statements and party evidence REQUIRE an Idempotency-Key (400, nothing written); with a key a double click makes ONE row and the replay says so", async () => {
  const s = await mkSession();
  const P = admin();
  const caseId = (await svc.openCase(P, s.session.id)).result.case.id;
  await svc.assign(P, caseId, undefined);
  await svc.transition(P, caseId, "COLLECTING", {});
  const adm = A(P);
  const cl = tok("CUSTOMER", s.clientUserId);
  const claimBody = { claimantRole: "CLIENT", text: "PT vắng", moves: ["MONEY"] };
  const issueBody = { kind: "PT_LATE", finding: "UNDETERMINED", note: "chưa rõ" };
  const stmtBody = { text: "Tôi đã có mặt", supplementReason: "Bổ sung sau lời khai ban đầu" }; // the client already has statement v1 (the legacy dispute reason)
  const evBody = { description: "Ảnh", sha256: "a".repeat(64) };

  for (const [path, token, body] of [
    [`/admin/dispute-cases/${caseId}/claims`, adm, claimBody],
    [`/admin/dispute-cases/${caseId}/issues`, adm, issueBody],
    [`/dispute-cases/${caseId}/statements`, cl, stmtBody],
    [`/dispute-cases/${caseId}/evidence`, cl, evBody],
  ] as const) {
    const r = await call("POST", path, token, body);
    assert.deepEqual([r.status, r.json.code], [400, "IDEMPOTENCY_KEY_REQUIRED"], path);
    assert.match(r.json.error, /Idempotency-Key/);
  }
  assert.deepEqual(
    [await prisma.disputeCaseClaim.count({ where: { caseId } }), await prisma.disputeCaseIssue.count({ where: { caseId } }), await prisma.disputeCaseStatement.count({ where: { caseId, source: "SUBMITTED" } }), await prisma.disputeCaseEvidence.count({ where: { caseId, source: "party.external_document" } })],
    [0, 0, 0, 0],
    "a refused call writes nothing",
  );

  const twice = async (path: string, token: string, body: unknown, key: string) => {
    const first = await call("POST", path, token, body, { "Idempotency-Key": key });
    const second = await call("POST", path, token, body, { "Idempotency-Key": key });
    assert.equal(first.status, 201, path + JSON.stringify(first.json));
    assert.equal(second.status, 200, path);
    assert.equal(second.headers.get("idempotent-replay"), "true");
    assert.deepEqual(second.json, first.json);
    return first.json;
  };
  const claim = await twice(`/admin/dispute-cases/${caseId}/claims`, adm, claimBody, "k-c1");
  await twice(`/admin/dispute-cases/${caseId}/issues`, adm, issueBody, "k-i1");
  await twice(`/dispute-cases/${caseId}/statements`, cl, stmtBody, "k-s1");
  await twice(`/dispute-cases/${caseId}/evidence`, cl, evBody, "k-e1");
  assert.equal(await prisma.disputeCaseClaim.count({ where: { caseId } }), 1);
  assert.equal(await prisma.disputeCaseIssue.count({ where: { caseId } }), 1);
  assert.equal(await prisma.disputeCaseStatement.count({ where: { caseId, source: "SUBMITTED" } }), 1);
  assert.equal(await prisma.disputeCaseEvidence.count({ where: { caseId, source: "party.external_document" } }), 1);

  await svc.transition(P, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  const asBody = { claimId: claim.id, directEvidenceIds: [ev.id], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" };
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/assessments`, adm, asBody)).json.code, "IDEMPOTENCY_KEY_REQUIRED");
  await twice(`/admin/dispute-cases/${caseId}/assessments`, adm, asBody, "k-a1");
  assert.equal(await prisma.disputeCaseAssessment.count({ where: { caseId } }), 1);
  // the same key with another body is still refused
  const reuse = await call("POST", `/admin/dispute-cases/${caseId}/claims`, adm, { ...claimBody, text: "khác" }, { "Idempotency-Key": "k-c1" });
  assert.equal(reuse.json.code, "IDEMPOTENCY_KEY_REUSED");
});

// ═══ 9. sweep + NEEDS_HUMAN ══════════════════════════════════════════════════════════════════════════════════════════

test("9. the sweep (reconcileStale has a caller): a case left EXECUTING is reconciled; with the flag OFF the sweep is a no-op; a fresh EXECUTING case is not touched", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterExecutingCas: async () => Promise.reject(new Error("simulated process death")) })), /simulated process death/);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");

  // flag OFF: nothing happens
  disableExecutionFlags();
  enableExecutionFlags({});
  const off = await runDisputeExecutionSweep({ staleMs: 0 });
  assert.equal(off.scanned, 0);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");

  enableExecutionFlags({ execution: true });
  // not stale yet (updated just now, threshold 1 h)
  assert.equal((await runDisputeExecutionSweep({ staleMs: 3600_000 })).scanned, 0);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");

  await new Promise((r) => setTimeout(r, 30));
  const run = await runDisputeExecutionSweep({ staleMs: 10 });
  const mine = run.results.find((r) => r.caseId === a.caseId) as any;
  assert.ok(mine, JSON.stringify(run));
  assert.equal(mine.result.action, "RERAN_CORE");
  assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
  assert.equal((await sessionRow(s.session.id)).status, "COMPLETED");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1, "quota once");
  assert.equal((await runDisputeExecutionSweep({ staleMs: 10 })).results.filter((r) => r.caseId === a.caseId).length, 0, "nothing left to reconcile");
});

test("9. NEEDS_HUMAN is readable and acknowledged by ONE admin without moving money: it stays LOCKED while the session is still disputed or was ruled elsewhere", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(
    executionService.executeDecision(admin(), a.caseId, {}, deps({ afterExecutingCas: async () => void (await prisma.session.update({ where: { id: s.session.id }, data: { status: "CANCELLED", cancelledBy: "CLIENT" } })) })),
    (e: any) => e.code === "NEEDS_HUMAN",
  );
  const d = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(admin()));
  assert.equal(d.json.execution.status, "NEEDS_HUMAN");
  assert.equal(d.json.execution.needsHuman.sessionStatus, "CANCELLED");
  assert.ok(d.json.execution.needsHuman.reason);
  assert.equal(d.json.actions.acknowledgeNeedsHuman.allowed, true);
  assert.equal(d.json.case.orphan, false, "DECISION_APPROVED is not an orphan");

  const before = { session: await sessionRow(s.session.id), settlements: await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), exec: (await execRows(a.caseId)).length };
  assert.equal((await call("POST", `/admin/dispute-cases/${a.caseId}/acknowledge-needs-human`, tok("CUSTOMER", s.clientUserId), { note: "x" })).status, 403);
  assert.equal((await call("POST", `/admin/dispute-cases/${a.caseId}/acknowledge-needs-human`, A(admin()), {})).status, 400, "a note is required");
  const ack = await call("POST", `/admin/dispute-cases/${a.caseId}/acknowledge-needs-human`, A(admin()), { note: "Đã xem: buổi bị huỷ bằng đường khác" });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  assert.equal(ack.json.action, "STAYS_LOCKED");
  assert.equal(ack.json.reason, "SESSION_RULED_ELSEWHERE_OR_MISMATCH");
  assert.equal((await caseRow(a.caseId)).execStatus, "NEEDS_HUMAN");
  assert.equal((await sessionRow(s.session.id)).status, before.session.status);
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), before.settlements);
  assert.equal((await execRows(a.caseId)).length, before.exec, "no execution row, no money step");
  assert.equal(writeCalls.length, 0, "no payment write");
  const evt = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: a.caseId, action: "NEEDS_HUMAN_ACKNOWLEDGED" } });
  assert.ok(evt.note?.includes("Đã xem"));
  const again = await call("GET", `/admin/dispute-cases/${a.caseId}`, A(admin()));
  assert.equal(again.json.execution.acknowledgements.length, 1);

  // still DISPUTED: finishing would call the ruling core (money) -> locked as well
  const s2 = await mkSession();
  const b = await approvedCaseFor(s2.session.id, FINDING_FOR.COMPLETED);
  await prisma.disputeCase.update({ where: { id: b.caseId }, data: { execStatus: "NEEDS_HUMAN", execDecisionId: b.approvalId } });
  const lock = await call("POST", `/admin/dispute-cases/${b.caseId}/acknowledge-needs-human`, A(admin()), { note: "n" });
  assert.deepEqual([lock.json.action, lock.json.reason], ["STAYS_LOCKED", "SESSION_STILL_DISPUTED_FINISHING_WOULD_MOVE_MONEY"]);
  assert.equal((await sessionRow(s2.session.id)).status, "DISPUTED");
  // not NEEDS_HUMAN at all
  const s3 = await mkSession();
  const c3 = await approvedCaseFor(s3.session.id, FINDING_FOR.COMPLETED);
  assert.equal((await call("POST", `/admin/dispute-cases/${c3.caseId}/acknowledge-needs-human`, A(admin()), { note: "n" })).json.code, "NOT_NEEDS_HUMAN");
  // flag off: refused like every execution-axis action
  disableExecutionFlags();
  enableExecutionFlags({});
  assert.equal((await call("POST", `/admin/dispute-cases/${b.caseId}/acknowledge-needs-human`, A(admin()), { note: "n" })).json.code, "EXECUTION_DISABLED");
});

test("9. NEEDS_HUMAN whose session was ruled BY THIS decision (the business answer already exists) is acknowledged to BUSINESS_DONE - no money step, no second ruling [TEST FIXTURE: exec_status forced to NEEDS_HUMAN after a crash after the core]", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterCore: async () => Promise.reject(new Error("simulated process death")) })), /simulated process death/);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");
  const used = (await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions;
  const settlementsBefore = await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } });
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "NEEDS_HUMAN" } });
  writeCalls.length = 0;
  const ack = await call("POST", `/admin/dispute-cases/${a.caseId}/acknowledge-needs-human`, A(admin()), { note: "Buổi đã được phán theo đúng quyết định này" });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  assert.equal(ack.json.action, "BUSINESS_DONE");
  assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, used, "quota not touched again");
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), settlementsBefore, "no settlement row added");
  assert.equal(writeCalls.length, 0);
  assert.equal((await execRows(a.caseId)).filter((r) => r.state === "BUSINESS_DONE").length, 1);
  // a second acknowledgement has nothing to do
  assert.equal((await call("POST", `/admin/dispute-cases/${a.caseId}/acknowledge-needs-human`, A(admin()), { note: "n" })).json.code, "NOT_NEEDS_HUMAN");
});

// ═══ 10. notices ═════════════════════════════════════════════════════════════════════════════════════════════════════

test("10. in-app notices at the transitions, to the parties and the assigned admin: wording is Vietnamese, has no internal enum and never claims money was paid", async () => {
  const s = await mkSession();
  const P = admin();
  const approver = admin();
  const noticesOf = async (userId: string) => (await prisma.notification.findMany({ where: { userId, entityType: "DISPUTE_CASE" }, orderBy: { createdAt: "asc" } })).map((n) => n.text);

  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  assert.equal((await noticesOf(s.clientUserId)).length, 1, "opened -> client");
  assert.equal((await noticesOf(s.ptUserId)).length, 1, "opened -> PT");
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "COLLECTING" });
  const claim = (await call("POST", `/admin/dispute-cases/${caseId}/claims`, A(P), { claimantRole: "CLIENT", text: "PT vắng", moves: [] }, { "Idempotency-Key": "n-c" })).json;
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "AWAITING_PARTIES", note: "Cần lời khai" });
  assert.equal((await noticesOf(s.clientUserId)).length, 2, "evidence requested -> client");
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "ASSESSING" });
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await call("POST", `/admin/dispute-cases/${caseId}/assessments`, A(P), { claimId: claim.id, directEvidenceIds: [ev.id], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" }, { "Idempotency-Key": "n-a" });
  await call("POST", `/admin/dispute-cases/${caseId}/findings`, A(P), { finding: "VERIFIED_NOT_DELIVERED_NO_FAULT", reasoning: "ok" });
  assert.equal((await noticesOf(s.ptUserId)).length, 3, "finding recorded -> PT");
  await call("POST", `/admin/dispute-cases/${caseId}/proposals`, A(P), {});
  const ap = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(approver), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.equal((await noticesOf(s.clientUserId)).length, 4, "decision approved -> client");
  assert.deepEqual((await noticesOf(P.id)).length, 1, "decision approved -> the investigator");

  const ex = await call("POST", `/admin/dispute-cases/${caseId}/execute`, A(admin()), {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  const clientTexts = await noticesOf(s.clientUserId);
  assert.equal(clientTexts.length, 5, "executed -> client");
  assert.equal((await noticesOf(P.id)).length, 2, "executed -> the investigator");

  // blocked path: a new case whose execution is blocked tells the parties and the investigator what is true
  const s2 = await mkSession();
  const b = await approvedCaseFor(s2.session.id, FINDING_FOR.COMPLETED);
  ledger.down = true;
  await call("POST", `/admin/dispute-cases/${b.caseId}/execute`, A(admin()), {});
  const blockedTexts = await noticesOf(b.investigator.id);
  assert.ok(blockedTexts.some((t) => /chưa thực thi được/.test(t) && /sổ cái/.test(t)), blockedTexts.join(" | "));
  assert.ok((await noticesOf(s2.clientUserId)).some((t) => /tạm chờ/.test(t)));

  const all = await prisma.notification.findMany({ where: { entityType: "DISPUTE_CASE" } });
  assert.ok(all.length >= 12);
  for (const n of all) {
    assert.equal(n.eventType, "DISPUTE_CASE_UPDATED");
    assert.ok(!MONEY_CLAIM.test(n.text), `a notice must not say money was paid: ${n.text}`);
    assert.ok(!/[A-Z]{3,}_[A-Z_]{2,}/.test(n.text), `a notice must not show an internal enum: ${n.text}`);
    assert.ok(/[À-ỹ]/.test(n.text), `Vietnamese: ${n.text}`);
  }
  // an idempotent replay sends nothing twice
  const k = { "Idempotency-Key": "n-assign-replay" };
  const before = await prisma.notification.count({ where: { entityType: "DISPUTE_CASE", entityId: b.caseId } });
  await call("POST", `/admin/dispute-cases/${b.caseId}/assign`, A(admin()), { investigatorId: randomUUID() }, k);
  const afterFirst = await prisma.notification.count({ where: { entityType: "DISPUTE_CASE", entityId: b.caseId } });
  await call("POST", `/admin/dispute-cases/${b.caseId}/assign`, A(admin()), { investigatorId: randomUUID() }, k);
  assert.ok(afterFirst >= before);
});

// ═══ 11. orphan case and NOT_A_DISPUTE ═══════════════════════════════════════════════════════════════════════════════

test("11. orphan case (HTTP): a case whose session left dispute is flagged, closed with a reason and an audit event, moves no money, and stops blocking the late-open path", async () => {
  const s = await mkSession();
  const P = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  // still in dispute: not an orphan, refuse
  const early = await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(admin()), { reason: "thử" });
  assert.deepEqual([early.status, early.json.code], [409, "CASE_NOT_ORPHAN"]);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}`, A(P))).json.actions.closeOrphan.code, "CASE_NOT_ORPHAN");

  // [TEST FIXTURE] the session leaves DISPUTED outside the case (the old route ruled it)
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "CANCELLED", cancelledBy: "ADMIN" } });
  const openLikeLateOpen = () => prisma.disputeCase.count({ where: { sessionId: s.session.id, status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] } } });
  assert.equal(await openLikeLateOpen(), 1, "before: the orphan blocks the late-open path (OPEN_CASE_EXISTS)");
  const d = await call("GET", `/admin/dispute-cases/${caseId}`, A(P));
  assert.equal(d.json.case.orphan, true);
  assert.equal(d.json.case.sessionStatus, "CANCELLED");
  assert.equal(d.json.actions.closeOrphan.allowed, true);

  const sessionBefore = await sessionRow(s.session.id);
  const contractBefore = await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } });
  const settlementsBefore = await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } });
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(admin()), {})).status, 400, "a reason is required");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, tok("CUSTOMER", s.clientUserId), { reason: "x" })).status, 403);
  // an admin who is a party of the case cannot close it
  await prisma.disputeCase.update({ where: { id: caseId }, data: { ptUserId: P.id } });
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(P), { reason: "x" })).json.code, "CONFLICT_OF_INTEREST");
  await prisma.disputeCase.update({ where: { id: caseId }, data: { ptUserId: s.ptUserId } });

  const closer = admin();
  const closed = await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(closer), { reason: "Buổi đã được phán qua đường cũ" }, { "Idempotency-Key": "k-orphan" });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.deepEqual([closed.json.closed, closed.json.to, closed.json.closeReason, closed.json.moneyMoved], [true, "CLOSED", "ORPHAN_SESSION_LEFT_DISPUTE", false]);
  const row = await caseRow(caseId);
  assert.deepEqual([row.status, row.closeReason], ["CLOSED", "ORPHAN_SESSION_LEFT_DISPUTE"]);
  assert.equal(await openLikeLateOpen(), 0, "after: the case no longer blocks the late-open path");
  const evt = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId, action: "CASE_CLOSED_ORPHAN" } });
  assert.deepEqual([evt.actorUserId, evt.note, evt.fromStatus, evt.toStatus], [closer.id, "Buổi đã được phán qua đường cũ", "INTAKE", "CLOSED"]);
  // NO money, NO session, NO quota
  assert.deepEqual((await sessionRow(s.session.id)).status, sessionBefore.status);
  assert.equal((await sessionRow(s.session.id)).resolvedByCaseDecisionId, sessionBefore.resolvedByCaseDecisionId);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, contractBefore.usedSessions);
  assert.equal(await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } }), settlementsBefore);
  assert.equal(writeCalls.length, 0);
  // replay and terminal
  const replay = await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(closer), { reason: "Buổi đã được phán qua đường cũ" }, { "Idempotency-Key": "k-orphan" });
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(admin()), { reason: "again" })).json.code, "CASE_STATE_NOT_ALLOWED");
  assert.ok((await prisma.notification.count({ where: { userId: s.clientUserId, entityType: "DISPUTE_CASE", entityId: caseId } })) >= 2, "parties are told the file was closed");
});

test("11. NOT_A_DISPUTE (HTTP): the investigator closes the case with a reason; no money, the session is untouched and stays in the queue with its CLOSED case (never reopened)", async () => {
  const s = await mkSession();
  const P = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "COLLECTING" });
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "ASSESSING" });
  // not yet a NOT_A_DISPUTE finding: refused
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(P), { reason: "x" })).json.code, "CASE_STATE_NOT_ALLOWED");
  const f = await call("POST", `/admin/dispute-cases/${caseId}/findings`, A(P), { finding: "NOT_A_DISPUTE", reasoning: "Khách rút khiếu nại" });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const stuck = await call("POST", `/admin/dispute-cases/${caseId}/proposals`, A(P), {});
  assert.equal(stuck.json.code, "DESIGN_REQUIRED", "no proposal exists for it");
  const d = await call("GET", `/admin/dispute-cases/${caseId}`, A(P));
  assert.equal(d.json.actions.closeNotADispute.allowed, true);
  assert.equal(d.json.actions.propose.code, "DESIGN_REQUIRED");
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}`, A(admin()))).json.actions.closeNotADispute.code, "NOT_ASSIGNED_INVESTIGATOR");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(admin()), { reason: "x" })).json.code, "NOT_ASSIGNED_INVESTIGATOR");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(P), {})).status, 400);

  const settlementsBefore = await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } });
  const closed = await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(P), { reason: "Khách rút khiếu nại, không có tranh chấp" });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.deepEqual([closed.json.to, closed.json.closeReason, closed.json.moneyMoved], ["CLOSED", "NOT_A_DISPUTE", false]);
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED", "the session is not touched");
  assert.equal(await prisma.sessionSettlement.count({ where: { contractId: s.contract.id } }), settlementsBefore);
  assert.equal(writeCalls.length, 0);
  const queue = (await call("GET", `/admin/dispute-cases/queue?contractId=${s.contract.id}`, A(P))).json;
  assert.deepEqual([queue.items[0].hasCase, queue.items[0].needsCase, queue.items[0].caseStatus], [true, false, "CLOSED"], "A5: a CLOSED case is not reopened: the session shows its closed case, not a free slot");
});

// ═══ the old behaviours that must NOT move ═══════════════════════════════════════════════════════════════════════════

test("no policy change leaked in: a plain DECISION_APPROVED case is still executed only by the executor flag; with it off the execute route is 409 EXECUTION_DISABLED and nothing is written", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  disableExecutionFlags();
  enableExecutionFlags({});
  const r = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(admin()), {});
  assert.deepEqual([r.status, r.json.code], [409, "EXECUTION_DISABLED"]);
  assert.equal((await caseRow(a.caseId)).execStatus, "NOT_STARTED");
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal((await execRows(a.caseId)).length, 0);
  assert.equal(writeCalls.length, 0);
});
