/**
 * FH-8 - audited adjustment operations + CLI + inventory. BACKEND INTEGRATION on a real ledger in a *_test database
 * (money rows from the real ledger; legacy receivables / negative sub-ledger are TEST FIXTURE rows, see support/fh-backlog-seed.ts).
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_fhf_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test src/__tests__/fh8-adjustments.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestDatabaseUrl } from './support/test-db-guard';
import { seedBacklog, tableCounts } from './support/fh-backlog-seed';
import { assertDatabaseAllowed, parseArgs, runCli } from '../services/adjustment-cli';
import { AdjustmentError } from '../services/adjustment-operations.service';

const DB = process.env.DATABASE_URL;
const skipOpts = { skip: isTestDatabaseUrl(DB) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Seed = Awaited<ReturnType<typeof seedBacklog>>;
let seed: Seed | undefined;
test.after(async () => {
  if (seed) await seed.prisma.$disconnect();
});

async function ops() {
  return import('../services/adjustment-operations.service');
}
const audit = { reason: 'platform bears this one (FHF test)', approvedBy: 'owner-test', approvalRef: 'APR-1' };

/** The money tables must never move: no wallet, ledger entry or ledger_operations row is written by any adjustment. */
const moneyCounts = async (s: Seed) => {
  const c = await tableCounts(s.prisma);
  return { wallets: c.wallets, entries: c.wallet_ledger_entries, ops: c.ledger_operations, txns: c.payment_transactions };
};

test('receivable SUSPEND: dry-run writes nothing; apply suspends one row only; replay is a no-op; history kept', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable } = await ops();
  const m0 = await moneyCounts(seed);
  const input = {
    receivableId: seed.recA.id, expectedAmount: '70000.00', expectedTransactionId: seed.A.txn.id, action: 'SUSPEND' as const, ...audit,
  };

  const counts0 = await tableCounts(seed.prisma);
  const dry = await adjustReceivable({ ...input, dryRun: true });
  assert.equal(dry.outcome, 'DRY_RUN');
  assert.equal(dry.after.suspended, true);
  assert.deepEqual(await tableCounts(seed.prisma), counts0, 'dry-run wrote nothing');
  assert.equal((await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recA.id } })).suspendedAt, null);

  const applied = await adjustReceivable({ ...input, dryRun: false });
  assert.equal(applied.outcome, 'APPLIED');
  const row = await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recA.id } });
  assert.ok(row.suspendedAt);
  assert.equal(row.suspendedBy, 'owner-test');
  assert.equal(row.suspensionRef, 'APR-1');
  assert.equal(row.recovered.toFixed(2), '0.00', 'recovered untouched');
  assert.equal(row.settledAt, null, 'NOT marked paid / settled');
  assert.equal(row.amount.toFixed(2), '70000.00', 'amount untouched');
  // the other receivables of the same PT are untouched
  assert.equal((await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recB.id } })).suspendedAt, null);

  const events = await seed.prisma.partnerReceivableEvent.findMany();
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'SUSPEND');
  assert.equal(events[0].idempotencyKey, `RECEIVABLE_SUSPEND:${seed.recA.id}:APR-1`);
  assert.equal((events[0].beforeJson as any).suspended, false);
  assert.equal((events[0].afterJson as any).suspended, true);

  const again = await adjustReceivable({ ...input, dryRun: false });
  assert.equal(again.outcome, 'REPLAYED');
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1, 'one event, not two');

  // a DIFFERENT approval on an already-suspended row is refused by the state rule, not silently stacked
  await assert.rejects(adjustReceivable({ ...input, approvalRef: 'APR-2', dryRun: false }), (e: any) => e.code === 'ALREADY_SUSPENDED');
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);

  assert.deepEqual(await moneyCounts(seed), m0, 'no money moved');
});

