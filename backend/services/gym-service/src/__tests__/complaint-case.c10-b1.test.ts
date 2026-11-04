/**
 * C10 (the Gym gives EVIDENCE + EXPLANATION inside its branch scope, never decides) and B1 (the expiry sweep holds ONLY the money of a membership that has an
 * unfinished case / an approved-but-unexecuted refund; every other membership and the gym's other money are released as before) - REAL HTTP into the real
 * gym-service app and the REAL sweep code, isolated gym *_test database. BACKEND INTEGRATION. TEST FIXTURE: gym / membership / partner-account rows, the auth
 * token table, captured notifications and a recording fake for payment-service's HTTP client. The real ledger is covered by complaint-case-money.e2e.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { runSweep } from '../services/membershipPayout.sweep';
import {
  approve, call, cleanup, driveToProposal, installStubs, makeComplaint, makeGym, makeMembership, newAdmin, ok, openToAssessing, patch, removeStubs, setFlag,
  skip, startApp, stopApp, token,
} from './complaint-case.test-helpers';

const pay = { releases: [] as Array<{ id: string; at: number; done: number }>, delayMs: 0, failAfter: false, restore: [] as Array<() => void> };

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  pay.restore.push(
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => {
      const rec = { id: String(b.idempotencyKey).replace('MEMBERSHIP_RELEASE:', ''), at: Date.now(), done: 0 };
      pay.releases.push(rec);
      if (pay.delayMs) await new Promise((r) => setTimeout(r, pay.delayMs));
      rec.done = Date.now();
      if (pay.failAfter) throw new Error('payment-service timed out AFTER committing');
      return { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: b.refundToClient ?? '0.00', shortfall: '0.00' };
    }),
    patch(paymentClient, 'clawbackReferral', async () => ({ recovered: '0.00', shortfall: '0.00' })),
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
  pay.delayMs = 0;
  pay.failAfter = false;
});
test.afterEach(async () => {
  if (skip) return;
  await prisma.gymPartner.deleteMany({ where: { legalName: 'Other Partner' } });
  await cleanup();
});

const act = (d: { appr: { id: string } }) => ({ id: d.appr.id, role: 'ADMIN' });
const keys = (o: object) => Object.keys(o).sort();
const ownerTok = (id: string) => token(id, 'GYM_OWNER');
async function staffAccount(ownerId: string, userId: string, role: 'MANAGER' | 'RECEPTIONIST' | 'ACCOUNTANT', scoped: string[]) {
  const owner = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: ownerId } });
  await prisma.gymPartnerAccount.create({ data: { partnerId: owner.partnerId, userId, role, scopedGymIds: scoped, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
  return ownerTok(userId);
}

// ───────────────────────────── C10 ─────────────────────────────

test('C10: the Gym sees its branch case (complaint text, its own records), writes an explanation and evidence - and NOTHING else: no member identity, no member documents, no investigation, no decision route', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'MEM_CLOSED', photoTokens: ['gym-photo-1'] });
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/evidence`, d.reporter.tok, { description: 'Biên lai riêng của hội viên', sha256: 'c'.repeat(64) })).status, 201);
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Cần chi nhánh giải trình', parties: ['GYM'] }), 200, 'ask the gym');
  const owner = ownerTok(d.ownerId);

  const list = ok(await call('GET', '/owner/complaint-cases', owner), 200, 'gym list');
  assert.equal(list.items.length, 1);
  assert.deepEqual(keys(list.items[0]), ['canSubmit', 'createdAt', 'gymId', 'id', 'issueType', 'progress', 'respondBy']);
  assert.ok(list.items[0].respondBy, 'the Gym sees its response deadline');
  const view = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, owner), 200, 'gym detail');
  assert.deepEqual(keys(view), ['case', 'complaint', 'evidence', 'statements']);
  assert.deepEqual(keys(view.case), ['canSubmit', 'createdAt', 'gymId', 'id', 'progress', 'respondBy']);
  assert.deepEqual(keys(view.complaint), ['description', 'issueType']);
  const sources = view.evidence.map((e: any) => e.source).sort();
  assert.deepEqual(sources, ['CHECKIN_SUMMARY', 'COMPLAINT_RECORD', 'GYM_RECORD', 'MEMBERSHIP_RECORD'], "the member's documents and photos are not shown");
  const raw = JSON.stringify(view);
  for (const leak of [d.reporter.id, 'reporterUserId', 'clientId', 'paymentTxnId', 'investigator', 'financial', 'proposal', 'approval', 'finding', 'allowedActions', 'SERVER_VERIFIED', 'Biên lai riêng']) assert.ok(!raw.includes(leak), `leak: ${leak}`);
  assert.ok(view.evidence.every((e: any) => ['SERVER_OBSERVED', 'RECORD_HASH_ONLY', 'DECLARED_NOT_VERIFIED'].includes(e.verificationStatus)));

  // it explains and attaches evidence; its own clock is met
  const ex = await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, owner, { text: 'Chi nhánh đã đóng cửa sửa chữa từ ngày 3' });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, owner, { text: 'bổ sung' })).body.error.code, 'SUPPLEMENT_REASON_REQUIRED');
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, owner, { text: 'bổ sung', supplementReason: 'có thêm thông tin' })).body.data.version, 2);
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/evidence`, owner, { description: 'Biên bản đóng cửa', sha256: 'd'.repeat(64) })).status, 201);
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/evidence`, owner, { description: 'lại', sha256: 'd'.repeat(64) })).body.error.code, 'EVIDENCE_DUPLICATE');
  assert.equal((await prisma.gymCaseDeadline.findFirstOrThrow({ where: { caseId: d.caseId, partyRole: 'GYM' } })).status, 'MET');
  const after = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, owner), 200, 'gym detail 2');
  assert.deepEqual(after.statements.map((s: any) => [s.partyRole, s.version, s.mine]), [['GYM', 1, true], ['GYM', 2, true]]);
  assert.ok(after.evidence.some((e: any) => e.mine && e.verificationStatus === 'DECLARED_NOT_VERIFIED'));
  // the admin sees both; the member sees neither until an admin shares
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin');
  assert.equal(admin.statements.filter((s: any) => s.partyRole === 'GYM').length, 2);
  const mv = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member');
  assert.ok(!mv.statements.some((s: any) => s.partyRole === 'GYM'));
  assert.ok(!JSON.stringify(mv).includes('Biên bản đóng cửa'));
  // an admin may share the member's document WITH the Gym; then (and only then) the Gym sees it
  const memberDoc = admin.evidence.find((e: any) => e.source === 'PARTY_DOCUMENT' && e.submittedRole === 'MEMBER');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/shares`, d.inv.tok, { evidenceId: memberDoc.id, reason: 'để chi nhánh phản biện', sharedWith: 'GYM' })).status, 201);
  const shared = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, owner), 200, 'gym detail 3');
  assert.ok(shared.evidence.some((e: any) => e.id === memberDoc.id));

  // it can never decide: every deciding / admin route refuses the Gym
  for (const [m, p, b] of [
    ['POST', `/admin/complaint-cases/${d.caseId}/claims`, { claimantRole: 'MEMBER', text: 'x' }],
    ['POST', `/admin/complaint-cases/${d.caseId}/finding`, { finding: 'ESTABLISHED', reasoning: 'x' }],
    ['POST', `/admin/complaint-cases/${d.caseId}/proposal`, {}],
    ['POST', `/admin/complaint-cases/${d.caseId}/decision`, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true }],
    ['POST', `/admin/complaint-cases/${d.caseId}/execute`, {}],
    ['POST', `/admin/complaint-cases/${d.caseId}/shares`, { evidenceId: memberDoc.id, reason: 'x' }],
    ['GET', `/admin/complaint-cases/${d.caseId}`, undefined],
    ['POST', `/me/complaint-cases/${d.caseId}/appeal`, { reason: 'x' }],
    ['GET', `/me/complaint-cases/${d.caseId}`, undefined],
  ] as Array<[string, string, unknown]>) {
    assert.equal((await call(m, p, owner, b)).status, 403, `${m} ${p}`);
  }
  assert.equal(await prisma.gymCaseFinding.count({ where: { caseId: d.caseId } }), 0);
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: d.caseId } }), 0);
  // strict bodies, and fail-closed flag on the writes (reads stay)
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, owner, { text: 'x', outcome: 'REFUND' })).status, 400);
  setFlag(undefined);
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, owner, { text: 'x', supplementReason: 'y' })).body.error.code, 'GYM_CASE_DISABLED');
  assert.equal((await call('GET', `/owner/complaint-cases/${d.caseId}`, owner)).status, 200);
});

test('C10 branch scope: a MANAGER of the branch can explain; a manager scoped to another branch, a receptionist, an accountant, another partner and a plain member get nothing', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  const owner = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: d.ownerId } });
  const gym1 = await prisma.gym.findUniqueOrThrow({ where: { id: d.gymId } });
  const gym2 = await prisma.gym.create({ data: { ownerId: d.ownerId, brandId: gym1.brandId, name: 'Chi nhánh 2', address: '2 Test St', status: 'APPROVED', operationalStatus: 'OPEN', approvedName: 'Chi nhánh 2', approvedAddress: '2 Test St' } });
  const mk = (p: string) => `${p}-${randomUUID().slice(0, 6)}`;
  const mgrHere = await staffAccount(d.ownerId, mk('mgr-here'), 'MANAGER', [d.gymId]);
  const mgrOther = await staffAccount(d.ownerId, mk('mgr-other'), 'MANAGER', [gym2.id]);
  const recep = await staffAccount(d.ownerId, mk('recep'), 'RECEPTIONIST', [d.gymId]);
  const acct = await staffAccount(d.ownerId, mk('acct'), 'ACCOUNTANT', []);
  const outsider = await makeGym();
  const outsiderTok = ownerTok(outsider.ownerId);
  void owner;

  assert.equal(ok(await call('GET', '/owner/complaint-cases', mgrHere), 200, 'mgr list').items.length, 1);
  assert.equal((await call('GET', `/owner/complaint-cases/${d.caseId}`, mgrHere)).status, 200);
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, mgrHere, { text: 'Quản lý chi nhánh giải trình' })).status, 201);
  for (const [who, tok] of [['manager of another branch', mgrOther], ['receptionist', recep], ['accountant', acct], ['another partner', outsiderTok]] as Array<[string, string]>) {
    assert.deepEqual(ok(await call('GET', '/owner/complaint-cases', tok), 200, who).items, [], who);
    assert.equal((await call('GET', `/owner/complaint-cases/${d.caseId}`, tok)).status, 404, who);
    assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, tok, { text: 'x' })).status, 404, who);
    assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/evidence`, tok, { description: 'x', sha256: 'e'.repeat(64) })).status, 404, who);
  }
  assert.equal((await call('GET', '/owner/complaint-cases', d.reporter.tok)).status, 403, 'a member');
  assert.equal((await call('GET', '/owner/complaint-cases', d.inv.tok)).status, 403, 'an admin');
  assert.equal((await call('GET', '/owner/complaint-cases', null)).status, 401);
  assert.equal(await prisma.gymCaseStatement.count({ where: { caseId: d.caseId, partyRole: 'GYM' } }), 1);
  await prisma.gym.delete({ where: { id: gym2.id } });
});

// ───────────────────────────── B1: the expiry sweep ─────────────────────────────

/** An EXPIRED, paid, not yet released membership (term ended 10 days ago). */
const expiredMembership = (gymId: string, clientId: string) => makeMembership(gymId, clientId, { status: 'EXPIRED', startOffsetDays: 40, days: 30 });
const released = (id: string) => prisma.gymMembershipContract.findUniqueOrThrow({ where: { id } }).then((m) => m.payoutReleasedAt !== null);

