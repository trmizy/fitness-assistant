/**
 * Phase 4.4 — observed BODY STATE + GOAL GAP / TRAJECTORY foundation
 * (docs/ai-product/phase4-4-body-goal-trajectory.md).
 *
 * Not a new analytics engine. It reuses the cycle engine's own pure functions:
 *   evaluateInBodyQuality        (outlier / interval / mixed-source flags — never deletes)
 *   computeBodyCompositionTrends (least-squares trend over the comparable points)
 * and only adds: a lookback, explicit data-quality states, provenance for the
 * weight sources, typed (validated) goal/roadmap facts and descriptive gap /
 * observed-trajectory numbers.
 *
 * Deliberately NOT here: any good/bad/on-track classification, any
 * nutrition/training causal explanation, any extrapolation, any LLM.
 */
import { prisma } from "../repositories/prisma";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import {
  fetchInBodyHistoryStrict,
  fetchUserProfileStrict,
  type InBodyEntrySnapshot,
} from "../clients/user.client";
import { evaluateInBodyQuality } from "./inbody-quality.evaluator";
import { computeBodyCompositionTrends } from "./cycle-metrics.engine";

export type BodyDataQuality = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT_HISTORY" | "NO_DATA" | "STALE";

/** Product lookback for body trends. InBody cadence is user-driven (the quality evaluator itself treats <3 days
 * apart as non-independent) and far sparser than workouts, so the training window's 28 days is not reused.
 * Default = 3 × the default cycle length (TrainingCycle.durationDays default 30) so a monthly measurer still
 * yields ≥2 comparable points. PRODUCT_HEURISTIC, not a scientific constant. */
export const BODY_LOOKBACK_DEFAULT_DAYS = 90;
export const BODY_LOOKBACK_MIN_DAYS = 14;
export const BODY_LOOKBACK_MAX_DAYS = 365;

export function normalizeBodyLookbackDays(days: number | undefined): number {
  if (days == null) return BODY_LOOKBACK_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < BODY_LOOKBACK_MIN_DAYS || days > BODY_LOOKBACK_MAX_DAYS) {
    throw new RangeError(`lookbackDays must be an integer between ${BODY_LOOKBACK_MIN_DAYS} and ${BODY_LOOKBACK_MAX_DAYS}`);
  }
  return days;
}

export interface BodyObservation {
  /** ISO timestamp of the measurement (InBodyEntry.date) */
  measuredAt: string;
  weightKg: number;
  bodyFatPct: number | null;
  /** NEUTRAL name on purpose — see muscleMassSemantics. null when absent or recorded as 0 (OCR fallback). */
  muscleMassKg: number | null;
  /** how the row was created: OCR extraction or manual form entry (InBodyEntry.status) */
  source: "EXTRACTED" | "MANUAL" | "UNKNOWN";
  /** true when the existing evaluator flagged this point as a change-rate outlier: kept visible, excluded from trends */
  excludedFromTrend: boolean;
}

export interface BodyTrend {
  status: "AVAILABLE" | "INSUFFICIENT_HISTORY";
  /** engine vocabulary: up | flat | down. Neutral — never "improving". Absent when INSUFFICIENT_HISTORY. */
  direction?: "UP" | "FLAT" | "DOWN";
  changePerWeek?: number | null;
  dataPoints: number;
}

export type TrajectoryReason =
  | "NO_TARGET"
  | "NO_TARGET_DATE"
  | "NO_STARTING_STATE"
  | "INSUFFICIENT_BODY_HISTORY"
  | "STALE_BODY_DATA"
  | "UNSUPPORTED_TARGET_METRIC";

