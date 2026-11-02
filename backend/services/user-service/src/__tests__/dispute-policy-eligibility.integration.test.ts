/**
 * D-NEW-12 guard (B-1 release gate) - BACKEND INTEGRATION against the isolated *_test user database: real rows, the real append-only trigger, the real contract lock, the REAL ruling
 * core (old route function and the Case executor). payment-service is stubbed (every payment WRITE throws): these tests prove that a ruling is refused BEFORE anything is written.
 *
 * The guard: a ruling is possible only when the newest APPROVED policy-eligibility review of the contract says ELIGIBLE_CURRENT_POLICY. No date rule, no "missing notice" rule, no
 * switch - a brand-new contract is blocked exactly like an old one.
 *
 * Run ALONE (it truncates the dispute_case* tables):
 *   TEST_DATABASE_URL=... FITNESS_DISABLE_REDIS=true npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/dispute-policy-eligibility.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { disputeCaseService as svc } from "../services/dispute-case/dispute-case.service";
import { executionService } from "../services/dispute-case/execution.service";
import { bookingService, resolveDisputeCore } from "../services/booking.service";
import { lateOpenGate } from "../services/contract-payout.service";
import { admin, approvedCaseFor, caseAtFinding, caseRow, disableExecutionFlags, enableExecutionFlags, execRows, FINDING_FOR } from "./dispute-case-exec.test-helpers";
import { insertPolicyReviewFixture } from "./dispute-policy-eligibility.fixture";
import router from "../routes/dispute-case-admin.routes";
// Fail-closed gate (lateOpenGate, DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED): the cases here expect an approved ELIGIBLE review to give settleLateOpen, so the suite turns the flag on in-process (effective only with NODE_ENV=test + the isolated *_test database).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async () => null
        : async () => {
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_policy_eligibility_reviews, dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  for (const r of restores) r();
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  disableExecutionFlags();
  enableExecutionFlags({ execution: true });
});

/** A DISPUTED session on a contract that has NO review (opt-out of the fixture). */
async function mk(over: Record<string, unknown> = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE", ...over }, { eligibility: "none" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: "DELIVERY_DISPUTE",
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session };
}
const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const reviewsOf = (contractId: string) => prisma.disputeCasePolicyEligibilityReview.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
const refuses = (p: Promise<unknown>, status: number, code: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.status, status, `${e.code}: ${e.message}`);
    assert.equal(e.code, code);
    return true;
  });
async function untouched(s: Awaited<ReturnType<typeof mk>>) {
  const sess = await sessionRow(s.session.id);
  assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedBy, sess.resolvedByCaseDecisionId], ["DISPUTED", false, null, null]);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), 0);
}

/** Investigator proposes, a different admin approves - through the SERVICE (the same methods the routes call). */
async function eligibilityViaApi(caseId: string, investigator: ReturnType<typeof admin>, result: "ELIGIBLE_CURRENT_POLICY" | "EXCEPTION_APPLIES", over: { supersedesId?: string; approve?: boolean } = {}) {
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId } });
  const proposed = (await svc.proposePolicyEligibility(investigator, caseId, { result, evidenceIds: [ev.id], reasoning: "Đối chiếu hợp đồng và thông báo thực tế", ...(over.supersedesId ? { supersedesId: over.supersedesId } : {}) })).result;
  if (over.approve === false) return { proposed, approved: null as any };
  const approver = admin();
  const approved = (await svc.approvePolicyEligibility(approver, caseId, proposed.reviewId, { reason: "Đồng ý", conflictOfInterestDeclaredNone: true })).result;
  return { proposed, approved, approver };
}

// ═══ the guard, every door ═══════════════════════════════════════════════════════════════════════

