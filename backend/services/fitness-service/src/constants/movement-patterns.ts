/**
 * Gym-onboarding project follow-up — the canonical movementPattern
 * taxonomy, extracted from prisma/seed_movement_patterns.ts (which imports
 * this rather than the other way around) so anything that just needs the
 * list of valid values — like a test or a future validation layer — never
 * has to import a script with top-level side effects (that script used to
 * call main() at module-load time, which meant importing it for this
 * constant alone silently re-ran the whole classification pass).
 *
 * See prisma/seed_movement_patterns.ts for the classification rules and
 * tier breakdown (name-regex vs typeOfActivity+type+bodyPart fallback).
 */
export const MOVEMENT_PATTERNS = [
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
  "HIP_EXTENSION",
  "HIP_ABDUCTION_ADDUCTION",
  "KNEE_EXTENSION",
  "KNEE_FLEXION",
  "ELBOW_FLEXION",
  "ELBOW_EXTENSION",
  "SHOULDER_ISOLATION",
  "CALF_RAISE",
  "CORE_FLEXION",
  "CORE_ROTATION",
  "CORE_ANTI_EXTENSION",
  "CARRY",
  "LOCOMOTION",
  "CARDIO",
  "MOBILITY",
  "OTHER",
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];