test('CAS: stale amount, wrong transaction, unknown row are refused and nothing is written', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable, adjustObligation } = await ops();
  const before = await tableCounts(seed.prisma);
  const base = { receivableId: seed.recA.id, expectedTransactionId: seed.A.txn.id, action: 'SUSPEND' as const, ...audit, dryRun: false };
  await assert.rejects(adjustReceivable({ ...base, expectedAmount: '69999.99' }), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(adjustReceivable({ ...base, expectedAmount: '70000.00', expectedTransactionId: seed.B.txn.id }), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(adjustReceivable({ ...base, expectedAmount: '70000.00', expectedTransactionId: 'NONE' }), (e: any) => e.code === 'CAS_MISMATCH');
  await assert.rejects(adjustReceivable({ ...base, receivableId: 'nope', expectedAmount: '70000.00' }), (e: any) => e.code === 'NOT_FOUND');
  // input validation: an empty approval reference / reason is not an approval
  await assert.rejects(adjustReceivable({ ...base, expectedAmount: '70000.00', approvalRef: ' ' }), (e: any) => e.code === 'INVALID_INPUT');
  await assert.rejects(adjustReceivable({ ...base, expectedAmount: '70000.00', reason: 'x' }), (e: any) => e.code === 'INVALID_INPUT');
  const o = seed.obligations[0];
  await assert.rejects(
    adjustObligation({ obligationId: o.id, expectedUnpaid: '1.00', expectedTransactionId: o.transactionId, action: 'RESOLVE', note: 'handled elsewhere', actor: 'owner', approvalRef: 'OB-1', dryRun: false }),
    (e: any) => e.code === 'CAS_MISMATCH',
  );
  assert.deepEqual(await tableCounts(seed.prisma), before);
});

test('receivable RESUME restores collection state; RESUME of a non-suspended row is refused', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable } = await ops();
  // recS is created suspended by the fixture
  const base = { receivableId: seed.recS.id, expectedAmount: '20000.00', expectedTransactionId: seed.A.txn.id, ...audit };
  const r = await adjustReceivable({ ...base, action: 'RESUME', approvalRef: 'APR-R', dryRun: false });
  assert.equal(r.outcome, 'APPLIED');
  const row = await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recS.id } });
  assert.equal(row.suspendedAt, null);
  assert.equal(row.suspensionRef, null);
  assert.equal(row.recovered.toFixed(2), '0.00');
  await assert.rejects(adjustReceivable({ ...base, action: 'RESUME', approvalRef: 'APR-R2', dryRun: false }), (e: any) => e.code === 'NOT_SUSPENDED');
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);
});

test('receivable WAIVE: partial keeps it open, over-waive refused, full waive closes it WITHOUT touching recovered', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable } = await ops();
  const m0 = await moneyCounts(seed);
  const base = { receivableId: seed.recA.id, expectedAmount: '70000.00', expectedTransactionId: seed.A.txn.id, action: 'WAIVE' as const, ...audit };

  await assert.rejects(adjustReceivable({ ...base, waiveAmount: '70000.01', dryRun: false }), (e: any) => e.code === 'WAIVE_EXCEEDS_OUTSTANDING');
  await assert.rejects(adjustReceivable({ ...base, waiveAmount: '0', dryRun: false }), (e: any) => e.code === 'INVALID_INPUT');
  await assert.rejects(adjustReceivable({ ...base, waiveAmount: 'abc', dryRun: false }), (e: any) => e.code === 'INVALID_INPUT');

  const part = await adjustReceivable({ ...base, waiveAmount: '20000', approvalRef: 'W-1', dryRun: false });
  assert.equal(part.outcome, 'APPLIED');
  let row = await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recA.id } });
  assert.equal(row.waived.toFixed(2), '20000.00');
  assert.equal(row.settledAt, null, 'still open: 50.000 outstanding');
  assert.equal(row.recovered.toFixed(2), '0.00');
  assert.equal(part.after.outstanding, '50000.00');

  // the rest, with a second approval; exceeding is judged against the NEW outstanding
  await assert.rejects(adjustReceivable({ ...base, waiveAmount: '50000.01', approvalRef: 'W-2', dryRun: false }), (e: any) => e.code === 'WAIVE_EXCEEDS_OUTSTANDING');
  const full = await adjustReceivable({ ...base, waiveAmount: '50000', approvalRef: 'W-2', dryRun: false });
  assert.equal(full.outcome, 'APPLIED');
  row = await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recA.id } });
  assert.equal(row.waived.toFixed(2), '70000.00');
  assert.equal(row.recovered.toFixed(2), '0.00', 'never marked as paid by the partner');
  assert.ok(row.settledAt, 'closed');
  assert.equal(row.waiveRef, 'W-2');
  await assert.rejects(adjustReceivable({ ...base, waiveAmount: '1', approvalRef: 'W-3', dryRun: false }), (e: any) => e.code === 'ALREADY_SETTLED');

  const events = await seed.prisma.partnerReceivableEvent.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(events.map((e) => [e.action, e.amount.toFixed(2)]), [['WAIVE', '20000.00'], ['WAIVE', '50000.00']]);
  assert.deepEqual(await moneyCounts(seed), m0, 'no wallet, ledger entry or ledger_operation written');
});

