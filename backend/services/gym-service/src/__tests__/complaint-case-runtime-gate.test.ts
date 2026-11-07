/** Gym-side dispute runtime gate: pure logic, no database. Evidence label: CODE-LEVEL UNIT TEST. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { flagVerdict, GYM_COMPLAINT_CASE_FLAG } from '../services/complaint-case/flags';
import { MARKER_VALUE } from '../services/complaint-case/runtime-gate';

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
