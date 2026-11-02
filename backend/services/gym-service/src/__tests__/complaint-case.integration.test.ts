/**
 * Gym complaint CASE layer (Dispute V2.1 Slice 3) - BACKEND INTEGRATION on the isolated gym *_test database, over the REAL HTTP app + REAL service code.
 * TEST FIXTURE: gym / membership rows, the auth-service token table, captured notifications, and the MONEY EXIT SEAM of the executor (`ExecDeps.refund`),
 * which these tests replace with a recording stub so no payment-service is needed. The real refundByAdmin -> real payment-service ledger path is covered
 * by complaint-case-money.e2e.test.ts (opt-in). Nothing here asserts a real ledger movement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { complaintCaseExecutionService, type ExecDeps } from '../services/complaint-case/execution.service';
import {
  approve,
  authDirectory,
  call,
  cleanup,
  driveToProposal,
  installStubs,
  makeComplaint,
  makeGym,
  makeMembership,
  newAdmin,
  notices,
  ok,
  removeStubs,
  setFlag,
  skip,
  startApp,
  stopApp,
  token,
} from './complaint-case.test-helpers';

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
});
test.after(async () => {
  setFlag(undefined);
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.beforeEach(async () => {
  if (skip) return;
  setFlag(true);
  authDirectory.unreachable = false;
});
test.afterEach(async () => {
  if (skip) return;
  await cleanup();
});

/** A recording stand-in for the money exit. `release.refundedToClient` defaults to the quote; override per test. */
function stubDeps(o: { refundedToClient?: string; shortfall?: string; clawback?: { recovered: string; shortfall: string } | null; failWith?: any; cancel?: boolean; delayMs?: number } = {}) {
  const calls: Array<{ membershipId: string; actorId: string; reason: string }> = [];
  const deps: ExecDeps = {
    refund: async (membershipId, actorId, reason) => {
      calls.push({ membershipId, actorId, reason });
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.failWith) throw o.failWith;
      if (o.cancel) await prisma.gymMembershipContract.update({ where: { id: membershipId }, data: { status: 'CANCELLED' } });
      return { refundAmount: 150000, clawback: o.clawback ?? null, release: { refundedToClient: o.refundedToClient ?? '150000.00', shortfall: o.shortfall ?? '0.00' } };
    },
    replayRelease: async () => ({ refundedToClient: o.refundedToClient ?? '150000.00', shortfall: '0.00' }),
  };
  return { deps, calls };
}
const neverRefund = () => {
  const s = stubDeps({ failWith: new Error('MONEY EXIT MUST NOT BE CALLED') });
  return s;
};

// ───────────────────────────── flag, F7, authz ─────────────────────────────

