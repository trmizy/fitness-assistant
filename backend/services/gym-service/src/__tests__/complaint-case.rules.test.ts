import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GYM_EXPLAINER_ENABLED,
  GYM_CAN_DECIDE,
  gymSafePayload,
  slaOf,
  deadlineDueAt,
  appealWindow,
  verificationOf,
  verificationLabelVi,
  
  MONEY_CLASSES,
  TRANSITIONS,
  canTransition,
  canTransitionManually,
  changeAcknowledged,
  checkApprover,
  closureOf,
  deriveFinancialView,
  diffAgainstSnapshot,
  evidenceVisibleTo,
  hasMoneyExit,
  isRefundOutcome,
  memberFinancialView,
  memberResolutionText,
  outcomeFor,
  refundReasonFor,
  statementVisibleTo,
  viewerKind,
  type CaseClass,
  type Outcome,
} from '../services/complaint-case/rules';
import { flagVerdict, gymCaseEnabled, __resetFlagWarnings } from '../services/complaint-case/flags';
import { ADMIN_REFUND_REASONS } from '../services/membership.service';

/** Pure rules of the gym complaint case layer (TEST FIXTURE inputs, no database, no network). */

test('outcome mapping: only MEM_TXN / MEM_CLOSED / MEM_VIOLATION established lead to a refund, each with its own refundByAdmin reason', () => {
  assert.equal(outcomeFor('MEM_TXN', 'ESTABLISHED'), 'REFUND_TRANSACTION_ERROR');
  assert.equal(outcomeFor('MEM_CLOSED', 'ESTABLISHED'), 'REFUND_GYM_CLOSED');
  assert.equal(outcomeFor('MEM_VIOLATION', 'ESTABLISHED'), 'REFUND_GYM_VIOLATION');
  assert.equal(refundReasonFor('REFUND_TRANSACTION_ERROR'), 'TRANSACTION_ERROR');
  assert.equal(refundReasonFor('REFUND_GYM_CLOSED'), 'GYM_CLOSED');
  assert.equal(refundReasonFor('REFUND_GYM_VIOLATION'), 'GYM_VIOLATION_SUSPENDED');
  // every reason the matrix can produce is a reason refundByAdmin really accepts
  for (const o of ['REFUND_TRANSACTION_ERROR', 'REFUND_GYM_CLOSED', 'REFUND_GYM_VIOLATION'] as Outcome[]) {
    assert.ok((ADMIN_REFUND_REASONS as readonly string[]).includes(refundReasonFor(o)!));
  }
  assert.deepEqual([...MONEY_CLASSES].sort(), ['MEM_CLOSED', 'MEM_TXN', 'MEM_VIOLATION']);
});

test('MEM_ACCESS and GYM_GENERAL have NO money exit even when established; not established is "chua du can cu" for every class', () => {
  for (const c of ['MEM_ACCESS', 'GYM_GENERAL'] as CaseClass[]) {
    assert.equal(hasMoneyExit(c), false);
    assert.equal(outcomeFor(c, 'ESTABLISHED'), 'RESOLVE_UPHELD');
    assert.equal(isRefundOutcome(outcomeFor(c, 'ESTABLISHED')), false);
    assert.equal(refundReasonFor(outcomeFor(c, 'ESTABLISHED')), null);
  }
  for (const c of ['MEM_TXN', 'MEM_CLOSED', 'MEM_VIOLATION', 'MEM_ACCESS', 'GYM_GENERAL'] as CaseClass[]) {
    assert.equal(outcomeFor(c, 'NOT_ESTABLISHED'), 'RESOLVE_INSUFFICIENT_EVIDENCE');
    assert.equal(isRefundOutcome('RESOLVE_INSUFFICIENT_EVIDENCE'), false);
  }
});

