/**
 * Workout validation tests — pure functions only, no npm dependencies.
 * Run with: npx tsx --test src/__tests__/workout.validation.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKOUT_LIMITS,
  validateSets,
  validateReps,
  validateWeight,
  validateExercisesCount,
  validateDuration,
  validateWorkoutDate,
  validateExerciseId,
  checkMissingExerciseIds,
} from '../utils/workout-validation';

// ── sets ──────────────────────────────────────────────────────────────────────

test('sets = 0 → rejected (min 1)', () => {
  const err = validateSets(0);
  assert.ok(err !== null, 'Expected error for sets=0');
  assert.match(err!, /at least 1/i);
});

test('sets = 1 → accepted (boundary)', () => {
  assert.strictEqual(validateSets(1), null);
});

test('sets = 20 → accepted (boundary)', () => {
  assert.strictEqual(validateSets(20), null);
});

test(`sets = 1000 → rejected (max ${WORKOUT_LIMITS.SETS_MAX})`, () => {
  const err = validateSets(1000);
  assert.ok(err !== null, 'Expected error for sets=1000');
  assert.match(err!, /cannot exceed/i);
});

test(`sets = ${WORKOUT_LIMITS.SETS_MAX + 1} → rejected`, () => {
  const err = validateSets(WORKOUT_LIMITS.SETS_MAX + 1);
  assert.ok(err !== null);
});

// ── reps ──────────────────────────────────────────────────────────────────────

test('reps = -1 → rejected (min 1)', () => {
  const err = validateReps(-1);
  assert.ok(err !== null, 'Expected error for reps=-1');
  assert.match(err!, /at least 1/i);
});

test('reps = 0 → rejected', () => {
  assert.ok(validateReps(0) !== null);
});

test('reps = 1 → accepted (boundary)', () => {
  assert.strictEqual(validateReps(1), null);
});

test('reps = 100 → accepted (boundary)', () => {
  assert.strictEqual(validateReps(100), null);
});

test('reps = 101 → rejected (max 100)', () => {
  const err = validateReps(101);
  assert.ok(err !== null, 'Expected error for reps=101');
  assert.match(err!, /cannot exceed 100/i);
});

// ── weight ────────────────────────────────────────────────────────────────────

test('weightKg = 9999 → rejected (max 500)', () => {
  const err = validateWeight(9999);
  assert.ok(err !== null, 'Expected error for weight=9999');
  assert.match(err!, /cannot exceed 500 kg/i);
});

test('weightKg = -1 → rejected', () => {
  assert.ok(validateWeight(-1) !== null);
});

test('weightKg = 0 → accepted (bodyweight)', () => {
  assert.strictEqual(validateWeight(0), null);
});

test('weightKg = 500 → accepted (boundary)', () => {
  assert.strictEqual(validateWeight(500), null);
});

test('weightKg = 501 → rejected', () => {
  assert.ok(validateWeight(501) !== null);
});

// ── exercises count ───────────────────────────────────────────────────────────

test('31 exercises → rejected (max 30)', () => {
  const err = validateExercisesCount(31);
  assert.ok(err !== null, 'Expected error for 31 exercises');
  assert.match(err!, /more than 30/i);
});

test('30 exercises → accepted (boundary)', () => {
  assert.strictEqual(validateExercisesCount(30), null);
});

test('0 exercises → rejected (min 1)', () => {
  assert.ok(validateExercisesCount(0) !== null);
});

test('1 exercise → accepted', () => {
  assert.strictEqual(validateExercisesCount(1), null);
});

// ── duration ──────────────────────────────────────────────────────────────────

test('duration = 601 → rejected (max 600)', () => {
  const err = validateDuration(601);
  assert.ok(err !== null);
  assert.match(err!, /600 minutes/i);
});

test('duration = 600 → accepted (boundary)', () => {
  assert.strictEqual(validateDuration(600), null);
});

test('duration = 0 → rejected (min 1)', () => {
  assert.ok(validateDuration(0) !== null);
});

test('duration = 1 → accepted (boundary)', () => {
  assert.strictEqual(validateDuration(1), null);
});

// ── date ──────────────────────────────────────────────────────────────────────

test('date 8 days in future → rejected', () => {
  const future = new Date(Date.now() + 8 * 86_400_000).toISOString();
  const err = validateWorkoutDate(future);
  assert.ok(err !== null, 'Expected error for date 8 days in future');
  assert.match(err!, /future/i);
});

test('date today → accepted', () => {
  assert.strictEqual(validateWorkoutDate(new Date().toISOString()), null);
});

test('date yesterday → accepted', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  assert.strictEqual(validateWorkoutDate(yesterday), null);
});

test('invalid date string → rejected', () => {
  const err = validateWorkoutDate('not-a-date');
  assert.ok(err !== null);
  assert.match(err!, /invalid date/i);
});

// ── checkMissingExerciseIds ───────────────────────────────────────────────────

test('exerciseId not in DB → identified as missing', () => {
  const missing = checkMissingExerciseIds(
    ['seed_ex_001', 'nonexistent_id'],
    new Set(['seed_ex_001', 'seed_ex_002']),
  );
  assert.deepEqual(missing, ['nonexistent_id']);
});

test('all exerciseIds present → empty missing list', () => {
  const missing = checkMissingExerciseIds(
    ['seed_ex_001', 'seed_ex_002'],
    new Set(['seed_ex_001', 'seed_ex_002', 'seed_ex_003']),
  );
  assert.deepEqual(missing, []);
});

test('all exerciseIds missing → returns all', () => {
  const missing = checkMissingExerciseIds(
    ['bad_1', 'bad_2'],
    new Set(['seed_ex_001']),
  );
  assert.deepEqual(missing, ['bad_1', 'bad_2']);
});

test('empty request → no missing ids', () => {
  assert.deepEqual(checkMissingExerciseIds([], new Set(['seed_ex_001'])), []);
});

// ── exerciseId ────────────────────────────────────────────────────────────────

test('exerciseId = "" → rejected', () => {
  const err = validateExerciseId('');
  assert.ok(err !== null);
  assert.match(err!, /required/i);
});

test('exerciseId = "   " → rejected (whitespace only)', () => {
  assert.ok(validateExerciseId('   ') !== null);
});

test('exerciseId = "seed_ex_001" → accepted (non-UUID format allowed)', () => {
  assert.strictEqual(validateExerciseId('seed_ex_001'), null);
});

test('exerciseId = UUID → accepted', () => {
  assert.strictEqual(validateExerciseId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), null);
});

// ── boundary: valid full request (smoke-test all limits together) ─────────────

test('valid exercise fields at max bounds → all pass', () => {
  assert.strictEqual(validateSets(WORKOUT_LIMITS.SETS_MAX), null);
  assert.strictEqual(validateReps(WORKOUT_LIMITS.REPS_MAX), null);
  assert.strictEqual(validateWeight(WORKOUT_LIMITS.WEIGHT_MAX), null);
  assert.strictEqual(validateExercisesCount(WORKOUT_LIMITS.EXERCISES_MAX), null);
  assert.strictEqual(validateDuration(WORKOUT_LIMITS.DURATION_MAX), null);
});
