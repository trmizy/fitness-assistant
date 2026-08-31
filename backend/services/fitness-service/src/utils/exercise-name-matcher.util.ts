/**
 * Roadmap P2 "Canonical import framework"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
 *
 * A dedicated, name-only exercise matcher for imports. `detectDuplicate`
 * (exercise-duplicate-detector.ts, reused unchanged by Custom Exercises'
 * catalog dedup) compares full exercise records — equipment, muscles,
 * movement pattern. An imported CSV row only ever has a plain name
 * string (e.g. Hevy's `exercise_title`), so that tool doesn't apply here.
 * Pure, no Prisma — directly unit-testable.
 */
import { normalizeVietnamese } from "./normalizeVietnamese";

export interface MatchCandidate {
  id: string;
  name: string;
  confidence: number; // 0..1, token-Jaccard overlap
}

function normalizeName(name: string): string {
  // Reuses normalizeVietnamese unchanged (already handles NFD accent
  // stripping AND đ/Đ — which NFD alone does NOT decompose, since it's a
  // distinct base letter, not a base+diacritic pair — see this codebase's
  // own exercise-review.service.ts/exercise.service.ts search paths for
  // the same reason this same helper is used there). A first version of
  // this function reimplemented accent-stripping by hand and silently
  // mis-normalized every đ/Đ in this catalog's many Vietnamese exercise
  // names — caught by this file's own unit test, fixed by reusing the
  // existing helper instead of a second, flawed copy.
  return normalizeVietnamese(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Minimum token-overlap score to surface a name as a candidate at all —
 * below this, a name is closer to unrelated than genuinely similar, and
 * showing it would just be noise the user has to dismiss. */
export const FUZZY_MATCH_THRESHOLD = 0.4;
/** At or above this, the top candidate is confident enough to
 * pre-select (still shown for the user's explicit confirmation — never
 * auto-committed unconfirmed, per the roadmap's "no automatic
 * low-confidence mapping" rule). */
export const EXACT_MATCH_THRESHOLD = 0.999;

/**
 * Ranks up to `limit` catalog exercises by name similarity to
 * `importedName`. An exact (post-normalization) match always scores 1
 * and sorts first. Returns an empty array when nothing clears
 * FUZZY_MATCH_THRESHOLD — an honest "no match", never a forced guess.
 */
export function matchExerciseName(
  importedName: string,
  catalog: Array<{ id: string; name: string }>,
  limit = 3,
): MatchCandidate[] {
  const importedTokens = tokenSet(importedName);
  const importedNormalized = normalizeName(importedName);

  const scored = catalog.map((c) => {
    const exact = normalizeName(c.name) === importedNormalized;
    const confidence = exact ? 1 : jaccard(importedTokens, tokenSet(c.name));
    return { id: c.id, name: c.name, confidence };
  });

  return scored
    .filter((s) => s.confidence >= FUZZY_MATCH_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
