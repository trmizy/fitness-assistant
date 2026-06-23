/**
 * Unit test for workoutRepository.appendSet()
 * Stubs Prisma methods on the shared CJS singleton — no real DB needed.
 * Run with: npx tsx --test src/__tests__/workout.appendSet.test.ts
 *
 * Why direct mutation: the project uses CJS (module: "commonjs"), so
 * node:test's mock.module() (ESM-only) is unavailable. In CJS, all
 * require() calls return the same cached object, so mutating prisma's
 * methods here is visible to workout.repository.ts as well.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../repositories/prisma';
import { workoutRepository } from '../repositories/workout.repository';

// Helper: stub prisma delegate methods, call fn, then restore
async function withPrismaStubs(
  stubs: {
    workoutExerciseFindFirst?: () => Promise<unknown>;
    workoutExerciseCreate?: (args: { data: Record<string, unknown>; include?: unknown }) => Promise<unknown>;
    workoutSetCreate?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  },
  fn: () => Promise<void>,
): Promise<void> {
  const we = prisma.workoutExercise as Record<string, unknown>;
  const ws = prisma.workoutSet as Record<string, unknown>;

  const origWeFindFirst = we['findFirst'];
  const origWeCreate = we['create'];
  const origWsCreate = ws['create'];

  if (stubs.workoutExerciseFindFirst) we['findFirst'] = stubs.workoutExerciseFindFirst;
  if (stubs.workoutExerciseCreate) we['create'] = stubs.workoutExerciseCreate;
  if (stubs.workoutSetCreate) ws['create'] = stubs.workoutSetCreate;

  try {
    await fn();
  } finally {
    we['findFirst'] = origWeFindFirst;
    we['create'] = origWeCreate;
    ws['create'] = origWsCreate;
  }
}

test('appendSet initialises new WorkoutExercise with sets = 1', async () => {
  let capturedCreateArgs: { data: Record<string, unknown> } | null = null;

  await withPrismaStubs(
    {
      workoutExerciseFindFirst: async () => null,
      workoutExerciseCreate: async (args) => {
        capturedCreateArgs = args;
        return { id: 'we-test-1', ...args.data, workoutSets: [] };
      },
      workoutSetCreate: async (args) => ({ id: 'ws-test-1', ...args.data }),
    },
    async () => {
      await workoutRepository.appendSet('workout-abc', 'exercise-abc', { weight: 100, reps: 8 });
    },
  );

  assert.ok(capturedCreateArgs !== null, 'workoutExercise.create must have been called');
  assert.strictEqual(
    capturedCreateArgs.data['sets'],
    1,
    'New WorkoutExercise must be created with sets: 1 (not 0)',
  );
});

test('sets: 0 would fail the previous test — regression guard', async () => {
  let capturedSets: unknown = undefined;

  await withPrismaStubs(
    {
      workoutExerciseFindFirst: async () => null,
      workoutExerciseCreate: async (args) => {
        capturedSets = args.data['sets'];
        return { id: 'we-test-2', ...args.data, workoutSets: [] };
      },
      workoutSetCreate: async (args) => ({ id: 'ws-test-2', ...args.data }),
    },
    async () => {
      await workoutRepository.appendSet('workout-def', 'exercise-def', { reps: 5 });
    },
  );

  assert.notStrictEqual(capturedSets, 0, 'sets: 0 is the known bug — must be 1');
});
