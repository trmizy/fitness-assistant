/**
 * DISPUTE V2.1 allowedActions (admin case detail AND party case view): every V2.1 process action is listed with allowed true/false and the reason code the ROUTE returns.
 * BACKEND INTEGRATION over REAL HTTP into the real user-service app on the isolated *_test database (auth-service = TEST FIXTURE "ROLE:id"; payment-service = stub). Session / contract / held-money
 * rows are inserted (TEST FIXTURE). Not a browser. Run ALONE (it truncates the dispute_case* tables).
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
import { admin, approvedCaseFor, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

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

test.afterEach(() => {
  delete process.env.DISPUTE_CASE_DECISION_REPLACEMENT_ENABLED;
});

type Verdict = { allowed: boolean; code?: string; options?: string[] };
const actionsOf = async (caseId: string, who: { id: string }) => (await call("GET", `/admin/dispute-cases/${caseId}`, A(who))).json.actions as Record<string, Verdict>;
const partyActions = async (caseId: string, tok: string) => (await call("GET", `/dispute-cases/${caseId}`, tok)).json.actions as Record<string, Verdict>;
/** allowedActions must match the real route: allowed -> the route succeeds; refused -> the route answers exactly that code */
function matches(name: string, verdict: Verdict, r: { status: number; json: any }) {
  if (verdict.allowed) assert.ok(r.status >= 200 && r.status < 300, `${name}: listed as allowed but the route answered ${r.status} ${JSON.stringify(r.json)}`);
  else assert.equal(r.json?.code, verdict.code, `${name}: refused as ${verdict.code} but the route answered ${r.status} ${JSON.stringify(r.json)}`);
}

test("agreement: proposeAgreement / withdrawAgreement / recordAgreementFinding (admin) and confirmAgreement (party) are listed and match the routes", async () => {
  const s = await mkSession();
  const { caseId, P } = await assessingCase(s);
  const other = admin();
  const clientTok = `CUSTOMER:${s.clientUserId}`;
  const ptTok = `PT:${s.ptUserId}`;

  let a = await actionsOf(caseId, P);
  assert.equal(a.proposeAgreement.allowed, true);
  assert.equal(a.withdrawAgreement.code, "AGREEMENT_NOT_OPEN");
  assert.equal(a.recordAgreementFinding.code, "AGREEMENT_NOT_AGREED");
  const o = await actionsOf(caseId, other);
  assert.equal(o.proposeAgreement.code, "NOT_ASSIGNED_INVESTIGATOR");
  matches("proposeAgreement(other admin)", o.proposeAgreement, await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(other), { outcome: "COMPLETED", note: "x" }, key()));
  matches("withdrawAgreement(none)", a.withdrawAgreement, await call("POST", `/admin/dispute-cases/${caseId}/agreements/${randomUUID()}/withdraw`, A(P), {}, key()));
  assert.equal((await partyActions(caseId, clientTok)).confirmAgreement.code, "AGREEMENT_NOT_FOUND");

  matches("proposeAgreement(investigator)", a.proposeAgreement, await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(P), { outcome: "COMPLETED", note: "Hai bên thống nhất" }, key()));
  const ag = await prisma.disputeCaseAgreement.findFirstOrThrow({ where: { caseId, status: "PROPOSED" } });
  a = await actionsOf(caseId, P);
  assert.deepEqual(a.withdrawAgreement.options, [ag.id]);
  assert.equal(a.recordAgreementFinding.code, "AGREEMENT_NOT_AGREED");
  matches("recordAgreementFinding(not agreed)", a.recordAgreementFinding, await call("POST", `/admin/dispute-cases/${caseId}/agreements/${ag.id}/record-finding`, A(P), {}, key()));

  const cp = await partyActions(caseId, clientTok);
  assert.deepEqual([cp.confirmAgreement.allowed, cp.confirmAgreement.options], [true, [ag.id]]);
  matches("confirmAgreement(client)", cp.confirmAgreement, await call("POST", `/dispute-cases/${caseId}/agreements/${ag.id}/confirm`, clientTok, { contentHash: ag.contentHash }, key()));
  const cp2 = await partyActions(caseId, clientTok);
  assert.equal(cp2.confirmAgreement.code, "AGREEMENT_ALREADY_CONFIRMED");
  matches("confirmAgreement(client again)", cp2.confirmAgreement, await call("POST", `/dispute-cases/${caseId}/agreements/${ag.id}/confirm`, clientTok, { contentHash: ag.contentHash }, key()));
  const pp = await partyActions(caseId, ptTok);
  assert.equal(pp.confirmAgreement.allowed, true);
  matches("confirmAgreement(pt)", pp.confirmAgreement, await call("POST", `/dispute-cases/${caseId}/agreements/${ag.id}/confirm`, ptTok, { contentHash: ag.contentHash }, key()));
  assert.equal((await partyActions(caseId, ptTok)).confirmAgreement.code, "AGREEMENT_NOT_OPEN");

  a = await actionsOf(caseId, P);
  assert.deepEqual([a.recordAgreementFinding.allowed, a.recordAgreementFinding.options], [true, [ag.id]]);
  assert.equal((await actionsOf(caseId, other)).recordAgreementFinding.code, "NOT_ASSIGNED_INVESTIGATOR");
  matches("recordAgreementFinding(investigator)", a.recordAgreementFinding, await call("POST", `/admin/dispute-cases/${caseId}/agreements/${ag.id}/record-finding`, A(P), {}, key()));

  const fp = await partyActions(caseId, clientTok);
  assert.equal(fp.addStatement.code, "CASE_STATE_NOT_ALLOWED");
  matches("addStatement", fp.addStatement, await call("POST", `/dispute-cases/${caseId}/statements`, clientTok, { text: "lời khai" }, key()));
  matches("addEvidence", fp.addEvidence, await call("POST", `/dispute-cases/${caseId}/evidence`, clientTok, { description: "tài liệu", sha256: "a".repeat(64) }, key()));
  assert.equal(fp.addEvidenceFile.code, "FEATURE_DISABLED");
  assert.equal(writeCalls.length, 0);
});

