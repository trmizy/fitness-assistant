/**
 * FH-8 (evidence) - obligation lifecycle OPEN / UNDER_REVIEW / PAID_EXTERNALLY (with evidence) / WAIVED / RESOLVED(legacy).
 * BACKEND INTEGRATION on a real ledger in a *_test database (money rows from the real ledger, see support/fh-backlog-seed.ts)
 * + REAL HTTP on the admin report to show the groups and the history.
 *
 * Nothing here may move money: every test compares the money tables (wallets, ledger entries, ledger operations, payment
 * transactions, partner receivables) before and after.
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_g3_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh8-obligation-evidence.integration.test.ts
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
process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:4059';
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
  await new Promise<void>((r) => authServer!.listen(4059, '127.0.0.1', r));
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

const svc = () => import('../services/adjustment-operations.service');

/** Money must never move: no wallet, ledger entry, ledger operation, transaction or receivable is written by any of these operations. */
const moneyCounts = async (s: Seed) => {
  const c = await tableCounts(s.prisma);
  return { wallets: c.wallets, entries: c.wallet_ledger_entries, ops: c.ledger_operations, txns: c.payment_transactions, receivables: c.partner_receivables, rev: c.partner_receivable_events };
};

type Ob = Seed['obligations'][number];
const payInput = (o: Ob, over: Record<string, unknown> = {}) => ({
  obligationId: o.id,
  expectedUnpaid: o.unpaid.toFixed(2),
  expectedTransactionId: o.transactionId,
  paidAmount: o.unpaid.toFixed(2),
  transferReference: 'FT26293-000123',
  paidOn: '2026-10-20',
  approvedBy: 'owner-test',
  approvalRef: 'PAY-1',
  recordedBy: 'ops-test',
  note: 'bank transfer to the client by finance',
  dryRun: false,
  ...over,
});

test('PAY_EXTERNALLY full: dry-run writes nothing; apply closes it with evidence; no money moves; no wallet credit; no PT debt', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const o = seed.obligations[0];
  const m0 = await moneyCounts(seed);
  const c0 = await tableCounts(seed.prisma);

  const dry = await payObligationExternally(payInput(o, { dryRun: true }));
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal(dry.after.status, 'PAID_EXTERNALLY');
  assert.equal(dry.after.unpaid, '0.00');
  assert.deepEqual(await tableCounts(seed.prisma), c0, 'dry-run wrote nothing');

  const applied = await payObligationExternally(payInput(o));
  assert.equal(applied.outcome, 'APPLIED');
  const row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(row.status, 'PAID_EXTERNALLY');
  assert.equal(row.unpaid.toFixed(2), '0.00');
  assert.equal(row.externallyPaid.toFixed(2), o.unpaid.toFixed(2));
  assert.equal(row.paid.toFixed(2), o.paid.toFixed(2), '`paid` still means paid by the ledger');
  assert.equal(row.owed.toFixed(2), o.owed.toFixed(2), 'history of what was owed is untouched');
  assert.ok(row.resolvedAt);
  assert.equal(row.resolvedBy, 'ops-test');

  const ev = await seed.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId: o.id } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].action, 'PAY_EXTERNALLY');
  assert.equal(ev[0].transferReference, 'FT26293-000123');
  assert.equal(ev[0].paidAmount!.toFixed(2), o.unpaid.toFixed(2));
  assert.equal(ev[0].paidOn!.toISOString().slice(0, 10), '2026-10-20');
  assert.equal(ev[0].approvedBy, 'owner-test');
  assert.equal(ev[0].approvalRef, 'PAY-1');
  assert.equal(ev[0].actor, 'ops-test');
  assert.equal(ev[0].unpaidAfter!.toFixed(2), '0.00');
  assert.equal(ev[0].fromStatus, 'OPEN');
  assert.equal(ev[0].toStatus, 'PAID_EXTERNALLY');

  assert.deepEqual(await moneyCounts(seed), m0, 'no wallet / ledger / receivable row was written');
  // the other obligation is untouched
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: seed.obligations[1].id } })).status, 'OPEN');
});

