/**
 * Contract rows G2, G3, G4 (admin reads), G20, G21 (member reads) and R-18 (H1 paging) - REAL HTTP into the real gym-service Express app (the same app.ts that
 * listens in production, behind the real extractUser/requireRoles middleware), isolated gym *_test database. BACKEND INTEGRATION.
 * TEST FIXTURE: gym / membership rows, the auth-service token table, and the money-exit SEAM of the executor (a recording stub, so a refund outcome can be
 * driven to BUSINESS_DONE and the member's `money` block exists). Response SHAPE (exact key sets) and ACCESS RIGHTS are asserted per route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../repositories/prisma';
import { complaintCaseExecutionService, type ExecDeps } from '../services/complaint-case/execution.service';
import { approve, call, cleanup, driveToProposal, installStubs, makeComplaint, makeGym, newAdmin, ok, removeStubs, setFlag, skip, startApp, stopApp, token } from './complaint-case.test-helpers';

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
test.beforeEach(() => {
  if (!skip) setFlag(true);
});
test.afterEach(async () => {
  if (!skip) await cleanup();
});

const keys = (o: object) => Object.keys(o).sort();
/** Internal vocabulary that must never reach a normal user (statuses, classes, outcomes, money groups). */
const INTERNAL = /AWAITING_APPROVAL|ASSESSING|COLLECTING|INTAKE|DECISION_APPROVED|AWAITING_PARTIES|FINDING_RECORDED|MEM_TXN|MEM_CLOSED|MEM_VIOLATION|MEM_ACCESS|GYM_GENERAL|REFUND_|RESOLVE_|LEDGER_|NEEDS_RECONCILIATION|BUSINESS_DONE|EXEC_BLOCKED|execStatus|caseClass|investigatorId|proposerId|approverId|"group"|"F[123]"/;

function refundStub(): ExecDeps {
  return {
    refund: async () => ({ refundAmount: 150000, clawback: null, release: { refundedToClient: '150000.00', shortfall: '0.00' } }),
    replayRelease: async () => ({ refundedToClient: '150000.00', shortfall: '0.00' }),
  };
}

test('R-18: GET /admin/complaints is paged ADDITIVELY - no params = the old full array; limit/offset page it stably; meta + X-Total-Count carry the total; bad values are 400', { skip }, async () => {
  const admin = newAdmin();
  const { gym } = await makeGym();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await makeComplaint(gym.id, `member-${i}`, { description: `d${i}` })).id);
  await prisma.gymComplaint.update({ where: { id: ids[0] }, data: { status: 'IN_PROGRESS' } });

  // old behaviour: no params -> the whole list in `data`, same array shape as before
  const all = await call('GET', '/admin/complaints', admin.tok);
  assert.equal(all.status, 200);
  assert.ok(Array.isArray(all.body.data));
  assert.equal(all.body.data.length, 5);
  assert.deepEqual(all.body.meta, { total: 5, limit: null, offset: 0 });
  assert.equal(all.headers.get('x-total-count'), '5');
  assert.ok(['id', 'gymId', 'status', 'issueType', 'description', 'createdAt'].every((k) => k in all.body.data[0]), 'the item shape is unchanged');

  // paging: disjoint pages whose union is the whole list, in a stable order
  const p1 = (await call('GET', '/admin/complaints?limit=2&offset=0', admin.tok)).body;
  const p2 = (await call('GET', '/admin/complaints?limit=2&offset=2', admin.tok)).body;
  const p3 = (await call('GET', '/admin/complaints?limit=2&offset=4', admin.tok)).body;
  assert.deepEqual([p1.data.length, p2.data.length, p3.data.length], [2, 2, 1]);
  assert.deepEqual(p1.meta, { total: 5, limit: 2, offset: 0 });
  assert.deepEqual([...p1.data, ...p2.data, ...p3.data].map((c: any) => c.id), all.body.data.map((c: any) => c.id));
  assert.equal((await call('GET', '/admin/complaints?limit=2&offset=9', admin.tok)).body.data.length, 0);
  // offset alone, and the status filter together with paging
  assert.equal((await call('GET', '/admin/complaints?offset=3', admin.tok)).body.data.length, 2);
  const inProg = (await call('GET', '/admin/complaints?status=IN_PROGRESS&limit=10', admin.tok)).body;
  assert.equal(inProg.meta.total, 1);
  assert.equal(inProg.data[0].id, ids[0]);

  for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'limit=1.5', 'offset=-1', 'offset=x', 'limit=']) {
    const r = await call('GET', `/admin/complaints?${q}`, admin.tok);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error.code, 'INVALID_INPUT', q);
  }
  assert.equal((await call('GET', '/admin/complaints?status=BOGUS&limit=2', admin.tok)).status, 400);
  assert.equal((await call('GET', '/admin/complaints?limit=2', token('cust-x', 'CUSTOMER'))).status, 403);
  assert.equal((await call('GET', '/admin/complaints?limit=2', null)).status, 401);
});

