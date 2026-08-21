/**
 * Equipment-aware exercise substitution — gym-onboarding project §17,
 * refined in the follow-up pass to weight movementPattern as the dominant
 * signal now that it's populated (see prisma/seed_movement_patterns.ts).
 *
 * Deliberately NOT muscle-name matching alone: candidates are scored on
 * movement-pattern equality (highest weight — a press should prefer another
 * press before a fly, a vertical pull should prefer another vertical pull
 * before a horizontal row), muscle-group overlap, mechanics (compound/
 * isolation), activity type, and body part (soft signal only — see below),
 * and are hard-filtered by real equipment availability (equipment-
 * availability.util.ts) and by an exclusion list passed in by the caller —
 * this service never overrides an injury/safety exclusion, it only chooses
 * among what's already been cleared as safe by the caller.
 *
 * bodyPart is intentionally NOT a hard filter (previous version rejected
 * any candidate whose bodyPart differed from the target's) — the 4-value
 * BodyPart enum is too coarse and some legitimate exercises are tagged
 * FULL_BODY even though they train the same muscles/pattern as an
 * UPPER_BODY target (e.g. "Seated Cable Rows"). movementPattern equality +
 * muscle overlap is a strictly more precise gate; bodyPart is now just one
 * more scoring signal among several.
 */
import { prisma } from "../repositories/prisma";
import {
  isExerciseAvailable,
  type ExerciseEquipmentLink,
} from "../utils/equipment-availability.util";

export type SubstitutionCandidate = {
  id: string;
  exerciseName: string;
  bodyPart: string;
  typeOfActivity: string;
  type: string;
  mechanics: string | null;
  movementPattern: string | null;
  muscleGroupsActivated: string[];
};

export type ScoredSubstitute = SubstitutionCandidate & {
  score: number;
  reason: string; // short human-readable explanation, e.g. "Same movement · Same primary muscle"
};

const SELECT_FIELDS = {
  id: true,
  exerciseName: true,
  bodyPart: true,
  typeOfActivity: true,
  type: true,
  mechanics: true,
  movementPattern: true,
  muscleGroupsActivated: true,
} as const;

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** True only when BOTH sides have a known, equal mechanics value. Neither
 * "both null" nor "one null" should ever read as biomechanical similarity —
 * an unknown value is not evidence of a match, so the bonus below is
 * withheld rather than defaulting to a permissive `===` comparison (which
 * would treat `null === null` as true). Hardening pass §12/§13 — locked in
 * by exercise-substitution.test.ts's "null mechanics" cases. */
export function mechanicsKnownAndEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a === b;
}

function scoreCandidate(
  target: SubstitutionCandidate,
  candidate: SubstitutionCandidate,
): { score: number; sameMovementPattern: boolean; sameMuscle: boolean } {
  const muscleOverlap = jaccard(target.muscleGroupsActivated, candidate.muscleGroupsActivated);
  const sameMovementPattern =
    !!target.movementPattern && target.movementPattern === candidate.movementPattern;
  const sameMuscle = muscleOverlap > 0;

  // Hard disqualification — no meaningful relationship at all. Keeps the
  // pool from ever surfacing e.g. a calf raise as a "substitute" for a
  // bench press just because both happen to be STRENGTH/PUSH.
  if (!sameMovementPattern && !sameMuscle && candidate.bodyPart !== target.bodyPart) {
    return { score: 0, sameMovementPattern, sameMuscle };
  }

  let score = 0;
  if (sameMovementPattern) score += 5; // dominant signal — see file header
  score += muscleOverlap * 3;
  if (mechanicsKnownAndEqual(target.mechanics, candidate.mechanics)) score += 1.5;
  if (candidate.bodyPart === target.bodyPart) score += 0.5;
  if (candidate.typeOfActivity === target.typeOfActivity) score += 0.5;
  if (candidate.type === target.type) score += 0.25;
  return { score, sameMovementPattern, sameMuscle };
}

