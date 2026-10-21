/**
 * FH-8 - verified manual payment lifecycle of an unpaid obligation:
 *   OPEN -> APPROVED_FOR_PAYMENT -> AWAITING_EVIDENCE -> PAID_VERIFIED (four-eyes), RESOLVED_OTHER, WAIVED, cancel.
 * BACKEND INTEGRATION on a real ledger in a *_test database (money rows from the real ledger, see support/fh-backlog-seed.ts;
 * the few rows the lifecycle can no longer produce - legacy PAID_EXTERNALLY - are TEST FIXTURE rows) + REAL HTTP on the admin report.
 *
 * Nothing here may move money: every test compares the money tables (wallets, ledger entries, ledger operations, payment
 * transactions, partner receivables) before and after.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_g8_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh8-obligation-payment-lifecycle.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { seedBacklog, tableCounts } from './support/fh-backlog-seed';
import { parseArgs, runCli } from '../services/adjustment-cli';

const DB = process.env.DATABASE_URL;
const skipOpts = { skip: isTestDatabaseUrl(DB) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4058';
process.env.GYM_SERVICE_URL = 'http://127.0.0.1:1'; // nothing listens: the product lookup just fails fast, irrelevant here
process.env.TARGET_STATUS_LOOKUP_TIMEOUT_MS = '300';

type Seed = Awaited<ReturnType<typeof seedBacklog>>;
let seed: Seed | undefined;
let authServer: http.Server | undefined;
let app: http.Server | undefined;
let base = '';

test.before(async () => {
  if (skipOpts.skip) return;
  authServer = http.createServer((req, res) => {
    const a = String(req.headers.authorization || '');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/auth/verify' && a === 'Bearer admin') {
      res.end(JSON.stringify({ user: { id: 'admin-1', email: 'a@example.com', role: 'ADMIN' } }));
    } else if (req.method === 'POST' && req.url === '/auth/verify' && a === 'Bearer customer') {
      res.end(JSON.stringify({ user: { id: 'cust-1', email: 'c@example.com', role: 'CUSTOMER' } }));
    } else {
      res.statusCode = 401;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => authServer!.listen(4058, '127.0.0.1', r));
  const { default: adminRoutes } = await import('../routes/admin.routes');
  const server = express();
  server.use(express.json());
  server.use('/admin/payments', adminRoutes);
  app = http.createServer(server);
  await new Promise<void>((r) => app!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (skipOpts.skip) return;
  for (const s of [app, authServer]) if (s) await new Promise<void>((r) => s.close(() => r()));
  if (seed) await seed.prisma.$disconnect();
});

const adj = () => import('../services/adjustment-operations.service');
const lc = () => import('../services/obligation-payment-lifecycle.service');

/** Money must never move: no wallet, ledger entry, ledger operation, transaction or receivable is written by any of these operations. */
const moneyCounts = async (s: Seed) => {
  const c = await tableCounts(s.prisma);
  return { wallets: c.wallets, entries: c.wallet_ledger_entries, ops: c.ledger_operations, txns: c.payment_transactions, receivables: c.partner_receivables, rev: c.partner_receivable_events, comm: c.platform_commissions };
};

type Ob = Seed['obligations'][number];
const cas = (o: Ob, unpaid?: { toFixed(n: number): string }) => ({
  obligationId: o.id,
  expectedUnpaid: (unpaid ?? o.unpaid).toFixed(2),
  expectedTransactionId: o.transactionId,
});
const REF = 'FT26293-000123';
const approveIn = (o: Ob, over: Record<string, unknown> = {}) => ({
  ...cas(o),
  approvedAmount: o.unpaid.toFixed(2),
  paymentSource: 'MANUAL_BANK_TRANSFER',
  approvedBy: 'owner-test',
  approvalRef: 'AP-1',
  note: 'owner approved the payout',
  dryRun: false,
  ...over,
});
const submitIn = (o: Ob, over: Record<string, unknown> = {}) => ({
  ...cas(o),
  approvalRef: 'AP-1',
  paidAmount: o.unpaid.toFixed(2),
  transferReference: REF,
  paidOn: '2026-10-20',
  evidenceRef: 'evidence/2026/10/FT26293.pdf',
  recordedBy: 'clerk-test',
  note: 'transfer receipt attached',
  dryRun: false,
  ...over,
});
const verifyIn = (o: Ob, over: Record<string, unknown> = {}) => ({
  ...cas(o),
  approvalRef: 'AP-1',
  verifiedBy: 'auditor-test',
  observedAmount: o.unpaid.toFixed(2),
  observedTransferReference: REF,
  note: 'checked against the bank statement',
  dryRun: false,
  ...over,
});
const cancelIn = (o: Ob, over: Record<string, unknown> = {}) => ({
  ...cas(o),
  approvalRef: 'AP-1',
  cancelledBy: 'owner-test',
  reason: 'the transfer was never made',
  dryRun: false,
  ...over,
});
const code = (c: string | string[]) => (e: any) => (Array.isArray(c) ? c.includes(e.code) : e.code === c) || (console.error('got', e.code, e.message), false);
const row = (s: Seed, o: Ob) => s.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } });

