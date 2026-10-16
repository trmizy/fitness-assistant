/**
 * Phase 4.1/4.3 — CoachStateV0 (training + nutrition slices).
 * docs/ai-product/phase4-1-training-coach-state.md, phase4-3-nutrition-coach-state.md
 *
 * A typed, deterministic projection of authoritative reads:
 *   goal.type  ← user-service profile goal (profileReader.getCurrentFitnessGoal)
 *   training   ← fitness-service rolling-window analytics (trainingReader)
 *   nutrition  ← fitness-service normalized target-vs-actual window (nutritionAnalyticsReader)
 *   body/goal  ← fitness-service observed body state + goal gap/trajectory (bodyGoalReader)
 *
 * Slices are demand-driven: a caller asks for the ones it needs; the others
 * are never fetched. This module performs NO calculations: every value,
 * quality state and signal is passed through from fitness-service. 0 LLM calls.
 */
import { logger } from "@gym-coach/shared";
import type { AgentIdentity } from "../fitness-agent-tools";
import { assembleContext, type AssembledContext, type ContextNeed } from "../context-assembler";
import {
  ok,
  errorRead,
  type AuthoritativeRead,
  type BodyGoalStateWindow,
  type NutritionAnalyticsWindow,
  type TrainingAnalyticsWindow,
  type TrainingDataQuality,
} from "../enterprise-data/types";

export type { TrainingDataQuality };

export interface CoachStateV0 {
  asOf: string;
  /**
   * `type` comes from the authoritative profile (or from the body/goal read when that slice is requested).
   * The remaining members exist only when the goal-state slice was requested and read ok; they are typed
   * facts only (no judgement): current target, starting state, descriptive gap, observed trajectory, roadmap.
   */
  goal?: {
    type?: string;
    currentTarget?: BodyGoalStateWindow["goal"]["currentTarget"];
    startingState?: BodyGoalStateWindow["goal"]["startingState"];
    profileStartingWeightKg?: number | null;
    gap?: BodyGoalStateWindow["goal"]["gap"];
    trajectory?: BodyGoalStateWindow["goal"]["trajectory"];
    roadmap?: BodyGoalStateWindow["goal"]["roadmap"];
    dataQuality?: BodyGoalStateWindow["goal"]["dataQuality"];
  };
  /** Present only when the body slice was requested (and read ok). Summary + derived trend, never a raw series. */
  body?: BodyGoalStateWindow["body"] & { lookbackDays: number };
  /** Present only when the training slice was requested (and read ok). */
  training?: {
    period: TrainingAnalyticsWindow["period"];
    adherence: TrainingAnalyticsWindow["adherence"];
    frequency: TrainingAnalyticsWindow["frequency"];
    volume: TrainingAnalyticsWindow["volume"];
    progression: TrainingAnalyticsWindow["progression"];
    plateau: TrainingAnalyticsWindow["plateau"];
    effort: TrainingAnalyticsWindow["effort"];
    signals: TrainingAnalyticsWindow["signals"];
    dataQuality: TrainingDataQuality;
  };
  /**
   * Present only when the nutrition slice was requested (and read ok). TARGET (`activeTarget`) and
   * ACTUAL (`actual`) are separate members; `actual` is the window summary, not per-day raw history.
   * Descriptive only — no prescriptive signals.
   */
  nutrition?: {
    period: NutritionAnalyticsWindow["period"];
    activeTarget: NutritionAnalyticsWindow["activeTarget"];
    targetChangedInWindow: boolean;
    actual: NutritionAnalyticsWindow["actual"]["summary"];
    adherence: NutritionAnalyticsWindow["adherence"];
    dataQuality: NutritionAnalyticsWindow["dataQuality"];
  };
}

/** A CoachStateV0 known to carry the training slice (what the Phase 4.2 answer path needs). */
export type TrainingCoachState = CoachStateV0 & { training: NonNullable<CoachStateV0["training"]> };
export const hasTraining = (s: CoachStateV0): s is TrainingCoachState => s.training != null;

