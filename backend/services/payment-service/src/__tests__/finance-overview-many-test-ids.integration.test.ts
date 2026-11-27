import { guardedTest as test } from './support/test-db-guard'; // runs only on a database whose name ends with _test
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { buildFinanceOverview } from '../services/finance-report.service';

/**
 * Same class of bug as AWS DEV gym-service /admin/partners/overview-stats (Postgres: max 32767 bind variables per
 * statement; auth-service returns ~37k test-account ids). buildFinanceOverview passes the id list as ONE array
 * parameter (`= ANY(${ids})`), so it must keep working with 40,000 excluded ids and still exclude exactly the test
 * payer / test PT rows.
 *
 *   evidence label: BACKEND INTEGRATION (real service + isolated *_test DB); the id list is a TEST FIXTURE.
 *
 * Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/finance-overview-many-test-ids.integration.test.ts
 */
const FROM = new Date('2033-05-01T00:00:00Z');
const TO = new Date('2033-06-01T00:00:00Z');
const PAID_AT = new Date('2033-05-10T05:00:00Z');
const created: string[] = [];

async function mk(payerId: string, ptId: string | null, amount: number) {
  const t = await prisma.paymentTransaction.create({
    data: { id: randomUUID(), payerId, ptId, purpose: 'PT_CONTRACT', amount: new Prisma.Decimal(amount), idempotencyKey: `test:${randomUUID()}`, status: 'PAID', paidAt: PAID_AT },
  });
  created.push(t.id);
}

test.after(async () => {
  if (created.length) await prisma.paymentTransaction.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

test('buildFinanceOverview with ~40,000 excluded ids does not throw and excludes exactly the test payer / test PT rows', async () => {
  const testPayer = randomUUID();
  const testPt = randomUUID();
  const normal = randomUUID();
  const normalPt = randomUUID();
  await mk(testPayer, normalPt, 1_000); // excluded: test payer
  await mk(normal, testPt, 2_000); // excluded: test PT
  await mk(normal, normalPt, 4_000); // counted
  await mk(normal, null, 8_000); // counted (no PT)

  const fakes = Array.from({ length: 40_000 }, () => randomUUID());
  const report = await buildFinanceOverview({ from: FROM, to: TO, groupBy: 'month', excludeUserIds: [...fakes, testPayer, testPt] });
  assert.equal(report.totals.income, '12000.00');
  assert.equal(report.totals.transactionCount, 2);
  assert.equal(report.excludedTestAccounts, 40_002);

  // No filter (local path): all four rows.
  const all = await buildFinanceOverview({ from: FROM, to: TO, groupBy: 'month', excludeUserIds: null });
  assert.equal(all.totals.income, '15000.00');
  assert.equal(all.totals.transactionCount, 4);
  assert.equal(all.excludedTestAccounts, null);
});
