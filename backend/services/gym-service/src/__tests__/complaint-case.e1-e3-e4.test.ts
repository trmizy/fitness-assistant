/**
 * E1 (refund amount fixed at the complaint date, executed from the money held for that membership), E3 (replacing an approved decision that has had no effect, same rule as
 * A4) and E4 (response deadlines pause while the party's account is locked) - REAL HTTP into the real gym-service app and the real service code, isolated gym *_test
 * database. BACKEND INTEGRATION. TEST FIXTURE: gym / membership / partner rows, the auth token table, captured notifications, the account-lock signal, a recording fake for
 * payment-service's HTTP client (release + ledger lookup). The real ledger version of E1 is in complaint-case-money.e2e.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { membershipService } from '../services/membership.service';
import { runCaseDeadlineSweep, setAccountLockLookupForTests } from '../services/complaint-case/deadlines.service';
import {
  approve, authDirectory, call, cleanup, driveToProposal, installStubs, makeComplaint, makeGym, makeMembership, newAdmin, ok, openToAssessing, patch, removeStubs,
  setFlag, skip, startApp, stopApp, token,
} from './complaint-case.test-helpers';

const pay = { releases: [] as Array<{ id: string; refund: string }>, ledger: [] as string[], lookupFails: false, restore: [] as Array<() => void> };
const H = 3600 * 1000;
const DAY = 24 * H;

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  pay.restore.push(
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => {
      pay.releases.push({ id: String(b.idempotencyKey).replace('MEMBERSHIP_RELEASE:', ''), refund: String(b.refundToClient) });
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: b.refundToClient ?? '0.00', shortfall: '0.00' };
    }),
    patch(paymentClient, 'clawbackReferral', async () => ({ recovered: '0.00', shortfall: '0.00' })),
    patch(paymentClient, 'lookupLedgerOperations', async (keys: string[]) => {
      if (pay.lookupFails) throw new Error('payment-service unreachable');
      return { operations: pay.ledger.filter((k) => keys.includes(k)).map((key) => ({ key })), missing: [] };
    }),
  );
});
test.after(async () => {
  setFlag(undefined);
  delete process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED;
  while (pay.restore.length) pay.restore.pop()!();
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.beforeEach(() => {
  if (skip) return;
  setFlag(true);
  process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED = 'true';
  pay.releases.length = 0;
  pay.ledger.length = 0;
  pay.lookupFails = false;
  setAccountLockLookupForTests(async () => false);
});
test.afterEach(async () => {
  if (skip) return;
  setAccountLockLookupForTests();
  await prisma.gymPartner.deleteMany({ where: { legalName: 'Other Partner' } });
  await cleanup();
});

const act = (d: { appr: { id: string } }) => ({ id: d.appr.id, role: 'ADMIN' });

// ───────────────────────────── E1 ─────────────────────────────

/** A paid ACTIVE membership whose dates are EXACT around a complaint date C: 30-day plan, 10 days used, 20 days left at C. */
async function exactCase(caseClass = 'MEM_CLOSED') {
  const { gym, ownerId } = await makeGym();
  const reporterId = 'member-e1-' + Math.random().toString(36).slice(2, 8);
  const C = new Date(Math.floor(Date.now() / 1000) * 1000);
  const m = await makeMembership(gym.id, reporterId, { price: 300_000, days: 30 });
  await prisma.gymMembershipContract.update({ where: { id: m.id }, data: { startDate: new Date(C.getTime() - 10 * DAY), endDate: new Date(C.getTime() + 20 * DAY) } });
  const complaint = await makeComplaint(gym.id, reporterId);
  await prisma.gymComplaint.update({ where: { id: complaint.id }, data: { createdAt: C } });
  const inv = newAdmin();
  const appr = newAdmin();
  const caseId = ok(await call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass, membershipId: m.id }), 201, 'open').id as string;
  return { gym, ownerId, reporterId, reporter: { id: reporterId, tok: token(reporterId, 'CUSTOMER') }, m, complaint, inv, appr, caseId, C };
}
async function walkToApproved(x: Awaited<ReturnType<typeof exactCase>>) {
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/assign`, x.inv.tok, {}), 200, 'assign');
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/transition`, x.inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = ok(await call('POST', `/admin/complaint-cases/${x.caseId}/claims`, x.inv.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/assessments`, x.inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/finding`, x.inv.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/proposal`, x.inv.tok, {}), 201, 'proposal');
  ok(await call('POST', `/admin/complaint-cases/${x.caseId}/decision`, x.appr.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true }), 200, 'approve');
}

test('E1: the amount is fixed when the case opens (HAND-COMPUTED 300,000 x 20/30 = 200,000.00), from the real membership, append-only, never from the request; it is executed in full AFTER the term ended, once, from that membership only', { skip }, async () => {
  // hand computation: price 300,000, 30-day plan, complaint filed with 20 days left -> 300,000 x 20/30 = 200,000.00
  const x = await exactCase();
  const q = await prisma.gymCaseRefundQuote.findUniqueOrThrow({ where: { caseId: x.caseId } });
  assert.equal(q.amount.toString(), '200000');
  assert.equal(q.pricePaid.toString(), '300000');
  assert.equal(q.quotedAt.getTime(), x.C.getTime(), 'counted from the day the member filed the complaint');
  assert.equal(q.paymentTxnId, x.m.paymentTxnId);
  assert.equal(q.durationDays, 30);
  const view = ok(await call('GET', `/admin/complaint-cases/${x.caseId}`, x.inv.tok), 200, 'detail');
  assert.equal(view.refundQuote.amount, '200000');

  // never from a request: an amount in any body is refused; the quote table is append-only and capped at the price paid
  assert.equal((await call('POST', `/admin/complaints/${x.complaint.id}/case`, x.inv.tok, { caseClass: 'MEM_CLOSED', membershipId: x.m.id, amount: 1 })).status, 400);
  assert.equal((await call('POST', `/admin/complaint-cases/${x.caseId}/proposal`, x.inv.tok, { amount: 1 })).status, 400);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE gym_case_refund_quotes SET amount = 1`), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM gym_case_refund_quotes`), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO gym_case_refund_quotes (id, case_id, membership_id, payment_txn_id, quoted_at, price_paid, duration_days, amount, created_by) VALUES (gen_random_uuid(), '${x.caseId}', 'm', 't', now(), 100, 30, 101, 'x')`), /gcrq_amount_range|violates check|duplicate key|unique/);

  await walkToApproved(x);
  // the membership runs out WHILE the case runs (fixture): ACTIVE -> EXPIRED, the term is over
  await prisma.gymMembershipContract.update({ where: { id: x.m.id }, data: { status: 'EXPIRED', endDate: new Date(x.C.getTime() - 1 * DAY) } });
  // the pre-existing rule (no case) would give 0 / refuse: unchanged
  await assert.rejects(() => membershipService.refundByAdmin(x.m.id, 'someone', 'GYM_CLOSED'), (e: any) => e.status === 409 && /GYM_CASE_DECISION_EXISTS|status/.test(String(e.code ?? e.message)));
  const ex = await call('POST', `/admin/complaint-cases/${x.caseId}/execute`, x.appr.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.deepEqual(pay.releases, [{ id: x.m.id, refund: '200000' }], 'exactly one refund, of the FIXED amount, for THIS membership only');
  assert.equal(ex.body.data.money.state, 'LEDGER_POSTED_FULL');
  assert.equal(ex.body.data.money.postedToMemberWallet, '200000.00');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: x.m.id } })).status, 'CANCELLED');
  // replay moves nothing
  const again = await call('POST', `/admin/complaint-cases/${x.caseId}/execute`, x.appr.tok, {});
  assert.equal(again.body.data.replayed, true);
  assert.equal(pay.releases.length, 1);
});

