/**
 * Effective goal — the ONE answer to "what is this user's body goal right now?" for the engines that size calories
 * and judge a cycle (docs/goal-coherence/GOAL_COHERENCE_AUDIT_AND_DESIGN_20261121.md, owner decision 21/11:
 * "the current phase of an ACTIVE roadmap wins; the profile goal is the long-term intent").
 *
 * Derived on read, never stored: there is no new column and no second source of truth. A roadmap spans several
 * phases (fat loss -> maintenance -> lean gain), which one profile enum cannot express; the engines used to read
 * UserProfile.goal only, so a MUSCLE_GAIN profile under a FAT_LOSS roadmap was sized with a surplus (found by a real run).
 *
 * Fallback is always the profile goal, so a user with no ACTIVE roadmap behaves exactly as before.
 */
import { prisma } from "../repositories/prisma";
import type { Goal } from "./nutrition-bootstrap.engine";

export type EffectiveGoalSource = "ROADMAP_PHASE" | "PROFILE" | "NONE";

export interface EffectiveGoal {
  goal: Goal | null;
  source: EffectiveGoalSource;
  /** the active phase that decided it (ROADMAP_PHASE only) */
  phaseType: string | null;
  roadmapId: string | null;
}

/**
 * RoadmapPhaseType -> engine Goal. The inverse of fitness-roadmap.service's mapGoalTypeToFallbackPhaseType.
 * Energy-neutral phases map to MAINTENANCE (no deficit, no surplus). RECOMPOSITION is MAINTENANCE as the cautious
 * default (decision still open with the owner): it must never silently become a deficit or a surplus.
 * Unknown values map to MAINTENANCE, never to a deficit/surplus.
 */
export function goalForPhaseType(phaseType: string | null | undefined): Goal {
  switch (phaseType) {
    case "FAT_LOSS":
    case "MINI_CUT":
      return "WEIGHT_LOSS";
    case "LEAN_GAIN":
      return "MUSCLE_GAIN";
    case "PERFORMANCE":
      return "ATHLETIC_PERFORMANCE";
    case "MAINTENANCE":
    case "DIET_BREAK":
    case "RECOVERY":
    case "RECOMPOSITION":
    default:
      return "MAINTENANCE";
  }
}

type Db = Pick<typeof prisma, "roadmapPhase">;

/** The user's effective goal: the ACTIVE phase of their ACTIVE roadmap, else the profile goal. */
export async function resolveEffectiveGoal(userId: string, profileGoal: string | null | undefined, db: Db = prisma): Promise<EffectiveGoal> {
  const phase = await db.roadmapPhase.findFirst({
    where: { status: "ACTIVE", roadmap: { userId, status: "ACTIVE", archivedAt: null } },
    select: { phaseType: true, roadmapId: true },
  });
  if (phase) return { goal: goalForPhaseType(phase.phaseType), source: "ROADMAP_PHASE", phaseType: phase.phaseType, roadmapId: phase.roadmapId };
  if (profileGoal) return { goal: profileGoal as Goal, source: "PROFILE", phaseType: null, roadmapId: null };
  return { goal: null, source: "NONE", phaseType: null, roadmapId: null };
}

/**
 * The goal a cycle should be judged against. A roadmap-linked cycle follows its own phase (this also repairs cycles
 * that were snapshotted from the profile before this existed); a legacy/manual cycle keeps its own snapshot.
 */
export async function resolveCycleGoal(cycle: { goal: string | null; roadmapPhaseId?: string | null }, db: Db = prisma): Promise<string | null> {
  if (cycle.roadmapPhaseId) {
    const phase = await db.roadmapPhase.findUnique({ where: { id: cycle.roadmapPhaseId }, select: { phaseType: true } });
    if (phase) return goalForPhaseType(phase.phaseType);
  }
  return cycle.goal;
}