test('flag OFF (unset / "TRUE" / "1" / not test env): every write of the new layer is refused 409 GYM_CASE_DISABLED, reads still answer, the old routes are untouched', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const complaint = await makeComplaint(gym.id, `member-${randomUUID().slice(0, 6)}`);
  const writes: Array<[string, string, unknown]> = [
    ['POST', `/admin/complaints/${complaint.id}/case`, { caseClass: 'GYM_GENERAL' }],
    ['POST', `/admin/complaint-cases/${randomUUID()}/assign`, {}],
    ['POST', `/admin/complaint-cases/${randomUUID()}/claims`, { claimantRole: 'MEMBER', text: 'x' }],
    ['POST', `/admin/complaint-cases/${randomUUID()}/proposal`, {}],
    ['POST', `/admin/complaint-cases/${randomUUID()}/decision`, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true }],
    ['POST', `/admin/complaint-cases/${randomUUID()}/execute`, {}],
    ['POST', `/admin/complaint-cases/${randomUUID()}/reconcile-execution`, {}],
  ];
  for (const flag of [undefined, 'false', 'TRUE', '1', 'true ']) {
    setFlag(flag);
    for (const [m, p, b] of writes) {
      const r = await call(m, p, admin.tok, b);
      assert.equal(r.status, 409, `${flag}: ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error.code, 'GYM_CASE_DISABLED');
    }
  }
  // "true" outside NODE_ENV=test is ignored too
  process.env.GYM_COMPLAINT_CASE_ENABLED = 'true';
  process.env.NODE_ENV = 'production';
  assert.equal((await call('POST', `/admin/complaints/${complaint.id}/case`, admin.tok, { caseClass: 'GYM_GENERAL' })).body.error.code, 'GYM_CASE_DISABLED');
  process.env.NODE_ENV = 'test';
  setFlag(undefined);
  assert.equal((await call('GET', '/admin/complaint-cases', admin.tok)).status, 200, 'reads stay available');
  assert.equal(await prisma.gymComplaintCase.count(), 0, 'nothing was written');
  // the OLD flow does not look at the flag
  const patched = await call('PATCH', `/admin/complaints/${complaint.id}/status`, admin.tok, { status: 'RESOLVED', adminResponse: 'Đã xử lý theo luồng cũ' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.status, 'RESOLVED');
});

test('F7: invalid status / source / issueType answer 400 (never 500); assignedAdminId must be a real active ADMIN; unreachable auth fails closed 503', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const complaint = await makeComplaint(gym.id, `member-${randomUUID().slice(0, 6)}`);
  const base = { gymId: gym.id, description: 'Mô tả', source: 'SELF_DETECTED', issueType: 'CLEANLINESS' };
  assert.equal((await call('POST', '/admin/complaints', admin.tok, { ...base, source: 'NOPE' })).status, 400);
  assert.equal((await call('POST', '/admin/complaints', admin.tok, { ...base, issueType: 'NOPE' })).status, 400);
  assert.equal((await call('PATCH', `/admin/complaints/${complaint.id}/status`, admin.tok, { status: 'DONE' })).status, 400);
  assert.equal((await call('PATCH', `/admin/complaints/${complaint.id}/status`, admin.tok, { status: 123 })).status, 400);
  assert.equal((await call('GET', '/admin/complaints?status=bogus', admin.tok)).status, 400);
  assert.equal((await call('GET', '/admin/complaints?status=OPEN', admin.tok)).status, 200);

  // assignedAdminId: unknown id, a customer, an inactive admin, auth down
  authDirectory.users.set('cust-1', { role: 'CUSTOMER', isActive: true });
  authDirectory.users.set('adm-off', { role: 'ADMIN', isActive: false });
  const target = `/admin/complaints/${complaint.id}/assigned-admin`;
  assert.equal((await call('PATCH', target, admin.tok, { assignedAdminId: 'ghost' })).body.error.code, 'ADMIN_NOT_FOUND');
  assert.equal((await call('PATCH', target, admin.tok, { assignedAdminId: 'cust-1' })).body.error.code, 'NOT_AN_ADMIN');
  assert.equal((await call('PATCH', target, admin.tok, { assignedAdminId: 'adm-off' })).body.error.code, 'NOT_AN_ADMIN');
  assert.equal((await call('POST', '/admin/complaints', admin.tok, { ...base, assignedAdminId: 'cust-1' })).status, 400);
  authDirectory.unreachable = true;
  assert.equal((await call('PATCH', target, admin.tok, { assignedAdminId: 'adm-2' })).status, 503);
  authDirectory.unreachable = false;
  const real = newAdmin();
  const good = await call('PATCH', target, admin.tok, { assignedAdminId: real.id });
  assert.equal(good.status, 200);
  assert.equal(good.body.data.assignedAdminId, real.id);
  assert.equal((await call('PATCH', target, admin.tok, { assignedAdminId: null })).body.data.assignedAdminId, null);
  const created = await call('POST', '/admin/complaints', admin.tok, { ...base, assignedAdminId: real.id });
  assert.equal(created.status, 201);
});

test('authorisation and strict bodies: non-admin 403, anonymous 401, an outcome / amount / userId in a body is refused 400', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  assert.equal((await call('GET', '/admin/complaint-cases', d.reporter.tok)).status, 403);
  assert.equal((await call('GET', '/admin/complaint-cases', null)).status, 401);
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.reporter.tok, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true })).status, 403);
  for (const [path, body] of [
    [`/admin/complaint-cases/${d.caseId}/proposal`, { outcome: 'REFUND_GYM_CLOSED' }],
    [`/admin/complaint-cases/${d.caseId}/proposal`, { amount: 99 }],
    [`/admin/complaint-cases/${d.caseId}/decision`, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true, approvedBy: 'someone' }],
    [`/admin/complaint-cases/${d.caseId}/execute`, { amount: 1 }],
    [`/admin/complaint-cases/${d.caseId}/execute`, { reason: 'GYM_CLOSED' }],
    [`/admin/complaint-cases/${d.caseId}/assign`, { userId: 'x' }],
  ] as Array<[string, unknown]>) {
    const r = await call('POST', path, d.appr.tok, body);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)} -> ${r.status}`);
    assert.equal(r.body.error.code, 'INVALID_INPUT');
  }
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, d.appr.tok, {}, { 'idempotency-key': 'bad key!' })).status, 400);
  // a non-ADMIN service-level actor is refused too (not only the router)
  await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: d.reporter.id, role: 'CUSTOMER' }, d.caseId), (e: any) => e.status === 403);
});

// ───────────────────────────── the workflow, no money ─────────────────────────────

test('GYM_GENERAL not established: open -> investigate -> four eyes -> RESOLVED "chua du can cu", no money step is ever called, the old direct RESOLVED route is closed', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  assert.equal(d.proposal.outcome, 'RESOLVE_INSUFFICIENT_EVIDENCE');

  // the old route cannot resolve a complaint that has a case
  const direct = await call('PATCH', `/admin/complaints/${d.complaintId}/status`, d.appr.tok, { status: 'RESOLVED', adminResponse: 'bypass' });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, 'CASE_REQUIRED');
  assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).status, 'IN_PROGRESS');

  // four eyes: proposer, then a missing declaration, then the right admin
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.inv.tok, { result: 'APPROVED', reason: 'tự duyệt', conflictOfInterestDeclaredNone: true })).body.error.code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: false })).body.error.code, 'CONFLICT_OF_INTEREST');
  assert.equal((await approve(d)).status, 200);

  const { deps, calls } = neverRefund();
  const exec = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
  assert.equal(exec.executionState, 'BUSINESS_DONE');
  assert.equal(exec.money.group, 'F2');
  assert.equal(exec.closure, 'CLOSED');
  assert.equal(calls.length, 0, 'no money exit for a not-established case');
  const complaint = await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } });
  assert.equal(complaint.status, 'RESOLVED');
  assert.match(complaint.adminResponse ?? '', /chưa đủ căn cứ/);
  assert.match(complaint.adminResponse ?? '', /Không có khoản tiền nào được hoàn/);
  assert.equal(complaint.resolvedBy, d.appr.id);

  // second execute is a replay, nothing runs again
  const again = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
  assert.equal(again.replayed, true);
  assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: d.caseId, state: 'BUSINESS_DONE' } }), 1);
});

