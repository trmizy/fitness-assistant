import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GYM_PARTY_ENABLED,
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
  assert.deepEqual(TRANSITIONS.DECISION_APPROVED, []);
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

test('the Gym is NOT a party (policy lock): its people see nothing, even when scoped to the branch', () => {
  assert.equal(GYM_PARTY_ENABLED, false);
  const c = { reporterUserId: 'm1', gymId: 'g1' };
  assert.equal(viewerKind({ userId: 'o1', role: 'GYM_OWNER', gymIds: ['g1'] }, c), 'NONE');
  assert.equal(viewerKind({ userId: 'a1', role: 'ADMIN' }, c), 'ADMIN');
  assert.equal(viewerKind({ userId: 'm1', role: 'CUSTOMER' }, c), 'MEMBER');
  assert.equal(viewerKind({ userId: 'm2', role: 'CUSTOMER' }, c), 'NONE');
  const ev = { id: 'e1', source: 'GYM_RECORD', submittedBy: null, sensitivity: 'NORMAL', scopeGymId: 'g1' };
  assert.equal(evidenceVisibleTo(ev, 'NONE', 'o1', 'g1', []), false);
  assert.equal(evidenceVisibleTo(ev, 'GYM', 'o1', 'g1', []), false);
  assert.equal(statementVisibleTo({ id: 's', partyRole: 'MEMBER', authorUserId: 'm1' }, 'NONE', 'o1', []), false);
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
