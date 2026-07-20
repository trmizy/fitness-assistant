import { workoutsApi, type Workout } from "../../api/workouts";
import { average, round1 } from "../../lib/math";
import type { DraftExercise } from "./workoutDraftStore";

export interface WorkoutLogPayload {
  name: string;
  date: string;
  exercises: DraftExercise[];
}

// Shared by the online submit path (log.tsx) and the offline sync engine
// so both go through the exact same 2-step backend call sequence.
export async function submitWorkoutLog(payload: WorkoutLogPayload): Promise<Workout> {
  const workout = await workoutsApi.createWorkout({
    name: payload.name,
    date: payload.date,
    exercises: payload.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets.length,
      reps: Math.round(average(e.sets.map((s) => s.reps))),
      weight: round1(average(e.sets.map((s) => s.weight))),
    })),
  });

  for (const e of payload.exercises) {
    for (let i = 0; i < e.sets.length; i++) {
      const s = e.sets[i];
      await workoutsApi.addSet(workout.id, {
        exerciseId: e.exerciseId,
        setNumber: i + 1,
        reps: s.reps,
        weight: s.weight,
        rpe: s.rpe,
      });
    }
  }

  return workout;
}