test('concurrent identical applies: exactly one APPLIED, the rest REPLAYED, one event', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable } = await ops();
  const input = {
    receivableId: seed.recB.id, expectedAmount: '30000.00', expectedTransactionId: seed.A.txn.id, action: 'SUSPEND' as const, ...audit, dryRun: false,
  };
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => adjustReceivable(input)));
  const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value.outcome : `ERR:${(r.reason as any).code}`));
  assert.equal(outcomes.filter((o) => o === 'APPLIED').length, 1, JSON.stringify(outcomes));
  assert.ok(outcomes.every((o) => o === 'APPLIED' || o === 'REPLAYED'), JSON.stringify(outcomes));
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);
});

test('event tables are append-only at the database level (UPDATE and DELETE are rejected)', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustReceivable, adjustObligation } = await ops();
  await adjustReceivable({ receivableId: seed.recA.id, expectedAmount: '70000.00', expectedTransactionId: seed.A.txn.id, action: 'SUSPEND', ...audit, dryRun: false });
  const o = seed.obligations[0];
  await adjustObligation({ obligationId: o.id, expectedUnpaid: o.unpaid.toFixed(2), expectedTransactionId: o.transactionId, action: 'RESOLVE', note: 'refunded outside the ledger', actor: 'owner', approvalRef: 'OB-1', dryRun: false });
  for (const sql of [
    `UPDATE partner_receivable_events SET reason='x'`,
    `DELETE FROM partner_receivable_events`,
    `UPDATE contract_unpaid_obligation_events SET note='x'`,
    `DELETE FROM contract_unpaid_obligation_events`,
  ]) {
    await assert.rejects(seed.prisma.$executeRawUnsafe(sql), /append-only/);
  }
  // and the parent rows cannot be deleted while history points at them
  await assert.rejects(seed.prisma.$executeRawUnsafe(`DELETE FROM partner_receivables WHERE id='${seed.recA.id}'`));
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 1);
});