test('status machine: terminal states have no exit; the manual endpoint cannot reach DECISION_APPROVED, AWAITING_APPROVAL or FINDING_RECORDED', () => {
  assert.deepEqual(TRANSITIONS.DECISION_APPROVED, ['APPEAL_REVIEW', 'FINDING_RECORDED'], 'the only ways out: the single appeal, and E3 replacement of a decision with no effect');
  assert.deepEqual(TRANSITIONS.APPEAL_REVIEW, ['ASSESSING']);
  assert.deepEqual(TRANSITIONS.REJECTED_INTAKE, []);
  assert.equal(canTransition('ASSESSING', 'FINDING_RECORDED'), true);
  assert.equal(canTransitionManually('ASSESSING', 'FINDING_RECORDED'), false);
  assert.equal(canTransitionManually('FINDING_RECORDED', 'AWAITING_APPROVAL'), false);
  assert.equal(canTransitionManually('AWAITING_APPROVAL', 'ASSESSING'), false); // only a rejection returns the case
  assert.equal(canTransitionManually('COLLECTING', 'ASSESSING'), true);
  assert.equal(canTransitionManually('INTAKE', 'REJECTED_INTAKE'), true);
});

test('four eyes: proposer, investigator, reporter, gym owner and a missing declaration are all refused; a distinct admin passes', () => {
  const base = { approverId: 'a2', approverRole: 'ADMIN', proposerId: 'a1', investigatorId: 'a1', reporterUserId: 'm1', gymOwnerId: 'o1', conflictOfInterestDeclaredNone: true };
  assert.deepEqual(checkApprover(base), { ok: true });
  assert.equal((checkApprover({ ...base, approverId: 'a1' }) as any).code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal((checkApprover({ ...base, approverId: 'a3', investigatorId: 'a3', proposerId: 'a1' }) as any).code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal((checkApprover({ ...base, approverId: 'm1' }) as any).code, 'CONFLICT_OF_INTEREST');
  assert.equal((checkApprover({ ...base, approverId: 'o1' }) as any).code, 'CONFLICT_OF_INTEREST');
  assert.equal((checkApprover({ ...base, conflictOfInterestDeclaredNone: false }) as any).code, 'CONFLICT_OF_INTEREST');
  assert.equal((checkApprover({ ...base, approverRole: 'CUSTOMER' }) as any).code, 'ADMIN_ONLY');
});

test('C10: the Gym is an EXPLAINER inside its branch (evidence + explanation), never a decider; outsiders see nothing', () => {
  assert.equal(GYM_EXPLAINER_ENABLED, true);
  assert.equal(GYM_CAN_DECIDE, false);
  const c = { reporterUserId: 'm1', gymId: 'g1' };
  assert.equal(viewerKind({ userId: 'o1', role: 'GYM_OWNER', gymIds: ['g1'] }, c), 'GYM');
  assert.equal(viewerKind({ userId: 'o2', role: 'GYM_OWNER', gymIds: ['g2'] }, c), 'NONE', 'another branch');
  assert.equal(viewerKind({ userId: 'o1', role: 'GYM_OWNER' }, c), 'NONE', 'no branch scope');
  assert.equal(viewerKind({ userId: 'a1', role: 'ADMIN' }, c), 'ADMIN');
  assert.equal(viewerKind({ userId: 'm1', role: 'CUSTOMER' }, c), 'MEMBER');
  assert.equal(viewerKind({ userId: 'm2', role: 'CUSTOMER' }, c), 'NONE');
  const mk = (source: string, over: object = {}) => ({ id: 'e-' + source, source, submittedBy: null, sensitivity: 'NORMAL', scopeGymId: 'g1', ...over });
  for (const s of ['COMPLAINT_RECORD', 'GYM_RECORD', 'MEMBERSHIP_RECORD', 'CHECKIN_SUMMARY']) assert.equal(evidenceVisibleTo(mk(s), 'GYM', 'o1', 'g1', []), true, s);
  assert.equal(evidenceVisibleTo(mk('PARTY_DOCUMENT', { submittedBy: 'm1' }), 'GYM', 'o1', 'g1', []), false, "the member's document stays hidden");
  assert.equal(evidenceVisibleTo(mk('COMPLAINT_PHOTO'), 'GYM', 'o1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(mk('PARTY_DOCUMENT', { submittedBy: 'm1' }), 'GYM', 'o1', 'g1', [{ evidenceId: 'e-PARTY_DOCUMENT', statementId: null, sharedWithRole: 'GYM' }]), true, 'unless an admin shared it');
  assert.equal(evidenceVisibleTo(mk('GYM_RECORD', { scopeGymId: 'g2' }), 'GYM', 'o1', 'g1', []), false, 'another branch');
  assert.equal(evidenceVisibleTo(mk('GYM_RECORD'), 'NONE', 'x', 'g1', []), false);
  assert.equal(statementVisibleTo({ id: 's', partyRole: 'MEMBER', authorUserId: 'm1' }, 'GYM', 'o1', []), false);
  assert.equal(statementVisibleTo({ id: 's2', partyRole: 'GYM', authorUserId: 'o9' }, 'GYM', 'o1', []), true, "a teammate's explanation is the Gym's");
  assert.equal(statementVisibleTo({ id: 's', partyRole: 'MEMBER', authorUserId: 'm1' }, 'NONE', 'o1', []), false);
  // the member's identity never reaches the Gym
  assert.deepEqual(gymSafePayload({ reporterUserId: 'm1', clientId: 'm1', paymentTxnId: 't', issueType: 'BILLING', status: 'ACTIVE' }), { issueType: 'BILLING', status: 'ACTIVE' });
});

test('A1 pure rules: SLA day 10 / 14, deadlines 72h / 48h from a delivered notice, appeal 14 days from the delivered conclusion notice', () => {
  const t0 = new Date('2026-11-01T00:00:00Z');
  const at = (d: number, h = 0) => new Date(t0.getTime() + (d * 24 + h) * 3600_000);
  assert.deepEqual([slaOf(t0, at(9, 23)).state, slaOf(t0, at(10)).state, slaOf(t0, at(13, 23)).state, slaOf(t0, at(14)).state], ['OK', 'WARNING', 'WARNING', 'OVERDUE']);
  assert.equal(slaOf(t0, at(14)).ageDays, 14);
  assert.equal(deadlineDueAt(t0, 'FIRST_RESPONSE').getTime() - t0.getTime(), 72 * 3600_000);
  assert.equal(deadlineDueAt(t0, 'SUPPLEMENT_ROUND').getTime() - t0.getTime(), 48 * 3600_000);
  assert.equal(appealWindow(t0, at(14)).open, true);
  assert.equal(appealWindow(t0, at(14, 1)).open, false);
  assert.deepEqual(appealWindow(null, at(400)), { open: true, closesAt: null }, 'no valid notice: the window never started');
  assert.equal(TRANSITIONS.DECISION_APPROVED.join(), 'APPEAL_REVIEW,FINDING_RECORDED');
  assert.equal(canTransitionManually('DECISION_APPROVED', 'APPEAL_REVIEW'), false, 'only the appeal service can re-open');
  assert.equal(canTransitionManually('REJECTED_INTAKE', 'ASSESSING'), false);
});

test('C9: photo evidence is labelled RECORD_HASH_ONLY, a party document DECLARED_NOT_VERIFIED, system rows SERVER_OBSERVED - nothing is ever SERVER_VERIFIED', () => {
  assert.equal(verificationOf('COMPLAINT_PHOTO'), 'RECORD_HASH_ONLY');
  assert.equal(verificationOf('PARTY_DOCUMENT'), 'DECLARED_NOT_VERIFIED');
  for (const s of ['COMPLAINT_RECORD', 'GYM_RECORD', 'MEMBERSHIP_RECORD', 'CHECKIN_SUMMARY']) assert.equal(verificationOf(s), 'SERVER_OBSERVED');
  for (const s of ['COMPLAINT_PHOTO', 'PARTY_DOCUMENT', 'COMPLAINT_RECORD', 'ANYTHING_ELSE']) assert.notEqual(verificationOf(s) as string, 'SERVER_VERIFIED');
  assert.match(verificationLabelVi('RECORD_HASH_ONLY'), /chưa kiểm chứng nội dung tệp/);
});

test('evidence access by role and branch: member sees own/shared/own-data, never the gym record or another branch; admin sees all', () => {
  const gymRec = { id: 'e1', source: 'GYM_RECORD', submittedBy: null, sensitivity: 'NORMAL', scopeGymId: 'g1' };
  const mine = { id: 'e2', source: 'PARTY_DOCUMENT', submittedBy: 'm1', sensitivity: 'NORMAL', scopeGymId: 'g1' };
  const other = { id: 'e3', source: 'PARTY_DOCUMENT', submittedBy: 'a1', sensitivity: 'NORMAL', scopeGymId: 'g1' };
  const membership = { id: 'e4', source: 'MEMBERSHIP_RECORD', submittedBy: null, sensitivity: 'NORMAL', scopeGymId: 'g1' };
  const sensitive = { id: 'e5', source: 'COMPLAINT_RECORD', submittedBy: null, sensitivity: 'SENSITIVE', scopeGymId: 'g1' };
  const wrongBranch = { id: 'e6', source: 'MEMBERSHIP_RECORD', submittedBy: null, sensitivity: 'NORMAL', scopeGymId: 'g2' };
  assert.equal(evidenceVisibleTo(gymRec, 'MEMBER', 'm1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(mine, 'MEMBER', 'm1', 'g1', []), true);
  assert.equal(evidenceVisibleTo(other, 'MEMBER', 'm1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(other, 'MEMBER', 'm1', 'g1', [{ evidenceId: 'e3', statementId: null, sharedWithRole: 'MEMBER' }]), true);
  assert.equal(evidenceVisibleTo(membership, 'MEMBER', 'm1', 'g1', []), true);
  assert.equal(evidenceVisibleTo(sensitive, 'MEMBER', 'm1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(wrongBranch, 'MEMBER', 'm1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(wrongBranch, 'ADMIN', 'a1', 'g1', []), true);
});

test('flag is fail-closed: only the exact string "true" inside NODE_ENV=test with an accepted isolated DB is effective', () => {
  __resetFlagWarnings();
  const on = { GYM_COMPLAINT_CASE_ENABLED: 'true', NODE_ENV: 'test', DB_ISOLATION: 'accepted' } as NodeJS.ProcessEnv;
  assert.equal(flagVerdict(on).effective, true);
  for (const v of ['TRUE', '1', 'true ', 'yes', '', undefined]) {
    assert.equal(flagVerdict({ ...on, GYM_COMPLAINT_CASE_ENABLED: v } as NodeJS.ProcessEnv).effective, false, `value ${String(v)}`);
  }
  assert.deepEqual(flagVerdict({ ...on, NODE_ENV: 'production' }), { effective: false, refusedBecause: 'NOT_TEST_ENV' });
  assert.deepEqual(flagVerdict({ ...on, NODE_ENV: undefined }), { effective: false, refusedBecause: 'NOT_TEST_ENV' });
  assert.deepEqual(flagVerdict({ ...on, DB_ISOLATION: 'refused' }), { effective: false, refusedBecause: 'DB_ISOLATION_NOT_ACCEPTED' });
  assert.deepEqual(flagVerdict({ ...on, DB_ISOLATION: undefined }), { effective: false, refusedBecause: 'DB_ISOLATION_NOT_ACCEPTED' });
  const saved = process.env.GYM_COMPLAINT_CASE_ENABLED;
  delete process.env.GYM_COMPLAINT_CASE_ENABLED;
  assert.equal(gymCaseEnabled(), false);
  if (saved !== undefined) process.env.GYM_COMPLAINT_CASE_ENABLED = saved;
});

test('money axis: full refund is F1 "da ghi vao vi", shortfall is F3 partial, unobserved clawback / blocked / executing are F3, none is "paid" unless confirmed', () => {
  const full = deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '250000.00', releaseShortfall: '0.00', clawbackObserved: true } });
  assert.equal(full.state, 'LEDGER_POSTED_FULL');
  assert.equal(full.group, 'F1');
  assert.match(full.label, /ví Gymini/);
  assert.doesNotMatch(full.label, /ngân hàng/i);

  const partial = deriveFinancialView({ outcome: 'REFUND_TRANSACTION_ERROR', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '100000.00', releaseShortfall: '50000.00', clawbackObserved: true } });
  assert.equal(partial.state, 'LEDGER_POSTED_PARTIAL');
  assert.equal(partial.group, 'F3');
  assert.equal(partial.memberShortfall, '50000.00');
  assert.equal(closureOf('DECISION_APPROVED', 'BUSINESS_DONE', partial), 'CLOSED_FINANCIAL_OPEN');
  assert.equal(closureOf('DECISION_APPROVED', 'BUSINESS_DONE', full), 'CLOSED');
  assert.equal(closureOf('DECISION_APPROVED', 'EXECUTING', full), 'OPEN');

  const claw = deriveFinancialView({ outcome: 'REFUND_GYM_VIOLATION', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '90000.00', releaseShortfall: '0.00', clawbackObserved: true, clawbackShortfall: '5000.00' } });
  assert.equal(claw.state, 'NEEDS_RECONCILIATION');
  assert.equal(claw.group, 'F3');
  assert.equal(claw.referralClawbackShortfall, '5000.00');
  const notSeen = deriveFinancialView({ outcome: 'REFUND_GYM_VIOLATION', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '90000.00', releaseShortfall: '0.00', clawbackObserved: false } });
  assert.equal(notSeen.group, 'F3');

  assert.equal(deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'EXECUTING', observation: null }).group, 'F3');
  assert.equal(deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'EXEC_BLOCKED', observation: null, blockedReason: 'X' }).state, 'REFUND_BLOCKED');
  assert.equal(deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'NEEDS_HUMAN', observation: null }).state, 'NEEDS_RECONCILIATION');
  assert.equal(deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'NOT_STARTED', observation: null }).group, 'NONE_YET');
  assert.equal(deriveFinancialView({ outcome: 'RESOLVE_UPHELD', execStatus: 'BUSINESS_DONE', observation: null }).group, 'F2');
  assert.equal(deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '0.00', releaseShortfall: '0.00', clawbackObserved: true } }).state, 'NO_REFUNDABLE_AMOUNT');
});