test('MEM_ACCESS / GYM_GENERAL established: RESOLVE_UPHELD, no money exit; MEM_ACCESS is accepted without a refund', { skip }, async () => {
  for (const caseClass of ['MEM_ACCESS', 'GYM_GENERAL']) {
    const d = await driveToProposal({ caseClass, finding: 'ESTABLISHED', membership: caseClass === 'MEM_ACCESS' ? {} : false });
    assert.equal(d.proposal.outcome, 'RESOLVE_UPHELD');
    assert.equal((await approve(d)).status, 200);
    const { deps, calls } = neverRefund();
    const exec = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
    assert.equal(exec.money.state, 'NO_MONEY_EFFECT');
    assert.equal(calls.length, 0);
    assert.equal((await prisma.gymMembershipContract.findFirst({ where: { clientId: d.reporter.id } }))?.status ?? 'ACTIVE', 'ACTIVE', 'membership untouched');
  }
});

test('opening rules: money classes need a membership of THIS reporter and THIS gym; GYM_GENERAL takes none; one case per complaint; one open case per membership; the reporter is required', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const other = await makeGym();
  const reporter = `member-${randomUUID().slice(0, 6)}`;
  const complaint = await makeComplaint(gym.id, reporter);
  const open = (id: string, b: unknown) => call('POST', `/admin/complaints/${id}/case`, admin.tok, b);
  assert.equal((await open(complaint.id, { caseClass: 'MEM_TXN' })).body.error.code, 'MEMBERSHIP_REQUIRED');
  assert.equal((await open(complaint.id, { caseClass: 'NOPE' })).status, 400);
  const mine = await makeMembership(gym.id, reporter);
  assert.equal((await open(complaint.id, { caseClass: 'GYM_GENERAL', membershipId: mine.id })).body.error.code, 'MEMBERSHIP_NOT_ALLOWED');
  const someoneElses = await makeMembership(gym.id, 'member-other');
  assert.equal((await open(complaint.id, { caseClass: 'MEM_TXN', membershipId: someoneElses.id })).body.error.code, 'MEMBERSHIP_MISMATCH');
  const otherBranch = await makeMembership(other.gym.id, reporter);
  assert.equal((await open(complaint.id, { caseClass: 'MEM_TXN', membershipId: otherBranch.id })).body.error.code, 'MEMBERSHIP_MISMATCH');
  assert.equal((await open(complaint.id, { caseClass: 'MEM_TXN', membershipId: 'nope' })).body.error.code, 'MEMBERSHIP_NOT_FOUND');

  const first = await open(complaint.id, { caseClass: 'MEM_TXN', membershipId: mine.id });
  assert.equal(first.status, 201);
  const second = await open(complaint.id, { caseClass: 'MEM_TXN', membershipId: mine.id });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.existing, true);
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(await prisma.gymComplaintCase.count(), 1);
  assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: complaint.id } })).status, 'IN_PROGRESS');

  const second2 = await makeComplaint(gym.id, reporter);
  assert.equal((await open(second2.id, { caseClass: 'MEM_CLOSED', membershipId: mine.id })).body.error.code, 'CASE_ALREADY_OPEN');
  const anon = await makeComplaint(gym.id, null, { source: 'SELF_DETECTED' });
  assert.equal((await open(anon.id, { caseClass: 'GYM_GENERAL' })).body.error.code, 'REPORTER_REQUIRED');
});

test('conflict of interest: an admin who is the reporter or the gym owner cannot open, investigate, approve or execute', { skip }, async () => {
  const { gym, ownerId } = await makeGym();
  // the reporter AND the owner are also admins (the worst case)
  const ownerAdmin = { id: ownerId, tok: token(ownerId, 'ADMIN') };
  const reporterAdmin = { id: 'reporter-admin', tok: token('reporter-admin', 'ADMIN') };
  const complaint = await makeComplaint(gym.id, reporterAdmin.id);
  const normal = newAdmin();
  assert.equal((await call('POST', `/admin/complaints/${complaint.id}/case`, ownerAdmin.tok, { caseClass: 'GYM_GENERAL' })).body.error.code, 'CONFLICT_OF_INTEREST');
  assert.equal((await call('POST', `/admin/complaints/${complaint.id}/case`, reporterAdmin.tok, { caseClass: 'GYM_GENERAL' })).body.error.code, 'CONFLICT_OF_INTEREST');
  const opened = ok(await call('POST', `/admin/complaints/${complaint.id}/case`, normal.tok, { caseClass: 'GYM_GENERAL' }), 201, 'open');
  assert.equal((await call('POST', `/admin/complaint-cases/${opened.id}/assign`, normal.tok, { investigatorId: ownerAdmin.id })).body.error.code, 'CONFLICT_OF_INTEREST');
  assert.equal((await call('POST', `/admin/complaint-cases/${opened.id}/assign`, normal.tok, { investigatorId: reporterAdmin.id })).body.error.code, 'CONFLICT_OF_INTEREST');
  assert.equal((await call('POST', `/admin/complaint-cases/${opened.id}/assign`, normal.tok, { investigatorId: 'nobody' })).body.error.code, 'ADMIN_NOT_FOUND');
});

