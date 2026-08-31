// Roadmap P1.3/P4 advanced-method audit: pure group execution helpers.
// Grouping is exercise structure, not a set technique and not progression
// history. These helpers operate on programExerciseId + setNumber only, so
// WorkoutSet rows are never duplicated or merged.

export interface GroupAwareExercise {
  programExerciseId?: string | null;
  groupId?: string | null;
  groupOrder?: number | null;
  sets?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restAfterRoundSeconds?: number | null;
}

export interface InterleavedSetRow {
  id?: string;
  setNumber: number;
  completed: boolean;
}

export interface InterleavedWorkoutStep {
  exerciseIndex: number;
  programExerciseId: string;
  setNumber: number;
  roundNumber: number;
  memberPosition: number;
  totalMembers: number;
  totalRounds: number;
}

export interface NextInterleavedWorkoutStep extends InterleavedWorkoutStep {
  restSeconds: number;
  restKind: "between_exercises" | "after_round";
}

export function computeNextExerciseRestSeconds(
  currentExercise: GroupAwareExercise | null | undefined,
  nextExercise: GroupAwareExercise | null | undefined,
  defaultRestSeconds: number = 90,
): number {
  if (!currentExercise?.groupId) return defaultRestSeconds;

  const isNextSameGroup =
    Boolean(nextExercise?.groupId) && nextExercise!.groupId === currentExercise.groupId;
  if (isNextSameGroup) {
    return currentExercise.restBetweenExercisesSeconds ?? defaultRestSeconds;
  }
  return currentExercise.restAfterRoundSeconds ?? defaultRestSeconds;
}

function groupMembersFor(
  exercises: GroupAwareExercise[],
  groupId: string,
): Array<GroupAwareExercise & { exerciseIndex: number; programExerciseId: string }> {
  return exercises
    .map((exercise, exerciseIndex) => ({ ...exercise, exerciseIndex }))
    .filter(
      (exercise): exercise is GroupAwareExercise & { exerciseIndex: number; programExerciseId: string } =>
        exercise.groupId === groupId && Boolean(exercise.programExerciseId),
    )
    .sort((a, b) => {
      const orderA = a.groupOrder ?? a.exerciseIndex;
      const orderB = b.groupOrder ?? b.exerciseIndex;
      return orderA - orderB || a.exerciseIndex - b.exerciseIndex;
    });
}

export function buildInterleavedWorkoutSteps(
  exercises: GroupAwareExercise[],
  setRowsByProgramExerciseId: Record<string, InterleavedSetRow[] | undefined>,
  groupId: string,
): InterleavedWorkoutStep[] {
  const members = groupMembersFor(exercises, groupId);
  if (members.length < 2) return [];

  const rowsByMember = new Map<string, InterleavedSetRow[]>();
  let totalRounds = 0;

  for (const member of members) {
    const rows = [...(setRowsByProgramExerciseId[member.programExerciseId] ?? [])]
      .filter((row) => Number.isFinite(row.setNumber) && row.setNumber > 0)
      .sort((a, b) => a.setNumber - b.setNumber);
    rowsByMember.set(member.programExerciseId, rows);
    totalRounds = Math.max(totalRounds, rows.length, member.sets ?? 0);
  }

  const steps: InterleavedWorkoutStep[] = [];
  for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber += 1) {
    members.forEach((member, memberIndex) => {
      const rows = rowsByMember.get(member.programExerciseId) ?? [];
      const row = rows.find((candidate) => candidate.setNumber === roundNumber);

      if (!row && rows.length > 0) return;
      if (!row && (member.sets ?? 0) < roundNumber) return;

      steps.push({
        exerciseIndex: member.exerciseIndex,
        programExerciseId: member.programExerciseId,
        setNumber: row?.setNumber ?? roundNumber,
        roundNumber,
        memberPosition: memberIndex + 1,
        totalMembers: members.length,
        totalRounds,
      });
    });
  }

  return steps;
}

export function findCurrentInterleavedWorkoutStep(
  exercises: GroupAwareExercise[],
  setRowsByProgramExerciseId: Record<string, InterleavedSetRow[] | undefined>,
  currentExerciseIndex: number,
  currentSetNumber: number | null | undefined,
): InterleavedWorkoutStep | null {
  const current = exercises[currentExerciseIndex];
  if (!current?.groupId || !current.programExerciseId || !currentSetNumber) return null;

  return (
    buildInterleavedWorkoutSteps(exercises, setRowsByProgramExerciseId, current.groupId).find(
      (step) =>
        step.exerciseIndex === currentExerciseIndex &&
        step.programExerciseId === current.programExerciseId &&
        step.setNumber === currentSetNumber,
    ) ?? null
  );
}

export function computeNextInterleavedWorkoutStep(
  exercises: GroupAwareExercise[],
  setRowsByProgramExerciseId: Record<string, InterleavedSetRow[] | undefined>,
  currentExerciseIndex: number,
  completedSetNumber: number,
  defaultRestSeconds: number = 90,
): NextInterleavedWorkoutStep | null {
  const current = exercises[currentExerciseIndex];
  if (!current?.groupId || !current.programExerciseId) return null;

  const steps = buildInterleavedWorkoutSteps(exercises, setRowsByProgramExerciseId, current.groupId);
  const currentStepIndex = steps.findIndex(
    (step) =>
      step.exerciseIndex === currentExerciseIndex &&
      step.programExerciseId === current.programExerciseId &&
      step.setNumber === completedSetNumber,
  );
  if (currentStepIndex < 0) return null;

  for (const nextStep of steps.slice(currentStepIndex + 1)) {
    const rows = setRowsByProgramExerciseId[nextStep.programExerciseId] ?? [];
    const row = rows.find((candidate) => candidate.setNumber === nextStep.setNumber);
    if (row?.completed) continue;

    const restKind =
      nextStep.roundNumber > steps[currentStepIndex].roundNumber
        ? "after_round"
        : "between_exercises";
    const restSeconds =
      restKind === "after_round"
        ? current.restAfterRoundSeconds ?? defaultRestSeconds
        : current.restBetweenExercisesSeconds ?? defaultRestSeconds;

    return {
      ...nextStep,
      restKind,
      restSeconds,
    };
  }

  return null;
}
