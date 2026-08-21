import { Request, Response } from "express";
import { exerciseRepository } from "../repositories/exercise.repository";
import { equipmentRepository } from "../repositories/equipment.repository";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  isExerciseAvailable,
  type ExerciseEquipmentLink,
} from "../utils/equipment-availability.util";
import { planEquipmentValidatorService, type PlanDayRef } from "../services/plan-equipment-validator.service";
import { workoutService } from "../services/workout.service";
import { createManualProgramSchema } from "../models/fitness.models";
import { z } from "zod";
import { formatZodErrors } from "../utils/workout-validation";

// Equipment allowed per training location / preference
const HOME_EQUIPMENT = [
  "BODYWEIGHT",
  "DUMBBELLS",
  "RESISTANCE_BAND",
  "KETTLEBELL",
  "MEDICINE_BALL",
  "FOAM_ROLLER",
];
// Fisher-Yates — used to de-bias candidate pools that were fetched in a
// fixed sort order (see exercisesForAiPlans) before truncating to a limit.
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const MACHINE_ONLY_EQUIPMENT = ["MACHINE", "CABLE"];
const MIXED_GYM_EQUIPMENT = [
  "MACHINE",
  "CABLE",
  "BARBELL",
  "DUMBBELLS",
  "BODYWEIGHT",
  "KETTLEBELL",
];