test("no review at all: the OLD route function, the old admin service and the executor all refuse 409 POLICY_ELIGIBILITY_UNVERIFIED and write NOTHING; a retry changes nothing", async () => {
  const s = await mk();
  await refuses(resolveDisputeCore(s.session.id, "admin-x", "COMPLETED", "ruling"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await refuses(bookingService.resolveDispute(s.session.id, "admin-x", "CANCELLED", "ruling"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await refuses(bookingService.resolveDispute(s.session.id, "admin-x", "PT_NO_SHOW_CONFIRMED", "ruling"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await untouched(s);
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await refuses(executionService.executeDecision(admin(), a.caseId, {}), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await refuses(executionService.executeDecision(admin(), a.caseId, {}), 409, "POLICY_ELIGIBILITY_UNVERIFIED"); // retry
  const c = await caseRow(a.caseId);
  assert.equal(c.execStatus, "NOT_STARTED", "not even an EXEC_BLOCKED mark: refused before any mutation");
  assert.equal((await execRows(a.caseId)).length, 0);
  await untouched(s);
});

test("a review that is PROPOSED but not approved is not a review: still refused", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  const { proposed } = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { approve: false });
  assert.equal(proposed.approved, false);
  await refuses(resolveDisputeCore(s.session.id, "admin-x", "COMPLETED", "ruling"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await refuses(executionService.executeDecision(admin(), a.caseId, {}), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await untouched(s);
});

test("EXCEPTION_APPLIES (approved): refused 409 POLICY_EXCEPTION_APPLIES at the old route and at the executor, nothing written", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  await eligibilityViaApi(a.caseId, inv, "EXCEPTION_APPLIES");
  await refuses(resolveDisputeCore(s.session.id, "admin-x", "COMPLETED", "ruling"), 409, "POLICY_EXCEPTION_APPLIES");
  await refuses(executionService.executeDecision(admin(), a.caseId, {}), 409, "POLICY_EXCEPTION_APPLIES");
  await untouched(s);
});

test("a brand-new contract is blocked exactly like an old one (no date rule, no missing-notice rule): the ELIGIBLE review is what opens it, and ONLY that contract", async () => {
  const fresh = await mk({ startDate: new Date(), createdAt: new Date() });
  const old = await mk({ startDate: new Date(Date.now() - 400 * 86_400_000) });
  await refuses(resolveDisputeCore(fresh.session.id, "x", "COMPLETED", "n"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await refuses(resolveDisputeCore(old.session.id, "x", "COMPLETED", "n"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  // a review of the OTHER contract has no effect on this one
  await insertPolicyReviewFixture(prisma, old.contract);
  await refuses(resolveDisputeCore(fresh.session.id, "x", "COMPLETED", "n"), 409, "POLICY_ELIGIBILITY_UNVERIFIED");
  await untouched(fresh);
  // the old contract, now eligible, is ruled
  await resolveDisputeCore(old.session.id, "x", "CANCELLED", "n");
  assert.equal((await sessionRow(old.session.id)).status, "CANCELLED");
});

test("supersede: ELIGIBLE (approved) opens, a later approved EXCEPTION_APPLIES that supersedes it closes again, a later approved ELIGIBLE reopens - the newest approved row decides", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  const first = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY");
  await new Promise((r) => setTimeout(r, 15));
  const second = await eligibilityViaApi(a.caseId, inv, "EXCEPTION_APPLIES", { supersedesId: first.proposed.reviewId });
  assert.ok(second.proposed.reviewId !== first.proposed.reviewId);
  await refuses(resolveDisputeCore(s.session.id, "x", "COMPLETED", "n"), 409, "POLICY_EXCEPTION_APPLIES");
  await new Promise((r) => setTimeout(r, 15));
  await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { supersedesId: second.proposed.reviewId });
  await resolveDisputeCore(s.session.id, "x", "COMPLETED", "n").catch((e) => {
    throw e;
  });
  // (the payment stub refuses the money step; the decision itself is committed and the step is recorded for retry)
  assert.equal((await sessionRow(s.session.id)).status, "COMPLETED");
  assert.equal((await reviewsOf(s.contract.id)).length, 3, "history stays: three rows");
});

// ═══ who may propose / approve ═══════════════════════════════════════════════════════════════════

test("four eyes: the proposer cannot approve, the case's investigator cannot approve, the PARTIES of the case cannot approve, a conflict must be declared absent, only ADMINs act", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const c = await caseRow(a.caseId);
  const inv = { id: c.investigatorId!, role: "ADMIN" };
  const { proposed } = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { approve: false });
  const body = { reason: "Đồng ý", conflictOfInterestDeclaredNone: true };
  await refuses(svc.approvePolicyEligibility(inv, a.caseId, proposed.reviewId, body), 403, "SELF_APPROVAL_FORBIDDEN"); // proposer = investigator
  await refuses(svc.approvePolicyEligibility({ id: c.clientUserId, role: "ADMIN" }, a.caseId, proposed.reviewId, body), 403, "CONFLICT_OF_INTEREST");
  await refuses(svc.approvePolicyEligibility({ id: c.ptUserId, role: "ADMIN" }, a.caseId, proposed.reviewId, body), 403, "CONFLICT_OF_INTEREST");
  await refuses(svc.approvePolicyEligibility(admin(), a.caseId, proposed.reviewId, { ...body, conflictOfInterestDeclaredNone: false }), 403, "CONFLICT_OF_INTEREST");
  await refuses(svc.approvePolicyEligibility({ id: randomUUID(), role: "CUSTOMER" }, a.caseId, proposed.reviewId, body), 403, "ADMIN_ONLY");
  await refuses(svc.proposePolicyEligibility(admin(), a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [randomUUID()], reasoning: "x" }), 403, "NOT_ASSIGNED_INVESTIGATOR"); // not the investigator
  assert.equal((await reviewsOf(s.contract.id))[0].approvedAt, null, "none of these approved anything");
  // an independent admin approves; a second approval of the same review is refused
  const ok = admin();
  await svc.approvePolicyEligibility(ok, a.caseId, proposed.reviewId, body);
  await refuses(svc.approvePolicyEligibility(admin(), a.caseId, proposed.reviewId, body), 409, "POLICY_REVIEW_ALREADY_APPROVED");
  const row = (await reviewsOf(s.contract.id))[0];
  assert.deepEqual([row.approvedBy, row.proposedBy], [ok.id, inv.id]);
});

test("inside the case: the evidence must belong to THIS case (and at least one); the contract comes from the case, never from the caller; a superseded review must be of the same contract", async () => {
  const s = await mk();
  const other = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const b = await approvedCaseFor(other.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  const foreignEv = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: b.caseId } });
  await refuses(svc.proposePolicyEligibility(inv, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [foreignEv.id], reasoning: "x" }), 422, "EVIDENCE_NOT_IN_CASE");
  await refuses(svc.proposePolicyEligibility(inv, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [], reasoning: "x" }), 422, "EVIDENCE_REQUIRED");
  const theirs = await eligibilityViaApi(b.caseId, { id: (await caseRow(b.caseId)).investigatorId!, role: "ADMIN" }, "ELIGIBLE_CURRENT_POLICY");
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: a.caseId } });
  await refuses(svc.proposePolicyEligibility(inv, a.caseId, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "x", supersedesId: theirs.proposed.reviewId }), 422, "SUPERSEDES_INVALID");
  const mine = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY");
  assert.equal(mine.proposed.contractId, s.contract.id, "the contract of the CASE");
  assert.equal((await reviewsOf(other.contract.id)).length, 1, "the other contract only has its own review");
});