test('member text never claims money unless payment confirmed it, and never leaks the platform-side clawback shortfall or an internal group', () => {
  const pending = deriveFinancialView({ outcome: 'REFUND_GYM_CLOSED', execStatus: 'EXECUTING', observation: null });
  assert.doesNotMatch(memberFinancialView(pending).label, /đã được ghi vào ví|đã hoàn/);
  assert.doesNotMatch(memberResolutionText('REFUND_GYM_CLOSED', pending), /đã được ghi vào ví/);

  const claw = deriveFinancialView({ outcome: 'REFUND_GYM_VIOLATION', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '90000.00', releaseShortfall: '0.00', clawbackObserved: true, clawbackShortfall: '5000.00' } });
  const m = memberFinancialView(claw);
  assert.match(m.label, /90000\.00/);
  assert.doesNotMatch(JSON.stringify(m), /5000\.00|F3|NEEDS_RECONCILIATION|clawback/i);

  const partial = deriveFinancialView({ outcome: 'REFUND_TRANSACTION_ERROR', execStatus: 'BUSINESS_DONE', observation: { refundedToClient: '100000.00', releaseShortfall: '50000.00', clawbackObserved: true } });
  assert.match(memberResolutionText('REFUND_TRANSACTION_ERROR', partial), /chưa trả/);

  assert.match(memberResolutionText('RESOLVE_INSUFFICIENT_EVIDENCE', deriveFinancialView({ outcome: 'RESOLVE_INSUFFICIENT_EVIDENCE', execStatus: 'BUSINESS_DONE', observation: null })), /chưa đủ căn cứ/);
  assert.match(memberResolutionText('RESOLVE_INSUFFICIENT_EVIDENCE', deriveFinancialView({ outcome: 'RESOLVE_INSUFFICIENT_EVIDENCE', execStatus: 'BUSINESS_DONE', observation: null })), /Không có khoản tiền nào được hoàn/);
});

