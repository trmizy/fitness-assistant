/**
 * Pure snapshot-building logic for TrainingCycle.baselineMetrics /
 * targetMetrics — kept dependency-free and DB-free so it's directly
 * unit-testable with node:test (this repo's established convention; see
 * cycle-metrics.engine.test.ts for the same pattern in this service).
 *
 * `baselineMetrics`/`targetMetrics` are pre-existing columns on
 * TrainingCycle (added in migration 20260721000000_adaptive_cycle_evaluation,
 * schema comment: "deterministic snapshot computed at cycle start") that
 * were never actually populated by any code path — this is that missing
 * wiring, not a new model. See docs/body-state-and-adaptive-planning.md for
 * how this differs from UserProfile.startingWeight (user-service): this is
 * the PER-CYCLE baseline (cycle 2's baseline is cycle 1's end weight, not
 * the user's all-time starting weight), captured once at the moment a
 * cycle actually activates and never rewritten afterward.
 */

export interface InBodySnapshotInput {
  id: string;
  date: string;
  weight: number;
  bodyFatPct?: number | null;
  muscleMass?: number | null;
  bmr?: number | null;
}

export type CycleBaselineMetrics =
  | {
      source: "INBODY";
      weight: number;
      bodyFatPct: number | null;
      muscleMass: number | null;
      bmr: number | null;
      measuredAt: string;
      inbodyId: string;
    }
  | {
      source: "PROFILE_FALLBACK";
      weight: number;
    };

export interface CycleTargetMetrics {
  source: "GOAL_AT_CYCLE_START";
  targetWeight: number;
}

/**
 * Prefers a real InBody reading (on or before cycle start — same one
 * `startInbodyId` already points to) since it carries body-composition
 * detail, not just weight. Falls back to the profile's self-reported
 * currentWeight only when the user has no InBody history yet at all. If
 * neither exists, there is genuinely nothing to snapshot — returns null
 * rather than fabricating a value (do not invent baseline data).
 */
export function buildCycleBaselineMetrics(
  startInBody: InBodySnapshotInput | null,
  profileCurrentWeight: number | null | undefined,
): CycleBaselineMetrics | null {
  if (startInBody) {
    return {
      source: "INBODY",
      weight: startInBody.weight,
      bodyFatPct: startInBody.bodyFatPct ?? null,
      muscleMass: startInBody.muscleMass ?? null,
      bmr: startInBody.bmr ?? null,
      measuredAt: startInBody.date,
      inbodyId: startInBody.id,
    };
  }
  if (typeof profileCurrentWeight === "number" && Number.isFinite(profileCurrentWeight)) {
    return { source: "PROFILE_FALLBACK", weight: profileCurrentWeight };
  }
  return null;
}

/** Snapshots the goal's targetWeight AS OF cycle start, purely for
 * historical/audit display ("what was the goal when this cycle began") —
 * this is NOT the live goal (that's always read fresh from
 * UserProfile.targetWeight) and updating it later must never happen; a
 * cycle's targetMetrics is written once, at creation/activation. */
export function buildCycleTargetMetrics(
  targetWeight: number | null | undefined,
): CycleTargetMetrics | null {
  if (typeof targetWeight !== "number" || !Number.isFinite(targetWeight)) return null;
  return { source: "GOAL_AT_CYCLE_START", targetWeight };
}
