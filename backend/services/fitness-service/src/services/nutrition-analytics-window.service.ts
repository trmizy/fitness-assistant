/**
 * Phase 4.3 — normalized TARGET vs ACTUAL nutrition over a rolling window
 * (docs/ai-product/phase4-3-nutrition-coach-state.md).
 *
 * Descriptive only: no good/bad labels, no prescriptive signals, no LLM.
 *
 * ACTUAL intake is built from the two real sources with ONE precedence rule
 * that deliberately mirrors the product's own "consumed" rule in
 * nutrition.service.ts#getDailyTask (so the coach and the dashboard cannot
 * disagree), except for one intentional difference: a planned-but-unconfirmed
 * meal is NEVER actual intake here (the dashboard shows it provisionally).
 *
 *   per (UTC day, mealType key):
 *     completion SKIPPED                 → explicit 0 (logs of that type ignored — product rule)
 *     completion COMPLETED | PARTIAL     → completion.consumed* snapshot
 *                                          + NutritionLog rows created AFTER the snapshot's updatedAt
 *                                          (earlier logs are already inside a percent-mode snapshot)
 *     completion PENDING / none          → NutritionLog rows only (plan items are not intake)
 *
 * Macros are never invented: a log with null protein/carbs/fats, or a
 * completion whose macros are all 0 while calories > 0 (what
 * upsertMealCompletion writes when the user entered calories only), is
 * treated as "macro not provided".
 */
import { prisma } from "../repositories/prisma";
import { cycleThresholds } from "../config/cycle-thresholds.config";

export type NutritionDataQuality =
  | "SUFFICIENT"
  | "PARTIAL"
  | "INSUFFICIENT_HISTORY"
  | "NO_DATA"
  | "STALE";

export const NUTRITION_WINDOW_DEFAULT_DAYS = 28;
export const NUTRITION_WINDOW_MIN_DAYS = 7;
export const NUTRITION_WINDOW_MAX_DAYS = 90;

export type Coverage = "COMPLETE" | "PARTIAL" | "NONE";
type Dim = "calories" | "protein" | "carbs" | "fat";
const DIMS: Dim[] = ["calories", "protein", "carbs", "fat"];

export interface NutritionActualDay {
  /** UTC calendar day, YYYY-MM-DD */
  date: string;
  state: "LOGGED" | "NO_DATA";
  /** COMPLETE: every planned meal of that plan day has a completion or a log;
   * PARTIAL: some planned meals have none; COVERAGE_UNKNOWN: diary-only day (no plan day to compare against);
   * NO_DATA: nothing recorded. */
  completeness: "COMPLETE" | "PARTIAL" | "COVERAGE_UNKNOWN" | "NO_DATA";
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** per-dimension: were ALL contributing records carrying this value? (a PARTIAL sum is a lower bound) */
  coverage: Record<Dim, Coverage>;
  sources: { mealCompletions: number; nutritionLogs: number; skippedMeals: number };
  /** true when a SKIPPED completion made this day's contribution an explicit zero for at least one meal */
  hasExplicitSkip: boolean;
}

export interface DimensionAdherence {
  comparedDays: number;
  averageTarget: number;
  averageActual: number;
  /** actual − target (signed; negative = under target) */
  averageDelta: number;
  averageAbsoluteDelta: number;
}

export interface NutritionAnalyticsWindow {
  period: { from: string; to: string; days: number };
  activeTarget:
    | { state: "NO_ACTIVE_TARGET" }
    | { state: "ACTIVE_TARGET"; goalId: string; caloriesKcal: number; proteinG: number; carbsG: number; fatG: number; validFrom: string; triggeredBy: string | null };
  /** more than one NutritionGoal version applied to days inside the window */
  targetChangedInWindow: boolean;
  actual: {
    days: NutritionActualDay[];
    summary: {
      daysInWindow: number;
      loggedDays: number;
      /** averages over days whose coverage for that dimension is COMPLETE only */
      calories: { averageKcal: number | null; daysUsed: number };
      protein: { averageG: number | null; daysUsed: number; partialDays: number };
      carbs: { averageG: number | null; daysUsed: number; partialDays: number };
      fat: { averageG: number | null; daysUsed: number; partialDays: number };
    };
  };
  adherence: {
    state: "MEASURED" | "NOT_AVAILABLE_NO_TARGET" | "NOT_AVAILABLE_NO_ACTUAL";
    calories: DimensionAdherence | null;
    protein: DimensionAdherence | null;
    carbs: DimensionAdherence | null;
    fat: DimensionAdherence | null;
  };
  dataQuality: NutritionDataQuality;
}