test('evidence change guard: new rows need an acknowledgement AFTER the last change plus the approver tick; stale live data is never acceptable', () => {
  const t0 = new Date('2026-11-03T10:00:00Z');
  const t1 = new Date('2026-11-03T11:00:00Z');
  const none = diffAgainstSnapshot({ snapshot: [{ id: 'a', hash: 'h', version: 1 }], current: [{ id: 'a', hash: 'h', createdAt: t0 }], staleLive: [] });
  assert.equal(none.changed, false);
  assert.equal(changeAcknowledged(none, false, []), true);
  const added = diffAgainstSnapshot({ snapshot: [{ id: 'a', hash: 'h', version: 1 }], current: [{ id: 'a', hash: 'h', createdAt: t0 }, { id: 'b', hash: 'x', createdAt: t1 }], staleLive: [] });
  assert.equal(added.changed, true);
  assert.equal(changeAcknowledged(added, true, []), false);
  assert.equal(changeAcknowledged(added, true, [t0]), false);
  assert.equal(changeAcknowledged(added, false, [t1]), false);
  assert.equal(changeAcknowledged(added, true, [t1]), true);
  const stale = diffAgainstSnapshot({ snapshot: [], current: [], staleLive: ['MEMBERSHIP_RECORD#m'] });
  assert.equal(changeAcknowledged(stale, true, [t1]), false);
});

