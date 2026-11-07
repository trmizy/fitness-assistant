/**
 * DISPUTE V2.1 PROCESS (Ngai 05/11/2026) - mutual agreement, appeal (review request), its consequences (B2 money, B3 quota correction, B4 ptAtFault), B5 "not fully resolved".
 * BACKEND INTEGRATION over REAL HTTP into the real user-service app on the isolated *_test database (auth-service = TEST FIXTURE "ROLE:id"; payment-service = stub, every WRITE throws and is
 * counted; the clock is injectable). Session / contract rows are inserted (TEST FIXTURE); the case workflow, the four-eyes decision and the executor are the real services. Not a browser.
 * Run ALONE (it truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { setAdminAccountLookupForTests } from "../services/dispute-case/admin-account";
import { setClockForTests } from "../services/dispute-case/clock";
import { admin, approvedCaseFor, caseRow, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
const writeCalls: string[] = [];
let base = "";
let server: any;
const DAY = 24 * 3600_000;
let notAdminIds = new Set<string>();

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
  setAdminAccountLookupForTests(async (id) => ({ role: notAdminIds.has(id) ? "CUSTOMER" : "ADMIN", isActive: true }));
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_case_deadlines, dispute_case_party_notices, dispute_case_agreement_confirmations, dispute_case_agreements, dispute_case_quota_corrections, dispute_case_appeal_consequences, dispute_case_appeals, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  setClockForTests();
  setAdminAccountLookupForTests();
  for (const r of restores) r();
  server?.close();
  await prisma.notification.deleteMany({ where: { OR: [{ entityType: "DISPUTE_CASE" }, { userId: { in: createdPts } }] } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  writeCalls.length = 0;
  notAdminIds = new Set();
  setClockForTests();
  disableExecutionFlags();
  enableExecutionFlags({ execution: true });
  process.env.DISPUTE_CASE_APPEALS_ENABLED = "true";
});

async function mkSession() {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
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
const contractRow = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });
let k = 0;
const key = () => ({ "Idempotency-Key": `v21-${++k}-${randomUUID().slice(0, 8)}` });

/** ASSESSING case on a DISPUTED session, opened and driven over HTTP */
async function assessingCase(s: Awaited<ReturnType<typeof mkSession>>, P = admin()) {
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "COLLECTING" });
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "ASSESSING" });
  return { caseId, P };
}

// ═══ mutual agreement ═══════════════════════════════════════════════════════════════════════════════════════════════════

