/**
 * Q5 (owner approved 14/11/2026, N13E-08): an appeal of a gym complaint case reviewed AFTER the refund was executed must never get stuck. The independent reviewer ends
 * it with one of three results and the case CLOSES: UPHOLD (nothing more), OVERTURN in favour of the member (a supplementary refund of ONLY the difference, rounded DOWN
 * to 1,000, four-eyes, idempotent), OVERTURN in favour of the gym (decision + a manual-handling record, the member's wallet is never debited).
 *
 * BACKEND INTEGRATION: REAL HTTP into the real gym-service app + real service code on the isolated *_test database. TEST FIXTURE: gym / membership rows, the auth token
 * table, captured notifications, a RECORDING FAKE of payment-service's HTTP client (it answers with the REAL route's response shape; the route itself - gym 90 % from the gym wallet, platform 10 % from REVENUE, GYM_DEBT when the gym is short, idempotent, over-cap refused - is covered by payment-service's membership-appeal-supplement.integration.test.ts), and the case's refund quote
 * (price 700,000, amount set to a chosen value so the money arithmetic is exact and independent of the clock).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { userClient } from '../clients/user.client';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { setAccountLockLookupForTests } from '../services/complaint-case/deadlines.service';
import { supplementaryRefundAmount } from '../services/complaint-case/rules';
import { approve, call, cleanup, driveToProposal, installStubs, newAdmin, ok, patch, removeStubs, setFlag, skip, startApp, stopApp } from './complaint-case.test-helpers';

const pay = {
  releases: [] as Array<{ id: string; refund: string }>,
  supplements: [] as Array<{ amount: string; key: string; transactionId: string; clientId: string }>,
  supplementFailure: null as null | { status: number; code?: string },
  gymShortfall: null as null | string,
  adminNotices: [] as string[],
  restore: [] as Array<() => void>,
};

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  pay.restore.push(
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => {
      pay.releases.push({ id: String(b.idempotencyKey).replace('MEMBERSHIP_RELEASE:', ''), refund: b.refundToClient });
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: b.refundToClient ?? '0.00', shortfall: '0.00' };
    }),
    patch(paymentClient, 'clawbackReferral', async () => ({ recovered: '0.00', shortfall: '0.00' })),
    patch(paymentClient, 'refundMembershipSupplement', async (b: any) => {
      if (pay.supplementFailure) throw Object.assign(new Error(pay.supplementFailure.code ?? 'NOT_FOUND'), { status: pay.supplementFailure.status });
      pay.supplements.push({ amount: b.amount, key: b.idempotencyKey, transactionId: b.transactionId, clientId: b.clientId });
      // the REAL route's answer (payment-service Q1): the member is paid in full (shortfall 0.00); gymShortfall is the gym's unfunded share, fronted by the platform
      const amount = Number(b.amount);
      const gymShare = Math.floor(amount * 0.9);
      const gymShortfall = Number(pay.gymShortfall ?? 0);
      return {
        refundedToClient: b.amount, shortfall: '0.00', gymShare: gymShare.toFixed(2), gymDebited: (gymShare - gymShortfall).toFixed(2), gymShortfall: gymShortfall.toFixed(2),
        platformShare: (amount - gymShare).toFixed(2), platformDebited: (amount - gymShare + gymShortfall).toFixed(2), ...(gymShortfall > 0 ? { obligationId: 'obl-test-1' } : {}),
      };
    }),
    patch(userClient, 'notifyAdmins', async (p: any) => {
      pay.adminNotices.push(p.eventType);
    }),
  );
});
test.after(async () => {
  setFlag(undefined);
  while (pay.restore.length) pay.restore.pop()!();
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.beforeEach(() => {
  if (skip) return;
  setFlag(true);
  setAccountLockLookupForTests(async () => false);
  pay.releases.length = 0;
  pay.supplements.length = 0;
  pay.adminNotices.length = 0;
  pay.supplementFailure = null;
  pay.gymShortfall = null;
});
test.afterEach(async () => {
  if (skip) return;
  setAccountLockLookupForTests();
  await cleanup();
});

const PRICE = 700_000;
const actor = (a: { id: string }) => ({ id: a.id, role: 'ADMIN' });

/** Original case: ESTABLISHED, refund of `refunded` EXECUTED (membership CANCELLED), then the member appeals and an independent reviewer records `reviewerFinding`. */
async function refundedThenReviewed(refunded: number, reviewerFinding: 'ESTABLISHED' | 'NOT_ESTABLISHED') {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED', membership: { price: PRICE, days: 30 } });
  // TEST FIXTURE: the quote is append-only; its amount is set with the trigger switched off (this isolated database only) so the arithmetic is exact and clock-independent
  await prisma.$executeRawUnsafe('ALTER TABLE gym_case_refund_quotes DISABLE TRIGGER gym_case_refund_quotes_append_only');
  try {
    await prisma.$executeRawUnsafe('UPDATE gym_case_refund_quotes SET price_paid = $1, amount = $2 WHERE case_id = $3::uuid', PRICE, refunded, d.caseId);
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE gym_case_refund_quotes ENABLE TRIGGER gym_case_refund_quotes_append_only');
  }
  assert.equal((await approve(d)).status, 200);
  const first = await complaintCaseExecutionService.executeDecision(actor(d.appr), d.caseId);
  assert.equal(first.executionState, 'BUSINESS_DONE');
  assert.equal(pay.releases.length, 1);
  assert.equal(pay.releases[0].refund, String(refunded));
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: d.membershipId! } })).status, 'CANCELLED');

  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'Tôi cho rằng mình đáng được hoàn nhiều hơn' })).status, 201);
  const rev = newAdmin();
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: rev.id }), 200, 'assign reviewer');
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, rev.tok), 200, 'detail');
  ok(
    await call('POST', `/admin/complaint-cases/${d.caseId}/assessments`, rev.tok, {
      claimId: detail.claims[0].id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: reviewerFinding, reasoning: 'r',
    }),
    201,
    'assess',
  );
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, rev.tok, { finding: reviewerFinding, reasoning: 'Kết luận độc lập của người xem xét kháng nghị' }), 201, 'finding');
  // the membership record changed (CANCELLED by the refund) after the case's evidence was collected: the reviewer re-collects before proposing (existing evidence guard)
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/recollect`, rev.tok, {}), 200, 'recollect');
  return { d, rev };
}

async function decideAndExecute(d: { caseId: string }, rev: { id: string; tok: string }) {
  const approver2 = newAdmin();
  const self = await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, rev.tok, { result: 'APPROVED', reason: 'tự duyệt', conflictOfInterestDeclaredNone: true });
  assert.equal(self.body.error.code, 'SELF_APPROVAL_FORBIDDEN', 'four eyes: the reviewer who proposed cannot approve');
  const dec = await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, approver2.tok, { result: 'APPROVED', reason: 'đồng ý kết quả kháng nghị', conflictOfInterestDeclaredNone: true });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
  return approver2;
}

const events = async (caseId: string, action: string) => prisma.gymCaseEvent.findMany({ where: { caseId, action } });

test('Q5 rules: the supplement is the remainder rounded DOWN to 1,000 and never above what is still refundable', () => {
  assert.equal(supplementaryRefundAmount(700_000, 630_000), 70_000);
  assert.equal(supplementaryRefundAmount(700_000, 630_400), 69_000);
  assert.equal(supplementaryRefundAmount(700_000, 699_000), 1_000);
  assert.equal(supplementaryRefundAmount(700_000, 699_500), 0);
  assert.equal(supplementaryRefundAmount(700_000, 700_000), 0);
  assert.equal(supplementaryRefundAmount(700_000, 800_000), 0, 'never negative');
  assert.equal(supplementaryRefundAmount(299_999.84, 299_000), 0);
});

test('Q5 UPHOLD: finding ESTABLISHED after the refund -> RESOLVE_UPHELD, four-eyes, execute closes the case, NO money, replay is the same answer', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'ESTABLISHED');
  // a result that contradicts the finding is refused and creates nothing
  const bad = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_GYM' });
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error.code, 'APPEAL_RESULT_MISMATCH');
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: d.caseId } }), 1, 'only the original proposal exists');

  const prop = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, {});
  assert.equal(prop.status, 201, JSON.stringify(prop.body));
  assert.equal(prop.body.data.outcome, 'RESOLVE_UPHELD');
  assert.equal(prop.body.data.afterRefundAppeal, true);
  const approver2 = await decideAndExecute(d, rev);

  const ex = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.executionState, 'BUSINESS_DONE');
  assert.equal(ex.body.data.outcome, 'RESOLVE_UPHELD');
  assert.equal(ex.body.data.closure, 'CLOSED');
  assert.equal(ex.body.data.money.state, 'NO_MONEY_EFFECT');
  assert.equal(pay.releases.length, 1, 'no second refund');
  assert.equal(pay.supplements.length, 0, 'nothing more is paid');
  const replay = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(replay.body.data.replayed, true);
  assert.equal(pay.supplements.length, 0);
  const row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.deepEqual([row.status, row.execStatus], ['DECISION_APPROVED', 'BUSINESS_DONE']);
  assert.equal((await events(d.caseId, 'APPEAL_GYM_FAVOUR_MANUAL_HANDLING')).length, 0, 'no manual-handling record for an upheld appeal');
  const complaint = await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } });
  assert.match(String(complaint.adminResponse), /giữ nguyên kết quả trước đó/);
});

test('Q5 OVERTURN in favour of the MEMBER: supplementary refund of ONLY the difference (70,000 = 700,000 - 630,000), four-eyes, executed once under a stable key', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'ESTABLISHED');
  const prop = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_MEMBER' });
  assert.equal(prop.status, 201, JSON.stringify(prop.body));
  assert.equal(prop.body.data.outcome, 'REFUND_APPEAL_SUPPLEMENT');
  assert.equal(prop.body.data.supplementAmount, '70000.00');
  const approver2 = await decideAndExecute(d, rev);
  const approval = await prisma.gymCaseApproval.findFirstOrThrow({ where: { proposal: { caseId: d.caseId, outcome: 'REFUND_APPEAL_SUPPLEMENT' } } });

  const ex = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.outcome, 'REFUND_APPEAL_SUPPLEMENT');
  assert.equal(ex.body.data.money.state, 'LEDGER_POSTED_FULL');
  assert.equal(ex.body.data.money.postedToMemberWallet, '70000.00');
  assert.equal(ex.body.data.closure, 'CLOSED');
  assert.equal(pay.releases.length, 1, 'the original refund is not repeated');
  assert.equal(pay.supplements.length, 1);
  assert.equal(pay.supplements[0].amount, '70000.00');
  assert.equal(pay.supplements[0].key, `GYM_CASE_APPEAL_SUPPLEMENT:${approval.id}`);
  assert.equal(pay.supplements[0].clientId, d.reporter.id);
  // total paid to the member = 630,000 + 70,000 = the price, never more
  assert.equal(Number(pay.releases[0].refund) + Number(pay.supplements[0].amount), PRICE);
  // idempotent: executing again replays, nothing is paid twice
  const again = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(again.body.data.replayed, true);
  assert.equal(pay.supplements.length, 1);
  assert.equal(pay.releases.length, 1);
  const complaint = await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } });
  assert.match(String(complaint.adminResponse), /70\.000/);
});

test('Q5 OVERTURN in favour of the MEMBER: the difference is rounded DOWN to 1,000 (700,000 - 630,400 = 69,600 -> 69,000); a remainder under 1,000 leaves nothing to propose', { skip }, async () => {
  const a = await refundedThenReviewed(630_400, 'ESTABLISHED');
  const prop = await call('POST', `/admin/complaint-cases/${a.d.caseId}/proposal`, a.rev.tok, { appealResult: 'OVERTURN_MEMBER' });
  assert.equal(prop.status, 201, JSON.stringify(prop.body));
  assert.equal(prop.body.data.supplementAmount, '69000.00');
  const approver2 = await decideAndExecute(a.d, a.rev);
  const ex = await call('POST', `/admin/complaint-cases/${a.d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(pay.supplements[0].amount, '69000.00');
  assert.ok(Number(pay.releases[0].refund) + Number(pay.supplements[0].amount) <= PRICE);

  pay.supplements.length = 0;
  pay.releases.length = 0;
  const b = await refundedThenReviewed(699_500, 'ESTABLISHED');
  const none = await call('POST', `/admin/complaint-cases/${b.d.caseId}/proposal`, b.rev.tok, { appealResult: 'OVERTURN_MEMBER' });
  assert.equal(none.status, 409);
  assert.equal(none.body.error.code, 'NO_SUPPLEMENT_AVAILABLE');
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: b.d.caseId } }), 1);
  assert.equal(pay.supplements.length, 0);
  // the reviewer can still finish the case: UPHOLD
  const up = await call('POST', `/admin/complaint-cases/${b.d.caseId}/proposal`, b.rev.tok, { appealResult: 'UPHOLD' });
  assert.equal(up.body.data.outcome, 'RESOLVE_UPHELD');
});