test('Q31 four eyes: a user linked to the gym / brand (linkedUserIds) is refused as approver; an unlinked admin passes', () => {
  const base = { approverId: 'a2', approverRole: 'ADMIN', proposerId: 'a1', investigatorId: 'a1', reporterUserId: 'm1', gymOwnerId: 'o1', conflictOfInterestDeclaredNone: true };
  assert.deepEqual(checkApprover({ ...base, linkedUserIds: ['staff-1', 'brand-owner'] }), { ok: true });
  assert.equal((checkApprover({ ...base, approverId: 'staff-1', linkedUserIds: ['staff-1'] }) as any).code, 'CONFLICT_OF_INTEREST');
  assert.equal((checkApprover({ ...base, approverId: 'brand-owner', linkedUserIds: ['staff-1', 'brand-owner'] }) as any).code, 'CONFLICT_OF_INTEREST');
});

test('E1 pure: unused value on the complaint date - hand-computed 300,000 x 20/30 = 200,000.00; 0 after the term; never above the price; the executor date does not matter', async () => {
  const { unusedValueAt } = await import('../services/complaint-case/rules');
  const C = new Date('2026-11-01T00:00:00Z');
  const day = 86_400_000;
  const end = new Date(C.getTime() + 20 * day);
  assert.equal(unusedValueAt(300_000, 30, end, C), 200_000);
  assert.equal(unusedValueAt(300_000, 30, end, new Date(C.getTime() + 20 * day)), 0, 'on the last day nothing is left');
  assert.equal(unusedValueAt(300_000, 30, end, new Date(C.getTime() + 25 * day)), 0, 'after the term');
  assert.equal(unusedValueAt(300_000, 30, new Date(C.getTime() + 45 * day), C), 300_000, 'never above the price paid');
  assert.equal(unusedValueAt(100_000, 30, new Date(C.getTime() + 10 * day), C), 33_333.33, 'rounded to 2 decimals');
});
