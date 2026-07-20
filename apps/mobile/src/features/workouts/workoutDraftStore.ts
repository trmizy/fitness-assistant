import { create } from "zustand";

export interface DraftSet {
  localId: string;
  reps: number;
  weight: number;
  rpe?: number;
}

export interface DraftExercise {
  exerciseId: string;
  exerciseName: string;
  sets: DraftSet[];
}

interface WorkoutDraftState {
  name: string;
  exercises: DraftExercise[];
  setName: (name: string) => void;
  addExercise: (exerciseId: string, exerciseName: string) => void;
  removeExercise: (exerciseId: string) => void;
  addSet: (exerciseId: string) => void;
  updateSet: (exerciseId: string, localId: string, patch: Partial<Omit<DraftSet, "localId">>) => void;
  removeSet: (exerciseId: string, localId: string) => void;
  reset: () => void;
}

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `set-${localIdCounter}`;
}

const DEFAULT_NAME = () => `Buổi tập ${new Date().toLocaleDateString("vi-VN")}`;

export const useWorkoutDraftStore = create<WorkoutDraftState>((set) => ({
  name: DEFAULT_NAME(),
  exercises: [],

  setName: (name) => set({ name }),

  addExercise: (exerciseId, exerciseName) =>
    set((state) => {
      if (state.exercises.some((e) => e.exerciseId === exerciseId)) return state;
      return {
        exercises: [
          ...state.exercises,
          {
            exerciseId,
            exerciseName,
            sets: [{ localId: nextLocalId(), reps: 10, weight: 0 }],
          },
        ],
      };
    }),

  removeExercise: (exerciseId) =>
    set((state) => ({ exercises: state.exercises.filter((e) => e.exerciseId !== exerciseId) })),

  addSet: (exerciseId) =>
    set((state) => ({
      exercises: state.exercises.map((e) => {
        if (e.exerciseId !== exerciseId) return e;
        const last = e.sets[e.sets.length - 1];
        return {
          ...e,
          sets: [
            ...e.sets,
            { localId: nextLocalId(), reps: last?.reps ?? 10, weight: last?.weight ?? 0, rpe: last?.rpe },
          ],
        };
      }),
    })),

  updateSet: (exerciseId, localId, patch) =>
    set((state) => ({
      exercises: state.exercises.map((e) =>
        e.exerciseId !== exerciseId
          ? e
          : { ...e, sets: e.sets.map((s) => (s.localId === localId ? { ...s, ...patch } : s)) },
      ),
    })),

  removeSet: (exerciseId, localId) =>
    set((state) => ({
      exercises: state.exercises.map((e) =>
        e.exerciseId !== exerciseId ? e : { ...e, sets: e.sets.filter((s) => s.localId !== localId) },
      ),
    })),

  reset: () => set({ name: DEFAULT_NAME(), exercises: [] }),
}));

export function computeTotalVolume(exercises: DraftExercise[]): number {
  return exercises.reduce(
    (total, e) => total + e.sets.reduce((sum, s) => sum + s.reps * s.weight, 0),
    0,
  );
}