test('Q5 OVERTURN for the MEMBER: a payment-service refusal leaves nothing moved (EXEC_BLOCKED), and the retry pays exactly once under the same key', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_MEMBER' }), 201, 'proposal');
  const approver2 = await decideAndExecute(d, rev);
  pay.supplementFailure = { status: 404 };
  const blocked = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'EXEC_BLOCKED');
  assert.equal(pay.supplements.length, 0, 'nothing moved');
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).execStatus, 'EXEC_BLOCKED');
  pay.supplementFailure = null;
  const retry = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(pay.supplements.length, 1);
  assert.equal(pay.supplements[0].amount, '70000.00');
  assert.equal(retry.body.data.closure, 'CLOSED');
});

test('Q5 OVERTURN in favour of the GYM: finding NOT_ESTABLISHED -> decision recorded + manual-handling record, admins told, the member is NOT debited, case CLOSED', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'NOT_ESTABLISHED');
  const wrong = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_MEMBER' });
  assert.equal(wrong.body.error.code, 'APPEAL_RESULT_MISMATCH');
  const prop = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, {});
  assert.equal(prop.status, 201, JSON.stringify(prop.body));
  assert.equal(prop.body.data.outcome, 'RESOLVE_INSUFFICIENT_EVIDENCE');
  assert.equal(prop.body.data.afterRefundAppeal, true);
  const approver2 = await decideAndExecute(d, rev);

  const ex = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.executionState, 'BUSINESS_DONE');
  assert.equal(ex.body.data.closure, 'CLOSED');
  assert.equal(ex.body.data.money.state, 'NO_MONEY_EFFECT');
  assert.equal(pay.releases.length, 1, 'no new ledger movement');
  assert.equal(pay.supplements.length, 0);
  const rec = await events(d.caseId, 'APPEAL_GYM_FAVOUR_MANUAL_HANDLING');
  assert.equal(rec.length, 1);
  const payload = rec[0].payload as any;
  assert.equal(payload.status, 'OPEN_MANUAL_HANDLING');
  assert.equal(payload.autoDebitMember, false);
  assert.equal(payload.refundedToMember, '630000.00');
  assert.equal(payload.membershipId, d.membershipId);
  assert.equal(payload.memberUserId, d.reporter.id);
  assert.deepEqual(pay.adminNotices.filter((e) => e === 'GYM_COMPLAINT_CASE_APPEAL_MANUAL_HANDLING'), ['GYM_COMPLAINT_CASE_APPEAL_MANUAL_HANDLING']);
  const again = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(again.body.data.replayed, true);
  assert.equal((await events(d.caseId, 'APPEAL_GYM_FAVOUR_MANUAL_HANDLING')).length, 1, 'recorded once');
  const complaint = await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } });
  assert.match(String(complaint.adminResponse), /không bị trừ lại/);
});