test('append-only tables, GYM party lock, DB-level four eyes and the one-approval-per-proposal index', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  assert.equal((await approve(d)).status, 200);
  for (const table of ['gym_case_events', 'gym_case_evidence', 'gym_case_approvals', 'gym_case_proposals', 'gym_case_findings', 'gym_case_claims', 'gym_case_assessments', 'gym_case_access_logs']) {
    await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE ${table} SET created_at = now()`), /append-only/, `${table} UPDATE`);
    await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM ${table}`), /append-only/, `${table} DELETE`);
  }
  // the Gym party cannot be written, by any path
  await assert.rejects(
    () => prisma.gymCaseStatement.create({ data: { caseId: d.caseId, partyRole: 'GYM', authorUserId: d.ownerId, version: 1, text: 'giải trình', contentHash: 'h' } }),
    /gym_party_locked|violates check/,
  );
  await assert.rejects(() => prisma.gymCaseClaim.create({ data: { caseId: d.caseId, claimantRole: 'GYM', text: 'x', createdBy: d.ownerId } }), /gym_party_locked|violates check/);
  // four eyes at the database: the proposer cannot be recorded as an approver even with a hand-written insert
  const proposal = await prisma.gymCaseProposal.findFirstOrThrow({ where: { caseId: d.caseId } });
  await assert.rejects(
    () => prisma.gymCaseApproval.create({ data: { proposalId: proposal.id, approverId: d.inv.id, result: 'REJECTED', reason: 'x', conflictOfInterestDeclaredNone: true } }),
    /four-eyes/,
  );
  // a second APPROVED row for the same proposal is refused by the partial unique index
  await assert.rejects(
    () => prisma.gymCaseApproval.create({ data: { proposalId: proposal.id, approverId: 'another-admin', result: 'APPROVED', reason: 'x', conflictOfInterestDeclaredNone: true } }),
    /Unique constraint|one_approved/,
  );
  await assert.rejects(
    () => prisma.$executeRawUnsafe(`INSERT INTO gym_case_approvals (id, proposal_id, approver_id, result, reason, conflict_of_interest_declared_none) VALUES (gen_random_uuid(), '${proposal.id}', 'z', 'REJECTED', 'x', false)`),
    /declaration_true|violates check/,
  );
});

// ───────────────────────────── evidence ─────────────────────────────