test('idempotent per approval ref: retry replays (one event); the same ref for a different payment is refused', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const o = seed.obligations[0];
  await payObligationExternally(payInput(o));
  const again = await payObligationExternally(payInput(o));
  assert.equal(again.outcome, 'REPLAYED');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 1);
  await assert.rejects(payObligationExternally(payInput(o, { transferReference: 'OTHER-REF-999' })), (e: any) => e.code === 'APPROVAL_REF_REUSED');
  await assert.rejects(payObligationExternally(payInput(o, { paidAmount: '1.00' })), (e: any) => e.code === 'APPROVAL_REF_REUSED');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 1);
  // a DIFFERENT approval on the now-closed row is refused by the state rule
  await assert.rejects(payObligationExternally(payInput(o, { approvalRef: 'PAY-2' })), (e: any) => e.code === 'CAS_MISMATCH' || e.code === 'NOT_OPEN');
});

test('CAS: stale unpaid amount / wrong transaction id are refused and nothing changes', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const o = seed.obligations[0];
  const c0 = await tableCounts(seed.prisma);
  await assert.rejects(payObligationExternally(payInput(o, { expectedUnpaid: '1.00' })), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(payObligationExternally(payInput(o, { expectedTransactionId: 'some-other-txn' })), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(payObligationExternally(payInput(o, { expectedUnpaid: 'abc' })), (e: any) => e.code === 'INVALID_INPUT');
  assert.deepEqual(await tableCounts(seed.prisma), c0);
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } })).status, 'OPEN');
});

test('evidence is mandatory and validated: amount, reference, date, approver, approval ref; overpayment refused', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const o = seed.obligations[0];
  const bad = (over: Record<string, unknown>, code: string) =>
    assert.rejects(payObligationExternally(payInput(o, over)), (e: any) => e.code === code, JSON.stringify(over));
  await bad({ paidAmount: '0' }, 'INVALID_INPUT');
  await bad({ paidAmount: '-5' }, 'INVALID_INPUT');
  await bad({ paidAmount: 'abc' }, 'INVALID_INPUT');
  await bad({ paidAmount: '10.123' }, 'INVALID_INPUT');
  await bad({ transferReference: '' }, 'INVALID_INPUT');
  await bad({ transferReference: 'ab' }, 'INVALID_INPUT');
  await bad({ paidOn: 'yesterday' }, 'INVALID_INPUT');
  await bad({ paidOn: '2099-01-01' }, 'INVALID_INPUT');
  await bad({ approvedBy: '' }, 'INVALID_INPUT');
  await bad({ approvalRef: '' }, 'INVALID_INPUT');
  await bad({ note: 'x' }, 'INVALID_INPUT');
  await bad({ paidAmount: o.unpaid.plus(1).toFixed(2) }, 'AMOUNT_EXCEEDS_UNPAID');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 0);
});

test('PARTIAL external payment: unpaid reduced, status stays OPEN, still listed as open; a second payment closes it', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const o = seed.obligations[0];
  const m0 = await moneyCounts(seed);
  const half = o.unpaid.div(2);

  const p1 = await payObligationExternally(payInput(o, { paidAmount: half.toFixed(2), approvalRef: 'PAY-A', transferReference: 'FT-PART-1' }));
  assert.equal(p1.outcome, 'APPLIED');
  assert.equal(p1.after.partial, true);
  let row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(row.status, 'OPEN', 'status stays OPEN');
  assert.equal(row.unpaid.toFixed(2), o.unpaid.minus(half).toFixed(2));
  assert.equal(row.externallyPaid.toFixed(2), half.toFixed(2));
  assert.equal(row.resolvedAt, null, 'not closed');

  // the next payment must CAS on the NEW unpaid amount: the old figure is stale
  await assert.rejects(payObligationExternally(payInput(o, { paidAmount: half.toFixed(2), approvalRef: 'PAY-B', transferReference: 'FT-PART-2' })), (e: any) => e.code === 'CAS_MISMATCH');
  const remaining = o.unpaid.minus(half);
  const p2 = await payObligationExternally(
    payInput(o, { expectedUnpaid: remaining.toFixed(2), paidAmount: remaining.toFixed(2), approvalRef: 'PAY-B', transferReference: 'FT-PART-2' }),
  );
  assert.equal(p2.after.status, 'PAID_EXTERNALLY');
  row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(row.status, 'PAID_EXTERNALLY');
  assert.equal(row.unpaid.toFixed(2), '0.00');
  assert.equal(row.externallyPaid.toFixed(2), o.unpaid.toFixed(2), 'two partial payments add up to the whole');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o.id } }), 2);
  assert.deepEqual(await moneyCounts(seed), m0);
});