test('obligation RESOLVE / WAIVE: status + event only, CAS, idempotent, no money movement', skipOpts, async () => {
  seed = await seedBacklog();
  const { adjustObligation } = await ops();
  const m0 = await moneyCounts(seed);
  const [o1, o2] = seed.obligations;
  const mk = (o: typeof o1, action: 'RESOLVE' | 'WAIVE', ref: string, dryRun: boolean) => ({
    obligationId: o.id, expectedUnpaid: o.unpaid.toFixed(2), expectedTransactionId: o.transactionId, action, note: 'owner decision, see minutes', actor: 'owner-test', approvalRef: ref, dryRun,
  });

  const counts0 = await tableCounts(seed.prisma);
  assert.equal((await adjustObligation(mk(o1, 'RESOLVE', 'OB-1', true))).outcome, 'DRY_RUN');
  assert.deepEqual(await tableCounts(seed.prisma), counts0, 'dry-run wrote nothing');

  const a = await adjustObligation(mk(o1, 'RESOLVE', 'OB-1', false));
  assert.equal(a.outcome, 'APPLIED');
  const row = await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o1.id } });
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.resolvedBy, 'owner-test');
  assert.equal(row.resolvedNote, 'owner decision, see minutes');
  assert.ok(row.resolvedAt);
  assert.equal(row.unpaid.toFixed(2), o1.unpaid.toFixed(2), 'amounts are history: untouched');
  assert.equal((await adjustObligation(mk(o1, 'RESOLVE', 'OB-1', false))).outcome, 'REPLAYED');
  await assert.rejects(adjustObligation(mk(o1, 'WAIVE', 'OB-2', false)), (e: any) => e.code === 'NOT_OPEN');

  assert.equal((await adjustObligation(mk(o2, 'WAIVE', 'OB-3', false))).outcome, 'APPLIED');
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o2.id } })).status, 'WAIVED');
  assert.equal(await seed.prisma.contractUnpaidObligationEvent.count(), 2);
  assert.equal(await seed.prisma.contractUnpaidObligation.count({ where: { status: 'OPEN' } }), 0);
  assert.deepEqual(await moneyCounts(seed), m0, 'no money moved');
});

test('CLI: dry-run is the default and writes nothing; --apply writes; second --apply replays; stale amount refused', skipOpts, async () => {
  seed = await seedBacklog();
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  const env = { DATABASE_URL: DB } as NodeJS.ProcessEnv;
  const argv = (extra: string[] = []) => [
    '--op=receivable-suspend', `--id=${seed!.recA.id}`, '--expected-amount=70000.00', `--expected-transaction-id=${seed!.A.txn.id}`,
    '--reason=owner approved pause', '--approved-by=owner-test', '--approval-ref=APR-CLI', ...extra,
  ];
  const before = await tableCounts(seed.prisma);

  assert.equal(await runCli(argv(), env, log), 0);
  assert.ok(lines.some((l) => l.startsWith('DRY-RUN')));
  assert.ok(lines.some((l) => l.startsWith('DRY_RUN')));
  assert.deepEqual(await tableCounts(seed.prisma), before, 'default run wrote nothing');

  lines.length = 0;
  assert.equal(await runCli(argv(['--apply']), env, log), 0);
  assert.ok(lines.some((l) => l.startsWith('APPLY')));
  assert.ok(lines.some((l) => l.startsWith('APPLIED')));
  assert.ok((await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recA.id } })).suspendedAt);

  lines.length = 0;
  assert.equal(await runCli(argv(['--apply']), env, log), 0);
  assert.ok(lines.some((l) => l.startsWith('REPLAYED')));
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);

  lines.length = 0;
  const stale = argv(['--apply']).map((a) => (a.startsWith('--expected-amount') ? '--expected-amount=69000.00' : a.startsWith('--approval-ref') ? '--approval-ref=APR-OTHER' : a));
  assert.equal(await runCli(stale, env, log), 1);
  assert.ok(lines.some((l) => l.includes('CAS_MISMATCH')));
  assert.equal(await seed.prisma.partnerReceivableEvent.count(), 1);
});

