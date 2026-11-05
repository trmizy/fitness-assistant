/**
 * A1 (SLA day 10/14, response deadlines 72h/48h from a delivered notice, one appeal with an independent reviewer), C7 (REJECTED_INTAKE hand-back cannot bypass
 * the case / refund guard / conflict of interest) and C9 (honest evidence labels) - REAL HTTP into the real gym-service app, real service code, isolated gym
 * *_test database. BACKEND INTEGRATION. TEST FIXTURE: gym / membership / partner-account rows, the auth token table, captured notifications (with a switch that makes
 * user-service "not accept" a notice), a recording fake for payment-service's HTTP client, and back-dated timestamps (append-only notice rows are back-dated with the
 * trigger switched off, in this isolated database only). The real ledger is covered by complaint-case-money.e2e.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { paymentClient } from '../clients/payment.client';
import { userClient } from '../clients/user.client';
import { complaintCaseService } from '../services/complaint-case/case.service';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { appealService } from '../services/complaint-case/appeal.service';
import { runCaseDeadlineSweep, runCaseSlaSweep } from '../services/complaint-case/deadlines.service';
import {
  approve, call, cleanup, driveToProposal, installStubs, makeComplaint, makeGym, makeMembership, newAdmin, notices, notify, ok, openToAssessing, patch,
  removeStubs, setFlag, skip, startApp, stopApp, token,
} from './complaint-case.test-helpers';

const pay = { releases: [] as Array<{ id: string; refund: string }>, restore: [] as Array<() => void>, adminNotices: [] as string[] };
const DAY = 24 * 3600 * 1000;
const H = 3600 * 1000;

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
  pay.releases.length = 0;
  pay.adminNotices.length = 0;
});
test.afterEach(async () => {
  if (skip) return;
  await prisma.gymPartner.deleteMany({ where: { legalName: 'Other Partner' } });
  await cleanup();
});

const act = (d: { appr: { id: string } }) => ({ id: d.appr.id, role: 'ADMIN' });
const backdateNotices = async (caseId: string, kind: string, ms: number) => {
  await prisma.$executeRawUnsafe('ALTER TABLE gym_case_notices DISABLE TRIGGER gym_case_notices_append_only');
  try {
    await prisma.$executeRawUnsafe(`UPDATE gym_case_notices SET created_at = created_at - ($1 || ' milliseconds')::interval WHERE case_id = $2::uuid AND kind = $3`, String(ms), caseId, kind);
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE gym_case_notices ENABLE TRIGGER gym_case_notices_append_only');
  }
};
const assess = async (d: { caseId: string; inv: { tok: string } }, result = 'ESTABLISHED') => {
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  const claimId = detail.claims[0].id;
  return ok(await call('POST', `/admin/complaint-cases/${d.caseId}/assessments`, d.inv.tok, { claimId, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result, reasoning: 'r' }), 201, 'assess');
};

// ───────────────────────────── A1: SLA ─────────────────────────────

test('A1 SLA: warning at calendar day 10, overdue + escalated at day 14, each once, admins told, NO ruling and no money; terminal cases are not flagged; flag off = nothing', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  const done = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  await approve(done);
  await complaintCaseExecutionService.executeDecision(act(done), done.caseId); // terminal
  const t0 = (await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).createdAt;
  const at = (days: number, h = 0) => new Date(t0.getTime() + days * DAY + h * H);

  assert.deepEqual(await runCaseSlaSweep(at(9, 23)), { warned: 0, escalated: 0 });
  const w = await runCaseSlaSweep(at(10));
  assert.deepEqual(w, { warned: 1, escalated: 0 });
  let row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.ok(row.slaWarnedAt && !row.slaOverdueAt);
  assert.equal(row.escalated, false);
  assert.equal(row.status, 'ASSESSING', 'a warning rules nothing');
  assert.deepEqual(await runCaseSlaSweep(at(11)), { warned: 0, escalated: 0 }, 'once only');
  const o = await runCaseSlaSweep(at(14));
  assert.deepEqual(o, { warned: 0, escalated: 1 });
  row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.ok(row.slaOverdueAt);
  assert.equal(row.escalated, true);
  assert.equal(row.status, 'ASSESSING', 'overdue escalates, it does not decide');
  assert.deepEqual(await runCaseSlaSweep(at(30)), { warned: 0, escalated: 0 });
  assert.deepEqual(pay.adminNotices, ['GYM_COMPLAINT_CASE_SLA_WARNING', 'GYM_COMPLAINT_CASE_SLA_OVERDUE']);
  const actions = (await prisma.gymCaseEvent.findMany({ where: { caseId: d.caseId }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
  assert.equal(actions.filter((a) => a === 'SLA_WARNING').length, 1);
  assert.equal(actions.filter((a) => a === 'SLA_OVERDUE_ESCALATED').length, 1);
  assert.equal(pay.releases.length, 0, 'SLA moves no money');
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: done.caseId } })).slaWarnedAt, null, 'a concluded case is not flagged');
  // the admin screen shows it
  const view = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  assert.equal(view.sla.state, 'OK', 'computed against the real clock (the complaint is new); the stored flags are what the sweep set');
  assert.ok(view.sla.overdueAt);

  // a day-14 case from the very start jumps straight to overdue (and counts as warned)
  const e = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  await prisma.gymComplaint.update({ where: { id: e.complaintId }, data: { createdAt: new Date(Date.now() - 20 * DAY) } });
  const r = await runCaseSlaSweep(new Date());
  assert.equal(r.escalated >= 1, true);
  const er = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: e.caseId } });
  assert.ok(er.slaWarnedAt && er.slaOverdueAt);

  const f = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  await prisma.gymComplaint.update({ where: { id: f.complaintId }, data: { createdAt: new Date(Date.now() - 20 * DAY) } });
  setFlag(undefined);
  assert.deepEqual(await runCaseSlaSweep(new Date()), { warned: 0, escalated: 0 }, 'fail-closed flag');
});

// ───────────────────────────── A1: response deadlines ─────────────────────────────

test('A1 deadlines: 72h first response / 48h per supplement round from a DELIVERED notice; met by a submission; expiry records a NEUTRAL fact and only moves the step; no notice = no clock', { skip }, async () => {
  const d = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Cần giải trình', parties: ['MEMBER', 'GYM'] }), 200, 'request-more');
  const dl = await prisma.gymCaseDeadline.findMany({ where: { caseId: d.caseId }, orderBy: { partyRole: 'asc' } });
  assert.deepEqual(dl.map((x) => [x.partyRole, x.kind, x.status]), [['MEMBER', 'FIRST_RESPONSE', 'OPEN'], ['GYM', 'FIRST_RESPONSE', 'OPEN']]);
  for (const x of dl) {
    const notice = await prisma.gymCaseNotice.findUniqueOrThrow({ where: { id: x.noticeId } });
    assert.equal(notice.delivered, true);
    assert.equal(x.startsAt.getTime(), notice.createdAt.getTime(), 'the clock starts at the delivered notice');
    assert.equal(x.dueAt.getTime() - x.startsAt.getTime(), 72 * H);
  }
  assert.deepEqual(notices.filter((n) => n.eventType === 'GYM_COMPLAINT_CASE_MORE_INFO').map((n) => n.userId).sort(), [d.ownerId, d.reporter.id].sort());
  // a second request while OPEN does not restart the clock
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'nhắc lại', parties: ['MEMBER'] }), 200, 'again');
  assert.equal(await prisma.gymCaseDeadline.count({ where: { caseId: d.caseId } }), 2);

  // not yet due: nothing happens
  assert.deepEqual(await runCaseDeadlineSweep(new Date(Date.now() + 71 * H)), { expired: 0, stepMoved: 0 });
  // the member answers: MET
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'Đây là phản hồi của tôi' })).status, 201);
  assert.equal((await prisma.gymCaseDeadline.findFirstOrThrow({ where: { caseId: d.caseId, partyRole: 'MEMBER' } })).status, 'MET');
  // the Gym is silent: after 72h the fact is recorded and ONLY the step moves
  const r = await runCaseDeadlineSweep(new Date(Date.now() + 73 * H));
  assert.deepEqual(r, { expired: 1, stepMoved: 1 });
  const c = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.equal(c.status, 'ASSESSING');
  assert.equal(await prisma.gymCaseFinding.count({ where: { caseId: d.caseId } }), 0, 'no finding');
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: d.caseId } }), 0, 'no proposal');
  assert.equal((await prisma.gymCaseDeadline.findFirstOrThrow({ where: { caseId: d.caseId, partyRole: 'GYM' } })).status, 'EXPIRED');
  const ev = await prisma.gymCaseEvent.findFirstOrThrow({ where: { caseId: d.caseId, action: 'NO_RESPONSE_RECORDED' } });
  assert.match(ev.note ?? '', /trung tính/);
  assert.deepEqual(await runCaseDeadlineSweep(new Date(Date.now() + 200 * H)), { expired: 0, stepMoved: 0 }, 'idempotent');
  // the next round is a 48h SUPPLEMENT_ROUND for the Gym
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'lần hai', parties: ['GYM'] }), 200, 'round 2');
  const r2 = await prisma.gymCaseDeadline.findFirstOrThrow({ where: { caseId: d.caseId, partyRole: 'GYM', status: 'OPEN' } });
  assert.equal(r2.kind, 'SUPPLEMENT_ROUND');
  assert.equal(r2.dueAt.getTime() - r2.startsAt.getTime(), 48 * H);
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  assert.equal(detail.deadlines.length, 3);

  // a notice user-service did not accept starts NO clock (and the investigator can see why)
  const e = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  notify.delivers = false;
  ok(await call('POST', `/admin/complaint-cases/${e.caseId}/request-more`, e.inv.tok, { to: 'AWAITING_PARTIES', note: 'x' }), 200, 'undelivered');
  notify.delivers = true;
  assert.equal(await prisma.gymCaseDeadline.count({ where: { caseId: e.caseId } }), 0);
  assert.equal((await prisma.gymCaseNotice.findFirstOrThrow({ where: { caseId: e.caseId, kind: 'MORE_INFO' } })).delivered, false);
  assert.ok(await prisma.gymCaseEvent.findFirst({ where: { caseId: e.caseId, action: 'DEADLINE_NOT_STARTED' } }));
  await runCaseDeadlineSweep(new Date(Date.now() + 500 * H)); // (expires the earlier case's round-2 deadline; must not touch this one)
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: e.caseId } })).status, 'AWAITING_PARTIES', 'no clock, so nothing moves the step');
  // flag off: the sweep does nothing
  const g = await openToAssessing({ caseClass: 'GYM_GENERAL' });
  ok(await call('POST', `/admin/complaint-cases/${g.caseId}/request-more`, g.inv.tok, { to: 'AWAITING_PARTIES', note: 'x' }), 200, 'for flag');
  setFlag(undefined);
  assert.deepEqual(await runCaseDeadlineSweep(new Date(Date.now() + 500 * H)), { expired: 0, stepMoved: 0 });
});

// ───────────────────────────── A1: appeal ─────────────────────────────

test('A1 appeal: once, by the member, within 14 days of the DELIVERED conclusion notice; independent reviewer; new finding references the old; money only through the existing four-eyes + execute path, never automatic', { skip }, async () => {
  // the original case: NOT established (no refund) on an ACTIVE membership, concluded
  const d = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'NOT_ESTABLISHED' });
  await approve(d);
  await complaintCaseExecutionService.executeDecision(act(d), d.caseId);
  assert.equal(pay.releases.length, 0);
  const conclusion = await prisma.gymCaseNotice.findFirstOrThrow({ where: { caseId: d.caseId, kind: 'CONCLUSION' } });
  assert.equal(conclusion.delivered, true);
  const oldFinding = await prisma.gymCaseFinding.findFirstOrThrow({ where: { caseId: d.caseId } });
  const before = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member');
  assert.equal(before.appeal.canFile, true);
  assert.equal(before.appeal.used, false);

  // who can file: only the reporter
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, token('stranger', 'CUSTOMER'), { reason: 'x' })).status, 404);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, token(d.ownerId, 'GYM_OWNER'), { reason: 'x' })).status, 403, 'the Gym never appeals');
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.inv.tok, { reason: 'x' })).status, 403);
  await assert.rejects(() => appealService.fileAppeal({ id: d.ownerId, role: 'CUSTOMER' }, d.caseId, { reason: 'x' }), (e: any) => e.status === 404);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'x', outcome: 'REFUND' })).status, 400, 'strict body');

  const filed = await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'Tôi có thêm biên lai' });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'lần hai' })).body.error.code, 'APPEAL_ALREADY_USED');
  let row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.equal(row.status, 'APPEAL_REVIEW');
  assert.equal(row.investigatorId, null, 'nobody (not even the old investigator) can act until a reviewer is assigned');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/claims`, d.inv.tok, { claimantRole: 'MEMBER', text: 'x' })).status, 403);
  assert.equal(pay.releases.length, 0, 'filing an appeal moves nothing');
  assert.equal((await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok)).body.data.case.progress, 'Đang xem xét kháng nghị');
  // the membership is protected while the appeal runs
  assert.equal((await call('POST', `/admin/gym-memberships/${d.membershipId}/refund`, newAdmin().tok, { reason: 'GYM_CLOSED' })).body.error.code, 'GYM_CASE_OPEN');

  // independent reviewer: not the investigator / approver / executor, not a party, not the member
  const ghost = await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, d.appr.tok, { reviewerId: 'nobody' });
  assert.equal(ghost.body.error.code, 'ADMIN_NOT_FOUND');
  for (const who of [d.inv, d.appr]) {
    const r = await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: who.id });
    assert.equal(r.status, 403, who.id);
    assert.equal(r.body.error.code, 'REVIEWER_NOT_INDEPENDENT', who.id);
  }
  const staff = newAdmin();
  await prisma.gymPartnerAccount.create({ data: { partnerId: (await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: d.ownerId } })).partnerId, userId: staff.id, role: 'MANAGER', scopedGymIds: [d.gymId], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: staff.id })).body.error.code, 'CONFLICT_OF_INTEREST');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, d.inv.tok, { reviewerId: undefined })).body.error.code, 'REVIEWER_NOT_INDEPENDENT', 'assigning yourself needs independence too');
  const reviewer = newAdmin();
  const asg = await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, d.appr.tok, { reviewerId: reviewer.id });
  assert.equal(asg.status, 200, JSON.stringify(asg.body));
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/appeal/reviewer`, d.appr.tok, { reviewerId: reviewer.id })).status, 409, 'assigned once');
  row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.deepEqual([row.status, row.investigatorId], ['ASSESSING', reviewer.id]);

  // the Gym may add an explanation during the appeal, but nothing else
  assert.equal((await call('POST', `/owner/complaint-cases/${d.caseId}/explanations`, token(d.ownerId, 'GYM_OWNER'), { text: 'Chi nhánh giải trình' })).status, 201);

  // review: a finding needs a NEW assessment of the reviewer; the finding references the old one
  const noAssess = await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, reviewer.tok, { finding: 'ESTABLISHED', reasoning: 'r' });
  assert.equal(noAssess.body.error.code, 'APPEAL_ASSESSMENT_REQUIRED');
  await assess({ caseId: d.caseId, inv: reviewer }, 'ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, reviewer.tok, { finding: 'ESTABLISHED', reasoning: 'có thêm biên lai' }), 201, 'finding');
  const newFinding = await prisma.gymCaseFinding.findFirstOrThrow({ where: { caseId: d.caseId }, orderBy: { createdAt: 'desc' } });
  assert.equal(newFinding.supersedesId, oldFinding.id, 'the new finding references the old one');
  assert.equal(newFinding.recordedBy, reviewer.id);
  const prop = ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, reviewer.tok, {}), 201, 'proposal');
  assert.equal(prop.outcome, 'REFUND_TRANSACTION_ERROR');
  // four eyes: the reviewer cannot approve; someone else must; still no money
  assert.equal((await approve({ ...d, appr: reviewer })).body.error.code, 'SELF_APPROVAL_FORBIDDEN');
  const approver2 = newAdmin();
  const dec = await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, approver2.tok, { result: 'APPROVED', reason: 'đồng ý kết luận kháng nghị', conflictOfInterestDeclaredNone: true });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
  row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.deepEqual([row.status, row.execStatus, row.execDecisionId], ['DECISION_APPROVED', 'NOT_STARTED', null]);
  assert.equal(pay.releases.length, 0, 'an approved appeal decision does NOT refund by itself');
  assert.equal((await prisma.gymCaseAppeal.findUniqueOrThrow({ where: { caseId: d.caseId } })).status, 'DECIDED');
  assert.equal((await call('POST', `/admin/gym-memberships/${d.membershipId}/refund`, newAdmin().tok, { reason: 'GYM_CLOSED' })).body.error.code, 'GYM_CASE_DECISION_EXISTS');

  // the explicit execute: exactly one refund through the existing path
  const ex = await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(pay.releases.length, 1);
  assert.equal(pay.releases[0].id, d.membershipId);
  assert.equal(ex.body.data.money.state, 'LEDGER_POSTED_FULL');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, approver2.tok, {})).body.data.replayed, true);
  assert.equal(pay.releases.length, 1);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/appeal`, d.reporter.tok, { reason: 'lần ba' })).body.error.code, 'APPEAL_ALREADY_USED', 'never twice');
  assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).status, 'RESOLVED');
});

test('A1 appeal window: 14 days from the DELIVERED conclusion notice; an undelivered notice never starts it; only a concluded case can be appealed; an appeal cannot reverse a refund that already happened', { skip }, async () => {
  // late: the delivered notice is 15 days old
  const late = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  await approve(late);
  await complaintCaseExecutionService.executeDecision(act(late), late.caseId);
  await backdateNotices(late.caseId, 'CONCLUSION', 15 * DAY);
  const v = ok(await call('GET', `/me/complaint-cases/${late.caseId}`, late.reporter.tok), 200, 'view');
  assert.equal(v.appeal.canFile, false);
  const closed = await call('POST', `/me/complaint-cases/${late.caseId}/appeal`, late.reporter.tok, { reason: 'muộn' });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error.code, 'APPEAL_WINDOW_CLOSED');
  assert.ok(closed.body.error.details.closedAt);
  // inside: 13 days
  const ok13 = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  await approve(ok13);
  await complaintCaseExecutionService.executeDecision(act(ok13), ok13.caseId);
  await backdateNotices(ok13.caseId, 'CONCLUSION', 13 * DAY);
  assert.equal((await call('POST', `/me/complaint-cases/${ok13.caseId}/appeal`, ok13.reporter.tok, { reason: 'còn hạn' })).status, 201);
  // undelivered conclusion notice: the window has not started, so an old case can still be appealed
  const nd = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  await approve(nd);
  notify.delivers = false;
  await complaintCaseExecutionService.executeDecision(act(nd), nd.caseId);
  notify.delivers = true;
  assert.equal((await prisma.gymCaseNotice.findFirstOrThrow({ where: { caseId: nd.caseId, kind: 'CONCLUSION' } })).delivered, false);
  const nv = ok(await call('GET', `/me/complaint-cases/${nd.caseId}`, nd.reporter.tok), 200, 'view');
  assert.deepEqual([nv.appeal.canFile, nv.appeal.closesAt], [true, null]);
  assert.equal((await call('POST', `/me/complaint-cases/${nd.caseId}/appeal`, nd.reporter.tok, { reason: 'chưa nhận được thông báo' })).status, 201);
  // not concluded: no appeal
  const open = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  assert.equal((await call('POST', `/me/complaint-cases/${open.caseId}/appeal`, open.reporter.tok, { reason: 'sớm' })).body.error.code, 'APPEAL_NOT_AVAILABLE');
  await approve(open);
  assert.equal((await call('POST', `/me/complaint-cases/${open.caseId}/appeal`, open.reporter.tok, { reason: 'chưa thực thi' })).body.error.code, 'APPEAL_NOT_AVAILABLE');

  // a refund that already happened is never reversed by an appeal: the membership is CANCELLED, so a "refund" appeal outcome cannot even be proposed twice
  const rf = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(rf);
  await complaintCaseExecutionService.executeDecision(act(rf), rf.caseId);
  assert.equal(pay.releases.length, 1);
  assert.equal((await call('POST', `/me/complaint-cases/${rf.caseId}/appeal`, rf.reporter.tok, { reason: 'muốn hoàn thêm' })).status, 201);
  const rev = newAdmin();
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/appeal/reviewer`, newAdmin().tok, { reviewerId: rev.id }), 200, 'assign reviewer');
  await assess({ caseId: rf.caseId, inv: rev }, 'ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/finding`, rev.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  const p = await call('POST', `/admin/complaint-cases/${rf.caseId}/proposal`, rev.tok, {});
  assert.equal(p.body.error.code, 'MEMBERSHIP_NOT_REFUNDABLE', 'no second refund');
  // ... and a reversal to "no refund" is only a recorded finding: no automatic clawback of what was paid
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/transition`, rev.tok, { to: 'ASSESSING' }), 200, 'back');
  await assess({ caseId: rf.caseId, inv: rev }, 'NOT_ESTABLISHED');
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/finding`, rev.tok, { finding: 'NOT_ESTABLISHED', reasoning: 'không đủ căn cứ' }), 201, 'finding 2');
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/recollect`, rev.tok, {}), 200, 'recollect (the membership is CANCELLED now)');
  ok(await call('POST', `/admin/complaint-cases/${rf.caseId}/proposal`, rev.tok, {}), 201, 'proposal 2');
  const approver3 = newAdmin();
  assert.equal((await call('POST', `/admin/complaint-cases/${rf.caseId}/decision`, approver3.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true })).status, 200);
  const ex = await complaintCaseExecutionService.executeDecision({ id: approver3.id, role: 'ADMIN' }, rf.caseId);
  assert.equal(ex.executionState, 'BUSINESS_DONE');
  assert.equal(ex.money.state, 'NO_MONEY_EFFECT');
  assert.equal(pay.releases.length, 1, 'nothing was reversed or re-paid');
});

// ───────────────────────────── C7: REJECTED_INTAKE hand-back ─────────────────────────────

test('C7: the REJECTED_INTAKE hand-back cannot bypass the case, the refund guard or conflict of interest', { skip }, async () => {
  const { gym, ownerId, partner } = await makeGym();
  const m = await makeMembership(gym.id, 'member-c7');
  const c1 = await makeComplaint(gym.id, 'member-c7');
  const c2 = await makeComplaint(gym.id, 'member-c7');
  const admin = newAdmin();

  // (1) a COI admin (partner staff / owner) cannot dismiss a case at intake - and so cannot hand the complaint back to the legacy flow
  const staff = newAdmin();
  await prisma.gymPartnerAccount.create({ data: { partnerId: partner.id, userId: staff.id, role: 'MANAGER', scopedGymIds: [gym.id], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() } });
  const k1 = ok(await call('POST', `/admin/complaints/${c1.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: m.id }), 201, 'open').id as string;
  for (const linked of [staff, { tok: token(ownerId, 'ADMIN') }]) {
    const r = await call('POST', `/admin/complaint-cases/${k1}/transition`, linked.tok, { to: 'REJECTED_INTAKE', reason: 'bỏ qua' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'CONFLICT_OF_INTEREST');
  }
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: k1 } })).status, 'INTAKE');
  // (2) only INTAKE can be dismissed: a case that already moved cannot be handed back after the fact
  ok(await call('POST', `/admin/complaint-cases/${k1}/assign`, admin.tok, {}), 200, 'assign');
  const late = await call('POST', `/admin/complaint-cases/${k1}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'đã muộn' });
  assert.equal(late.status, 409);
  assert.equal((await call('PATCH', `/admin/complaints/${c1.id}/status`, admin.tok, { status: 'RESOLVED', adminResponse: 'bypass' })).body.error.code, 'CASE_REQUIRED', 'a live case still owns the complaint');
  // (3) dismissed -> legacy flow OK for THIS complaint, but the membership is still protected by any other live case
  // k1 is live, so a second case on the same membership is refused by the one-open-case-per-membership rule
  assert.equal((await call('POST', `/admin/complaints/${c2.id}/case`, admin.tok, { caseClass: 'MEM_CLOSED', membershipId: m.id })).body.error.code, 'CASE_ALREADY_OPEN');
  const m2 = await makeMembership(gym.id, 'member-c7b');
  const c3 = await makeComplaint(gym.id, 'member-c7b');
  const c4 = await makeComplaint(gym.id, 'member-c7b');
  const rejected = ok(await call('POST', `/admin/complaints/${c3.id}/case`, admin.tok, { caseClass: 'MEM_TXN', membershipId: m2.id }), 201, 'open c3').id as string;
  ok(await call('POST', `/admin/complaint-cases/${rejected}/transition`, admin.tok, { to: 'REJECTED_INTAKE', reason: 'ngoài phạm vi' }), 200, 'reject c3');
  ok(await call('POST', `/admin/complaints/${c4.id}/case`, admin.tok, { caseClass: 'MEM_VIOLATION', membershipId: m2.id }), 201, 'open c4 on the same membership');
  const legacy = await call('PATCH', `/admin/complaints/${c3.id}/status`, admin.tok, { status: 'RESOLVED', adminResponse: 'Từ chối tiếp nhận' });
  assert.equal(legacy.status, 200, 'the dismissed complaint goes back to the legacy flow');
  assert.equal(pay.releases.length, 0, 'the legacy flow moves no money');
  const direct = await call('POST', `/admin/gym-memberships/${m2.id}/refund`, admin.tok, { reason: 'GYM_CLOSED' });
  assert.equal(direct.status, 409, 'the other live case still guards the membership');
  assert.equal(direct.body.error.code, 'GYM_CASE_OPEN');
  assert.equal(pay.releases.length, 0);
  // (4) a dismissed case can never be driven to a decision or an execution
  for (const [p, b] of [['finding', { finding: 'ESTABLISHED', reasoning: 'x' }], ['proposal', {}], ['decision', { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true }], ['execute', {}], ['appeal/reviewer', {}]] as Array<[string, unknown]>) {
    const r = await call('POST', `/admin/complaint-cases/${rejected}/${p}`, admin.tok, b);
    assert.ok([403, 409].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.equal((await call('POST', `/me/complaint-cases/${rejected}/appeal`, token('member-c7b', 'CUSTOMER'), { reason: 'x' })).body.error.code, 'APPEAL_NOT_AVAILABLE', 'a dismissed case is not an appealable conclusion');
  assert.equal(await prisma.gymCaseProposal.count({ where: { caseId: rejected } }), 0);
  assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: rejected } }), 0);
});

// ───────────────────────────── C9: honest labels ─────────────────────────────

test('C9: photo evidence keeps its stored-record hash but is labelled RECORD_HASH_ONLY, a party document DECLARED_NOT_VERIFIED - "SERVER_VERIFIED" appears nowhere an admin, the member or the Gym can read', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED', photoTokens: ['photo-token-1', 'photo-token-2'] });
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'REJECTED', reason: 'cần thêm', conflictOfInterestDeclaredNone: true })).status, 200);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/evidence`, d.reporter.tok, { description: 'Biên lai', sha256: 'a'.repeat(64) })).status, 201);
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'admin');
  const photos = admin.evidence.filter((e: any) => e.source === 'COMPLAINT_PHOTO');
  assert.equal(photos.length, 2);
  for (const p of photos) {
    assert.equal(p.verificationStatus, 'RECORD_HASH_ONLY');
    assert.match(p.verificationLabel, /chưa kiểm chứng nội dung tệp/);
    assert.equal(p.payload.hashCovers, 'TOKEN_RECORD_NOT_FILE_BYTES');
    assert.match(p.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(p.provenanceType, 'USER_REPORTED_STORED');
  }
  assert.equal(admin.evidence.find((e: any) => e.source === 'PARTY_DOCUMENT').verificationStatus, 'DECLARED_NOT_VERIFIED');
  for (const s of ['COMPLAINT_RECORD', 'GYM_RECORD', 'MEMBERSHIP_RECORD', 'CHECKIN_SUMMARY']) assert.equal(admin.evidence.find((e: any) => e.source === s).verificationStatus, 'SERVER_OBSERVED');
  assert.doesNotMatch(JSON.stringify(admin), /SERVER_VERIFIED/);
  const member = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member');
  assert.doesNotMatch(JSON.stringify(member), /SERVER_VERIFIED/);
  const gym = ok(await call('GET', `/owner/complaint-cases/${d.caseId}`, token(d.ownerId, 'GYM_OWNER')), 200, 'gym');
  assert.doesNotMatch(JSON.stringify(gym), /SERVER_VERIFIED/);
  // the stored hash itself did not change with the label (it is a computed field, not part of the record)
  const stored = await prisma.gymCaseEvidence.findFirstOrThrow({ where: { caseId: d.caseId, source: 'COMPLAINT_PHOTO', subject: 'photo-token-1' } });
  assert.equal(stored.contentHash, photos.find((p: any) => p.subject === 'photo-token-1').contentHash);
  void complaintCaseService; void randomUUID;
});
