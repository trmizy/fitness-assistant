/**
 * FIX4-GYMCASE (N15A-01, N15A-03 reporter name, N15A-06, N15A-07) - BACKEND INTEGRATION: REAL HTTP into the real gym-service app + real service code on the isolated
 * *_test database. TEST FIXTURE: gym / membership rows, the auth token table, captured notifications, a recording fake of payment-service's HTTP client.
 *   N15A-01/07  the admin's "request more" note, who was asked and the deadline reach ONLY the asked party; once it answers its "Cần bạn bổ sung" clears; progress follows who was asked.
 *   N15A-06     assigning an appeal reviewer after an executed refund re-collects the system evidence automatically: no EVIDENCE_CHANGED at approval, earlier assessment kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { setAccountLockLookupForTests } from '../services/complaint-case/deadlines.service';
import { approve, call, cleanup, driveToProposal, installStubs, newAdmin, ok, openToAssessing, patch, removeStubs, setFlag, skip, startApp, stopApp, token } from './complaint-case.test-helpers';

const restore: Array<() => void> = [];
test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
  restore.push(
    patch(paymentClient, 'releaseMembershipPending', async (b: any) => ({ released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: b.refundToClient ?? '0.00', shortfall: '0.00' })),
    patch(paymentClient, 'clawbackReferral', async () => ({ recovered: '0.00', shortfall: '0.00' })),
  );
});
test.after(async () => {
  setFlag(undefined);
  while (restore.length) restore.pop()!();
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.beforeEach(() => {
  if (skip) return;
  setFlag(true);
  setAccountLockLookupForTests(async () => false);
});
test.afterEach(async () => {
  if (skip) return;
  setAccountLockLookupForTests();
  await cleanup();
});

const ownerTok = (id: string) => token(id, 'GYM_OWNER');

test('N15A-01/07: asking only the GYM shows the note + deadline to the gym, NOTHING to the member, and the status text follows who was asked', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'MEM_CLOSED' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Cần chi nhánh gửi biên bản đóng cửa', parties: ['GYM'] }), 200, 'ask the gym');
  const gym = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, ownerTok(d.ownerId)), 200, 'gym detail');
  assert.equal(gym.moreInfo.note, 'Cần chi nhánh gửi biên bản đóng cửa');
  assert.deepEqual(gym.moreInfo.askedParties, ['GYM']);
  assert.ok(gym.moreInfo.dueAt, 'the gym sees its deadline');
  assert.equal(gym.case.progress, 'Cần bạn bổ sung thông tin');
  const member = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member detail');
  assert.equal(member.moreInfo, null, 'the member was not asked');
  assert.equal(member.case.progress, 'Đang xem xét', 'never claims the member must add anything');
  const mine = ok(await call('GET', '/me/complaint-cases', d.reporter.tok), 200, 'member list');
  assert.equal(mine.items[0].progress, 'Đang xem xét');
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin detail');
  assert.deepEqual(admin.moreInfo.askedParties, ['GYM']);
  assert.deepEqual(admin.moreInfo.pendingParties, ['GYM']);
  // the gym answers -> its state clears
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, ownerTok(d.ownerId), { text: 'Chi nhánh đóng cửa sửa chữa' })).status, 201);
  const after = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, ownerTok(d.ownerId)), 200, 'gym detail 2');
  assert.equal(after.moreInfo, null);
  assert.equal(ok(await call('GET', '/owner/complaint-cases', ownerTok(d.ownerId)), 200, 'gym list').items[0].awaitingYou, false, 'answered: nothing awaits the gym');
  assert.notEqual(after.case.progress, 'Cần bạn bổ sung thông tin');
  const admin2 = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin detail 2');
  assert.deepEqual(admin2.moreInfo.pendingParties, []);
});

test('N15A-01/07: asking BOTH - each sees the note, answering clears only its own side; asking only the MEMBER shows the member and not the gym', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'MEM_CLOSED' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Cả hai bên vui lòng làm rõ', parties: ['MEMBER', 'GYM'] }), 200, 'ask both');
  let member = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member');
  assert.equal(member.moreInfo.note, 'Cả hai bên vui lòng làm rõ');
  assert.deepEqual(member.moreInfo.askedParties.sort(), ['GYM', 'MEMBER']);
  assert.ok(member.moreInfo.dueAt);
  assert.equal(member.case.progress, 'Cần bạn bổ sung thông tin');
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'Tôi đã thông báo cho lễ tân' })).status, 201);
  member = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member after');
  assert.equal(member.moreInfo, null, 'the member answered');
  assert.notEqual(member.case.progress, 'Cần bạn bổ sung thông tin');
  assert.equal(ok(await call('GET', '/me/complaint-cases', d.reporter.tok), 200, 'list').items[0].progress, member.case.progress);
  const gym = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, ownerTok(d.ownerId)), 200, 'gym still asked');
  assert.ok(gym.moreInfo, 'the gym has not answered yet');
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin');
  assert.deepEqual(admin.moreInfo.pendingParties, ['GYM']);

  // a new round asking only the member: the gym is not asked any more
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/transition`, d.inv.tok, { to: 'ASSESSING' }), 200, 'back');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Chỉ khách bổ sung ảnh', parties: ['MEMBER'] }), 200, 'ask member');
  member = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member 3');
  assert.equal(member.moreInfo.note, 'Chỉ khách bổ sung ảnh');
  assert.deepEqual(member.moreInfo.askedParties, ['MEMBER']);
  assert.equal(ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, ownerTok(d.ownerId)), 200, 'gym 3').moreInfo, null);
  assert.equal(ok(await call('GET', '/owner/complaint-cases', ownerTok(d.ownerId)), 200, 'gym list 3').items[0].awaitingYou, false, 'only the member was asked');
});

test('N15A-03: the admin case detail carries the reporter name (fail-soft: null when auth-service cannot name the user, never a raw id as a name)', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'MEM_CLOSED' });
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin');
  assert.ok('reporterName' in admin.complaint);
  assert.ok(admin.complaint.reporterName === null || typeof admin.complaint.reporterName === 'string');
  assert.notEqual(admin.complaint.reporterName, d.reporter.id);
});

test('N15A-06: appeal reviewer assigned AFTER a refund -> the system evidence is re-collected automatically, the earlier assessment is kept, approval is NOT blocked by EVIDENCE_CHANGED', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED', membership: { price: 700_000, days: 30 } });
  assert.equal((await approve(d)).status, 200);
  const first = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId);
  assert.equal(first.executionState, 'BUSINESS_DONE');
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: d.membershipId! } })).status, 'CANCELLED');
  const assessmentsBefore = await prisma.gymCaseAssessment.count({ where: { caseId: d.caseId } });

  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'Tôi muốn xem xét lại' })).status, 201);
  const rev = newAdmin();
  const assigned = ok(await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: rev.id }), 200, 'assign reviewer');
  assert.ok(assigned.evidenceRecollected >= 1, 'the membership record (CANCELLED by the refund) was re-collected');
  assert.equal(assigned.materialEvidenceChange, false, 'only the refund own effect changed');
  const ev = await prisma.gymCaseEvent.findFirstOrThrow({ where: { caseId: d.caseId, action: 'EVIDENCE_RECOLLECTED' } });
  assert.equal(ev.actorUserId, 'system');
  assert.equal(await prisma.gymCaseAssessment.count({ where: { caseId: d.caseId } }), assessmentsBefore, 'earlier assessments are untouched');
  // nothing left to re-collect by hand
  const manual = ok(await call('POST', `/admin/complaint-cases/${d.caseId}/recollect`, rev.tok, {}), 200, 'manual recollect');
  assert.deepEqual(manual.changed, []);

  // the reviewer assesses, concludes, proposes; another admin approves WITHOUT any re-collect / acknowledgement loop
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, rev.tok), 200, 'detail');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/assessments`, rev.tok, { claimId: detail.claims[0].id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'NOT_ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, rev.tok, { finding: 'NOT_ESTABLISHED', reasoning: 'Kết luận độc lập' }), 201, 'finding');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, rev.tok, {}), 201, 'proposal');
  const dec = await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, newAdmin().tok, { result: 'APPROVED', reason: 'đồng ý', conflictOfInterestDeclaredNone: true });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
});

test('N15A-06: a change BEYOND the refund own effect (e.g. check-ins) is flagged material so the reviewer re-assesses', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED', membership: { price: 700_000, days: 30 } });
  assert.equal((await approve(d)).status, 200);
  await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId);
  // TEST FIXTURE: a check-in that appeared after the case evidence was collected
  await prisma.$executeRawUnsafe(`UPDATE gym_membership_contracts SET used_visits = used_visits + 1 WHERE id = $1`, d.membershipId);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'Xem lại' })).status, 201);
  const assigned = ok(await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: newAdmin().id }), 200, 'assign');
  assert.equal(assigned.materialEvidenceChange, true);
});
