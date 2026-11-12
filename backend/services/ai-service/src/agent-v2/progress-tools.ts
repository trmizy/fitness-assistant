/**
 * Gymini V2 (EXPERIMENTAL) — Progress Agent tool contracts + typed progress evidence (M3, READ only).
 *
 * Data inventory (CODE AUDIT 2026-11-13) — thin adapters over EXISTING V1 readers / domain functions:
 *   progress.get_body_measurements   bodyGoalReader.getBodyGoalState → fitness-service GET /stats/body-goal-state
 *       (body-goal-state.service.ts: 0 writes; user = req.user.id; InBody via user-service /internal/inbody/:userId behind
 *       serviceSecretMiddleware with that same id). Observations = InBody scan (EXTRACTED) or manual entry; goal = profile
 *       target weight; onTrack is NOT_EVALUABLE upstream and stays so. VERIFIED READ SOURCE.
 *   progress.get_strength_progression trainingReader.getTrainingAnalytics → GET /stats/training-window, `progression`:
 *       estimated 1RM (e1RM) per exercise from logged sets — DERIVED_ESTIMATE, never a tested max. VERIFIED READ SOURCE.
 *   progress.get_cycle_status        fitnessAgentTools.getActiveCycle + getLatestAssessment (GET, 0 writes in
 *       getActiveCycle/buildRollingSummary/getLatestAssessment). VERIFIED READ SOURCE.
 *   progress.get_roadmap_forecast    fitnessAgentTools.getCurrentRoadmapForecast → GET /fitness-roadmaps/current/forecast
 *       (getCurrentForecast: 0 writes). FORECAST ONLY — a deterministic scenario, never a measurement.
 * Not exposed: muscle mass (upstream muscleMassSemantics = "UNRESOLVED": OCR skeletal muscle vs a generic manual field),
 * raw InBody history (no agent-path reader), forecast calories/macros (nutrition domain), roadmap/goal/user ids.
 * Units: kg, %, weeks, days — passed through unchanged (no unit conversion anywhere in M3).
 * Errors: reader `error` / non-404 domain failure → thrown → registry SYSTEM_ERROR; `absent` / 404 → explicit "not available".
 */
import { z } from "zod";
import { bodyGoalReader, trainingReader } from "../services/enterprise-data";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { createToolRegistry, type ToolRegistryOptions } from "./tool-registry";
import type { AgentToolPolicy, ToolContract } from "./tool-contract";

export interface ProgressToolDeps {
  getBodyGoalState: typeof bodyGoalReader.getBodyGoalState;
  getTrainingAnalytics: typeof trainingReader.getTrainingAnalytics;
  getActiveCycle: typeof fitnessAgentTools.getActiveCycle;
  getLatestAssessment: typeof fitnessAgentTools.getLatestAssessment;
  getCurrentRoadmapForecast: typeof fitnessAgentTools.getCurrentRoadmapForecast;
}
type C<I, R, O> = ToolContract<I, R, O, ProgressToolDeps>;

// ── typed evidence ───────────────────────────────────────────────────────────────────────────────────────────────────
export type ProgressEvidenceKind = "OBSERVED_MEASUREMENT" | "DERIVED_ESTIMATE" | "FORECAST" | "USER_GOAL" | "USER_STATEMENT" | "MISSING" | "ERROR";
export interface ProgressEvidence {
  kind: ProgressEvidenceKind;
  /** What the value is about, e.g. "body.weight", "strength.e1rm", "goal.targetWeight". */
  subject: string;
  /** Tool that produced it (provenance); "user" for USER_STATEMENT. */
  toolId: string;
  /** Date of the underlying data when known (YYYY-MM-DD). */
  asOf: string | null;
}

const QUALITY = z.enum(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);
const date10 = (v: unknown): string | null => { const d = new Date(String(v ?? "")); return v && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : null);