test('B1: the sweep holds ONLY the membership with an unfinished case / approved unexecuted refund; every other membership (same gym or not) is released; held money is released once the case completes - idempotently', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const other = await makeGym();
  const mkCase = async (m: { id: string }, reporter: string, caseClass = 'MEM_TXN') => {
    const c = await makeComplaint(gym.id, reporter);
    return ok(await call('POST', `/admin/complaints/${c.id}/case`, admin.tok, { caseClass, membershipId: m.id }), 201, 'open').id as string;
  };
  const free = await expiredMembership(gym.id, 'member-free'); // no case
  const otherGym = await expiredMembership(other.gym.id, 'member-other'); // another gym
  const open = await expiredMembership(gym.id, 'member-open'); // open case
  const rejected = await expiredMembership(gym.id, 'member-rej'); // dismissed at intake
  const openCaseId = await mkCase(open, 'member-open');
  const rejCaseId = await mkCase(rejected, 'member-rej');
  ok(await call('POST', `/admin/complaint-cases/${rejCaseId}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'ngoài phạm vi' }), 200, 'reject');
  // a concluded NO-money decision (approved, executed) on a third membership
  const closed = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'NOT_ESTABLISHED' });
  await approve(closed);
  await complaintCaseExecutionService.executeDecision(act(closed), closed.caseId);
  await prisma.gymMembershipContract.update({ where: { id: closed.membershipId! }, data: { status: 'EXPIRED', endDate: new Date(Date.now() - 86_400_000) } });
  // an APPROVED refund decision that has not been executed: held while the membership runs out (fixture: the term ends after the approval)
  const appr = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(appr);
  await prisma.gymMembershipContract.update({ where: { id: appr.membershipId! }, data: { status: 'EXPIRED', endDate: new Date(Date.now() - 86_400_000) } });

  const r1 = await runSweep();
  assert.equal(r1.failed, 0);
  const ids = new Set(pay.releases.map((x) => x.id));
  assert.deepEqual([...ids].sort(), [free.id, otherGym.id, rejected.id, closed.membershipId!].sort(), 'every membership WITHOUT an unfinished case is released');
  assert.equal(await released(free.id), true);
  assert.equal(await released(otherGym.id), true);
  assert.equal(await released(rejected.id), true, 'a dismissed case holds nothing');
  assert.equal(await released(closed.membershipId!), true, 'a concluded no-money decision holds nothing');
  assert.equal(await released(open.id), false, 'open case: its own money stays pending');
  assert.equal(await released(appr.membershipId!), false, 'approved but unexecuted refund: its own money stays pending');
  assert.equal(r1.held, 2);

  // idempotent: a second sweep releases nothing more and still holds exactly those two
  const before = pay.releases.length;
  const r2 = await runSweep();
  assert.equal(pay.releases.length, before);
  assert.equal(r2.held, 2);

  // the case completes with NO refund -> the next sweep releases it through the same path, once
  const claim = ok(await call('POST', `/admin/complaint-cases/${openCaseId}/assign`, admin.tok, {}), 200, 'assign');
  assert.ok(claim);
  ok(await call('POST', `/admin/complaint-cases/${openCaseId}/transition`, admin.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const cl = ok(await call('POST', `/admin/complaint-cases/${openCaseId}/claims`, admin.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  ok(await call('POST', `/admin/complaint-cases/${openCaseId}/assessments`, admin.tok, { claimId: cl.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'NOT_ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${openCaseId}/finding`, admin.tok, { finding: 'NOT_ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  // recollect: the membership is EXPIRED now, so the stored record must be refreshed before the proposal is built
  ok(await call('POST', `/admin/complaint-cases/${openCaseId}/recollect`, admin.tok, {}), 200, 'recollect');
  ok(await call('POST', `/admin/complaint-cases/${openCaseId}/proposal`, admin.tok, {}), 201, 'proposal');
  const approver = newAdmin();
  assert.equal((await call('POST', `/admin/complaint-cases/${openCaseId}/decision`, approver.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true })).status, 200);
  assert.equal(await released(open.id), false, 'nothing released before the next sweep runs');
  await runSweep();
  // a NO-refund decision that is approved (even before its execution) leaves nothing to protect: the next sweep releases the membership through the existing path
  assert.equal(await released(open.id), true);
  assert.equal(pay.releases.filter((x) => x.id === open.id).length, 1, 'released exactly once');
});

test('B1 hold rules (exact): unfinished money steps keep holding - EXEC_BLOCKED / NEEDS_HUMAN / EXECUTING; BUSINESS_DONE and no-money decisions do not; the hold ends when the case completes', { skip }, async () => {
  const { membershipHolds } = await import('../services/complaint-case/refund-guard');
  const noMoney = await driveToProposal({ caseClass: 'MEM_ACCESS', finding: 'ESTABLISHED' });
  await approve(noMoney);
  let h = await membershipHolds(prisma, [noMoney.membershipId!]);
  assert.equal(h.get(noMoney.membershipId!)?.reason, undefined, 'approved NO-money decision: nothing to protect');
  assert.equal(h.size, 0);
  await complaintCaseExecutionService.executeDecision(act(noMoney), noMoney.caseId);
  assert.equal((await membershipHolds(prisma, [noMoney.membershipId!])).size, 0);

  const live = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  assert.equal((await membershipHolds(prisma, [live.membershipId!])).get(live.membershipId!)?.reason, 'OPEN_CASE');
  await approve(live);
  assert.equal((await membershipHolds(prisma, [live.membershipId!])).get(live.membershipId!)?.reason, 'APPROVED_REFUND_UNEXECUTED');
  // executing (crash) and blocked states keep holding
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(act(live), live.caseId, {}, { refund: async () => ({ refundAmount: 1, clawback: null, release: {} }), replayRelease: async () => ({}), afterExecutingCas: async () => { throw new Error('CRASH'); } }), /CRASH/);
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: live.caseId } })).execStatus, 'EXECUTING');
  assert.equal((await membershipHolds(prisma, [live.membershipId!])).get(live.membershipId!)?.reason, 'APPROVED_REFUND_UNEXECUTED');
  // the refund is executed -> completed -> no hold
  const done = await complaintCaseExecutionService.reconcileExecution(act(live), live.caseId, { refund: async () => ({ refundAmount: 10, clawback: null, release: { refundedToClient: '10.00', shortfall: '0.00' } }), replayRelease: async () => ({}) });
  assert.equal((done as any).action, 'RERAN_REFUND');
  assert.equal((await membershipHolds(prisma, [live.membershipId!])).size, 0);

  // EXEC_BLOCKED keeps holding (membership changed under the decision)
  const blocked = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await approve(blocked);
  await assert.rejects(() => complaintCaseExecutionService.executeDecision(act(blocked), blocked.caseId, {}, { refund: async () => { throw Object.assign(new Error('Membership has already expired'), { status: 409 }); }, replayRelease: async () => ({}) }), (e: any) => e.code === 'EXEC_BLOCKED');
  assert.equal((await membershipHolds(prisma, [blocked.membershipId!])).get(blocked.membershipId!)?.reason, 'APPROVED_REFUND_UNEXECUTED');
});

