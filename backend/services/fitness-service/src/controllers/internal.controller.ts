import { Request, Response } from 'express';
import { exerciseRepository } from '../repositories/exercise.repository';
import { logger } from '@gym-coach/shared';

export const internalController = {
  async exercisesForAiPlans(req: Request, res: Response): Promise<void> {
    try {
      const { goal, bodyPart, equipment, typeOfActivity, limit, muscleGroup } = req.query as Record<string, string>;

      // Start with an empty where and selectively add filters. We avoid matching
      // goal directly against muscleGroupsActivated. Instead we map common
      // high-level goals to a broader set of filters so queries aren't too
      // narrow (e.g. WEIGHT_LOSS shouldn't be treated as a muscle group).
      const where: Record<string, any> = {};
      if (bodyPart) where.bodyPart = bodyPart;
      if (typeOfActivity) where.typeOfActivity = typeOfActivity;
      if (equipment) where.typeOfEquipment = equipment;

      // If a concrete muscleGroup param is explicitly provided (e.g. "shoulders"),
      // keep the original behaviour and filter by membership in muscleGroupsActivated.
      if (muscleGroup) {
        where.muscleGroupsActivated = { has: muscleGroup };
      } else if (goal) {
        // Map high-level goals to a more permissive prisma `where` clause.
        const g = String(goal).trim().toUpperCase();
        // Default mapping: empty means no additional constraints (broad).
        let mapped: Record<string, any> | null = null;
        // Helper lists
        const coreGroups = ['legs', 'chest', 'back', 'shoulders', 'core', 'arms'];
        const resistanceEquip = ['BARBELL', 'DUMBBELLS', 'MACHINE', 'KETTLEBELL', 'CABLE'];

        if (g === 'WEIGHT_LOSS' || g === 'FAT_LOSS' || g === 'GIAM_MO' || g === 'LOSE_WEIGHT') {
          // Weight loss: prefer cardio, full-body, compound, and bodyweight/resistance
          mapped = {
            OR: [
              { typeOfActivity: 'CARDIO' },
              { typeOfActivity: 'MOBILITY' },
              { typeOfEquipment: { in: ['BODYWEIGHT', ...resistanceEquip] } },
              // also prefer exercises activating core/legs/chest/back/shoulders
              { muscleGroupsActivated: { hasSome: coreGroups } },
            ],
          };
        } else if (g === 'MUSCLE_GAIN' || g === 'HYPERTROPHY' || g === 'TANG_CO' || g === 'MUSCLE') {
          mapped = {
            OR: [
              { typeOfActivity: 'STRENGTH' },
              { typeOfEquipment: { in: resistanceEquip } },
              { muscleGroupsActivated: { hasSome: coreGroups } },
            ],
          };
        } else if (g === 'STRENGTH' || g === 'INCREASE_STRENGTH') {
          mapped = {
            OR: [
              { typeOfActivity: 'STRENGTH' },
              // favour barbell / machines / heavy resistance
              { typeOfEquipment: { in: ['BARBELL', 'MACHINES', 'DUMBBELLS'] } },
            ],
          };
        } else if (g === 'ENDURANCE' || g === 'CARDIO' || g === 'SUC_BENH') {
          mapped = {
            OR: [
              { typeOfActivity: 'CARDIO' },
              { typeOfEquipment: { in: ['BODYWEIGHT'] } },
            ],
          };
        } else {
          // Unknown high-level goal: fall back to a broad query so we don't
          // return an empty allowed set. Prefer common exercises (no extra filter).
          mapped = null;
        }

        if (mapped) {
          // Merge mapped filters into the where clause using AND semantics when
          // other explicit filters are present.
          Object.assign(where, mapped);
        }
      }

      const result = await exerciseRepository.findMany(where);
      let exercises = result.data as any[];

      // Logging for diagnostics: report which goal mapping was used and how many
      // exercises are returned for visibility in runtime.
      try {
        logger.info({ goal: req.query.goal, muscleGroup: req.query.muscleGroup, where, returned: exercises.length }, 'internal.exercisesForAiPlans result');
      } catch (e) {
        // noop — don't fail the endpoint on logging errors
      }

      let lim = 100;
      if (limit) {
        const n = Number(limit);
        if (Number.isFinite(n) && n > 0) lim = Math.min(500, Math.trunc(n));
      }

      exercises = exercises.slice(0, lim).map((ex) => ({
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

      res.json({ success: true, data: { exercises } });
    } catch (err) {
      logger.error({ err }, 'internal.exercisesForAiPlans failed');
      res.status(500).json({ success: false, error: 'Failed to fetch exercises' });
    }
  },
};
