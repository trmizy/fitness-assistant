// Roadmap P1.3 "Superset / exercise grouping"
// (docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md). Pure, unit-testable
// logic for picking the right rest duration when advancing between
// exercises in the active-session view — the one piece of this feature
// that touches shared, already-complex active-session state, kept in its
// own file so it's testable without jsdom/RTL (this project's established
// convention, see active-log-draft.utils.ts / smart-set-prefill.utils.ts).

export interface GroupAwareExercise {
  groupId?: string | null;
  /** Short/no rest between this group's members — used ONLY when the
   * exercise being advanced FROM belongs to a group and the NEXT exercise
   * is a fellow member of that same group. */
  restBetweenExercisesSeconds?: number | null;
  /** Real rest after finishing every member of the group once — used when
   * the exercise being advanced FROM was the group's last remaining
   * member (next exercise is ungrouped, a different group, or there is no
   * next exercise). */
  restAfterRoundSeconds?: number | null;
}

/** Roadmap P1.3's own deliberate MVP scope (see the impact analysis's
 * "Scope decision"): exercises within a group still complete SEQUENTIALLY
 * (all of A's sets before B's), not truly interleaved per-set — this
 * function only decides how long the rest timer runs once the CURRENT
 * exercise is fully done, mirroring exactly the two rest fields the
 * roadmap's own schema sketch defines. An ungrouped exercise, or a group
 * whose own rest fields were left unset, falls back to `defaultRestSeconds`
 * — the pre-existing hardcoded-90 behavior everywhere else, unchanged. */
export function computeNextExerciseRestSeconds(
  currentExercise: GroupAwareExercise | null | undefined,
  nextExercise: GroupAwareExercise | null | undefined,
  defaultRestSeconds: number = 90,
): number {
  if (!currentExercise?.groupId) return defaultRestSeconds;

  const isNextSameGroup = Boolean(nextExercise?.groupId) && nextExercise!.groupId === currentExercise.groupId;
  if (isNextSameGroup) {
    return currentExercise.restBetweenExercisesSeconds ?? defaultRestSeconds;
  }
  return currentExercise.restAfterRoundSeconds ?? defaultRestSeconds;
}