export interface CoachStateSlices {
  /** default true (Phase 4.1 behaviour) */
  includeTraining?: boolean;
  /** default false */
  includeNutrition?: boolean;
  /** default false: observed body state (latest measurement, trend, quality, weight provenance) */
  includeBody?: boolean;
  /** default false: goal target/gap/starting state/observed trajectory/roadmap (same single upstream read as includeBody) */
  includeGoalState?: boolean;
  /** default true; false skips the profile (goal) read */
  includeGoal?: boolean;
}

/**
 * Pure mapping of the REQUESTED slices. A requested slice that failed upstream makes the whole read an
 * `error` (never an empty slice); a requested slice that was never fetched is an error too. A goal read
 * that failed/absent only omits `goal`.
 */
export function buildCoachStateV0(
  assembled: Pick<AssembledContext, "trainingAnalytics" | "nutritionAnalytics" | "bodyGoalState" | "fitnessGoal">,
  now: Date = new Date(),
  slices: CoachStateSlices = {},
): AuthoritativeRead<CoachStateV0> {
  const wantTraining = slices.includeTraining !== false;
  const wantNutrition = slices.includeNutrition === true;
  const reads: Array<[string, AuthoritativeRead<unknown> | undefined]> = [];
  if (wantTraining) reads.push(["training", assembled.trainingAnalytics]);
  if (wantNutrition) reads.push(["nutrition", assembled.nutritionAnalytics]);
  const wantBody = slices.includeBody === true;
  const wantGoalState = slices.includeGoalState === true;
  if (wantBody || wantGoalState) reads.push(["body/goal", assembled.bodyGoalState]);
  if (reads.length === 0) return errorRead("FITNESS_SERVICE", "no coach-state slice requested");

  for (const [name, r] of reads) if (!r) return errorRead("FITNESS_SERVICE", `${name} analytics were not requested`);
  for (const [, r] of reads) if (r!.status === "error") return errorRead(r!.source, (r as { message: string }).message, r!.fetchedAt);
  for (const [, r] of reads) if (r!.status === "absent") return { status: "absent", source: r!.source, fetchedAt: r!.fetchedAt };

  const goal: NonNullable<CoachStateV0["goal"]> | undefined =
    assembled.fitnessGoal?.status === "ok" ? { type: String(assembled.fitnessGoal.value) } : undefined;
  const state: CoachStateV0 = { asOf: now.toISOString(), ...(goal ? { goal } : {}) };

  if (wantTraining && assembled.trainingAnalytics?.status === "ok") {
    const w = assembled.trainingAnalytics.value;
    state.training = {
      period: w.period, adherence: w.adherence, frequency: w.frequency, volume: w.volume, progression: w.progression,
      plateau: w.plateau, effort: w.effort, signals: w.signals, dataQuality: w.dataQuality,
    };
  }
  if (wantNutrition && assembled.nutritionAnalytics?.status === "ok") {
    const n = assembled.nutritionAnalytics.value;
    state.nutrition = {
      period: n.period, activeTarget: n.activeTarget, targetChangedInWindow: n.targetChangedInWindow,
      actual: n.actual.summary, adherence: n.adherence, dataQuality: n.dataQuality,
    };
  }
  if ((wantBody || wantGoalState) && assembled.bodyGoalState?.status === "ok") {
    const b = assembled.bodyGoalState.value;
    if (wantBody) state.body = { ...b.body, lookbackDays: b.lookbackDays };
    if (wantGoalState) {
      state.goal = {
        ...(state.goal ?? {}),
        ...(b.goal.type ? { type: b.goal.type } : {}),
        currentTarget: b.goal.currentTarget,
        startingState: b.goal.startingState,
        profileStartingWeightKg: b.goal.profileStartingWeightKg,
        gap: b.goal.gap,
        trajectory: b.goal.trajectory,
        roadmap: b.goal.roadmap,
        dataQuality: b.goal.dataQuality,
      };
    }
  }
  const first = reads[0][1]!;
  return ok(state, first.source, first.fetchedAt);
}

export interface CoachStateSliceReads {
  training?: AuthoritativeRead<CoachStateV0>;
  nutrition?: AuthoritativeRead<CoachStateV0>;
  bodyGoal?: AuthoritativeRead<CoachStateV0>;
}

