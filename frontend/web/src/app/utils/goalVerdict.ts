/**
 * D4 (owner decision 2026-11-22) — what the client dashboard may say about body-composition progress.
 *
 * The frontend NEVER judges progress itself. It only names the verdict the backend already computed:
 *   effective goal ← GET /fitness-roadmaps/goal-coherence → effectiveGoal { goal, source, phaseType }
 *   verdict        ← TrainingCycle.summary.progressSignals.signalBreakdown.bodyComposition (up|flat|down),
 *                    computed by fitness-service training-cycle-classification.service.ts (env thresholds)
 *   data gate      ← progressSignals.deltaSMM / deltaPBF present (the engine returns "flat" for BOTH
 *                    "no data" and "no change", so "flat" alone must never be shown as stable)
 * Rules: weight is never judged; only the goal's own metric is (MUSCLE_GAIN → muscle, WEIGHT_LOSS →
 * body-fat %); MAINTENANCE / ATHLETIC_PERFORMANCE / no goal → nothing; RECOMPOSITION is shown by its own
 * name and is NOT evaluated (no backend rule yet — separate business decision); a goal conflict or a
 * cycle assessed under a different goal → nothing; colour always comes with an icon and words.
 */
export type BodyMetric = "weight" | "muscle" | "fat";
export type VerdictTone = "success" | "warning" | "neutral";
export interface Verdict { tone: VerdictTone; icon: "up" | "down" | "steady" | "info" | null; label: string | null }

export const D4_TEXT = {
  muscle: { up: "Khối cơ tăng so với kỳ trước.", down: "Khối cơ giảm so với kỳ trước.", flat: "Khối cơ ổn định trong kỳ." },
  fat: { up: "Tỷ lệ mỡ cơ thể giảm so với kỳ trước.", down: "Tỷ lệ mỡ cơ thể tăng so với kỳ trước.", flat: "Tỷ lệ mỡ cơ thể ổn định trong kỳ." },
  noData: "Chưa đủ dữ liệu để đánh giá tiến độ.",
} as const;

export const GOAL_DISPLAY: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Nâng cao thể lực",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
};

export interface VerdictInput {
  effectiveGoal: string | null;
  phaseType?: string | null;
  coherent: boolean;
  /** Most recent cycle that HAS progress signals, or null. */
  cycle: null | {
    goal: string | null;
    bodyComposition: "up" | "flat" | "down" | null;
    deltaSMM: number | null;
    deltaPBF: number | null;
  };
}

export function goalDisplayName(input: Pick<VerdictInput, "effectiveGoal" | "phaseType">): string | null {
  if (input.phaseType === "RECOMPOSITION") return GOAL_DISPLAY.RECOMPOSITION;
  return input.effectiveGoal ? GOAL_DISPLAY[input.effectiveGoal] ?? null : null;
}

const NONE: Verdict = { tone: "neutral", icon: null, label: null };

export function bodyCompVerdict(metric: BodyMetric, input: VerdictInput): Verdict {
  if (metric === "weight") return NONE;
  if (!input.coherent || !input.effectiveGoal || input.phaseType === "RECOMPOSITION") return NONE;
  const own = (input.effectiveGoal === "MUSCLE_GAIN" && metric === "muscle") || (input.effectiveGoal === "WEIGHT_LOSS" && metric === "fat");
  if (!own) return NONE;
  const c = input.cycle;
  const delta = metric === "muscle" ? c?.deltaSMM : c?.deltaPBF;
  // A verdict computed under another goal (e.g. before a phase change) says nothing about this one.
  if (c && c.goal && c.goal !== input.effectiveGoal) return NONE;
  if (!c || c.bodyComposition == null || delta == null) return { tone: "neutral", icon: "info", label: D4_TEXT.noData };
  const t = D4_TEXT[metric];
  if (c.bodyComposition === "up") return { tone: "success", icon: metric === "muscle" ? "up" : "down", label: t.up };
  if (c.bodyComposition === "down") return { tone: "warning", icon: metric === "muscle" ? "down" : "up", label: t.down };
  return { tone: "neutral", icon: "steady", label: t.flat };
}