function explainMatch(sameMovementPattern: boolean, sameMuscle: boolean, sameMechanics: boolean): string {
  const parts: string[] = [];
  if (sameMovementPattern) parts.push("Cùng kiểu chuyển động");
  if (sameMuscle) parts.push("Cùng nhóm cơ chính");
  if (sameMechanics) parts.push("Cùng mức độ phối hợp cơ");
  return parts.length > 0 ? parts.join(" · ") : "Gần giống nhất trong nhóm cơ bạn có thể tập";
}

async function candidatePool(target: SubstitutionCandidate, excludeIds: Set<string>) {
  const or: any[] = [{ bodyPart: target.bodyPart }];
  if (target.movementPattern) or.push({ movementPattern: target.movementPattern });
  const where: any = { id: { notIn: Array.from(excludeIds) }, OR: or };
  return prisma.exercise.findMany({
    where,
    select: SELECT_FIELDS,
    // Deterministic input order matters: many candidates legitimately tie
    // on score (e.g. a dozen different push-up/press variants share
    // identical {chest,shoulders,triceps} + HORIZONTAL_PUSH + compound), and
    // Array.prototype.sort is stable — so an alphabetical base order means
    // ties resolve alphabetically/reproducibly instead of depending on
    // whatever arbitrary order Postgres happens to return.
    orderBy: { exerciseName: "asc" },
    take: 500, // bounded — same movementPattern/bodyPart rarely exceeds this
  });
}

async function linksByExerciseId(exerciseIds: string[]): Promise<Map<string, ExerciseEquipmentLink[]>> {
  const links = await prisma.exerciseEquipment.findMany({
    where: { exerciseId: { in: exerciseIds } },
    select: { exerciseId: true, equipmentId: true, requirementType: true },
  });
  const map = new Map<string, ExerciseEquipmentLink[]>();
  for (const link of links) {
    const arr = map.get(link.exerciseId) ?? [];
    arr.push({ equipmentId: link.equipmentId, requirementType: link.requirementType });
    map.set(link.exerciseId, arr);
  }
  return map;
}

export const exerciseSubstitutionService = {
  /**
   * Returns the best available substitute for `exerciseId` given the
   * user's owned equipment, or null if nothing suitable was found.
   */
  async findSubstitute(
    exerciseId: string,
    ownedEquipmentIds: Set<string>,
    options?: { excludeExerciseIds?: string[] },
  ): Promise<SubstitutionCandidate | null> {
    const ranked = await this.rankSubstitutes(exerciseId, ownedEquipmentIds, { ...options, limit: 1 });
    return ranked[0] ?? null;
  },

  /**
   * Returns up to `limit` ranked, available, equipment-compatible
   * substitutes with a human-readable match reason — used by the "Swap
   * exercise" UI to show the user more than one option.
   */
  async rankSubstitutes(
    exerciseId: string,
    ownedEquipmentIds: Set<string>,
    options?: { excludeExerciseIds?: string[]; limit?: number },
  ): Promise<ScoredSubstitute[]> {
    const target = await prisma.exercise.findUnique({ where: { id: exerciseId }, select: SELECT_FIELDS });
    if (!target) return [];

    const exclude = new Set([exerciseId, ...(options?.excludeExerciseIds ?? [])]);
    const pool = await candidatePool(target, exclude);
    if (pool.length === 0) return [];

    const links = await linksByExerciseId(pool.map((p) => p.id));

    const scored: ScoredSubstitute[] = [];
    for (const candidate of pool) {
      if (!isExerciseAvailable(links.get(candidate.id) ?? [], ownedEquipmentIds)) continue;
      const { score, sameMovementPattern, sameMuscle } = scoreCandidate(target, candidate);
      if (score <= 0) continue;
      const sameMechanics = mechanicsKnownAndEqual(target.mechanics, candidate.mechanics);
      scored.push({ ...candidate, score, reason: explainMatch(sameMovementPattern, sameMuscle, sameMechanics) });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, options?.limit ?? 5);
  },
};