test('HAPPY PATH: approve -> evidence -> verify (different person): unpaid only drops at verification; recipient from the ledger; no money moves', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const o = seed.obligations[0];
  const m0 = await moneyCounts(seed);
  const c0 = await tableCounts(seed.prisma);

  // dry-run writes nothing
  const dry = await approveObligationPayment(approveIn(o, { dryRun: true }));
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal(dry.after.status, 'APPROVED_FOR_PAYMENT');
  assert.deepEqual(await tableCounts(seed.prisma), c0, 'dry-run wrote nothing');

  const a = await approveObligationPayment(approveIn(o));
  assert.equal(a.outcome, 'APPLIED');
  let r = await row(seed, o);
  assert.equal(r.status, 'APPROVED_FOR_PAYMENT');
  assert.equal(r.unpaid.toFixed(2), o.unpaid.toFixed(2), 'approval does not reduce unpaid');
  const pay = await seed.prisma.contractUnpaidObligationPayment.findFirstOrThrow({ where: { obligationId: o.id } });
  assert.equal(pay.status, 'APPROVED');
  assert.equal(pay.recipientParty, 'CLIENT');
  const txn = await seed.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: o.transactionId } });
  assert.equal(pay.recipientId, txn.payerId, 'recipient = the payer of the contract payment, read from the ledger');
  assert.equal(pay.paymentSource, 'MANUAL_BANK_TRANSFER');
  assert.equal(pay.approvedBy, 'owner-test');

  await submitObligationEvidence(submitIn(o));
  r = await row(seed, o);
  assert.equal(r.status, 'AWAITING_EVIDENCE');
  assert.equal(r.unpaid.toFixed(2), o.unpaid.toFixed(2), 'recorded evidence is NOT payment: unpaid unchanged');
  assert.equal(r.verifiedPaid.toFixed(2), '0.00');

  const v = await verifyObligationPayment(verifyIn(o));
  assert.equal(v.outcome, 'APPLIED');
  assert.equal(v.after.status, 'PAID_VERIFIED');
  r = await row(seed, o);
  assert.equal(r.status, 'PAID_VERIFIED');
  assert.equal(r.unpaid.toFixed(2), '0.00');
  assert.equal(r.verifiedPaid.toFixed(2), o.unpaid.toFixed(2));
  assert.equal(r.externallyPaid.toFixed(2), '0.00', 'the legacy unverified figure is never written');
  assert.equal(r.paid.toFixed(2), o.paid.toFixed(2), '`paid` still means paid by the ledger');
  assert.equal(r.owed.toFixed(2), o.owed.toFixed(2));
  assert.ok(r.resolvedAt);
  assert.equal(r.resolvedBy, 'auditor-test');

  const ev = await seed.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId: o.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    ev.map((e) => [e.action, e.fromStatus, e.toStatus, e.actor]),
    [
      ['APPROVE_PAYMENT', 'OPEN', 'APPROVED_FOR_PAYMENT', 'owner-test'],
      ['SUBMIT_EVIDENCE', 'APPROVED_FOR_PAYMENT', 'AWAITING_EVIDENCE', 'clerk-test'],
      ['VERIFY_PAYMENT', 'AWAITING_EVIDENCE', 'PAID_VERIFIED', 'auditor-test'],
    ],
    'an audit event with the actor for every transition',
  );
  assert.equal(ev[2].verifiedBy, 'auditor-test');
  assert.equal(ev[2].transferReference, REF);
  assert.equal(ev[2].evidenceRef, 'evidence/2026/10/FT26293.pdf');
  assert.equal(ev[2].paymentSource, 'MANUAL_BANK_TRANSFER');
  assert.equal(ev[2].recipient, `CLIENT:${txn.payerId}`);
  assert.equal(ev[2].unpaidAfter!.toFixed(2), '0.00');
  const done = await seed.prisma.contractUnpaidObligationPayment.findFirstOrThrow({ where: { obligationId: o.id } });
  assert.equal(done.status, 'VERIFIED');
  assert.equal(done.verifiedBy, 'auditor-test');

  assert.deepEqual(await moneyCounts(seed), m0, 'no wallet / ledger / receivable / commission row was written');
  assert.equal((await row(seed, seed.obligations[1])).status, 'OPEN', 'the other obligation is untouched');
});

test('APPROVE guards: manual sources only, exact amount <= unpaid, authorised approver, CAS, client obligations only, ledger recipient', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment } = await lc();
  const o = seed.obligations[0];
  const c0 = await tableCounts(seed.prisma);
  const bad = (over: Record<string, unknown>, c: string | string[]) =>
    assert.rejects(approveObligationPayment(approveIn(o, over)), code(c), JSON.stringify(over));

  for (const src of ['WALLET', 'LEDGER', 'PLATFORM_REVENUE', 'GOODWILL_FUND', 'ESCROW', 'AUTO', '']) await bad({ paymentSource: src }, 'INVALID_SOURCE');
  await bad({ approvedAmount: o.unpaid.plus(1).toFixed(2) }, 'AMOUNT_EXCEEDS_UNPAID');
  await bad({ approvedAmount: '0' }, 'INVALID_INPUT');
  await bad({ approvedAmount: '-1' }, 'INVALID_INPUT');
  await bad({ approvedAmount: 'abc' }, 'INVALID_INPUT');
  await bad({ approvedAmount: '10.123' }, 'INVALID_INPUT');
  await bad({ approvedBy: '' }, 'INVALID_INPUT');
  await bad({ approvalRef: '' }, 'INVALID_INPUT');
  await bad({ note: 'x' }, 'INVALID_INPUT');
  await bad({ expectedUnpaid: '1.00' }, 'CAS_MISMATCH');
  await bad({ expectedTransactionId: 'some-other-txn' }, 'CAS_MISMATCH');
  await bad({ authorisedApprovers: ['someone-else'] }, 'NOT_AUTHORISED');
  assert.equal((await approveObligationPayment(approveIn(o, { authorisedApprovers: ['OWNER-TEST'], dryRun: true }))).outcome, 'DRY_RUN', 'allow-list is case-insensitive');
  assert.deepEqual(await tableCounts(seed.prisma), c0, 'every refusal left the database untouched');

  // an obligation that is not owed to a client cannot be paid out
  const ptRow = await seed.prisma.contractUnpaidObligation.create({
    data: { key: 'OVER_RELEASED:fixture:1', transactionId: o.transactionId, kind: 'OVER_RELEASED', party: 'PT', owed: 5000, paid: 0, unpaid: 5000 }, // TEST FIXTURE
  });
  await assert.rejects(
    approveObligationPayment({ obligationId: ptRow.id, expectedUnpaid: '5000.00', expectedTransactionId: o.transactionId, approvedAmount: '5000', paymentSource: 'MANUAL_CASH', approvedBy: 'owner-test', approvalRef: 'AP-PT', note: 'try to pay a PT', dryRun: false }),
    code('PARTY_NOT_PAYABLE'),
  );
  assert.equal(await seed.prisma.contractUnpaidObligationPayment.count(), 0);
});

test('EXACT PARTIAL amount approved: approved amount < unpaid is allowed and stored exactly', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment } = await lc();
  const o = seed.obligations[0];
  await approveObligationPayment(approveIn(o, { approvedAmount: '1000.50' }));
  const pay = await seed.prisma.contractUnpaidObligationPayment.findFirstOrThrow({ where: { obligationId: o.id } });
  assert.equal(pay.amount.toFixed(2), '1000.50');
});

