import { Queue } from 'bullmq';
import { prisma } from '../repositories/prisma';
import { workoutRepository } from '../repositories/workout.repository';
import { exerciseRepository } from '../repositories/exercise.repository';
import { checkMissingExerciseIds } from '../utils/workout-validation';
import type { CreateWorkoutDto, UpdateWorkoutSetDto, ImportAiPlanDto } from '../models/fitness.models';

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
    return workoutRepository.create(userId, data);
  },

  async updateWorkout(id: string, userId: string, data: CreateWorkoutDto) {
    const existing = await workoutRepository.findOne(id, userId);
    if (!existing) throw { status: 404, message: 'Workout not found' };
    await validateExerciseIds(data.exercises.map((ex) => ex.exerciseId));
    return workoutRepository.update(id, data);
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
    return workoutRepository.updateSet(setId, data);
  },

  // POST /workouts/:id/sets — append a single set to an existing workout. Finds or
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

  async listSchedules(userId: string, limit = 20) {
    return prisma.workoutSchedule.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      take: limit,
      include: {
        workout: true,
        programDay: {
          include: {
            program: true,
            exercises: {
              include: {
                exercise: true,
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
  },

  async importAiPlanToSchedule(userId: string, input: ImportAiPlanDto) {
    const existingProgram = await (prisma.workoutProgram as any).findFirst({
      where: {
        userId,
        sourcePlanId: input.sourcePlanId,
      },
      include: {
        days: {
          include: {
            schedules: true,
          },
        },
      },
    });

    if (existingProgram) {
      const existingScheduleCount = (existingProgram.days as any[]).reduce(
        (count: number, day: any) => count + (day.schedules?.length || 0),
        0,
      );
      return {
        success: true,
        message: 'AI plan already saved to workout schedule',
        sourcePlanId: input.sourcePlanId,
        createdProgramId: existingProgram.id,
        createdScheduleCount: existingScheduleCount,
        skippedDuplicateCount: existingScheduleCount,
        alreadyExists: true,
      };
    }

    const exerciseCatalog = await exerciseRepository.findMany({});
    const catalog = (exerciseCatalog.data as Array<{ id: string; exerciseName: string }>).map((exercise) => ({
      id: exercise.id,
      rawName: exercise.exerciseName,
      name: normalizeExerciseName(exercise.exerciseName),
    }));

    const unmatchedExercises = new Set<string>();
    const mappedDays: MappedAiDay[] = input.weeklySchedule.map((day) => {
      const title = day.goal || day.focus || String(day.day ?? 'AI Workout Day');
      const exercises: MappedAiExercise[] = [];

      for (const exercise of day.exercises) {
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
          notes: exercise.note,
        });
      }

      if (exercises.length === 0) {
        unmatchedExercises.add(title);
      }

      return {
        title,
        description: day.cardio || day.notes,
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

    const result = await prisma.$transaction(async (tx) => {
      const createdProgram = await (tx.workoutProgram as any).create({
        data: {
          userId,
          name: input.sourcePlanName || `AI Plan - ${input.goal}`,
          description: `Imported from AI plan ${input.sourcePlanId}`,
          sourcePlanId: input.sourcePlanId,
          sourceType: 'AI_PLAN',
          aiPlanVersion: input.sourcePlanVersion ?? null,
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
              exercises: true,
            },
            orderBy: { dayNumber: 'asc' },
          },
        },
      });

      const scheduleRows: any[] = [];
      const programDays = [...(createdProgram.days as any[])].sort((a: any, b: any) => a.dayNumber - b.dayNumber);

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
            notes: `${input.sourcePlanName || input.goal} · Week ${weekIndex + 1} Day ${day.dayNumber}`,
          });
        }
      }

      await (tx.workoutSchedule as any).createMany({
        data: scheduleRows,
        skipDuplicates: true,
      });

      return { createdProgram, createdScheduleCount: scheduleRows.length };
    });

    return {
      success: true,
      message: 'AI plan imported to workout schedule',
      sourcePlanId: input.sourcePlanId,
      createdProgramId: result.createdProgram.id,
      createdScheduleCount: result.createdScheduleCount,
      skippedDuplicateCount: 0,
      alreadyExists: false,
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

  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  return parsed;
}
