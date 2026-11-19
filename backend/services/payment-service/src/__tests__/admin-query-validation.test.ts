import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWithdrawalStatusFilter } from '../utils/withdrawal-status-filter';
import { isFinanceGroupBy } from '../services/finance-report.service';

test('withdrawal status filter: absent keeps default queue, enum values pass, unknown rejected', () => {
  assert.deepEqual(parseWithdrawalStatusFilter(undefined), { ok: true });
  for (const s of ['PENDING', 'APPROVED', 'PAID', 'REJECTED']) {
    assert.deepEqual(parseWithdrawalStatusFilter(s), { ok: true, status: s });
  }
  for (const bad of ['BOGUS', 'pending', '', ['PAID'], 1]) {
    assert.deepEqual(parseWithdrawalStatusFilter(bad), { ok: false });
  }
});

test('finance groupBy whitelist includes year, rejects unknown', () => {
  for (const g of ['day', 'week', 'month', 'quarter', 'year']) assert.equal(isFinanceGroupBy(g), true);
  for (const g of ['decade', '', 'YEAR', undefined, ['day']]) assert.equal(isFinanceGroupBy(g), false);
});
