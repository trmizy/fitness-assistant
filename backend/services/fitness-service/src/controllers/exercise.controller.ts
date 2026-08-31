import { Request, Response } from "express";
import { logger } from "@gym-coach/shared";
import { exerciseService } from "../services/exercise.service";
import { exerciseSubstitutionService } from "../services/exercise-substitution.service";
import { equipmentRepository } from "../repositories/equipment.repository";
import type { AuthRequest } from "../middleware/auth.middleware";

export const exerciseController = {
  async listExercises(req: Request, res: Response): Promise<void> {
    try {
      const {
        search,
        bodyPart,
        muscleGroup,
        equipment,
        activityType,
        type,
        typeOfActivity,
        typeOfEquipment,
        ids,
        page,
        limit,
      } = req.query as Record<string, string>;
      const exercises = await exerciseService.listExercises({
        search,
        bodyPart,
        muscleGroup,
        equipment,
        activityType,
        type,
        typeOfActivity,
        typeOfEquipment,
        ids,
        page,
        limit,
      });
      res.json(exercises);
    } catch (error: any) {
      logger.error(
        {
          message: error?.message,
          stack: error?.stack,
          name: error?.name,
          code: error?.code,
        },
        "Error fetching exercises",
      );
      res.status(500).json({ error: "Failed to fetch exercises" });
    }
  },

  async getFilterOptions(_req: Request, res: Response): Promise<void> {
    try {
      const options = await exerciseService.getFilterOptions();
      res.json(options);
    } catch (error: any) {
      logger.error({ err: error }, "Error fetching exercise filter options");
      res
        .status(500)
        .json({ error: "Failed to fetch exercise filter options" });
    }
  },

  async getExercise(req: Request, res: Response): Promise<void> {
    try {
      const exercise = await exerciseService.getExercise(req.params.id);
      res.json(exercise);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error fetching exercise:", error);
      res.status(500).json({ error: "Failed to fetch exercise" });
    }
  },

  // Gate 6 — GET /exercises/muscles: canonical muscle taxonomy (29
  // entries seeded from data/catalog/taxonomy/ref_muscles.csv), the
  // legend/reference list the muscle-map UI's body silhouette is built
  // against.
  async listMuscles(_req: Request, res: Response): Promise<void> {
    try {
      const muscles = await exerciseService.listMuscles();
      res.json({ muscles });
    } catch (error: any) {
      logger.error({ err: error }, "Error fetching muscle taxonomy");
      res.status(500).json({ error: "Failed to fetch muscle taxonomy" });
    }
  },

  // Gate 6 — GET /exercises/:id/muscle-map: real primary/secondary
  // ExerciseMuscle data for one exercise. `mapped: false` (empty
  // primary/secondary) is a valid, expected response for an exercise
  // with no mapping yet — never a 404/error for that case.
  async getMuscleMap(req: Request, res: Response): Promise<void> {
    try {
      const muscleMap = await exerciseService.getMuscleMap(req.params.id);
      res.json(muscleMap);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error({ err: error }, "Error fetching exercise muscle map");
      res.status(500).json({ error: "Failed to fetch exercise muscle map" });
    }
  },

  // POST /exercises — admin-only (BUG-027 / TC-ADMIN-ADV-05). Accepts both the
  // canonical schema (exerciseName, typeOfActivity, ...) and a friendlier alias
  // shape that the test cases use ({ name, muscleGroups, equipment, difficulty }).
  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role !== "ADMIN") {
        res.status(403).json({ error: "Admin role required" });
        return;
      }
      const b = req.body || {};
      const payload = {
        exerciseName: b.exerciseName ?? b.name,
        typeOfActivity: b.typeOfActivity ?? "STRENGTH",
        typeOfEquipment:
          b.typeOfEquipment ??
          (Array.isArray(b.equipment) ? b.equipment[0] : b.equipment) ??
          "BODYWEIGHT",
        bodyPart: b.bodyPart ?? "FULL_BODY",
        type: b.type ?? "PUSH",
        muscleGroupsActivated: b.muscleGroupsActivated ?? b.muscleGroups ?? [],
        instructions: b.instructions ?? b.description ?? "TBD",
        videoUrl: b.videoUrl ?? null,
      };
      if (!payload.exerciseName) {
        res.status(400).json({ error: "name / exerciseName is required" });
        return;
      }
      const created = await exerciseService.create(payload);
      res.status(201).json(created);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error creating exercise:", error);
      res.status(500).json({ error: "Failed to create exercise" });
    }
  },

  // Roadmap P1.5 "Custom exercises" — any authenticated user (not
  // admin-only, unlike create() above, which stays the existing
  // catalog-curation path).
  async createCustom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await exerciseService.createCustomExercise(req.user!.id, req.body ?? {});
      res.status(result.blocked ? 409 : 201).json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error creating custom exercise:", error);
      res.status(500).json({ error: "Failed to create custom exercise" });
    }
  },

  async listMyCustom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const exercises = await exerciseService.listMyCustomExercises(req.user!.id);
      res.json({ exercises });
    } catch (error: any) {
      logger.error("Error listing custom exercises:", error);
      res.status(500).json({ error: "Failed to list custom exercises" });
    }
  },

  async archiveCustom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await exerciseService.archiveCustomExercise(req.user!.id, req.params.id);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error("Error archiving custom exercise:", error);
      res.status(500).json({ error: "Failed to archive custom exercise" });
    }
  },

  // Gym-onboarding project §17 — "this exercise doesn't fit my equipment,
  // what else can I do instead?", scoped to the caller's own saved
  // equipment (Profile → Training Setup → Available Equipment).
  // Returns a RANKED LIST (not just one best match) so the "Swap exercise"
  // UI can show the user a few real options with a reason each, rather
  // than silently picking for them. `?limit=` caps how many (default 5).
  async getSubstitute(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const excludeParam = typeof req.query.exclude === "string" ? req.query.exclude : "";
      const excludeExerciseIds = excludeParam.split(",").map((s) => s.trim()).filter(Boolean);
      const limitParam = Number(req.query.limit);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(10, Math.trunc(limitParam)) : 5;

      const equipmentIds = await equipmentRepository.listUserEquipmentIds(userId);
      const substitutes = await exerciseSubstitutionService.rankSubstitutes(
        id,
        new Set(equipmentIds),
        { excludeExerciseIds, limit },
      );
      if (substitutes.length === 0) {
        res.status(404).json({ error: "No suitable substitute found for your available equipment" });
        return;
      }
      // `substitute` (singular, best match) kept for any existing caller
      // expecting the old single-object shape; `substitutes` is the new
      // ranked list the UI actually uses.
      res.json({ substitute: substitutes[0], substitutes });
    } catch (error: any) {
      logger.error({ message: error?.message }, "Error finding exercise substitute");
      res.status(500).json({ error: "Failed to find a substitute exercise" });
    }
  },
};