test("flag OFF: V2.1 process actions (admin and party) are refused DISPUTE_PROCESS_DISABLED like the routes; replacement has its own flag", async () => {
  const s = await mkSession();
  const { caseId, P } = await assessingCase(s);
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  const a = await actionsOf(caseId, P);
  for (const n of ["proposeAgreement", "withdrawAgreement", "recordAgreementFinding", "assignAppealReviewer", "decideAppeal", "createAppealObligation", "syncAppealObligation", "proposeQuotaCorrection", "approveQuotaCorrection", "decideHeldMoney"]) {
    assert.equal(a[n].code, "DISPUTE_PROCESS_DISABLED", n);
  }
  matches("proposeAgreement", a.proposeAgreement, await call("POST", `/admin/dispute-cases/${caseId}/agreements`, A(P), { outcome: "COMPLETED", note: "x" }, key()));
  const pa = await partyActions(caseId, `CUSTOMER:${s.clientUserId}`);
  assert.equal(pa.confirmAgreement.code, "DISPUTE_PROCESS_DISABLED");
  assert.equal(pa.requestAppeal.code, "DISPUTE_PROCESS_DISABLED");
  matches("requestAppeal", pa.requestAppeal, await call("POST", `/dispute-cases/${caseId}/appeals`, `CUSTOMER:${s.clientUserId}`, { reason: "x" }, key()));
  for (const n of ["proposeDecisionReplacement", "approveDecisionReplacement", "rejectDecisionReplacement"]) assert.equal(a[n].code, "DECISION_REPLACEMENT_DISABLED", n);
  matches("proposeDecisionReplacement", a.proposeDecisionReplacement, await call("POST", `/admin/dispute-cases/${caseId}/replacements`, A(P), { reason: "x" }, key()));
});