test('evidence: system rows are hashed, a party document is a DECLARED hash (not verified), duplicates refused; member sees only own/shared; Gym owner sees nothing; admin-on-behalf is flagged', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_VIOLATION', finding: 'ESTABLISHED' });
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  const sources = detail.evidence.map((e: any) => e.source).sort();
  assert.deepEqual(sources, ['CHECKIN_SUMMARY', 'COMPLAINT_RECORD', 'GYM_RECORD', 'MEMBERSHIP_RECORD']);
  for (const e of detail.evidence) assert.match(e.contentHash, /^[0-9a-f]{64}$/);
  assert.ok(detail.evidence.every((e: any) => e.scopeGymId === d.gymId));

  // the case is AWAITING_APPROVAL: send it back to investigate (rejection) so the member can add things
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'REJECTED', reason: 'cần thêm bằng chứng', conflictOfInterestDeclaredNone: true })).status, 200);
  const sha = 'a'.repeat(64);
  const doc = await call('POST', `/me/complaint-cases/${d.caseId}/evidence`, d.reporter.tok, { description: 'Biên lai', sha256: sha, fileName: 'bienlai.pdf' });
  assert.equal(doc.status, 201);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/evidence`, d.reporter.tok, { description: 'lần hai', sha256: sha })).body.error.code, 'EVIDENCE_DUPLICATE');
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/evidence`, d.reporter.tok, { description: 'x', sha256: 'zz' })).status, 400);
  const st = await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'Tôi bị tính tiền sai' });
  assert.equal(st.status, 201);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'bổ sung' })).body.error.code, 'SUPPLEMENT_REASON_REQUIRED');
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'bổ sung', supplementReason: 'nhớ thêm' })).body.data.version, 2);

  const obo = await call('POST', `/admin/complaint-cases/${d.caseId}/evidence`, d.inv.tok, { description: 'Biên bản gym nhận qua điện thoại', sha256: 'b'.repeat(64) });
  assert.equal(obo.status, 201);
  const after = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail2');
  const mine = after.evidence.find((e: any) => e.id === doc.body.data.id);
  assert.equal(mine.provenanceType, 'EXTERNAL_DOCUMENT');
  assert.equal(mine.payload.verification, 'DECLARED_NOT_VERIFIED');
  assert.equal(after.evidence.find((e: any) => e.id === obo.body.data.id).provenanceType, 'ADMIN_RECEIVED_ON_BEHALF');

  // member view: own documents + own-data sources, not the gym record, not the admin's document, no internal status name
  const mv = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member view');
  const memberSources = mv.evidence.map((e: any) => `${e.source}`).sort();
  assert.deepEqual(memberSources, ['COMPLAINT_RECORD', 'MEMBERSHIP_RECORD', 'PARTY_DOCUMENT']);
  assert.ok(!mv.evidence.some((e: any) => e.id === obo.body.data.id));
  assert.ok(!JSON.stringify(mv).includes('AWAITING_APPROVAL') && !JSON.stringify(mv).includes('ASSESSING'));
  assert.equal(mv.case.canSubmit, true);
  // share the admin document -> the member now sees it
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/shares`, d.inv.tok, { evidenceId: obo.body.data.id, reason: 'để bạn phản biện' })).status, 201);
  const mv2 = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member view 2');
  assert.ok(mv2.evidence.some((e: any) => e.id === obo.body.data.id));

  // someone else, and the Gym's own owner (any role), see nothing: 404 for a case they did not file
  const stranger = token('stranger', 'CUSTOMER');
  assert.equal((await call('GET', `/me/complaint-cases/${d.caseId}`, stranger)).status, 404);
  assert.equal((await call('POST', `/me/complaint-cases/${d.caseId}/statements`, stranger, { text: 'x' })).status, 404);
  const ownerTok = token(d.ownerId, 'CUSTOMER');
  assert.equal((await call('GET', `/me/complaint-cases/${d.caseId}`, ownerTok)).status, 404);
  assert.equal((await call('GET', `/admin/complaint-cases/${d.caseId}`, token(d.ownerId, 'GYM_OWNER'))).status, 403);
  assert.deepEqual((await call('GET', '/me/complaint-cases', stranger)).body.data.items, []);

  // every read was logged
  assert.ok((await prisma.gymCaseAccessLog.count({ where: { caseId: d.caseId, viewerUserId: d.reporter.id } })) > 0);
  assert.ok((await prisma.gymCaseAccessLog.count({ where: { caseId: d.caseId, viewerUserId: 'stranger' } })) === 0);
});

test('evidence-change guard at approval: new evidence needs the investigator acknowledgement AFTER it plus the approver tick; live data that drifted needs a recollect', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  // a member document arrives after the proposal was made
  await prisma.gymCaseEvidence.create({
    data: { caseId: d.caseId, provenanceType: 'EXTERNAL_DOCUMENT', source: 'PARTY_DOCUMENT', subject: 'c'.repeat(64), scopeGymId: d.gymId, submittedBy: d.reporter.id, submittedRole: 'MEMBER', contentHash: 'c'.repeat(64), payload: { description: 'muộn' } },
  });
  const blocked = await approve(d);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'EVIDENCE_CHANGED');
  assert.equal((await approve(d, { evidenceChangeAcknowledged: true })).body.error.code, 'EVIDENCE_CHANGED', 'tick without the investigator acknowledgement is not enough');
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/ack-evidence-change`, d.inv.tok, { note: 'đã đọc bằng chứng muộn' })).status, 200);
  assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/ack-evidence-change`, d.appr.tok, { note: 'x' })).status, 403, 'only the investigator acknowledges');
  assert.equal((await approve(d, { evidenceChangeAcknowledged: false })).body.error.code, 'EVIDENCE_CHANGED', 'acknowledgement without the approver tick is not enough');
  assert.equal((await approve(d, { evidenceChangeAcknowledged: true })).status, 200);

  // live drift: the membership row changed after the proposal -> stale, never acceptable until recollected
  const d2 = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await prisma.gymMembershipContract.update({ where: { id: d2.membershipId! }, data: { usedVisits: 7 } });
  const stale = await approve(d2, { evidenceChangeAcknowledged: true });
  assert.equal(stale.body.error.code, 'EVIDENCE_CHANGED');
  assert.ok(stale.body.error.details.needsRecollect);
  assert.equal((await call('POST', `/admin/complaint-cases/${d2.caseId}/recollect`, d2.inv.tok, {})).body.data.changed.length > 0, true);
  // recollect re-opened nothing by itself: the new rows still need the acknowledgement
  await call('POST', `/admin/complaint-cases/${d2.caseId}/ack-evidence-change`, d2.inv.tok, { note: 'đã thu thập lại' });
  assert.equal((await approve(d2, { evidenceChangeAcknowledged: true })).status, 200);
});

// ───────────────────────────── money exit (seam) ─────────────────────────────

test('money exit: each refund outcome calls refundByAdmin ONCE with the matching reason and the VERIFIED approver; a second execute replays, never refunds again', { skip }, async () => {
  const table: Array<[string, string]> = [
    ['MEM_TXN', 'TRANSACTION_ERROR'],
    ['MEM_CLOSED', 'GYM_CLOSED'],
    ['MEM_VIOLATION', 'GYM_VIOLATION_SUSPENDED'],
  ];
  for (const [caseClass, reason] of table) {
    const d = await driveToProposal({ caseClass, finding: 'ESTABLISHED' });
    assert.ok(String(d.proposal.outcome).startsWith('REFUND_'));
    assert.equal((await approve(d)).status, 200);
    // approval alone moves nothing
    assert.equal((await prisma.gymCaseExecution.count({ where: { caseId: d.caseId } })), 0);
    const { deps, calls } = stubDeps();
    const exec = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { membershipId: d.membershipId, actorId: d.appr.id, reason });
    assert.equal(exec.money.state, 'LEDGER_POSTED_FULL');
    assert.equal(exec.money.group, 'F1');
    assert.match(exec.money.label, /ví Gymini/);
    const replay = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
    assert.equal(replay.replayed, true);
    assert.equal(calls.length, 1, 'no second refund');
    // an admin-supplied reason / amount cannot reach the exit: the HTTP execute route accepts only an optional decisionId
    assert.equal((await call('POST', `/admin/complaint-cases/${d.caseId}/execute`, d.appr.tok, { reason: 'TRANSACTION_ERROR' })).status, 400);
  }
});

test('shortfall > 0 and a clawback that was not recovered are REFLECTED, never shown as paid; the case closes as CLOSED_FINANCIAL_OPEN; the member is told only what payment confirmed', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(d);
  const { deps } = stubDeps({ refundedToClient: '100000.00', shortfall: '50000.00' });
  const exec = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
  assert.equal(exec.money.state, 'LEDGER_POSTED_PARTIAL');
  assert.equal(exec.money.group, 'F3');
  assert.equal(exec.closure, 'CLOSED_FINANCIAL_OPEN');
  const text = (await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d.complaintId } })).adminResponse!;
  assert.match(text, /còn lại 50000\.00/);
  assert.match(text, /chưa trả/);
  assert.ok(!/đã hoàn đủ/.test(text));
  const admin = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'detail');
  assert.equal(admin.financial.state, 'LEDGER_POSTED_PARTIAL');
  assert.equal(admin.closure, 'CLOSED_FINANCIAL_OPEN');
  const mv = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'member');
  assert.equal(mv.money.stillOwed, '50000.00');
  assert.equal(mv.case.progress, 'Đã xử lý');
  assert.ok(!JSON.stringify(mv).match(/F3|LEDGER_POSTED|NEEDS_RECONCILIATION/));

  const d2 = await driveToProposal({ caseClass: 'MEM_VIOLATION', finding: 'ESTABLISHED' });
  await approve(d2);
  const claw = stubDeps({ clawback: { recovered: '1000.00', shortfall: '4000.00' } });
  const e2 = await complaintCaseExecutionService.executeDecision({ id: d2.appr.id, role: 'ADMIN' }, d2.caseId, {}, claw.deps);
  assert.equal(e2.money.group, 'F3');
  assert.equal(e2.money.referralClawbackShortfall, '4000.00');
  const mv2 = ok(await call('GET', `/me/complaint-cases/${d2.caseId}`, d2.reporter.tok), 200, 'member2');
  assert.match(mv2.money.label, /đã được ghi vào ví Gymini của bạn/, 'the member part IS confirmed by payment');
  assert.ok(!JSON.stringify(mv2).includes('4000'), 'the platform-side shortfall is not shown to the member');
});

test('refund refused / membership drifted -> nothing moves: live drift is caught by the evidence guard, a refusal by the exit is EXEC_BLOCKED, a retry after the cause is gone succeeds; a membership not refundable at proposal time blocks the proposal', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(d);
  // the membership is cancelled by the client between approval and execution: the live record no longer matches what was approved
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { status: 'CANCELLED' } });
  const { deps, calls } = stubDeps();
  await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps), (e: any) => e.status === 409 && e.code === 'EVIDENCE_CHANGED');
  assert.equal(calls.length, 0);
  let row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  assert.equal(row.execStatus, 'NOT_STARTED', 'a refusal before the start changes nothing');
  assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: d.caseId } }), 0);
  // the cause disappears -> the same decision can be executed
  await prisma.gymMembershipContract.update({ where: { id: d.membershipId! }, data: { status: 'ACTIVE' } });
  const exec = await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, deps);
  assert.equal(exec.executionState, 'BUSINESS_DONE');
  assert.equal(calls.length, 1);

  // refundByAdmin itself refuses with a 409 AFTER our pre-checks passed (it re-reads the membership): blocked, nothing moved, visible as F3
  const d2 = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await approve(d2);
  const refuse = stubDeps({ failWith: Object.assign(new Error('Membership has already expired'), { status: 409 }) });
  await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: d2.appr.id, role: 'ADMIN' }, d2.caseId, {}, refuse.deps), (e: any) => e.code === 'EXEC_BLOCKED');
  row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d2.caseId } });
  assert.equal(row.execStatus, 'EXEC_BLOCKED');
  assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: d2.complaintId } })).status, 'IN_PROGRESS', 'not resolved while blocked');
  const view = ok(await call('GET', `/admin/complaint-cases/${d2.caseId}`, d2.inv.tok), 200, 'detail');
  assert.equal(view.financial.state, 'REFUND_BLOCKED');
  assert.equal(view.financial.group, 'F3');
  assert.equal(view.closure, 'OPEN');
  const ok2 = stubDeps();
  const again = await complaintCaseExecutionService.executeDecision({ id: d2.appr.id, role: 'ADMIN' }, d2.caseId, {}, ok2.deps);
  assert.equal(again.executionState, 'BUSINESS_DONE');
  assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: d2.caseId, state: 'BLOCKED' } }), 1, 'the blocked attempt stays in the history');

  // a membership that is not refundable when the proposal is made: no proposal at all
  assert.equal(await driveToProposalExpectingRefusal(), 'MEMBERSHIP_NOT_REFUNDABLE');
});

async function driveToProposalExpectingRefusal() {
  const { gym } = await makeGym();
  const reporterId = `member-${randomUUID().slice(0, 6)}`;
  const m = await makeMembership(gym.id, reporterId, { status: 'EXPIRED' });
  const complaint = await makeComplaint(gym.id, reporterId);
  const inv = newAdmin();
  const opened = ok(await call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass: 'MEM_CLOSED', membershipId: m.id }), 201, 'open');
  await call('POST', `/admin/complaint-cases/${opened.id}/assign`, inv.tok, {});
  await call('POST', `/admin/complaint-cases/${opened.id}/transition`, inv.tok, { to: 'ASSESSING' });
  const claim = ok(await call('POST', `/admin/complaint-cases/${opened.id}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  await call('POST', `/admin/complaint-cases/${opened.id}/assessments`, inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' });
  await call('POST', `/admin/complaint-cases/${opened.id}/finding`, inv.tok, { finding: 'ESTABLISHED', reasoning: 'r' });
  const r = await call('POST', `/admin/complaint-cases/${opened.id}/proposal`, inv.tok, {});
  assert.equal(r.status, 409);
  return r.body.error.code as string;
}

