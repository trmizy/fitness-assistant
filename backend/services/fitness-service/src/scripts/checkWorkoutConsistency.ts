import { prisma } from '../repositories/prisma';

type Issue = {
  code: string;
  scheduleId?: string;
  workoutId?: string | null;
  message: string;
  expected?: unknown;
  actual?: unknown;
  fixed?: boolean;
};

const fixSafe = process.argv.includes('--fix-safe');
const strict = process.argv.includes('--strict');
const dryRun = process.argv.includes('--dry-run') || !fixSafe;

function pct(completed: number, total: number): number {
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}

function isExerciseComplete(exercise: any): boolean {
  const sets = Array.isArray(exercise.workoutSets) ? exercise.workoutSets : [];
  return sets.length > 0 && sets.every((set: any) => set.completed === true);
}

async function main() {
  const issues: Issue[] = [];
  const schedules = await prisma.workoutSchedule.findMany({
    include: {
      workout: {
        include: {
          exercises: {
            include: { workoutSets: true },
          },
        },
      },
      programDay: {
        include: {
          exercises: true,
        },
      },
    },
  });

  for (const schedule of schedules) {
    const planned = schedule.programDay?.exercises ?? [];
    const logged = schedule.workout?.exercises ?? [];
    const completedProgramExerciseIds = new Set(
      logged
        .filter((exercise: any) => exercise.programExerciseId && isExerciseComplete(exercise))
        .map((exercise: any) => exercise.programExerciseId),
    );
    const fallbackCompletedExerciseIds = new Set(
      logged
        .filter((exercise: any) => !exercise.programExerciseId && isExerciseComplete(exercise))
        .map((exercise: any) => exercise.exerciseId),
    );
    const totalExercises = planned.length || logged.length;
    const completedExercises = planned.length
      ? planned.filter((exercise: any) =>
          completedProgramExerciseIds.has(exercise.id) ||
          fallbackCompletedExerciseIds.has(exercise.exerciseId),
        ).length
      : logged.filter(isExerciseComplete).length;
    const totalSets = planned.length
      ? planned.reduce((sum: number, exercise: any) => sum + (Number(exercise.sets) || 1), 0)
      : logged.reduce((sum: number, exercise: any) => sum + exercise.workoutSets.length, 0);
    const completedSets = logged.reduce(
      (sum: number, exercise: any) => sum + exercise.workoutSets.filter((set: any) => set.completed).length,
      0,
    );
    const progressPercent = pct(completedExercises, totalExercises);
    const expectedStatus = totalExercises > 0 && completedExercises === totalExercises
      ? 'COMPLETED'
      : (schedule.workoutId || completedExercises > 0 ? 'IN_PROGRESS' : 'NOT_STARTED');

    const expected = {
      progressPercent,
      totalExercises,
      completedExercises,
      totalSets,
      completedSets,
      status: expectedStatus,
    };
    const actual = {
      progressPercent: schedule.progressPercent,
      totalExercises: schedule.totalExercises,
      completedExercises: schedule.completedExercises,
      totalSets: schedule.totalSets,
      completedSets: schedule.completedSets,
      status: schedule.status,
    };

    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      const issue: Issue = {
        code: 'SCHEDULE_PROGRESS_MISMATCH',
        scheduleId: schedule.id,
        workoutId: schedule.workoutId,
        message: 'Workout schedule cached progress does not match workout set completion.',
        expected,
        actual,
      };
      if (fixSafe) {
        await prisma.workoutSchedule.update({
          where: { id: schedule.id },
          data: {
            ...expected,
            completedAt: expectedStatus === 'COMPLETED' ? (schedule.completedAt ?? new Date()) : null,
          },
        });
        issue.fixed = true;
      }
      issues.push(issue);
    }

    if (schedule.status === 'COMPLETED' && !schedule.completedAt) {
      issues.push({
        code: 'COMPLETED_WITHOUT_COMPLETED_AT',
        scheduleId: schedule.id,
        workoutId: schedule.workoutId,
        message: 'Schedule status is COMPLETED but completedAt is null.',
      });
    }

    if (schedule.workoutId && !schedule.workout) {
      issues.push({
        code: 'ORPHAN_WORKOUT_LINK',
        scheduleId: schedule.id,
        workoutId: schedule.workoutId,
        message: 'Schedule references a workout that cannot be loaded.',
      });
    }
  }

  const duplicateActive = await prisma.workoutSchedule.groupBy({
    by: ['userId', 'date'],
    where: { status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });
  for (const duplicate of duplicateActive) {
    issues.push({
      code: 'DUPLICATE_ACTIVE_SCHEDULE_DATE',
      message: `User has ${duplicate._count.id} active schedules on the same date.`,
      expected: { count: 1 },
      actual: duplicate,
    });
  }

  console.log(JSON.stringify({
    mode: fixSafe ? 'fix-safe' : (dryRun ? 'dry-run' : 'report'),
    strict,
    checkedSchedules: schedules.length,
    issueCount: issues.length,
    issueSample: issues.slice(0, 50),
    truncatedIssues: Math.max(0, issues.length - 50),
  }, null, 2));

  if (issues.length > 0 && !fixSafe && strict) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('FAIL workout:check-consistency');
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('program_exercise_id') || message.includes('programExerciseId')) {
      console.error('Migration missing: apply migration 20260709000000_add_workout_exercise_program_link and run prisma generate.');
    }
    console.error(message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
