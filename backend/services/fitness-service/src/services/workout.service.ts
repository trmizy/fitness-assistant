import { Queue } from 'bullmq';
import { prisma } from '../repositories/prisma';
import { workoutRepository } from '../repositories/workout.repository';
import { exerciseRepository } from '../repositories/exercise.repository';
import { checkMissingExerciseIds } from '../utils/workout-validation';
import type { CreateManualProgramDto, CreateWorkoutDto, UpdateWorkoutSetDto, ImportAiPlanDto } from '../models/fitness.models';

type NormalizedExerciseCatalogItem = {
  id: string;
  name: string;
  rawName: string;
};

type MappedAiExercise = {
  exerciseId: string;
  order: number;
  sets: number;
  reps: number | null;
  restSeconds: number;
  notes?: string;
};

type MappedAiDay = {
  title: string;
  description?: string;
  exercises: MappedAiExercise[];
};

const GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: 'Giam mo',
  MUSCLE_GAIN: 'Tang co',
  MAINTENANCE: 'Duy tri',
  ATHLETIC_PERFORMANCE: 'Cai thien suc khoe',
  lose_fat: 'Giam mo',
  gain_muscle: 'Tang co',
  maintain: 'Duy tri',
  improve_health: 'Cai thien suc khoe',
};

function goalLabel(goal?: string | null) {
  if (!goal) return 'AI';
  return CLEAN_GOAL_LABELS[goal] || GOAL_LABELS[goal] || goal;
}

const CLEAN_GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: 'Giam mo',
  MUSCLE_GAIN: 'Tang co',
  MAINTENANCE: 'Duy tri',
  ATHLETIC_PERFORMANCE: 'Cai thien suc khoe',
  lose_fat: 'Giam mo',
  gain_muscle: 'Tang co',
  maintain: 'Duy tri',
  improve_health: 'Cai thien suc khoe',
};

const CLEAN_WEEKDAY_LABELS: Record<number, string> = {
  0: 'Chu nhat',
  1: 'Thu 2',
  2: 'Thu 3',
  3: 'Thu 4',
  4: 'Thu 5',
  5: 'Thu 6',
  6: 'Thu 7',
};

const CORRUPTED_TEXT_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\uFFFD|\?|\u00C3|\u00C4|\u00C6|\u00C7|\u00C8|\u00D3|\u00E1\u00BA|\u00C2|\u00BB/i;

const DAY_FALLBACK_TITLES = [
  'Chan + Mong',
  'Nguc + Vai + Tay sau',
  'Lung + Tay truoc',
  'Core + Cardio',
  'Than tren',
  'Than duoi',
  'Hoi phuc chu dong',
];