test('ILLEGAL TRANSITIONS are refused and change nothing', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment, cancelObligationApproval } = await lc();
  const { adjustObligation } = await adj();
  const [o, o2] = seed.obligations;
  const adjIn = (ob: Ob, action: 'WAIVE' | 'RESOLVE' | 'RESOLVE_OTHER' | 'REVIEW' | 'RELEASE_REVIEW', ref: string) => ({
    ...cas(ob), action, note: 'owner decision, see the minutes', actor: 'ops-test', approvalRef: ref, dryRun: false,
  });

  // nothing approved yet
  await assert.rejects(submitObligationEvidence(submitIn(o)), code('NO_SUCH_APPROVAL'));
  await assert.rejects(verifyObligationPayment(verifyIn(o)), code('NO_SUCH_APPROVAL'));
  await assert.rejects(cancelObligationApproval(cancelIn(o)), code('NO_SUCH_APPROVAL'));

  // approved: cannot verify before evidence; cannot be waived / resolved / reviewed under a payment in flight
  await approveObligationPayment(approveIn(o));
  await assert.rejects(verifyObligationPayment(verifyIn(o)), code('NOT_AWAITING_EVIDENCE'));
  for (const a of ['WAIVE', 'RESOLVE', 'RESOLVE_OTHER', 'REVIEW', 'RELEASE_REVIEW'] as const) {
    await assert.rejects(adjustObligation(adjIn(o, a, `X-${a}`)), code('NOT_OPEN'), a);
  }
  // a second approval while one is pending (other ref, other amount) is refused
  await assert.rejects(approveObligationPayment(approveIn(o, { approvalRef: 'AP-2', approvedAmount: '1.00' })), code('PAYMENT_PENDING'));

  // awaiting evidence: cannot submit again with other data; cannot approve; cannot waive
  await submitObligationEvidence(submitIn(o));
  await assert.rejects(submitObligationEvidence(submitIn(o, { transferReference: 'OTHER-REF-999' })), code('APPROVAL_REF_REUSED'));
  await assert.rejects(approveObligationPayment(approveIn(o, { approvalRef: 'AP-2' })), code('PAYMENT_PENDING'));
  await assert.rejects(adjustObligation(adjIn(o, 'WAIVE', 'X-W2')), code('NOT_OPEN'));

  // verified: terminal. Nothing can be approved, cancelled, waived, resolved, or verified by someone else
  await verifyObligationPayment(verifyIn(o));
  await assert.rejects(approveObligationPayment(approveIn(o, { approvalRef: 'AP-3', ...cas(o, { toFixed: () => '0.00' }) })), code('NOT_OPEN'));
  await assert.rejects(cancelObligationApproval(cancelIn(o, { expectedUnpaid: '0.00' })), code('NOT_PENDING'));
  await assert.rejects(adjustObligation(adjIn(o, 'WAIVE', 'X-W3')), code(['NOT_OPEN', 'CAS_MISMATCH']));
  await assert.rejects(verifyObligationPayment(verifyIn(o, { verifiedBy: 'auditor-2' })), code('ALREADY_VERIFIED'));

  // review round trip on the second obligation still works and RESOLVE_OTHER / WAIVE close it
  assert.equal((await adjustObligation(adjIn(o2, 'REVIEW', 'RV-1'))).after.status, 'UNDER_REVIEW');
  assert.equal((await adjustObligation(adjIn(o2, 'RELEASE_REVIEW', 'RV-2'))).after.status, 'OPEN');
  assert.equal((await row(seed, o2)).status, 'OPEN');
});

test('EVIDENCE is mandatory: a transfer reference alone is not proof; hash / date / reference validated', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence } = await lc();
  const o = seed.obligations[0];
  await approveObligationPayment(approveIn(o));
  const bad = (over: Record<string, unknown>, c: string) => assert.rejects(submitObligationEvidence(submitIn(o, over)), code(c), JSON.stringify(over));
  await bad({ evidenceRef: undefined }, 'EVIDENCE_REQUIRED');
  await bad({ evidenceRef: '', evidenceHash: '', bankStatementId: '' }, 'EVIDENCE_REQUIRED');
  await bad({ evidenceRef: undefined, evidenceHash: 'not-a-hash' }, 'INVALID_INPUT');
  await bad({ evidenceRef: 'ab' }, 'INVALID_INPUT');
  await bad({ transferReference: 'ab' }, 'INVALID_INPUT');
  await bad({ paidOn: '2099-01-01' }, 'INVALID_INPUT');
  await bad({ paidOn: 'yesterday' }, 'INVALID_INPUT');
  await bad({ paidAmount: '0' }, 'INVALID_INPUT');
  await bad({ recordedBy: '' }, 'INVALID_INPUT');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { action: 'SUBMIT_EVIDENCE' } }), 0);
  assert.equal((await row(seed, o)).status, 'APPROVED_FOR_PAYMENT');

  // each single pointer is enough on its own
  const sha = 'a'.repeat(64);
  assert.equal((await submitObligationEvidence(submitIn(o, { evidenceRef: undefined, evidenceHash: sha, dryRun: true }))).outcome, 'DRY_RUN');
  assert.equal((await submitObligationEvidence(submitIn(o, { evidenceRef: undefined, bankStatementId: 'STMT-20261020-17', dryRun: true }))).outcome, 'DRY_RUN');
  const ok = await submitObligationEvidence(submitIn(o, { evidenceRef: undefined, evidenceHash: sha.toUpperCase() }));
  assert.equal(ok.outcome, 'APPLIED');
  assert.equal((await seed.prisma.contractUnpaidObligationPayment.findFirstOrThrow({ where: { obligationId: o.id } })).evidenceHash, sha);
});

test('FOUR-EYES: the person who recorded the evidence cannot verify it (case / spaces ignored); a different person can', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const o = seed.obligations[0];
  await approveObligationPayment(approveIn(o));
  await submitObligationEvidence(submitIn(o, { recordedBy: 'Clerk-Test' }));
  for (const who of ['Clerk-Test', 'clerk-test', '  CLERK-TEST ']) {
    await assert.rejects(verifyObligationPayment(verifyIn(o, { verifiedBy: who })), code('SAME_PERSON'), who);
  }
  await assert.rejects(verifyObligationPayment(verifyIn(o, { verifiedBy: 'clerk-test', dryRun: true })), code('SAME_PERSON'), 'dry-run enforces it too');
  assert.equal((await row(seed, o)).status, 'AWAITING_EVIDENCE');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { action: 'VERIFY_PAYMENT' } }), 0);
  // the approver may NOT be assumed to be a second pair of eyes: only the recorder is excluded, so the approver can verify
  assert.equal((await verifyObligationPayment(verifyIn(o, { verifiedBy: 'owner-test' }))).after.status, 'PAID_VERIFIED');
});

