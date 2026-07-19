import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { InBodyEntrySnapshot } from "../clients/user.client";
import type { AdherenceMetric, E1rmTrendPoint, RpeTrend, VolumeWeek } from "./training-cycle-metrics.service";

export type SignalLevel = "up" | "flat" | "down";
export type OverallTrend = "PROGRESSING" | "PLATEAU" | "DECLINING";

export interface ProgressSignals {
  overallTrend: OverallTrend;
  deltaSMM: number | null;
  deltaPBF: number | null;
  volumeChangePct: number | null;
  newPRs: string[];
  adherencePct: number;
  rpeTrend: RpeTrend["trend"];
  laggingMuscleGroups: string[];
  signalBreakdown: Record<string, SignalLevel>;
}

function classifyBodyComposition(
  goal: string | null,
  deltaSMM: number | null,
  deltaPBF: number | null,
  deltaWeight: number | null,
): SignalLevel {
  const c = cycleThresholds.classification;

  if (goal === "MUSCLE_GAIN") {
    if (deltaSMM == null) return "flat";
    if (deltaSMM >= c.smmProgressingMinKg) {
      // Bulking well only if fat gain isn't dominating the weight gained
      if (deltaWeight != null && deltaWeight > 0) {
        const fatShare = 1 - deltaSMM / deltaWeight;
        if (fatShare > c.bulkFatGainWarnFraction) return "flat";
      }
      return "up";
    }
    return deltaSMM <= c.smmDecliningMaxKg ? "down" : "flat";
  }

  if (goal === "WEIGHT_LOSS") {
    if (deltaPBF == null) return "flat";
    if (deltaPBF <= c.pbfProgressingMaxPct) return "up";
    return deltaPBF >= c.pbfDecliningMinPct ? "down" : "flat";
  }

  // MAINTENANCE / ATHLETIC_PERFORMANCE / unset — no single clean composition
  // signal; treat as flat and defer to volume/adherence/PR signals instead.
  return "flat";
}

function classifyVolume(volumeChangePct: number | null): SignalLevel {
  const c = cycleThresholds.classification;
  if (volumeChangePct == null) return "flat";
  if (volumeChangePct >= c.volumeProgressingMinPct) return "up";
  if (volumeChangePct <= c.volumeDecliningMaxPct) return "down";
  return "flat";
}

function classifyAdherence(adherencePct: number): SignalLevel {
  const c = cycleThresholds.classification;
  if (adherencePct >= c.adherenceProgressingMinPct) return "up";
  if (adherencePct < c.adherenceDecliningMaxPct) return "down";
  return "flat";
}

function classifyPRs(newPRs: string[]): SignalLevel {
  return newPRs.length > 0 ? "up" : "flat";
}

/** Muscle groups whose weekly volume sits below the cycle median more often than not. */
function findLaggingMuscleGroups(volumeByWeek: VolumeWeek[]): string[] {
  const c = cycleThresholds.classification;
  if (volumeByWeek.length === 0) return [];

  const allGroups = new Set<string>();
  for (const week of volumeByWeek) {
    for (const group of Object.keys(week.byMuscleGroup)) allGroups.add(group);
  }

  const belowMedianCount = new Map<string, number>();
  for (const group of allGroups) {
    const values = volumeByWeek.map((w) => w.byMuscleGroup[group] ?? 0);
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const count = values.filter((v) => v < median).length;
    belowMedianCount.set(group, count);
  }

  return [...belowMedianCount.entries()]
    .filter(([, count]) => count >= c.laggingMuscleGroupCount)
    .sort((a, b) => b[1] - a[1])
    .map(([group]) => group)
    .slice(0, 3);
}

export function classifyProgress(params: {
  goal: string | null;
  startInBody: InBodyEntrySnapshot | null;
  endInBody: InBodyEntrySnapshot | null;
  volumeByWeek: VolumeWeek[];
  volumeChangePct: number | null;
  newPRs: string[];
  adherence: AdherenceMetric;
  rpeTrend: RpeTrend;
  e1rmTrend: E1rmTrendPoint[];
}): ProgressSignals {
  const { goal, startInBody, endInBody, volumeByWeek, volumeChangePct, newPRs, adherence, rpeTrend } = params;

  const deltaSMM =
    startInBody?.muscleMass != null && endInBody?.muscleMass != null
      ? Math.round((endInBody.muscleMass - startInBody.muscleMass) * 100) / 100
      : null;
  const deltaPBF =
    startInBody?.bodyFatPct != null && endInBody?.bodyFatPct != null
      ? Math.round((endInBody.bodyFatPct - startInBody.bodyFatPct) * 100) / 100
      : null;
  const deltaWeight =
    startInBody?.weight != null && endInBody?.weight != null
      ? Math.round((endInBody.weight - startInBody.weight) * 100) / 100
      : null;

  const signalBreakdown: Record<string, SignalLevel> = {
    bodyComposition: classifyBodyComposition(goal, deltaSMM, deltaPBF, deltaWeight),
    volume: classifyVolume(volumeChangePct),
    adherence: classifyAdherence(adherence.percent),
    prs: classifyPRs(newPRs),
  };

  // Weighted vote: body composition + adherence carry more weight than
  // volume/PRs (a user can grind lots of volume and still not be
  // progressing physically, or vice versa hit a PR on pure form improvement).
  const score =
    (signalBreakdown.bodyComposition === "up" ? 2 : signalBreakdown.bodyComposition === "down" ? -2 : 0) +
    (signalBreakdown.adherence === "up" ? 1 : signalBreakdown.adherence === "down" ? -1 : 0) +
    (signalBreakdown.volume === "up" ? 1 : signalBreakdown.volume === "down" ? -1 : 0) +
    (signalBreakdown.prs === "up" ? 1 : 0);

  const overallTrend: OverallTrend = score >= 2 ? "PROGRESSING" : score <= -2 ? "DECLINING" : "PLATEAU";

  return {
    overallTrend,
    deltaSMM,
    deltaPBF,
    volumeChangePct,
    newPRs,
    adherencePct: adherence.percent,
    rpeTrend: rpeTrend.trend,
    laggingMuscleGroups: findLaggingMuscleGroups(volumeByWeek),
    signalBreakdown,
  };
}
