/** Payment-side dispute runtime gate: pure logic, no database. Evidence label: CODE-LEVEL UNIT TEST. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lateOpenSettlementVerdict, paymentGateVerdict, LATE_OPEN_SETTLEMENT_FLAG } from '../services/late-open-settlement-flag';
import { MARKER_VALUE, DEV_MARKER_VALUE, verdictSignature } from '../services/dispute-runtime-gate';

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

// ───────────────────────── dev-shared mode (docker-compose.dispute-dev.yml, owner approval 09/11/2026) ─────────────────────────
const dev = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'development',
    DISPUTE_RUNTIME_MODE: 'dev-shared',
    DISPUTE_DEV_COMPOSE_MARKER: DEV_MARKER_VALUE,
    DATABASE_URL: 'postgresql://u:pw@postgres:5432/gymcoach_payment',
    ...over,
  }) as NodeJS.ProcessEnv;

test('payment gate dev-shared: opens only with every condition, closes on every single wrong item', () => {
  assert.equal(verdictSignature(paymentGateVerdict(dev())), 'dev-shared:open');
  assert.notEqual(DEV_MARKER_VALUE, MARKER_VALUE);
  for (const db of ['gymcoach_user', 'gymcoach_payment', 'gymcoach_gym']) assert.equal(paymentGateVerdict(dev({ DATABASE_URL: `postgresql://u:pw@h/${db}` })).open, true, db);
  for (const [label, env, why] of [
    ['wrong mode', dev({ DISPUTE_RUNTIME_MODE: 'Dev-shared' }), 'NOT_TEST_ENV'],
    ['no mode', dev({ DISPUTE_RUNTIME_MODE: undefined }), 'NOT_TEST_ENV'],
    ['no marker', dev({ DISPUTE_DEV_COMPOSE_MARKER: undefined }), 'DEV_MARKER_MISSING'],
    ['e2e marker instead of dev marker', dev({ DISPUTE_DEV_COMPOSE_MARKER: MARKER_VALUE }), 'DEV_MARKER_MISSING'],
    ['production', dev({ NODE_ENV: 'production' }), 'DEV_NODE_ENV_NOT_ALLOWED'],
    ['NODE_ENV unset', dev({ NODE_ENV: undefined }), 'DEV_NODE_ENV_NOT_ALLOWED'],
    ['db gymcoach_payment_prod', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment_prod' }), 'DEV_DB_NOT_ALLOWLISTED'],
    ['db gymcoach_payment_e2e', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment_e2e' }), 'DEV_DB_NOT_ALLOWLISTED'],
    ['db gymini_payment_e2e', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymini_payment_e2e' }), 'DEV_DB_NOT_ALLOWLISTED'],
    ['db unset', dev({ DATABASE_URL: undefined }), 'DEV_DB_NOT_ALLOWLISTED'],
    ['env-provided allowlist ignored (dev var)', dev({ DATABASE_URL: 'postgresql://u:pw@h/other_db', DISPUTE_DEV_DB_ALLOWLIST: 'other_db' }), 'DEV_DB_NOT_ALLOWLISTED'],
    ['env-provided allowlist ignored (e2e var)', dev({ DATABASE_URL: 'postgresql://u:pw@h/other_db', DISPUTE_E2E_DB_ALLOWLIST: 'other_db' }), 'DEV_DB_NOT_ALLOWLISTED'],
  ] as Array<[string, NodeJS.ProcessEnv, string]>) {
    const v = paymentGateVerdict(env);
    assert.equal(v.open, false, label);
    assert.equal(verdictSignature(v), 'locked:closed', label);
    assert.equal(v.refusedBecause, why, label);
  }
  // NODE_ENV=test is test mode only (and needs a *_test database): dev-shared variables do not open anything there
  assert.equal(paymentGateVerdict(dev({ NODE_ENV: 'test' })).mode, 'test');
  assert.equal(paymentGateVerdict(dev({ NODE_ENV: 'test' })).open, false);
});

test('late-open OPEN-L settlement is NEVER effective in dev-shared, even when the variable asks for on', () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const v = lateOpenSettlementVerdict(dev({ [LATE_OPEN_SETTLEMENT_FLAG]: 'true' }));
    assert.equal(v.effective, false);
    assert.equal(v.refusedBecause, 'DEV_FLAG_NOT_PERMITTED');
    // a closed dev gate (wrong marker) is refused as well
    assert.equal(lateOpenSettlementVerdict(dev({ [LATE_OPEN_SETTLEMENT_FLAG]: 'true', DISPUTE_DEV_COMPOSE_MARKER: undefined })).effective, false);
    assert.equal(lateOpenSettlementVerdict(dev({ [LATE_OPEN_SETTLEMENT_FLAG]: 'true', NODE_ENV: 'production' })).effective, false);
  } finally {
    console.warn = warn;
  }
});