test('AMOUNT MISMATCH / reference mismatch / future date / changed recipient are refused at verification; cancel returns it to OPEN and the reference stays burned', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment, cancelObligationApproval } = await lc();
  const [o, o2] = seed.obligations;
  const m0 = await moneyCounts(seed);

  await approveObligationPayment(approveIn(o));
  // evidence says a different amount than approved: recording is allowed (it is what the statement says), verification is not
  await submitObligationEvidence(submitIn(o, { paidAmount: o.unpaid.minus(1).toFixed(2) }));
  await assert.rejects(verifyObligationPayment(verifyIn(o)), code('AMOUNT_MISMATCH'));
  await assert.rejects(verifyObligationPayment(verifyIn(o, { observedAmount: o.unpaid.minus(1).toFixed(2) })), code('AMOUNT_MISMATCH'));
  assert.equal((await row(seed, o)).unpaid.toFixed(2), o.unpaid.toFixed(2));
  assert.equal((await row(seed, o)).status, 'AWAITING_EVIDENCE');

  // cancel needs a real reason, returns the row to OPEN, unpaid untouched
  await assert.rejects(cancelObligationApproval(cancelIn(o, { reason: 'no' })), code('INVALID_INPUT'));
  const c = await cancelObligationApproval(cancelIn(o));
  assert.equal(c.after.status, 'OPEN');
  assert.equal((await row(seed, o)).unpaid.toFixed(2), o.unpaid.toFixed(2));
  assert.equal((await seed.prisma.contractUnpaidObligationPayment.findFirstOrThrow({ where: { obligationId: o.id } })).status, 'CANCELLED');
  assert.equal((await cancelObligationApproval(cancelIn(o))).outcome, 'REPLAYED', 'a cancel retry replays');
  // the cancelled reference can never be used again, not even for the same data
  await assert.rejects(approveObligationPayment(approveIn(o)), code('APPROVAL_REF_REUSED'));
  await assert.rejects(submitObligationEvidence(submitIn(o)), code(['NOT_APPROVED', 'APPROVAL_REF_REUSED']));
  // a fresh reference works
  await approveObligationPayment(approveIn(o, { approvalRef: 'AP-NEW' }));
  assert.equal((await row(seed, o)).status, 'APPROVED_FOR_PAYMENT');

  // reference mismatch + future recorded date (TEST FIXTURE: the date is moved with SQL after it was recorded) + recipient drift
  await approveObligationPayment(approveIn(o2));
  await submitObligationEvidence(submitIn(o2));
  await assert.rejects(verifyObligationPayment(verifyIn(o2, { observedTransferReference: 'DIFFERENT-REF' })), code('REFERENCE_MISMATCH'));
  await seed.prisma.$executeRawUnsafe(`UPDATE contract_unpaid_obligation_payments SET paid_on = now() + interval '5 days' WHERE obligation_id = '${o2.id}'`);
  await assert.rejects(verifyObligationPayment(verifyIn(o2)), code('INVALID_INPUT'));
  await seed.prisma.$executeRawUnsafe(`UPDATE contract_unpaid_obligation_payments SET paid_on = now() - interval '1 day' WHERE obligation_id = '${o2.id}'`);
  await seed.prisma.$executeRawUnsafe(`UPDATE payment_transactions SET payer_id = 'someone-else' WHERE id = '${o2.transactionId}'`);
  await assert.rejects(verifyObligationPayment(verifyIn(o2)), code('RECIPIENT_CHANGED'));
  await seed.prisma.$executeRawUnsafe(`UPDATE payment_transactions SET payer_id = 'client-A' WHERE id = '${o2.transactionId}'`);
  assert.equal((await verifyObligationPayment(verifyIn(o2))).after.status, 'PAID_VERIFIED');
  assert.deepEqual(await moneyCounts(seed), m0);
});

test('REPLAY: every step is idempotent per approval ref (one event, one effect); different data under the same ref is refused', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const o = seed.obligations[0];

  assert.equal((await approveObligationPayment(approveIn(o))).outcome, 'APPLIED');
  assert.equal((await approveObligationPayment(approveIn(o))).outcome, 'REPLAYED');
  await assert.rejects(approveObligationPayment(approveIn(o, { approvedAmount: '1.00' })), code('APPROVAL_REF_REUSED'));
  await assert.rejects(approveObligationPayment(approveIn(o, { paymentSource: 'MANUAL_CASH' })), code('APPROVAL_REF_REUSED'));

  assert.equal((await submitObligationEvidence(submitIn(o))).outcome, 'APPLIED');
  assert.equal((await submitObligationEvidence(submitIn(o))).outcome, 'REPLAYED');
  await assert.rejects(submitObligationEvidence(submitIn(o, { evidenceRef: 'evidence/other.pdf' })), code('APPROVAL_REF_REUSED'));
  await assert.rejects(submitObligationEvidence(submitIn(o, { paidAmount: '1.00' })), code('APPROVAL_REF_REUSED'));

  assert.equal((await verifyObligationPayment(verifyIn(o))).outcome, 'APPLIED');
  assert.equal((await verifyObligationPayment(verifyIn(o))).outcome, 'REPLAYED');
  assert.equal((await approveObligationPayment(approveIn(o))).outcome, 'REPLAYED', 'a late retry of step 1 still replays');

  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o.id } }), 3);
  assert.equal(await seed.prisma.contractUnpaidObligationPayment.count({ where: { obligationId: o.id } }), 1);
  assert.equal((await row(seed, o)).verifiedPaid.toFixed(2), o.unpaid.toFixed(2), 'paid once, not twice');
});

test('PARTIAL: verified partial payment reduces unpaid and returns the row to OPEN; verified payments never exceed what was owed', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const o = seed.obligations[0];
  const m0 = await moneyCounts(seed);
  const half = o.unpaid.div(2);
  const rest = o.unpaid.minus(half);

  await approveObligationPayment(approveIn(o, { approvedAmount: half.toFixed(2) }));
  await submitObligationEvidence(submitIn(o, { paidAmount: half.toFixed(2), transferReference: 'FT-PART-1' }));
  const v1 = await verifyObligationPayment(verifyIn(o, { observedAmount: half.toFixed(2), observedTransferReference: 'FT-PART-1' }));
  assert.equal(v1.after.status, 'OPEN');
  assert.equal(v1.after.partial, true);
  let r = await row(seed, o);
  assert.equal(r.status, 'OPEN');
  assert.equal(r.unpaid.toFixed(2), rest.toFixed(2));
  assert.equal(r.verifiedPaid.toFixed(2), half.toFixed(2));
  assert.equal(r.resolvedAt, null, 'not closed');

  // the next approval must CAS on the NEW unpaid amount and cannot exceed it
  await assert.rejects(approveObligationPayment(approveIn(o, { approvalRef: 'AP-2' })), code('CAS_MISMATCH'));
  await assert.rejects(approveObligationPayment(approveIn(o, { ...cas(o, rest), approvalRef: 'AP-2', approvedAmount: rest.plus(1).toFixed(2) })), code('AMOUNT_EXCEEDS_UNPAID'));
  await approveObligationPayment(approveIn(o, { ...cas(o, rest), approvalRef: 'AP-2', approvedAmount: rest.toFixed(2) }));
  await submitObligationEvidence(submitIn(o, { ...cas(o, rest), approvalRef: 'AP-2', paidAmount: rest.toFixed(2), transferReference: 'FT-PART-2' }));
  const v2 = await verifyObligationPayment(verifyIn(o, { ...cas(o, rest), approvalRef: 'AP-2', observedAmount: rest.toFixed(2), observedTransferReference: 'FT-PART-2' }));
  assert.equal(v2.after.status, 'PAID_VERIFIED');
  r = await row(seed, o);
  assert.equal(r.unpaid.toFixed(2), '0.00');
  assert.equal(r.verifiedPaid.toFixed(2), o.unpaid.toFixed(2), 'two verified payments add up to the whole - not more');
  const sum = await seed.prisma.contractUnpaidObligationPayment.aggregate({ where: { obligationId: o.id, status: 'VERIFIED' }, _sum: { amount: true } });
  assert.equal(sum._sum.amount!.toFixed(2), o.unpaid.toFixed(2));
  await assert.rejects(approveObligationPayment(approveIn(o, { ...cas(o, { toFixed: () => '0.00' }), approvalRef: 'AP-3', approvedAmount: '1.00' })), code('NOT_OPEN'));
  assert.deepEqual(await moneyCounts(seed), m0);
});

