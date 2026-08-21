/**
 * Hardening pass §7/§8 — deterministic FINAL safety net for generated
 * workout plans. The candidate-pool filtering in
 * /internal/exercises/for-ai-plans already prevents equipment violations
 * upstream (and is itself sampled/bounded — up to 500 exercises per call,
 * see equipment-filtering.integration.test.ts's own notes on that cap).
 * This validator is the last line of defense: given the SMALL, EXACT set
 * of exerciseIds a specific generated plan actually used, it re-checks
 * each one's real equipment requirement against the user's real owned
 * equipment — no sampling, no truncation, so it can never produce a false
 * positive the way re-querying the large candidate-pool endpoint could.
 *
 * Pure structured-data check — never string/name matching (§7's own
 * requirement echoes equipment-availability.util.ts's existing design).
 */
import { prisma } from "../repositories/prisma";
import {
  isExerciseAvailable,
  type ExerciseEquipmentLink,
} from "../utils/equipment-availability.util";

export type PlanEquipmentViolation = {
  exerciseId: string;
  exerciseName: string;
  day: string;
  dayIndex: number;
  required: string[]; // equipment slugs actually required (REQUIRED-type links)
  alternatives: string[]; // equipment slugs that would each independently satisfy this exercise (ALTERNATIVE-type links)
  available: string[]; // the equipment slugs the user actually owns
};

export type PlanEquipmentValidationResult = {
  valid: boolean;
  violations: PlanEquipmentViolation[];
  // true when the user has no saved UserEquipment rows at all — matches
  // the SAME backward-compatible fallback semantics as
  // /internal/exercises/for-ai-plans (no granular equipment saved yet =
  // nothing to violate, not a blanket failure for every pre-existing user).
  skippedNoUserEquipment: boolean;
};

// A single day's exercise entry, shaped like PlanContent's weeklySchedule —
// only the fields this validator actually needs.
export type PlanExerciseRef = { exerciseId: string; name?: string };
export type PlanDayRef = { day: string; exercises: PlanExerciseRef[] };

export const planEquipmentValidatorService = {
  async validate(weeklySchedule: PlanDayRef[], userId: string): Promise<PlanEquipmentValidationResult> {
    const ownedRows = await prisma.userEquipment.findMany({ where: { userId }, select: { equipmentId: true } });
    if (ownedRows.length === 0) {
      return { valid: true, violations: [], skippedNoUserEquipment: true };
    }
    const ownedIds = new Set(ownedRows.map((r) => r.equipmentId));

    const exerciseIds = Array.from(
      new Set(
        weeklySchedule.flatMap((day) => day.exercises.map((ex) => ex.exerciseId)).filter(Boolean),
      ),
    );
    if (exerciseIds.length === 0) {
      return { valid: true, violations: [], skippedNoUserEquipment: false };
    }

    const [links, equipmentRows] = await Promise.all([
      prisma.exerciseEquipment.findMany({
        where: { exerciseId: { in: exerciseIds } },
        select: { exerciseId: true, equipmentId: true, requirementType: true },
      }),
      prisma.equipment.findMany({ select: { id: true, slug: true } }),
    ]);
    const slugById = new Map(equipmentRows.map((e) => [e.id, e.slug]));

    const linksByExercise = new Map<string, ExerciseEquipmentLink[]>();
    for (const link of links) {
      const arr = linksByExercise.get(link.exerciseId) ?? [];
      arr.push({ equipmentId: link.equipmentId, requirementType: link.requirementType });
      linksByExercise.set(link.exerciseId, arr);
    }

    const violations: PlanEquipmentViolation[] = [];
    weeklySchedule.forEach((day, dayIndex) => {
      for (const ex of day.exercises) {
        const exLinks = linksByExercise.get(ex.exerciseId) ?? [];
        if (isExerciseAvailable(exLinks, ownedIds)) continue;
        violations.push({
          exerciseId: ex.exerciseId,
          exerciseName: ex.name ?? "",
          day: day.day,
          dayIndex,
          required: exLinks
            .filter((l) => l.requirementType === "REQUIRED")
            .map((l) => slugById.get(l.equipmentId) ?? l.equipmentId),
          alternatives: exLinks
            .filter((l) => l.requirementType === "ALTERNATIVE")
            .map((l) => slugById.get(l.equipmentId) ?? l.equipmentId),
          available: Array.from(ownedIds).map((id) => slugById.get(id) ?? id),
        });
      }
    });

    return { valid: violations.length === 0, violations, skippedNoUserEquipment: false };
  },
};
