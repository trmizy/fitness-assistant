/**
 * Test-only seeding fixtures for the four personas this project's
 * production-hardening pass is scoped around (see
 * docs/production-hardening-checkpoint.md §13):
 *
 *   A. Beginner    — no/near-no history, must never receive a confident
 *                    conclusion from sparse data.
 *   B. Intermediate — a few weeks of real mixed completed/missed/partial
 *                    sessions with valid load/reps/RPE/RIR.
 *   C. Experienced  — multiple training cycles spanning a program change,
 *                    long enough history for trend analysis.
 *   D. Athlete      — dense sessions using multiple set types (warm-up/
 *                    working/top/back-off), tempo, unilateral side, and
 *                    optional pain/technique data.
 *
 * These seed the REAL fitness-service tables (Workout/WorkoutSchedule/
 * WorkoutSet/TrainingCycle) via the real Prisma client, scoped to a
 * caller-supplied test-only userId — never production data, and never run
 * outside the same gated-real-DB convention every other
 * `*.integration.test.ts` file in this directory already uses.
 *
 * Deliberately scoped to what fitness-service's own database owns. InBody
 * data lives in user-service (cross-service, requires a real internal
 * auth token) — the same already-documented limitation affecting
 * adaptive-cycle-evaluation.integration.test.ts applies here, so InBody
 * seeding is not attempted from this fixture module.
 */
import type { prisma as PrismaClient } from "../../repositories/prisma";

type Db = typeof PrismaClient;

function utcDate(offsetDaysFromToday: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offsetDaysFromToday,
    ),
  );
}

