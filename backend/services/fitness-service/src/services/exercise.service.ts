import { logger } from "@gym-coach/shared";
import { exerciseRepository } from "../repositories/exercise.repository";
import { prisma } from "../repositories/prisma";
import { detectDuplicate, type ExerciseMatchCandidate } from "./exercise-duplicate-detector";

const BODY_PARTS = new Set(["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"]);
const EQUIPMENTS = new Set([
  "BODYWEIGHT",
  "BARBELL",
  "DUMBBELLS",
  "KETTLEBELL",
  "MACHINE",
  "RESISTANCE_BAND",
  "CABLE",
  "MEDICINE_BALL",
  "FOAM_ROLLER",
]);
const ACTIVITY_TYPES = new Set([
  "STRENGTH",
  "CARDIO",
  "MOBILITY",
  "STRENGTH_CARDIO",
  "STRENGTH_MOBILITY",
]);
const MOVEMENT_TYPES = new Set(["PUSH", "PULL", "HOLD", "STRETCH"]);
// Roadmap P1.5 "Custom exercises" — same 5 values every other exercise's
// loggingMode is already validated against elsewhere (no shared constant
// existed to import; this mirrors ai.client.ts's own inline union).
const LOGGING_MODES = new Set(["REPS_LOAD", "BODYWEIGHT_REPS", "TIME", "TIME_LOAD", "DISTANCE_TIME"]);
const MUSCLE_GROUP_ALIASES: Record<string, string[]> = {
  back: ["lats", "middle back", "lower back", "traps"],
  arms: ["biceps", "triceps", "forearms"],
  legs: [
    "quadriceps",
    "hamstrings",
    "glutes",
    "calves",
    "adductors",
    "abductors",
  ],
  chest: ["chest"],
  shoulders: ["shoulders"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  core: ["abdominals"],
};

function normalizeEnum(value?: string) {
  return value
    ?.trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function normalizeEquipment(value?: string) {
  const normalized = normalizeEnum(value);
  if (normalized === "DUMBBELL" || normalized === "DUMBBELL_SINGLE")
    return "DUMBBELLS";
  if (normalized === "BAND") return "RESISTANCE_BAND";
  return normalized;
}

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export const exerciseService = {
  async listExercises(filters: {
    bodyPart?: string;
    muscleGroup?: string;
    activityType?: string;
    typeOfActivity?: string;
    equipment?: string;
    typeOfEquipment?: string;
    type?: string;
    search?: string;
    ids?: string;
    page?: string | number;
    limit?: string | number;
  }) {
    const idsFilter = filters.ids
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    // A batch-by-id lookup (e.g. AI plan display resolving exerciseId ->
    // muscle/equipment metadata) is a different access pattern than
    // browsing/searching the catalog — it wants every requested id back in
    // one page, not the default 30/page browse limit.
    const page = idsFilter?.length ? 1 : boundedInt(filters.page, 1, 1, 10_000);
    const limit = idsFilter?.length
      ? boundedInt(idsFilter.length, 30, 1, 100)
      : boundedInt(filters.limit, 30, 1, 100);
    const and: any[] = [];
    if (idsFilter?.length) {
      and.push({ id: { in: idsFilter } });
      // Deliberately NOT status-gated: this is the by-id resolution path
      // (e.g. rendering an exercise already referenced by an existing
      // workout plan/history) — an exercise that's already in someone's
      // history must keep resolving regardless of its current catalog
      // status, same "never let a catalog change corrupt history" rule
      // applied everywhere else in this roadmap.
    } else {
      // Gate 6/12 hardening: the general browse/search/discover path must
      // never surface an unreviewed import. All 883 pre-existing rows
      // were explicitly backfilled to 'PUBLISHED', so this is purely
      // additive for anything that existed before today.
      and.push({ status: "PUBLISHED" });
      // Roadmap P1.5 "Custom exercises" — a USER_CUSTOM exercise is
      // deliberately created with status: "PUBLISHED" too (so its OWNER
      // can use/log it immediately, no admin approval step for their own
      // private exercise — see the impact analysis's Scope decision), so
      // `status` alone can never be what keeps it out of this PUBLIC,
      // unauthenticated, ownership-blind search. Every pre-existing row
      // is source: "SYSTEM" by default — purely additive.
      and.push({ source: "SYSTEM" });
    }
    const bodyPart = normalizeEnum(filters.bodyPart);
    const equipment = normalizeEquipment(
      filters.equipment ?? filters.typeOfEquipment,
    );
    const activityType = normalizeEnum(
      filters.activityType ?? filters.typeOfActivity,
    );
    const type = normalizeEnum(filters.type);
    const muscleGroup = filters.muscleGroup?.trim().toLowerCase();
    const search = filters.search?.trim();

    if (bodyPart && BODY_PARTS.has(bodyPart)) and.push({ bodyPart });
    if (equipment && EQUIPMENTS.has(equipment))
      and.push({ typeOfEquipment: equipment });
    if (activityType && ACTIVITY_TYPES.has(activityType))
      and.push({ typeOfActivity: activityType });
    if (type && MOVEMENT_TYPES.has(type)) and.push({ type });
    if (muscleGroup) {
      const muscleValues = MUSCLE_GROUP_ALIASES[muscleGroup] || [muscleGroup];
      and.push({
        OR: muscleValues.map((value) => ({
          muscleGroupsActivated: { has: value },
        })),
      });
    }
    if (search) {
      const searchEnum = normalizeEnum(search);
      const searchOr: any[] = [
        { exerciseName: { contains: filters.search, mode: "insensitive" } },
        { instructions: { contains: filters.search, mode: "insensitive" } },
      ];
      if (searchEnum && BODY_PARTS.has(searchEnum))
        searchOr.push({ bodyPart: searchEnum });
      if (searchEnum && EQUIPMENTS.has(searchEnum))
        searchOr.push({ typeOfEquipment: searchEnum });
      if (searchEnum && ACTIVITY_TYPES.has(searchEnum))
        searchOr.push({ typeOfActivity: searchEnum });
      searchOr.push({ muscleGroupsActivated: { has: search.toLowerCase() } });
      and.push({ OR: searchOr });
    }

    const where = and.length > 0 ? { AND: and } : {};
    const [result, total, options] = await Promise.all([
      exerciseRepository.findMany(where, {
        skip: (page - 1) * limit,
        take: limit,
      }),
      exerciseRepository.count(where),
      exerciseRepository.getFilterOptions(),
    ]);
    if (result.fromCache) logger.info("Cache hit for exercises");
    return {
      success: true,
      data: {
        exercises: result.data,
        pagination: { page, limit, total },
        filters: options,
      },
    };
  },

  async getFilterOptions() {
    return {
      success: true,
      data: await exerciseRepository.getFilterOptions(),
    };
  },

  async getExercise(id: string) {
    const exercise = await exerciseRepository.findById(id);
    if (!exercise) throw { status: 404, message: "Exercise not found" };
    return exercise;
  },

  async create(data: any) {
    return exerciseRepository.create(data);
  },

  // Gate 6 — real muscle-map data for the SVG UI. Never guesses: an
  // exercise with zero ExerciseMuscle rows returns empty
  // primary/secondary arrays plus an explicit `mapped: false` flag, so
  // the frontend renders a clear "chưa có dữ liệu nhóm cơ" state instead
  // of either crashing or silently showing nothing unexplained.
  async getMuscleMap(exerciseId: string) {
    const exercise = await exerciseRepository.findById(exerciseId);
    if (!exercise) throw { status: 404, message: "Exercise not found" };

    const links = await exerciseRepository.findMuscleLinks(exerciseId);
    const primary = links
      .filter((l) => l.role === "primary")
      .map((l) => ({ code: l.muscle.code, nameVi: l.muscle.nameVi, nameEn: l.muscle.nameEn, anatomyRegion: l.muscle.anatomyRegion }));
    const secondary = links
      .filter((l) => l.role === "secondary")
      .map((l) => ({ code: l.muscle.code, nameVi: l.muscle.nameVi, nameEn: l.muscle.nameEn, anatomyRegion: l.muscle.anatomyRegion }));

    return {
      exerciseId,
      exerciseName: exercise.exerciseName,
      mapped: links.length > 0,
      primary,
      secondary,
    };
  },

  async listMuscles() {
    const muscles = await exerciseRepository.listAllMuscles();
    return muscles.map((m) => ({
      code: m.code,
      nameVi: m.nameVi,
      nameEn: m.nameEn,
      anatomyRegion: m.anatomyRegion,
      parentMuscleId: m.parentMuscleId,
    }));
  },

  /**
   * Roadmap P1.5 "Custom exercises"
   * (docs/features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md). Reuses
   * detectDuplicate (the catalog's own bulk-import dedup pipeline)
   * UNCHANGED — a high-confidence match blocks creation and returns the
   * candidate(s) for the USER to confirm, exactly like an admin reviewer
   * would, unless `confirmCreateAnyway` is explicitly set.
   */
  async createCustomExercise(
    userId: string,
    input: {
      exerciseName?: string;
      typeOfActivity?: string;
      typeOfEquipment?: string;
      bodyPart?: string;
      type?: string;
      muscleGroupsActivated?: string[];
      instructions?: string;
      loggingMode?: string;
      confirmCreateAnyway?: boolean;
    },
  ) {
    const exerciseName = input.exerciseName?.trim();
    if (!exerciseName) throw { status: 400, message: "exerciseName is required" };
    const typeOfActivity = normalizeEnum(input.typeOfActivity);
    const typeOfEquipment = normalizeEquipment(input.typeOfEquipment);
    const bodyPart = normalizeEnum(input.bodyPart);
    const type = normalizeEnum(input.type);
    const loggingMode = input.loggingMode?.trim().toUpperCase();
    // Same enums every other exercise (including the 1002-row seeded
    // catalog) is already validated against — a custom exercise never
    // bypasses this (roadmap's own "do not allow custom exercise to
    // bypass safety/data validation").
    if (!typeOfActivity || !ACTIVITY_TYPES.has(typeOfActivity)) {
      throw { status: 400, message: `typeOfActivity must be one of: ${[...ACTIVITY_TYPES].join(", ")}` };
    }
    if (!typeOfEquipment || !EQUIPMENTS.has(typeOfEquipment)) {
      throw { status: 400, message: `typeOfEquipment must be one of: ${[...EQUIPMENTS].join(", ")}` };
    }
    if (!bodyPart || !BODY_PARTS.has(bodyPart)) {
      throw { status: 400, message: `bodyPart must be one of: ${[...BODY_PARTS].join(", ")}` };
    }
    if (!type || !MOVEMENT_TYPES.has(type)) {
      throw { status: 400, message: `type must be one of: ${[...MOVEMENT_TYPES].join(", ")}` };
    }
    if (!loggingMode || !LOGGING_MODES.has(loggingMode)) {
      throw { status: 400, message: `loggingMode must be one of: ${[...LOGGING_MODES].join(", ")}` };
    }
    const muscleGroupsActivated = Array.isArray(input.muscleGroupsActivated)
      ? input.muscleGroupsActivated.filter((m) => typeof m === "string" && m.trim().length > 0)
      : [];
    const instructions = input.instructions?.trim() || "Bài tập tùy chỉnh do người dùng tạo.";

    if (!input.confirmCreateAnyway) {
      const candidate: ExerciseMatchCandidate = {
        id: "__new__",
        name: exerciseName,
        source: "user_custom_pending",
        equipment: [typeOfEquipment.toLowerCase()],
        primaryMuscles: muscleGroupsActivated.map((m) => m.toLowerCase()),
        movementPattern: null,
        mechanics: null,
      };
      const liveRows = await prisma.exercise.findMany({
        where: { archivedAt: null },
        select: { id: true, exerciseName: true, typeOfEquipment: true, muscleGroupsActivated: true, movementPattern: true, mechanics: true },
      });
      const liveCandidates: ExerciseMatchCandidate[] = liveRows.map((r) => ({
        id: r.id,
        name: r.exerciseName,
        source: "live_catalog",
        equipment: [r.typeOfEquipment.toLowerCase()],
        primaryMuscles: r.muscleGroupsActivated.map((m) => m.toLowerCase()),
        movementPattern: r.movementPattern,
        mechanics: r.mechanics === "compound" || r.mechanics === "isolation" ? (r.mechanics as "compound" | "isolation") : null,
      }));
      const matches = liveCandidates
        .map((live) => ({ live, result: detectDuplicate(candidate, live) }))
        .filter(({ result }) => result.decision === "EXACT_SAME_SOURCE" || result.decision === "EXACT_CROSS_SOURCE");
      if (matches.length > 0) {
        return {
          blocked: true,
          candidates: matches.map(({ live, result }) => ({
            id: live.id,
            name: live.name,
            confidence: result.confidence,
            proposedAction: result.proposedAction,
          })),
        };
      }
    }

    const created = await prisma.exercise.create({
      data: {
        exerciseName,
        typeOfActivity: typeOfActivity as any,
        typeOfEquipment: typeOfEquipment as any,
        bodyPart: bodyPart as any,
        type: type as any,
        muscleGroupsActivated,
        instructions,
        loggingMode,
        status: "PUBLISHED",
        source: "USER_CUSTOM",
        ownerId: userId,
      },
    });
    return { blocked: false, exercise: created };
  },

  /** Owner-scoped only — never surfaced via the public GET /exercises
   * search (see impact analysis's Scope decision: no catalog contamination
   * by construction, not by a filter that could be forgotten elsewhere). */
  async listMyCustomExercises(userId: string) {
    return prisma.exercise.findMany({
      where: { source: "USER_CUSTOM", ownerId: userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Soft-delete only — the row (and every WorkoutExercise/
   * WorkoutProgramExercise FK to it) stays intact; it just stops
   * appearing in listMyCustomExercises. */
  async archiveCustomExercise(userId: string, exerciseId: string) {
    const existing = await prisma.exercise.findFirst({
      where: { id: exerciseId, source: "USER_CUSTOM" },
    });
    if (!existing) throw { status: 404, message: "Custom exercise not found" };
    if (existing.ownerId !== userId) {
      throw { status: 403, message: "You can only archive your own custom exercises" };
    }
    if (existing.archivedAt) return existing;
    return prisma.exercise.update({
      where: { id: exerciseId },
      data: { archivedAt: new Date() },
    });
  },
};