export const internalController = {
  async exercisesForAiPlans(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        goal,
        bodyPart,
        equipment,
        typeOfActivity,
        limit,
        muscleGroup,
        trainingLocation,
        equipmentPreference,
      } = req.query as Record<string, string>;

      // Gym-onboarding project: if this user has completed the granular
      // equipment step (real UserEquipment rows), that is strictly more
      // precise than the old coarse trainingLocation/equipmentPreference
      // selector and supersedes it entirely — never both at once, since
      // intersecting them could only ever narrow the pool incorrectly (e.g.
      // a user who owns a medicine ball but picked equipmentPreference=
      // MIXED_GYM, which doesn't include MEDICINE_BALL, would otherwise
      // lose exercises they can actually do). Users who haven't set
      // granular equipment yet (the common case for every pre-existing
      // user, and any new user who skips that onboarding step) fall through
      // to the exact old behavior — fully backward compatible, see §48.
      const userId = req.user?.id;
      let ownedEquipmentIds: Set<string> | null = null;
      if (userId && !equipment) {
        const ids = await equipmentRepository.listUserEquipmentIds(userId);
        if (ids.length > 0) ownedEquipmentIds = new Set(ids);
      }

      const where: Record<string, any> = {};
      if (bodyPart) where.bodyPart = bodyPart;
      if (typeOfActivity) where.typeOfActivity = typeOfActivity;

      // Equipment filter: explicit param > granular UserEquipment (post-
      // filtered below, not applied to `where`) > equipmentPreference >
      // trainingLocation
      if (equipment) {
        where.typeOfEquipment = equipment;
      } else if (ownedEquipmentIds) {
        // no where.typeOfEquipment clause — filtered deterministically below
      } else if (equipmentPreference) {
        const pref = String(equipmentPreference).toUpperCase();
        if (pref === "MACHINE_ONLY") {
          where.typeOfEquipment = { in: MACHINE_ONLY_EQUIPMENT };
        } else if (pref === "MIXED_GYM") {
          where.typeOfEquipment = { in: MIXED_GYM_EQUIPMENT };
        }
      } else if (trainingLocation) {
        const loc = String(trainingLocation).toUpperCase();
        if (loc === "HOME") {
          where.typeOfEquipment = { in: HOME_EQUIPMENT };
        }
        // GYM with no pref → no equipment restriction
      }

      // Muscle group filter (explicit)
      if (muscleGroup) {
        where.muscleGroupsActivated = { has: muscleGroup };
      } else if (goal) {
        const g = String(goal).trim().toUpperCase();
        const resistanceEquip = [
          "BARBELL",
          "DUMBBELLS",
          "MACHINE",
          "KETTLEBELL",
          "CABLE",
        ];
        const coreGroups = [
          "legs",
          "chest",
          "back",
          "shoulders",
          "core",
          "arms",
        ];
        let mapped: Record<string, any> | null = null;

        if (
          g === "WEIGHT_LOSS" ||
          g === "FAT_LOSS" ||
          g === "GIAM_MO" ||
          g === "LOSE_FAT"
        ) {
          mapped = {
            OR: [
              { typeOfActivity: "CARDIO" },
              { typeOfActivity: "STRENGTH" },
              { typeOfEquipment: { in: ["BODYWEIGHT", ...resistanceEquip] } },
              { muscleGroupsActivated: { hasSome: coreGroups } },
            ],
          };
        } else if (
          g === "MUSCLE_GAIN" ||
          g === "HYPERTROPHY" ||
          g === "TANG_CO" ||
          g === "MUSCLE"
        ) {
          // For muscle gain: STRICTLY prefer strength/resistance, exclude pure cardio
          mapped = {
            AND: [
              { NOT: { typeOfActivity: "CARDIO" } },
              {
                OR: [
                  { typeOfActivity: "STRENGTH" },
                  { typeOfEquipment: { in: resistanceEquip } },
                  { muscleGroupsActivated: { hasSome: coreGroups } },
                ],
              },
            ],
          };
        } else if (g === "STRENGTH" || g === "INCREASE_STRENGTH") {
          mapped = {
            OR: [
              { typeOfActivity: "STRENGTH" },
              {
                typeOfEquipment: {
                  in: ["BARBELL", "MACHINE", "DUMBBELLS", "CABLE"],
                },
              },
            ],
          };
        } else if (g === "ENDURANCE" || g === "CARDIO" || g === "SUC_BENH") {
          mapped = {
            OR: [
              { typeOfActivity: "CARDIO" },
              { typeOfEquipment: { in: ["BODYWEIGHT"] } },
            ],
          };
        }

        if (mapped) Object.assign(where, mapped);
      }

      // Fetch with a higher limit so the worker has a full catalog to filter per-day
      let lim = 300;
      if (limit) {
        const n = Number(limit);
        if (Number.isFinite(n) && n > 0) lim = Math.min(500, Math.trunc(n));
      }

      // Gate 6/12 hardening (exercise/anatomy data-expansion roadmap):
      // never let an unreviewed, freshly-imported exercise reach a real
      // AI-generated plan. Not user-overridable — this is a hard floor,
      // not a filter option. All 883 pre-existing rows were explicitly
      // backfilled to 'PUBLISHED' by the migration that introduced this
      // column, so this is purely additive for every exercise that
      // existed before today; it only ever narrows the pool for NEW
      // imports still in STAGING/REVIEW_REQUIRED.
      where.status = "PUBLISHED";

      const result = await exerciseRepository.findMany(where);
      let candidates = result.data as any[];

      // Deterministic equipment gate (never delegated to the LLM — see
      // equipment-availability.util.ts). Applied here, before the
      // shuffle/truncate below, so the candidate pool the AI worker
      // actually sees never contains an exercise this user can't do.
      let equipmentFilteredCount = 0;
      if (ownedEquipmentIds) {
        const links = await prisma.exerciseEquipment.findMany({
          where: { exerciseId: { in: candidates.map((c) => c.id) } },
          select: { exerciseId: true, equipmentId: true, requirementType: true },
        });
        const linksByExercise = new Map<string, ExerciseEquipmentLink[]>();
        for (const link of links) {
          const arr = linksByExercise.get(link.exerciseId) ?? [];
          arr.push({ equipmentId: link.equipmentId, requirementType: link.requirementType });
          linksByExercise.set(link.exerciseId, arr);
        }
        const before = candidates.length;
        candidates = candidates.filter((ex) =>
          isExerciseAvailable(linksByExercise.get(ex.id) ?? [], ownedEquipmentIds!),
        );
        equipmentFilteredCount = before - candidates.length;
      }

      // exerciseRepository.findMany always orders by exerciseName ASC (the
      // right default for a browsable catalog page). When a `where` filter
      // matches more rows than `lim`, slicing straight off that alphabetical
      // order used to hand the AI worker a candidate pool dominated by
      // A/B-named exercises every time — the worker's own per-day scoring
      // and the LLM's requested ordering can only work with what's in this
      // pool, so an alphabetically-biased pool produced alphabetically-
      // clustered plans regardless of how well those later steps worked.
      // Shuffle before truncating so the candidate pool is a representative
      // sample instead of a fixed alphabetical prefix.
      const pool = shuffleInPlace([...candidates]);
      let exercises = pool.slice(0, lim).map((ex) => ({
        id: ex.id,
        exerciseName: ex.exerciseName,
        bodyPart: ex.bodyPart,
        typeOfEquipment: ex.typeOfEquipment,
        typeOfActivity: ex.typeOfActivity,
        type: ex.type,
        muscleGroupsActivated: ex.muscleGroupsActivated,
        instructions: ex.instructions,
        updatedAt: ex.updatedAt,
      }));

      logger.info(
        {
          goal,
          muscleGroup,
          trainingLocation,
          equipmentPreference,
          usedGranularUserEquipment: !!ownedEquipmentIds,
          ownedEquipmentCount: ownedEquipmentIds?.size ?? undefined,
          equipmentFilteredCount,
          returned: exercises.length,
        },
        "internal.exercisesForAiPlans result",
      );

      res.json({ success: true, data: { exercises } });
    } catch (err) {
      logger.error({ err }, "internal.exercisesForAiPlans failed");
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch exercises" });
    }
  },

  async foodsForAiNutrition(_req: Request, res: Response): Promise<void> {
    try {
      const { prisma } = await import("../repositories/prisma");
      const commonKeywords = [
        "chicken",
        "egg",
        "rice",
        "oat",
        "banana",
        "salmon",
        "tuna",
        "beef",
        "pork",
        "turkey",
        "milk",
        "yogurt",
        "tofu",
        "soy",
        "beans",
        "potato",
        "broccoli",
        "spinach",
        "apple",
        "orange",
        "peanut",
        "almond",
        "bread",
        "pasta",
        "cheese",
        "shrimp",
        "fish",
      ];
      const excludedKeywords = [
        "oil",
        "shortening",
        "candy",
        "candies",
        "chewing gum",
        "sweetener",
        "sugar substitute",
        "gelatin dessert",
        "beverage",
        "alcoholic",
        "babyfood",
        "infant formula",
        "protein powder",
        "powder mix",
        "soy protein isolate",
        "dried, powder",
        "dried, stabilized",
        "dried, flakes",
        "dried",
        "protein concentrate",
        "pork skin",
        "snacks",
        "powder",
      ];
      const escapeLike = (value: string) => value.replace(/'/g, "''");
      const excludedSql = excludedKeywords
        .map((keyword) => `name NOT ILIKE '%${escapeLike(keyword)}%'`)
        .join(" AND ");
      const commonSql = commonKeywords
        .map((keyword) => `name ILIKE '%${escapeLike(keyword)}%'`)
        .join(" OR ");
      // Part 6/8 hardening: is_supplement (backfilled by migration
      // 20260819000000_add_food_serving_metadata from the same name
      // classification the excludedKeywords list above already uses, now
      // backed by real per-row data instead of a query-time regex) is
      // excluded outright — "food first, supplements are opt-in" (Part 8)
      // means the auto-generated catalog an AI meal plan draws from should
      // never silently include them. food_form/realistic_serving_max_g
      // are passed through so nutrition.processor.ts can use the real
      // per-food cap instead of falling back to its own keyword guess.
      //
      // Root-cause fix (found via a real muscle-gain E2E generation that
      // consistently undershot its carb/calorie targets): a single query
      // ordered purely `ORDER BY protein DESC LIMIT 500` is a top-500-by-
      // protein slice of ~13k rows — every genuine low-protein whole-food
      // carb source (rice, potato, banana, oats — all present in
      // commonKeywords above) ranks far outside that cutoff and was never
      // returned at all. nutrition.processor.ts's meal builder was then
      // forced to build the "carb role" out of whatever high-protein items
      // happened to make the cut (e.g. nonfat dry milk), which structurally
      // cannot hit a carb-gram target without also blowing the protein
      // target. Fetch three separately-ranked, balanced slices instead —
      // protein-dense, carb-dense, fat-dense — and merge them, so the
      // downstream role-based selection actually has real candidates for
      // every macro, not just protein.
      const whereClause = `
        calories BETWEEN 20 AND 600
        AND is_supplement = false
        AND ${excludedSql}
        AND (${commonSql})
      `;
      const PER_AXIS_LIMIT = 300;
      const selectCols =
        "id, name, calories, protein, carbs, fats, food_form, realistic_serving_max_g";
      const [proteinRows, carbRows, fatRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`
          SELECT ${selectCols} FROM foods WHERE ${whereClause}
          ORDER BY protein DESC, calories ASC
          LIMIT ${PER_AXIS_LIMIT}
        `),
        prisma.$queryRawUnsafe<any[]>(`
          SELECT ${selectCols} FROM foods WHERE ${whereClause}
          ORDER BY carbs DESC, calories ASC
          LIMIT ${PER_AXIS_LIMIT}
        `),
        prisma.$queryRawUnsafe<any[]>(`
          SELECT ${selectCols} FROM foods WHERE ${whereClause}
          ORDER BY fats DESC, calories ASC
          LIMIT ${PER_AXIS_LIMIT}
        `),
      ]);
      const foodsById = new Map<string, any>();
      for (const row of [...proteinRows, ...carbRows, ...fatRows]) {
        if (!foodsById.has(row.id)) foodsById.set(row.id, row);
      }
      const foods = [...foodsById.values()];
      const mappedFoods = foods.map((f: any) => ({
        id: f.id,
        name: f.name,
        calories: f.calories,
        protein: f.protein,
        carbs: f.carbs,
        fat: f.fats,
        fats: f.fats,
        servingSize: 100,
        servingUnit: "g",
        tags: [],
        foodForm: f.food_form ?? null,
        realisticServingMaxG: f.realistic_serving_max_g ?? null,
      }));
      res.json({ success: true, data: { foods: mappedFoods } });
    } catch (err) {
      logger.error({ err }, "internal.foodsForAiNutrition failed");
      res.status(500).json({ success: false, error: "Failed to fetch foods" });
    }
  },

  // ai-service calls this to gate marketplace plan reviews: only a user who
  // actually finished a training cycle built on this plan may rate it.
  // COMPLETED and ANALYZED both count — a cycle is "finished" as soon as it
  // closes, regardless of whether the (fire-and-forget) AI analysis landed.
  async hasCompletedCycleForPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { sourcePlanId } = req.query as Record<string, string>;
      const userId = req.user!.id;
      if (!sourcePlanId) {
        res.status(400).json({ success: false, error: "sourcePlanId is required" });
        return;
      }
      const cycle = await prisma.trainingCycle.findFirst({
        where: { userId, planId: sourcePlanId, status: { in: ["COMPLETED", "ANALYZED"] } },
        select: { id: true },
      });
      res.json({ success: true, data: { completed: !!cycle } });
    } catch (err) {
      logger.error({ err }, "internal.hasCompletedCycleForPlan failed");
      res.status(500).json({ success: false, error: "Failed to check cycle completion" });
    }
  },

  // ai-service calls this when generating/adjusting a plan, to feed the
  // most recently finished cycle's decision/progressSignals into the prompt.
  async getLatestClosedCycle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const cycle = await prisma.trainingCycle.findFirst({
        where: { userId, status: { in: ["COMPLETED", "ANALYZED"] } },
        orderBy: { endDate: "desc" },
      });
      res.json({ success: true, data: { cycle } });
    } catch (err) {
      logger.error({ err }, "internal.getLatestClosedCycle failed");
      res.status(500).json({ success: false, error: "Failed to fetch latest closed cycle" });
    }
  },

  // Hardening pass §7/§8 — ai-service calls this as a FINAL, authoritative
  // equipment-compliance check on a specific generated plan's exact
  // exerciseIds, right before persisting it. Deliberately separate from
  // /internal/exercises/for-ai-plans (which is sampled/bounded — up to 500
  // exercises per call — and therefore not safe to treat as a complete
  // ground truth for a post-hoc check); this endpoint checks only the small
  // exact set a real plan used, so it can never produce a false positive.
  async validatePlanEquipment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { weeklySchedule } = req.body as { weeklySchedule?: PlanDayRef[] };
      if (!Array.isArray(weeklySchedule)) {
        res.status(400).json({ success: false, error: "weeklySchedule must be an array" });
        return;
      }
      const result = await planEquipmentValidatorService.validate(weeklySchedule, userId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error({ err }, "internal.validatePlanEquipment failed");
      res.status(500).json({ success: false, error: "Failed to validate plan equipment" });
    }
  },

  // INTERNAL — called by ai-service when a Marketplace Personalized PT
  // Service order is ACCEPTED by the buyer, to commit the PT's delivered
  // draft (stored on PersonalizedServiceOrder.draftContent, same shape as
  // createManualProgramSchema) into the CLIENT's real WorkoutProgram +
  // WorkoutSchedule. x-user-id is the BUYER/client (whose schedule this
  // becomes), never the PT — reuses workoutService.createManualProgram
  // unchanged, the exact same commit path coach.service.ts's
  // createAndAssignPlan already uses for Contract-based PT coaching, so
  // there is exactly one "assign a program to a user" implementation.
  async commitManualProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const data = createManualProgramSchema.parse(req.body);
      const result = await workoutService.createManualProgram(userId, data);
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: "Invalid program data", details: formatZodErrors(err.errors) });
        return;
      }
      if (err?.status) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      logger.error({ err }, "internal.commitManualProgram failed");
      res.status(500).json({ success: false, error: "Failed to commit program" });
    }
  },

  // INTERNAL — called by ai-service's marketplace browse() to filter out listings whose
  // exercises don't actually resolve against this service's real exercise catalog (often
  // leftover E2E-fixture content — "Fixture Exercise 1" etc.) before a real user can hit
  // them and get "Unable to map AI exercises to exercise master" on Apply. Batched (one
  // catalog fetch for the whole pool) rather than one call per listing.
  async validateMarketplaceSchedules(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { schedules } = req.body as {
        schedules?: Array<{ listingId: string; weeklySchedule: unknown }>;
      };
      if (!Array.isArray(schedules)) {
        res.status(400).json({ success: false, error: "schedules must be an array" });
        return;
      }
      if (schedules.length > 500) {
        res.status(400).json({ success: false, error: "schedules cannot exceed 500 items" });
        return;
      }
      const results = await workoutService.validateMarketplaceSchedules(schedules);
      res.json({ success: true, data: { results } });
    } catch (err) {
      logger.error({ err }, "internal.validateMarketplaceSchedules failed");
      res.status(500).json({ success: false, error: "Failed to validate marketplace schedules" });
    }
  },
};