async function unwrapRead<T>(read: Promise<{ status: string; value?: T }>): Promise<T | null> {
  const r = await read;
  if (r.status === "ok") return r.value as T;
  if (r.status === "absent") return null;
  throw Object.assign(new Error("progress data source unavailable"), { status: 503 });
}
/** V1 domain() throws {status}; 404 = "none exists" (no active cycle / roadmap), anything else stays an error. */
async function nullOn404<T>(work: Promise<T>): Promise<T | null> {
  try { return await work; } catch (err: any) { if (Number(err?.status) === 404) return null; throw Object.assign(new Error("progress data source unavailable"), { status: Number(err?.status) >= 400 && Number(err?.status) < 500 ? err.status : 503 }); }
}

const observation = z.object({
  kind: z.literal("OBSERVED_MEASUREMENT"), measuredAt: z.string().nullable(), weightKg: z.number().nullable(), bodyFatPct: z.number().nullable(),
  method: z.enum(["INBODY_SCAN", "MANUAL_ENTRY", "UNKNOWN"]), excludedFromTrend: z.boolean(),
}).strict();
const trend = z.object({ status: z.enum(["AVAILABLE", "INSUFFICIENT_HISTORY"]), direction: z.enum(["UP", "FLAT", "DOWN"]).nullable(), changePerWeek: z.number().nullable(), dataPoints: z.number() }).strict();
const projectObservation = (o: any) => o ? {
  kind: "OBSERVED_MEASUREMENT" as const, measuredAt: date10(o.measuredAt), weightKg: num(o.weightKg), bodyFatPct: num(o.bodyFatPct),
  method: o.source === "EXTRACTED" ? "INBODY_SCAN" as const : o.source === "MANUAL" ? "MANUAL_ENTRY" as const : "UNKNOWN" as const, excludedFromTrend: o.excludedFromTrend === true,
} : null;
const projectTrend = (t: any) => ({ status: t?.status === "AVAILABLE" ? "AVAILABLE" : "INSUFFICIENT_HISTORY", direction: t?.direction ?? null, changePerWeek: num(t?.changePerWeek), dataPoints: typeof t?.dataPoints === "number" ? t.dataPoints : 0 });

// ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const getBodyMeasurements: C<{ lookbackDays?: number }, any, unknown> = {
  id: "progress.get_body_measurements", domain: "progress", kind: "READ", timeoutMs: 20_000,
  title: "Body measurements and weight goal",
  description: "The signed-in user's MEASURED body data (InBody scans or manual entries: weight kg, body fat %), the latest and previous measurement, weight / body-fat trends with their number of data points, the profile target weight (a goal, not a result), the gap to it and the observed weight trajectory. lookbackDays 14–365 (default 90). Muscle mass is not provided.",
  llmExposure: "Dates, kg, %, trend direction/rate/data points, data-quality labels and flags, goal target kg and gap. No ids, muscle mass or raw InBody payload.",
  input: z.object({ lookbackDays: z.number().int().min(14).max(365).optional() }).strict(),
  output: z.discriminatedUnion("available", [
    z.object({ available: z.literal(false) }).strict(),
    z.object({
      available: z.literal(true), asOf: z.string().nullable(), dataQuality: QUALITY,
      observations: z.object({ totalOnRecord: z.number(), inLookback: z.number(), latestAgeDays: z.number().nullable() }).strict(),
      latest: observation.nullable(), previous: observation.nullable(),
      trends: z.object({ weight: trend, bodyFat: trend }).strict(),
      qualityFlags: z.array(z.string().max(60)).max(8),
      goal: z.object({ kind: z.literal("USER_GOAL"), type: z.string().max(40).nullable(), targetWeightKg: z.number().nullable() }).strict(),
      gap: z.union([
        z.object({ state: z.literal("AVAILABLE"), currentKg: z.number(), targetKg: z.number(), differenceKg: z.number(), currentSource: z.enum(["MEASURED_INBODY", "PROFILE_REPORTED"]) }).strict(),
        z.object({ state: z.literal("NOT_AVAILABLE"), reason: z.string().max(40) }).strict(),
      ]),
      observedTrajectory: z.union([
        z.object({ state: z.literal("AVAILABLE"), timeSpanDays: z.number(), observationCount: z.number(), observedChangeKg: z.number(), observedRateKgPerWeek: z.number().nullable(), directionRelativeToGap: z.enum(["TOWARD_TARGET", "AWAY_FROM_TARGET", "FLAT", "NOT_APPLICABLE"]) }).strict(),
        z.object({ state: z.literal("NOT_AVAILABLE"), reasons: z.array(z.string().max(40)).max(6) }).strict(),
      ]),
      onTrack: z.literal("NOT_EVALUABLE"),
    }).strict(),
  ]),
  handler: (ctx, i, deps) => unwrapRead(deps.getBodyGoalState(ctx, { lookbackDays: i.lookbackDays }) as any),
  project: (s: any) => {
    if (!s) return { available: false };
    const gap = s.goal?.gap?.state === "AVAILABLE"
      ? { state: "AVAILABLE", currentKg: num(s.goal.gap.currentKg), targetKg: num(s.goal.gap.targetKg), differenceKg: num(s.goal.gap.differenceKg), currentSource: s.goal.gap.currentSource }
      : { state: "NOT_AVAILABLE", reason: String(s.goal?.gap?.reason ?? "UNKNOWN").slice(0, 40) };
    const obs = s.goal?.trajectory?.observed;
    return {
      available: true, asOf: date10(s.asOf), dataQuality: s.body?.dataQuality,
      observations: { totalOnRecord: s.body?.observations?.totalOnRecord ?? 0, inLookback: s.body?.observations?.inLookback ?? 0, latestAgeDays: num(s.body?.latestAgeDays) },
      latest: projectObservation(s.body?.latest), previous: projectObservation(s.body?.previous),
      trends: { weight: projectTrend(s.body?.trends?.weight), bodyFat: projectTrend(s.body?.trends?.bodyFat) },
      qualityFlags: (Array.isArray(s.body?.quality?.flags) ? s.body.quality.flags : []).slice(0, 8).map((f: unknown) => String(f).slice(0, 60)),
      goal: { kind: "USER_GOAL", type: typeof s.goal?.type === "string" ? s.goal.type.slice(0, 40) : null, targetWeightKg: s.goal?.currentTarget?.state === "AVAILABLE" ? num(s.goal.currentTarget.weightKg) : null },
      gap,
      observedTrajectory: obs?.state === "AVAILABLE"
        ? { state: "AVAILABLE", timeSpanDays: obs.timeSpanDays, observationCount: obs.observationCount, observedChangeKg: num(obs.observedChangeKg), observedRateKgPerWeek: num(obs.observedRateKgPerWeek), directionRelativeToGap: obs.directionRelativeToGap }
        : { state: "NOT_AVAILABLE", reasons: (Array.isArray(obs?.reasons) ? obs.reasons : []).slice(0, 6).map((r: unknown) => String(r).slice(0, 40)) },
      onTrack: "NOT_EVALUABLE",
    };
  },
};

const getStrengthProgression: C<{ days?: number }, any, unknown> = {
  id: "progress.get_strength_progression", domain: "progress", kind: "READ", timeoutMs: 20_000,
  title: "Estimated strength progression",
  description: "ESTIMATED one-rep max (e1RM, computed from logged sets — not a tested max) at the start vs now for the user's logged exercises over 7–28 days (default 28), with weeks observed and data quality per exercise.",
  llmExposure: "Exercise display name, baseline/current e1RM kg, change %, weeks observed, data-quality labels. No ids.",
  input: z.object({ days: z.number().int().min(7).max(28).optional() }).strict(),
  output: z.discriminatedUnion("available", [
    z.object({ available: z.literal(false) }).strict(),
    z.object({
      available: z.literal(true), dataQuality: QUALITY,
      exercises: z.array(z.object({
        exerciseName: z.string().max(60), kind: z.literal("DERIVED_ESTIMATE"), metric: z.literal("ESTIMATED_1RM_KG"),
        baselineE1rmKg: z.number(), currentE1rmKg: z.number(), changePct: z.number().nullable(), weeksObserved: z.number(), dataQuality: QUALITY,
      }).strict()).max(8),
    }).strict(),
  ]),
  handler: (ctx, i, deps) => unwrapRead(deps.getTrainingAnalytics(ctx, { days: i.days ?? 28 }) as any),
  project: (w: any) => w ? {
    available: true, dataQuality: w.progression?.dataQuality ?? w.dataQuality,
    exercises: (Array.isArray(w.progression?.exercises) ? w.progression.exercises : []).slice(0, 8).map((e: any) => ({
      exerciseName: String(e?.exerciseName ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 60), kind: "DERIVED_ESTIMATE", metric: "ESTIMATED_1RM_KG",
      baselineE1rmKg: num(e?.baselineE1rmKg) ?? 0, currentE1rmKg: num(e?.currentE1rmKg) ?? 0, changePct: num(e?.changePct), weeksObserved: e?.weeksObserved ?? 0, dataQuality: e?.dataQuality,
    })),
  } : { available: false },
};

