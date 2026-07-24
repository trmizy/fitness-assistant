/**
 * Estimated 1-rep-max — single source of truth for this formula across the
 * codebase (training-cycle-metrics.service.ts imports this rather than
 * keeping its own copy). Uses the Epley formula:
 *
 *   1RM = weight × (1 + reps / 30)
 *
 * Chosen over Brzycki/Lombardi because it degrades gracefully at high rep
 * counts (Brzycki divides by (37 - reps) and blows up/goes negative above
 * 36 reps) and is the more commonly cited default in strength-training
 * literature for general use. This is a product default, not a claim that
 * Epley is more medically/scientifically accurate than other formulas.
 */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return weightKg;
  return weightKg * (1 + reps / 30);
}
