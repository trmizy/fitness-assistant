/**
 * Q21 (refund doors vs Gym Case), Q31 (conflict of interest through GymPartnerAccount) and Q27-Q29 (closing semantics) - REAL HTTP into the real gym-service
 * app, REAL refundByAdmin / terminate / cancel-after-refund code, isolated gym *_test database. BACKEND INTEGRATION.
 * TEST FIXTURE: gym / membership / partner-account rows, the auth-service token table, and a recording FAKE for payment-service's HTTP client
 * (paymentClient.releaseMembershipPending / clawbackReferral / getTransaction), so "was money asked to move" is observable. The real ledger path is in
 * complaint-case-money.e2e.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { authClient } from '../clients/auth.client';
import { membershipService } from '../services/membership.service';
import { partnerService } from '../services/partner.service';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import {
  approve,
  call,
  cleanup,
  driveToProposal,
  installStubs,
  makeComplaint,
  makeGym,
  makeMembership,
  newAdmin,
  ok,
  patch,
  removeStubs,
  setFlag,
  skip,
  startApp,
  stopApp,
  token,
} from './complaint-case.test-helpers';

const pay = { releases: [] as Array<{ id: string; refund: string }>, clawbacks: 0, restore: [] as Array<() => void> };

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  pay.restore.push(
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => {
      pay.releases.push({ id: String(b.idempotencyKey).replace('MEMBERSHIP_RELEASE:', ''), refund: b.refundToClient });
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: b.refundToClient ?? '0.00', shortfall: '0.00' };
    }),
    patch(paymentClient, 'clawbackReferral', async () => {
      pay.clawbacks++;
      return { recovered: '0.00', shortfall: '0.00' };
    }),
    patch(authClient, 'setUserActive', async () => undefined),
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
  pay.releases.length = 0;
  pay.clawbacks = 0;
});
test.afterEach(async () => {
  if (skip) return;
  await prisma.gymPartner.deleteMany({ where: { legalName: 'Other Partner' } });
  await cleanup();
});

const refundHttp = (tok: string, membershipId: string, reason = 'GYM_CLOSED') => call('POST', `/admin/gym-memberships/${membershipId}/refund`, tok, { reason });
const actor = (d: { appr: { id: string } }) => ({ id: d.appr.id, role: 'ADMIN' });

// ───────────────────────────── Q21 ─────────────────────────────

test('Q21: an INDEPENDENT admin refund is not blocked (no case / only a rejected-at-intake case / a case about the gym in general)', { skip }, async () => {
  const admin = newAdmin();
  // no case at all
  const { gym } = await makeGym();
  const m1 = await makeMembership(gym.id, 'member-a');
  const r1 = await refundHttp(admin.tok, m1.id);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(pay.releases.length, 1);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: m1.id } })).status, 'CANCELLED');

  // a case that was REJECTED at intake never reached a decision: it blocks nothing
  const m2 = await makeMembership(gym.id, 'member-b');
  const c2 = await makeComplaint(gym.id, 'member-b');
  const opened = ok(await call('POST', `/admin/complaints/${c2.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: m2.id }), 201, 'open');
  assert.equal((await refundHttp(admin.tok, m2.id)).body.error.code, 'GYM_CASE_OPEN', 'while the case is open');
  ok(await call('POST', `/admin/complaint-cases/${opened.id}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'không thuộc phạm vi' }), 200, 'reject');
  const r2 = await refundHttp(admin.tok, m2.id);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(pay.releases.length, 2);

  // a GYM_GENERAL case has no membership: another membership of the same gym stays freely refundable
  const g = await makeComplaint(gym.id, 'member-c');
  ok(await call('POST', `/admin/complaints/${g.id}/case`, admin.tok, { caseClass: 'GYM_GENERAL' }), 201, 'open general');
  const m3 = await makeMembership(gym.id, 'member-c');
  assert.equal((await refundHttp(admin.tok, m3.id, 'TRANSACTION_ERROR')).status, 200);
  assert.equal((await refundHttp(admin.tok, randomUUID())).status, 404, 'unchanged errors stay unchanged');
  assert.equal((await call('POST', `/admin/gym-memberships/${m3.id}/refund`, admin.tok, { reason: 'NOPE' })).body.error.code, 'INVALID_REFUND_REASON');
  assert.equal((await refundHttp(token('cust-1', 'CUSTOMER'), m3.id)).status, 403);
});

test('Q21: a refund that would BYPASS an open case or CONTRADICT an approved decision is refused 409 with a clear code - money is never asked to move; independent of the flag', { skip }, async () => {
  // open case, every pre-decision status
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' }); // AWAITING_APPROVAL
  const admin = newAdmin();
  let r = await refundHttp(admin.tok, d.membershipId!);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GYM_CASE_OPEN');
  assert.equal(r.body.error.details.caseId, d.caseId);
  assert.match(r.body.error.message, /hồ sơ khiếu nại/);
  setFlag(undefined); // the guard reads the database: a flag that is off does not open the door
  assert.equal((await refundHttp(admin.tok, d.membershipId!)).body.error.code, 'GYM_CASE_OPEN');
  setFlag(true);

  // approved decision, not executed yet
  assert.equal((await approve(d)).status, 200);
  r = await refundHttp(admin.tok, d.membershipId!);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GYM_CASE_DECISION_EXISTS');
  assert.equal(r.body.error.details.execStatus, 'NOT_STARTED');
  assert.equal(pay.releases.length, 0, 'nothing asked payment to move');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: d.membershipId! } })).status, 'ACTIVE');

  // the sanctioned door: the executor, with this very decision, refunds exactly once
  const exec = await complaintCaseExecutionService.executeDecision(actor(d), d.caseId);
  assert.equal(exec.executionState, 'BUSINESS_DONE');
  assert.equal(pay.releases.length, 1);
  assert.equal(pay.releases[0].id, d.membershipId);
  // after it, a direct refund is still refused (decision exists) and cannot double refund either
  assert.equal((await refundHttp(admin.tok, d.membershipId!)).body.error.code, 'GYM_CASE_DECISION_EXISTS');

  // a concluded decision that said "no refund" is contradicted by a direct refund too
  const n = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'NOT_ESTABLISHED' });
  await approve(n);
  await complaintCaseExecutionService.executeDecision(actor(n), n.caseId);
  r = await refundHttp(admin.tok, n.membershipId!, 'TRANSACTION_ERROR');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GYM_CASE_DECISION_EXISTS');
  assert.equal(r.body.error.details.execStatus, 'BUSINESS_DONE');
  assert.equal(pay.releases.length, 1);
});

test('Q21: refundByAdmin called with a decision id that is not the EXECUTING approved decision of that membership is refused (no money); the executor passes the right one', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_VIOLATION', finding: 'ESTABLISHED' });
  await approve(d);
  for (const bad of [randomUUID(), undefined]) {
    const opts = bad ? { caseDecisionId: bad } : {};
    await assert.rejects(() => membershipService.refundByAdmin(d.membershipId!, d.appr.id, 'GYM_VIOLATION_SUSPENDED', opts), (e: any) => e.status === 409 && /^GYM_CASE_/.test(e.code));
  }
  const approval = await prisma.gymCaseApproval.findFirstOrThrow({ where: { result: 'APPROVED', proposal: { caseId: d.caseId } } });
  // the case is DECISION_APPROVED but NOT EXECUTING yet: even the right id is refused
  await assert.rejects(() => membershipService.refundByAdmin(d.membershipId!, d.appr.id, 'GYM_VIOLATION_SUSPENDED', { caseDecisionId: approval.id }), (e: any) => e.code === 'GYM_CASE_DECISION_MISMATCH');
  assert.equal(pay.releases.length, 0);
  // another membership's decision id does not unlock this membership
  const other = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(other);
  await assert.rejects(() => membershipService.refundByAdmin(d.membershipId!, d.appr.id, 'GYM_CLOSED', { caseDecisionId: other.caseId }), (e: any) => e.code === 'GYM_CASE_DECISION_MISMATCH');
  assert.equal((await complaintCaseExecutionService.executeDecision(actor(d), d.caseId)).executionState, 'BUSINESS_DONE');
  assert.equal(pay.releases.length, 1);
});

test('Q21 door "terminate partner (PRORATED_REFUND)": memberships under a case are listed in refundErrors with their code, the others are refunded', { skip }, async () => {
  const { gym, partner } = await makeGym();
  const free = await makeMembership(gym.id, 'member-free');
  const held = await makeMembership(gym.id, 'member-held');
  const admin = newAdmin();
  const c = await makeComplaint(gym.id, 'member-held');
  ok(await call('POST', `/admin/complaints/${c.id}/case`, admin.tok, { caseClass: 'MEM_CLOSED', membershipId: held.id }), 201, 'open');
  const res = await partnerService.terminate(partner.id, admin.id, 'Chấm dứt hợp tác', 'PRORATED_REFUND');
  assert.equal(res.refunded, 1);
  assert.deepEqual(res.refundErrors.map((e: any) => [e.membershipId, e.code]), [[held.id, 'GYM_CASE_OPEN']]);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: free.id } })).status, 'CANCELLED');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: held.id } })).status, 'ACTIVE');
  assert.deepEqual(pay.releases.map((r) => r.id), [free.id]);
});

test('Q21 door "payment-service admin refund -> cancel-after-refund": gym-service cannot undo money that already moved, so it RECORDS it on the open case; the case then cannot refund a second time', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(d);
  const restore = patch(paymentClient, 'getTransaction', async (id: string) =>
    id === 'orig' ? { status: 'REFUNDED', relatedEntityId: d.membershipId } : { status: 'PAID', refundOfTransactionId: 'orig' },
  );
  try {
    const r = await call('POST', `/internal/gym-memberships/${d.membershipId}/cancel-after-refund`, null, { originalTransactionId: 'orig', refundTransactionId: 'ref' }, { 'x-service-secret': 'dev_internal_service_secret_change_in_production' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally {
    restore();
  }
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: d.membershipId! } })).status, 'CANCELLED');
  const ev = await prisma.gymCaseEvent.findMany({ where: { caseId: d.caseId, action: 'DIRECT_REFUND_OBSERVED' } });
  assert.equal(ev.length, 1);
  // the approved decision can no longer move money: blocked, payment never asked
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(actor(d), d.caseId), (e: any) => e.code === 'EVIDENCE_CHANGED' || e.code === 'EXEC_BLOCKED');
  assert.equal(pay.releases.length, 0);
});

// ───────────────────────────── Q31 ─────────────────────────────

test('Q31: an admin linked to the gym or its brand (owner, brand owner, any non-revoked partner account) cannot open, be assigned, propose, approve or execute; unrelated and revoked accounts can', { skip }, async () => {
  const { gym, ownerId, brand, partner } = await makeGym();
  const mkAdmin = (id: string) => ({ id, tok: token(id, 'ADMIN') });
  const link = async (id: string, role: 'MANAGER' | 'RECEPTIONIST' | 'ACCOUNTANT' | 'OWNER', status: 'ACTIVE' | 'INVITED' | 'REVOKED', partnerId = partner.id) =>
    prisma.gymPartnerAccount.create({ data: { partnerId, userId: id, role, scopedGymIds: role === 'OWNER' ? [] : [gym.id], status, activatedAt: status === 'ACTIVE' ? new Date() : null, onboardingCompletedAt: new Date() } });
  const manager = mkAdmin('adm-manager');
  const reception = mkAdmin('adm-reception-invited');
  const accountant = mkAdmin('adm-accountant-revoked');
  const brandOwner = mkAdmin('adm-brand-owner');
  const elsewhere = mkAdmin('adm-other-partner-manager');
  await link(manager.id, 'MANAGER', 'ACTIVE');
  await link(reception.id, 'RECEPTIONIST', 'INVITED');
  await link(accountant.id, 'ACCOUNTANT', 'REVOKED');
  await prisma.gymBrand.update({ where: { id: brand.id }, data: { ownerId: brandOwner.id } });
  const other = await prisma.gymPartner.create({ data: { legalName: 'Other Partner', status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
  await link(elsewhere.id, 'MANAGER', 'ACTIVE', other.id);
  const owner = mkAdmin(ownerId);

  const reporter = 'member-q31';
  const m = await makeMembership(gym.id, reporter);
  const complaint = await makeComplaint(gym.id, reporter);
  const openAs = (a: { tok: string }) => call('POST', `/admin/complaints/${complaint.id}/case`, a.tok, { caseClass: 'MEM_CLOSED', membershipId: m.id });
  for (const linked of [owner, manager, reception, brandOwner]) {
    const r = await openAs(linked);
    assert.equal(r.status, 403, linked.id);
    assert.equal(r.body.error.code, 'CONFLICT_OF_INTEREST', linked.id);
  }
  assert.equal(await prisma.gymComplaintCase.count(), 0);

  // not linked: a revoked account, and a manager of ANOTHER partner
  const inv = accountant; // revoked -> allowed to investigate
  const caseId = ok(await openAs(inv), 201, 'open by revoked').id as string;
  for (const linked of [manager, reception, brandOwner, owner]) {
    const r = await call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, { investigatorId: linked.id });
    assert.equal(r.body.error.code, 'CONFLICT_OF_INTEREST', `assign ${linked.id}`);
  }
  ok(await call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, {}), 200, 'assign self');
  ok(await call('POST', `/admin/complaint-cases/${caseId}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = ok(await call('POST', `/admin/complaint-cases/${caseId}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  ok(await call('POST', `/admin/complaint-cases/${caseId}/assessments`, inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${caseId}/finding`, inv.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');

  // a link created AFTER the assignment still bars the proposer
  await prisma.gymPartnerAccount.update({ where: { userId: inv.id }, data: { status: 'ACTIVE' } }); // the revoked account is re-activated: now it IS linked
  const bad = await call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {});
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error.code, 'CONFLICT_OF_INTEREST');
  await prisma.gymPartnerAccount.update({ where: { userId: inv.id }, data: { status: 'REVOKED' } });
  ok(await call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {}), 201, 'proposal after the link is revoked');

  // approvers: every linked admin refused (and the screen says so); the unrelated manager of another partner may approve
  const view = ok(await call('GET', `/admin/complaint-cases/${caseId}`, manager.tok), 200, 'detail');
  const approveAction = view.allowedActions.find((a: any) => a.action === 'APPROVE');
  assert.deepEqual([approveAction.allowed, approveAction.reason], [false, 'CONFLICT_OF_INTEREST']);
  for (const linked of [manager, reception, brandOwner, owner]) {
    const r = await call('POST', `/admin/complaint-cases/${caseId}/decision`, linked.tok, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true });
    assert.equal(r.body.error.code, 'CONFLICT_OF_INTEREST', `approve ${linked.id}`);
  }
  assert.equal((await call('POST', `/admin/complaint-cases/${caseId}/decision`, elsewhere.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true })).status, 200);

  // the executor re-checks from the data: an executor linked after the approval is refused
  for (const linked of [manager, brandOwner]) {
    await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: linked.id, role: 'ADMIN' }, caseId), (e: any) => e.code === 'CONFLICT_OF_INTEREST');
  }
  assert.equal(pay.releases.length, 0);
  // and an approver who becomes linked after approving makes the stored decision unexecutable by the four-eyes re-check
  await prisma.gymPartnerAccount.update({ where: { userId: elsewhere.id }, data: { partnerId: partner.id } });
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(mkAdminActor(accountant.id), caseId), (e: any) => e.code === 'CONFLICT_OF_INTEREST', 'the approver (now linked) is refused by the stored-decision re-check');
  assert.equal(pay.releases.length, 0);
});
const mkAdminActor = (id: string) => ({ id, role: 'ADMIN' });

// ───────────────────────────── Q27-Q29 ─────────────────────────────

test('Q27-Q29: closing never moves money by itself (REJECTED_INTAKE, no-money outcomes with the DEFAULT executor); a terminal case has NO exit; REJECTED_INTAKE does not reopen', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const ownerless = patch(paymentClient, 'getTransaction', async () => {
    throw new Error('payment must not be read or asked on a non-money close');
  });
  try {
    // (1) rejected at intake
    const c1 = await makeComplaint(gym.id, 'member-r');
    const k1 = ok(await call('POST', `/admin/complaints/${c1.id}/case`, admin.tok, { caseClass: 'GYM_GENERAL' }), 201, 'open').id as string;
    ok(await call('POST', `/admin/complaint-cases/${k1}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'ngoài phạm vi' }), 200, 'reject');
    // no way out of a terminal state, and no second case for the same complaint
    const dead = async (id: string, who: { tok: string }, memberTok: string) => {
      for (const [p, b] of [
        ['assign', {}],
        ['transition', { to: 'ASSESSING' }],
        ['request-more', { note: 'x' }],
        ['claims', { claimantRole: 'MEMBER', text: 'x' }],
        ['finding', { finding: 'ESTABLISHED', reasoning: 'x' }],
        ['proposal', {}],
        ['decision', { result: 'REJECTED', reason: 'x', conflictOfInterestDeclaredNone: true }],
        ['recollect', {}],
        ['ack-evidence-change', { note: 'x' }],
      ] as Array<[string, unknown]>) {
        const r = await call('POST', `/admin/complaint-cases/${id}/${p}`, who.tok, b);
        assert.ok(r.status === 409 || r.status === 403, `${p} -> ${r.status}`);
        assert.notEqual(r.status, 200, `${p} must not succeed on a terminal case`);
      }
      const s = await call('POST', `/me/complaint-cases/${id}/statements`, memberTok, { text: 'thêm' });
      assert.equal(s.status, 409);
      assert.equal(s.body.error.code, 'CASE_NOT_ACCEPTING');
    };
    await dead(k1, admin, token('member-r', 'CUSTOMER'));
    const again = await call('POST', `/admin/complaints/${c1.id}/case`, admin.tok, { caseClass: 'MEM_ACCESS' });
    assert.equal(again.body.data.existing, true);
    assert.equal(again.body.data.status, 'REJECTED_INTAKE', 'the same terminal case is returned, nothing is reopened');
    assert.equal(await prisma.gymComplaintCase.count({ where: { complaintId: c1.id } }), 1);
    await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: admin.id, role: 'ADMIN' }, k1), (e: any) => e.status === 409);

    // (2) no-money outcomes executed with the DEFAULT deps (the real refund door): payment is never touched
    for (const [caseClass, finding] of [['GYM_GENERAL', 'NOT_ESTABLISHED'], ['MEM_ACCESS', 'ESTABLISHED'], ['MEM_TXN', 'NOT_ESTABLISHED']] as const) {
      const d = await driveToProposal({ caseClass, finding, membership: caseClass === 'GYM_GENERAL' ? false : {} });
      await approve(d);
      const e = await complaintCaseExecutionService.executeDecision(actor(d), d.caseId);
      assert.equal(e.executionState, 'BUSINESS_DONE');
      assert.equal(e.money.group, 'F2');
      if (d.membershipId) assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: d.membershipId } })).status, 'ACTIVE', 'closing a case does not touch the membership');
      const resolvedAt = (await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).resolvedAt;
      await complaintCaseExecutionService.executeDecision(actor(d), d.caseId); // replay
      assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).resolvedAt?.getTime(), resolvedAt?.getTime(), 'the replay does not re-close');
      await dead(d.caseId, d.inv, d.reporter.tok);
      assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: d.caseId, state: 'BUSINESS_DONE' } }), 1);
    }
    assert.equal(pay.releases.length, 0);
    assert.equal(pay.clawbacks, 0);
  } finally {
    ownerless();
  }
});

test('Q27-Q29: after a refund case is CLOSED the membership is gone, so a new complaint/case on it cannot lead to a second refund; a rejected approval returns to investigation and needs a NEW finding and proposal', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  // reject -> back to ASSESSING; the old proposal is dead, a new finding + proposal are required, and each approval is one row
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'REJECTED', reason: 'thiếu căn cứ', conflictOfInterestDeclaredNone: true })).status, 200);
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } })).status, 'ASSESSING');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, d.inv.tok, {})).body.error.code, 'CASE_STATE_NOT_ALLOWED');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true })).body.error.code, 'CASE_STATE_NOT_ALLOWED');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, d.inv.tok, { finding: 'ESTABLISHED', reasoning: 'có thêm căn cứ' }), 201, 'finding 2');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, d.inv.tok, {}), 201, 'proposal 2');
  assert.equal((await approve(d)).status, 200);
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: d.caseId } }), 2);
  assert.equal(await prisma.gymCaseApproval.count({ where: { result: 'APPROVED', proposal: { caseId: d.caseId } } }), 1);
  await complaintCaseExecutionService.executeDecision(actor(d), d.caseId);
  assert.equal(pay.releases.length, 1);

  // a fresh complaint on the SAME (now CANCELLED) membership may open a case, but it can never reach a second refund
  const c2 = await makeComplaint(d.gymId, d.reporter.id);
  const inv2 = newAdmin();
  const caseId2 = ok(await call('POST', `/admin/complaints/${c2.id}/case`, inv2.tok, { caseClass: 'MEM_CLOSED', membershipId: d.membershipId }), 201, 'second case').id as string;
  ok(await call('POST', `/admin/complaint-cases/${caseId2}/assign`, inv2.tok, {}), 200, 'assign');
  ok(await call('POST', `/admin/complaint-cases/${caseId2}/transition`, inv2.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = ok(await call('POST', `/admin/complaint-cases/${caseId2}/claims`, inv2.tok, { claimantRole: 'MEMBER', text: 'lại' }), 201, 'claim');
  ok(await call('POST', `/admin/complaint-cases/${caseId2}/assessments`, inv2.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${caseId2}/finding`, inv2.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  const r = await call('POST', `/admin/complaint-cases/${caseId2}/proposal`, inv2.tok, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'MEMBERSHIP_NOT_REFUNDABLE');
  assert.equal(pay.releases.length, 1, 'still exactly one refund');
});