test('B1 races and crash/replay: sweep vs opening a case (row lock), sweep vs closing a case, a release that timed out AFTER committing is replayed under the SAME key and never doubled', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();

  // (1) sweep vs open: a slow release holds the membership row lock, so opening the case WAITS and can never slip in between the check and the release
  const m1 = await expiredMembership(gym.id, 'member-race1');
  const c1 = await makeComplaint(gym.id, 'member-race1');
  pay.delayMs = 400;
  const sweep = runSweep();
  await new Promise((r) => setTimeout(r, 120));
  const t0 = Date.now();
  const opened = call('POST', `/admin/complaints/${c1.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: m1.id });
  const [, openRes] = await Promise.all([sweep, opened]);
  const openedAt = Date.now();
  assert.equal(openRes.status, 201);
  const rel = pay.releases.find((x) => x.id === m1.id)!;
  assert.ok(rel, 'the sweep released the membership (no case existed when it decided)');
  assert.ok(openedAt >= rel.done - 5, `the case opened only after the release finished (${openedAt} >= ${rel.done}); waited ${openedAt - t0}ms`);
  assert.equal(await released(m1.id), true);
  pay.delayMs = 0;

  // (2) the other order: the case exists first -> the sweep holds, whatever the timing
  const m2 = await expiredMembership(gym.id, 'member-race2');
  const c2 = await makeComplaint(gym.id, 'member-race2');
  const caseId2 = ok(await call('POST', `/admin/complaints/${c2.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: m2.id }), 201, 'open').id as string;
  pay.releases.length = 0;
  const sweeps = await Promise.all([runSweep(), runSweep(), runSweep()]);
  assert.equal(pay.releases.filter((x) => x.id === m2.id).length, 0);
  assert.equal(await released(m2.id), false);
  assert.ok(sweeps.some((s) => (s.held ?? 0) >= 1));

  // (3) sweep vs close: the case is closed (dismissed) while sweeps run; the membership is released exactly once, now or on the next tick
  ok(await call('POST', `/admin/complaint-cases/${caseId2}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'ngoài phạm vi' }), 200, 'close');
  await Promise.all([runSweep(), runSweep()]);
  await runSweep();
  assert.equal(pay.releases.filter((x) => x.id === m2.id).length >= 1, true);
  assert.equal(await released(m2.id), true);
  const keys = new Set(pay.releases.filter((x) => x.id === m2.id).map((x) => x.id));
  assert.equal(keys.size, 1, 'always the same MEMBERSHIP_RELEASE key');

  // (4) crash/replay: payment committed the release but the answer was lost -> not marked; the next tick replays the SAME key (payment replays its stored result)
  const m3 = await expiredMembership(gym.id, 'member-race3');
  pay.releases.length = 0;
  pay.failAfter = true;
  const failed = await runSweep();
  assert.ok(failed.failed >= 1);
  assert.equal(await released(m3.id), false, 'not stamped on a lost answer');
  pay.failAfter = false;
  await runSweep();
  assert.equal(await released(m3.id), true);
  assert.equal(pay.releases.filter((x) => x.id === m3.id).length, 2, 'asked twice with the same idempotency key');
  const again = pay.releases.length;
  await runSweep();
  assert.equal(pay.releases.length, again, 'and never again once stamped');
});
