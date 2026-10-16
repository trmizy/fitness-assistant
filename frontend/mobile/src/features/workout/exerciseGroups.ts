/**
 * 14B.4 (PG-A3) — superset / triset / circuit execution, ported from web
 * `pages/client/exercise-group.utils.ts` (same step order, same rest choice). Grouping is exercise
 * structure: these helpers only read programExerciseId + setNumber, no set row is merged or copied.
 *
 * Mobile shows every exercise at once instead of web's one-exercise-at-a-time view, so the "next
 * step" is surfaced as the rest timer's length and a "Tiếp theo" line rather than by switching the
 * active exercise.
 */
import type { ExerciseBlock } from "./normalizeWorkout";

export interface GroupAwareExercise {
  programExerciseId?: string | null;
  groupId?: string | null;
  groupType?: string | null;
  groupOrder?: number | null;
  sets?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restAfterRoundSeconds?: number | null;
}

export interface InterleavedSetRow {
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

type GroupMeta = {
  groupId: string;
  groupType: string;
  groupOrder: number;
  restBetweenExercisesSeconds: number | null;
  restAfterRoundSeconds: number | null;
};

/** programExerciseId → group metadata, from a schedule's `programDay.exerciseGroups[].members[]`. */
export function groupMetaFromDay(programDay: any): Map<string, GroupMeta> {
  const out = new Map<string, GroupMeta>();
  const groups: any[] = Array.isArray(programDay?.exerciseGroups) ? programDay.exerciseGroups : [];
  for (const group of groups) {
    for (const member of Array.isArray(group?.members) ? group.members : []) {
      if (!member?.programExerciseId) continue;
      out.set(String(member.programExerciseId), {
        groupId: String(group.id),
        groupType: String(group.type ?? ""),
        groupOrder: Number(member.order ?? 0),
        restBetweenExercisesSeconds: group.restBetweenExercisesSeconds ?? null,
        restAfterRoundSeconds: group.restAfterRoundSeconds ?? null,
      });
    }
  }
  return out;
}

/** The session's blocks in the shape the step helpers read (index = block index). */
export function groupAwareBlocks(blocks: readonly ExerciseBlock[], meta: Map<string, GroupMeta>): GroupAwareExercise[] {
  return blocks.map((b) => ({
    programExerciseId: b.programExerciseId ?? null,
    sets: b.sets.length,
    ...(b.programExerciseId ? meta.get(String(b.programExerciseId)) : undefined),
  }));
}

export function setRowsByProgramExerciseId(blocks: readonly ExerciseBlock[]): Record<string, InterleavedSetRow[]> {
  const out: Record<string, InterleavedSetRow[]> = {};
  for (const b of blocks) {
    if (!b.programExerciseId) continue;
    out[String(b.programExerciseId)] = b.sets.map((s) => ({ setNumber: s.setNumber, completed: s.completed }));
  }
  return out;
}

function groupMembersFor(exercises: GroupAwareExercise[], groupId: string) {
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
  setRowsByPeId: Record<string, InterleavedSetRow[] | undefined>,
  groupId: string,
): InterleavedWorkoutStep[] {
  const members = groupMembersFor(exercises, groupId);
  if (members.length < 2) return [];

  const rowsByMember = new Map<string, InterleavedSetRow[]>();
  let totalRounds = 0;
  for (const member of members) {
    const rows = [...(setRowsByPeId[member.programExerciseId] ?? [])]
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
  setRowsByPeId: Record<string, InterleavedSetRow[] | undefined>,
  currentExerciseIndex: number,
  currentSetNumber: number | null | undefined,
): InterleavedWorkoutStep | null {
  const current = exercises[currentExerciseIndex];
  if (!current?.groupId || !current.programExerciseId || !currentSetNumber) return null;
  return (
    buildInterleavedWorkoutSteps(exercises, setRowsByPeId, current.groupId).find(
      (step) =>
        step.exerciseIndex === currentExerciseIndex &&
        step.programExerciseId === current.programExerciseId &&
        step.setNumber === currentSetNumber,
    ) ?? null
  );
}

export function computeNextInterleavedWorkoutStep(
  exercises: GroupAwareExercise[],
  setRowsByPeId: Record<string, InterleavedSetRow[] | undefined>,
  currentExerciseIndex: number,
  completedSetNumber: number,
  defaultRestSeconds = 90,
): NextInterleavedWorkoutStep | null {
  const current = exercises[currentExerciseIndex];
  if (!current?.groupId || !current.programExerciseId) return null;

  const steps = buildInterleavedWorkoutSteps(exercises, setRowsByPeId, current.groupId);
  const currentStepIndex = steps.findIndex(
    (step) =>
      step.exerciseIndex === currentExerciseIndex &&
      step.programExerciseId === current.programExerciseId &&
      step.setNumber === completedSetNumber,
  );
  if (currentStepIndex < 0) return null;

  for (const nextStep of steps.slice(currentStepIndex + 1)) {
    const rows = setRowsByPeId[nextStep.programExerciseId] ?? [];
    const row = rows.find((candidate) => candidate.setNumber === nextStep.setNumber);
    if (row?.completed) continue;
    const restKind = nextStep.roundNumber > steps[currentStepIndex].roundNumber ? "after_round" : "between_exercises";
    const restSeconds =
      restKind === "after_round"
        ? current.restAfterRoundSeconds ?? defaultRestSeconds
        : current.restBetweenExercisesSeconds ?? defaultRestSeconds;
    return { ...nextStep, restKind, restSeconds };
  }
  return null;
}