function sanitizeImportedText(value?: string | null, fallback?: string) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (CORRUPTED_TEXT_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

function sanitizeImportedDayTitle(value: string | undefined, dayIndex: number) {
  const fallback = DAY_FALLBACK_TITLES[dayIndex % DAY_FALLBACK_TITLES.length];
  return sanitizeImportedText(value, fallback) || fallback;
}

function sanitizeImportedExerciseNote(value?: string | null) {
  return sanitizeImportedText(
    value,
    'Tap trung vao ky thuat dung, kiem soat nhip tap va tang tien tu tu.',
  );
}

type WorkoutProgressSummary = {
  sessionId: string | null;
  workoutId: string | null;
  planId: string | null;
  dayId: string | null;
  exerciseId?: string | null;
  programExerciseId?: string | null;
  exerciseCompleted?: boolean;
  completedExercises: number;
  totalExercises: number;
  completedSets: number;
  totalSets: number;
  progressPercent: number;
  sessionStatus: 'not_started' | 'in_progress' | 'completed';
  dayStatus: 'not_started' | 'in_progress' | 'completed';
  completedAt: Date | null;
};

function progressPercent(completedExercises: number, totalExercises: number): number {
  return totalExercises === 0 ? 0 : Math.round((completedExercises / totalExercises) * 100);
}

function isWorkoutExerciseCompleted(workoutExercise: any): boolean {
  const sets = Array.isArray(workoutExercise?.workoutSets) ? workoutExercise.workoutSets : [];
  return sets.length > 0 && sets.every((set: any) => set.completed === true);
}

async function createStartedWorkoutForSchedule(tx: any, schedule: any, userId: string) {
  if (!schedule.programDay?.exercises?.length) {
    throw { status: 400, message: 'Schedule has no planned exercises' };
  }

  return tx.workout.create({
    data: {
      userId,
      name: schedule.programDay.title || `Workout ${formatDateOnly(schedule.date)}`,
      description: schedule.programDay.description || null,
      date: schedule.date,
      exercises: {
        create: schedule.programDay.exercises.map((programExercise: any, index: number) => ({
          exerciseId: programExercise.exerciseId,
          programExerciseId: programExercise.id,
          sets: Number(programExercise.sets) || 1,
          reps: programExercise.reps ?? null,
          duration: programExercise.duration ?? null,
          weight: programExercise.weight ?? null,
          notes: programExercise.notes ?? null,
          order: programExercise.order ?? index + 1,
          workoutSets: {
            create: Array.from({ length: Number(programExercise.sets) || 1 }, (_unused, setIndex) => ({
              setNumber: setIndex + 1,
              reps: programExercise.reps ?? null,
              weight: programExercise.weight ?? null,
              completed: false,
            })),
          },
        })),
      },
    },
  });
}

async function recomputeScheduleProgress(tx: any, scheduleId: string, userId: string, patch: Partial<WorkoutProgressSummary> = {}) {
  const schedule = await tx.workoutSchedule.findFirst({
    where: { id: scheduleId, userId },
    include: {
      workout: {
        include: {
          exercises: {
            include: { workoutSets: true },
            orderBy: { order: 'asc' },
          },
        },
      },
      programDay: {
        include: {
          program: { select: { id: true } },
          exercises: { orderBy: { order: 'asc' } },
        },
      },
    },
  });
  if (!schedule) throw { status: 404, message: 'Schedule not found' };

  const plannedExercises = schedule.programDay?.exercises ?? [];
  const loggedExercises = schedule.workout?.exercises ?? [];
  const completedByProgramExerciseId = new Set(
    loggedExercises
      .filter((exercise: any) => exercise.programExerciseId && isWorkoutExerciseCompleted(exercise))
      .map((exercise: any) => exercise.programExerciseId),
  );
  const fallbackCompletedExerciseIds = new Set(
    loggedExercises
      .filter((exercise: any) => !exercise.programExerciseId && isWorkoutExerciseCompleted(exercise))
      .map((exercise: any) => exercise.exerciseId),
  );

  const totalExercises = plannedExercises.length || loggedExercises.length;
  const completedExercises = plannedExercises.length > 0
    ? plannedExercises.filter((exercise: any) =>
        completedByProgramExerciseId.has(exercise.id) ||
        fallbackCompletedExerciseIds.has(exercise.exerciseId),
      ).length
    : loggedExercises.filter(isWorkoutExerciseCompleted).length;
  const totalSets = plannedExercises.length > 0
    ? plannedExercises.reduce((sum: number, exercise: any) => sum + (Number(exercise.sets) || 1), 0)
    : loggedExercises.reduce((sum: number, exercise: any) => sum + (Array.isArray(exercise.workoutSets) ? exercise.workoutSets.length : 0), 0);
  const completedSets = loggedExercises.reduce(
    (sum: number, exercise: any) => sum + (exercise.workoutSets || []).filter((set: any) => set.completed).length,
    0,
  );
  const percent = progressPercent(completedExercises, totalExercises);
  const completed = totalExercises > 0 && completedExercises === totalExercises;
  const status = completed ? 'COMPLETED' : (schedule.workoutId || schedule.startedAt || completedExercises > 0 ? 'IN_PROGRESS' : 'NOT_STARTED');
  const completedAt = completed ? (schedule.completedAt || new Date()) : null;

  await tx.workoutSchedule.update({
    where: { id: scheduleId },
    data: {
      status,
      progressPercent: percent,
      totalExercises,
      completedExercises,
      totalSets,
      completedSets,
      completedAt,
      startedAt: schedule.startedAt || (schedule.workoutId ? new Date() : null),
    },
  });

  return {
    sessionId: schedule.workoutId,
    workoutId: schedule.workoutId,
    planId: schedule.programDay?.program?.id ?? null,
    dayId: schedule.programDayId,
    completedExercises,
    totalExercises,
    completedSets,
    totalSets,
    progressPercent: percent,
    sessionStatus: completed ? 'completed' : (status === 'IN_PROGRESS' ? 'in_progress' : 'not_started'),
    dayStatus: completed ? 'completed' : (status === 'IN_PROGRESS' ? 'in_progress' : 'not_started'),
    completedAt,
    ...patch,
  } satisfies WorkoutProgressSummary;
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Chu nhat',
  1: 'Thu 2',
  2: 'Thu 3',
  3: 'Thu 4',
  4: 'Thu 5',
  5: 'Thu 6',
  6: 'Thu 7',
};

function nextDateForWeekday(startDate: Date, weekday: number, weekOffset: number) {
  const plannedDate = new Date(startDate);
  const daysAhead = (weekday - plannedDate.getDay() + 7) % 7;
  plannedDate.setDate(plannedDate.getDate() + daysAhead + (weekOffset * 7));
  return plannedDate;
}

async function validateExerciseIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await exerciseRepository.findManyByIds(ids);
  const foundSet = new Set(found.map((e) => e.id));
  const missing = checkMissingExerciseIds(ids, foundSet);
  if (missing.length > 0) {
    throw { status: 400, message: `Exercise not found: ${missing.join(', ')}` };
  }
}

