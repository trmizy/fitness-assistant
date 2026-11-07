/**
 * INT-09 - GET /admin/complaint-cases/capabilities (ADMIN only, verdicts from flags.ts) and the server-computed canSubmit on the member / owner views.
 * REAL HTTP into the real gym-service app, isolated gym *_test database. BACKEND INTEGRATION. TEST FIXTURE: gym / membership rows, token table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { call, cleanup, installStubs, openToAssessing, removeStubs, setFlag, skip, startApp, stopApp, token, newAdmin, ok } from './complaint-case.test-helpers';

test.before(async () => {
  if (skip) return;
  installStubs();
  await startApp();
});
test.after(async () => {
  setFlag(undefined);
  delete process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED;
  removeStubs();
  if (!skip) await cleanup();
  await stopApp();
  await prisma.$disconnect();
});
test.afterEach(async () => {
  delete process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED;
  if (!skip) await cleanup();
});

test('INT-09a: capabilities is ADMIN-only, is not read as a case id, and mirrors the real flag verdicts', { skip }, async () => {
  const admin = newAdmin();
  setFlag(true);
  let r = await call('GET', '/admin/complaint-cases/capabilities', admin.tok);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { gymCase: { effective: true }, decisionReplacement: { effective: false, refusedBecause: 'FLAG_OFF' }, gymParty: { effective: false } });
  process.env.GYM_COMPLAINT_DECISION_REPLACEMENT_ENABLED = 'true';
  r = await call('GET', '/admin/complaint-cases/capabilities', admin.tok);
  assert.deepEqual(r.body.data.decisionReplacement, { effective: true });

  setFlag(false);
  r = await call('GET', '/admin/complaint-cases/capabilities', admin.tok);
  assert.deepEqual(r.body.data, { gymCase: { effective: false }, decisionReplacement: { effective: false, refusedBecause: 'FLAG_OFF' }, gymParty: { effective: false } });

  // flag asked for but the runtime gate refuses (not the test env, no e2e mode): fail closed WITH the reason
  setFlag(true);
  const savedIso = process.env.DB_ISOLATION;
  process.env.DB_ISOLATION = 'refused';
  try {
    r = await call('GET', '/admin/complaint-cases/capabilities', admin.tok);
    assert.deepEqual(r.body.data.gymCase, { effective: false, refusedBecause: 'DB_ISOLATION_NOT_ACCEPTED' });
    assert.equal(r.body.data.decisionReplacement.effective, false);
    assert.equal(r.body.data.decisionReplacement.refusedBecause, 'DB_ISOLATION_NOT_ACCEPTED');
  } finally {
    process.env.DB_ISOLATION = savedIso;
  }

  assert.equal((await call('GET', '/admin/complaint-cases/capabilities', token('cust-1', 'CUSTOMER'))).status, 403);
  assert.equal((await call('GET', '/admin/complaint-cases/capabilities', null)).status, 401);
});

test('INT-09b: member and owner canSubmit follow the flag AND the case state', { skip }, async () => {
  setFlag(true);
  const d = await openToAssessing();
  let list = ok(await call('GET', '/me/complaint-cases', d.reporter.tok), 200, 'list');
  assert.equal(list.items[0].canSubmit, true);
  let det = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'detail');
  assert.equal(det.case.canSubmit, true);
  const own = token(d.ownerId, 'GYM_OWNER');
  const ownDet = await call('GET', `/owner/complaint-cases/${d.caseId}`, own);
  assert.equal(ownDet.status, 200); assert.equal(ownDet.body.data.case.canSubmit, true);

  setFlag(false);
  list = ok(await call('GET', '/me/complaint-cases', d.reporter.tok), 200, 'list off');
  assert.equal(list.items[0].canSubmit, false);
  det = ok(await call('GET', `/me/complaint-cases/${d.caseId}`, d.reporter.tok), 200, 'detail off');
  assert.equal(det.case.canSubmit, false);
  const ownOff = await call('GET', `/owner/complaint-cases/${d.caseId}`, own);
  assert.equal(ownOff.status, 200); assert.equal(ownOff.body.data.case.canSubmit, false);
  const ownList = await call('GET', '/owner/complaint-cases', own);
  assert.equal(ownList.status, 200); assert.ok(ownList.body.data.items.every((i: any) => i.canSubmit === false));
  // and the write really is refused when canSubmit says false
  const w = await call('POST', `/me/complaint-cases/${d.caseId}/statements`, d.reporter.tok, { text: 'x' });
  assert.equal(w.status, 409);
  assert.equal(w.body.error.code, 'GYM_CASE_DISABLED');
});
