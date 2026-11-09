/** Gym-side dispute runtime gate: pure logic, no database. Evidence label: CODE-LEVEL UNIT TEST. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { flagVerdict, gateVerdict, replacementEnabled, GYM_COMPLAINT_CASE_FLAG, GYM_DECISION_REPLACEMENT_FLAG } from '../services/complaint-case/flags';
import { MARKER_VALUE, DEV_MARKER_VALUE } from '../services/complaint-case/runtime-gate';

const e2e = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'development',
    [GYM_COMPLAINT_CASE_FLAG]: 'true',
    DISPUTE_RUNTIME_MODE: 'e2e-isolated',
    DISPUTE_E2E_COMPOSE_MARKER: MARKER_VALUE,
    DISPUTE_E2E_DB_ALLOWLIST: 'gymini_gym_e2e',
    DATABASE_URL: 'postgresql://u:pw@h:5432/gymini_gym_e2e',
    ...over,
  }) as NodeJS.ProcessEnv;

test('gym case flag: effective in e2e only with every condition; closed for every misconfiguration', () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(flagVerdict(e2e()).effective, true);
    for (const [label, env] of [
      ['production', e2e({ NODE_ENV: 'production' })],
      ['no marker', e2e({ DISPUTE_E2E_COMPOSE_MARKER: undefined })],
      ['no mode', e2e({ DISPUTE_RUNTIME_MODE: undefined })],
      ['db not allowlisted', e2e({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_gym' })],
      ['value TRUE', e2e({ [GYM_COMPLAINT_CASE_FLAG]: 'TRUE' })],
    ] as Array<[string, NodeJS.ProcessEnv]>) {
      assert.equal(flagVerdict(env).effective, false, label);
    }
  } finally {
    console.warn = warn;
  }
});

test('test mode unchanged', () => {
  assert.equal(flagVerdict({ NODE_ENV: 'test', DB_ISOLATION: 'accepted', [GYM_COMPLAINT_CASE_FLAG]: 'true' } as any).effective, true);
  assert.equal(flagVerdict({ NODE_ENV: 'test', [GYM_COMPLAINT_CASE_FLAG]: 'true' } as any).effective, false);
});

// ───────────────────────── dev-shared mode (docker-compose.dispute-dev.yml, owner approval 09/11/2026) ─────────────────────────
const dev = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'development',
    [GYM_COMPLAINT_CASE_FLAG]: 'true',
    [GYM_DECISION_REPLACEMENT_FLAG]: 'true',
    DISPUTE_RUNTIME_MODE: 'dev-shared',
    DISPUTE_DEV_COMPOSE_MARKER: DEV_MARKER_VALUE,
    DATABASE_URL: 'postgresql://u:pw@postgres:5432/gymcoach_gym',
    ...over,
  }) as NodeJS.ProcessEnv;

test('gym dev-shared: gate opens only with every condition; both gym flags follow it', () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(gateVerdict(dev()).mode, 'dev-shared');
    assert.equal(gateVerdict(dev()).open, true);
    assert.equal(flagVerdict(dev()).effective, true);
    assert.equal(replacementEnabled(dev()), true);
    assert.notEqual(DEV_MARKER_VALUE, MARKER_VALUE);
    for (const db of ['gymcoach_user', 'gymcoach_payment', 'gymcoach_gym']) assert.equal(gateVerdict(dev({ DATABASE_URL: `postgresql://u:pw@h/${db}` })).open, true, db);
    for (const [label, env, why] of [
      ['wrong mode', dev({ DISPUTE_RUNTIME_MODE: 'Dev-shared' }), 'NOT_TEST_ENV'],
      ['no mode', dev({ DISPUTE_RUNTIME_MODE: undefined }), 'NOT_TEST_ENV'],
      ['no marker', dev({ DISPUTE_DEV_COMPOSE_MARKER: undefined }), 'DEV_MARKER_MISSING'],
      ['e2e marker instead of dev marker', dev({ DISPUTE_DEV_COMPOSE_MARKER: MARKER_VALUE }), 'DEV_MARKER_MISSING'],
      ['production', dev({ NODE_ENV: 'production' }), 'DEV_NODE_ENV_NOT_ALLOWED'],
      ['NODE_ENV unset', dev({ NODE_ENV: undefined }), 'DEV_NODE_ENV_NOT_ALLOWED'],
      ['db gymcoach_gym_prod', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_gym_prod' }), 'DEV_DB_NOT_ALLOWLISTED'],
      ['db gymcoach_gym_e2e', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymcoach_gym_e2e' }), 'DEV_DB_NOT_ALLOWLISTED'],
      ['db gymini_gym_e2e', dev({ DATABASE_URL: 'postgresql://u:pw@h/gymini_gym_e2e' }), 'DEV_DB_NOT_ALLOWLISTED'],
      ['db unset', dev({ DATABASE_URL: undefined }), 'DEV_DB_NOT_ALLOWLISTED'],
      ['env-provided allowlist ignored (dev var)', dev({ DATABASE_URL: 'postgresql://u:pw@h/other_db', DISPUTE_DEV_DB_ALLOWLIST: 'other_db' }), 'DEV_DB_NOT_ALLOWLISTED'],
      ['env-provided allowlist ignored (e2e var)', dev({ DATABASE_URL: 'postgresql://u:pw@h/other_db', DISPUTE_E2E_DB_ALLOWLIST: 'other_db' }), 'DEV_DB_NOT_ALLOWLISTED'],
    ] as Array<[string, NodeJS.ProcessEnv, string]>) {
      const g = gateVerdict(env);
      assert.equal(g.open, false, label);
      assert.equal(g.mode, 'locked', label);
      assert.equal(g.refusedBecause, why, label);
      assert.equal(flagVerdict(env).effective, false, label);
      assert.equal(replacementEnabled(env), false, label);
    }
    // the flag values still have to be exactly "true"
    assert.equal(flagVerdict(dev({ [GYM_COMPLAINT_CASE_FLAG]: 'TRUE' })).effective, false);
    assert.equal(replacementEnabled(dev({ [GYM_DECISION_REPLACEMENT_FLAG]: '1' })), false);
    // NODE_ENV=test is the test mode only: the dev-shared variables do not open anything there without the accepted test DB
    assert.equal(gateVerdict(dev({ NODE_ENV: 'test' })).mode, 'test');
    assert.equal(gateVerdict(dev({ NODE_ENV: 'test' })).open, false);
    assert.equal(flagVerdict(dev({ NODE_ENV: 'test' })).effective, false);
  } finally {
    console.warn = warn;
  }
});