export const workoutQueue = new Queue('workout-generation', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

export const workoutService = {
  async listWorkouts(
    userId: string,
    filters: { startDate?: string; endDate?: string; limit?: string },
  ) {
    const where: any = { userId };
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    return workoutRepository.findMany(where, filters.limit ? parseInt(filters.limit) : 50);
  },

  async getWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: 'Workout not found' };
    return workout;
  },

  async createWorkout(userId: string, data: CreateWorkoutDto) {
    await validateExerciseIds(data.exercises.map((ex) => ex.exerciseId));
    const workoutData: any = { ...data };
    if ((data as any).scheduleId) {
      const schedule = await prisma.workoutSchedule.findFirst({
        where: { id: (data as any).scheduleId, userId },
      });
      if (!schedule) throw { status: 404, message: 'Schedule not found' };
      if (schedule.workoutId) throw { status: 409, message: 'Schedule already has a completed workout log' };
      workoutData.date = schedule.date.toISOString();
    }
    return workoutRepository.create(userId, workoutData);
  },

  async updateWorkout(id: string, userId: string, data: CreateWorkoutDto) {
    const existing = await workoutRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: 'Workout not found' };
    await validateExerciseIds(data.exercises.map((ex) => ex.exerciseId));
    const workoutData: any = { ...data };
    if ((data as any).scheduleId) {
      const schedule = await prisma.workoutSchedule.findFirst({
        where: { id: (data as any).scheduleId, userId },
      });
      if (!schedule) throw { status: 404, message: 'Schedule not found' };
      if (schedule.workoutId && schedule.workoutId !== id) {
        throw { status: 409, message: 'Schedule already has a completed workout log' };
      }
      workoutData.date = schedule.date.toISOString();
    }
    return workoutRepository.update(id, workoutData);
  },

  async deleteWorkout(id: string, userId: string) {
    const workout = await workoutRepository.findOne(id, userId);
    if (!workout) throw { status: 404, message: 'Workout not found' };
    await workoutRepository.delete(id);
    return { message: 'Workout deleted' };
  },

  async getPRs(userId: string, exerciseId?: string) {
    const where: any = { workout: { userId } };
    if (exerciseId) where.exerciseId = exerciseId;

    const exercises = await workoutRepository.findExercisePRs(userId, exerciseId);
    return exercises;
  },

  async updateSet(setId: string, userId: string, data: UpdateWorkoutSetDto) {
    const existing = await workoutRepository.findSetWithOwner(setId, userId);
    if (!existing) throw { status: 404, message: 'Set not found' };
    const updated = await workoutRepository.updateSet(setId, data);
    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: existing.workoutExerciseId, workout: { userId } },
      select: { workoutId: true },
    });
    if (workoutExercise?.workoutId) {
      const schedule = await prisma.workoutSchedule.findFirst({
        where: { userId, workoutId: workoutExercise.workoutId },
        select: { id: true },
      });
      if (schedule) {
        await prisma.$transaction((tx) => recomputeScheduleProgress(tx, schedule.id, userId));
      }
    }
    return updated;
  },

  // POST /workouts/:id/sets - append a single set to an existing workout. Finds or
  // creates the WorkoutExercise(workoutId, exerciseId), then appends a new WorkoutSet
  // with the next set_number for that exercise.
  async addSet(workoutId: string, userId: string, body: {
    exerciseId: string;
    setNumber?: number;
    weight?: number;
    reps?: number;
    rpe?: number;
  }) {
    if (body.rpe !== undefined && (body.rpe < 1 || body.rpe > 10)) {
      throw { status: 400, message: 'rpe must be between 1 and 10' };
    }
    if (!body.exerciseId) throw { status: 400, message: 'exerciseId is required' };

    const workout = await workoutRepository.findOne(workoutId, userId);
    if (!workout) throw { status: 404, message: 'Workout not found' };

    await validateExerciseIds([body.exerciseId]);
    return workoutRepository.appendSet(workoutId, body.exerciseId, body);
  },

  async queueWorkoutGeneration(userId: string, params: any) {
    const job = await workoutQueue.add('generate-workout', { userId, ...params });
    return { message: 'Workout generation started', jobId: job.id };
  },

  async listSchedules(userId: string, params: { limit?: number; startDate?: string; endDate?: string } = {}) {
    const where: any = {
      userId,
      // Only return schedules from ACTIVE programs (or schedules without a programDay link)
      // This prevents archived program schedules from polluting the calendar.
      OR: [
        { programDayId: null },
        { programDay: { program: { status: 'ACTIVE' } } },
      ],
    };
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = parseDateOnly(params.startDate);
      if (params.endDate) where.date.lte = parseDateOnly(params.endDate);
    }
    // When a date range is provided (calendar month query), don't cap results with a low
    // default - a month with 6 training days/week can have up to ~26 schedules.
    // Only apply the limit when explicitly passed (or fallback to 200 for safety).
    const takeLimit = params.startDate || params.endDate
      ? (params.limit ?? 200)
      : (params.limit ?? 20);

    return prisma.workoutSchedule.findMany({
      where,
      orderBy: { date: 'asc' },
      take: takeLimit,
      include: {
        workout: true,
        programDay: {
          include: {
            program: {
              select: { id: true, name: true, sourceType: true, sourcePlanId: true, status: true },
            },
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
  },

  async createSchedule(userId: string, data: { date?: string; programDayId?: string; notes?: string | null }) {
    if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw { status: 400, message: 'date must be YYYY-MM-DD' };
    }
    if (!data.programDayId || typeof data.programDayId !== 'string') {
      throw { status: 400, message: 'programDayId is required' };
    }

    const programDay = await prisma.workoutProgramDay.findFirst({
      where: { id: data.programDayId, program: { userId } },
      include: {
        program: true,
        exercises: {
          include: { exercise: true },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!programDay) throw { status: 404, message: 'Program day not found' };

    const date = parseDateOnly(data.date);
    const existing = await prisma.workoutSchedule.findFirst({
      where: { userId, date },
      include: {
        workout: true,
        programDay: {
          include: {
            program: true,
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
    if (existing) {
      return { alreadyExists: true, schedule: existing };
    }

    const schedule = await prisma.workoutSchedule.create({
      data: {
        userId,
        date,
        programDayId: data.programDayId,
        sourcePlanId: programDay.program.sourcePlanId,
        sourceType: programDay.program.sourceType || 'MANUAL',
        notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : null,
      },
      include: {
        workout: true,
        programDay: {
          include: {
            program: true,
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    return { alreadyExists: false, schedule };
  },

  async startSchedule(userId: string, scheduleId: string) {
    return prisma.$transaction(async (tx) => {
      const schedule = await tx.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: {
          workout: true,
          programDay: {
            include: {
              program: { select: { id: true } },
              exercises: { orderBy: { order: 'asc' } },
            },
          },
        },
      });
      if (!schedule) throw { status: 404, message: 'Schedule not found' };

      let workoutId = schedule.workoutId;
      if (!workoutId) {
        const workout = await createStartedWorkoutForSchedule(tx, schedule, userId);
        workoutId = workout.id;
        await tx.workoutSchedule.update({
          where: { id: schedule.id },
          data: {
            workoutId,
            status: 'IN_PROGRESS',
            startedAt: schedule.startedAt || new Date(),
            totalExercises: schedule.programDay?.exercises?.length ?? 0,
            completedExercises: 0,
            totalSets: (schedule.programDay?.exercises ?? []).reduce(
              (sum: number, exercise: any) => sum + (Number(exercise.sets) || 1),
              0,
            ),
            completedSets: 0,
            progressPercent: 0,
          },
        });
      }

      return recomputeScheduleProgress(tx, schedule.id, userId, {
        sessionId: workoutId,
        workoutId,
      });
    });
  },

  async completeScheduleExercise(userId: string, scheduleId: string, programExerciseId: string) {
    return prisma.$transaction(async (tx) => {
      const schedule = await tx.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: {
          workout: { include: { exercises: { include: { workoutSets: true } } } },
          programDay: {
            include: {
              program: { select: { id: true } },
              exercises: { orderBy: { order: 'asc' } },
            },
          },
        },
      });
      if (!schedule) throw { status: 404, message: 'Schedule not found' };

      const plannedExercise = schedule.programDay?.exercises?.find((exercise: any) => exercise.id === programExerciseId);
      if (!plannedExercise) throw { status: 404, message: 'Planned exercise not found in this schedule' };

      let workoutId = schedule.workoutId;
      if (!workoutId) {
        const workout = await createStartedWorkoutForSchedule(tx, schedule, userId);
        workoutId = workout.id;
        await tx.workoutSchedule.update({
          where: { id: schedule.id },
          data: {
            workoutId,
            status: 'IN_PROGRESS',
            startedAt: schedule.startedAt || new Date(),
          },
        });
      }
      if (!workoutId) throw { status: 500, message: 'Workout session could not be started' };

      let workoutExercise = await tx.workoutExercise.findFirst({
        where: { workoutId, programExerciseId },
        include: { workoutSets: true },
      });

      if (!workoutExercise) {
        workoutExercise = await tx.workoutExercise.create({
          data: {
            workoutId,
            exerciseId: plannedExercise.exerciseId,
            programExerciseId: plannedExercise.id,
            sets: Number(plannedExercise.sets) || 1,
            reps: plannedExercise.reps ?? null,
            duration: plannedExercise.duration ?? null,
            weight: plannedExercise.weight ?? null,
            notes: plannedExercise.notes ?? null,
            order: plannedExercise.order ?? 0,
            workoutSets: {
              create: Array.from({ length: Number(plannedExercise.sets) || 1 }, (_unused, index) => ({
                setNumber: index + 1,
                reps: plannedExercise.reps ?? null,
                weight: plannedExercise.weight ?? null,
                completed: false,
              })),
            },
          },
          include: { workoutSets: true },
        });
      }

      await tx.workoutSet.updateMany({
        where: { workoutExerciseId: workoutExercise.id },
        data: { completed: true },
      });

      return recomputeScheduleProgress(tx, schedule.id, userId, {
        sessionId: workoutId,
        workoutId,
        exerciseId: plannedExercise.exerciseId,
        programExerciseId,
        exerciseCompleted: true,
      });
    });
  },

  async createManualProgram(userId: string, input: CreateManualProgramDto) {
    if (input.days.length !== input.daysPerWeek) {
      throw { status: 400, message: `days must contain exactly ${input.daysPerWeek} training days` };
    }
    if (input.selectedWeekdays.length !== input.daysPerWeek) {
      throw { status: 400, message: `selectedWeekdays must contain exactly ${input.daysPerWeek} weekdays` };
    }
    const uniqueWeekdays = new Set(input.selectedWeekdays);
    if (uniqueWeekdays.size !== input.selectedWeekdays.length) {
      throw { status: 400, message: 'selectedWeekdays must be unique' };
    }

    const exerciseIds = input.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId));
    await validateExerciseIds([...new Set(exerciseIds)]);

    const startDate = parseDateOnly(input.startDate);
    const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
    const shouldReplace = input.replaceExisting !== false;

    const result = await prisma.$transaction(async (tx) => {
      let cancelledScheduleCount = 0;
      if (shouldReplace) {
        const deleteResult = await (tx.workoutSchedule as any).deleteMany({
          where: {
            userId,
            workoutId: null,
            date: { gte: startDate },
          },
        });
        cancelledScheduleCount = deleteResult.count ?? 0;
      }

      await (tx.workoutProgram as any).updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });

      const createdProgram = await (tx.workoutProgram as any).create({
        data: {
          userId,
          name: input.name,
          description: 'Manual workout program',
          sourceType: 'MANUAL',
          goal: input.goal || null,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          status: 'ACTIVE',
          days: {
            create: input.days.map((day) => ({
              dayNumber: day.dayNumber,
              title: day.title,
              description: day.description || null,
              exercises: {
                create: day.exercises.map((exercise, index) => ({
                  exerciseId: exercise.exerciseId,
                  order: exercise.order ?? index + 1,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  restSeconds: exercise.restSeconds,
                  notes: exercise.notes || null,
                })),
              },
            })),
          },
        },
        include: {
          days: {
            include: {
              exercises: {
                include: { exercise: true },
                orderBy: { order: 'asc' },
              },
              schedules: true,
            },
            orderBy: { dayNumber: 'asc' },
          },
        },
      });

      const programDays = [...(createdProgram.days as any[])].sort((a: any, b: any) => a.dayNumber - b.dayNumber);
      const scheduleRows: any[] = [];
      const schedulePreview: any[] = [];

      for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
        for (const [weekdayIndex, weekday] of input.selectedWeekdays.entries()) {
          const day = programDays[weekdayIndex];
          if (!day) continue;
          const plannedDate = nextDateForWeekday(startDate, weekday, weekIndex);
          scheduleRows.push({
            userId,
            date: plannedDate,
            programDayId: day.id,
            sourceType: 'MANUAL',
            notes: `${input.name} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
          });
          if (schedulePreview.length < 14) {
            schedulePreview.push({
              date: formatDateOnly(plannedDate),
              programDayId: day.id,
              dayLabel: CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
            });
          }
        }
      }

      const createResult = await (tx.workoutSchedule as any).createMany({
        data: scheduleRows,
        skipDuplicates: true,
      });

      return {
        createdProgram,
        createdScheduleCount: createResult.count,
        cancelledScheduleCount,
        skippedDuplicateCount: Math.max(0, scheduleRows.length - createResult.count),
        schedulePreview,
      };
    });

    return {
      success: true,
      message: 'Manual workout program created',
      createdProgramId: result.createdProgram.id,
      createdScheduleCount: result.createdScheduleCount,
      cancelledScheduleCount: result.cancelledScheduleCount,
      skippedDuplicateCount: result.skippedDuplicateCount,
      selectedWeekdays: input.selectedWeekdays,
      schedulePreview: result.schedulePreview,
      program: result.createdProgram,
    };
  },

  async getCurrentProgram(userId: string) {
    const program = await prisma.workoutProgram.findFirst({
      where: { userId, status: 'ACTIVE', archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        days: {
          include: {
            schedules: {
              where: { userId },
              orderBy: { date: 'asc' },
              take: 20,
              include: { workout: true },
            },
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { dayNumber: 'asc' },
        },
      },
    });

    if (!program) return null;

    const schedules = await prisma.workoutSchedule.findMany({
      where: {
        userId,
        programDay: { programId: program.id },
      },
      orderBy: { date: 'asc' },
      take: 50,
      include: {
        workout: true,
        programDay: {
          include: {
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    return { ...program, schedules };
  },

  async updateProgram(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgram.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: 'Program not found' };
    const patch: any = {};
    if (typeof data.name === 'string') patch.name = data.name.trim();
    if (typeof data.description === 'string' || data.description === null) patch.description = data.description;
    if (typeof data.goal === 'string' || data.goal === null) patch.goal = data.goal;
    if (typeof data.status === 'string') {
      if (!['ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT'].includes(data.status)) {
        throw { status: 400, message: 'Invalid program status' };
      }
      patch.status = data.status;
      patch.archivedAt = data.status === 'ARCHIVED' ? new Date() : null;
    }
    return prisma.workoutProgram.update({
      where: { id },
      data: patch,
    });
  },

  async deleteProgram(id: string, userId: string) {
    const existing = await prisma.workoutProgram.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: 'Program not found' };
    return prisma.workoutProgram.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
  },

  async updateProgramDay(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgramDay.findFirst({
      where: { id, program: { userId } },
    });
    if (!existing) throw { status: 404, message: 'Program day not found' };
    const patch: any = {};
    if (typeof data.title === 'string') patch.title = data.title.trim();
    if (typeof data.description === 'string' || data.description === null) patch.description = data.description;
    if (typeof data.duration === 'number' || data.duration === null) patch.duration = data.duration;
    return prisma.workoutProgramDay.update({
      where: { id },
      data: patch,
    });
  },

  async addProgramExercise(programDayId: string, userId: string, data: any) {
    const day = await prisma.workoutProgramDay.findFirst({
      where: { id: programDayId, program: { userId } },
      include: { _count: { select: { exercises: true } } },
    });
    if (!day) throw { status: 404, message: 'Program day not found' };
    if (!data.exerciseId || typeof data.exerciseId !== 'string') {
      throw { status: 400, message: 'exerciseId is required' };
    }
    await validateExerciseIds([data.exerciseId]);

    return prisma.workoutProgramExercise.create({
      data: {
        programDayId,
        exerciseId: data.exerciseId,
        order: typeof data.order === 'number' ? data.order : day._count.exercises + 1,
        sets: typeof data.sets === 'number' ? data.sets : 3,
        reps: typeof data.reps === 'number' ? data.reps : 10,
        restSeconds: typeof data.restSeconds === 'number' ? data.restSeconds : 90,
        notes: typeof data.notes === 'string' ? data.notes : undefined,
      },
      include: { exercise: true },
    });
  },

  async updateProgramExercise(id: string, userId: string, data: any) {
    const existing = await prisma.workoutProgramExercise.findFirst({
      where: { id, programDay: { program: { userId } } },
    });
    if (!existing) throw { status: 404, message: 'Program exercise not found' };
    
    if (data.exerciseId) {
      await validateExerciseIds([data.exerciseId]);
    }

    const patch: any = {};
    if (typeof data.exerciseId === 'string') patch.exerciseId = data.exerciseId;
    if (typeof data.order === 'number') patch.order = data.order;
    if (typeof data.sets === 'number' || data.sets === null) patch.sets = data.sets;
    if (typeof data.reps === 'number' || data.reps === null) patch.reps = data.reps;
    if (typeof data.restSeconds === 'number' || data.restSeconds === null) patch.restSeconds = data.restSeconds;
    if (typeof data.notes === 'string' || data.notes === null) patch.notes = data.notes;
    
    return prisma.workoutProgramExercise.update({
      where: { id },
      data: patch,
    });
  },

  async deleteProgramExercise(id: string, userId: string) {
    const existing = await prisma.workoutProgramExercise.findFirst({
      where: { id, programDay: { program: { userId } } },
      include: { programDay: { include: { _count: { select: { exercises: true } } } } },
    });
    if (!existing) throw { status: 404, message: 'Program exercise not found' };
    if (existing.programDay._count.exercises <= 1) {
      throw { status: 409, message: 'Cannot delete the last exercise in a program day' };
    }
    return prisma.workoutProgramExercise.delete({
      where: { id },
    });
  },

  async deleteSchedule(id: string, userId: string) {
    const existing = await prisma.workoutSchedule.findFirst({ where: { id, userId } });
    if (!existing) throw { status: 404, message: 'Schedule not found' };
    if (existing.workoutId) {
      throw { status: 409, message: 'Cannot delete a schedule that already has a completed workout log' };
    }
    return prisma.workoutSchedule.delete({ where: { id } });
  },

  async importAiPlanToSchedule(userId: string, input: ImportAiPlanDto) {
    const existingProgram = await (prisma.workoutProgram as any).findFirst({
      where: {
        userId,
        sourcePlanId: input.sourcePlanId,
        aiPlanVersion: input.sourcePlanVersion ?? null,
      },
      include: {
        days: {
          include: {
            schedules: true,
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { dayNumber: 'asc' },
        },
      },
    });

    if (existingProgram) {
      const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
      const startDate = parseDateOnly(input.startDate);
      const selectedWeekdays = input.selectedWeekdays;

      if (selectedWeekdays) {
        const uniqueWeekdays = new Set(selectedWeekdays);
        if (uniqueWeekdays.size !== selectedWeekdays.length || selectedWeekdays.length !== input.daysPerWeek) {
          throw {
            status: 400,
            message: `Plan has ${input.daysPerWeek} sessions per week. Please select exactly ${input.daysPerWeek} training days.`,
          };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        let cancelledScheduleCount = 0;
        const shouldReplace = input.replaceExisting !== false;
        if (shouldReplace) {
          const deleteResult = await (tx.workoutSchedule as any).deleteMany({
            where: {
              userId,
              workoutId: null,
              date: { gte: startDate },
            },
          });
          cancelledScheduleCount = deleteResult.count ?? 0;
        }

        const otherActivePrograms = await (tx.workoutProgram as any).findMany({
          where: { userId, status: 'ACTIVE', id: { not: existingProgram.id } },
          select: { id: true },
        });
        if (otherActivePrograms.length > 0) {
          const otherProgramIds: string[] = otherActivePrograms.map((p: any) => p.id);
          const otherDays = await (tx.workoutProgramDay as any).findMany({
            where: { programId: { in: otherProgramIds } },
            select: { id: true },
          });
          if (otherDays.length > 0) {
            await (tx.workoutSchedule as any).deleteMany({
              where: {
                userId,
                programDayId: { in: otherDays.map((d: any) => d.id) },
                workoutId: null,
              },
            });
          }
        }

        await (tx.workoutProgram as any).updateMany({
          where: {
            userId,
            status: 'ACTIVE',
            id: { not: existingProgram.id },
          },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });

        const program = await (tx.workoutProgram as any).update({
          where: { id: existingProgram.id },
          data: { status: 'ACTIVE', archivedAt: null },
          include: {
            days: {
              include: {
                schedules: true,
                exercises: {
                  include: { exercise: true },
                  orderBy: { order: 'asc' },
                },
              },
              orderBy: { dayNumber: 'asc' },
            },
          },
        });

        const scheduleRows: any[] = [];
        const schedulePreview: any[] = [];
        const programDays = [...(program.days as any[])].sort((a: any, b: any) => a.dayNumber - b.dayNumber);

        if (selectedWeekdays) {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const [weekdayIndex, weekday] of selectedWeekdays.entries()) {
              const day = programDays[weekdayIndex];
              if (!day) continue;
              const plannedDate = nextDateForWeekday(startDate, weekday, weekIndex);
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: 'AI_PLAN',
                notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel: CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
                });
              }
            }
          }
        } else {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const day of programDays) {
              const plannedDate = new Date(startDate);
              plannedDate.setDate(plannedDate.getDate() + (weekIndex * 7) + (day.dayNumber - 1));
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: 'AI_PLAN',
                notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel: `Day ${day.dayNumber}`,
                });
              }
            }
          }
        }

        const createResult = scheduleRows.length > 0
          ? await (tx.workoutSchedule as any).createMany({ data: scheduleRows, skipDuplicates: true })
          : { count: 0 };

        return {
          program,
          createdScheduleCount: createResult.count,
          cancelledScheduleCount,
          skippedDuplicateCount: Math.max(0, scheduleRows.length - createResult.count),
          schedulePreview,
        };
      });

      const totalScheduleCount = (result.program.days as any[]).reduce(
        (count: number, day: any) => count + (day.schedules?.length || 0),
        0,
      ) + result.createdScheduleCount;
      return {
        success: true,
        message: 'AI plan already saved to workout schedule',
        sourcePlanId: input.sourcePlanId,
        createdProgramId: existingProgram.id,
        createdScheduleCount: result.createdScheduleCount,
        cancelledScheduleCount: result.cancelledScheduleCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        alreadyExists: true,
        selectedWeekdays: input.selectedWeekdays,
        schedulePreview: result.schedulePreview,
        totalScheduleCount,
        program: result.program,
      };
    }

    const exerciseCatalog = await exerciseRepository.findMany({});
    const catalog = (exerciseCatalog.data as Array<{ id: string; exerciseName: string }>).map((exercise) => ({
      id: exercise.id,
      rawName: exercise.exerciseName,
      name: normalizeExerciseName(exercise.exerciseName),
    }));

    const unmatchedExercises = new Set<string>();
    const mappedDays: MappedAiDay[] = input.weeklySchedule.map((day, dayIndex) => {
      const rawTitle = day.goal || day.focus || String(day.day ?? 'AI Workout Day');
      const title = sanitizeImportedDayTitle(rawTitle, dayIndex);
      const exercises: MappedAiExercise[] = [];

      for (const exercise of day.exercises) {
        // If the AI provided an exerciseId, prefer it and DO NOT fallback to name matching.
        if (exercise.exerciseId && typeof exercise.exerciseId === 'string' && exercise.exerciseId.trim()) {
          const found = catalog.find((c) => c.id === exercise.exerciseId);
          if (!found) {
            const match = findExerciseMatch(catalog, exercise.name);
            if (!match) {
              unmatchedExercises.add(exercise.name);
              continue;
            }
            const parsedReps = Number.parseInt(String(exercise.reps).match(/\d+/)?.[0] ?? '', 10);
            exercises.push({
              exerciseId: match.id,
              order: exercise.order ?? exercises.length + 1,
              sets: exercise.sets,
              reps: Number.isFinite(parsedReps) ? parsedReps : null,
              restSeconds: exercise.restSeconds,
              notes: sanitizeImportedExerciseNote(exercise.note),
            });
            continue;
          }
          const parsedReps = Number.parseInt(String(exercise.reps).match(/\d+/)?.[0] ?? '', 10);
          exercises.push({
            exerciseId: found.id,
            order: exercise.order ?? exercises.length + 1,
            sets: exercise.sets,
            reps: Number.isFinite(parsedReps) ? parsedReps : null,
            restSeconds: exercise.restSeconds,
            notes: sanitizeImportedExerciseNote(exercise.note),
          });
          continue;
        }

        // No exerciseId provided: fallback to name matching (legacy support)
        const match = findExerciseMatch(catalog, exercise.name);
        if (!match) {
          unmatchedExercises.add(exercise.name);
          continue;
        }

        const parsedReps = Number.parseInt(String(exercise.reps).match(/\d+/)?.[0] ?? '', 10);

        exercises.push({
          exerciseId: match.id,
          order: exercise.order ?? exercises.length + 1,
          sets: exercise.sets,
          reps: Number.isFinite(parsedReps) ? parsedReps : null,
          restSeconds: exercise.restSeconds,
          notes: sanitizeImportedExerciseNote(exercise.note),
        });
      }

      if (exercises.length === 0) {
        unmatchedExercises.add(title);
      }

      return {
        title,
        description: sanitizeImportedText(
          day.cardio || day.notes,
          'Tap trung vao ky thuat dung, kiem soat nhip tap va tang tien tu tu.',
        ),
        exercises,
      };
    });

    if (unmatchedExercises.size > 0) {
      throw {
        status: 400,
        message: `Unable to map AI exercises to exercise master: ${Array.from(unmatchedExercises).join(', ')}`,
      };
    }

    const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
    const startDate = parseDateOnly(input.startDate);
    const selectedWeekdays = input.selectedWeekdays;

    if (selectedWeekdays) {
      const uniqueWeekdays = new Set(selectedWeekdays);
      if (uniqueWeekdays.size !== selectedWeekdays.length || selectedWeekdays.length !== input.daysPerWeek) {
        throw {
          status: 400,
          message: `Plan has ${input.daysPerWeek} sessions per week. Please select exactly ${input.daysPerWeek} training days.`,
        };
      }
    }

    const shouldReplace = input.replaceExisting !== false; // default true

    const result = await prisma.$transaction(async (tx) => {
      let cancelledScheduleCount = 0;

      if (shouldReplace) {
        // Delete ALL incomplete schedules for this user from startDate onwards.
        // We cannot limit by programDayId because old archived programs' schedules
        // are still in the DB and their dates conflict with new ones due to
        // @@unique([userId, date]). Deleting only active-program schedules leaves
        // stale dates that cause createMany({ skipDuplicates: true }) to silently skip
        // the new schedules (root cause: user sees only 1 schedule instead of 48).
        const deleteResult = await (tx.workoutSchedule as any).deleteMany({
          where: {
            userId,
            workoutId: null,       // Keep schedules that have a completed workout log
            date: { gte: startDate }, // Only future/current dates from the new plan start
          },
        });
        cancelledScheduleCount = deleteResult.count ?? 0;

        // Archive all currently ACTIVE programs for this user
        await (tx.workoutProgram as any).updateMany({
          where: { userId, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
      } else {
        // Append mode: still archive other active programs so only one is ACTIVE at a time
        await (tx.workoutProgram as any).updateMany({
          where: { userId, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
      }

      const createdProgram = await (tx.workoutProgram as any).create({
        data: {
          userId,
          name: input.sourcePlanName || `${goalLabel(input.goal)} Plan`,
          description: `Imported from AI plan ${input.sourcePlanId}`,
          sourcePlanId: input.sourcePlanId,
          sourceType: 'AI_PLAN',
          aiPlanVersion: input.sourcePlanVersion ?? null,
          goal: input.goal,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          status: 'ACTIVE',
          days: {
            create: mappedDays.map((day, dayIndex) => ({
              dayNumber: dayIndex + 1,
              title: day.title,
              description: day.description,
              exercises: {
                create: day.exercises.map((exercise, exerciseIndex) => ({
                  exerciseId: exercise.exerciseId,
                  order: exercise.order || exerciseIndex + 1,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  restSeconds: exercise.restSeconds,
                  notes: exercise.notes,
                })),
              },
            })),
          },
        },
        include: {
          days: {
            include: {
              exercises: {
                include: { exercise: true },
                orderBy: { order: 'asc' },
              },
              schedules: true,
            },
            orderBy: { dayNumber: 'asc' },
          },
        },
      });

      const scheduleRows: any[] = [];
      const schedulePreview: any[] = [];
      const programDays = [...(createdProgram.days as any[])].sort((a: any, b: any) => a.dayNumber - b.dayNumber);

      if (selectedWeekdays) {
        for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
          for (const [weekdayIndex, weekday] of selectedWeekdays.entries()) {
            const day = programDays[weekdayIndex];
            if (!day) continue;
            const plannedDate = nextDateForWeekday(startDate, weekday, weekIndex);
            scheduleRows.push({
              userId,
              date: plannedDate,
              programDayId: day.id,
              sourcePlanId: input.sourcePlanId,
              sourceType: 'AI_PLAN',
              notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
            });
            if (schedulePreview.length < 14) {
              schedulePreview.push({
                date: formatDateOnly(plannedDate),
                programDayId: day.id,
                dayLabel: CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
              });
            }
          }
        }
      } else {
        for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
          for (const day of programDays) {
            const plannedDate = new Date(startDate);
            plannedDate.setDate(plannedDate.getDate() + (weekIndex * 7) + (day.dayNumber - 1));
            scheduleRows.push({
              userId,
              date: plannedDate,
              programDayId: day.id,
              sourcePlanId: input.sourcePlanId,
              sourceType: 'AI_PLAN',
              notes: `${input.sourcePlanName || goalLabel(input.goal)} - Week ${weekIndex + 1} Day ${day.dayNumber}`,
            });
            if (schedulePreview.length < 14) {
              schedulePreview.push({
                date: formatDateOnly(plannedDate),
                programDayId: day.id,
                dayLabel: `Day ${day.dayNumber}`,
              });
            }
          }
        }
      }

      const createResult = await (tx.workoutSchedule as any).createMany({
        data: scheduleRows,
        skipDuplicates: true,
      });

      return {
        createdProgram,
        createdScheduleCount: createResult.count,
        cancelledScheduleCount,
        skippedDuplicateCount: Math.max(0, scheduleRows.length - createResult.count),
        schedulePreview,
      };
    });

    return {
      success: true,
      message: 'AI plan imported to workout schedule',
      sourcePlanId: input.sourcePlanId,
      createdProgramId: result.createdProgram.id,
      createdScheduleCount: result.createdScheduleCount,
      cancelledScheduleCount: result.cancelledScheduleCount,
      skippedDuplicateCount: result.skippedDuplicateCount,
      alreadyExists: false,
      selectedWeekdays,
      schedulePreview: result.schedulePreview,
      program: result.createdProgram,
    };
  },
};

function normalizeExerciseName(name: string) {
  const aliasNormalized = name
    .toLowerCase()
    .replace(/\boverhead\s+dumbbell\s+extension\b/gi, 'overhead triceps extension')
    .replace(/\boverhead\s+tricep[s]?\s+extension\b/gi, 'overhead triceps extension')
    .replace(/\btricep[s]?\s+pushdowns?\b/gi, 'triceps pushdown')
    .replace(/\blat\s+pull[-\s]?downs?\b/gi, 'lat pulldown')
    .replace(/\bpull[-\s]?downs?\b/gi, 'pulldown')
    .replace(/\bpull[-\s]?ups?\b/gi, 'pull up')
    .replace(/\btricep\b/gi, 'triceps');

  return aliasNormalized
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findExerciseMatch(catalog: NormalizedExerciseCatalogItem[], exerciseName: string) {
  const normalized = normalizeExerciseName(exerciseName);
  const exact = catalog.find((exercise) => exercise.name === normalized);
  if (exact) return exact;
  // Token-based matching with simple singularization to handle plurals (rows -> row)
  const tokens = normalized.split(' ').filter(Boolean);
  const tokenVariants = new Set<string>();
  for (const t of tokens) {
    tokenVariants.add(t);
    // naive singularization: drop trailing 's' for common plurals, avoid words like 'press' (ends with 'ss')
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) {
      tokenVariants.add(t.slice(0, -1));
    }
  }

  const subsetMatch = catalog.find((exercise) => {
    const catalogTokens = exercise.name.split(' ').filter(Boolean);
    const catalogTokenSet = new Set<string>();
    for (const ct of catalogTokens) {
      catalogTokenSet.add(ct);
      if (ct.length > 3 && ct.endsWith('s') && !ct.endsWith('ss')) {
        catalogTokenSet.add(ct.slice(0, -1));
      }
    }

    // Check if all input token variants are present in catalog tokens
    const allInputPresent = [...tokenVariants].every((tok) => catalogTokenSet.has(tok));
    if (allInputPresent) return true;

    // Check weaker match: any input token appears in catalog tokens
    const anyInputPresent = [...tokenVariants].some((tok) => catalogTokenSet.has(tok));
    // And catalog contains a key token like 'barbell' or movement name
    const strongCatalogToken = ['barbell', 'dumbbell', 'press', 'row', 'squat', 'deadlift', 'curl'];
    const hasStrong = strongCatalogToken.some((k) => catalogTokenSet.has(k));
    return anyInputPresent && hasStrong;
  });
  if (subsetMatch) return subsetMatch;

  // Fallback: substring contains checks against normalized raw names
  const contains = catalog.find((exercise) => exercise.name.includes(normalized) || normalized.includes(exercise.name));
  if (contains) return contains;

  return catalog.find((exercise) => {
    const raw = exercise.rawName.toLowerCase();
    return raw.includes(normalized) || normalized.includes(raw);
  });
}

function parseDateOnly(dateValue?: string) {
  if (!dateValue) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
