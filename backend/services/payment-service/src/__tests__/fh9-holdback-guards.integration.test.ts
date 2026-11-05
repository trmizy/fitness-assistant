/**
 * E6 / F3 (Ngài, 05/11/2026) - FH-9 decideHoldbackReview:
 *   the decider and the approver must be two distinct, REAL, active ADMIN user ids verified with auth-service (not free names);
 *   it is refused while the review's contract has an UNFINISHED dispute Case (user-service, read-only); an approved decision does not block;
 *   both checks fail CLOSED (auth-service or user-service not answering = refused). Nothing is written by a refusal.
 * Evidence label: BACKEND INTEGRATION (real service + real database `*_test`; auth-service and user-service are small TEST FIXTURE HTTP servers). The other holdback behaviour is covered by
 * fh9-pt-holdback.integration.test.ts / pt-holdback.integration.test.ts (their two network guards are stubbed there).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skip = isTestDatabaseUrl(process.env.DATABASE_URL || '') ? false : 'Requires DATABASE_URL pointing at a *_test database.';
let authServer: http.Server;
let userServer: http.Server;
const accounts = new Map<string, { role: string; isActive: boolean }>();
let userAnswer: 'ALLOWED' | 'OPEN' | 'DOWN' = 'ALLOWED';
let authDown = false;
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)));

test.before(async () => {
  if (skip) return;
  authServer = http.createServer((req, res) => {
    const m = /^\/auth\/internal\/users\/([^/]+)$/.exec(req.url || '');
    const send = (st: number, b: unknown) => {
      res.writeHead(st, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (authDown) {
      send(500, {});
      return;
    }
    const a = m ? accounts.get(decodeURIComponent(m[1])) : undefined;
    return a ? send(200, { user: { id: decodeURIComponent(m![1]), ...a } }) : send(404, {});
  });
  userServer = http.createServer((_req, res) => {
    const send = (st: number, b: unknown) => {
      res.writeHead(st, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (userAnswer === 'OPEN') {
      send(409, { success: false, error: { code: 'CONTRACT_CASE_OPEN', message: 'open' } });
      return;
    }
    if (userAnswer === 'DOWN') {
      send(500, {});
      return;
    }
    send(200, { success: true, data: { allowed: true } });
  });
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${await listen(authServer)}`;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${await listen(userServer)}`;
});
test.after(async () => {
  if (skip) return;
  for (const s of [authServer, userServer]) await new Promise<void>((r) => s.close(() => r()));
  const { prisma } = await import('../repositories/prisma');
  await prisma.$disconnect();
});

/** TEST FIXTURE: an OPEN reserve review on a PT contract payment transaction (the decision is only DRY-RUN here: the point is what is checked BEFORE it). */
async function review() {
  const { prisma } = await import('../repositories/prisma');
  const sfx = randomUUID();
  const txn = await prisma.paymentTransaction.create({
    data: { payerId: `c-${sfx}`, ptId: `p-${sfx}`, purpose: 'PT_CONTRACT', amount: 1000, status: 'PAID', provider: 'MOCK', idempotencyKey: `hb-${sfx}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: `contract-${sfx}` } as any,
  });
  const r = await prisma.ptHoldbackReview.create({ data: { key: `HBR:${txn.id}:UNCOMPUTABLE`, transactionId: txn.id, kind: 'UNCOMPUTABLE', reserve: 90, reason: 'fixture', reviewBy: new Date(Date.now() + 86_400_000) } as any });
  return { prisma, txn, r };
}
const input = (r: { id: string }, txnId: string, over: Record<string, unknown> = {}) => ({
  reviewId: r.id,
  expectedReserve: '90.00',
  expectedTransactionId: txnId,
  decision: 'NOT_VERIFIED' as const,
  note: 'đã kiểm tra, PT không chịu trách nhiệm',
  actor: 'admin-decider-1',
  approvedBy: 'admin-approver-2',
  approvalRef: `ref-${randomUUID()}`,
  dryRun: true,
  ...over,
});
const refused = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => e.code === code, code);

test('F3: free names / non-admin / inactive / unknown accounts are refused; auth-service down is refused (fail-closed); two distinct real ADMIN ids pass this check', { skip }, async () => {
  const { decideHoldbackReview } = await import('../services/holdback-review.service');
  const f = await review();
  const before = JSON.stringify(await f.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: f.r.id } }));
  accounts.set('admin-decider-1', { role: 'ADMIN', isActive: true });
  accounts.set('admin-approver-2', { role: 'ADMIN', isActive: true });
  accounts.set('pt-user-3', { role: 'PT', isActive: true });
  accounts.set('admin-off-4', { role: 'ADMIN', isActive: false });
  // a free name (unknown account) for either role
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { actor: 'Nguyen Van A' })), 'NOT_AN_ADMIN');
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { approvedBy: 'Tran Thi B' })), 'NOT_AN_ADMIN');
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { approvedBy: 'pt-user-3' })), 'NOT_AN_ADMIN');
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { actor: 'admin-off-4' })), 'NOT_AN_ADMIN');
  // the same person twice (case-insensitive) is the existing four-eyes rule
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { approvedBy: 'ADMIN-DECIDER-1' })), 'FOUR_EYES');
  // auth-service not answering
  authDown = true;
  try {
    await refused(decideHoldbackReview(input(f.r, f.txn.id)), 'ACCOUNT_LOOKUP_UNAVAILABLE');
  } finally {
    authDown = false;
  }
  assert.equal(JSON.stringify(await f.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: f.r.id } })), before, 'nothing changed');
  // two distinct real active ADMIN ids: the check passes (dry-run: nothing is applied)
  const dry: any = await decideHoldbackReview(input(f.r, f.txn.id));
  assert.equal(dry.outcome, 'DRY_RUN');
});

test('F3: an UNFINISHED dispute Case on the contract refuses the decision (OPEN_CASE); user-service down refuses it (fail-closed); no Case -> allowed', { skip }, async () => {
  const { decideHoldbackReview } = await import('../services/holdback-review.service');
  const f = await review();
  accounts.set('admin-decider-1', { role: 'ADMIN', isActive: true });
  accounts.set('admin-approver-2', { role: 'ADMIN', isActive: true });
  const before = JSON.stringify(await f.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: f.r.id } }));
  userAnswer = 'OPEN';
  await refused(decideHoldbackReview(input(f.r, f.txn.id)), 'OPEN_CASE');
  await refused(decideHoldbackReview(input(f.r, f.txn.id, { dryRun: false })), 'OPEN_CASE');
  userAnswer = 'DOWN';
  await refused(decideHoldbackReview(input(f.r, f.txn.id)), 'CASE_CHECK_UNAVAILABLE');
  userAnswer = 'ALLOWED';
  assert.equal(JSON.stringify(await f.prisma.ptHoldbackReview.findUniqueOrThrow({ where: { id: f.r.id } })), before, 'nothing changed');
  assert.equal((await decideHoldbackReview(input(f.r, f.txn.id))).outcome, 'DRY_RUN');
  assert.equal(await f.prisma.ptHoldbackReviewEvent.count({ where: { reviewId: f.r.id } }), 0, 'no event was written by the refusals or the dry-run');
});
