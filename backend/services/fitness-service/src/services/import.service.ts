/**
 * Roadmap P2 "Canonical import framework" + P2.1 "Hevy import" + P2.2
 * "Strong import" (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md,
 * docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * Two-phase preview → commit workout-history import. Preview parses +
 * stages canonical data on a WorkoutImportBatch row (never touches
 * Workout/WorkoutExercise/WorkoutSet). Commit is the only step that
 * writes real history, and never creates a WorkoutSchedule row — imported
 * history is pure "actual", no "planned" counterpart (roadmap §25).
 *
 * Provider-agnostic by construction: previewHevyImport/previewStrongImport
 * are thin wrappers (parse with the provider's own parser, then hand the
 * canonical result to the SAME previewFromParsed/commitImportBatch below)
 * — adding a provider never means a second pipeline, matching §14's own
 * "do not build four unrelated importers" rule.
 */
import { prisma } from "../repositories/prisma";
import { parseHevyCsv } from "../utils/hevy-csv-parser.util";
import { parseStrongCsv } from "../utils/strong-csv-parser.util";
import { parseFitNotesCsv } from "../utils/fitnotes-csv-parser.util";
import { matchExerciseName, type MatchCandidate } from "../utils/exercise-name-matcher.util";
import { exerciseService } from "./exercise.service";
import { todayAsScheduleDate, scheduledDateLabel } from "../utils/schedule-lock.util";
import type { ImportExerciseResolution } from "../models/fitness.models";
import type { ImportedWorkout, ProviderParseResult } from "../utils/import-canonical.types";

const SOURCE_LABEL: Record<string, string> = {
  HEVY: "Hevy",
  STRONG: "Strong",
  FITNOTES: "FitNotes",
};

function partitionFutureWorkouts(workouts: ImportedWorkout[]) {
  const todayLabel = scheduledDateLabel(todayAsScheduleDate());
  const importable: ImportedWorkout[] = [];
  const future: ImportedWorkout[] = [];
  for (const w of workouts) {
    if (w.date > todayLabel) future.push(w);
    else importable.push(w);
  }
  return { importable, future };
}

async function loadCatalogCandidates(userId: string) {
  const catalog = await prisma.exercise.findMany({
    where: { archivedAt: null, OR: [{ source: "SYSTEM" }, { source: "USER_CUSTOM", ownerId: userId }] },
    select: { id: true, exerciseName: true },
  });
  return catalog.map((c) => ({ id: c.id, name: c.exerciseName }));
}

async function loadAllCommittedHashes(userId: string): Promise<Set<string>> {
  const batches = await prisma.workoutImportBatch.findMany({
    where: { userId, status: "COMMITTED" },
    select: { committedSourceHashes: true },
  });
  return new Set(batches.flatMap((b) => b.committedSourceHashes));
}

function computeDateRange(workouts: ImportedWorkout[]) {
  const dates = [...workouts.map((w) => w.date)].sort();
  return { earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null };
}

/** Shared by every provider's previewXImport wrapper — parses are already
 * done by the caller; this handles matching, idempotency-preview,
 * staging the batch, and shaping the response, identically regardless
 * of source. */