test("appeal, consequences, quota correction, closeExecuted: listed per actor and equal to the routes, allowed and refused", async () => {
  const s = await mkSession();
  const a0 = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const caseId = a0.caseId;
  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/execute`, A(admin()), {})).status, 200);
  writeCalls.length = 0;
  const clientTok = `CUSTOMER:${s.clientUserId}`;
  const ptTok = `PT:${s.ptUserId}`;
  const R = admin();
  const X = admin();

  let a = await actionsOf(caseId, R);
  assert.equal(a.assignAppealReviewer.code, "APPEAL_NOT_FOUND");
  assert.equal(a.decideAppeal.code, "APPEAL_NOT_FOUND");
  assert.equal(a.closeExecuted.allowed, true);

  const cp = await partyActions(caseId, clientTok);
  assert.equal(cp.requestAppeal.allowed, true);
  matches("requestAppeal", cp.requestAppeal, await call("POST", `/dispute-cases/${caseId}/appeals`, clientTok, { reason: "PT không đến" }, key()));
  const cp2 = await partyActions(caseId, clientTok);
  assert.equal(cp2.requestAppeal.code, "APPEAL_ALREADY_REQUESTED");
  matches("requestAppeal(again)", cp2.requestAppeal, await call("POST", `/dispute-cases/${caseId}/appeals`, clientTok, { reason: "again" }, key()));
  const ptNotice = await prisma.disputeCasePartyNotice.findFirstOrThrow({ where: { caseId, userId: s.ptUserId, kind: "CONCLUSION" } });
  setClockForTests(() => new Date(ptNotice.recordedAt.getTime() + 14 * DAY + 1000));
  const late = await partyActions(caseId, ptTok);
  assert.equal(late.requestAppeal.code, "APPEAL_WINDOW_CLOSED");
  matches("requestAppeal(late)", late.requestAppeal, await call("POST", `/dispute-cases/${caseId}/appeals`, ptTok, { reason: "late" }, key()));
  setClockForTests(() => new Date(ptNotice.recordedAt.getTime() + DAY));
  await prisma.disputeCasePartyNotice.deleteMany({ where: { caseId, userId: s.ptUserId, kind: "CONCLUSION" } });
  const noNotice = await partyActions(caseId, ptTok);
  assert.equal(noNotice.requestAppeal.code, "APPEAL_NOTICE_NOT_RECORDED");
  matches("requestAppeal(no notice)", noNotice.requestAppeal, await call("POST", `/dispute-cases/${caseId}/appeals`, ptTok, { reason: "x" }, key()));
  setClockForTests();

  a = await actionsOf(caseId, X);
  assert.equal(a.closeExecuted.code, "APPEAL_PENDING");
  matches("closeExecuted(pending appeal)", a.closeExecuted, await call("POST", `/admin/dispute-cases/${caseId}/close-executed`, A(X), { reason: "x" }));
  const appealId = (await prisma.disputeCaseAppeal.findFirstOrThrow({ where: { caseId } })).id;
  assert.deepEqual([a.assignAppealReviewer.allowed, a.assignAppealReviewer.options], [true, [appealId]]);
  const pAdmin = await actionsOf(caseId, { id: s.clientUserId });
  assert.equal(pAdmin.assignAppealReviewer.code, "CONFLICT_OF_INTEREST");
  matches("assignAppealReviewer(party admin)", pAdmin.assignAppealReviewer, await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/assign-reviewer`, `ADMIN:${s.clientUserId}`, { reviewerId: R.id }, key()));
  matches("assignAppealReviewer", a.assignAppealReviewer, await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/assign-reviewer`, A(X), { reviewerId: R.id }, key()));

  const dR = await actionsOf(caseId, R);
  assert.deepEqual([dR.decideAppeal.allowed, dR.decideAppeal.options], [true, [appealId]]);
  const dX = await actionsOf(caseId, X);
  assert.equal(dX.decideAppeal.code, "NOT_APPEAL_REVIEWER");
  matches("decideAppeal(other)", dX.decideAppeal, await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/decision`, A(X), { result: "UPHELD", reasoning: "x" }, key()));
  const inv = a0.investigator;
  await prisma.disputeCaseAppeal.update({ where: { id: appealId }, data: { reviewerId: inv.id } });
  const dI = await actionsOf(caseId, inv);
  assert.equal(dI.decideAppeal.code, "REVIEWER_NOT_INDEPENDENT");
  matches("decideAppeal(investigator-reviewer)", dI.decideAppeal, await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/decision`, A(inv), { result: "UPHELD", reasoning: "x" }, key()));
  await prisma.disputeCaseAppeal.update({ where: { id: appealId }, data: { reviewerId: R.id } });
  matches(
    "decideAppeal(reviewer)",
    dR.decideAppeal,
    await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/decision`, A(R), {
      result: "NEW_FINDING",
      reasoning: "PT không có mặt",
      finding: "VERIFIED_PT_ABSENT",
      consequences: [{ kind: "MONEY", note: "Khách có thể được hoàn" }, { kind: "QUOTA", note: "Trả lại một buổi" }],
    }, key()),
  );
  a = await actionsOf(caseId, R);
  assert.equal(a.decideAppeal.code, "APPEAL_ALREADY_DECIDED");
  matches("decideAppeal(decided)", a.decideAppeal, await call("POST", `/admin/dispute-cases/${caseId}/appeals/${appealId}/decision`, A(R), { result: "UPHELD", reasoning: "x" }, key()));
  assert.equal(a.assignAppealReviewer.code, "APPEAL_ALREADY_DECIDED");

  const money = await prisma.disputeCaseAppealConsequence.findFirstOrThrow({ where: { caseId, kind: "MONEY" } });
  const quota = await prisma.disputeCaseAppealConsequence.findFirstOrThrow({ where: { caseId, kind: "QUOTA" } });
  assert.equal(a.createAppealObligation.code, "MONEY_NOT_ESTABLISHED");
  matches("createAppealObligation", a.createAppealObligation, await call("POST", `/admin/dispute-cases/${caseId}/appeal-consequences/${money.id}/create-obligation`, A(X), {}, key()));
  assert.equal(a.syncAppealObligation.code, "NO_OBLIGATION");
  matches("syncAppealObligation", a.syncAppealObligation, await call("POST", `/admin/dispute-cases/${caseId}/appeal-consequences/${money.id}/sync-obligation`, A(X), {}, key()));
  assert.equal(writeCalls.length, 0);

  const aX = await actionsOf(caseId, X);
  assert.equal(aX.closeExecuted.code, "APPEAL_CONSEQUENCE_OPEN");
  matches("closeExecuted(open consequence)", aX.closeExecuted, await call("POST", `/admin/dispute-cases/${caseId}/close-executed`, A(X), { reason: "x" }));

  assert.deepEqual([aX.proposeQuotaCorrection.allowed, aX.proposeQuotaCorrection.options], [true, [quota.id]]);
  const pc = await actionsOf(caseId, { id: s.clientUserId });
  assert.equal(pc.proposeQuotaCorrection.code, "CONFLICT_OF_INTEREST");
  matches("proposeQuotaCorrection(party admin)", pc.proposeQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/consequences/${quota.id}/quota-corrections`, `ADMIN:${s.clientUserId}`, { delta: -1, reason: "x" }, key()));
  assert.equal(aX.approveQuotaCorrection.code, "CORRECTION_NOT_FOUND");
  matches("proposeQuotaCorrection", aX.proposeQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/consequences/${quota.id}/quota-corrections`, A(X), { delta: -1, reason: "Trả lại buổi" }, key()));
  const corr = await prisma.disputeCaseQuotaCorrection.findFirstOrThrow({ where: { caseId } });
  const approveBody = { reason: "ok", conflictOfInterestDeclaredNone: true };
  const apX = await actionsOf(caseId, X);
  assert.equal(apX.proposeQuotaCorrection.code, "CORRECTION_ALREADY_PROPOSED");
  assert.equal(apX.approveQuotaCorrection.code, "SELF_APPROVAL_FORBIDDEN");
  matches("proposeQuotaCorrection(again)", apX.proposeQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/consequences/${quota.id}/quota-corrections`, A(X), { delta: -1, reason: "again" }, key()));
  matches("approveQuotaCorrection(proposer)", apX.approveQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/quota-corrections/${corr.id}/approve`, A(X), approveBody, key()));
  const apR = await actionsOf(caseId, R);
  assert.equal(apR.approveQuotaCorrection.code, "SELF_APPROVAL_FORBIDDEN");
  matches("approveQuotaCorrection(reviewer)", apR.approveQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/quota-corrections/${corr.id}/approve`, A(R), approveBody, key()));
  const Y = admin();
  const apY = await actionsOf(caseId, Y);
  assert.deepEqual([apY.approveQuotaCorrection.allowed, apY.approveQuotaCorrection.options], [true, [corr.id]]);
  matches("approveQuotaCorrection(third admin)", apY.approveQuotaCorrection, await call("POST", `/admin/dispute-cases/${caseId}/quota-corrections/${corr.id}/approve`, A(Y), approveBody, key()));
  assert.equal((await actionsOf(caseId, Y)).approveQuotaCorrection.code, "CORRECTION_ALREADY_APPLIED");
});

test("closeExecuted / closeOrphan / closeNotADispute: listed and equal to the routes (refused and allowed)", async () => {
  const s = await mkSession();
  const a0 = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const early = await actionsOf(a0.caseId, admin());
  assert.equal(early.closeExecuted.code, "DECISION_NOT_EXECUTED");
  matches("closeExecuted(not executed)", early.closeExecuted, await call("POST", `/admin/dispute-cases/${a0.caseId}/close-executed`, A(admin()), { reason: "x" }));
  assert.equal((await call("POST", `/admin/dispute-cases/${a0.caseId}/execute`, A(admin()), {})).status, 200);
  const X = admin();
  const done = await actionsOf(a0.caseId, X);
  assert.equal(done.closeExecuted.allowed, true);
  const party = await actionsOf(a0.caseId, { id: s.clientUserId });
  assert.equal(party.closeExecuted.code, "CONFLICT_OF_INTEREST");
  matches("closeExecuted(party admin)", party.closeExecuted, await call("POST", `/admin/dispute-cases/${a0.caseId}/close-executed`, `ADMIN:${s.clientUserId}`, { reason: "x" }));
  matches("closeExecuted", done.closeExecuted, await call("POST", `/admin/dispute-cases/${a0.caseId}/close-executed`, A(X), { reason: "Đã thực thi xong" }));

  const s2 = await mkSession();
  const { caseId, P } = await assessingCase(s2);
  const a = await actionsOf(caseId, P);
  assert.equal(a.closeOrphan.code, "CASE_NOT_ORPHAN");
  matches("closeOrphan(still disputed)", a.closeOrphan, await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(admin()), { reason: "x" }));
  assert.equal(a.closeNotADispute.code, "CASE_STATE_NOT_ALLOWED");
  matches("closeNotADispute(assessing)", a.closeNotADispute, await call("POST", `/admin/dispute-cases/${caseId}/close-not-a-dispute`, A(P), { reason: "x" }));
  await prisma.session.update({ where: { id: s2.session.id }, data: { status: "COMPLETED" } });
  const b = await actionsOf(caseId, P);
  assert.equal(b.closeOrphan.allowed, true);
  matches("closeOrphan(orphan)", b.closeOrphan, await call("POST", `/admin/dispute-cases/${caseId}/close-orphan`, A(admin()), { reason: "Buổi đã hoàn tất ngoài hồ sơ" }));
});

test("decision replacement: propose / approve / reject listed per actor and equal to the routes", async () => {
  process.env.DISPUTE_CASE_DECISION_REPLACEMENT_ENABLED = "true";
  const s = await mkSession();
  const { caseId: open, P: P0 } = await assessingCase(s);
  const none = await actionsOf(open, P0);
  assert.equal(none.proposeDecisionReplacement.code, "DECISION_NOT_APPROVED");
  matches("proposeDecisionReplacement(no decision)", none.proposeDecisionReplacement, await call("POST", `/admin/dispute-cases/${open}/replacements`, A(admin()), { reason: "x" }, key()));
  assert.equal(none.approveDecisionReplacement.code, "REPLACEMENT_NOT_FOUND");

  const s2 = await mkSession();
  const a0 = await approvedCaseFor(s2.session.id, FINDING_FOR.COMPLETED);
  const caseId = a0.caseId;
  const X = admin();
  const Z = admin();
  const base = `/admin/dispute-cases/${caseId}/replacements`;
  const aX = await actionsOf(caseId, X);
  assert.equal(aX.proposeDecisionReplacement.allowed, true);
  const party = await actionsOf(caseId, { id: s2.clientUserId });
  assert.equal(party.proposeDecisionReplacement.code, "CONFLICT_OF_INTEREST");
  matches("proposeDecisionReplacement(party admin)", party.proposeDecisionReplacement, await call("POST", base, `ADMIN:${s2.clientUserId}`, { reason: "x" }, key()));
  matches("proposeDecisionReplacement", aX.proposeDecisionReplacement, await call("POST", base, A(X), { reason: "Quyết định cần thay" }, key()));
  const rep = await prisma.disputeCaseDecisionReplacement.findFirstOrThrow({ where: { caseId } });

  const body = { reason: "ok", conflictOfInterestDeclaredNone: true };
  const bX = await actionsOf(caseId, X);
  assert.equal(bX.proposeDecisionReplacement.code, "REPLACEMENT_PENDING");
  matches("proposeDecisionReplacement(pending)", bX.proposeDecisionReplacement, await call("POST", base, A(X), { reason: "again" }, key()));
  assert.equal(bX.approveDecisionReplacement.code, "SELF_APPROVAL_FORBIDDEN");
  matches("approveDecisionReplacement(proposer)", bX.approveDecisionReplacement, await call("POST", `${base}/${rep.id}/approve`, A(X), body, key()));
  assert.equal(bX.rejectDecisionReplacement.code, "SELF_REJECT_FORBIDDEN");
  matches("rejectDecisionReplacement(proposer)", bX.rejectDecisionReplacement, await call("POST", `${base}/${rep.id}/reject`, A(X), body, key()));
  const bZ = await actionsOf(caseId, Z);
  assert.deepEqual([bZ.approveDecisionReplacement.allowed, bZ.approveDecisionReplacement.options], [true, [rep.id]]);
  assert.equal(bZ.rejectDecisionReplacement.allowed, true);
  matches("rejectDecisionReplacement(second admin)", bZ.rejectDecisionReplacement, await call("POST", `${base}/${rep.id}/reject`, A(Z), body, key()));
  const after = await actionsOf(caseId, Z);
  assert.equal(after.approveDecisionReplacement.code, "REPLACEMENT_NOT_FOUND");
  assert.equal(after.proposeDecisionReplacement.allowed, true);

  assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/execute`, A(admin()), {})).status, 200);
  const eff = await actionsOf(caseId, Z);
  assert.equal(eff.proposeDecisionReplacement.code, "DECISION_HAS_EFFECT");
  matches("proposeDecisionReplacement(effect)", eff.proposeDecisionReplacement, await call("POST", base, A(Z), { reason: "late" }, key()));
});