test('CONCURRENT: two approvals, the same approval twice, two verifiers, the same verifier twice -> exactly one effect each', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const [o1, o2] = seed.obligations;

  // two DIFFERENT approvals for the same obligation race: one wins, the other is refused
  const race = await Promise.allSettled([approveObligationPayment(approveIn(o1, { approvalRef: 'RACE-1' })), approveObligationPayment(approveIn(o1, { approvalRef: 'RACE-2' }))]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one approval wins');
  const lost = race.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(['PAYMENT_PENDING', 'CONCURRENT_CHANGE'].includes(lost.reason.code), lost.reason.code);
  assert.equal(await seed.prisma.contractUnpaidObligationPayment.count({ where: { obligationId: o1.id } }), 1);
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o1.id } }), 1);

  // the SAME approval twice: one applies, one replays
  const same = await Promise.all([approveObligationPayment(approveIn(o2)), approveObligationPayment(approveIn(o2))]);
  assert.deepEqual(same.map((r) => r.outcome).sort(), ['APPLIED', 'REPLAYED']);
  const sub = await Promise.all([submitObligationEvidence(submitIn(o2)), submitObligationEvidence(submitIn(o2))]);
  assert.deepEqual(sub.map((r) => r.outcome).sort(), ['APPLIED', 'REPLAYED']);

  // two verifiers race: one effect; the loser is told it was already verified
  const ver = await Promise.allSettled([verifyObligationPayment(verifyIn(o2, { verifiedBy: 'auditor-1' })), verifyObligationPayment(verifyIn(o2, { verifiedBy: 'auditor-2' }))]);
  assert.equal(ver.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one verification wins');
  const vlost = ver.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(['ALREADY_VERIFIED', 'CONCURRENT_CHANGE', 'NOT_AWAITING_EVIDENCE'].includes(vlost.reason.code), vlost.reason.code);
  const r2 = await row(seed, o2);
  assert.equal(r2.verifiedPaid.toFixed(2), o2.unpaid.toFixed(2), 'paid once, not twice');
  assert.equal(r2.unpaid.toFixed(2), '0.00');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o2.id, action: 'VERIFY_PAYMENT' } }), 1);

  // the SAME verifier twice on a fresh obligation: one applies, one replays, unpaid reduced once
  const extra = await seed.prisma.contractUnpaidObligation.create({
    data: { key: 'PT_NO_SHOW:fixture-conc:1', transactionId: o1.transactionId, kind: 'NO_SHOW', party: 'CLIENT', owed: 80000, paid: 0, unpaid: 80000 }, // TEST FIXTURE
  });
  const ex = { ...extra, unpaid: extra.unpaid } as unknown as Ob;
  await approveObligationPayment(approveIn(ex, { approvalRef: 'C-1' }));
  await submitObligationEvidence(submitIn(ex, { approvalRef: 'C-1' }));
  const both = await Promise.all([verifyObligationPayment(verifyIn(ex, { approvalRef: 'C-1' })), verifyObligationPayment(verifyIn(ex, { approvalRef: 'C-1' }))]);
  assert.deepEqual(both.map((r) => r.outcome).sort(), ['APPLIED', 'REPLAYED']);
  assert.equal((await row(seed, ex)).verifiedPaid.toFixed(2), '80000.00');
});

test('RESOLVED_OTHER needs a real reason; WAIVED stays; neither marks the obligation paid', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustObligation } = await adj();
  const [o1, o2] = seed.obligations;
  const m0 = await moneyCounts(seed);
  const mk = (o: Ob, action: 'RESOLVE_OTHER' | 'WAIVE', ref: string, note: string) => ({ ...cas(o), action, note, actor: 'owner-test', approvalRef: ref, dryRun: false });

  await assert.rejects(adjustObligation(mk(o1, 'RESOLVE_OTHER', 'RO-1', 'short')), code('INVALID_INPUT'));
  await assert.rejects(adjustObligation(mk(o1, 'RESOLVE_OTHER', 'RO-1', '   ')), code('INVALID_INPUT'));
  const dry = await adjustObligation({ ...mk(o1, 'RESOLVE_OTHER', 'RO-1', 'settled by a goodwill voucher agreed with the client'), dryRun: true });
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal((await row(seed, o1)).status, 'OPEN');
  const res = await adjustObligation(mk(o1, 'RESOLVE_OTHER', 'RO-1', 'settled by a goodwill voucher agreed with the client'));
  assert.equal(res.after.status, 'RESOLVED_OTHER');
  const r = await row(seed, o1);
  assert.equal(r.status, 'RESOLVED_OTHER');
  assert.equal(r.unpaid.toFixed(2), o1.unpaid.toFixed(2), 'not paid: the figure is kept as history');
  assert.equal(r.verifiedPaid.toFixed(2), '0.00');
  assert.equal(r.resolvedNote, 'settled by a goodwill voucher agreed with the client');
  assert.equal((await adjustObligation(mk(o1, 'RESOLVE_OTHER', 'RO-1', 'settled by a goodwill voucher agreed with the client'))).outcome, 'REPLAYED');
  await assert.rejects(adjustObligation(mk(o1, 'WAIVE', 'WV-9', 'owner changed his mind')), code('NOT_OPEN'));
  const ev = await seed.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId: o1.id } });
  assert.deepEqual(ev.map((e) => [e.action, e.fromStatus, e.toStatus]), [['RESOLVE_OTHER', 'OPEN', 'RESOLVED_OTHER']]);

  assert.equal((await adjustObligation(mk(o2, 'WAIVE', 'WV-1', 'owner decided not to pursue this one'))).after.status, 'WAIVED');
  assert.equal((await row(seed, o2)).verifiedPaid.toFixed(2), '0.00', 'a waiver is not a payment');
  assert.deepEqual(await moneyCounts(seed), m0);
});

