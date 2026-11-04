/** Payment-side dispute runtime gate: pure logic, no database. Evidence label: CODE-LEVEL UNIT TEST. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lateOpenSettlementVerdict, paymentGateVerdict, LATE_OPEN_SETTLEMENT_FLAG } from '../services/late-open-settlement-flag';
import { MARKER_VALUE, verdictSignature } from '../services/dispute-runtime-gate';

const e2e = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'development',
    DISPUTE_RUNTIME_MODE: 'e2e-isolated',
    DISPUTE_E2E_COMPOSE_MARKER: MARKER_VALUE,
    DISPUTE_E2E_DB_ALLOWLIST: 'gymini_payment_e2e',
    DATABASE_URL: 'postgresql://u:pw@h:5432/gymini_payment_e2e',
    ...over,
  }) as NodeJS.ProcessEnv;

test('payment gate: opens in e2e only with every condition, closes on every misconfiguration', () => {
  assert.equal(verdictSignature(paymentGateVerdict(e2e())), 'e2e-isolated:open');
  for (const [label, env] of [
    ['production', e2e({ NODE_ENV: 'production' })],
    ['no marker', e2e({ DISPUTE_E2E_COMPOSE_MARKER: undefined })],
    ['no mode', e2e({ DISPUTE_RUNTIME_MODE: undefined })],
    ['db not allowlisted', e2e({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment' })],
    ['allowlisted but not _e2e', e2e({ DISPUTE_E2E_DB_ALLOWLIST: 'gymcoach_payment', DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment' })],
  ] as Array<[string, NodeJS.ProcessEnv]>) {
    assert.equal(paymentGateVerdict(env).open, false, label);
    assert.equal(verdictSignature(paymentGateVerdict(env)), 'locked:closed', label);
  }
});

test('late-open OPEN-L settlement is NEVER effective in the e2e environment, even when the variable asks for on', () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const v = lateOpenSettlementVerdict(e2e({ [LATE_OPEN_SETTLEMENT_FLAG]: 'true' }));
    assert.equal(v.effective, false);
    assert.equal(v.refusedBecause, 'E2E_FLAG_NOT_PERMITTED');
    assert.equal(lateOpenSettlementVerdict(e2e({ [LATE_OPEN_SETTLEMENT_FLAG]: 'true', NODE_ENV: 'production' })).effective, false);
  } finally {
    console.warn = warn;
  }
});

test('test mode unchanged: NODE_ENV=test + DB ending _test is open', () => {
  const env = { NODE_ENV: 'test', [LATE_OPEN_SETTLEMENT_FLAG]: 'true', DATABASE_URL: 'postgresql://u:pw@localhost:55433/x_test' } as NodeJS.ProcessEnv;
  assert.equal(lateOpenSettlementVerdict(env).effective, true);
});
