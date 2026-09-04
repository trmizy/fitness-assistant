/**
 * Deterministic exercise-availability rule given a set of equipment ids a
 * user owns. Single source of truth — used by the /internal/exercises/
 * for-ai-plans candidate filter, the exercise-substitution helper, and the
 * data-integrity audit script, so all three agree on what "available" means.
 *
 * Rule (matches docs discussed for the gym-onboarding project, §11/§12):
 *   - REQUIRED links: ALL must be owned.
 *   - ALTERNATIVE links form one OR-group: at least ONE must be owned
 *     (this is how a family like "Lat Pulldown Machine" vs "Cable Machine"
 *     is modeled — either one unlocks the exercise, never both).
 *   - OPTIONAL links never gate availability (reserved for future use,
 *     nothing in the current catalog uses it).
 *   - An exercise with zero equipment links (shouldn't happen post-audit,
 *     but never crash if it does) is always available.
 */
export type EquipmentRequirementType = "REQUIRED" | "ALTERNATIVE" | "OPTIONAL";

export type ExerciseEquipmentLink = {
  equipmentId: string;
  requirementType: string;
};

export function isExerciseAvailable(
  links: ExerciseEquipmentLink[],
  ownedEquipmentIds: Set<string>,
): boolean {
  if (links.length === 0) return true;

  const required = links.filter((l) => l.requirementType === "REQUIRED");
  const alternatives = links.filter((l) => l.requirementType === "ALTERNATIVE");

  const allRequiredOwned = required.every((l) => ownedEquipmentIds.has(l.equipmentId));
  if (!allRequiredOwned) return false;

  if (alternatives.length === 0) return true;
  return alternatives.some((l) => ownedEquipmentIds.has(l.equipmentId));
}

/** Convenience for grouped-by-exercise link maps (exerciseId -> links[]). */
export function filterAvailableExerciseIds(
  linksByExerciseId: Map<string, ExerciseEquipmentLink[]>,
  ownedEquipmentIds: Set<string>,
): Set<string> {
  const available = new Set<string>();
  for (const [exerciseId, links] of linksByExerciseId) {
    if (isExerciseAvailable(links, ownedEquipmentIds)) available.add(exerciseId);
  }
  return available;
}