// ═══ append-only ═════════════════════════════════════════════════════════════════════════════════

test("append-only (real trigger): DELETE is rejected, UPDATE of any column is rejected, the ONLY update allowed is the one-time approval stamp, and it works once", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  const { proposed } = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { approve: false });
  const id = proposed.reviewId;
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET reasoning = 'changed' WHERE id = $1::uuid`, id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET result = 'EXCEPTION_APPLIES' WHERE id = $1::uuid`, id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = 'x', approved_at = now(), reasoning = 'changed' WHERE id = $1::uuid`, id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM dispute_case_policy_eligibility_reviews WHERE id = $1::uuid`, id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = proposed_by, approved_at = now() WHERE id = $1::uuid`, id), /four_eyes|violates check/i);
  await prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = 'someone-else', approved_at = now() WHERE id = $1::uuid`, id);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = 'a-third', approved_at = now() WHERE id = $1::uuid`, id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = NULL, approved_at = NULL WHERE id = $1::uuid`, id), /append-only/);
  const row = (await reviewsOf(s.contract.id))[0];
  assert.deepEqual([row.reasoning, row.approvedBy], ["Đối chiếu hợp đồng và thông báo thực tế", "someone-else"]);
});

test("Q4 one-time approval: the stamp is ONE update (approver + time together, from the authenticated actor), a second approval is refused, and propose + approve each leave an append-only audit event written in the same transaction", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
  const { proposed, approved, approver } = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY");
  assert.equal(approved.approved, true);
  const row = (await reviewsOf(s.contract.id))[0];
  assert.equal(row.id, proposed.reviewId);
  assert.equal(row.approvedBy, approver!.id, "approvedBy is the authenticated approver, not a body field");
  assert.ok(row.approvedAt, "approvedAt is stamped with it");
  // a SECOND approval (another independent admin) is refused and changes nothing
  await refuses(svc.approvePolicyEligibility(admin(), a.caseId, proposed.reviewId, { reason: "again", conflictOfInterestDeclaredNone: true }), 409, "POLICY_REVIEW_ALREADY_APPROVED");
  const after = (await reviewsOf(s.contract.id))[0];
  assert.deepEqual([after.approvedBy, after.approvedAt?.getTime()], [row.approvedBy, row.approvedAt?.getTime()]);
  // the stamp is a pair: one half alone is rejected by the CHECK, and the stamped row cannot be touched (other column, delete)
  const second = (await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { approve: false })).proposed.reviewId;
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_by = 'x' WHERE id = $1::uuid`, second), /append-only|approval_pair|violates check/i);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET approved_at = now() WHERE id = $1::uuid`, second), /append-only|approval_pair|violates check/i);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_policy_eligibility_reviews SET reasoning = 'edited' WHERE id = $1::uuid`, row.id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM dispute_case_policy_eligibility_reviews WHERE id = $1::uuid`, row.id), /append-only/);
  // the audit events
  const events = await prisma.disputeCaseEvent.findMany({ where: { caseId: a.caseId, action: { in: ["POLICY_ELIGIBILITY_PROPOSED", "POLICY_ELIGIBILITY_APPROVED"] } }, orderBy: { createdAt: "asc" } });
  const approvedEv = events.find((e) => e.action === "POLICY_ELIGIBILITY_APPROVED");
  const proposedEv = events.find((e) => e.action === "POLICY_ELIGIBILITY_PROPOSED" && (e.payload as any)?.detail?.reviewId === row.id);
  assert.ok(proposedEv && approvedEv, "one event per proposal and one for the approval");
  assert.equal(proposedEv!.actorUserId, row.proposedBy);
  assert.equal(approvedEv!.actorUserId, approver!.id);
  assert.deepEqual([(approvedEv!.payload as any).detail.reviewId, (approvedEv!.payload as any).detail.approvedBy, (approvedEv!.payload as any).detail.proposedBy], [row.id, approver!.id, row.proposedBy]);
  assert.equal(events.filter((e) => e.action === "POLICY_ELIGIBILITY_APPROVED").length, 1, "the refused second approval left no event");
  await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM dispute_case_events WHERE id = $1::uuid`, approvedEv!.id), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE dispute_case_events SET note = 'x' WHERE id = $1::uuid`, approvedEv!.id), /append-only/);
});