test('crash safety: a crash after the money step leaves EXECUTING; a second execute is refused; reconcile finishes it (membership ACTIVE -> safe re-run; CANCELLED + replay shows the refund -> done; otherwise a person)', { skip }, async () => {
  // (a) crash BEFORE the money step is asked: membership still ACTIVE -> reconcile re-runs the exit
  const a = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(a);
  const sa = stubDeps();
  await assert.rejects(
    () => complaintCaseExecutionService.executeDecision({ id: a.appr.id, role: 'ADMIN' }, a.caseId, {}, { ...sa.deps, afterExecutingCas: async () => { throw new Error('CRASH 1'); } }),
    /CRASH 1/,
  );
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: a.caseId } })).execStatus, 'EXECUTING');
  assert.equal(sa.calls.length, 0);
  await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: a.appr.id, role: 'ADMIN' }, a.caseId, {}, sa.deps), (e: any) => e.code === 'EXECUTION_IN_PROGRESS');
  assert.equal(ok(await call('GET', `/admin/complaint-cases/${a.caseId}`, a.inv.tok), 200, 'd').financial.state, 'LEDGER_PENDING');
  const ra: any = await complaintCaseExecutionService.reconcileExecution({ id: a.appr.id, role: 'ADMIN' }, a.caseId, sa.deps);
  assert.equal(ra.action, 'RERAN_REFUND');
  assert.equal(sa.calls.length, 1);
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: a.caseId } })).execStatus, 'BUSINESS_DONE');

  // (b) crash AFTER the money step committed (membership already CANCELLED by the refund)
  const b = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });
  await approve(b);
  const sb = stubDeps({ cancel: true });
  await assert.rejects(
    () => complaintCaseExecutionService.executeDecision({ id: b.appr.id, role: 'ADMIN' }, b.caseId, {}, { ...sb.deps, afterRefund: async () => { throw new Error('CRASH 2'); } }),
    /CRASH 2/,
  );
  assert.equal(sb.calls.length, 1);
  const rb: any = await complaintCaseExecutionService.reconcileExecution({ id: b.appr.id, role: 'ADMIN' }, b.caseId, sb.deps);
  assert.equal(rb.action, 'BUSINESS_DONE');
  assert.equal(sb.calls.length, 1, 'the refund is NOT asked a second time');
  assert.equal(rb.money.state, 'LEDGER_POSTED_FULL');

  // (c) the membership was cancelled elsewhere with no refund: the replay shows 0 -> a person decides, nothing is retried
  const c = await driveToProposal({ caseClass: 'MEM_VIOLATION', finding: 'ESTABLISHED' });
  await approve(c);
  const sc = stubDeps({ cancel: true, refundedToClient: '0.00' });
  await assert.rejects(
    () => complaintCaseExecutionService.executeDecision({ id: c.appr.id, role: 'ADMIN' }, c.caseId, {}, { ...sc.deps, afterRefund: async () => { throw new Error('CRASH 3'); } }),
    /CRASH 3/,
  );
  const rc: any = await complaintCaseExecutionService.reconcileExecution({ id: c.appr.id, role: 'ADMIN' }, c.caseId, sc.deps);
  assert.equal(rc.action, 'NEEDS_HUMAN');
  assert.equal((await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: c.caseId } })).execStatus, 'NEEDS_HUMAN');
  assert.equal(ok(await call('GET', `/admin/complaint-cases/${c.caseId}`, c.inv.tok), 200, 'd').financial.state, 'NEEDS_RECONCILIATION');
  assert.equal((await prisma.gymComplaint.findUniqueOrThrow({ where: { id: c.complaintId } })).status, 'IN_PROGRESS');
  await assert.rejects(() => complaintCaseExecutionService.executeDecision({ id: c.appr.id, role: 'ADMIN' }, c.caseId, {}, sc.deps), (e: any) => e.code === 'NEEDS_HUMAN');

  // reconcile on a case that is not EXECUTING does nothing
  assert.equal(((await complaintCaseExecutionService.reconcileExecution({ id: a.appr.id, role: 'ADMIN' }, a.caseId, sa.deps)) as any).action, 'NOTHING_TO_RECONCILE');
});