test('CONCURRENT: two different approvals racing for the whole amount -> exactly one applies; the same approval twice -> one applies, one replays', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  const [o1, o2] = seed.obligations;

  const race = await Promise.allSettled([
    payObligationExternally(payInput(o1, { approvalRef: 'RACE-1', transferReference: 'FT-RACE-1' })),
    payObligationExternally(payInput(o1, { approvalRef: 'RACE-2', transferReference: 'FT-RACE-2' })),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one wins');
  const lost = race.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(['CAS_MISMATCH', 'NOT_OPEN', 'CONCURRENT_CHANGE'].includes(lost.reason.code), lost.reason.code);
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o1.id } }), 1);
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o1.id } })).externallyPaid.toFixed(2), o1.unpaid.toFixed(2), 'paid once, not twice');

  const same = await Promise.all([payObligationExternally(payInput(o2)), payObligationExternally(payInput(o2))]);
  assert.deepEqual(same.map((r) => r.outcome).sort(), ['APPLIED', 'REPLAYED']);
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: o2.id } }), 1);
});

test('REVIEW / RELEASE_REVIEW / WAIVE / legacy RESOLVE: UNDER_REVIEW can be paid (partial stays UNDER_REVIEW), waived or released', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustObligation, payObligationExternally } = await svc();
  const [o1, o2] = seed.obligations;
  const mk = (o: Ob, action: 'REVIEW' | 'RELEASE_REVIEW' | 'WAIVE' | 'RESOLVE', ref: string, over: Record<string, unknown> = {}) => ({
    obligationId: o.id, expectedUnpaid: o.unpaid.toFixed(2), expectedTransactionId: o.transactionId, action, note: 'looking into it with finance', actor: 'ops-test', approvalRef: ref, dryRun: false, ...over,
  });
  const m0 = await moneyCounts(seed);

  assert.equal((await adjustObligation(mk(o1, 'REVIEW', 'RV-1'))).after.status, 'UNDER_REVIEW');
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o1.id } })).resolvedAt, null);
  await assert.rejects(adjustObligation(mk(o1, 'REVIEW', 'RV-2')), (e: any) => e.code === 'NOT_OPEN', 'already under review');
  assert.equal((await adjustObligation(mk(o1, 'REVIEW', 'RV-1'))).outcome, 'REPLAYED');

  const partial = await payObligationExternally(payInput(o1, { paidAmount: '1000.00', approvalRef: 'PAY-UR', transferReference: 'FT-UR-1' }));
  assert.equal(partial.after.status, 'UNDER_REVIEW', 'a partial payment does not change the status');
  const left = o1.unpaid.minus(1000);
  assert.equal((await adjustObligation(mk(o1, 'RELEASE_REVIEW', 'RV-3', { expectedUnpaid: left.toFixed(2) }))).after.status, 'OPEN');
  await assert.rejects(adjustObligation(mk(o1, 'RELEASE_REVIEW', 'RV-4', { expectedUnpaid: left.toFixed(2) })), (e: any) => e.code === 'NOT_OPEN');

  await adjustObligation(mk(o2, 'REVIEW', 'RV-5'));
  const w = await adjustObligation(mk(o2, 'WAIVE', 'WV-1'));
  assert.equal(w.after.status, 'WAIVED');
  const row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o2.id } });
  assert.equal(row.unpaid.toFixed(2), o2.unpaid.toFixed(2), 'waived keeps the figure as history: the client was NOT paid');
  assert.equal(row.externallyPaid.toFixed(2), '0.00');

  assert.deepEqual(await moneyCounts(seed), m0);
});