test('LEGACY PAID_EXTERNALLY rows stay readable as "evidence recorded, NOT verified" and are never upgraded; the old operation is gone', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment } = await lc();
  const o = seed.obligations[0];
  // TEST FIXTURE: a row exactly as the FH-8 first cut left it (PAID_EXTERNALLY, unpaid 0, externally_paid set, legacy event).
  await seed.prisma.contractUnpaidObligation.update({
    where: { id: o.id },
    data: { status: 'PAID_EXTERNALLY', unpaid: 0, externallyPaid: o.unpaid, resolvedAt: new Date(), resolvedBy: 'ops-legacy', resolvedNote: 'legacy' },
  });
  await seed.prisma.contractUnpaidObligationEvent.create({
    data: {
      obligationId: o.id, action: 'PAY_EXTERNALLY', note: 'legacy typed-in reference', actor: 'ops-legacy', approvalRef: 'LEG-1', idempotencyKey: `OBLIGATION_PAY_EXTERNALLY:${o.id}:LEG-1`,
      fromStatus: 'OPEN', toStatus: 'PAID_EXTERNALLY', unpaid: o.unpaid, paidAmount: o.unpaid, transferReference: 'LEGACY-REF-1', paidOn: new Date('2026-10-19'), approvedBy: 'owner-legacy', unpaidAfter: 0,
    },
  });
  const r = await row(seed, o);
  assert.equal(r.status, 'PAID_EXTERNALLY');
  assert.equal(r.verifiedPaid.toFixed(2), '0.00', 'nothing verified it');
  assert.equal(await seed.prisma.contractUnpaidObligationPayment.count(), 0, 'no payment record was invented for it');
  await assert.rejects(approveObligationPayment(approveIn(o, { expectedUnpaid: '0.00' })), code('NOT_OPEN'));
  assert.equal((await row(seed, o)).status, 'PAID_EXTERNALLY', 'still unverified');

  // the removed operation cannot be called from the CLI
  const lines: string[] = [];
  const env = { DATABASE_URL: DB } as NodeJS.ProcessEnv;
  assert.equal(
    await runCli(['--op=obligation-pay-external', `--id=${o.id}`, '--expected-amount=1', '--expected-transaction-id=t', '--reason=typed in', '--approved-by=x', '--approval-ref=R', '--apply'], env, (l) => lines.push(l)),
    2,
  );
  assert.ok(lines.some((l) => l.includes('LEGACY_DISABLED')));
  assert.equal(typeof ((await adj()) as unknown as Record<string, unknown>).payObligationExternally, 'undefined');
});

test('REPORT over REAL HTTP: every state is its own group with history; "unverified" is distinct from "verified"; ADMIN 200, non-ADMIN 403, read-only', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence, verifyObligationPayment } = await lc();
  const { adjustObligation } = await adj();
  const [o1] = seed.obligations;
  const LONG_PAYER = 'client-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await seed.prisma.$executeRawUnsafe(`UPDATE payment_transactions SET payer_id = '${LONG_PAYER}' WHERE id = '${o1.transactionId}'`); // TEST FIXTURE: a realistic long id
  const mkFix = (k: string, n: number) => ({ key: `PT_NO_SHOW:fixture-${k}:1`, transactionId: o1.transactionId, kind: 'NO_SHOW' as const, party: 'CLIENT', owed: n, paid: 0, unpaid: n }); // TEST FIXTURE
  await seed.prisma.contractUnpaidObligation.createMany({ data: ['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k, i) => mkFix(k, 100000 + i * 10000)) });
  const all = (await seed.prisma.contractUnpaidObligation.findMany({ orderBy: [{ createdAt: 'asc' }, { key: 'asc' }] })) as unknown as Ob[];
  assert.equal(all.length, 9);
  const [open, review, approved, awaiting, verified, partial, legacy, waived, other] = all;
  const adjIn = (o: Ob, action: 'REVIEW' | 'WAIVE' | 'RESOLVE_OTHER', ref: string) => ({ ...cas(o), action, note: 'owner decision, see the minutes', actor: 'ops-test', approvalRef: ref, dryRun: false });
  const full = async (o: Ob, ref: string, upTo: 'approve' | 'submit' | 'verify', amount?: string) => {
    const amt = amount ?? o.unpaid.toFixed(2);
    await approveObligationPayment(approveIn(o, { approvalRef: ref, approvedAmount: amt }));
    if (upTo === 'approve') return;
    await submitObligationEvidence(submitIn(o, { approvalRef: ref, paidAmount: amt, transferReference: `FT-${ref}` }));
    if (upTo === 'submit') return;
    await verifyObligationPayment(verifyIn(o, { approvalRef: ref, observedAmount: amt, observedTransferReference: `FT-${ref}` }));
  };
  await adjustObligation(adjIn(review, 'REVIEW', 'R-REV'));
  await full(approved, 'R-APPR', 'approve');
  await full(awaiting, 'R-AWAIT', 'submit');
  await full(verified, 'R-VER', 'verify');
  await full(partial, 'R-PART', 'verify', '10000.00');
  await seed.prisma.contractUnpaidObligation.update({
    where: { id: legacy.id },
    data: { status: 'PAID_EXTERNALLY', unpaid: 0, externallyPaid: legacy.unpaid, resolvedAt: new Date(), resolvedBy: 'ops-legacy', resolvedNote: 'legacy' },
  }); // TEST FIXTURE: first-cut row
  await seed.prisma.contractUnpaidObligationEvent.create({
    data: { obligationId: legacy.id, action: 'PAY_EXTERNALLY', note: 'legacy typed-in reference', actor: 'ops-legacy', approvalRef: 'LEG-1', idempotencyKey: `OBLIGATION_PAY_EXTERNALLY:${legacy.id}:LEG-1`, fromStatus: 'OPEN', toStatus: 'PAID_EXTERNALLY', unpaid: legacy.unpaid, paidAmount: legacy.unpaid, transferReference: 'LEGACY-REF-1', paidOn: new Date('2026-10-19'), approvedBy: 'owner-legacy', unpaidAfter: 0 },
  });
  await adjustObligation(adjIn(waived, 'WAIVE', 'R-WV'));
  await adjustObligation({ ...adjIn(other, 'RESOLVE_OTHER', 'R-RO'), note: 'settled by another method agreed with the client' });
  const before = await tableCounts(seed.prisma);

  const get = (token?: string) => fetch(`${base}/admin/payments/obligations?limit=100`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('customer')).status, 403);
  assert.equal((await get()).status, 401);
  const res = await get('admin');
  assert.equal(res.status, 200);
  const rep = ((await res.json()) as any).data;
  const s = rep.summary.unpaidObligations;

  assert.equal(s.open.count, 2, 'open + the partially verified one');
  assert.equal(s.underReview.count, 1);
  assert.equal(s.approvedForPayment.count, 1);
  assert.equal(s.approvedForPayment.unpaid, approved.unpaid.toFixed(2), 'approved is still UNPAID');
  assert.equal(s.awaitingEvidence.count, 1);
  assert.equal(s.awaitingEvidence.unpaid, awaiting.unpaid.toFixed(2), 'recorded evidence is still UNPAID until verified');
  assert.equal(s.paidVerified.count, 1);
  assert.equal(s.paidVerified.amount, verified.unpaid.plus(10000).toFixed(2), 'everything verified, incl. the partial one');
  assert.equal(s.paidExternally.count, 1, 'legacy unverified, its own group');
  assert.equal(s.paidExternally.amount, legacy.unpaid.toFixed(2));
  assert.equal(s.waived.count, 1);
  assert.equal(s.resolvedOther.count, 1);
  assert.equal(s.resolved.count, 0);

  assert.deepEqual(rep.unpaidObligations.map((x: any) => x.id).sort(), [open.id, review.id, partial.id].sort(), 'OPEN + UNDER_REVIEW only');
  const rPartial = rep.unpaidObligations.find((x: any) => x.id === partial.id);
  assert.equal(rPartial.status, 'OPEN');
  assert.equal(rPartial.verifiedPaid, '10000.00');
  assert.equal(rPartial.unpaid, partial.unpaid.minus(10000).toFixed(2));
  assert.deepEqual(rPartial.history.map((h: any) => h.action), ['APPROVE_PAYMENT', 'SUBMIT_EVIDENCE', 'VERIFY_PAYMENT']);

  assert.deepEqual(rep.inFlightObligations.map((x: any) => x.id).sort(), [approved.id, awaiting.id].sort());
  const rAppr = rep.inFlightObligations.find((x: any) => x.id === approved.id);
  assert.equal(rAppr.status, 'APPROVED_FOR_PAYMENT');
  assert.equal(rAppr.pendingPayment.status, 'APPROVED');
  assert.equal(rAppr.pendingPayment.approvedBy, 'owner-test');
  assert.equal(rAppr.pendingPayment.paymentSource, 'MANUAL_BANK_TRANSFER');
  assert.equal(rAppr.pendingPayment.recipient, LONG_PAYER.slice(0, 8), 'recipient id is cut to 8 characters');
  assert.equal(rAppr.pendingPayment.transferReference, null);
  const rAwait = rep.inFlightObligations.find((x: any) => x.id === awaiting.id);
  assert.equal(rAwait.status, 'AWAITING_EVIDENCE');
  assert.equal(rAwait.pendingPayment.status, 'EVIDENCE_SUBMITTED');
  assert.equal(rAwait.pendingPayment.recordedBy, 'clerk-test');
  assert.equal(rAwait.pendingPayment.transferReference, 'FT-R-AWAIT');
  assert.equal(rAwait.pendingPayment.evidenceRef, 'evidence/2026/10/FT26293.pdf');
  assert.equal(rAwait.verifiedPaid, '0.00');
  assert.equal(rAwait.unpaid, awaiting.unpaid.toFixed(2));
  assert.deepEqual(rAwait.history.map((h: any) => h.action), ['APPROVE_PAYMENT', 'SUBMIT_EVIDENCE']);

  const closed = Object.fromEntries(rep.closedObligations.map((x: any) => [x.id, x]));
  assert.equal(rep.closedObligations.length, 4);
  assert.equal(closed[verified.id].status, 'PAID_VERIFIED');
  assert.equal(closed[verified.id].verifiedPaid, verified.unpaid.toFixed(2));
  assert.equal(closed[verified.id].externallyPaid, '0.00');
  const vEv = closed[verified.id].history.find((h: any) => h.action === 'VERIFY_PAYMENT');
  assert.equal(vEv.verifiedBy, 'auditor-test');
  assert.equal(vEv.actor, 'auditor-test');
  assert.equal(vEv.paymentSource, 'MANUAL_BANK_TRANSFER');
  assert.equal(vEv.recipient, `CLIENT:${LONG_PAYER.slice(0, 8)}`);
  assert.equal(closed[legacy.id].status, 'PAID_EXTERNALLY');
  assert.equal(closed[legacy.id].verifiedPaid, '0.00', 'legacy rows are NOT verified');
  assert.equal(closed[legacy.id].externallyPaid, legacy.unpaid.toFixed(2));
  assert.equal(closed[legacy.id].history[0].action, 'PAY_EXTERNALLY');
  assert.equal(closed[waived.id].status, 'WAIVED');
  assert.equal(closed[other.id].status, 'RESOLVED_OTHER');
  assert.equal(closed[other.id].history[0].note, 'settled by another method agreed with the client');

  const json = JSON.stringify(rep);
  assert.ok(!json.includes(LONG_PAYER), 'no full payer id anywhere in the report');
  assert.ok(!/payerId/.test(json));
  assert.equal(rep.truncated.inFlightObligations, false);
  assert.deepEqual(await tableCounts(seed.prisma), before, 'the report wrote nothing');
});

