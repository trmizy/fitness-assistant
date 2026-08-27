import { prisma } from "./prisma";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

const workoutInclude = {
  exercises: {
    include: {
      exercise: true,
      workoutSets: { orderBy: { setNumber: "asc" as const } },
    },
    orderBy: { order: "asc" as const },
  },
};

export const workoutRepository = {
  findMany: (where: Record<string, any>, limit = 50) =>
    prisma.workout.findMany({
      where,
      include: workoutInclude,
      orderBy: { date: "desc" },
      take: limit,
    }),

  findOne: (id: string, userId: string) =>
    prisma.workout.findFirst({
      where: { id, userId },
      include: workoutInclude,
    }),

  create: async (userId: string, data: any) => {
    // History-protection snapshot (Gate 4, exerciseNameSnapshot's schema
    // doc comment) — resolved once up front so a later exercise rename
    // never retroactively changes what this logged set displays.
    const exerciseIds = [...new Set(data.exercises.map((ex: any) => ex.exerciseId))] as string[];
    const exerciseRows = await prisma.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, exerciseName: true },
    });
    const nameById = new Map(exerciseRows.map((e) => [e.id, e.exerciseName]));

    return prisma.$transaction(async (tx) => {
      const workout = await tx.workout.create({
        data: {
          userId,
          name: data.name,
          description: data.description,
          // Defense-in-depth for the same bug workout.service.ts's
          // createWorkout was fixed for (see its comment there): a second,
          // independent caller of this repository function
          // (workout.worker.ts's AI-generated-workout job) never passes a
          // `date` either, and would otherwise hit this exact fallback. Use
          // todayAsScheduleDate() (VN-timezone-aware, UTC-midnight-anchored
          // calendar-day label — the same convention every date comparison
          // in this codebase expects), not a raw `new Date()` instant, which
          // reads as "yesterday" and gets immediately schedule-locked for
          // roughly 7 hours of every real day.
          date: data.date ? new Date(data.date) : todayAsScheduleDate(),
          duration: data.duration,
          notes: data.notes,
          exercises: {
            create: data.exercises.map((ex: any, index: number) => ({
              exerciseId: ex.exerciseId,
              programExerciseId: ex.programExerciseId ?? null,
              exerciseNameSnapshot: nameById.get(ex.exerciseId) ?? null,
              sets: ex.sets,
              reps: ex.reps,
              duration: ex.duration,
              weight: ex.weight,
              notes: ex.notes,
              order: index,
              workoutSets: {
                create: Array.from({ length: ex.sets }, (_, i) => ({
                  setNumber: i + 1,
                  reps: ex.reps ?? null,
                  weight: ex.weight ?? null,
                  rpe: ex.rpe ?? null,
                  rir: ex.rir ?? null,
                  bodyWeightAtSetKg: ex.bodyWeightAtSetKg ?? null,
                  durationSeconds: ex.durationSeconds ?? ex.duration ?? null,
                  distanceMeters: ex.distanceMeters ?? null,
                  completed: ex.completed === false ? false : true,
                })),
              },
            })),
          },
        },
        include: workoutInclude,
      });

      if (data.scheduleId) {
        const totalExercises = data.exercises.length;
        const totalSets = data.exercises.reduce(
          (sum: number, ex: any) => sum + Number(ex.sets || 0),
          0,
        );
        await tx.workoutSchedule.update({
          where: { id: data.scheduleId },
          data: {
            workoutId: workout.id,
            status: "COMPLETED",
            progressPercent: 100,
            completedAt: new Date(),
            totalExercises,
            completedExercises: totalExercises,
            totalSets,
            completedSets: totalSets,
            durationSeconds:
              typeof data.duration === "number"
                ? data.duration * 60
                : undefined,
          },
        });
      }

      return workout;
    });
  },

  async update(id: string, data: any) {
    // Same history-protection snapshot resolution as create() above.
    const exerciseIds = [...new Set(data.exercises.map((ex: any) => ex.exerciseId))] as string[];
    const exerciseRows = await prisma.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, exerciseName: true },
    });
    const nameById = new Map(exerciseRows.map((e) => [e.id, e.exerciseName]));

    return prisma.$transaction(async (tx) => {
      await tx.workoutExercise.deleteMany({ where: { workoutId: id } });
      const workout = await tx.workout.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          date: data.date ? new Date(data.date) : undefined,
          duration: data.duration,
          notes: data.notes,
          exercises: {
            create: data.exercises.map((ex: any, index: number) => ({
              exerciseId: ex.exerciseId,
              programExerciseId: ex.programExerciseId ?? null,
              exerciseNameSnapshot: nameById.get(ex.exerciseId) ?? null,
              sets: ex.sets,
              reps: ex.reps,
              duration: ex.duration,
              weight: ex.weight,
              notes: ex.notes,
              order: index,
              workoutSets: {
                create: Array.from({ length: ex.sets }, (_, i) => ({
                  setNumber: i + 1,
                  reps: ex.reps ?? null,
                  weight: ex.weight ?? null,
                  rpe: ex.rpe ?? null,
                  rir: ex.rir ?? null,
                  bodyWeightAtSetKg: ex.bodyWeightAtSetKg ?? null,
                  durationSeconds: ex.durationSeconds ?? ex.duration ?? null,
                  distanceMeters: ex.distanceMeters ?? null,
                  completed: ex.completed === false ? false : true,
                })),
              },
            })),
          },
        },
        include: workoutInclude,
      });

      if (data.scheduleId) {
        const totalExercises = data.exercises.length;
        const totalSets = data.exercises.reduce(
          (sum: number, ex: any) => sum + Number(ex.sets || 0),
          0,
        );
        await tx.workoutSchedule.update({
          where: { id: data.scheduleId },
          data: {
            workoutId: id,
            status: "COMPLETED",
            progressPercent: 100,
            completedAt: new Date(),
            totalExercises,
            completedExercises: totalExercises,
            totalSets,
            completedSets: totalSets,
            durationSeconds:
              typeof data.duration === "number"
                ? data.duration * 60
                : undefined,
          },
        });
      }

      return workout;
    });
  },

  delete: (id: string) => prisma.workout.delete({ where: { id } }),

  updateSet: (
    setId: string,
    data: {
      reps?: number;
      weight?: number;
      rpe?: number;
      rir?: number;
      completed?: boolean;
      setType?: string | null;
      tempo?: string | null;
      rangeOfMotion?: string | null;
      side?: string | null;
      painScore?: number | null;
      techniqueNotes?: string | null;
      bodyWeightAtSetKg?: number | null;
      durationSeconds?: number | null;
      distanceMeters?: number | null;
    },
  ) =>
    prisma.workoutSet.update({
      where: { id: setId },
      data,
    }),

  findSetWithOwner: (setId: string, userId: string) =>
    prisma.workoutSet.findFirst({
      where: {
        id: setId,
        workoutExercise: { workout: { userId } },
      },
    }),

  async findExercisePRs(userId: string, exerciseId?: string) {
    const where: any = { workout: { userId } };
    if (exerciseId) where.exerciseId = exerciseId;

    const records = await prisma.workoutExercise.findMany({
      where,
      include: { exercise: true, workout: { select: { date: true } } },
      orderBy: { weight: "desc" },
    });

    // Group by exercise, keep max weight per exercise
    const prMap = new Map<string, any>();
    for (const r of records) {
      if (!r.weight) continue;
      const key = r.exerciseId;
      if (!prMap.has(key) || r.weight > prMap.get(key).weight) {
        prMap.set(key, {
          exerciseId: r.exerciseId,
          exerciseName: r.exercise?.exerciseName,
          weight: r.weight,
          reps: r.reps,
          sets: r.sets,
          date: r.workout?.date,
        });
      }
    }

    return Array.from(prMap.values());
  },

  // All logged sets for the given exercises, for this user, EXCLUDING the
  // named workout — the "history to beat" when deciding whether the
  // just-completed session set a new PR (see workout.service.ts
  // getSessionSummary). Raw rows only: the estimated-1RM comparison lives
  // in the service layer, next to the one place that formula is imported
  // from, not duplicated here.
  findPriorSetsForExercises: (
    userId: string,
    exerciseIds: string[],
    excludeWorkoutId: string,
  ) => {
    if (exerciseIds.length === 0) return Promise.resolve([]);
    return prisma.workoutExercise.findMany({
      where: {
        exerciseId: { in: exerciseIds },
        workoutId: { not: excludeWorkoutId },
        weight: { not: null },
        workout: { userId },
      },
      select: { exerciseId: true, weight: true, reps: true },
    });
  },

  // Same "history to beat" query as findPriorSetsForExercises above, but for
  // bodyweight exercises (weight === null — no added load). Kept as a
  // separate method rather than widening the existing query's `weight`
  // filter: findPriorSetsForExercises's weight-based PR comparison would
  // break if bodyweight rows (weight null) started flowing through it, so
  // this is additive, not a change to existing behavior. See
  // docs/OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md's "Bodyweight exercise
  // semantics" row: bodyweight-only exercises never got PR credit before
  // this, because both findPriorSetsForExercises and findExercisePRs
  // require weight != null.
  findPriorBodyweightRepsForExercises: (
    userId: string,
    exerciseIds: string[],
    excludeWorkoutId: string,
  ) => {
    if (exerciseIds.length === 0) return Promise.resolve([]);
    return prisma.workoutExercise.findMany({
      where: {
        exerciseId: { in: exerciseIds },
        workoutId: { not: excludeWorkoutId },
        weight: null,
        reps: { not: null },
        workout: { userId },
      },
      select: { exerciseId: true, reps: true },
    });
  },

  findForStats: (userId: string, startDate: Date) =>
    prisma.workout.findMany({
      where: { userId, date: { gte: startDate } },
      include: { exercises: true },
    }),

  // "Previous performance" prefill (docs/TRAINING_PROGRESSION_ARCHITECTURE.md
  // §3, gap analysis P0 #1) — the most recent PRIOR session's real logged
  // sets for one exercise, per-set (not the WorkoutExercise-level aggregate
  // findPriorSetsForExercises above uses for PR comparison). Deliberately
  // separate from any recommended-target computation — this is reference
  // context only ("what you actually did last time"), never mixed with
  // exercise-progression.engine.ts's prescriptive nextTarget.
  findLastCompletedSetsForExercise: async (
    userId: string,
    exerciseId: string,
    excludeWorkoutId?: string,
  ) => {
    // Real bug found + fixed via this session's own E2E testing (same bug
    // class as the createWorkout date-defaulting fix elsewhere in this
    // file — see that comment for the full mechanism): a `date: { lt: new
    // Date() }` clause used to sit here, intending "only a session that has
    // already happened." But `Workout.date` is a UTC-midnight-anchored
    // calendar-day LABEL (matching every other date in this codebase, see
    // schedule-lock.util.ts's module doc comment), not a real instant —
    // comparing it against a raw `new Date()` instant is the same category
    // error. For roughly 7 hours of every real day (VN midnight-7am), a
    // workout genuinely completed "today" (VN-local) has a date label that
    // is still technically in the future relative to raw UTC "now",
    // wrongly excluding it — "previous performance" silently returned
    // hasHistory:false for a session the user had just that day completed.
    // Dropped entirely: `excludeWorkoutId` already correctly excludes the
    // current in-progress session by id (the actual intent), and
    // `orderBy: date desc` + `findFirst` already picks the most recent
    // completed session — no date-instant filter was ever needed for
    // correctness here.
    const priorWorkoutExercise = await prisma.workoutExercise.findFirst({
      where: {
        exerciseId,
        workout: { userId },
        ...(excludeWorkoutId ? { workoutId: { not: excludeWorkoutId } } : {}),
        workoutSets: { some: { completed: true } },
      },
      orderBy: { workout: { date: "desc" } },
      select: {
        workout: { select: { date: true } },
        workoutSets: {
          where: { completed: true },
          orderBy: { setNumber: "asc" },
          select: {
            setNumber: true,
            weight: true,
            bodyWeightAtSetKg: true,
            reps: true,
            rpe: true,
            rir: true,
            setType: true,
            durationSeconds: true,
            distanceMeters: true,
          },
        },
      },
    });
    return priorWorkoutExercise ?? null;
  },

  // Multi-session variant of findLastCompletedSetsForExercise above, for
  // exercise-progression.engine.ts (docs/TRAINING_PROGRESSION_ARCHITECTURE.md
  // §3), which needs at least 2 recent sessions to compare, not just the
  // single most recent one. Same completed-sets-only / no date-instant
  // filter reasoning as the single-session version.
  findRecentCompletedSessionsForExercise: async (
    userId: string,
    exerciseId: string,
    limit: number,
    excludeWorkoutId?: string,
  ) => {
    const workoutExercises = await prisma.workoutExercise.findMany({
      where: {
        exerciseId,
        workout: { userId },
        ...(excludeWorkoutId ? { workoutId: { not: excludeWorkoutId } } : {}),
        workoutSets: { some: { completed: true } },
      },
      orderBy: { workout: { date: "desc" } },
      take: limit,
      select: {
        workout: { select: { id: true, date: true, name: true } },
        // Roadmap P3.6 "Exercise history detail page" — §26's own "notes"
        // bullet reads this per real logged instance. Purely additive
        // (existing callers, e.g. exercise-progression.engine.ts's input
        // mapping, only ever destructure the fields they already used).
        notes: true,
        workoutSets: {
          where: { completed: true },
          orderBy: { setNumber: "asc" },
          select: {
            setNumber: true,
            weight: true,
            reps: true,
            rpe: true,
            rir: true,
            setType: true,
            durationSeconds: true,
            distanceMeters: true,
          },
        },
      },
    });
    return workoutExercises;
  },

  // Canonical "completed session" count for a date range — WorkoutSchedule
  // rows the user actually finished (status === "COMPLETED"), matching the
  // same definition used by adherence/training-cycle metrics elsewhere.
  // Deliberately NOT a count of raw Workout rows (see findForStats above):
  // a Workout can be logged without ever being tied to a completed schedule
  // (or a schedule can be re-logged), which previously made this page's
  // "completed sessions" number diverge from the cycle report's.
  countCompletedSchedules: (userId: string, startDate: Date, endDate: Date) =>
    prisma.workoutSchedule.count({
      where: {
        userId,
        status: "COMPLETED",
        date: { gte: startDate, lte: endDate },
      },
    }),

  // Dates (only) of every COMPLETED schedule since `since` — the raw
  // material for a real consecutive-day streak calculation, rather than a
  // hardcoded UI placeholder.
  findCompletedScheduleDates: (userId: string, since: Date) =>
    prisma.workoutSchedule.findMany({
      where: { userId, status: "COMPLETED", date: { gte: since } },
      select: { date: true },
      orderBy: { date: "desc" },
    }),

  // Append a set to an existing workout's exercise. If the WorkoutExercise pair
  // (workoutId, exerciseId) doesn't exist, create it first with the next `order`.
  async appendSet(
    workoutId: string,
    exerciseId: string,
    setData: {
      setNumber?: number;
      weight?: number;
      reps?: number;
      rpe?: number;
      rir?: number;
      setType?: string | null;
      tempo?: string | null;
      rangeOfMotion?: string | null;
      side?: string | null;
      painScore?: number | null;
      techniqueNotes?: string | null;
    },
  ) {
    let workoutExercise = await prisma.workoutExercise.findFirst({
      where: { workoutId, exerciseId },
      include: {
        workoutSets: { orderBy: { setNumber: "desc" as const }, take: 1 },
      },
    });
    if (!workoutExercise) {
      const maxOrder = await prisma.workoutExercise.findFirst({
        where: { workoutId },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      // History-protection snapshot — same reasoning as create()/update()
      // above.
      const exerciseRow = await prisma.exercise.findUnique({
        where: { id: exerciseId },
        select: { exerciseName: true },
      });
      workoutExercise = await prisma.workoutExercise.create({
        data: {
          workoutId,
          exerciseId,
          exerciseNameSnapshot: exerciseRow?.exerciseName ?? null,
          sets: 0,
          order: (maxOrder?.order ?? -1) + 1,
        },
        include: { workoutSets: true },
      });
    }
    if (!workoutExercise) {
      throw new Error("Workout exercise could not be created");
    }
    const nextSetNumber =
      setData.setNumber ?? (workoutExercise.workoutSets[0]?.setNumber ?? 0) + 1;
    return prisma.workoutSet.create({
      data: {
        workoutExerciseId: workoutExercise.id,
        setNumber: nextSetNumber,
        weight: setData.weight,
        reps: setData.reps,
        rpe: setData.rpe,
        rir: setData.rir,
        setType: setData.setType,
        tempo: setData.tempo,
        rangeOfMotion: setData.rangeOfMotion,
        side: setData.side,
        painScore: setData.painScore,
        techniqueNotes: setData.techniqueNotes,
      },
    });
  },
};