const getCycleStatus: C<{}, any, unknown> = {
  id: "progress.get_cycle_status", domain: "progress", kind: "READ", timeoutMs: 20_000,
  title: "Training cycle and latest assessment",
  description: "The user's active training cycle (week number, dates, status) and the latest cycle assessment decision (KEEP / PROGRESS / ADJUST / DELOAD / REBUILD) with the user's response and its date. null parts mean none exists.",
  llmExposure: "Cycle status, week number, start/end dates; assessment decision, user decision, created date. No ids.",
  input: z.object({}).strict(),
  output: z.object({
    activeCycle: z.object({ status: z.string().max(20).nullable(), weekNumber: z.number().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable() }).strict().nullable(),
    latestAssessment: z.object({ decision: z.string().max(20).nullable(), userDecision: z.string().max(20).nullable(), createdAt: z.string().nullable() }).strict().nullable(),
  }).strict(),
  handler: async (ctx, _i, deps) => {
    const active: any = await nullOn404(deps.getActiveCycle(ctx));
    const cycleId = active?.cycle?.id;
    const assessment = cycleId ? await nullOn404(deps.getLatestAssessment(ctx, cycleId)) : null;
    return { active, assessment };
  },
  project: ({ active, assessment }: any) => ({
    activeCycle: active?.cycle ? { status: active.cycle.status ?? null, weekNumber: num(active.cycle.weekNumber), startDate: date10(active.cycle.startDate), endDate: date10(active.cycle.endDate) } : null,
    latestAssessment: assessment ? { decision: assessment.decision ?? null, userDecision: assessment.userDecision ?? null, createdAt: date10(assessment.createdAt) } : null,
  }),
};

const getRoadmapForecast: C<{}, any, unknown> = {
  id: "progress.get_roadmap_forecast", domain: "progress", kind: "READ", timeoutMs: 20_000,
  title: "Roadmap forecast (scenario, not a measurement)",
  description: "The app's deterministic FORECAST for the user's active roadmap: projected end weight / body fat per phase with a low–high range and a confidence tier. This is a scenario, never a measured result.",
  llmExposure: "Phase type, duration, planned end date, projected end weight and range (kg), projected body fat %, confidence tier, change reason codes. No ids, names, calories or macros.",
  input: z.object({}).strict(),
  output: z.discriminatedUnion("available", [
    z.object({ available: z.literal(false) }).strict(),
    z.object({
      available: z.literal(true), kind: z.literal("FORECAST"), isMeasurement: z.literal(false),
      phases: z.array(z.object({
        phaseType: z.string().max(30), durationWeeks: z.number().nullable(), plannedEndAt: z.string().nullable(),
        projectedEndWeightKg: z.number().nullable(), projectedEndWeightRangeKg: z.object({ low: z.number(), expected: z.number(), high: z.number() }).strict().nullable(),
        projectedEndBodyFatPct: z.number().nullable(), confidenceTier: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable(),
      }).strict()).max(6),
      changeReasonCodes: z.array(z.string().max(40)).max(8),
    }).strict(),
  ]),
  handler: (ctx, _i, deps) => nullOn404(deps.getCurrentRoadmapForecast(ctx)),
  project: (f: any) => {
    const phases = f?.currentForecast?.phaseForecasts;
    if (!f || !Array.isArray(phases)) return { available: false };
    return {
      available: true, kind: "FORECAST", isMeasurement: false,
      phases: phases.slice(0, 6).map((p: any) => {
        const r = p?.projectedEndWeightRangeKg;
        return {
          phaseType: String(p?.phaseType ?? "").slice(0, 30), durationWeeks: num(p?.durationWeeks), plannedEndAt: date10(p?.plannedEndAt),
          projectedEndWeightKg: num(p?.projectedEndWeightKg),
          projectedEndWeightRangeKg: r && [r.low, r.expected, r.high].every((x) => typeof x === "number") ? { low: num(r.low)!, expected: num(r.expected)!, high: num(r.high)! } : null,
          projectedEndBodyFatPct: num(p?.projectedEndBodyFatPct), confidenceTier: ["HIGH", "MEDIUM", "LOW"].includes(p?.confidence?.tier) ? p.confidence.tier : null,
        };
      }),
      changeReasonCodes: (Array.isArray(f.changeReasonCodes) ? f.changeReasonCodes : []).slice(0, 8).map((c: unknown) => String(c).slice(0, 40)),
    };
  },
};