async function seedExercise(db: Db, userId: string, suffix: string) {
  return db.exercise.create({
    data: {
      id: `${userId}-exercise-${suffix}`,
      exerciseName: `Persona Fixture Exercise ${suffix}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["chest"],
      instructions: "Test exercise for persona fixtures.",
    },
  });
}

async function seedProgram(
  db: Db,
  userId: string,
  name: string,
  exerciseId: string,
) {
  return db.workoutProgram.create({
    data: {
      userId,
      name,
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Day 1",
          exercises: { create: { exerciseId, order: 1, sets: 3, reps: 8 } },
        },
      },
    },
    include: { days: { include: { exercises: true } } },
  });
}

/**
 * Persona A — Beginner: exactly one schedule, no completed history at all
 * (schedule stays NOT_STARTED). No RPE/RIR, no InBody. Any downstream
 * report/recommendation reading this user's data must treat it as
 * insufficient — never state a confident conclusion.
 */
export async function seedPersonaABeginner(db: Db, userId: string) {
  const exercise = await seedExercise(db, userId, "a");
  const program = await seedProgram(db, userId, "Persona A - Beginner Program", exercise.id);
  const schedule = await db.workoutSchedule.create({
    data: {
      userId,
      date: utcDate(0),
      programDayId: program.days[0].id,
      sourceType: "PERSONA_A_FIXTURE",
    },
  });
  return { exercise, program, schedules: [schedule] };
}

/**
 * Persona B — Intermediate: 3 weeks (21 days) of real schedule history —
 * a realistic mix of COMPLETED (with valid weight/reps/RPE/RIR), SKIPPED
 * ("missed"), and IN_PROGRESS ("partial") sessions, not just relabeled
 * copies of persona A's single row.
 */
export async function seedPersonaBIntermediate(db: Db, userId: string) {
  const exercise = await seedExercise(db, userId, "b");
  const program = await seedProgram(db, userId, "Persona B - Intermediate Program", exercise.id);
  const programDayId = program.days[0].id;
  const programExerciseId = program.days[0].exercises[0].id;

  const schedules = [];
  // 3 weeks back to today, one session every 2 days (realistic 3-4x/week).
  for (let offset = -20; offset <= 0; offset += 2) {
    const isPartial = offset === -6; // exactly one deliberately partial session
    const isMissed = offset === -12; // exactly one deliberately missed session
    if (isMissed) {
      const schedule = await db.workoutSchedule.create({
        data: {
          userId,
          date: utcDate(offset),
          programDayId,
          status: "NOT_STARTED",
          sourceType: "PERSONA_B_FIXTURE",
        },
      });
      schedules.push(schedule);
      continue;
    }

    const workout = await db.workout.create({
      data: {
        userId,
        name: "Persona B session",
        date: utcDate(offset),
        exercises: {
          create: {
            exerciseId: exercise.id,
            programExerciseId,
            sets: 3,
            reps: 8,
            weight: 40 + Math.abs(offset), // mild progressive overload over time
            workoutSets: {
              create: [1, 2, 3].map((setNumber) => ({
                setNumber,
                reps: 8,
                weight: 40 + Math.abs(offset),
                rpe: 7 + (setNumber === 3 ? 1 : 0),
                rir: setNumber === 3 ? 1 : 2,
                completed: !isPartial || setNumber === 1,
              })),
            },
          },
        },
      },
    });
    const schedule = await db.workoutSchedule.create({
      data: {
        userId,
        date: utcDate(offset),
        programDayId,
        workoutId: workout.id,
        status: isPartial ? "IN_PROGRESS" : "COMPLETED",
        progressPercent: isPartial ? 33 : 100,
        totalExercises: 1,
        completedExercises: isPartial ? 0 : 1,
        totalSets: 3,
        completedSets: isPartial ? 1 : 3,
        completedAt: isPartial ? null : utcDate(offset),
        sourceType: "PERSONA_B_FIXTURE",
      },
    });
    schedules.push(schedule);
  }

  return { exercise, program, schedules };
}

/**
 * Persona C — Experienced/long-term: two real TrainingCycle records
 * (first ARCHIVED under one program, second ACTIVE under a renamed
 * program — a genuine program change), with completed session history
 * spanning both, long enough (10+ weeks) for real trend analysis.
 */
export async function seedPersonaCExperienced(db: Db, userId: string) {
  const exerciseCycle1 = await seedExercise(db, userId, "c1");
  const exerciseCycle2 = await seedExercise(db, userId, "c2");
  const programCycle1 = await seedProgram(db, userId, "Persona C - Phase 1 (Hypertrophy)", exerciseCycle1.id);
  const programCycle2 = await seedProgram(db, userId, "Persona C - Phase 2 (Strength)", exerciseCycle2.id);

  const cycle1 = await db.trainingCycle.create({
    data: {
      userId,
      planId: programCycle1.id,
      cycleIndex: 1,
      startDate: utcDate(-70),
      endDate: utcDate(-35),
      durationDays: 35,
      goal: "MUSCLE_GAIN",
      status: "ARCHIVED",
    },
  });
  const cycle2 = await db.trainingCycle.create({
    data: {
      userId,
      planId: programCycle2.id,
      cycleIndex: 2,
      startDate: utcDate(-34),
      endDate: utcDate(1),
      durationDays: 35,
      goal: "MUSCLE_GAIN",
      status: "ACTIVE",
    },
  });

  const schedules = [];
  // Cycle 1: weekly sessions from -70 to -36 (5 weeks).
  for (let offset = -70; offset <= -36; offset += 7) {
    const workout = await db.workout.create({
      data: {
        userId,
        name: "Persona C phase-1 session",
        date: utcDate(offset),
        exercises: {
          create: {
            exerciseId: exerciseCycle1.id,
            programExerciseId: programCycle1.days[0].exercises[0].id,
            sets: 3,
            reps: 10,
            weight: 50,
            workoutSets: {
              create: [1, 2, 3].map((setNumber) => ({
                setNumber,
                reps: 10,
                weight: 50,
                completed: true,
              })),
            },
          },
        },
      },
    });
    const schedule = await db.workoutSchedule.create({
      data: {
        userId,
        date: utcDate(offset),
        programDayId: programCycle1.days[0].id,
        workoutId: workout.id,
        status: "COMPLETED",
        progressPercent: 100,
        totalExercises: 1,
        completedExercises: 1,
        totalSets: 3,
        completedSets: 3,
        completedAt: utcDate(offset),
        trainingCycleId: cycle1.id,
        sourceType: "PERSONA_C_FIXTURE",
      },
    });
    schedules.push(schedule);
  }
  // Cycle 2: weekly sessions from -34 to today (5 weeks), heavier weight —
  // a real, verifiable strength trend across the program change.
  for (let offset = -34; offset <= 0; offset += 7) {
    const workout = await db.workout.create({
      data: {
        userId,
        name: "Persona C phase-2 session",
        date: utcDate(offset),
        exercises: {
          create: {
            exerciseId: exerciseCycle2.id,
            programExerciseId: programCycle2.days[0].exercises[0].id,
            sets: 3,
            reps: 5,
            weight: 70,
            workoutSets: {
              create: [1, 2, 3].map((setNumber) => ({
                setNumber,
                reps: 5,
                weight: 70,
                completed: true,
              })),
            },
          },
        },
      },
    });
    const schedule = await db.workoutSchedule.create({
      data: {
        userId,
        date: utcDate(offset),
        programDayId: programCycle2.days[0].id,
        workoutId: workout.id,
        status: "COMPLETED",
        progressPercent: 100,
        totalExercises: 1,
        completedExercises: 1,
        totalSets: 3,
        completedSets: 3,
        completedAt: utcDate(offset),
        trainingCycleId: cycle2.id,
        sourceType: "PERSONA_C_FIXTURE",
      },
    });
    schedules.push(schedule);
  }

  return { exerciseCycle1, exerciseCycle2, programCycle1, programCycle2, cycle1, cycle2, schedules };
}

/**
 * Persona D — Professional athlete: dense recent sessions using multiple
 * REAL set types (warm-up, working, top, back-off), tempo notation, and a
 * unilateral exercise with left/right side data — exercising the advanced
 * set-logging fields added in migration
 * 20260730000000_workout_set_advanced_logging, not just relabeled basic
 * sets.
 */
export async function seedPersonaDAthlete(db: Db, userId: string) {
  const exercise = await seedExercise(db, userId, "d");
  const unilateralExercise = await seedExercise(db, userId, "d-unilateral");
  const program = await seedProgram(db, userId, "Persona D - Athlete Program", exercise.id);

  const workout = await db.workout.create({
    data: {
      userId,
      name: "Persona D heavy session",
      date: utcDate(0),
      exercises: {
        create: [
          {
            exerciseId: exercise.id,
            programExerciseId: program.days[0].exercises[0].id,
            sets: 5,
            reps: 5,
            weight: 140,
            workoutSets: {
              create: [
                { setNumber: 1, reps: 8, weight: 60, rpe: 5, completed: true, setType: "WARMUP" },
                { setNumber: 2, reps: 5, weight: 100, rpe: 6, completed: true, setType: "WARMUP" },
                {
                  setNumber: 3,
                  reps: 3,
                  weight: 140,
                  rpe: 9,
                  rir: 1,
                  completed: true,
                  setType: "TOP",
                  tempo: "2-1-1-0",
                  rangeOfMotion: "FULL",
                  painScore: 0,
                  techniqueNotes: "Solid bar path, clean lockout.",
                },
                {
                  setNumber: 4,
                  reps: 5,
                  weight: 115,
                  rpe: 8.5,
                  rir: 1,
                  completed: true,
                  setType: "BACKOFF",
                },
                {
                  setNumber: 5,
                  reps: 5,
                  weight: 115,
                  rpe: 9,
                  rir: 0,
                  completed: true,
                  setType: "FAILURE",
                  painScore: 2,
                  techniqueNotes: "Slight left shoulder discomfort on final rep.",
                },
              ],
            },
          },
          {
            exerciseId: unilateralExercise.id,
            sets: 2,
            reps: 8,
            weight: 20,
            workoutSets: {
              create: [
                { setNumber: 1, reps: 8, weight: 20, completed: true, setType: "WORKING", side: "LEFT" },
                { setNumber: 2, reps: 8, weight: 20, completed: true, setType: "WORKING", side: "RIGHT" },
              ],
            },
          },
        ],
      },
    },
    include: { exercises: { include: { workoutSets: true } } },
  });

  const schedule = await db.workoutSchedule.create({
    data: {
      userId,
      date: utcDate(0),
      programDayId: program.days[0].id,
      workoutId: workout.id,
      status: "COMPLETED",
      progressPercent: 100,
      totalExercises: 2,
      completedExercises: 2,
      totalSets: 7,
      completedSets: 7,
      completedAt: utcDate(0),
      sourceType: "PERSONA_D_FIXTURE",
    },
  });

  return { exercise, unilateralExercise, program, workout, schedules: [schedule] };
}

export async function deletePersonaFixtures(db: Db, userId: string) {
  const cycles = await db.trainingCycle.findMany({ where: { userId }, select: { id: true } });
  if (cycles.length > 0) {
    await db.cycleAssessment.deleteMany({
      where: { cycleId: { in: cycles.map((c) => c.id) } },
    });
  }
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.trainingCycle.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-exercise-` } } });
}