test('concurrency: two simultaneous executes run the refund once; two simultaneous approvals record one APPROVED row; a stale-version write loses', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  const second = newAdmin();
  const [r1, r2] = await Promise.all([approve(d), call('POST', `/admin/complaint-cases/${d.caseId}/decision`, second.tok, { result: 'APPROVED', reason: 'cùng lúc', conflictOfInterestDeclaredNone: true })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await prisma.gymCaseApproval.count({ where: { result: 'APPROVED' } }), 1);

  const slow = stubDeps({ delayMs: 250 });
  const actor = { id: d.appr.id, role: 'ADMIN' };
  const results = await Promise.allSettled([
    complaintCaseExecutionService.executeDecision(actor, d.caseId, {}, slow.deps),
    complaintCaseExecutionService.executeDecision(actor, d.caseId, {}, slow.deps),
    complaintCaseExecutionService.executeDecision(actor, d.caseId, {}, slow.deps),
  ]);
  assert.equal(slow.calls.length, 1, 'exactly one money exit call');
  assert.equal(results.filter((r) => r.status === 'fulfilled').length >= 1, true);
  for (const r of results) if (r.status === 'rejected') assert.equal((r.reason as any).code, 'EXECUTION_IN_PROGRESS');
  assert.equal(await prisma.gymCaseExecution.count({ where: { caseId: d.caseId, state: 'BUSINESS_DONE' } }), 1);

  // CAS: an update that carries an old version changes nothing
  const row = await prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: d.caseId } });
  const lost = await prisma.gymComplaintCase.updateMany({ where: { id: d.caseId, version: row.version - 1 }, data: { escalated: true } });
  assert.equal(lost.count, 0);
});