test("mutual agreement: both parties confirm the SAME content hash -> AGREED -> finding -> the NORMAL four-eyes proposal/approval -> the executor; confirming is not executing and not a ruling", async () => {
  const s = await mkSession();
  const { caseId, P } = await assessingCase(s);
  const propose = (outcome: string, headers: Record<string, string> = key()) => call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(P), { outcome, note: "Hai bên đã thống nhất qua điện thoại" }, headers);

  assert.equal((await propose("COMPLETED", {})).json.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal((await propose("PAID_TWICE")).status, 400, "only the three outcomes");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(P), { outcome: "COMPLETED", note: "x", amount: 100 }, key())).status, 400, "no amount can be agreed");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(admin()), { outcome: "COMPLETED", note: "x" }, key())).json.code, "NOT_ASSIGNED_INVESTIGATOR");

  const first = await propose("CANCELLED");
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await propose("COMPLETED");
  assert.notEqual(first.json.contentHash, second.json.contentHash, "the hash names the outcome");
  assert.match(second.json.contentHash, /^[0-9a-f]{64}$/);
  // the earlier proposal was withdrawn by the newer one
  const clientTok = `CUSTOMER:${s.clientUserId}`;
  const ptTok = `PT:${s.ptUserId}`;
  const oldC = await call("POST", `/dispute-cases/${caseId}/agreements/${first.json.id}/confirm`, clientTok, { contentHash: first.json.contentHash });
  assert.deepEqual([oldC.status, oldC.json.code], [409, "AGREEMENT_NOT_OPEN"]);

  // the party sees exactly what it confirms
  const view = (await call("GET", `/dispute-cases/${caseId}`, clientTok)).json;
  const mine = view.agreements.find((a: any) => a.id === second.json.id);
  assert.deepEqual([mine.contentHash, mine.status, mine.myConfirmed, mine.otherConfirmed, mine.outcomeLabel], [second.json.contentHash, "PROPOSED", false, false, "Buổi tập được tính là đã hoàn thành"]);

  const confirm = (tok: string, hash: string, extra: Record<string, string> = {}) => call("POST", `/dispute-cases/${caseId}/agreements/${second.json.id}/confirm`, tok, { contentHash: hash }, extra);
  assert.equal((await confirm(clientTok, first.json.contentHash)).json.code, "AGREEMENT_CONTENT_MISMATCH", "another content is not the same content");
  assert.equal((await confirm(`CUSTOMER:${randomUUID()}`, second.json.contentHash)).status, 404, "a stranger");
  assert.equal((await confirm(clientTok, "not-a-hash")).status, 400);
  // not agreed yet: no finding
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements/${second.json.id}/record-finding`, A(P), {})).json.code, "AGREEMENT_NOT_AGREED");
  const c1 = await confirm(clientTok, second.json.contentHash);
  assert.deepEqual([c1.status, c1.json.status, c1.json.bothConfirmed], [200, "PROPOSED", false]);
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements/${second.json.id}/record-finding`, A(P), {})).json.code, "AGREEMENT_NOT_AGREED", "ONE party is not an agreement");
  assert.equal((await confirm(clientTok, second.json.contentHash)).json.code, "AGREEMENT_ALREADY_CONFIRMED");
  const c2 = await confirm(ptTok, second.json.contentHash);
  assert.deepEqual([c2.json.status, c2.json.bothConfirmed], ["AGREED", true]);

  // nothing happened to the session yet
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal(writeCalls.length, 0);
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements/${second.json.id}/record-finding`, A(admin()), {})).json.code, "NOT_ASSIGNED_INVESTIGATOR");
  const fnd = await call("POST", `/admin/dispute-cases/${caseId}/agreements/${second.json.id}/record-finding`, A(P), {});
  assert.equal(fnd.status, 201, JSON.stringify(fnd.json));
  assert.deepEqual([fnd.json.finding, fnd.json.caseStatus, fnd.json.proposalPossible], ["VERIFIED_DELIVERED", "FINDING_RECORDED", true]);
  const ag = (await call("GET", `/admin/dispute-cases/${caseId}/agreements`, A(P))).json.items.find((a: any) => a.id === second.json.id);
  assert.deepEqual([ag.status, ag.findingId, ag.confirmations.length], ["USED", fnd.json.findingId, 2]);

  // the NORMAL path: proposal by the investigator, four-eyes approval by another admin, then the executor
  const prop = await call("POST", `/admin/dispute-cases/${caseId}/proposals`, A(P), {});
  assert.equal(prop.status, 201, JSON.stringify(prop.json));
  assert.equal(prop.json.outcome, "COMPLETED");
  const self = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(P), { result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: true });
  assert.equal(self.json.code, "SELF_APPROVAL_FORBIDDEN", "an agreement does not remove the second pair of eyes");
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/approvals`, A(admin()), { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true })).status, 200);
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED", "approval does not execute");
  const ex = await call("POST", `/admin/dispute-cases/${caseId}/execute`, A(admin()), {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  assert.equal((await sessionRow(s.session.id)).status, "COMPLETED");
  const events = await prisma.disputeCaseEvent.findMany({ where: { caseId, action: { in: ["AGREEMENT_PROPOSED", "AGREEMENT_CONFIRMED", "AGREEMENT_FINDING_RECORDED"] } } });
  assert.equal(events.length, 5, "2 proposals + 2 confirmations + 1 finding, all audited");
});

test("mutual agreement and appeal routes are refused (409 DISPUTE_PROCESS_DISABLED) while the flag is OFF; reads stay open", async () => {
  const s = await mkSession();
  const { caseId, P } = await assessingCase(s);
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(P), { outcome: "COMPLETED", note: "x" }, key())).json.code, "DISPUTE_PROCESS_DISABLED");
  assert.equal((await call("POST", `/dispute-cases/${caseId}/appeals`, `CUSTOMER:${s.clientUserId}`, { reason: "x" }, key())).json.code, "DISPUTE_PROCESS_DISABLED");
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/agreements`, A(P))).status, 200);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/appeals`, A(P))).status, 200);
  assert.equal(await prisma.disputeCaseAgreement.count({ where: { caseId } }), 0);
});

// ═══ appeal ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

async function executedCase(finding: (typeof FINDING_FOR)[keyof typeof FINDING_FOR] = FINDING_FOR.COMPLETED) {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, finding);
  const ex = await call("POST", `/admin/dispute-cases/${a.caseId}/execute`, A(admin()), {});
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  writeCalls.length = 0;
  return { s, a };
}