async function previewFromParsed(userId: string, source: string, fileName: string, parsed: ProviderParseResult) {
  const { workouts: allWorkouts, rowErrors } = parsed;
  const { importable: workouts, future: futureWorkouts } = partitionFutureWorkouts(allWorkouts);

  if (workouts.length === 0) {
    return {
      blocked: true,
      reason: allWorkouts.length === 0
        ? "No valid workouts found in this file."
        : "Every workout in this file is dated in the future — nothing to import.",
      rowErrors,
      futureWorkoutCount: futureWorkouts.length,
    };
  }

  const catalogCandidates = await loadCatalogCandidates(userId);
  const distinctExerciseTitles = [...new Set(workouts.flatMap((w) => w.exercises.map((e) => e.exerciseTitle)))];
  const matchSummary: Record<string, { candidates: MatchCandidate[]; isExactMatch: boolean }> = {};
  for (const title of distinctExerciseTitles) {
    const candidates = matchExerciseName(title, catalogCandidates);
    matchSummary[title] = { candidates, isExactMatch: candidates[0]?.confidence === 1 };
  }

  const pastCommittedHashes = await loadAllCommittedHashes(userId);
  const alreadyImportedCount = workouts.filter((w) => pastCommittedHashes.has(w.sourceHash)).length;

  const batch = await prisma.workoutImportBatch.create({
    data: {
      userId,
      source,
      fileName,
      status: "PREVIEW",
      parsedWorkoutsJson: workouts as any,
      matchSummaryJson: matchSummary as any,
    },
  });

  return {
    blocked: false,
    batchId: batch.id,
    workoutCount: workouts.length,
    futureWorkoutCount: futureWorkouts.length,
    dateRange: computeDateRange(workouts),
    alreadyImportedCount,
    exerciseMatchSummary: Object.entries(matchSummary).map(([exerciseTitle, v]) => ({ exerciseTitle, ...v })),
    rowErrors,
  };
}

