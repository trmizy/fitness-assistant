/**
 * Gymini V2 (EXPERIMENTAL) — Recovery Agent tool contracts (M2, READ only).
 *
 * Data inventory (CODE AUDIT 2026-11-13) — every handler is a thin adapter over an EXISTING typed V1 reader
 * (services/enterprise-data), which returns ok / absent / error and never turns a failure into "no data":
 *   recovery.get_training_load   trainingReader.getTrainingAnalytics → fitness-service GET /stats/training-window
 *                                (training-analytics-window.service.ts: 0 writes; user = req.user.id via authMiddleware).
 *                                Sources written by the real product: WorkoutSchedule status, Workout/WorkoutSet (set RPE,
 *                                RIR, painScore from WorkoutLogPage), CycleSessionFeedback (session RPE, pain from the
 *                                session-feedback form).
 *   recovery.get_recent_sessions workoutReader.getRecentWorkoutHistory → GET /workouts?limit=N (workoutRepository.findMany:
 *                                where userId = req.user.id, read only).
 * Deliberately NOT exposed:
 *   - effort.sessionFeedback.recoveryScore (= mean readinessScore ÷ 10): the client form labels readinessScore
 *     "Chất lượng buổi tập" (session quality), so it is not a recovery/readiness measure; no validated recovery score exists.
 *   - free-text notes / technique notes / pain locations (health-adjacent free text, not needed).
 *   - sleep, HRV, resting heart rate: NOT IMPLEMENTED for normal users (only PersonalizedServiceCheckIn.sleepQuality for
 *     marketplace PT orders, ai-service DB, no V1 reader) — never inferred.
 * Error mapping: reader `error` → thrown (status 503) → registry SYSTEM_ERROR; `absent` → an explicit "no data" projection.
 */
import { z } from "zod";
import { trainingReader, workoutReader } from "../services/enterprise-data";
import { createToolRegistry, type ToolRegistryOptions } from "./tool-registry";
import { calendarDateIn } from "./user-calendar";
import type { AgentToolPolicy, ToolContract } from "./tool-contract";
import { readErrorStatus } from "./tool-contract";

export interface RecoveryToolDeps {
  getTrainingAnalytics: typeof trainingReader.getTrainingAnalytics;
  getRecentWorkoutHistory: typeof workoutReader.getRecentWorkoutHistory;
}
type C<I, R, O> = ToolContract<I, R, O, RecoveryToolDeps>;

const QUALITY = z.enum(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);
const TREND = z.enum(["stable", "increasing", "decreasing"]).nullable();
const BODY_PARTS = ["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"] as const;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : null);

/** The V1 readers' AuthoritativeRead → value, null (absent) or a thrown upstream error (never "no data"). */
async function unwrap<T>(read: Promise<{ status: string; value?: T }>): Promise<T | null> {
  const r = await read;
  if (r.status === "ok") return r.value as T;
  if (r.status === "absent") return null;
  throw Object.assign(new Error("recovery data source unavailable"), { status: readErrorStatus(r) });
}

// ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const getTrainingLoad: C<{ days?: number }, any, unknown> = {
  id: "recovery.get_training_load", domain: "recovery", kind: "READ", timeoutMs: 20_000,
  title: "Recent training load",
  description: "The signed-in user's logged training over the last N days (7 to 28; default 28): scheduled vs completed sessions, sessions per week, volume by muscle group and week, logged effort (RPE/RIR) trend, average session RPE and pain from session feedback, and how complete the data is.",
  llmExposure: "Counts, rates, kg volumes, RPE/RIR weekly averages and trends, average logged pain (0-10), data-quality labels. No ids, names, notes or derived recovery score.",
  // (a plain bounded integer: V2's zodToJsonSchema does not support unions; fitness-service also bounds days to 7..90)
  input: z.object({ days: z.number().int().min(7).max(28).optional() }).strict(),
  output: z.discriminatedUnion("available", [
    z.object({ available: z.literal(false) }).strict(),
    z.object({
      available: z.literal(true),
      periodDays: z.number(),
      dataQuality: QUALITY,
      adherence: z.object({ state: z.enum(["NO_SCHEDULE", "MEASURED"]), scheduled: z.number(), completed: z.number(), missed: z.number().nullable(), completionRate: z.number().nullable() }).strict(),
      frequency: z.object({ completedPerWeek: z.number().nullable(), trainingDaysLogged: z.number() }).strict(),
      volume: z.object({
        trendPercent: z.number().nullable(), completedSetCount: z.number(),
        byMuscleGroupKg: z.array(z.object({ muscleGroup: z.string().max(40), kg: z.number() }).strict()).max(8),
        weeklyTotalKg: z.array(z.number()).max(13), dataQuality: QUALITY,
      }).strict(),
      effort: z.object({
        rpeWeeklyAvg: z.array(z.number().nullable()).max(13), rpeTrend: TREND, rirTrend: TREND, rpeDataQuality: QUALITY,
        sessionFeedbackCount: z.number(), averageSessionRpe: z.number().nullable(), sessionRpeSource: z.enum(["session_feedback", "set_rpe_fallback", "none"]),
        averagePainScore: z.number().nullable(), feedbackDataQuality: QUALITY,
      }).strict(),
    }).strict(),
  ]),
  handler: async (ctx, i, deps) => unwrap(deps.getTrainingAnalytics(ctx, { days: i.days ?? 28 }) as any),
  project: (w: any) => {
    if (!w) return { available: false };
    const byMuscle = Object.entries((w.volume?.byMuscleGroupKg ?? {}) as Record<string, unknown>)
      .map(([muscleGroup, kg]) => ({ muscleGroup: muscleGroup.slice(0, 40), kg: num(kg) ?? 0 })).sort((a, b) => b.kg - a.kg).slice(0, 8);
    const sf = w.effort?.sessionFeedback ?? {};
    return {
      available: true,
      periodDays: w.period?.days,
      dataQuality: w.dataQuality,
      adherence: { state: w.adherence?.state, scheduled: w.adherence?.scheduledSessions ?? 0, completed: w.adherence?.completedSessions ?? 0, missed: w.adherence?.missedSessions ?? null, completionRate: num(w.adherence?.completionRate) },
      frequency: { completedPerWeek: num(w.frequency?.completedPerWeek), trainingDaysLogged: w.frequency?.trainingDaysLogged ?? 0 },
      volume: {
        trendPercent: num(w.volume?.volumeTrendPercent), completedSetCount: w.volume?.completedSetCount ?? 0, byMuscleGroupKg: byMuscle,
        weeklyTotalKg: (Array.isArray(w.volume?.byWeek) ? w.volume.byWeek : []).slice(-13).map((x: any) => num(x?.totalVolumeKg) ?? 0),
        dataQuality: w.volume?.dataQuality,
      },
      effort: {
        rpeWeeklyAvg: (Array.isArray(w.effort?.rpe?.weeklyAvg) ? w.effort.rpe.weeklyAvg : []).slice(-13).map((x: unknown) => num(x)),
        rpeTrend: w.effort?.rpe?.trend ?? null, rirTrend: w.effort?.rir?.trend ?? null, rpeDataQuality: w.effort?.rpe?.dataQuality,
        sessionFeedbackCount: sf.feedbackCount ?? 0, averageSessionRpe: num(sf.averageSessionRpe), sessionRpeSource: sf.sessionRpeSource ?? "none",
        averagePainScore: num(sf.averagePainScore), feedbackDataQuality: sf.dataQuality,
        // recoveryScore intentionally dropped — see header
      },
    };
  },
};