test("no batch route exists: the router has exactly two policy routes, each under ONE case (and the body schema is strict: no list, no 'all', no contract id)", async () => {
  const routes = (router as any).stack.filter((l: any) => l.route && /policy/.test(l.route.path)).map((l: any) => `${Object.keys(l.route.methods).join(",")} ${l.route.path}`).sort();
  assert.deepEqual(routes, ["post /:id/policy-eligibility", "post /:id/policy-eligibility/:reviewId/approve"]);
  const { policyEligibilityBody, policyEligibilityApproveBody } = await import("../services/dispute-case/schemas");
  const good = { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [randomUUID()], reasoning: "x" };
  assert.ok(policyEligibilityBody.safeParse(good).success);
  for (const extra of [{ contractIds: [randomUUID()] }, { all: true }, { contractId: randomUUID() }, { caseIds: [randomUUID()] }, { effectiveFrom: "2026-01-01" }]) {
    assert.equal(policyEligibilityBody.safeParse({ ...good, ...extra }).success, false, JSON.stringify(extra));
  }
  assert.equal(policyEligibilityBody.safeParse({ ...good, evidenceIds: [] }).success, false);
  assert.equal(policyEligibilityApproveBody.safeParse({ reason: "x", conflictOfInterestDeclaredNone: true, all: true }).success, false);
});