test("appeal: once per party per case, only within 14 days of the CONCLUSION notice recorded for THAT party (injectable clock), never without a recorded notice; strangers see nothing", async () => {
  const { s, a } = await executedCase();
  const clientTok = `CUSTOMER:${s.clientUserId}`;
  const ptTok = `PT:${s.ptUserId}`;
  const ask = (tok: string, h: Record<string, string> = key()) => call("POST", `/dispute-cases/${a.caseId}/appeals`, tok, { reason: "Tôi không đồng ý với kết quả" }, h);

  assert.equal((await ask(clientTok, {})).json.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal((await ask(`CUSTOMER:${randomUUID()}`)).status, 404);
  assert.equal((await call("POST", `/dispute-cases/${a.caseId}/appeals`, clientTok, { reason: "x", amount: 5 }, key())).status, 400);
  const notice = await prisma.disputeCasePartyNotice.findFirstOrThrow({ where: { caseId: a.caseId, userId: s.clientUserId, kind: "CONCLUSION" } });
  const ptNotice = await prisma.disputeCasePartyNotice.findFirstOrThrow({ where: { caseId: a.caseId, userId: s.ptUserId, kind: "CONCLUSION" } });

  // the window of the PT closes 14 days after ITS notice: one second late is refused, the client's own window is its own
  setClockForTests(() => new Date(ptNotice.recordedAt.getTime() + 14 * DAY + 1000));
  const late = await ask(ptTok);
  assert.deepEqual([late.status, late.json.code], [409, "APPEAL_WINDOW_CLOSED"]);

  setClockForTests(() => new Date(notice.recordedAt.getTime() + 14 * DAY));
  const ok = await ask(clientTok);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(new Date(ok.json.windowClosesAt).getTime(), notice.recordedAt.getTime() + 14 * DAY);
  assert.deepEqual([ok.json.partyRole, ok.json.status], ["CLIENT", "REQUESTED"]);
  assert.equal((await ask(clientTok)).json.code, "APPEAL_ALREADY_REQUESTED", "each party ONCE per case");
  const replay = await call("POST", `/dispute-cases/${a.caseId}/appeals`, clientTok, { reason: "Tôi không đồng ý với kết quả" }, { "Idempotency-Key": "fixed-appeal-key" });
  assert.equal(replay.status, 409);

  // no recorded conclusion notice -> no window at all
  await prisma.disputeCasePartyNotice.deleteMany({ where: { caseId: a.caseId, userId: s.ptUserId, kind: "CONCLUSION" } });
  setClockForTests(() => new Date(ptNotice.recordedAt.getTime() + DAY));
  assert.equal((await ask(ptTok)).json.code, "APPEAL_NOTICE_NOT_RECORDED");

  // a case that has no approved decision cannot be appealed
  const s2 = await mkSession();
  const { caseId: open } = await assessingCase(s2);
  assert.equal((await call("POST", `/dispute-cases/${open}/appeals`, `CUSTOMER:${s2.clientUserId}`, { reason: "x" }, key())).json.code, "CASE_STATE_NOT_ALLOWED");
  assert.equal((await caseRow(a.caseId)).status, "DECISION_APPROVED");
  assert.equal(writeCalls.length, 0);
});

test("appeal outcome: an INDEPENDENT reviewer records a NEW finding that references the old one (nothing rewritten, nothing executed); consequences are recorded - money NEEDS_RECONCILIATION (never a fake debt), quota OPEN, ptAtFault record+escalate only; B5 the case is NOT fully resolved", async () => {
  const { s, a } = await executedCase();
  const clientTok = `CUSTOMER:${s.clientUserId}`;
  const sessionAfterExec = await sessionRow(s.session.id);
  const contractAfterExec = await contractRow(s.contract.id);
  const settlements = await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } });
  const execRows = await prisma.disputeCaseExecution.count({ where: { caseId: a.caseId } });
  const oldFinding = await prisma.disputeCaseFinding.findFirstOrThrow({ where: { caseId: a.caseId }, orderBy: { createdAt: "desc" } });

  const ap = (await call("POST", `/dispute-cases/${a.caseId}/appeals`, clientTok, { reason: "PT không đến" }, key())).json;
  const R = admin();
  const assign = (reviewerId: string, tok = A(admin())) => call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/assign-reviewer`, tok, { reviewerId });
  // independence: not the investigator, not the proposer / approver of the original decision, not a party, a real admin
  for (const [who, code] of [[a.investigator.id, "REVIEWER_NOT_INDEPENDENT"], [a.approver.id, "REVIEWER_NOT_INDEPENDENT"], [s.clientUserId, "CONFLICT_OF_INTEREST"], [s.ptUserId, "CONFLICT_OF_INTEREST"]] as const) {
    const r = await assign(who);
    assert.equal(r.json.code, code, who);
  }
  notAdminIds.add("some-customer");
  assert.equal((await assign("some-customer")).json.code, "ASSIGNEE_NOT_ADMIN");
  assert.equal((await assign(R.id, `CUSTOMER:${s.clientUserId}`)).status, 403);
  const assigned = await assign(R.id);
  assert.deepEqual([assigned.status, assigned.json.status, assigned.json.reviewerId], [200, "UNDER_REVIEW", R.id]);

  const decide = (tok: string, body: unknown, h = key()) => call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/decision`, tok, body, h);
  assert.equal((await decide(A(admin()), { result: "UPHELD", reasoning: "x" })).json.code, "NOT_APPEAL_REVIEWER");
  assert.equal((await decide(A(a.investigator), { result: "UPHELD", reasoning: "x" })).json.code, "NOT_APPEAL_REVIEWER");
  assert.equal((await decide(A(R), { result: "NEW_FINDING", reasoning: "x" })).json.code, "FINDING_REQUIRED");
  assert.equal((await decide(A(R), { result: "UPHELD", reasoning: "x", consequences: [{ kind: "MONEY", note: "x" }] })).json.code, "UPHELD_HAS_NO_CHANGE");
  assert.equal((await decide(A(R), { result: "NEW_FINDING", reasoning: "x", finding: "VERIFIED_PT_ABSENT", amount: 100 })).status, 400, "no amount in the body");

  const won = await decide(A(R), {
    result: "NEW_FINDING",
    reasoning: "Dữ liệu phòng cho thấy PT không có mặt",
    finding: "VERIFIED_PT_ABSENT",
    consequences: [{ kind: "MONEY", note: "Khách có thể được hoàn" }, { kind: "QUOTA", note: "Trả lại một buổi" }, { kind: "PT_AT_FAULT", note: "Lỗi thuộc PT" }],
  });
  assert.equal(won.status, 200, JSON.stringify(won.json));
  assert.equal(won.json.fullyResolved, false);
  const byKind = Object.fromEntries(won.json.consequences.map((c: any) => [c.kind, c.status]));
  assert.deepEqual(byKind, { MONEY: "NEEDS_RECONCILIATION", QUOTA: "OPEN", PT_AT_FAULT: "RESOLVED" });

  // a NEW finding that references the old; the old one is untouched; the case is where it was
  const findings = await prisma.disputeCaseFinding.findMany({ where: { caseId: a.caseId }, orderBy: { createdAt: "asc" } });
  assert.equal(findings.length, 2);
  assert.deepEqual([findings[1].id, findings[1].supersedesId, findings[1].finding], [won.json.newFindingId, oldFinding.id, "VERIFIED_PT_ABSENT"]);
  assert.deepEqual([findings[0].id, findings[0].finding, findings[0].reasoning], [oldFinding.id, oldFinding.finding, oldFinding.reasoning]);
  assert.equal((await caseRow(a.caseId)).status, "DECISION_APPROVED");
  // NOTHING was executed or moved
  const sessionNow = await sessionRow(s.session.id);
  assert.deepEqual([sessionNow.status, sessionNow.ptAtFault, sessionNow.resolvedByCaseDecisionId], [sessionAfterExec.status, sessionAfterExec.ptAtFault, sessionAfterExec.resolvedByCaseDecisionId]);
  const contractNow = await contractRow(s.contract.id);
  assert.deepEqual([contractNow.usedSessions, contractNow.status], [contractAfterExec.usedSessions, contractAfterExec.status], "entitlements and the contract untouched");
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), settlements);
  assert.equal(await prisma.disputeCaseExecution.count({ where: { caseId: a.caseId } }), execRows);
  assert.equal(writeCalls.length, 0);
  // B2: no fake debt
  const money = await prisma.disputeCaseAppealConsequence.findFirstOrThrow({ where: { caseId: a.caseId, kind: "MONEY" } });
  assert.deepEqual((money.detail as any).obligationCreated, false);
  // B4: recorded + escalated only
  const pt = await prisma.disputeCaseAppealConsequence.findFirstOrThrow({ where: { caseId: a.caseId, kind: "PT_AT_FAULT" } });
  assert.deepEqual([(pt.detail as any).recordedOnly, (pt.detail as any).entitlementsChanged, (pt.detail as any).contractReopened], [true, false, false]);
  assert.equal((await caseRow(a.caseId)).escalated, true);

  // B5: the detail says it is NOT fully resolved, and the money axis is not settled; closing is refused while the quota consequence is OPEN
  const detail = (await call("GET", `/admin/dispute-cases/${a.caseId}`, A(R))).json;
  assert.equal(detail.closure.fullyResolved, false);
  assert.equal(detail.closure.moneyAxisSettled, false);
  assert.deepEqual(detail.closure.unresolved.map((u: any) => u.kind).sort(), ["MONEY", "QUOTA"]);
  assert.equal(detail.financial.derived, true, "the financial view is never rewritten to look finished");
  const closeEarly = await call("POST", `/admin/dispute-cases/${a.caseId}/close-executed`, A(admin()), { reason: "x" });
  assert.deepEqual([closeEarly.status, closeEarly.json.code], [409, "APPEAL_CONSEQUENCE_OPEN"]);
  assert.equal((await decide(A(R), { result: "UPHELD", reasoning: "x" })).json.code, "APPEAL_ALREADY_DECIDED");

  // ── B3: the quota correction, separate transaction under the contract lock, four-eyes, bounded, idempotent ──
  const quota = (await call("GET", `/admin/dispute-cases/${a.caseId}/appeals`, A(R))).json.items[0].consequences.find((c: any) => c.kind === "QUOTA");
  const X = admin();
  const propose = (delta: number, tok = A(X), h: Record<string, string> = key()) => call("POST", `/admin/dispute-cases/${a.caseId}/consequences/${quota.id}/quota-corrections`, tok, { delta, reason: "Trả lại buổi đã bị trừ" }, h);
  assert.equal((await propose(-1, A(X), {})).json.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal((await propose(0)).status, 400);
  assert.equal((await propose(-2)).json.code, "QUOTA_OUT_OF_BOUNDS", "used is 1: cannot go below zero");
  assert.equal((await propose(10)).json.code, "QUOTA_OUT_OF_BOUNDS", "cannot go above the contract total");
  assert.equal((await propose(-1, `ADMIN:${s.clientUserId}`)).json.code, "CONFLICT_OF_INTEREST");
  const prop = await propose(-1);
  assert.equal(prop.status, 201, JSON.stringify(prop.json));
  assert.deepEqual([prop.json.applied, prop.json.usedSessions], [false, 1]);
  assert.equal((await propose(-1)).json.code, "CORRECTION_ALREADY_PROPOSED");
  assert.equal((await contractRow(s.contract.id)).usedSessions, 1, "a proposal changes nothing");

  const approve = (tok: string, body: Record<string, unknown> = { reason: "ok", conflictOfInterestDeclaredNone: true }, h: Record<string, string> = {}) =>
    call("POST", `/admin/dispute-cases/${a.caseId}/quota-corrections/${prop.json.correctionId}/approve`, tok, body, h);
  assert.equal((await approve(A(X))).json.code, "SELF_APPROVAL_FORBIDDEN", "the proposer cannot approve");
  assert.equal((await approve(A(R))).json.code, "SELF_APPROVAL_FORBIDDEN", "the appeal reviewer cannot approve the correction of his own decision");
  assert.equal((await approve(A(a.investigator))).json.code, "SELF_APPROVAL_FORBIDDEN");
  assert.equal((await approve(`ADMIN:${s.ptUserId}`)).json.code, "CONFLICT_OF_INTEREST");
  const Y = admin();
  assert.equal((await approve(A(Y), { reason: "ok", conflictOfInterestDeclaredNone: false })).json.code, "CONFLICT_OF_INTEREST");
  assert.equal((await contractRow(s.contract.id)).usedSessions, 1, "every refusal changed nothing");

  const hk = { "Idempotency-Key": `apply-${randomUUID().slice(0, 8)}` };
  const done = await approve(A(Y), undefined, hk);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual([done.json.usedBefore, done.json.usedAfter, done.json.applied], [1, 0, true]);
  assert.equal((await contractRow(s.contract.id)).usedSessions, 0);
  const again = await approve(A(Y), undefined, hk);
  assert.equal(again.headers.get("idempotent-replay"), "true");
  assert.equal((await contractRow(s.contract.id)).usedSessions, 0, "replay did not apply twice");
  assert.equal((await approve(A(admin()))).json.code, "CORRECTION_ALREADY_APPLIED");
  assert.equal(await prisma.auditLog.count({ where: { entityId: s.contract.id, action: "DISPUTE_QUOTA_CORRECTED" } }), 1);
  assert.equal((await sessionRow(s.session.id)).status, sessionAfterExec.status, "history (the session) never touched");
  assert.equal((await prisma.disputeCaseAppealConsequence.findUniqueOrThrow({ where: { id: quota.id } })).status, "RESOLVED");

  // money stays NEEDS_RECONCILIATION: the case may now close, but it keeps saying it is not fully resolved
  const closed = await call("POST", `/admin/dispute-cases/${a.caseId}/close-executed`, A(admin()), { reason: "Hết việc về buổi" });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.deepEqual([closed.json.to, closed.json.closeReason, closed.json.moneyMoved], ["CLOSED", "APPEAL_CONCLUDED", false]);
  const after = (await call("GET", `/admin/dispute-cases/${a.caseId}`, A(R))).json;
  assert.deepEqual([after.closure.state, after.closure.fullyResolved, after.closure.moneyAxisSettled], ["CLOSED", false, false]);
  assert.deepEqual(after.closure.unresolved.map((u: any) => [u.kind, u.status]), [["MONEY", "NEEDS_RECONCILIATION"]]);
  assert.equal(writeCalls.length, 0, "not one payment write in the whole appeal");
});