// ── window ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function normalizeNutritionWindowDays(days: number | undefined): number {
  if (days == null) return NUTRITION_WINDOW_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < NUTRITION_WINDOW_MIN_DAYS || days > NUTRITION_WINDOW_MAX_DAYS) {
    throw new RangeError(`days must be an integer between ${NUTRITION_WINDOW_MIN_DAYS} and ${NUTRITION_WINDOW_MAX_DAYS}`);
  }
  return days;
}

/** Same convention as the training window: `days` UTC calendar days ending on asOf's UTC day (00:00Z start, inclusive),
 * `to` = the asOf instant (future-dated rows excluded). No user timezone. */
export function resolveNutritionWindow(asOf: Date, days: number): { from: Date; to: Date } {
  return { from: new Date(startOfUtcDay(asOf).getTime() - (days - 1) * DAY_MS), to: asOf };
}

// ── pure assembly ─────────────────────────────────────────────────────────

export interface CompletionInput {
  logDate: Date;
  status: string;
  consumedCalories: number | null;
  consumedProtein: number | null;
  consumedCarbs: number | null;
  consumedFat: number | null;
  updatedAt: Date;
  mealId: string;
  /** plan meal type, e.g. BREAKFAST */
  mealType: string;
  /** every meal of the same plan day (id + type) — to judge how much of the day is covered */
  dayMeals: Array<{ id: string; mealType: string }>;
}
export interface LogInput {
  id: string;
  date: Date;
  mealType: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  createdAt: Date;
}
export interface GoalInput {
  id: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  status: string;
  validFrom: Date;
  supersededAt: Date | null;
  triggeredBy: string | null;
}

const PLAN_TO_LOG: Record<string, string> = { BREAKFAST: "breakfast", LUNCH: "lunch", DINNER: "dinner", SNACK: "snack" };
const mealKey = (t: string) => PLAN_TO_LOG[String(t || "").toUpperCase()] ?? String(t || "").toLowerCase();
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Rec { cal: number | null; p: number | null; c: number | null; f: number | null }

function completionRec(c: CompletionInput): Rec {
  const cal = c.consumedCalories;
  const p = c.consumedProtein, cb = c.consumedCarbs, f = c.consumedFat;
  // upsertMealCompletion writes 0 for macros the user did not enter; calories>0 with all three 0 is "not provided".
  const macrosNotProvided = (cal ?? 0) > 0 && (p ?? 0) === 0 && (cb ?? 0) === 0 && (f ?? 0) === 0;
  return { cal, p: macrosNotProvided ? null : p, c: macrosNotProvided ? null : cb, f: macrosNotProvided ? null : f };
}
const logRec = (l: LogInput): Rec => ({ cal: l.calories, p: l.protein, c: l.carbs, f: l.fats });

export function pickApplicableGoal(goals: GoalInput[], day: Date): GoalInput | null {
  const dayStart = startOfUtcDay(day).getTime();
  const dayEnd = dayStart + DAY_MS - 1;
  const cands = goals.filter(
    (g) => g.validFrom.getTime() <= dayEnd && (g.supersededAt == null || g.supersededAt.getTime() > dayStart),
  );
  if (cands.length === 0) return null;
  return cands.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
}