test('CLI: full lifecycle through scripts/fh8-adjust; dry-run is the default; four-eyes and evidence enforced; non-test DB refused; approver allow-list', skipOpts, async () => {
  seed = await seedBacklog();
  const lines: string[] = [];
  const out = () => lines.join('\n');
  const env = { DATABASE_URL: DB } as NodeJS.ProcessEnv;
  const o = seed.obligations[0];
  const half = o.unpaid.div(2).toFixed(2);
  const common = [`--id=${o.id}`, `--expected-amount=${o.unpaid.toFixed(2)}`, `--expected-transaction-id=${o.transactionId}`];
  const approve = [
    '--op=obligation-approve-payment', ...common, `--approved-amount=${half}`, '--payment-source=MANUAL_BANK_TRANSFER',
    '--reason=owner approved paying half now', '--approved-by=owner-test', '--approval-ref=CLI-AP',
  ];
  const submit = [
    '--op=obligation-submit-evidence', ...common, '--approval-ref=CLI-AP', `--paid-amount=${half}`, '--transfer-ref=FT-CLI-1', '--paid-on=2026-10-20',
    '--evidence-ref=evidence/cli-1.pdf', '--recorded-by=clerk-test', '--reason=receipt attached',
  ];
  const verify = [
    '--op=obligation-verify-payment', ...common, '--approval-ref=CLI-AP', '--verified-by=auditor-test', `--observed-amount=${half}`,
    '--observed-transfer-ref=FT-CLI-1', '--reason=matches the bank statement',
  ];

  // required flags
  assert.throws(() => parseArgs(approve.filter((a) => !a.startsWith('--payment-source'))), (e: any) => e.code === 'USAGE');
  assert.throws(() => parseArgs(submit.filter((a) => !a.startsWith('--recorded-by'))), (e: any) => e.code === 'USAGE');
  assert.throws(() => parseArgs(verify.filter((a) => !a.startsWith('--observed-amount'))), (e: any) => e.code === 'USAGE');
  assert.equal(await runCli(submit.filter((a) => !a.startsWith('--recorded-by')), env, (l) => lines.push(l)), 2);

  // dry-run default writes nothing; --apply writes
  const c0 = await tableCounts(seed.prisma);
  assert.equal(await runCli(approve, env, (l) => lines.push(l)), 0);
  assert.ok(out().includes('DRY-RUN') && out().includes('DRY_RUN'));
  assert.deepEqual(await tableCounts(seed.prisma), c0, 'default run wrote nothing');
  lines.length = 0;
  assert.equal(await runCli([...approve, '--payment-source=WALLET', '--apply'], env, (l) => lines.push(l)), 1, 'duplicate flag: the last one wins, and WALLET is refused as a source');
  assert.ok(out().includes('INVALID_SOURCE'));
  lines.length = 0;
  assert.equal(await runCli([...approve, '--apply'], env, (l) => lines.push(l)), 0);
  assert.ok(out().includes('APPLIED'));
  assert.equal((await row(seed, o)).status, 'APPROVED_FOR_PAYMENT');
  lines.length = 0;
  assert.equal(await runCli([...approve, '--apply'], env, (l) => lines.push(l)), 0);
  assert.ok(out().includes('REPLAYED'));

  // evidence without any proof pointer is refused
  lines.length = 0;
  assert.equal(await runCli([...submit.filter((a) => !a.startsWith('--evidence-ref')), '--apply'], env, (l) => lines.push(l)), 1);
  assert.ok(out().includes('EVIDENCE_REQUIRED'));
  lines.length = 0;
  assert.equal(await runCli([...submit, '--apply'], env, (l) => lines.push(l)), 0);
  assert.equal((await row(seed, o)).status, 'AWAITING_EVIDENCE');

  // same person cannot verify
  lines.length = 0;
  assert.equal(await runCli([...verify.map((a) => (a.startsWith('--verified-by') ? '--verified-by=Clerk-Test' : a)), '--apply'], env, (l) => lines.push(l)), 1);
  assert.ok(out().includes('SAME_PERSON'));
  lines.length = 0;
  assert.equal(await runCli([...verify, '--apply'], env, (l) => lines.push(l)), 0);
  const r = await row(seed, o);
  assert.equal(r.status, 'OPEN', 'a verified half is partial: back to OPEN');
  assert.equal(r.verifiedPaid.toFixed(2), half);
  assert.equal(r.unpaid.toFixed(2), o.unpaid.minus(half).toFixed(2));

  // cancel + resolve-other through the CLI
  const o2 = seed.obligations[1];
  const common2 = [`--id=${o2.id}`, `--expected-amount=${o2.unpaid.toFixed(2)}`, `--expected-transaction-id=${o2.transactionId}`];
  assert.equal(
    await runCli(['--op=obligation-approve-payment', ...common2, `--approved-amount=${o2.unpaid.toFixed(2)}`, '--payment-source=MANUAL_CASH', '--reason=cash handed over', '--approved-by=owner-test', '--approval-ref=CLI-AP2', '--apply'], env, (l) => lines.push(l)),
    0,
  );
  lines.length = 0;
  assert.equal(await runCli(['--op=obligation-cancel-approval', ...common2, '--approval-ref=CLI-AP2', '--cancelled-by=owner-test', '--reason=the client declined the cash', '--apply'], env, (l) => lines.push(l)), 0);
  assert.equal((await row(seed, o2)).status, 'OPEN');
  lines.length = 0;
  assert.equal(await runCli(['--op=obligation-resolve-other', ...common2, '--reason=short', '--approved-by=owner-test', '--approval-ref=CLI-RO', '--apply'], env, (l) => lines.push(l)), 1);
  assert.ok(out().includes('INVALID_INPUT'));
  lines.length = 0;
  assert.equal(await runCli(['--op=obligation-resolve-other', ...common2, '--reason=settled with a voucher agreed with the client', '--approved-by=owner-test', '--approval-ref=CLI-RO', '--apply'], env, (l) => lines.push(l)), 0);
  assert.equal((await row(seed, o2)).status, 'RESOLVED_OTHER');

  // authorised-approver allow-list (env) is enforced; a non-test database is refused before any query runs
  const o3 = await seed.prisma.contractUnpaidObligation.create({
    data: { key: 'PT_NO_SHOW:fixture-cli:1', transactionId: o.transactionId, kind: 'NO_SHOW', party: 'CLIENT', owed: 50000, paid: 0, unpaid: 50000 }, // TEST FIXTURE
  });
  const ap3 = ['--op=obligation-approve-payment', `--id=${o3.id}`, '--expected-amount=50000.00', `--expected-transaction-id=${o.transactionId}`, '--approved-amount=50000', '--payment-source=MANUAL_BANK_TRANSFER', '--reason=owner approved', '--approved-by=intruder', '--approval-ref=CLI-AP3', '--apply'];
  lines.length = 0;
  assert.equal(await runCli(ap3, { ...env, FH8_PAYOUT_APPROVERS: 'owner-test, other-owner' }, (l) => lines.push(l)), 1);
  assert.ok(out().includes('NOT_AUTHORISED'));
  const prodLike = DB!.replace(/_test(\?|$)/, '$1');
  lines.length = 0;
  assert.equal(await runCli(ap3, { ...env, DATABASE_URL: prodLike }, (l) => lines.push(l)), 2);
  assert.ok(out().includes('REFUSED_NON_TEST_DATABASE'));
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o3.id } })).status, 'OPEN');
});