export const importService = {
  async previewHevyImport(userId: string, fileName: string, csvContent: string) {
    return previewFromParsed(userId, "HEVY", fileName, parseHevyCsv(csvContent));
  },

  async previewStrongImport(userId: string, fileName: string, csvContent: string) {
    return previewFromParsed(userId, "STRONG", fileName, parseStrongCsv(csvContent));
  },

  async previewFitNotesImport(userId: string, fileName: string, csvContent: string) {
    return previewFromParsed(userId, "FITNOTES", fileName, parseFitNotesCsv(csvContent));
  },

  async commitImportBatch(
    userId: string,
    batchId: string,
    resolutions: Record<string, ImportExerciseResolution>,
  ) {
    const batch = await prisma.workoutImportBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw { status: 404, message: "Import batch not found" };
    if (batch.status !== "PREVIEW") throw { status: 409, message: `Batch is already ${batch.status}` };

    const allWorkouts = batch.parsedWorkoutsJson as unknown as ImportedWorkout[];
    // Defense in depth — recompute the future-date filter fresh rather than
    // trusting whatever "today" was at preview time (a preview left open
    // across a day boundary must never let a now-future-appearing... this
    // direction can't actually happen since imports are always past-dated
    // relative to preview time, but recomputing fresh costs nothing and
    // avoids ever trusting a stale snapshot for a safety check).
    const { importable: workouts } = partitionFutureWorkouts(allWorkouts);

    const distinctTitles = [...new Set(workouts.flatMap((w) => w.exercises.map((e) => e.exerciseTitle)))];
    for (const title of distinctTitles) {
      if (!resolutions[title]) throw { status: 400, message: `Missing resolution for exercise "${title}"` };
    }

    // Resolve exerciseId per distinct title FIRST, outside the write
    // transaction below — createCustomExercise runs its own queries
    // against the top-level prisma client (not a `tx`), so it can never be
    // safely nested inside the transaction that writes the actual
    // workouts. Known, disclosed limitation: if one CREATE_CUSTOM
    // resolution blocks (matches an existing exercise) after an earlier
    // one in the same commit already succeeded, that earlier exercise was
    // still genuinely created (a valid, owned USER_CUSTOM row — nothing
    // corrupted) even though this call throws before writing any
    // Workout/WorkoutSet rows. Retrying resolves it as USE_EXISTING.
    const resolvedExerciseIdByTitle = new Map<string, string | null>(); // null = SKIP
    for (const title of distinctTitles) {
      const resolution = resolutions[title];
      if (resolution.action === "USE_EXISTING") {
        const exists = await prisma.exercise.findUnique({ where: { id: resolution.exerciseId }, select: { id: true } });
        if (!exists) throw { status: 400, message: `exerciseId for "${title}" does not exist` };
        resolvedExerciseIdByTitle.set(title, resolution.exerciseId);
      } else if (resolution.action === "CREATE_CUSTOM") {
        const created = await exerciseService.createCustomExercise(userId, {
          exerciseName: resolution.input.exerciseName || title,
          typeOfActivity: resolution.input.typeOfActivity,
          typeOfEquipment: resolution.input.typeOfEquipment,
          bodyPart: resolution.input.bodyPart,
          type: resolution.input.type,
          loggingMode: resolution.input.loggingMode,
          muscleGroupsActivated: resolution.input.muscleGroupsActivated,
          instructions: resolution.input.instructions,
          confirmCreateAnyway: false,
        });
        if (created.blocked) {
          throw {
            status: 409,
            message: `"${title}" matches an existing exercise — resolve it as USE_EXISTING instead`,
            candidates: (created as any).candidates,
          };
        }
        resolvedExerciseIdByTitle.set(title, (created as any).exercise.id);
      } else {
        resolvedExerciseIdByTitle.set(title, null);
      }
    }

    const pastCommittedHashes = await loadAllCommittedHashes(userId);
    const toCommit = workouts.filter((w) => !pastCommittedHashes.has(w.sourceHash));
    const alreadyImportedSkippedCount = workouts.length - toCommit.length;

    const createdWorkoutIds: string[] = [];
    const newlyCommittedHashes: string[] = [];
    let skippedExerciseSetCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const w of toCommit) {
        const exercisesToWrite: Array<{ ex: ImportedWorkout["exercises"][number]; exerciseId: string }> = [];
        for (const ex of w.exercises) {
          const exerciseId = resolvedExerciseIdByTitle.get(ex.exerciseTitle);
          if (!exerciseId) {
            skippedExerciseSetCount += ex.sets.length;
            continue;
          }
          exercisesToWrite.push({ ex, exerciseId });
        }
        if (exercisesToWrite.length === 0) continue; // every exercise in this workout was skipped

        const exerciseIds = [...new Set(exercisesToWrite.map((e) => e.exerciseId))];
        const nameRows = await tx.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true, exerciseName: true },
        });
        const nameById = new Map(nameRows.map((r) => [r.id, r.exerciseName]));

        const created = await tx.workout.create({
          data: {
            userId,
            name: w.title,
            date: new Date(`${w.date}T00:00:00.000Z`),
            notes: `Nhập từ ${SOURCE_LABEL[batch.source] ?? batch.source}${w.notes ? ` — ${w.notes}` : ""}`,
            exercises: {
              create: exercisesToWrite.map(({ ex, exerciseId }, index) => ({
                exerciseId,
                exerciseNameSnapshot: nameById.get(exerciseId) ?? null,
                sets: ex.sets.length,
                reps: ex.sets[0]?.reps ?? null,
                weight: ex.sets[0]?.weight ?? null,
                order: index,
                workoutSets: {
                  create: ex.sets.map((s) => ({
                    setNumber: s.setNumber,
                    reps: s.reps,
                    weight: s.weight,
                    durationSeconds: s.durationSeconds,
                    distanceMeters: s.distanceMeters,
                    rpe: s.rpe,
                    setType: s.setType,
                    completed: true,
                  })),
                },
              })),
            },
          },
        });
        createdWorkoutIds.push(created.id);
        newlyCommittedHashes.push(w.sourceHash);
      }

      await tx.workoutImportBatch.update({
        where: { id: batchId },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
          createdWorkoutIds,
          committedSourceHashes: newlyCommittedHashes,
        },
      });
    });

    return {
      committedWorkoutCount: createdWorkoutIds.length,
      alreadyImportedSkippedCount,
      skippedExerciseSetCount,
      createdWorkoutIds,
    };
  },

  async cancelImportBatch(userId: string, batchId: string) {
    const batch = await prisma.workoutImportBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw { status: 404, message: "Import batch not found" };
    if (batch.status !== "PREVIEW") throw { status: 409, message: `Batch is already ${batch.status}` };
    return prisma.workoutImportBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
  },

  async listImportBatches(userId: string) {
    return prisma.workoutImportBatch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        source: true,
        fileName: true,
        status: true,
        createdAt: true,
        committedAt: true,
        createdWorkoutIds: true,
      },
    });
  },
};