export function buildNutritionAnalyticsWindow(input: {
  from: Date;
  to: Date;
  days: number;
  completions: CompletionInput[];
  logs: LogInput[];
  goals: GoalInput[];
  hasActivityBeforeWindow: boolean;
}): NutritionAnalyticsWindow {
  const { from, to, days } = input;
  const completionsByDay = new Map<string, CompletionInput[]>();
  for (const c of input.completions) {
    if (c.logDate.getTime() > to.getTime() || c.logDate.getTime() < startOfUtcDay(from).getTime()) continue;
    const k = dayKey(c.logDate);
    (completionsByDay.get(k) ?? completionsByDay.set(k, []).get(k)!).push(c);
  }
  const logsByDay = new Map<string, LogInput[]>();
  for (const l of input.logs) {
    if (l.date.getTime() > to.getTime() || l.date.getTime() < from.getTime()) continue;
    const k = dayKey(l.date);
    (logsByDay.get(k) ?? logsByDay.set(k, []).get(k)!).push(l);
  }

  const outDays: NutritionActualDay[] = [];
  const startMs = startOfUtcDay(from).getTime();
  const nDays = Math.floor((startOfUtcDay(to).getTime() - startMs) / DAY_MS) + 1;
  for (let i = 0; i < nDays; i++) {
    const dayDate = new Date(startMs + i * DAY_MS);
    const key = dayKey(dayDate);
    const comps = completionsByDay.get(key) ?? [];
    const logs = logsByDay.get(key) ?? [];
    const recs: Rec[] = [];
    let mealCompletions = 0, nutritionLogs = 0, skipped = 0;
    const keysSkipped = new Set<string>();

    // group completions per mealType key
    const byKey = new Map<string, CompletionInput[]>();
    for (const c of comps) (byKey.get(mealKey(c.mealType)) ?? byKey.set(mealKey(c.mealType), []).get(mealKey(c.mealType))!).push(c);

    const keysWithCompletedLike = new Set<string>();
    for (const [k, group] of byKey) {
      const confirmed = group.filter((c) => c.status === "COMPLETED" || c.status === "PARTIAL");
      const skippedRows = group.filter((c) => c.status === "SKIPPED");
      if (confirmed.length > 0) {
        keysWithCompletedLike.add(k);
        for (const c of confirmed) { recs.push(completionRec(c)); mealCompletions++; }
        const latest = Math.max(...confirmed.map((c) => c.updatedAt.getTime()));
        for (const l of logs.filter((x) => mealKey(x.mealType) === k && x.createdAt.getTime() > latest)) { recs.push(logRec(l)); nutritionLogs++; }
      } else if (skippedRows.length > 0) {
        keysSkipped.add(k);
        keysWithCompletedLike.add(k);
        for (const _ of skippedRows) { recs.push({ cal: 0, p: 0, c: 0, f: 0 }); skipped++; mealCompletions++; }
      }
    }
    for (const l of logs) {
      if (keysWithCompletedLike.has(mealKey(l.mealType))) continue; // handled above (snapshot / explicit skip)
      recs.push(logRec(l)); nutritionLogs++;
    }

    if (recs.length === 0) {
      outDays.push({
        date: key, state: "NO_DATA", completeness: "NO_DATA", caloriesKcal: null, proteinG: null, carbsG: null, fatG: null,
        coverage: { calories: "NONE", protein: "NONE", carbs: "NONE", fat: "NONE" },
        sources: { mealCompletions: 0, nutritionLogs: 0, skippedMeals: 0 }, hasExplicitSkip: false,
      });
      continue;
    }

    const sum = (get: (r: Rec) => number | null): { total: number | null; coverage: Coverage } => {
      const known = recs.map(get).filter((v): v is number => v != null);
      if (known.length === 0) return { total: null, coverage: "NONE" };
      return { total: known.reduce((s, v) => s + v, 0), coverage: known.length === recs.length ? "COMPLETE" : "PARTIAL" };
    };
    const cal = sum((r) => r.cal), p = sum((r) => r.p), c = sum((r) => r.c), f = sum((r) => r.f);

    // completeness vs the plan day, only when a completion row tells us which plan day it is
    let completeness: NutritionActualDay["completeness"] = "COVERAGE_UNKNOWN";
    if (comps.length > 0) {
      const dayMeals = comps[0].dayMeals;
      if (dayMeals.length > 0) {
        const recordedKeys = new Set<string>([...byKey.entries()].filter(([, g]) => g.some((x) => x.status !== "PENDING")).map(([k]) => k));
        for (const l of logs) recordedKeys.add(mealKey(l.mealType));
        completeness = dayMeals.every((m) => recordedKeys.has(mealKey(m.mealType))) ? "COMPLETE" : "PARTIAL";
      }
    }

    outDays.push({
      date: key, state: "LOGGED", completeness,
      caloriesKcal: cal.total == null ? null : Math.round(cal.total),
      proteinG: p.total == null ? null : r1(p.total), carbsG: c.total == null ? null : r1(c.total), fatG: f.total == null ? null : r1(f.total),
      coverage: { calories: cal.coverage, protein: p.coverage, carbs: c.coverage, fat: f.coverage },
      sources: { mealCompletions, nutritionLogs, skippedMeals: skipped },
      hasExplicitSkip: skipped > 0,
    });
  }

  // ── summary: averages only over days whose coverage for that dimension is COMPLETE
  const avg = (get: (d: NutritionActualDay) => number | null, dim: Dim) => {
    const used = outDays.filter((d) => d.coverage[dim] === "COMPLETE" && get(d) != null);
    const partial = outDays.filter((d) => d.coverage[dim] === "PARTIAL").length;
    return { used, partial, average: used.length ? used.reduce((s, d) => s + (get(d) as number), 0) / used.length : null };
  };
  const aCal = avg((d) => d.caloriesKcal, "calories");
  const aP = avg((d) => d.proteinG, "protein");
  const aC = avg((d) => d.carbsG, "carbs");
  const aF = avg((d) => d.fatG, "fat");
  const loggedDays = outDays.filter((d) => d.state === "LOGGED").length;

  // ── target
  const active = input.goals
    .filter((g) => g.status === "ACTIVE" && g.supersededAt == null)
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
  const activeTarget: NutritionAnalyticsWindow["activeTarget"] = active
    ? { state: "ACTIVE_TARGET", goalId: active.id, caloriesKcal: active.calories, proteinG: active.protein, carbsG: active.carbs, fatG: active.fat, validFrom: active.validFrom.toISOString(), triggeredBy: active.triggeredBy }
    : { state: "NO_ACTIVE_TARGET" };

  // ── adherence: per-day applicable target version × days with COMPLETE coverage of that dimension
  const appliedGoalIds = new Set<string>();
  const cmp: Record<Dim, Array<{ t: number; a: number }>> = { calories: [], protein: [], carbs: [], fat: [] };
  for (const d of outDays) {
    const g = pickApplicableGoal(input.goals, new Date(`${d.date}T00:00:00.000Z`));
    if (g) appliedGoalIds.add(g.id);
    if (!g || d.state !== "LOGGED") continue;
    const targets: Record<Dim, number> = { calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat };
    const actuals: Record<Dim, number | null> = { calories: d.caloriesKcal, protein: d.proteinG, carbs: d.carbsG, fat: d.fatG };
    for (const dim of DIMS) if (d.coverage[dim] === "COMPLETE" && actuals[dim] != null) cmp[dim].push({ t: targets[dim], a: actuals[dim]! });
  }
  const dimAdh = (rows: Array<{ t: number; a: number }>): DimensionAdherence | null => {
    if (rows.length === 0) return null;
    const n = rows.length;
    const mean = (f: (r: { t: number; a: number }) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
    return {
      comparedDays: n,
      averageTarget: r1(mean((r) => r.t)),
      averageActual: r1(mean((r) => r.a)),
      averageDelta: r1(mean((r) => r.a - r.t)),
      averageAbsoluteDelta: r1(mean((r) => Math.abs(r.a - r.t))),
    };
  };
  const hasAnyTarget = input.goals.some((g) => outDays.some((d) => pickApplicableGoal([g], new Date(`${d.date}T00:00:00.000Z`)) != null));
  const adherenceState: NutritionAnalyticsWindow["adherence"]["state"] = loggedDays === 0
    ? "NOT_AVAILABLE_NO_ACTUAL"
    : !hasAnyTarget ? "NOT_AVAILABLE_NO_TARGET" : "MEASURED";

  // ── window quality: product data-completeness criteria (PRODUCT_HEURISTIC; reuse of existing gates)
  const minRatio = cycleThresholds.nutritionAdaptive.minAdherenceForAdjustment;
  let dataQuality: NutritionDataQuality;
  if (loggedDays === 0) dataQuality = input.hasActivityBeforeWindow ? "STALE" : "NO_DATA";
  else if (loggedDays < 2) dataQuality = "INSUFFICIENT_HISTORY";
  else if (days >= cycleThresholds.assessment.minimumCycleDays && loggedDays / days >= minRatio && aCal.used.length >= 2) dataQuality = "SUFFICIENT";
  else dataQuality = "PARTIAL";

  return {
    period: { from: from.toISOString(), to: to.toISOString(), days },
    activeTarget,
    targetChangedInWindow: appliedGoalIds.size > 1,
    actual: {
      days: outDays,
      summary: {
        daysInWindow: outDays.length,
        loggedDays,
        calories: { averageKcal: aCal.average == null ? null : Math.round(aCal.average), daysUsed: aCal.used.length },
        protein: { averageG: aP.average == null ? null : r1(aP.average), daysUsed: aP.used.length, partialDays: aP.partial },
        carbs: { averageG: aC.average == null ? null : r1(aC.average), daysUsed: aC.used.length, partialDays: aC.partial },
        fat: { averageG: aF.average == null ? null : r1(aF.average), daysUsed: aF.used.length, partialDays: aF.partial },
      },
    },
    adherence: {
      state: adherenceState,
      calories: adherenceState === "MEASURED" ? dimAdh(cmp.calories) : null,
      protein: adherenceState === "MEASURED" ? dimAdh(cmp.protein) : null,
      carbs: adherenceState === "MEASURED" ? dimAdh(cmp.carbs) : null,
      fat: adherenceState === "MEASURED" ? dimAdh(cmp.fat) : null,
    },
    dataQuality,
  };
}

// ── read path (bounded queries; no per-day / per-meal round trips) ───────

export async function getNutritionAnalyticsWindow(
  userId: string,
  opts: { days?: number; asOf?: Date } = {},
): Promise<NutritionAnalyticsWindow> {
  const days = normalizeNutritionWindowDays(opts.days);
  const asOf = opts.asOf ?? new Date();
  const { from, to } = resolveNutritionWindow(asOf, days);

  const [completionRows, logRows, goalRows] = await Promise.all([
    prisma.nutritionMealCompletion.findMany({
      where: { userId, logDate: { gte: from, lte: to } },
      select: {
        logDate: true, status: true, consumedCalories: true, consumedProtein: true, consumedCarbs: true, consumedFat: true,
        updatedAt: true, mealId: true,
        meal: { select: { mealType: true, day: { select: { meals: { select: { id: true, mealType: true } } } } } },
      },
    }),
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { id: true, date: true, mealType: true, calories: true, protein: true, carbs: true, fats: true, createdAt: true },
    }),
    prisma.nutritionGoal.findMany({
      where: { userId, OR: [{ supersededAt: null }, { supersededAt: { gte: from } }] },
      select: { id: true, calories: true, protein: true, carbs: true, fat: true, status: true, validFrom: true, supersededAt: true, triggeredBy: true },
    }),
  ]);

  let hasActivityBeforeWindow = false;
  if (completionRows.length === 0 && logRows.length === 0) {
    const [priorLog, priorCompletion] = await Promise.all([
      prisma.nutritionLog.findFirst({ where: { userId, date: { lt: from } }, select: { id: true } }),
      prisma.nutritionMealCompletion.findFirst({
        where: { userId, logDate: { lt: from }, status: { in: ["COMPLETED", "PARTIAL", "SKIPPED"] } },
        select: { id: true },
      }),
    ]);
    hasActivityBeforeWindow = priorLog != null || priorCompletion != null;
  }

  return buildNutritionAnalyticsWindow({
    from, to, days,
    completions: completionRows.map((c) => ({
      logDate: c.logDate, status: c.status, consumedCalories: c.consumedCalories, consumedProtein: c.consumedProtein,
      consumedCarbs: c.consumedCarbs, consumedFat: c.consumedFat, updatedAt: c.updatedAt, mealId: c.mealId,
      mealType: c.meal.mealType, dayMeals: c.meal.day.meals.map((m) => ({ id: m.id, mealType: m.mealType })),
    })),
    logs: logRows.map((l) => ({ id: l.id, date: l.date, mealType: l.mealType, calories: l.calories, protein: l.protein, carbs: l.carbs, fats: l.fats, createdAt: l.createdAt })),
    goals: goalRows.map((g) => ({ id: g.id, calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat, status: g.status, validFrom: g.validFrom, supersededAt: g.supersededAt, triggeredBy: g.triggeredBy })),
    hasActivityBeforeWindow,
  });
}
