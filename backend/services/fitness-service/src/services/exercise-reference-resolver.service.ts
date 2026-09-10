import { prisma } from "../repositories/prisma";
import { normalizeExerciseName } from "./exercise-duplicate-detector";

type PlanningExerciseRow = {
  id: string;
  exerciseName: string;
  status: string;
  source: string;
  ownerId: string | null;
  archivedAt: Date | null;
};

export type ExerciseReference = {
  exerciseId?: string | null;
  exerciseName?: string | null;
  name?: string | null;
  sourceName?: string | null;
  externalId?: string | null;
  alias?: string | null;
};

export type ExerciseResolverScope =
  | { kind: "user"; userId: string }
  | { kind: "public" };

export type ResolvedExerciseReference = {
  ok: true;
  exercise: PlanningExerciseRow;
  matchedBy: "exerciseId" | "source" | "alias" | "name";
};

export type FailedExerciseReference = {
  ok: false;
  code: "missing_reference" | "not_found" | "ambiguous";
  reference: string;
  candidates?: Array<{ id: string; exerciseName: string; status: string; source: string }>;
};

export type ExerciseReferenceResolution =
  | ResolvedExerciseReference
  | FailedExerciseReference;

function referenceLabel(ref: ExerciseReference): string {
  return (
    ref.exerciseId?.trim() ||
    (ref.sourceName && ref.externalId ? `${ref.sourceName}:${ref.externalId}` : "") ||
    ref.alias?.trim() ||
    ref.exerciseName?.trim() ||
    ref.name?.trim() ||
    "unknown exercise"
  );
}

function visibilityWhere(scope: ExerciseResolverScope) {
  if (scope.kind === "public") {
    return {
      archivedAt: null,
      status: "PUBLISHED",
      source: "SYSTEM",
    };
  }

  return {
    archivedAt: null,
    OR: [
      { status: "PUBLISHED", source: "SYSTEM" },
      { source: "USER_CUSTOM", ownerId: scope.userId },
    ],
  };
}

function success(
  exercise: PlanningExerciseRow,
  matchedBy: ResolvedExerciseReference["matchedBy"],
): ResolvedExerciseReference {
  return { ok: true, exercise, matchedBy };
}

function uniqueOrFail(
  rows: PlanningExerciseRow[],
  reference: string,
): PlanningExerciseRow | FailedExerciseReference {
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) return { ok: false, code: "not_found", reference };
  return {
    ok: false,
    code: "ambiguous",
    reference,
    candidates: rows.map((row) => ({
      id: row.id,
      exerciseName: row.exerciseName,
      status: row.status,
      source: row.source,
    })),
  };
}

export const exerciseReferenceResolver = {
  async resolve(
    reference: ExerciseReference,
    scope: ExerciseResolverScope,
  ): Promise<ExerciseReferenceResolution> {
    const label = referenceLabel(reference);
    const visible = visibilityWhere(scope);

    const explicitId = reference.exerciseId?.trim();
    if (explicitId) {
      const exercise = await prisma.exercise.findFirst({
        where: { id: explicitId, ...visible },
        select: {
          id: true,
          exerciseName: true,
          status: true,
          source: true,
          ownerId: true,
          archivedAt: true,
        },
      });
      return exercise
        ? success(exercise, "exerciseId")
        : { ok: false, code: "not_found", reference: explicitId };
    }

    const sourceName = reference.sourceName?.trim();
    const externalId = reference.externalId?.trim();
    if (sourceName && externalId) {
      const rows = await prisma.exercise.findMany({
        where: {
          ...visible,
          sources: { some: { sourceName, externalId } },
        },
        select: {
          id: true,
          exerciseName: true,
          status: true,
          source: true,
          ownerId: true,
          archivedAt: true,
        },
        orderBy: { exerciseName: "asc" },
      });
      const result = uniqueOrFail(rows, `${sourceName}:${externalId}`);
      return "ok" in result ? result : success(result, "source");
    }

    const alias = reference.alias?.trim();
    if (alias) {
      const aliasNormalized = normalizeExerciseName(alias);
      const rows = await prisma.exercise.findMany({
        where: {
          ...visible,
          aliases: { some: { aliasNormalized } },
        },
        select: {
          id: true,
          exerciseName: true,
          status: true,
          source: true,
          ownerId: true,
          archivedAt: true,
        },
        orderBy: { exerciseName: "asc" },
      });
      const result = uniqueOrFail(rows, alias);
      return "ok" in result ? result : success(result, "alias");
    }

    const name = reference.exerciseName?.trim() || reference.name?.trim();
    if (!name) {
      return { ok: false, code: "missing_reference", reference: label };
    }

    const normalized = normalizeExerciseName(name);
    const rows = await prisma.exercise.findMany({
      where: visible,
      select: {
        id: true,
        exerciseName: true,
        status: true,
        source: true,
        ownerId: true,
        archivedAt: true,
      },
      orderBy: { exerciseName: "asc" },
    });
    const matches = rows.filter(
      (row) => normalizeExerciseName(row.exerciseName) === normalized,
    );
    const result = uniqueOrFail(matches, name);
    return "ok" in result ? result : success(result, "name");
  },

  async validatePlanningExerciseIds(
    exerciseIds: string[],
    scope: ExerciseResolverScope,
  ): Promise<{ ok: true } | { ok: false; missing: string[] }> {
    const uniqueIds = Array.from(new Set(exerciseIds.filter(Boolean)));
    if (uniqueIds.length === 0) return { ok: true };
    const visible = visibilityWhere(scope);
    const rows = await prisma.exercise.findMany({
      where: { id: { in: uniqueIds }, ...visible },
      select: { id: true },
    });
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  },
};