test('CLI: obligation and waive operations through the command line', skipOpts, async () => {
  seed = await seedBacklog();
  const lines: string[] = [];
  const env = { DATABASE_URL: DB } as NodeJS.ProcessEnv;
  const o = seed.obligations[0];
  assert.equal(
    await runCli(['--op=obligation-waive', `--id=${o.id}`, `--expected-amount=${o.unpaid.toFixed(2)}`, `--expected-transaction-id=${o.transactionId}`, '--reason=owner decided not to pursue', '--approved-by=owner-test', '--approval-ref=CLI-OB', '--apply'], env, (l) => lines.push(l)),
    0,
  );
  assert.equal((await seed.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: o.id } })).status, 'WAIVED');
  assert.equal(
    await runCli(['--op=receivable-waive', `--id=${seed.recB.id}`, '--expected-amount=30000.00', `--expected-transaction-id=${seed.A.txn.id}`, '--amount=30000', '--reason=platform bears it', '--approved-by=owner-test', '--approval-ref=CLI-W', '--apply'], env, (l) => lines.push(l)),
    0,
  );
  const rb = await seed.prisma.partnerReceivable.findUniqueOrThrow({ where: { id: seed.recB.id } });
  assert.equal(rb.waived.toFixed(2), '30000.00');
  assert.equal(rb.recovered.toFixed(2), '0.00');
});

test('inventory: counts and amounts only, matches the seeded backlog, writes nothing, contains no ids', skipOpts, async () => {
  seed = await seedBacklog();
  const { buildInventory, formatInventory } = await import('../services/obligations-inventory');
  const before = await tableCounts(seed.prisma);
  const inv = await buildInventory({ staleMinutes: 30, databaseUrl: DB });
  assert.equal(inv.database, new URL(DB ?? '').pathname.slice(1));
  assert.equal(inv.negativeSubledgers.count, 1);
  assert.equal(inv.negativeSubledgers.unbackedTotal, '50000.00');
  assert.deepEqual(inv.negativeSubledgers.byOwnerType, [{ label: 'PT', count: 1, amount: '50000.00' }]);
  assert.equal(inv.walletLedgerMismatches.nonEscrow, 1);
  const origin = (o: string, s: string) => inv.receivablesByOrigin.find((r) => r.origin === o && r.state === s);
  assert.equal(origin('NO_SHOW', 'ACTIVE')?.outstanding, '70000.00');
  assert.equal(origin('REFUND_SHORTFALL', 'ACTIVE')?.outstanding, '30000.00');
  assert.equal(origin('REFERRAL_CLAWBACK', 'SUSPENDED')?.outstanding, '20000.00');
  assert.equal(inv.fronted.total, '120000.00');
  assert.deepEqual(inv.stuckPaid.map((g) => [g.label, g.count]), [['PT_CONTRACT / ACTIVATION_FAILED', 1]]);
  assert.deepEqual(inv.unpaidObligations.map((o) => [o.kind, o.status, o.count]), [['NO_SHOW', 'OPEN', 2]]);
  assert.deepEqual(inv.nonContractPending.map((g) => [g.label, g.count, g.amount]), [['GYM_MEMBERSHIP', 1, '450000.00']]);
  assert.deepEqual(await tableCounts(seed.prisma), before, 'read-only');

  const text = formatInventory(inv).join('\n');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), 'no uuid in the report');
  assert.ok(!text.includes('postgresql://') && !text.includes('gymcoach_test_password'), 'no connection string or secret');
  assert.ok(!text.includes('pt-fhf') && !text.includes('client-'), 'no partner / client identity');
});

// ───────────────────────────────────────────── pure tests (no database needed) ──