test('REPORT: open / under review / paid externally / waived are separate groups with history; ADMIN 200, non-ADMIN 403, read-only', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustObligation, payObligationExternally } = await svc();
  // 4 obligations: paid fully, paid partially (stays open), waived, under review. Make two more from the seed's two + fixtures.
  const [o1] = seed.obligations;
  const { Prisma } = seed;
  const extra = await seed.prisma.contractUnpaidObligation.createMany({
    data: [
      { key: 'PT_NO_SHOW:fixture-x:1', transactionId: o1.transactionId, kind: 'NO_SHOW', party: 'CLIENT', owed: new Prisma.Decimal(100000), paid: new Prisma.Decimal(0), unpaid: new Prisma.Decimal(100000) }, // TEST FIXTURE
      { key: 'PT_NO_SHOW:fixture-y:1', transactionId: o1.transactionId, kind: 'NO_SHOW', party: 'CLIENT', owed: new Prisma.Decimal(60000), paid: new Prisma.Decimal(0), unpaid: new Prisma.Decimal(60000) }, // TEST FIXTURE
    ],
  });
  assert.equal(extra.count, 2);
  const all = await seed.prisma.contractUnpaidObligation.findMany({ orderBy: { createdAt: 'asc' } });
  const [a, b, c, d] = all;
  const mk = (o: (typeof all)[number], action: 'REVIEW' | 'WAIVE', ref: string) => ({
    obligationId: o.id, expectedUnpaid: o.unpaid.toFixed(2), expectedTransactionId: o.transactionId, action, note: 'owner decision, see minutes', actor: 'ops-test', approvalRef: ref, dryRun: false,
  });
  const pay = (o: (typeof all)[number], amount: string, ref: string) => ({
    obligationId: o.id, expectedUnpaid: o.unpaid.toFixed(2), expectedTransactionId: o.transactionId, paidAmount: amount, transferReference: `FT-${ref}`, paidOn: '2026-10-19',
    approvedBy: 'owner-test', approvalRef: ref, note: 'finance paid the client', dryRun: false,
  });
  await payObligationExternally(pay(a, a.unpaid.toFixed(2), 'R-A')); // full
  await payObligationExternally(pay(b, '10000.00', 'R-B')); // partial -> stays OPEN
  await adjustObligation(mk(c, 'WAIVE', 'R-C'));
  await adjustObligation(mk(d, 'REVIEW', 'R-D'));
  const before = await tableCounts(seed.prisma);

  const get = (token?: string) => fetch(`${base}/admin/payments/obligations?limit=100`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('customer')).status, 403);
  assert.equal((await get()).status, 401);
  const res = await get('admin');
  assert.equal(res.status, 200);
  const r = ((await res.json()) as any).data;
  const s = r.summary.unpaidObligations;

  assert.equal(s.open.count, 1, 'only the partially paid one is OPEN');
  assert.equal(s.underReview.count, 1);
  assert.equal(s.paidExternally.count, 1);
  assert.equal(s.waived.count, 1);
  assert.equal(s.resolved.count, 0);
  assert.equal(s.paidExternally.amount, (Number(a.unpaid) + 10000).toFixed(2), 'everything paid outside, incl. the partial payment');
  assert.equal(s.waived.unpaid, c.unpaid.toFixed(2));
  assert.equal(s.open.unpaid, b.unpaid.minus(10000).toFixed(2));

  const openIds = r.unpaidObligations.map((x: any) => x.id).sort();
  assert.deepEqual(openIds, [b.id, d.id].sort(), 'open list = OPEN + UNDER_REVIEW, in the report with its status');
  const rowB = r.unpaidObligations.find((x: any) => x.id === b.id);
  assert.equal(rowB.status, 'OPEN');
  assert.equal(rowB.externallyPaid, '10000.00');
  assert.equal(rowB.unpaid, b.unpaid.minus(10000).toFixed(2));
  assert.equal(rowB.history.length, 1);
  assert.equal(rowB.history[0].action, 'PAY_EXTERNALLY');
  assert.equal(rowB.history[0].transferReference, 'FT-R-B');
  assert.equal(rowB.history[0].paidAmount, '10000.00');
  assert.equal(r.unpaidObligations.find((x: any) => x.id === d.id).status, 'UNDER_REVIEW');

  const closed = Object.fromEntries(r.closedObligations.map((x: any) => [x.id, x]));
  assert.equal(closed[a.id].status, 'PAID_EXTERNALLY');
  assert.equal(closed[a.id].history[0].approvedBy, 'owner-test');
  assert.equal(closed[a.id].history[0].approvalRef, 'R-A');
  assert.equal(closed[a.id].history[0].paidOn.slice(0, 10), '2026-10-19');
  assert.equal(closed[c.id].status, 'WAIVED');
  assert.equal(closed[c.id].history[0].action, 'WAIVE');
  assert.equal(closed[c.id].history[0].paidAmount, null, 'a waiver carries no payment evidence');
  assert.equal(r.closedObligations.length, 2);

  assert.ok(!/payerId|client-A/.test(JSON.stringify(r)), 'no payer ids');
  assert.deepEqual(await tableCounts(seed.prisma), before, 'the report wrote nothing');
});