test("B3 bounds are checked again UNDER THE CONTRACT LOCK when applied (the quota may have moved since the proposal); UPHELD leaves everything as it was", async () => {
  const { s, a } = await executedCase();
  const ap = (await call("POST", `/dispute-cases/${a.caseId}/appeals`, `PT:${s.ptUserId}`, { reason: "Tôi có dạy" }, key())).json;
  const R = admin();
  await call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/assign-reviewer`, A(admin()), { reviewerId: R.id });
  const won = await call("POST", `/admin/dispute-cases/${a.caseId}/appeals/${ap.appealId}/decision`, A(R), { result: "NEW_FINDING", reasoning: "Khách vắng", finding: "VERIFIED_CLIENT_ABSENT", consequences: [{ kind: "QUOTA", note: "x" }] }, key());
  assert.equal(won.status, 200, JSON.stringify(won.json));
  const cons = won.json.consequences[0];
  const X = admin();
  const prop = (await call("POST", `/admin/dispute-cases/${a.caseId}/consequences/${cons.id}/quota-corrections`, A(X), { delta: -1, reason: "x" }, key())).json;
  // meanwhile the quota went to 0 by another route
  await prisma.contract.update({ where: { id: s.contract.id }, data: { usedSessions: 0 } });
  const r = await call("POST", `/admin/dispute-cases/${a.caseId}/quota-corrections/${prop.correctionId}/approve`, A(admin()), { reason: "ok", conflictOfInterestDeclaredNone: true });
  assert.deepEqual([r.status, r.json.code], [409, "QUOTA_OUT_OF_BOUNDS"]);
  assert.equal((await contractRow(s.contract.id)).usedSessions, 0);
  assert.equal((await prisma.disputeCaseQuotaCorrection.findUniqueOrThrow({ where: { id: prop.correctionId } })).appliedAt, null);

  // UPHELD: no new finding, no consequence, fully resolved
  const { s: s2, a: a2 } = await executedCase(FINDING_FOR.CANCELLED);
  const ap2 = (await call("POST", `/dispute-cases/${a2.caseId}/appeals`, `CUSTOMER:${s2.clientUserId}`, { reason: "x" }, key())).json;
  const R2 = admin();
  await call("POST", `/admin/dispute-cases/${a2.caseId}/appeals/${ap2.appealId}/assign-reviewer`, A(admin()), { reviewerId: R2.id });
  const up = await call("POST", `/admin/dispute-cases/${a2.caseId}/appeals/${ap2.appealId}/decision`, A(R2), { result: "UPHELD", reasoning: "Giữ nguyên" }, key());
  assert.deepEqual([up.status, up.json.result, up.json.newFindingId, up.json.fullyResolved], [200, "UPHELD", null, true]);
  assert.equal(await prisma.disputeCaseFinding.count({ where: { caseId: a2.caseId } }), 1);
  const detail = (await call("GET", `/admin/dispute-cases/${a2.caseId}`, A(R2))).json;
  assert.deepEqual([detail.closure.fullyResolved, detail.closure.pendingAppeals], [true, 0]);
});