test('G2 / G3 / G4: admin reads over real HTTP - exact response shape, status filter and paging, access rights (ADMIN only)', { skip }, async () => {
  const d = await driveToProposal({ caseClass: 'MEM_CLOSED', finding: 'ESTABLISHED' });
  await approve(d);
  await complaintCaseExecutionService.executeDecision({ id: d.appr.id, role: 'ADMIN' }, d.caseId, {}, refundStub());
  const d2 = await driveToProposal({ caseClass: 'GYM_GENERAL', finding: 'NOT_ESTABLISHED', membership: false });

  // ── G2 list
  const list = ok(await call('GET', '/admin/complaint-cases', d.inv.tok), 200, 'G2');
  assert.deepEqual(keys(list), ['items', 'total']);
  assert.equal(list.total, 2);
  assert.deepEqual(keys(list.items[0]), ['caseClass', 'complaintId', 'complaintStatus', 'createdAt', 'descriptionPreview', 'escalated', 'execStatus', 'gymId', 'id', 'investigatorId', 'issueType', 'membershipId', 'status', 'updatedAt', 'version']);
  assert.equal((await call('GET', '/admin/complaint-cases?limit=1&offset=1', d.inv.tok)).body.data.items.length, 1);
  assert.equal(ok(await call('GET', '/admin/complaint-cases?status=AWAITING_APPROVAL', d.inv.tok), 200, 'G2 filter').items[0].id, d2.caseId);
  assert.equal((await call('GET', '/admin/complaint-cases?status=NOPE', d.inv.tok)).status, 400);
  assert.equal((await call('GET', '/admin/complaint-cases?limit=0', d.inv.tok)).status, 400);
  assert.equal((await call('GET', '/admin/complaint-cases?x=1', d.inv.tok)).status, 400, 'strict query');

  // ── G3 detail
  const detail = ok(await call('GET', `/admin/complaint-cases/${d.caseId}`, d.inv.tok), 200, 'G3');
  assert.deepEqual(keys(detail), ['allowedActions', 'case', 'claims', 'closure', 'complaint', 'decision', 'events', 'evidence', 'execution', 'financial', 'findings', 'gym', 'membership', 'proposals', 'shares', 'statements', 'assessments'].sort());
  assert.deepEqual(keys(detail.execution), ['decisionId', 'history', 'status']);
  assert.deepEqual(keys(detail.financial), ['derived', 'group', 'label', 'memberShortfall', 'observedAt', 'postedToMemberWallet', 'referralClawbackShortfall', 'state']);
  assert.equal(detail.financial.state, 'LEDGER_POSTED_FULL');
  assert.equal(detail.closure, 'CLOSED');
  assert.deepEqual(keys(detail.decision), ['approvalId', 'outcome', 'outcomeLabel', 'proposalId']);
  assert.ok(detail.allowedActions.length >= 10 && detail.allowedActions.every((a: any) => typeof a.action === 'string' && typeof a.allowed === 'boolean'));
  assert.ok(detail.events.length <= 200 && detail.events.every((e: any) => e.payload === undefined));
  assert.ok(detail.evidence.every((e: any) => /^[0-9a-f]{64}$/.test(e.contentHash) && e.scopeGymId === d.gymId));
  assert.equal((await call('GET', `/admin/complaint-cases/${randomUUID()}`, d.inv.tok)).status, 404);

  // ── G4 history
  const hist = ok(await call('GET', `/admin/complaint-cases/${d.caseId}/history`, d.inv.tok), 200, 'G4');
  assert.deepEqual(keys(hist), ['items', 'total']);
  assert.deepEqual(keys(hist.items[0]), ['action', 'actorRole', 'actorUserId', 'createdAt', 'fromStatus', 'id', 'note', 'toStatus']);
  assert.equal(hist.items[0].action, 'CASE_OPENED');
  assert.equal(hist.items[hist.items.length - 1].action, 'EXECUTION_BUSINESS_DONE');
  const times = hist.items.map((e: any) => Date.parse(e.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'oldest first');
  const page = ok(await call('GET', `/admin/complaint-cases/${d.caseId}/history?limit=2&offset=1`, d.inv.tok), 200, 'G4 page');
  assert.equal(page.items.length, 2);
  assert.equal(page.total, hist.total);
  assert.deepEqual(page.items.map((e: any) => e.id), hist.items.slice(1, 3).map((e: any) => e.id));
  assert.equal((await call('GET', `/admin/complaint-cases/${d.caseId}/history?limit=0`, d.inv.tok)).status, 400);

  // ── access rights: ADMIN only, every role/anonymous refused
  for (const p of ['/admin/complaint-cases', `/admin/complaint-cases/${d.caseId}`, `/admin/complaint-cases/${d.caseId}/history`]) {
    assert.equal((await call('GET', p, d.reporter.tok)).status, 403, `reporter ${p}`);
    assert.equal((await call('GET', p, token('pt-1', 'PT'))).status, 403, `pt ${p}`);
    assert.equal((await call('GET', p, token(d.ownerId, 'GYM_OWNER'))).status, 403, `owner ${p}`);
    assert.equal((await call('GET', p, null)).status, 401, `anonymous ${p}`);
  }
  // the reads are logged
  assert.ok((await prisma.gymCaseAccessLog.count({ where: { caseId: d.caseId, viewerUserId: d.inv.id, action: 'VIEW_CASE' } })) >= 1);
});

test('G20 / G21: member reads over real HTTP - only my own cases, exact shape, no internal vocabulary anywhere in the JSON, other users 404, admin / gym owner refused', { skip }, async () => {
  // member A: a money case that is executed (so `money` exists); member B: a case still being investigated
  const a = await driveToProposal({ caseClass: 'MEM_VIOLATION', finding: 'ESTABLISHED' });
  await approve(a);
  await complaintCaseExecutionService.executeDecision({ id: a.appr.id, role: 'ADMIN' }, a.caseId, {}, refundStub());
  const b = await driveToProposal({ caseClass: 'MEM_TXN', finding: 'ESTABLISHED' });

  // ── G20 list: each member sees exactly their own case(s)
  const la = ok(await call('GET', '/me/complaint-cases', a.reporter.tok), 200, 'G20 a');
  assert.deepEqual(keys(la), ['items']);
  assert.equal(la.items.length, 1);
  assert.deepEqual(keys(la.items[0]), ['complaintId', 'createdAt', 'id', 'progress']);
  assert.equal(la.items[0].id, a.caseId);
  assert.equal(la.items[0].progress, 'Đã xử lý');
  const lb = ok(await call('GET', '/me/complaint-cases', b.reporter.tok), 200, 'G20 b');
  assert.deepEqual(lb.items.map((i: any) => i.id), [b.caseId]);
  assert.equal(lb.items[0].progress, 'Đang xem xét');
  assert.deepEqual(ok(await call('GET', '/me/complaint-cases', token('nobody', 'CUSTOMER')), 200, 'G20 none').items, []);
  for (const r of [la, lb]) assert.doesNotMatch(JSON.stringify(r), INTERNAL, 'no internal vocabulary in the list');

  // ── G21 detail
  const da = ok(await call('GET', `/me/complaint-cases/${a.caseId}`, a.reporter.tok), 200, 'G21 a');
  assert.deepEqual(keys(da), ['case', 'complaint', 'evidence', 'money', 'resolution', 'statements']);
  assert.deepEqual(keys(da.case), ['canSubmit', 'complaintId', 'createdAt', 'id', 'progress']);
  assert.deepEqual(keys(da.complaint), ['description', 'issueType']);
  assert.deepEqual(keys(da.money), ['label', 'postedToWallet', 'stillOwed']);
  assert.match(da.money.label, /đã được ghi vào ví Gymini của bạn/);
  assert.equal(da.money.postedToWallet, '150000.00');
  assert.equal(da.money.stillOwed, null);
  assert.deepEqual(keys(da.resolution), ['text']);
  assert.ok(da.evidence.every((e: any) => ['COMPLAINT_RECORD', 'COMPLAINT_PHOTO', 'MEMBERSHIP_RECORD', 'PARTY_DOCUMENT'].includes(e.source)), 'only the member\'s own data');
  assert.ok(!da.evidence.some((e: any) => e.source === 'GYM_RECORD' || e.source === 'CHECKIN_SUMMARY'));
  assert.deepEqual(keys(da.evidence[0]), ['capturedAt', 'id', 'mine', 'payload', 'snapshotVersion', 'source', 'subject']);
  assert.equal(da.case.canSubmit, false, 'a resolved case accepts nothing more');
  // `issueType` is the member's own filing category and `source` is a data-origin tag; the INTERNAL vocabulary (statuses, classes, outcomes, money groups) is absent
  assert.doesNotMatch(JSON.stringify(da), INTERNAL);

  // unresolved case: no `money`, no `resolution`, still no internal vocabulary, and the member may submit
  const db = ok(await call('GET', `/me/complaint-cases/${b.caseId}`, b.reporter.tok), 200, 'G21 b');
  assert.equal(db.money, null);
  assert.equal(db.resolution, null);
  assert.equal(db.case.progress, 'Đang xem xét');
  assert.doesNotMatch(JSON.stringify(db), INTERNAL);

  // ── access rights
  assert.equal((await call('GET', `/me/complaint-cases/${a.caseId}`, b.reporter.tok)).status, 404, 'another member');
  assert.equal((await call('GET', `/me/complaint-cases/${b.caseId}`, a.reporter.tok)).status, 404);
  assert.equal((await call('GET', `/me/complaint-cases/${randomUUID()}`, a.reporter.tok)).status, 404);
  assert.equal((await call('GET', `/me/complaint-cases/not-a-uuid`, a.reporter.tok)).status, 404);
  assert.equal((await call('GET', `/me/complaint-cases/${a.caseId}`, token(a.ownerId, 'CUSTOMER'))).status, 404, 'the gym owner as a plain user');
  for (const p of ['/me/complaint-cases', `/me/complaint-cases/${a.caseId}`]) {
    assert.equal((await call('GET', p, newAdmin().tok)).status, 403, `admin ${p}`);
    assert.equal((await call('GET', p, token(a.ownerId, 'GYM_OWNER'))).status, 403, `gym owner role ${p}`);
    assert.equal((await call('GET', p, null)).status, 401, `anonymous ${p}`);
  }
  // reads are logged for the reporter only
  assert.ok((await prisma.gymCaseAccessLog.count({ where: { caseId: a.caseId, viewerUserId: a.reporter.id } })) >= 2);
});