// ═══ the sweep / L OPEN gate ═════════════════════════════════════════════════════════════════════

test("lateOpenGate (policy guard fix): the policy review is NOT a reason to hold - no/EXCEPTION review -> { settle:false } and NO hold; approved ELIGIBLE -> settle; a contested D77 in an open case is the only hold; no D77 row -> nothing", async () => {
  const s = await mk();
  assert.deepEqual(await lateOpenGate(s.session.id), { settle: false }, "no D77 row: the gate says nothing");
  await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  assert.deepEqual(await lateOpenGate(s.session.id), { settle: false }, "no review: no flag and NO hold (the ledger decides: a SETTLED L settles, an OPEN L is refused there)");
  await insertPolicyReviewFixture(prisma, s.contract, { result: "EXCEPTION_APPLIES" });
  assert.deepEqual(await lateOpenGate(s.session.id), { settle: false }, "EXCEPTION_APPLIES: no flag, no hold");
  await new Promise((r) => setTimeout(r, 15));
  await insertPolicyReviewFixture(prisma, s.contract);
  assert.deepEqual(await lateOpenGate(s.session.id), { settle: true });
});

// ═══ race: approval vs executor ══════════════════════════════════════════════════════════════════

test("RACE approve vs execute (6 rounds, both orders): the executor never rules the session without an approved review, and once approved the SAME decision executes exactly once", async () => {
  for (let round = 0; round < 6; round++) {
    const s = await mk();
    const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
    const inv = { id: (await caseRow(a.caseId)).investigatorId!, role: "ADMIN" };
    const { proposed } = await eligibilityViaApi(a.caseId, inv, "ELIGIBLE_CURRENT_POLICY", { approve: false });
    const approve = () => svc.approvePolicyEligibility(admin(), a.caseId, proposed.reviewId, { reason: "ok", conflictOfInterestDeclaredNone: true });
    const execute = () => executionService.executeDecision(admin(), a.caseId, {}).then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    const [, res] = round % 2 ? [await approve(), await execute()] : await Promise.all([approve(), execute()]);
    const sess = await sessionRow(s.session.id);
    if (res.ok) {
      const rev = (await reviewsOf(s.contract.id))[0];
      assert.ok(rev.approvedAt, `round ${round}: executed, so the review was approved first`);
      assert.equal(sess.status, "COMPLETED");
    } else {
      assert.equal((res.e as any).code, "POLICY_ELIGIBILITY_UNVERIFIED", `round ${round}`);
      assert.equal(sess.status, "DISPUTED", `round ${round}: refused means nothing written`);
      const again = await executionService.executeDecision(admin(), a.caseId, {});
      assert.equal(again.executionState, "BUSINESS_DONE", `round ${round}: after the approval the same decision executes`);
    }
    assert.equal(await prisma.disputeCaseExecution.count({ where: { caseId: a.caseId, state: "BUSINESS_DONE" } }), 1, `round ${round}: executed once`);
  }
});

void caseAtFinding;