/**
 * Phase 4.5 — PER-SLICE reads for a composed review. Unlike getCoachStateV0 (where a failed requested slice fails the
 * whole read — kept as is), each requested slice keeps its own ok / absent / error here so a review can still answer
 * from the slices that succeeded and say truthfully which one could not be read. Only requested slices are fetched.
 * 0 LLM calls.
 */
export async function readCoachStateSlices(
  identity: AgentIdentity,
  opts: { includeTraining?: boolean; includeNutrition?: boolean; includeBodyGoal?: boolean; days?: number; bodyLookbackDays?: number; now?: Date } = {},
): Promise<CoachStateSliceReads> {
  const needs: ContextNeed[] = [];
  if (opts.includeTraining) needs.push("TRAINING_COACH_STATE");
  if (opts.includeNutrition) needs.push("NUTRITION_COACH_STATE");
  if (opts.includeBodyGoal) needs.push("BODY_GOAL_COACH_STATE");
  if (needs.length === 0) return {};
  const assembled = await assembleContext(identity, needs, { trainingWindowDays: opts.days, nutritionWindowDays: opts.days, bodyLookbackDays: opts.bodyLookbackDays });
  const out: CoachStateSliceReads = {};
  if (opts.includeTraining) out.training = buildCoachStateV0(assembled, opts.now, { includeTraining: true, includeGoal: false });
  if (opts.includeNutrition) out.nutrition = buildCoachStateV0(assembled, opts.now, { includeTraining: false, includeNutrition: true, includeGoal: false });
  if (opts.includeBodyGoal) out.bodyGoal = buildCoachStateV0(assembled, opts.now, { includeTraining: false, includeBody: true, includeGoalState: true, includeGoal: false });
  return out;
}

/** Demand-driven read: requests ONLY the needs of the requested slices. 0 LLM calls. */
export async function getCoachStateV0(
  identity: AgentIdentity,
  opts: CoachStateSlices & { days?: number; now?: Date; /** body-trend lookback, 14-365 (default 90 server-side) */ bodyLookbackDays?: number } = {},
): Promise<AuthoritativeRead<CoachStateV0>> {
  const started = Date.now();
  const needs: ContextNeed[] = [];
  if (opts.includeTraining !== false) needs.push("TRAINING_COACH_STATE");
  if (opts.includeNutrition === true) needs.push("NUTRITION_COACH_STATE");
  const wantBodyGoal = opts.includeBody === true || opts.includeGoalState === true;
  if (wantBodyGoal) needs.push("BODY_GOAL_COACH_STATE");
  // when the goal-state slice is requested, goal.type comes from the same authoritative read: no extra profile fetch
  if (opts.includeGoal !== false && opts.includeGoalState !== true) needs.push("FITNESS_GOAL");
  const assembled = await assembleContext(identity, needs, { trainingWindowDays: opts.days, nutritionWindowDays: opts.days, bodyLookbackDays: opts.bodyLookbackDays });
  const result = buildCoachStateV0(assembled, opts.now, opts);

  // Privacy: counts/quality/latency only — no userId, loads, RPE, intake values or food names.
  const training = result.status === "ok" ? result.value.training : undefined;
  const nutrition = result.status === "ok" ? result.value.nutrition : undefined;
  logger.info(
    {
      event: "coach_training_state_read",
      outcome: result.status,
      windowDays: training?.period.days ?? nutrition?.period.days ?? opts.days ?? null,
      dataQuality: training?.dataQuality ?? null,
      scheduledCount: training?.adherence.scheduledSessions ?? null,
      completedCount: training?.adherence.completedSessions ?? null,
      progressionExerciseCount: training?.progression.exercises.length ?? null,
      ...(result.status === "ok" && result.value.body ? { bodyDataQuality: result.value.body.dataQuality, bodyObservationCount: result.value.body.observations.totalOnRecord } : {}),
      ...(nutrition ? { nutritionDataQuality: nutrition.dataQuality, nutritionLoggedDays: nutrition.actual.loggedDays, nutritionAdherenceState: nutrition.adherence.state } : {}),
      latencyMs: Date.now() - started,
    },
    "coach_training_state_read",
  );
  return result;
}