test('Q5: choosing an after-refund result when NO refund was ever executed is refused; the normal path still proposes the refund', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'NOT_ESTABLISHED', membership: { price: PRICE, days: 30 } });
  assert.equal((await approve(d)).status, 200);
  await complaintCaseExecutionService.executeDecision(actor(d.appr), d.caseId);
  assert.equal(pay.releases.length, 0);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'Có thêm biên lai' })).status, 201);
  const rev = newAdmin();
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: rev.id }), 200, 'assign reviewer');
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, rev.tok), 200, 'detail');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/assessments`, rev.tok, { claimId: detail.claims[0].id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, rev.tok, { finding: 'ESTABLISHED', reasoning: 'có biên lai' }), 201, 'finding');
  const refused = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'UPHOLD' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'APPEAL_RESULT_NOT_APPLICABLE');
  const normal = await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, {});
  assert.equal(normal.status, 201, JSON.stringify(normal.body));
  assert.equal(normal.body.data.outcome, 'REFUND_TRANSACTION_ERROR');
  assert.equal(normal.body.data.afterRefundAppeal, undefined);
});

test('Q1 OVERTURN for the MEMBER with a SHORT gym wallet: the member is still paid in full (case BUSINESS_DONE, LEDGER_POSTED_FULL), the gym shortfall + GYM_DEBT obligation id are recorded in the execution answer', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_MEMBER' }), 201, 'proposal');
  const approver2 = await decideAndExecute(d, rev);
  pay.gymShortfall = '5000';
  const ex = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.money.state, 'LEDGER_POSTED_FULL', 'the member is not short: the platform fronted the gym part');
  assert.equal(ex.body.data.money.postedToMemberWallet, '70000.00');
  assert.equal(ex.body.data.money.memberShortfall, null);
  assert.equal(ex.body.data.closure, 'CLOSED');
  const row = await prisma.gymCaseExecution.findFirstOrThrow({ where: { caseId: d.caseId, state: 'BUSINESS_DONE', outcome: 'REFUND_APPEAL_SUPPLEMENT' } });
  const payment = (row.response as any).payment;
  assert.equal(payment.gymShortfall, '5000.00');
  assert.equal(payment.gymDebtObligationId, 'obl-test-1');
  assert.equal(pay.supplements.length, 1);
});

test('Q1 OVERTURN for the MEMBER: payment-service refusing with 409 (EXCEEDS_REFUNDABLE / PLATFORM_FUNDS_INSUFFICIENT) leaves the case EXEC_BLOCKED with that reason, nothing paid, and the retry pays once', { skip }, async () => {
  const { d, rev } = await refundedThenReviewed(630_000, 'ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, { appealResult: 'OVERTURN_MEMBER' }), 201, 'proposal');
  const approver2 = await decideAndExecute(d, rev);
  pay.supplementFailure = { status: 409, code: 'PLATFORM_FUNDS_INSUFFICIENT' };
  const blocked = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'EXEC_BLOCKED');
  assert.match(String(blocked.body.error.details?.reason ?? ''), /SUPPLEMENT_REFUSED:PLATFORM_FUNDS_INSUFFICIENT/);
  assert.equal(pay.supplements.length, 0);
  pay.supplementFailure = null;
  const retry = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(pay.supplements.length, 1);
  assert.equal(retry.body.data.closure, 'CLOSED');
});