const getRecentSessions: C<{ limit?: number }, any, unknown> = {
  id: "recovery.get_recent_sessions", domain: "recovery", kind: "READ", timeoutMs: 20_000,
  title: "Recently logged workouts",
  description: "The signed-in user's most recently LOGGED workouts (newest first, up to 10): date, duration, which body parts were trained, completed sets, average logged set RPE and the highest pain score logged on a set (0-10). Only what was logged — an unlogged session does not appear.",
  llmExposure: "Calendar date, duration, exercise count, body-part enums, completed set count, average set RPE, max logged pain score. No ids, names, notes or technique/pain free text.",
  input: z.object({ limit: z.number().int().min(1).max(10).optional() }).strict(),
  output: z.object({
    sessions: z.array(z.object({
      date: z.string().max(10), durationMin: z.number().nullable(), exerciseCount: z.number(),
      bodyParts: z.array(z.enum(BODY_PARTS)).max(4), completedSets: z.number(), avgSetRpe: z.number().nullable(), maxPainScore: z.number().nullable(),
    }).strict()).max(10),
  }).strict(),
  handler: async (ctx, i, deps) => unwrap(deps.getRecentWorkoutHistory(ctx, i.limit ?? 7) as any),
  project: (rows: any) => ({
    sessions: (Array.isArray(rows) ? rows : []).slice(0, 10).map((w: any) => {
      const exercises = Array.isArray(w?.exercises) ? w.exercises : [];
      const sets = exercises.flatMap((e: any) => (Array.isArray(e?.workoutSets) ? e.workoutSets : []));
      const rpes = sets.map((s: any) => s?.rpe).filter((v: unknown): v is number => typeof v === "number" && Number.isFinite(v));
      const pains = sets.map((s: any) => s?.painScore).filter((v: unknown): v is number => typeof v === "number" && Number.isFinite(v));
      const parts = [...new Set(exercises.map((e: any) => e?.exercise?.bodyPart).filter((b: unknown) => (BODY_PARTS as readonly unknown[]).includes(b)))] as string[];
      return {
        // the user's calendar day (Asia/Ho_Chi_Minh), the same day boundary as Training's "today" schedule
        date: calendarDateIn(w?.date) ?? "unknown",
        durationMin: typeof w?.duration === "number" ? w.duration : null,
        exerciseCount: exercises.length,
        bodyParts: parts,
        completedSets: sets.filter((s: any) => s?.completed === true).length,
        avgSetRpe: rpes.length ? Number((rpes.reduce((a: number, b: number) => a + b, 0) / rpes.length).toFixed(1)) : null,
        maxPainScore: pains.length ? Math.max(...pains) : null,
      };
    }),
  }),
};

export const RECOVERY_TOOL_CONTRACTS: ReadonlyArray<C<any, any, unknown>> = [getTrainingLoad, getRecentSessions];
export const RECOVERY_READ_TOOL_IDS = RECOVERY_TOOL_CONTRACTS.filter((c) => c.kind === "READ").map((c) => c.id);

/** M2 pilot: READ only. No DRAFT/WRITE contract exists for this domain. */
export const RECOVERY_AGENT_PILOT_POLICY: AgentToolPolicy = Object.freeze({
  agentId: "recovery-agent-pilot",
  allowedTools: Object.freeze([...RECOVERY_READ_TOOL_IDS]),
  allowDraft: false,
});

export function createRecoveryToolRegistry(options: Omit<ToolRegistryOptions<RecoveryToolDeps>, "deps"> & { deps?: RecoveryToolDeps } = {}) {
  const registry = createToolRegistry<RecoveryToolDeps>({
    ...options,
    deps: options.deps ?? { getTrainingAnalytics: trainingReader.getTrainingAnalytics, getRecentWorkoutHistory: workoutReader.getRecentWorkoutHistory },
  });
  for (const c of RECOVERY_TOOL_CONTRACTS) registry.register(c);
  return registry;
}
