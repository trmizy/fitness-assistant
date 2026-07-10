import { Request, Response } from "express";
import { exerciseRepository } from "../repositories/exercise.repository";
import { logger } from "@gym-coach/shared";

// Equipment allowed per training location / preference
const HOME_EQUIPMENT = [
  "BODYWEIGHT",
  "DUMBBELLS",
  "RESISTANCE_BAND",
  "KETTLEBELL",
  "MEDICINE_BALL",
  "FOAM_ROLLER",
];
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
  async exercisesForAiPlans(req: Request, res: Response): Promise<void> {
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

      const where: Record<string, any> = {};
      if (bodyPart) where.bodyPart = bodyPart;
      if (typeOfActivity) where.typeOfActivity = typeOfActivity;

      // Equipment filter: explicit param > equipmentPreference > trainingLocation
      if (equipment) {
        where.typeOfEquipment = equipment;
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

      const result = await exerciseRepository.findMany(where);
      let exercises = (result.data as any[]).slice(0, lim).map((ex) => ({
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
      ];
      const escapeLike = (value: string) => value.replace(/'/g, "''");
      const excludedSql = excludedKeywords
        .map((keyword) => `name NOT ILIKE '%${escapeLike(keyword)}%'`)
        .join(" AND ");
      const commonSql = commonKeywords
        .map((keyword) => `name ILIKE '%${escapeLike(keyword)}%'`)
        .join(" OR ");
      const foods = await prisma.$queryRawUnsafe<any[]>(`
        SELECT id, name, calories, protein, carbs, fats
        FROM foods
        WHERE calories BETWEEN 20 AND 600
          AND ${excludedSql}
          AND (${commonSql})
        ORDER BY protein DESC, calories ASC
        LIMIT 160
      `);
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
      }));
      res.json({ success: true, data: { foods: mappedFoods } });
    } catch (err) {
      logger.error({ err }, "internal.foodsForAiNutrition failed");
      res.status(500).json({ success: false, error: "Failed to fetch foods" });
    }
  },
};
