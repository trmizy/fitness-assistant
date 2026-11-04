/**
 * D-NEW-12 CONTRACT-LEVEL policy review (Ngai 03/11/2026) - BACKEND INTEGRATION over REAL HTTP into the real user-service app on an ephemeral port, on the isolated *_test database.
 * authServiceClient.verifyToken is a TEST FIXTURE ("ROLE:id"); payment-service is a stub (ledger lookup answers nothing, every payment WRITE throws). Contract / session / acceptance /
 * audit rows are inserted (TEST FIXTURE) - the review workflow itself is the real service. Not a browser. Run ALONE (it truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { assertPolicyEligibility } from "../services/dispute-case/execution-guard";
import { classifyContractPolicy, REVIEW_CUTOFF } from "../services/dispute-case/contract-policy-review.service";
import { admin, disableExecutionFlags, enableExecutionFlags } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
let base = "";
let server: any;
const writeCalls: string[] = [];

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
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  for (const r of restores) r();
  server?.close();
  await prisma.ptTermsAcceptance.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
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
  disableExecutionFlags();
  enableExecutionFlags({});
});

/** A contract with NO review at all (eligibility "none"), plus a non-draft PT acceptance and an audit row of the contract as verifiable evidence. */
async function mkContract() {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" }, { eligibility: "none" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const acc = await prisma.ptTermsAcceptance.create({ data: { userId: ptUserId, version: "2026-11-pt-v1", source: "RECONFIRM" } });
  const audit = await prisma.auditLog.create({ data: { actorUserId: ptUserId, action: "CONTRACT_ACTIVE", entityType: "CONTRACT", entityId: contract.id, metadata: { ptTermsVersion: "2026-11-pt-v1" } } });
  return { contract, ptUserId, clientUserId: contract.clientUserId, acc, audit };
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
const P = (cid: string) => `/admin/dispute-cases/contracts/${cid}/policy-eligibility`;
const refsOf = (x: Awaited<ReturnType<typeof mkContract>>) => [{ kind: "PT_TERMS_ACCEPTANCE", id: x.acc.id }, { kind: "CONTRACT_AUDIT_LOG", id: x.audit.id }];
const guardCode = async (contractId: string) => {
  try {
    await prisma.$transaction((tx) => assertPolicyEligibility(tx, contractId));
    return "PASSES";
  } catch (e: any) {
    return e.code as string;
  }
};
const reviewRows = (contractId: string) => prisma.disputeCasePolicyEligibilityReview.count({ where: { contractId } });

test("review WITHOUT a Case: propose + four-eyes approve, references resolved by the server, no dispute_cases row is created, and the guard then lets the contract through", async () => {
  const x = await mkContract();
  const P1 = admin();
  const P2 = admin();
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED", "no review: closed");
  const proposed = await call("POST", P(x.contract.id), A(P1), { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: refsOf(x), reasoning: "Hợp đồng nhận sau khi PT chấp nhận điều khoản chính thức" });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.json));
  assert.deepEqual([proposed.json.level, proposed.json.approved, proposed.json.contractId], ["CONTRACT", false, x.contract.id]);
  assert.equal(proposed.json.evidenceRefs.length, 2);
  assert.ok(proposed.json.evidenceRefs.every((r: any) => /^[0-9a-f]{64}$/.test(r.hash)));
  assert.equal(await prisma.disputeCase.count({ where: { contractId: x.contract.id } }), 0, "no Case, fake or real");
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED", "a PENDING review unlocks nothing");

  const approved = await call("POST", `${P(x.contract.id)}/${proposed.json.reviewId}/approve`, A(P2), { reason: "Đã đối chiếu bản ghi", conflictOfInterestDeclaredNone: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.deepEqual([approved.json.approved, approved.json.result], [true, "ELIGIBLE_CURRENT_POLICY"]);
  assert.equal(await guardCode(x.contract.id), "PASSES", "an approved contract-level review is accepted exactly like a case-level one");

  const list = (await call("GET", P(x.contract.id), A(P2))).json;
  const row = list.items.find((i: any) => i.reviewId === proposed.json.reviewId);
  assert.deepEqual([row.level, row.caseId, row.status, row.current, row.proposedBy, row.approvedBy], ["CONTRACT", null, "APPROVED", true, P1.id, P2.id]);
  assert.equal(row.evidenceRefs.length, 2);
  assert.equal(list.currentReviewId, proposed.json.reviewId);
  const events = await prisma.disputePolicyReviewEvent.findMany({ where: { reviewId: proposed.json.reviewId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(events.map((e) => [e.action, e.actorUserId]), [["CONTRACT_POLICY_PROPOSED", P1.id], ["CONTRACT_POLICY_APPROVED", P2.id]]);
  assert.equal(writeCalls.length, 0);
});

test("the DB itself: the review row and its events are append-only (only the one-time approval stamp may change), and a contract-level row needs references", async () => {
  const x = await mkContract();
  const proposed = await call("POST", P(x.contract.id), A(admin()), { result: "EXCEPTION_APPLIES", evidenceRefs: refsOf(x), reasoning: "Ngoại lệ lịch sử" });
  const id = proposed.json.reviewId;
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET evidence_refs = '[]'::jsonb WHERE id = '${id}'`), /append-only/);
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET result = 'ELIGIBLE_CURRENT_POLICY' WHERE id = '${id}'`), /append-only/);
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM dispute_case_policy_eligibility_reviews WHERE id = '${id}'`), /append-only/);
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE dispute_policy_review_events SET note = 'x' WHERE review_id = '${id}'`), /append-only/);
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM dispute_policy_review_events WHERE review_id = '${id}'`), /append-only/);
  await assert.rejects(
    prisma.$executeRawUnsafe(`INSERT INTO dispute_case_policy_eligibility_reviews (id, case_id, contract_id, result, evidence_ids, reasoning, proposed_by) VALUES (gen_random_uuid(), NULL, '${x.contract.id}', 'ELIGIBLE_CURRENT_POLICY', '{}', 'x', 'p')`),
    /dc_policy_review_evidence_present|check/i,
    "no case and no references: refused by the database",
  );
});

test("evidence is a VERIFIABLE reference, never text: unknown, foreign, draft and malformed references are refused; nothing is written", async () => {
  const x = await mkContract();
  const y = await mkContract();
  const draftAcc = await prisma.ptTermsAcceptance.create({ data: { userId: x.ptUserId, version: "2026-10-pt-draft-6", source: "RECONFIRM" } });
  const draftAudit = await prisma.auditLog.create({ data: { actorUserId: x.ptUserId, action: "CONTRACT_ACTIVE", entityType: "CONTRACT", entityId: x.contract.id, metadata: { ptTermsVersion: "2026-10-pt-draft-6" } } });
  const inv = admin();
  const go = (evidenceRefs: unknown, extra: Record<string, unknown> = {}) => call("POST", P(x.contract.id), A(inv), { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs, reasoning: "x", ...extra });
  const code = async (r: ReturnType<typeof go>) => (await r).json.code;

  assert.equal(await code(go([{ kind: "PT_TERMS_ACCEPTANCE", id: draftAcc.id }])), "EVIDENCE_REF_NOT_PROOF", "a draft terms version is never proof");
  assert.equal(await code(go([{ kind: "CONTRACT_AUDIT_LOG", id: draftAudit.id }])), "EVIDENCE_REF_NOT_PROOF", "an audit row that states a draft version is not proof either");
  assert.equal(await code(go([{ kind: "PT_TERMS_ACCEPTANCE", id: y.acc.id }])), "EVIDENCE_REF_NOT_IN_CONTRACT", "another PT's acceptance");
  assert.equal(await code(go([{ kind: "CONTRACT_AUDIT_LOG", id: y.audit.id }])), "EVIDENCE_REF_NOT_IN_CONTRACT", "another contract's audit row");
  assert.equal(await code(go([{ kind: "PT_TERMS_ACCEPTANCE", id: randomUUID() }])), "EVIDENCE_REF_NOT_FOUND");
  assert.equal(await code(go([{ kind: "CONTRACT_AUDIT_LOG", id: randomUUID() }])), "EVIDENCE_REF_NOT_FOUND");
  // free text / wrong shapes are not references at all
  for (const bad of [["Hợp đồng đã được chấp nhận"], [], [{ kind: "FREE_TEXT", id: x.acc.id }], [{ kind: "PT_TERMS_ACCEPTANCE", id: "not-a-uuid" }], [{ kind: "PT_TERMS_ACCEPTANCE", id: x.acc.id, note: "x" }]]) {
    const r = await go(bad as unknown);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "INVALID_INPUT");
  }
  // strict body: the old case-level fields, a case id or a policy basis are refused
  for (const extra of [{ evidenceIds: [randomUUID()] }, { caseId: randomUUID() }, { contractId: randomUUID() }, { policyBasis: "x" }, { approved: true }]) {
    assert.equal((await go(refsOf(x), extra)).status, 400, JSON.stringify(extra));
  }
  assert.equal((await call("POST", P(x.contract.id), A(inv), { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: refsOf(x) })).status, 400, "reasoning is required (as an explanation)");
  assert.equal(await reviewRows(x.contract.id), 0, "every refusal wrote nothing");
  assert.equal(await prisma.disputePolicyReviewEvent.count({ where: { contractId: x.contract.id } }), 0);
  // reasoning is explanation only: text that SAYS "official terms accepted" with a refused reference still does not work
  assert.equal(await code(go([{ kind: "PT_TERMS_ACCEPTANCE", id: draftAcc.id }], { reasoning: "Đã có điều khoản chính thức, khách và PT đều đã chấp nhận" })), "EVIDENCE_REF_NOT_PROOF");
});

test("four eyes and conflict of interest over HTTP: contract parties cannot propose or approve, the proposer cannot approve, a missing declaration is refused, an approval is one-time", async () => {
  const x = await mkContract();
  const P1 = admin();
  const body = { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: refsOf(x), reasoning: "Đối chiếu bản ghi" };
  // non-admins
  assert.equal((await call("POST", P(x.contract.id), null, body)).status, 401);
  assert.equal((await call("POST", P(x.contract.id), `CUSTOMER:${x.clientUserId}`, body)).status, 403);
  assert.equal((await call("POST", P(x.contract.id), `PT:${x.ptUserId}`, body)).status, 403);
  // an ADMIN who is the client / PT of the contract (a person holding both roles in the data)
  assert.equal((await call("POST", P(x.contract.id), `ADMIN:${x.clientUserId}`, body)).json.code, "CONFLICT_OF_INTEREST");
  assert.equal((await call("POST", P(x.contract.id), `ADMIN:${x.ptUserId}`, body)).json.code, "CONFLICT_OF_INTEREST");
  assert.equal((await call("POST", P(randomUUID()), A(P1), body)).json.code, "CONTRACT_NOT_FOUND");
  assert.equal(await reviewRows(x.contract.id), 0);

  const proposed = (await call("POST", P(x.contract.id), A(P1), body)).json;
  const ap = (token: string, over: Record<string, unknown> = {}) => call("POST", `${P(x.contract.id)}/${proposed.reviewId}/approve`, token, { reason: "ok", conflictOfInterestDeclaredNone: true, ...over });
  assert.equal((await ap(A(P1))).json.code, "SELF_APPROVAL_FORBIDDEN");
  assert.equal((await ap(`ADMIN:${x.clientUserId}`)).json.code, "CONFLICT_OF_INTEREST");
  assert.equal((await ap(`ADMIN:${x.ptUserId}`)).json.code, "CONFLICT_OF_INTEREST");
  const P2 = admin();
  assert.equal((await ap(A(P2), { conflictOfInterestDeclaredNone: false })).json.code, "CONFLICT_OF_INTEREST");
  assert.equal((await ap(`CUSTOMER:${randomUUID()}`)).status, 403);
  assert.equal((await ap(A(P2), { approvedBy: P2.id })).status, 400, "strict body");
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED", "no refusal approved anything");
  assert.equal((await ap(A(P2))).status, 200);
  assert.equal((await ap(A(admin()))).json.code, "POLICY_REVIEW_ALREADY_APPROVED");
  // a review of another contract / an unknown or case-level id is not found under this path
  const z = await mkContract();
  assert.equal((await call("POST", `${P(z.contract.id)}/${proposed.reviewId}/approve`, A(admin()), { reason: "x", conflictOfInterestDeclaredNone: true })).json.code, "POLICY_REVIEW_NOT_FOUND");
  assert.equal((await call("POST", `${P(x.contract.id)}/${randomUUID()}/approve`, A(admin()), { reason: "x", conflictOfInterestDeclaredNone: true })).json.code, "POLICY_REVIEW_NOT_FOUND");
});

test("a reference that stops matching its source before approval is refused (the approver approves what is true now)", async () => {
  const x = await mkContract();
  const proposed = (await call("POST", P(x.contract.id), A(admin()), { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: [{ kind: "CONTRACT_AUDIT_LOG", id: x.audit.id }], reasoning: "x" })).json;
  await prisma.auditLog.update({ where: { id: x.audit.id }, data: { metadata: { ptTermsVersion: "2026-11-pt-v1", tampered: true } } });
  const r = await call("POST", `${P(x.contract.id)}/${proposed.reviewId}/approve`, A(admin()), { reason: "x", conflictOfInterestDeclaredNone: true });
  assert.deepEqual([r.status, r.json.code], [409, "EVIDENCE_REF_CHANGED"]);
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED");
});

test("supersede: the newest APPROVED review wins (EXCEPTION after ELIGIBLE closes the contract again); a review of another contract cannot be superseded", async () => {
  const x = await mkContract();
  const y = await mkContract();
  const mk = async (c: typeof x, result: string, supersedesId?: string) => (await call("POST", P(c.contract.id), A(admin()), { result, evidenceRefs: refsOf(c), reasoning: "r", ...(supersedesId ? { supersedesId } : {}) })).json;
  const first = await mk(x, "ELIGIBLE_CURRENT_POLICY");
  await call("POST", `${P(x.contract.id)}/${first.reviewId}/approve`, A(admin()), { reason: "ok", conflictOfInterestDeclaredNone: true });
  assert.equal(await guardCode(x.contract.id), "PASSES");
  const other = await mk(y, "ELIGIBLE_CURRENT_POLICY");
  const foreign = await call("POST", P(x.contract.id), A(admin()), { result: "EXCEPTION_APPLIES", evidenceRefs: refsOf(x), reasoning: "r", supersedesId: other.reviewId });
  assert.deepEqual([foreign.status, foreign.json.code], [422, "SUPERSEDES_INVALID"]);
  assert.equal((await call("POST", P(x.contract.id), A(admin()), { result: "EXCEPTION_APPLIES", evidenceRefs: refsOf(x), reasoning: "r", supersedesId: randomUUID() })).json.code, "SUPERSEDES_INVALID");
  const second = await mk(x, "EXCEPTION_APPLIES", first.reviewId);
  assert.equal(await guardCode(x.contract.id), "PASSES", "a pending superseding review changes nothing yet");
  await call("POST", `${P(x.contract.id)}/${second.reviewId}/approve`, A(admin()), { reason: "ok", conflictOfInterestDeclaredNone: true });
  assert.equal(await guardCode(x.contract.id), "POLICY_EXCEPTION_APPLIES");
  const list = (await call("GET", P(x.contract.id), A(admin()))).json;
  assert.equal(list.currentReviewId, second.reviewId);
  assert.equal(list.items.find((i: any) => i.reviewId === second.reviewId).supersedesId, first.reviewId);
});

test("Idempotency-Key: the same key + body replays the stored answer (one row, one event); another body under the same key is 409; approve replays too", async () => {
  const x = await mkContract();
  const P1 = admin();
  const body = { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: refsOf(x), reasoning: "r" };
  const a = await call("POST", P(x.contract.id), A(P1), body, { "Idempotency-Key": "k-cp-1" });
  const b = await call("POST", P(x.contract.id), A(P1), body, { "Idempotency-Key": "k-cp-1" });
  assert.deepEqual([a.status, b.status, b.headers.get("idempotent-replay")], [201, 200, "true"]);
  assert.equal(b.json.reviewId, a.json.reviewId);
  assert.equal(await reviewRows(x.contract.id), 1);
  assert.equal((await call("POST", P(x.contract.id), A(P1), { ...body, reasoning: "khác" }, { "Idempotency-Key": "k-cp-1" })).json.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await call("POST", P(x.contract.id), A(P1), body, { "Idempotency-Key": "bad key!" })).json.code, "INVALID_IDEMPOTENCY_KEY");
  const P2 = admin();
  const ap = () => call("POST", `${P(x.contract.id)}/${a.json.reviewId}/approve`, A(P2), { reason: "ok", conflictOfInterestDeclaredNone: true }, { "Idempotency-Key": "k-cp-ap" });
  const first = await ap();
  const again = await ap();
  assert.deepEqual([first.status, again.status, again.headers.get("idempotent-replay")], [200, 200, "true"]);
  assert.equal(await prisma.disputePolicyReviewEvent.count({ where: { reviewId: a.json.reviewId } }), 2, "one propose + one approve event, not four");
});

test("classifier (read-only): shows the group and the missing facts, writes NOTHING, is admin only, and NEVER makes the guard pass - not even with an official PT acceptance on file", async () => {
  const x = await mkContract();
  const inv = admin();
  const rowsBefore = [await reviewRows(x.contract.id), await prisma.disputePolicyReviewEvent.count(), await prisma.disputeCase.count()];
  const cl = await call("GET", `/admin/dispute-cases/contracts/${x.contract.id}/policy-classification`, A(inv));
  assert.equal(cl.status, 200, JSON.stringify(cl.json));
  assert.deepEqual([cl.json.autoEligible, cl.json.reviewRequired, cl.json.group], [false, true, "INSUFFICIENT_DATA"]);
  const codes = cl.json.missing.map((m: any) => m.code);
  for (const need of ["NO_EFFECTIVE_POLICY_VERSION", "NO_CLIENT_ACCEPTANCE"]) assert.ok(codes.includes(need), `${need} in ${codes}`);
  assert.equal(cl.json.facts.clientAcceptance.available, false);
  assert.equal(cl.json.facts.effectivePolicy.available, false);
  assert.equal(cl.json.facts.ptAcceptances[0].version, "2026-11-pt-v1");
  assert.equal(cl.json.facts.ptAcceptances[0].isDraft, false);
  assert.equal(cl.json.facts.ptTermsAtAcceptance.version, "2026-11-pt-v1");
  assert.equal(cl.json.reviewCutoff.role, "REVIEW_HINT_ONLY");
  assert.ok(!JSON.stringify(cl.json).includes("ipAddress") && !JSON.stringify(cl.json).includes("userAgent"));
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED", "classifying changed nothing");
  assert.deepEqual([await reviewRows(x.contract.id), await prisma.disputePolicyReviewEvent.count(), await prisma.disputeCase.count()], rowsBefore, "no row written");

  // a contract created BEFORE the review cutoff is only HINTED as historical
  await prisma.contract.update({ where: { id: x.contract.id }, data: { createdAt: new Date("2026-10-01T00:00:00Z") } });
  const old = (await call("GET", `/admin/dispute-cases/contracts/${x.contract.id}/policy-classification`, A(inv))).json;
  assert.equal(old.group, "HISTORICAL_NOTICE");
  assert.equal(old.autoEligible, false);
  assert.equal(await guardCode(x.contract.id), "POLICY_ELIGIBILITY_UNVERIFIED", "the cutoff is a hint, never proof");

  // an approved EXCEPTION review is shown as EXCEPTION_VERIFIED - and the guard answers its own way
  const pr = (await call("POST", P(x.contract.id), A(inv), { result: "EXCEPTION_APPLIES", evidenceRefs: refsOf(x), reasoning: "r" })).json;
  await call("POST", `${P(x.contract.id)}/${pr.reviewId}/approve`, A(admin()), { reason: "ok", conflictOfInterestDeclaredNone: true });
  const ex = (await call("GET", `/admin/dispute-cases/contracts/${x.contract.id}/policy-classification`, A(inv))).json;
  assert.deepEqual([ex.group, ex.facts.reviews.currentResult], ["EXCEPTION_VERIFIED", "EXCEPTION_APPLIES"]);
  assert.equal(await guardCode(x.contract.id), "POLICY_EXCEPTION_APPLIES");

  assert.equal((await call("GET", `/admin/dispute-cases/contracts/${x.contract.id}/policy-classification`, `CUSTOMER:${x.clientUserId}`)).status, 403);
  assert.equal((await call("GET", `/admin/dispute-cases/contracts/${x.contract.id}/policy-classification`, null)).status, 401);
  assert.equal((await call("GET", `/admin/dispute-cases/contracts/${randomUUID()}/policy-classification`, A(inv))).json.code, "CONTRACT_NOT_FOUND");
});

test("classifier rule (pure): NEW_CURRENT_POLICY needs EVERY machine condition; with today's data it is unreachable, and even when reached autoEligible stays false", () => {
  const contract = { id: "c", status: "ACTIVE", createdAt: new Date("2026-11-02T00:00:00Z"), startDate: null };
  const pt = { id: "a1", version: "2026-11-pt-v1", source: "RECONFIRM", acceptedAt: new Date("2026-11-01T00:00:00Z"), isDraft: false };
  const reviews = { currentReviewId: null, currentResult: null, pending: 0 };
  const policy = { version: "policy-v1", effectiveFrom: new Date("2026-11-01T00:00:00Z"), isDraft: false };
  const client = { version: "policy-v1", acceptedAt: new Date("2026-11-01T12:00:00Z") };
  const link = { auditLogId: "l1", version: "2026-11-pt-v1", at: new Date("2026-11-02T00:00:00Z") };
  const full = { contract, ptAcceptances: [pt], ptTermsAtAcceptance: link, reviews, effectivePolicy: policy, clientAcceptance: client };
  const g = (over: Record<string, unknown>) => classifyContractPolicy({ ...full, ...over } as never).group;

  assert.equal(g({}), "NEW_CURRENT_POLICY");
  assert.equal(classifyContractPolicy(full as never).autoEligible, false);
  assert.equal(g({ effectivePolicy: null }), "INSUFFICIENT_DATA", "no policy version source");
  assert.equal(g({ effectivePolicy: { ...policy, isDraft: true } }), "INSUFFICIENT_DATA", "a draft policy is not proof");
  assert.equal(g({ clientAcceptance: null }), "INSUFFICIENT_DATA", "PT acceptance never implies client acceptance");
  assert.equal(g({ ptAcceptances: [{ ...pt, isDraft: true, version: "2026-10-pt-draft-6" }] }), "INSUFFICIENT_DATA");
  assert.equal(g({ ptTermsAtAcceptance: { ...link, version: "2026-10-pt-draft-6" } }), "INSUFFICIENT_DATA");
  assert.equal(g({ ptTermsAtAcceptance: null }), "INSUFFICIENT_DATA");
  assert.equal(g({ contract: { ...contract, createdAt: new Date("2026-10-30T00:00:00Z") } }), "INSUFFICIENT_DATA", "created before the policy's effective date");
  assert.equal(g({ contract: { ...contract, createdAt: new Date("2026-10-19T00:00:00Z") }, effectivePolicy: null }), "HISTORICAL_NOTICE");
  assert.equal(g({ reviews: { ...reviews, currentResult: "EXCEPTION_APPLIES" } }), "EXCEPTION_VERIFIED");
  assert.equal(REVIEW_CUTOFF.toISOString(), "2026-10-19T17:00:00.000Z");
  // today's inputs (no policy source, no client source) can never reach it
  assert.notEqual(classifyContractPolicy({ contract, ptAcceptances: [pt], ptTermsAtAcceptance: link, reviews } as never).group, "NEW_CURRENT_POLICY");
});

test("a contract-level review lets the ruling door through WITHOUT any Case: no review -> 409 POLICY_ELIGIBILITY_UNVERIFIED, approved ELIGIBLE -> the old door rules the disputed session; nothing was blocked globally", async () => {
  const x = await mkContract();
  const session = await addSession(x.contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), { sessionMode: "ONLINE", disputeType: "DELIVERY_DISPUTE", disputedAt: new Date(Date.now() - 3600_000), disputeReason: "x", ptNotes: "y" });
  const inv = admin();
  const resolve = () => call("POST", `/admin/sessions/${session.id}/resolve`, A(inv), { resolution: "CANCELLED", note: "Không diễn ra, không lỗi bên nào" });
  const blocked = await resolve();
  assert.deepEqual([blocked.status, blocked.json.code], [409, "POLICY_ELIGIBILITY_UNVERIFIED"]);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status, "DISPUTED");

  const pr = (await call("POST", P(x.contract.id), A(inv), { result: "ELIGIBLE_CURRENT_POLICY", evidenceRefs: refsOf(x), reasoning: "r" })).json;
  assert.equal((await resolve()).json.code, "POLICY_ELIGIBILITY_UNVERIFIED", "pending review: still closed");
  await call("POST", `${P(x.contract.id)}/${pr.reviewId}/approve`, A(admin()), { reason: "ok", conflictOfInterestDeclaredNone: true });
  const ruled = await resolve();
  assert.equal(ruled.status, 200, JSON.stringify(ruled.json));
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status, "CANCELLED");
  assert.equal(await prisma.disputeCase.count({ where: { contractId: x.contract.id } }), 0, "ruled with no Case at all");
});