test('Idempotency-Key: the same key + body replays (no second row); the same key with a different body is refused 409 IDEMPOTENCY_KEY_REUSED', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const complaint = await makeComplaint(gym.id, `member-${randomUUID().slice(0, 6)}`);
  const opened = ok(await call('POST', `/admin/complaints/${complaint.id}/case`, admin.tok, { caseClass: 'GYM_GENERAL' }, { 'idempotency-key': 'k-open-1' }), 201, 'open');
  await call('POST', `/admin/complaint-cases/${opened.id}/assign`, admin.tok, {});
  await call('POST', `/admin/complaint-cases/${opened.id}/transition`, admin.tok, { to: 'ASSESSING' });
  const k = { 'idempotency-key': 'k-claim-1' };
  const c1 = await call('POST', `/admin/complaint-cases/${opened.id}/claims`, admin.tok, { claimantRole: 'MEMBER', text: 'một' }, k);
  const c2 = await call('POST', `/admin/complaint-cases/${opened.id}/claims`, admin.tok, { claimantRole: 'MEMBER', text: 'một' }, k);
  assert.equal(c1.status, 201);
  assert.equal(c2.headers.get('idempotent-replay'), 'true');
  assert.equal(c2.body.data.id, c1.body.data.id);
  assert.equal(await prisma.gymCaseClaim.count({ where: { caseId: opened.id } }), 1);
  const c3 = await call('POST', `/admin/complaint-cases/${opened.id}/claims`, admin.tok, { claimantRole: 'MEMBER', text: 'khác' }, k);
  assert.equal(c3.status, 409);
  assert.equal(c3.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

// ───────────────────────────── reads for the UI ─────────────────────────────

test('allowedActions are computed on the server per caller: the proposer cannot approve, the other admin can, a party cannot, flag-off disables all', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  const find = (a: any[], n: string) => a.find((x) => x.action === n);
  const asInv = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'inv').allowedActions;
  assert.equal(find(asInv, 'APPROVE').allowed, false);
  assert.equal(find(asInv, 'APPROVE').reason, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal(find(asInv, 'EXECUTE').allowed, false);
  assert.equal(find(asInv, 'EXECUTE').reason, 'DECISION_NOT_APPROVED');
  assert.equal(find(asInv, 'PROPOSE').allowed, false);
  const asAppr = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.appr.tok), 200, 'appr').allowedActions;
  assert.equal(find(asAppr, 'APPROVE').allowed, true);
  assert.equal(find(asAppr, 'REJECT').allowed, true);
  assert.equal(find(asAppr, 'ADD_CLAIM').allowed, false);
  assert.equal(find(asAppr, 'ADD_CLAIM').reason, 'NOT_INVESTIGATOR');
  await approve(d);
  const afterApproval = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.appr.tok), 200, 'x').allowedActions;
  assert.equal(find(afterApproval, 'EXECUTE').allowed, true);
  assert.equal(find(afterApproval, 'APPROVE').allowed, false);
  const owner = token(d.ownerId, 'ADMIN');
  assert.equal(find(ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, owner), 200, 'o').allowedActions, 'EXECUTE').reason, 'CONFLICT_OF_INTEREST');
  setFlag(undefined);
  const off = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.appr.tok), 200, 'off').allowedActions;
  assert.ok(off.every((a: any) => a.allowed === false && a.reason === 'GYM_CASE_DISABLED'));
});

test('list, detail and history: filters by status, paginates, detail carries decision/execution/financial/closure, history is ordered and free of payloads', { skip }, async () => {
  const d1 = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });
  const d2 = await driveToProposal({ caseClass: 'MEM_ACCESS', finding: 'ESTABLISHED' });
  await approve(d2);
  const list = ok(await call('GET', '/admin/complaint-cases?limit=1', d1.inv.tok), 200, 'list');
  assert.equal(list.total, 2);
  assert.equal(list.items.length, 1);
  const filtered = ok(await call('GET', '/admin/complaint-cases?status=DECISION_APPROVED', d1.inv.tok), 200, 'filter');
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, d2.caseId);
  assert.equal((await call('GET', '/admin/complaint-cases?status=BOGUS', d1.inv.tok)).status, 400);
  assert.equal((await call('GET', `/admin/complaint-cases/not-a-uuid`, d1.inv.tok)).status, 404);
  const detail = ok(await call('GET', `/admin/complaint-cases/${d2.caseId}`, d1.inv.tok), 200, 'detail');
  assert.equal(detail.decision.outcome, 'RESOLVE_UPHELD');
  assert.equal(detail.execution.status, 'NOT_STARTED');
  assert.equal(detail.closure, 'OPEN');
  assert.equal(detail.financial.group, 'F2');
  assert.equal(detail.proposals[0].approvals[0].result, 'APPROVED');
  const hist = ok(await call('GET', `/admin/complaint-cases/${d2.caseId}/history`, d1.inv.tok), 200, 'history');
  const actions = hist.items.map((e: any) => e.action);
  assert.deepEqual(actions.slice(0, 2), ['CASE_OPENED', 'INVESTIGATOR_ASSIGNED']);
  assert.ok(actions.includes('PROPOSAL_CREATED') && actions.includes('DECISION_APPROVED'));
  assert.ok(hist.items.every((e: any) => e.payload === undefined));
});

test('notifications: no internal enum in any text, the opening notice never mentions money, a refund is claimed "da ghi vao vi" only after payment confirmed it', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].userId, d.reporter.id);
  assert.doesNotMatch(notices[0].text, /hoàn|ví|tiền/);
  await call('POST', `/admin/complaint-cases/${d.caseId}/decision`, d.appr.tok, { result: 'REJECTED', reason: 'cần thêm', conflictOfInterestDeclaredNone: true });
  const more = await call('POST', `/admin/complaint-cases/${d.caseId}/request-more`, d.inv.tok, { to: 'AWAITING_PARTIES', note: 'Vui lòng gửi biên lai' });
  assert.equal(more.status, 200);
  assert.ok(notices.some((n) => n.eventType === 'GYM_COMPLAINT_CASE_MORE_INFO'));
  // back to a decision
  await call('POST', `/admin/complaint-cases/${d.caseId}/transition`, d.inv.tok, { to: 'ASSESSING' });
  await call('POST', `/admin/complaint-cases/${d.caseId}/finding`, d.inv.tok, { finding: 'ESTABLISHED', reasoning: 'ok' });
  ok(await call('POST', `/admin/complaint-cases/${d.caseId}/proposal`, d.inv.tok, {}), 201, 'prop2');
  assert.equal((await approve(d, { evidenceChangeAcknowledged: true })).status, 200);
  const before = notices.length;
  await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, stubDeps({ refundedToClient: '120000.00' }).deps);
  const last = notices[notices.length - 1];
  assert.equal(notices.length, before + 1);
  assert.match(last.text, /120000\.00 đã được ghi vào ví Gymini/);
  for (const n of notices) assert.doesNotMatch(n.text, /\b[A-Z]{3,}(_[A-Z]+)+\b/, `internal enum in: ${n.text}`);
});