test('CLI guard: a database whose name does not end with _test is refused unless --i-have-owner-approval=<group> is given', async () => {
  const real = 'postgresql://gymcoach_test:gymcoach_test_password@localhost:5432/gymcoach_payment?schema=public';
  assert.throws(() => assertDatabaseAllowed(real, null), (e: any) => e instanceof AdjustmentError && e.code === 'REFUSED_NON_TEST_DATABASE');
  // the credential or a query string that merely contains "_test" must not satisfy the guard
  assert.throws(() => assertDatabaseAllowed('postgresql://gymcoach_test:x@localhost:5432/gymcoach_payment?schema=foo_test', null), (e: any) => e.code === 'REFUSED_NON_TEST_DATABASE');
  assert.throws(() => assertDatabaseAllowed(undefined, null), (e: any) => e.code === 'NO_DATABASE');
  assert.throws(() => assertDatabaseAllowed(real, 'bad group!'), (e: any) => e.code === 'REFUSED_NON_TEST_DATABASE');
  assert.doesNotThrow(() => assertDatabaseAllowed(real, 'C'));
  assert.doesNotThrow(() => assertDatabaseAllowed('postgresql://u:p@localhost:5/gymcoach_payment_fhf_test?schema=public', null));
});

test('CLI refuses a non-_test database end to end: exit 2, nothing is run', async () => {
  const lines: string[] = [];
  const code = await runCli(
    ['--op=receivable-suspend', '--id=x', '--expected-amount=1', '--expected-transaction-id=NONE', '--reason=because', '--approved-by=me', '--approval-ref=A1', '--apply'],
    { DATABASE_URL: 'postgresql://u:p@localhost:5432/gymcoach_payment?schema=public' } as NodeJS.ProcessEnv,
    (l) => lines.push(l),
  );
  assert.equal(code, 2);
  assert.ok(lines[0].startsWith('REFUSED [REFUSED_NON_TEST_DATABASE]'));
  assert.ok(!lines.some((l) => l.startsWith('APPLY') || l.startsWith('DRY')), 'it never got as far as announcing a run');
});

test('CLI argument parsing: required flags, unknown flags and unknown operations are usage errors; apply is opt-in', async () => {
  const ok = ['--op=obligation-resolve', '--id=i', '--expected-amount=5', '--expected-transaction-id=t', '--reason=done elsewhere', '--approved-by=o', '--approval-ref=R'];
  assert.equal(parseArgs(ok).apply, false, 'dry-run by default');
  assert.equal(parseArgs([...ok, '--apply']).apply, true);
  assert.equal(parseArgs([...ok, '--i-have-owner-approval=C']).ownerApprovalGroup, 'C');
  assert.throws(() => parseArgs(ok.filter((a) => !a.startsWith('--approval-ref'))), (e: any) => e.code === 'USAGE');
  assert.throws(() => parseArgs([...ok, '--force']), (e: any) => e.code === 'USAGE');
  assert.throws(() => parseArgs(['--op=delete-everything', ...ok.slice(1)]), (e: any) => e.code === 'USAGE');
  assert.throws(() => parseArgs(['--op=receivable-waive', ...ok.slice(1)]), (e: any) => e.code === 'USAGE', 'waive needs --amount');
});

test('planReceivableChange is a pure decision: state rules without a database', async () => {
  const { planReceivableChange } = await ops();
  const { Prisma } = await import('../generated/prisma');
  const D = (v: string) => new Prisma.Decimal(v);
  const row = { id: 'r', partnerType: 'PT', amount: D('100'), recovered: D('40'), waived: D('0'), transactionId: 't', settledAt: null, suspendedAt: null };
  const a = { reason: 'valid reason', approvedBy: 'me', approvalRef: 'R1' };
  assert.equal(planReceivableChange(row, 'WAIVE', a, '60').data.settledAt instanceof Date, true, '40 recovered + 60 waived closes it');
  assert.equal('settledAt' in planReceivableChange(row, 'WAIVE', a, '59').data, false);
  assert.throws(() => planReceivableChange(row, 'WAIVE', a, '60.01'), (e: any) => e.code === 'WAIVE_EXCEEDS_OUTSTANDING');
  assert.throws(() => planReceivableChange(row, 'RESUME', a), (e: any) => e.code === 'NOT_SUSPENDED');
  assert.throws(() => planReceivableChange({ ...row, settledAt: new Date() }, 'SUSPEND', a), (e: any) => e.code === 'ALREADY_SETTLED');
});