export interface BodyGoalState {
  asOf: string;
  lookbackDays: number;
  body: {
    dataQuality: BodyDataQuality;
    observations: {
      totalOnRecord: number;
      inLookback: number;
      comparableInLookback: number;
      firstAt: string | null;
      latestAt: string | null;
    };
    latest: BodyObservation | null;
    /** the observation immediately before `latest` in the lookback (same kind of row), if any */
    previous: BodyObservation | null;
    latestAgeDays: number | null;
    trends: { weight: BodyTrend; bodyFat: BodyTrend; muscleMass: BodyTrend };
    quality: {
      outlierCount: number;
      intervalWarningCount: number;
      mixedSources: boolean;
      confidenceMultiplier: number;
      flags: string[];
    };
    /** InBodyEntry.muscleMass is OCR `skeletal_muscle_mass` for EXTRACTED rows but a generic "Cơ bắp (kg)" field for
     * MANUAL rows; the two cannot be proven identical. UNRESOLVED ⇒ never narrated as skeletal muscle mass. */
    muscleMassSemantics: "UNRESOLVED";
    muscleMassProvenance: { extracted: number; manual: number; unknown: number };
    /** UserProfile.currentWeight: written by manual profile edits AND auto-synced from the newest InBody, with no
     * timestamp or provenance column — so it is kept as a separate, undated "reported" value. */
    profileReportedWeight: { kg: number; matchesLatestMeasurement: boolean | null; differenceFromLatestKg: number | null } | null;
  };
  goal: {
    type: string | null;
    currentTarget:
      | { state: "AVAILABLE"; weightKg: number; source: "PROFILE_TARGET_WEIGHT"; history: "TARGET_HISTORY_UNAVAILABLE" }
      | { state: "NO_TARGET" };
    startingState:
      | { state: "AVAILABLE"; scope: "ACTIVE_CYCLE_BASELINE"; weightKg: number; source: "INBODY" | "PROFILE_FALLBACK"; measuredAt: string | null; cycleStartedAt: string; targetAtCycleStartKg: number | null }
      | { state: "NOT_AVAILABLE"; reason: "NO_ACTIVE_CYCLE" | "NO_VALID_BASELINE_SNAPSHOT" };
    profileStartingWeightKg: number | null;
    gap:
      | {
          state: "AVAILABLE";
          currentKg: number;
          targetKg: number;
          /** currentKg − targetKg (positive: current is above target; negative: below) */
          differenceKg: number;
          absoluteKg: number;
          currentSource: "MEASURED_INBODY" | "PROFILE_REPORTED";
          currentAsOf: string | null;
          /** the other weight source when it exists and differs — never silently dropped */
          alternateCurrent: { source: "PROFILE_REPORTED"; kg: number; differenceKg: number } | null;
        }
      | { state: "NOT_AVAILABLE"; reason: "NO_TARGET" | "NO_CURRENT_WEIGHT" };
    trajectory: {
      observed:
        | {
            state: "AVAILABLE";
            timeSpanDays: number;
            observationCount: number;
            firstWeightKg: number;
            latestWeightKg: number;
            observedChangeKg: number;
            observedRateKgPerWeek: number | null;
            /** pure geometry between the observed weight direction and the sign of the gap — not a judgement */
            directionRelativeToGap: "TOWARD_TARGET" | "AWAY_FROM_TARGET" | "FLAT" | "NOT_APPLICABLE";
          }
        | { state: "NOT_AVAILABLE"; reasons: TrajectoryReason[] };
      onTrack: { status: "NOT_EVALUABLE"; reasons: TrajectoryReason[]; classification: "DEFERRED" };
    };
    roadmap:
      | { state: "NONE" }
      | {
          state: "ACTIVE";
          roadmapId: string;
          name: string;
          goalType: string;
          plannedStartAt: string;
          /** end of the plan — NOT a deadline asserted for the weight target */
          plannedEndAt: string | null;
          currentPhase: { id: string; name: string; phaseType: string; plannedStartAt: string; plannedEndAt: string } | null;
        };
    dataQuality: BodyDataQuality;
  };
}

// ── pure assembly ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const sourceOf = (s?: string | null): BodyObservation["source"] => (s === "extracted" ? "EXTRACTED" : s === "manual" ? "MANUAL" : "UNKNOWN");
const r2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export interface BodyGoalInputs {
  asOf: Date;
  lookbackDays: number;
  entries: InBodyEntrySnapshot[];
  profile: { goal?: string | null; targetWeight?: number | null; currentWeight?: number | null; startingWeight?: number | null } | null;
  activeCycle: { id: string; startDate: Date; baselineMetrics: unknown; targetMetrics: unknown } | null;
  roadmap: {
    id: string; name: string; goalType: string; plannedStartAt: Date; plannedEndAt: Date | null;
    phases: Array<{ id: string; name: string; phaseType: string; status: string; plannedStartAt: Date; plannedEndAt: Date }>;
  } | null;
}