export const PROGRESS_TOOL_CONTRACTS: ReadonlyArray<C<any, any, unknown>> = [getBodyMeasurements, getStrengthProgression, getCycleStatus, getRoadmapForecast];
export const PROGRESS_READ_TOOL_IDS = PROGRESS_TOOL_CONTRACTS.filter((c) => c.kind === "READ").map((c) => c.id);

/** M3 pilot: READ only. No DRAFT/WRITE contract exists for this domain. */
export const PROGRESS_AGENT_PILOT_POLICY: AgentToolPolicy = Object.freeze({
  agentId: "progress-agent-pilot",
  allowedTools: Object.freeze([...PROGRESS_READ_TOOL_IDS]),
  allowDraft: false,
});

export function createProgressToolRegistry(options: Omit<ToolRegistryOptions<ProgressToolDeps>, "deps"> & { deps?: ProgressToolDeps } = {}) {
  const registry = createToolRegistry<ProgressToolDeps>({
    ...options,
    deps: options.deps ?? {
      getBodyGoalState: bodyGoalReader.getBodyGoalState, getTrainingAnalytics: trainingReader.getTrainingAnalytics,
      getActiveCycle: fitnessAgentTools.getActiveCycle, getLatestAssessment: fitnessAgentTools.getLatestAssessment,
      getCurrentRoadmapForecast: fitnessAgentTools.getCurrentRoadmapForecast,
    },
  });
  for (const c of PROGRESS_TOOL_CONTRACTS) registry.register(c);
  return registry;
}

/** Typed evidence for one successful tool projection (provenance = toolId; dates = the data's own dates). */
export function progressEvidenceOf(toolId: string, data: any): ProgressEvidence[] {
  const ev = (kind: ProgressEvidenceKind, subject: string, asOf: string | null = null): ProgressEvidence => ({ kind, subject, toolId, asOf });
  if (toolId === "progress.get_body_measurements") {
    if (!data?.available) return [ev("MISSING", "body")];
    const out: ProgressEvidence[] = [];
    out.push(data.latest?.weightKg != null ? ev("OBSERVED_MEASUREMENT", "body.weight", data.latest.measuredAt) : ev("MISSING", "body.weight"));
    out.push(data.latest?.bodyFatPct != null ? ev("OBSERVED_MEASUREMENT", "body.bodyFat", data.latest.measuredAt) : ev("MISSING", "body.bodyFat"));
    out.push(data.goal?.targetWeightKg != null ? ev("USER_GOAL", "goal.targetWeight") : ev("MISSING", "goal.targetWeight"));
    return out;
  }
  if (toolId === "progress.get_strength_progression") {
    return data?.available && data.exercises?.length ? [ev("DERIVED_ESTIMATE", "strength.e1rm")] : [ev("MISSING", "strength.e1rm")];
  }
  if (toolId === "progress.get_cycle_status") {
    return [data?.latestAssessment ? ev("OBSERVED_MEASUREMENT", "cycle.assessment", data.latestAssessment.createdAt) : ev("MISSING", "cycle.assessment")];
  }
  if (toolId === "progress.get_roadmap_forecast") {
    return [data?.available ? ev("FORECAST", "roadmap.forecast") : ev("MISSING", "roadmap.forecast")];
  }
  return [];
}