test('CLI: pay-external needs the evidence flags; dry-run default; --apply writes; retry replays; partial through the CLI', skipOpts, async () => {
  seed = await seedBacklog();
  const lines: string[] = [];
  const env = { DATABASE_URL: DB } as NodeJS.ProcessEnv;
  const o = seed.obligations[0];
  const base = [
    '--op=obligation-pay-external', `--id=${o.id}`, `--expected-amount=${o.unpaid.toFixed(2)}`, `--expected-transaction-id=${o.transactionId}`,
    '--reason=finance paid the client', '--approved-by=owner-test', '--approval-ref=CLI-PAY',
  ];
  // evidence flags are required
  assert.throws(() => parseArgs(base), (e: any) => e.code === 'USAGE');
  assert.equal(await runCli(base, env, (l) => lines.push(l)), 2);
  const full = [...base, '--transfer-ref=FT-CLI-1', `--paid-amount=${o.unpaid.div(4).toFixed(2)}`, '--paid-on=2026-10-20'];

  const c0 = await tableCounts(seed.prisma);
  lines.length = 0;
  assert.equal(await runCli(full, env, (l) => lines.push(l)), 0);
  assert.ok(lines.some((l) => l.startsWith('DRY-RUN')) && lines.some((l) => l.startsWith('DRY_RUN')));
  assert.deepEqual(await tableCounts(seed.prisma), c0, 'default run wrote nothing');

  lines.length = 0;
  assert.equal(await runCli([...full, '--apply'], env, (l) => lines.push(l)), 0);
  assert.ok(lines.some((l) => l.startsWith('APPLIED')));
  const row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(row.status, 'OPEN', 'a quarter paid is partial');
  assert.equal(row.externallyPaid.toFixed(2), o.unpaid.div(4).toFixed(2));

  lines.length = 0;
  assert.equal(await runCli([...full, '--apply'], env, (l) => lines.push(l)), 0);
  assert.ok(lines.some((l) => l.startsWith('REPLAYED')));
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 1);

  // review through the CLI
  lines.length = 0;
  const left = o.unpaid.minus(o.unpaid.div(4));
  assert.equal(
    await runCli(['--op=obligation-review', `--id=${o.id}`, `--expected-amount=${left.toFixed(2)}`, `--expected-transaction-id=${o.transactionId}`, '--reason=checking the bank statement', '--approved-by=ops-test', '--approval-ref=CLI-RV', '--apply'], env, (l) => lines.push(l)),
    0,
  );
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } })).status, 'UNDER_REVIEW');
});

test('append-only still holds for the evidence columns: UPDATE/DELETE on events are rejected by the database', skipOpts, async () => {
  seed = await seedBacklog();
  const { payObligationExternally } = await svc();
  await payObligationExternally(payInput(seed.obligations[0]));
  for (const sql of [`UPDATE contract_unpaid_obligation_events SET transfer_reference='tampered'`, `DELETE FROM contract_unpaid_obligation_events`]) {
    await assert.rejects(seed.prisma.$executeRawUnsafe(sql), /append-only/i, sql);
  }
  assert.equal((await seed.prisma.contractUnpaidObligationEvent.findFirstOrThrow()).transferReference, 'FT26293-000123');
});