/** Narrow validation of the cycle's typed baseline snapshot (cycle-baseline-snapshot.util.ts); anything else is ignored. */
function validBaseline(raw: unknown): { weightKg: number; source: "INBODY" | "PROFILE_FALLBACK"; measuredAt: string | null } | null {
  const b = raw as { source?: unknown; weight?: unknown; measuredAt?: unknown } | null;
  if (!b || typeof b !== "object" || !finite(b.weight) || (b.weight as number) <= 0) return null;
  if (b.source === "INBODY" && typeof b.measuredAt === "string") return { weightKg: b.weight as number, source: "INBODY", measuredAt: b.measuredAt };
  if (b.source === "PROFILE_FALLBACK") return { weightKg: b.weight as number, source: "PROFILE_FALLBACK", measuredAt: null };
  return null;
}
function validTargetAtStart(raw: unknown): number | null {
  const t = raw as { source?: unknown; targetWeight?: unknown } | null;
  return t && typeof t === "object" && t.source === "GOAL_AT_CYCLE_START" && finite(t.targetWeight) ? (t.targetWeight as number) : null;
}

export function buildBodyGoalState(input: BodyGoalInputs): BodyGoalState {
  const { asOf, lookbackDays } = input;
  const cutoff = asOf.getTime() - lookbackDays * DAY_MS;
  const all = [...input.entries]
    .filter((e) => finite(e.weight) && !Number.isNaN(new Date(e.date).getTime()) && new Date(e.date).getTime() <= asOf.getTime())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const inWindow = all.filter((e) => new Date(e.date).getTime() >= cutoff);

  // Existing quality logic, applied to the lookback entries (flags + exclusions preserved, nothing deleted).
  const quality = evaluateInBodyQuality(inWindow);
  const excluded = new Set(quality.outlierFlags.map((f) => f.entryId));
  const toObs = (e: InBodyEntrySnapshot): BodyObservation => ({
    measuredAt: new Date(e.date).toISOString(),
    weightKg: e.weight,
    bodyFatPct: finite(e.bodyFatPct) ? (e.bodyFatPct as number) : null,
    muscleMassKg: finite(e.muscleMass) && e.muscleMass > 0 ? e.muscleMass : null,
    source: sourceOf(e.status),
    excludedFromTrend: excluded.has(e.id),
  });

  const latestEntry = all.length ? all[all.length - 1] : null;
  const latest = latestEntry ? toObs(latestEntry) : null;
  const latestInWindowIdx = inWindow.length - 1;
  const previous = latestInWindowIdx >= 1 && inWindow[latestInWindowIdx].id === latestEntry?.id ? toObs(inWindow[latestInWindowIdx - 1]) : null;
  const latestAgeDays = latestEntry ? Math.max(0, Math.floor((asOf.getTime() - new Date(latestEntry.date).getTime()) / DAY_MS)) : null;

  // Trends: reuse the engine; a single point is NEVER a trend (the engine returns "flat" for n=1).
  const comparable = quality.comparablePoints;
  const trends = computeBodyCompositionTrends(comparable);
  const muscleTrends = computeBodyCompositionTrends(comparable.filter((p) => finite(p.muscleMass) && p.muscleMass > 0));
  const toTrend = (t: { direction: "up" | "flat" | "down"; changePerWeek: number | null; dataPoints: number } | null): BodyTrend =>
    !t || t.dataPoints < 2
      ? { status: "INSUFFICIENT_HISTORY", dataPoints: t?.dataPoints ?? 0 }
      : { status: "AVAILABLE", direction: t.direction === "up" ? "UP" : t.direction === "down" ? "DOWN" : "FLAT", changePerWeek: t.changePerWeek, dataPoints: t.dataPoints };
  const weightTrend = toTrend(trends.bodyWeightTrend);
  const bodyFatTrend = toTrend(trends.bodyFatTrend);
  const muscleTrend = toTrend(muscleTrends.skeletalMuscleTrend);

  // Window data quality
  const statuses = { extracted: 0, manual: 0, unknown: 0 };
  for (const e of inWindow) (e.status === "extracted" ? statuses.extracted++ : e.status === "manual" ? statuses.manual++ : statuses.unknown++);
  let bodyQuality: BodyDataQuality;
  if (all.length === 0) bodyQuality = "NO_DATA";
  else if (inWindow.length === 0) bodyQuality = "STALE";
  else if (!quality.hasSufficientData) bodyQuality = "INSUFFICIENT_HISTORY";
  else if (quality.outlierFlags.length > 0 || quality.deviceConsistencyWarning) bodyQuality = "PARTIAL";
  else bodyQuality = "SUFFICIENT";

  // Weight sources (explicit provenance; no silent precedence)
  const profileKg = finite(input.profile?.currentWeight) && (input.profile!.currentWeight as number) > 0 ? (input.profile!.currentWeight as number) : null;
  const profileReportedWeight = profileKg == null
    ? null
    : {
        kg: profileKg,
        matchesLatestMeasurement: latest ? Math.abs(profileKg - latest.weightKg) < 0.05 : null,
        differenceFromLatestKg: latest ? r2(profileKg - latest.weightKg) : null,
      };

  // Goal
  const targetKg = finite(input.profile?.targetWeight) && (input.profile!.targetWeight as number) > 0 ? (input.profile!.targetWeight as number) : null;
  const currentTarget: BodyGoalState["goal"]["currentTarget"] = targetKg == null
    ? { state: "NO_TARGET" }
    : { state: "AVAILABLE", weightKg: targetKg, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" };

  let gap: BodyGoalState["goal"]["gap"];
  let currentKg: number | null = null;
  if (targetKg == null) gap = { state: "NOT_AVAILABLE", reason: "NO_TARGET" };
  else {
    const useMeasured = latest != null;
    currentKg = useMeasured ? latest!.weightKg : profileKg;
    if (currentKg == null) gap = { state: "NOT_AVAILABLE", reason: "NO_CURRENT_WEIGHT" };
    else {
      const alt = useMeasured && profileKg != null && Math.abs(profileKg - currentKg) >= 0.05
        ? { source: "PROFILE_REPORTED" as const, kg: profileKg, differenceKg: r2(profileKg - currentKg) }
        : null;
      gap = {
        state: "AVAILABLE", currentKg, targetKg, differenceKg: r2(currentKg - targetKg), absoluteKg: r2(Math.abs(currentKg - targetKg)),
        currentSource: useMeasured ? "MEASURED_INBODY" : "PROFILE_REPORTED",
        currentAsOf: useMeasured ? latest!.measuredAt : null,
        alternateCurrent: alt,
      };
    }
  }

  // Starting state: the ACTIVE cycle's typed baseline snapshot only (never "latest" substituted).
  let startingState: BodyGoalState["goal"]["startingState"];
  if (!input.activeCycle) startingState = { state: "NOT_AVAILABLE", reason: "NO_ACTIVE_CYCLE" };
  else {
    const b = validBaseline(input.activeCycle.baselineMetrics);
    startingState = b
      ? { state: "AVAILABLE", scope: "ACTIVE_CYCLE_BASELINE", weightKg: b.weightKg, source: b.source, measuredAt: b.measuredAt, cycleStartedAt: input.activeCycle.startDate.toISOString(), targetAtCycleStartKg: validTargetAtStart(input.activeCycle.targetMetrics) }
      : { state: "NOT_AVAILABLE", reason: "NO_VALID_BASELINE_SNAPSHOT" };
  }

  // Observed trajectory (descriptive) — comparable weight points in the lookback
  const reasonsObserved: TrajectoryReason[] = [];
  if (all.length > 0 && inWindow.length === 0) reasonsObserved.push("STALE_BODY_DATA");
  else if (comparable.length < 2) reasonsObserved.push("INSUFFICIENT_BODY_HISTORY");
  let observed: BodyGoalState["goal"]["trajectory"]["observed"];
  if (reasonsObserved.length > 0 || weightTrend.status !== "AVAILABLE") {
    observed = { state: "NOT_AVAILABLE", reasons: reasonsObserved.length ? reasonsObserved : ["INSUFFICIENT_BODY_HISTORY"] };
  } else {
    const first = comparable[0], last = comparable[comparable.length - 1];
    const change = r2(last.weight - first.weight);
    let rel: "TOWARD_TARGET" | "AWAY_FROM_TARGET" | "FLAT" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
    if (gap.state === "AVAILABLE") {
      if (weightTrend.direction === "FLAT") rel = "FLAT";
      else if (gap.differenceKg === 0) rel = "NOT_APPLICABLE";
      else rel = (gap.differenceKg > 0 && weightTrend.direction === "DOWN") || (gap.differenceKg < 0 && weightTrend.direction === "UP") ? "TOWARD_TARGET" : "AWAY_FROM_TARGET";
    }
    observed = {
      state: "AVAILABLE",
      timeSpanDays: Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / DAY_MS),
      observationCount: comparable.length,
      firstWeightKg: first.weight, latestWeightKg: last.weight, observedChangeKg: change,
      observedRateKgPerWeek: weightTrend.changePerWeek ?? null,
      directionRelativeToGap: rel,
    };
  }

  // On-track needs ALL of: target, target date, starting state, enough history. No typed target date exists for the
  // weight target (roadmap.plannedEndAt is the end of a plan; goalIntent is free-form Json) ⇒ never evaluable today.
  const onTrackReasons: TrajectoryReason[] = [];
  if (targetKg == null) onTrackReasons.push("NO_TARGET");
  onTrackReasons.push("NO_TARGET_DATE");
  if (startingState.state !== "AVAILABLE") onTrackReasons.push("NO_STARTING_STATE");
  if (all.length > 0 && inWindow.length === 0) onTrackReasons.push("STALE_BODY_DATA");
  else if (comparable.length < 2) onTrackReasons.push("INSUFFICIENT_BODY_HISTORY");

  // Roadmap: typed columns only; the free-form targetMetrics/configuration/objective Json is never read.
  const phase = input.roadmap?.phases.find((p) => p.status === "ACTIVE") ?? null;
  const roadmap: BodyGoalState["goal"]["roadmap"] = input.roadmap
    ? {
        state: "ACTIVE", roadmapId: input.roadmap.id, name: input.roadmap.name, goalType: input.roadmap.goalType,
        plannedStartAt: input.roadmap.plannedStartAt.toISOString(), plannedEndAt: input.roadmap.plannedEndAt?.toISOString() ?? null,
        currentPhase: phase ? { id: phase.id, name: phase.name, phaseType: phase.phaseType, plannedStartAt: phase.plannedStartAt.toISOString(), plannedEndAt: phase.plannedEndAt.toISOString() } : null,
      }
    : { state: "NONE" };

  // goal quality: what the goal facts can support
  const goalQuality: BodyDataQuality =
    targetKg == null && !input.profile?.goal ? "NO_DATA"
      : gap.state === "AVAILABLE" ? (bodyQuality === "STALE" ? "STALE" : "PARTIAL")
      : "PARTIAL";

  return {
    asOf: asOf.toISOString(),
    lookbackDays,
    body: {
      dataQuality: bodyQuality,
      observations: {
        totalOnRecord: all.length,
        inLookback: inWindow.length,
        comparableInLookback: comparable.length,
        firstAt: inWindow.length ? new Date(inWindow[0].date).toISOString() : null,
        latestAt: latest?.measuredAt ?? null,
      },
      latest,
      previous,
      latestAgeDays,
      trends: { weight: weightTrend, bodyFat: bodyFatTrend, muscleMass: muscleTrend },
      quality: {
        outlierCount: quality.outlierFlags.length,
        intervalWarningCount: quality.intervalWarnings.length,
        mixedSources: quality.deviceConsistencyWarning != null,
        confidenceMultiplier: quality.confidenceMultiplier,
        flags: quality.qualityFlags,
      },
      muscleMassSemantics: "UNRESOLVED",
      muscleMassProvenance: statuses,
      profileReportedWeight,
    },
    goal: {
      type: input.profile?.goal ?? null,
      currentTarget,
      startingState,
      profileStartingWeightKg: finite(input.profile?.startingWeight) ? (input.profile!.startingWeight as number) : null,
      gap,
      trajectory: { observed, onTrack: { status: "NOT_EVALUABLE", reasons: onTrackReasons, classification: "DEFERRED" } },
      roadmap,
      dataQuality: goalQuality,
    },
  };
}