test("held money (the case session) and contract-level policy: listed and equal to the route where reachable", async () => {
  const s = await mkSession();
  const { caseId, P } = await assessingCase(s);
  const none = await actionsOf(caseId, P);
  assert.equal(none.decideHeldMoney.code, "HELD_REVIEW_NOT_FOUND");
  matches("decideHeldMoney(none)", none.decideHeldMoney, await call("POST", `/admin/dispute-cases/held-money/${randomUUID()}/decision`, A(P), { decision: "KEEP_HOLDING", reason: "x" }));
  const row = await prisma.sessionSettlement.create({ data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "UNCONFIRMED" } });
  const rev = await prisma.disputeHeldMoneyReview.create({ data: { settlementRowId: row.id, sessionId: s.session.id, contractId: s.contract.id, firstSeenAt: new Date(), nextReviewDueAt: new Date(Date.now() + 7 * DAY) } });
  const a = await actionsOf(caseId, P);
  assert.deepEqual([a.decideHeldMoney.allowed, a.decideHeldMoney.options], [true, [rev.id]]);
  matches("decideHeldMoney", a.decideHeldMoney, await call("POST", `/admin/dispute-cases/held-money/${rev.id}/decision`, A(P), { decision: "KEEP_HOLDING", reason: "Giữ tiếp, chờ đối soát" }));
  assert.equal(a.proposeContractPolicy.allowed, true);
  assert.equal((await actionsOf(caseId, { id: s.clientUserId })).proposeContractPolicy.code, "CONFLICT_OF_INTEREST");
  assert.equal(a.approveContractPolicy.code, "POLICY_REVIEW_NOT_FOUND");
});
