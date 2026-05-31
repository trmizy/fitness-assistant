import { logger } from '@gym-coach/shared';
import { exerciseRepository } from '../repositories/exercise.repository';

const BODY_PARTS = new Set(['UPPER_BODY', 'LOWER_BODY', 'CORE', 'FULL_BODY']);
const EQUIPMENTS = new Set([
  'BODYWEIGHT',
  'BARBELL',
  'DUMBBELLS',
  'KETTLEBELL',
  'MACHINE',
  'RESISTANCE_BAND',
  'CABLE',
  'MEDICINE_BALL',
  'FOAM_ROLLER',
]);
const ACTIVITY_TYPES = new Set(['STRENGTH', 'CARDIO', 'MOBILITY', 'STRENGTH_CARDIO', 'STRENGTH_MOBILITY']);
const MOVEMENT_TYPES = new Set(['PUSH', 'PULL', 'HOLD', 'STRETCH']);
const MUSCLE_GROUP_ALIASES: Record<string, string[]> = {
  back: ['lats', 'middle back', 'lower back', 'traps'],
  arms: ['biceps', 'triceps', 'forearms'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'],
  chest: ['chest'],
  shoulders: ['shoulders'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  core: ['abdominals'],
};

function normalizeEnum(value?: string) {
  return value?.trim().replace(/[\s-]+/g, '_').toUpperCase();
}

function normalizeEquipment(value?: string) {
  const normalized = normalizeEnum(value);
  if (normalized === 'DUMBBELL' || normalized === 'DUMBBELL_SINGLE') return 'DUMBBELLS';
  if (normalized === 'BAND') return 'RESISTANCE_BAND';
  return normalized;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
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
    page?: string | number;
    limit?: string | number;
  }) {
    const page = boundedInt(filters.page, 1, 1, 10_000);
    const limit = boundedInt(filters.limit, 30, 1, 100);
    const and: any[] = [];
    const bodyPart = normalizeEnum(filters.bodyPart);
    const equipment = normalizeEquipment(filters.equipment ?? filters.typeOfEquipment);
    const activityType = normalizeEnum(filters.activityType ?? filters.typeOfActivity);
    const type = normalizeEnum(filters.type);
    const muscleGroup = filters.muscleGroup?.trim().toLowerCase();
    const search = filters.search?.trim();

    if (bodyPart && BODY_PARTS.has(bodyPart)) and.push({ bodyPart });
    if (equipment && EQUIPMENTS.has(equipment)) and.push({ typeOfEquipment: equipment });
    if (activityType && ACTIVITY_TYPES.has(activityType)) and.push({ typeOfActivity: activityType });
    if (type && MOVEMENT_TYPES.has(type)) and.push({ type });
    if (muscleGroup) {
      const muscleValues = MUSCLE_GROUP_ALIASES[muscleGroup] || [muscleGroup];
      and.push({ OR: muscleValues.map((value) => ({ muscleGroupsActivated: { has: value } })) });
    }
    if (search) {
      const searchEnum = normalizeEnum(search);
      const searchOr: any[] = [
        { exerciseName: { contains: filters.search, mode: 'insensitive' } },
        { instructions: { contains: filters.search, mode: 'insensitive' } },
      ];
      if (searchEnum && BODY_PARTS.has(searchEnum)) searchOr.push({ bodyPart: searchEnum });
      if (searchEnum && EQUIPMENTS.has(searchEnum)) searchOr.push({ typeOfEquipment: searchEnum });
      if (searchEnum && ACTIVITY_TYPES.has(searchEnum)) searchOr.push({ typeOfActivity: searchEnum });
      searchOr.push({ muscleGroupsActivated: { has: search.toLowerCase() } });
      and.push({ OR: searchOr });
    }

    const where = and.length > 0 ? { AND: and } : {};
    const [result, total, options] = await Promise.all([
      exerciseRepository.findMany(where, { skip: (page - 1) * limit, take: limit }),
      exerciseRepository.count(where),
      exerciseRepository.getFilterOptions(),
    ]);
    if (result.fromCache) logger.info('Cache hit for exercises');
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
    if (!exercise) throw { status: 404, message: 'Exercise not found' };
    return exercise;
  },

  async create(data: any) {
    return exerciseRepository.create(data);
  },
};