// ── read path ─────────────────────────────────────────────────────────────

export async function getBodyGoalState(
  userId: string,
  opts: { lookbackDays?: number; asOf?: Date } = {},
): Promise<BodyGoalState> {
  const lookbackDays = normalizeBodyLookbackDays(opts.lookbackDays);
  const asOf = opts.asOf ?? new Date();
  void cycleThresholds; // thresholds are consumed inside the reused evaluator

  const [entries, profile, activeCycle, roadmap] = await Promise.all([
    fetchInBodyHistoryStrict(userId), // ≤ 1 row/day/user; throws on transport failure (never "no data")
    fetchUserProfileStrict(userId),   // throws on transport failure
    prisma.trainingCycle.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { startDate: "desc" },
      select: { id: true, startDate: true, baselineMetrics: true, targetMetrics: true },
    }),
    prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { plannedStartAt: "desc" },
      select: {
        id: true, name: true, goalType: true, plannedStartAt: true, plannedEndAt: true,
        phases: { orderBy: { phaseIndex: "asc" }, select: { id: true, name: true, phaseType: true, status: true, plannedStartAt: true, plannedEndAt: true } },
      },
    }),
  ]);

  return buildBodyGoalState({ asOf, lookbackDays, entries, profile, activeCycle, roadmap });
}