test('DATABASE guards: payment records are never deleted, their terms are immutable, status only moves forward, one open payment per obligation, events stay append-only', skipOpts, async () => {
  seed = await seedBacklog();
  const { approveObligationPayment, submitObligationEvidence } = await lc();
  const o = seed.obligations[0];
  await approveObligationPayment(approveIn(o));
  const sql = (q: string) => seed!.prisma.$executeRawUnsafe(q);
  await assert.rejects(sql(`DELETE FROM contract_unpaid_obligation_payments`), /never deleted/i);
  await assert.rejects(sql(`UPDATE contract_unpaid_obligation_payments SET amount = 1`), /immutable/i);
  await assert.rejects(sql(`UPDATE contract_unpaid_obligation_payments SET payment_source = 'WALLET'`), /immutable/i);
  await assert.rejects(sql(`UPDATE contract_unpaid_obligation_payments SET recipient_id = 'someone-else'`), /immutable/i);
  await assert.rejects(sql(`UPDATE contract_unpaid_obligation_payments SET status = 'VERIFIED'`), /illegal payment status transition/i, 'cannot skip the evidence step');
  // a second open payment for the same obligation is impossible even by raw SQL
  await assert.rejects(
    sql(`INSERT INTO contract_unpaid_obligation_payments (id, obligation_id, approval_ref, amount, payment_source, recipient_party, approved_by) VALUES ('p2', '${o.id}', 'AP-2', 1, 'MANUAL_CASH', 'CLIENT', 'x')`),
    /already exists|23505|one_open_idx/i,
  );
  await submitObligationEvidence(submitIn(o));
  await assert.rejects(sql(`UPDATE contract_unpaid_obligation_payments SET status = 'APPROVED'`), /illegal payment status transition/i, 'status never moves backward');
  for (const q of [`UPDATE contract_unpaid_obligation_events SET actor='tampered'`, `DELETE FROM contract_unpaid_obligation_events`]) {
    await assert.rejects(sql(q), /append-only/i, q);
  }
  assert.equal((await seed.prisma.contractUnpaidObligationEvent.findFirstOrThrow({ where: { action: 'SUBMIT_EVIDENCE' } })).actor, 'clerk-test');
});