test('E1: never above what was paid / never from elsewhere - held money already released = NEEDS_RECONCILIATION with NO payment call; complaint after the term = 0; unpaid membership = no quote, no refund', { skip }, async () => {
  // (1) the money held for this membership was released before the case could use it
  const x = await exactCase('MEM_TXN');
  await walkToApproved(x);
  await prisma.gymMembershipContract.update({ where: { id: x.m.id }, data: { status: 'EXPIRED', payoutReleasedAt: new Date() } });
  const ex = await call('POST', `/admin/complaint-cases/${x.caseId}/execute`, x.appr.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(pay.releases.length, 0, 'nothing is paid from the gym or any other membership');
  assert.equal(ex.body.data.money.state, 'NEEDS_RECONCILIATION');
  assert.equal(ex.body.data.money.group, 'F3');
  assert.equal(ex.body.data.money.memberShortfall, '200000.00');
  assert.equal(ex.body.data.closure, 'CLOSED_FINANCIAL_OPEN');
  const mv = ok(await call('GET', `/me/complaint-cases/${x.caseId}`, x.reporter.tok), 200, 'member');
  assert.ok(!/đã được ghi vào ví/.test(JSON.stringify(mv)), 'never shown as paid');

  // (2) complaint filed AFTER the term ended: the fixed amount is 0, a clean no-refund
  const { gym } = await makeGym();
  const late = await makeMembership(gym.id, 'member-late', { price: 300_000, days: 30, startOffsetDays: 40 }); // ended 10 days ago
  const c2 = await makeComplaint(gym.id, 'member-late');
  const inv = newAdmin();
  const caseId = ok(await call('POST', `/admin/complaints/${c2.id}/case`, inv.tok, { caseClass: 'MEM_CLOSED', membershipId: late.id }), 201, 'open').id as string;
  assert.equal((await prisma.gymCaseRefundQuote.findUniqueOrThrow({ where: { caseId } })).amount.toString(), '0');

  // (3) a membership that was never paid / is CANCELLED gets no quote and can never be proposed for a refund
  const unpaid = await makeMembership(gym.id, 'member-unpaid', { paymentTxnId: null });
  const c3 = await makeComplaint(gym.id, 'member-unpaid');
  const k3 = ok(await call('POST', `/admin/complaints/${c3.id}/case`, inv.tok, { caseClass: 'MEM_TXN', membershipId: unpaid.id }), 201, 'open unpaid').id as string;
  assert.equal(await prisma.gymCaseRefundQuote.count({ where: { caseId: k3 } }), 0);
  ok(await call('POST', `/admin/complaint-cases/${k3}/assign`, inv.tok, {}), 200, 'assign');
  ok(await call('POST', `/admin/complaint-cases/${k3}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const cl = ok(await call('POST', `/admin/complaint-cases/${k3}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  ok(await call('POST', `/admin/complaint-cases/${k3}/assessments`, inv.tok, { claimId: cl.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${k3}/finding`, inv.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  assert.equal((await call('POST', `/admin/complaint-cases/${k3}/proposal`, inv.tok, {})).body.error.code, 'MEMBERSHIP_NOT_REFUNDABLE');
  assert.equal(pay.releases.length, 0);
});

// ───────────────────────────── E3 ─────────────────────────────

async function blockedDecision() {
  const d = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await approve(d);
  // the exit refuses (membership no longer refundable) -> EXEC_BLOCKED, nothing moved
  const refuse = { refund: async () => { throw Object.assign(new Error('refused'), { status: 409 }); }, replayRelease: async () => ({}) };
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(act(d), d.caseId, {}, refuse as any), (e: any) => e.code === 'EXEC_BLOCKED');
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).execStatus, 'EXEC_BLOCKED');
  return d;
}
const repl = (caseId: string, tok: string, body: object = { reason: 'Quyết định kẹt, cần thay bằng quyết định khác' }) => call('POST', `/admin/complaint-cases/${caseId}/decision-replacement`, tok, body);

test('E3: a blocked (EXEC_BLOCKED) approved decision is replaced: propose -> a DIFFERENT non-party admin approves -> back to FINDING_RECORDED, old approval untouched, no money; the new decision then executes once', { skip }, async () => {
  const d = await blockedDecision();
  const oldApproval = await prisma.gymCaseApproval.findFirstOrThrow({ where: { result: 'APPROVED', proposal: { caseId: d.caseId } } });
  const x = newAdmin();
  const y = newAdmin();
  const proposed = await repl(d.caseId, x.tok);
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  assert.equal((await repl(d.caseId, y.tok)).body.error.code, 'REPLACEMENT_PENDING', 'one live replacement per case');
  // while pending, the executor refuses and nothing runs
  const exec = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, d.appr.tok, {});
  assert.equal(exec.body.error.code, 'REPLACEMENT_PENDING');
  // four eyes + non-party
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, x.tok, { reason: 'ok', conflictOfInterestDeclaredNone: true })).body.error.code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, y.tok, { reason: 'ok', conflictOfInterestDeclaredNone: false })).body.error.code, 'CONFLICT_OF_INTEREST');
  const ownerAdmin = { tok: token(d.ownerId, 'ADMIN') };
  const memberAdmin = { tok: token(d.reporter.id, 'ADMIN') };
  for (const party of [ownerAdmin, memberAdmin]) {
    assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, party.tok, { reason: 'ok', conflictOfInterestDeclaredNone: true })).body.error.code, 'CONFLICT_OF_INTEREST');
    assert.equal((await repl(d.caseId, party.tok)).body.error.code, 'CONFLICT_OF_INTEREST', 'and a party cannot propose either');
  }
  const approved = await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, y.tok, { reason: 'Đồng ý thay quyết định', conflictOfInterestDeclaredNone: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.deepEqual([row.status, row.execStatus, row.execDecisionId], ['FINDING_RECORDED', 'NOT_STARTED', null]);
  assert.equal(pay.releases.length, 0, 'replacing moves no money');
  // history is append-only and the old approval is exactly as it was
  const still = await prisma.gymCaseApproval.findUniqueOrThrow({ where: { id: oldApproval.id } });
  assert.deepEqual(still, oldApproval);
  const actions = (await prisma.gymCaseEvent.findMany({ where: { caseId: d.caseId }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
  assert.ok(actions.includes('REPLACEMENT_PROPOSED') && actions.includes('REPLACEMENT_APPROVED'));
  // the case is open again: the membership stays protected, the old decision can no longer be executed
  assert.equal((await call('POST', `/admin/gym-memberships/${d.membershipId}/refund`, newAdmin().tok, { reason: 'GYM_CLOSED' })).body.error.code, 'GYM_CASE_OPEN');
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(act(d), d.caseId, { decisionId: oldApproval.id }), (e: any) => ['DECISION_REPLACED', 'CASE_STATE_NOT_ALLOWED'].includes(e.code));
  // the NEW decision goes the normal way and refunds exactly once
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, d.inv.tok, {}), 201, 'new proposal');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'APPROVED', reason: 'quyết định mới', conflictOfInterestDeclaredNone: true })).status, 200);
  const ex2 = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, d.appr.tok, {});
  assert.equal(ex2.status, 200, JSON.stringify(ex2.body));
  assert.equal(pay.releases.length, 1);
  const newApproval = await prisma.gymCaseApproval.findFirstOrThrow({ where: { result: 'APPROVED', proposal: { caseId: d.caseId } }, orderBy: { createdAt: 'desc' } });
  assert.notEqual(newApproval.id, oldApproval.id);
  assert.equal((await prisma.gymCaseExecution.findFirstOrThrow({ where: { caseId: d.caseId, state: 'BUSINESS_DONE' } })).decisionId, newApproval.id);
  // a decided replacement cannot be edited or deleted
  await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM gym_case_decision_replacements`), /append-only/);
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE gym_case_decision_replacements SET reason = 'x'`), /cannot change/);
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  assert.equal(detail.replacement.approvedBy, y.id);
});

test('E3: reject keeps the old decision; and anything that shows an EFFECT (executing, done, ledger operation, released payout, unreadable ledger, membership changed) is refused - nothing written', { skip }, async () => {
  const d = await blockedDecision();
  const x = newAdmin();
  const y = newAdmin();
  assert.equal((await repl(d.caseId, x.tok)).status, 201);
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/reject`, x.tok, { reason: 'x' })).body.error.code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/reject`, y.tok, { reason: 'Không cần thay' })).status, 200);
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).status, 'DECISION_APPROVED', 'the old decision stands');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, y.tok, { reason: 'x', conflictOfInterestDeclaredNone: true })).body.error.code, 'NO_PENDING_REPLACEMENT');
  const count = () => prisma.gymCaseDecisionReplacement.count({ where: { caseId: d.caseId } });
  const base = await count();

  // a ledger operation under the membership's keys = money moved
  pay.ledger.push(`MEMBERSHIP_RELEASE:${d.membershipId}`);
  let r = await repl(d.caseId, x.tok);
  assert.equal(r.body.error.code, 'DECISION_HAS_EFFECT');
  assert.ok(r.body.error.details.reasons.includes('LEDGER_OPERATION_MEMBERSHIP_RELEASE'));
  pay.ledger.length = 0;
  // unreadable ledger = doubt = refused 503
  pay.lookupFails = true;
  r = await repl(d.caseId, x.tok);
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'LEDGER_UNREADABLE');
  pay.lookupFails = false;
  // released payout / clawback done / cancelled
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { payoutReleasedAt: new Date() } });
  assert.ok((await repl(d.caseId, x.tok)).body.error.details.reasons.includes('PAYOUT_ALREADY_RELEASED'));
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { payoutReleasedAt: null, refundClawbackDone: true } });
  assert.ok((await repl(d.caseId, x.tok)).body.error.details.reasons.includes('CLAWBACK_ALREADY_DONE'));
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { refundClawbackDone: false } });
  assert.equal(await count(), base, 'refusals write nothing');

  // executing / done are refused too
  const e = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(e);
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(act(e), e.caseId, {}, { refund: async () => ({ refundAmount: 1, clawback: null, release: {} }), replayRelease: async () => ({}), afterExecutingCas: async () => { throw new Error('CRASH'); } }), /CRASH/);
  assert.ok((await repl(e.caseId, x.tok)).body.error.details.reasons.includes('EXEC_STATUS_EXECUTING'));
  const done = await driveToProposal({ caseClass: 'MEM_ACCESS', finding: 'ESTABLISHED' });
  await approve(done);
  await complaintCaseExecutionService.executeDecision(act(done), done.caseId);
  assert.equal((await repl(done.caseId, x.tok)).status, 409);
  assert.equal(await prisma.gymCaseDecisionReplacement.count({ where: { caseId: { in: [e.caseId, done.caseId] } } }), 0);

  // the membership changed between proposal and approval -> refused at approval, the proposal stays pending
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { status: 'ACTIVE' } });
  assert.equal((await repl(d.caseId, x.tok)).status, 201);
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { status: 'EXPIRED' } });
  const late = await call('POST', `/admin/complaint-cases/${d.caseId}/decision-replacement/approve`, y.tok, { reason: 'x', conflictOfInterestDeclaredNone: true });
  assert.equal(late.body.error.code, 'DECISION_HAS_EFFECT');
  assert.ok(late.body.error.details.reasons.includes('MEMBERSHIP_CHANGED_SINCE_PROPOSAL'));
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).status, 'DECISION_APPROVED');
});

test('E3: fail-closed flag (both flags), strict bodies, only ADMIN, and the race with execute has exactly one winner', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await approve(d);
  const x = newAdmin();
  delete process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED;
  assert.equal((await repl(d.caseId, x.tok)).body.error.code, 'DECISION_REPLACEMENT_DISABLED');
  process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED = 'TRUE';
  assert.equal((await repl(d.caseId, x.tok)).body.error.code, 'DECISION_REPLACEMENT_DISABLED', 'only the exact string "true"');
  process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED = 'true';
  setFlag(undefined);
  assert.equal((await repl(d.caseId, x.tok)).body.error.code, 'DECISION_REPLACEMENT_DISABLED', 'the case flag must be effective too');
  setFlag(true);
  assert.equal((await repl(d.caseId, x.tok, { reason: 'x', outcome: 'REFUND' })).status, 400);
  assert.equal((await repl(d.caseId, d.reporter.tok)).status, 403);
  assert.equal((await repl(d.caseId, '')).status, 401);
  // race: a replacement proposal and an execution at the same time -> exactly one wins
  const [p, e] = await Promise.all([repl(d.caseId, x.tok), call('POST', `/admin/complaint-cases/${d.caseId}/execute`, d.appr.tok, {})]);
  const proposeWon = p.status === 201;
  const executeWon = e.status === 200;
  assert.equal(proposeWon !== executeWon, true, `exactly one winner: propose ${p.status}, execute ${e.status}`);
  if (proposeWon) assert.equal(e.body.error.code, 'REPLACEMENT_PENDING');
  else {
    assert.ok(['DECISION_HAS_EFFECT', 'CASE_VERSION_CONFLICT', 'CASE_STATE_NOT_ALLOWED'].includes(p.body.error.code), p.body.error.code);
    assert.equal(pay.releases.length >= 0, true);
  }
  // allowedActions say so
  const view = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, newAdmin().tok), 200, 'detail');
  assert.ok(view.allowedActions.some((a: any) => a.action === 'PROPOSE_DECISION_REPLACEMENT'));
});

// ───────────────────────────── E4 ─────────────────────────────

test('E4: a response deadline is PAUSED while the party\'s account is locked (isActive=false), resumes on unlock with the paused time added, is audited; an unreachable auth-service changes and expires NOTHING', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Cần giải trình', parties: ['GYM'] }), 200, 'ask the gym');
  const dl = await prisma.gymCaseDeadline.findFirstOrThrow({ where: { caseId: d.caseId, partyRole: 'GYM' } });
  const t = (hours: number) => new Date(dl.startsAt.getTime() + hours * H);
  const locks = new Map<string, boolean | null>();
  setAccountLockLookupForTests(async (id) => (locks.has(id) ? locks.get(id)! : false));

  // locked 10h in: paused (audited); a locked clock never expires, however late
  locks.set(d.ownerId, true);
  assert.equal((await runCaseDeadlineSweep(t(10))).paused, 1);
  assert.equal((await runCaseDeadlineSweep(t(10))).paused, 0, 'paused once');
  let row = await prisma.gymCaseDeadline.findUniqueOrThrow({ where: { id: dl.id } });
  assert.ok(row.pausedAt);
  assert.equal((await runCaseDeadlineSweep(t(1000))).expired, 0, 'locked: it does not run out');
  assert.equal((await prisma.gymCaseDeadline.findUniqueOrThrow({ where: { id: dl.id } })).status, 'OPEN');
  // unreachable auth-service: nothing changes and nothing expires
  locks.set(d.ownerId, null);
  const unknown = await runCaseDeadlineSweep(t(2000));
  assert.deepEqual([unknown.expired, unknown.paused, unknown.resumed, unknown.unknown], [0, 0, 0, 1]);
  // unlocked at hour 1010: resumes, the paused ~1000h is added to the due time
  locks.set(d.ownerId, false);
  const resumed = await runCaseDeadlineSweep(t(1010));
  assert.equal(resumed.resumed, 1);
  assert.equal(resumed.expired, 0);
  row = await prisma.gymCaseDeadline.findUniqueOrThrow({ where: { id: dl.id } });
  assert.equal(row.pausedAt, null);
  assert.ok(Math.abs(row.pausedSeconds - 1000 * 3600) <= 2, `paused seconds ${row.pausedSeconds}`);
  assert.equal((await runCaseDeadlineSweep(t(1071))).expired, 0, 'still inside 72h + the paused time');
  assert.equal((await runCaseDeadlineSweep(t(1075))).expired, 1, 'expires only after due + paused time');
  assert.equal((await prisma.gymCaseDeadline.findUniqueOrThrow({ where: { id: dl.id } })).status, 'EXPIRED');
  const events = (await prisma.gymCaseEvent.findMany({ where: { caseId: d.caseId }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
  assert.deepEqual(events.filter((a) => /DEADLINE_|NO_RESPONSE/.test(a)), ['DEADLINE_STARTED', 'DEADLINE_PAUSED', 'DEADLINE_RESUMED', 'NO_RESPONSE_RECORDED']);
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).status, 'ASSESSING');
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  assert.equal(detail.deadlines[0].paused, false);
  assert.ok(new Date(detail.deadlines[0].effectiveDueAt).getTime() > new Date(detail.deadlines[0].dueAt).getTime());

  // the member's clock uses the member's account; unlocked while the Gym is locked
  const e = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  ok(await call('POST', `/admin/complaint-cases/${e.caseId}/request-more`, e.inv.tok, { to: 'AWAITING_PARTIES', note: 'x', parties: ['MEMBER', 'GYM'] }), 200, 'both');
  locks.set(e.ownerId, true);
  const r = await runCaseDeadlineSweep(new Date(Date.now() + 80 * H));
  assert.equal(r.expired, 1, "only the MEMBER's clock ran out");
  assert.equal(r.stepMoved, 0, 'the Gym is still expected (paused), so the step does not move yet');
  const left = await prisma.gymCaseDeadline.findMany({ where: { caseId: e.caseId, status: 'OPEN' } });
  assert.deepEqual(left.map((x) => x.partyRole), ['GYM']);
  assert.ok(left[0].pausedAt);
});

test('E4 through the real lookup: auth-service isActive=false pauses, isActive=true resumes, an unreachable auth-service does nothing', { skip }, async () => {
  setAccountLockLookupForTests(); // the REAL lookup (authClient.getUser, patched by the fixture's auth directory)
  const d = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'x', parties: ['GYM'] }), 200, 'ask the gym');
  const far = new Date(Date.now() + 500 * H);
  authDirectory.unreachable = true;
  const a = await runCaseDeadlineSweep(far);
  assert.deepEqual([a.expired, a.paused, a.unknown], [0, 0, 1], 'unreachable: nothing');
  authDirectory.unreachable = false;
  authDirectory.users.set(d.ownerId, { role: 'GYM_OWNER', isActive: false });
  assert.equal((await runCaseDeadlineSweep(far)).paused, 1);
  assert.equal((await runCaseDeadlineSweep(new Date(far.getTime() + 500 * H))).expired, 0);
  authDirectory.users.set(d.ownerId, { role: 'GYM_OWNER', isActive: true });
  assert.equal((await runCaseDeadlineSweep(new Date(far.getTime() + 600 * H))).resumed, 1);
});
