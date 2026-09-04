/**
 * Roadmap P2 "Canonical import framework" (roadmap §14's own naming) —
 * the ONE canonical shape every provider parser (Hevy, Strong, ...)
 * must produce. `import.service.ts`'s preview/commit logic is written
 * against these types only, never a provider-specific shape — this is
 * what makes adding a new provider "a thin parser" rather than a second
 * pipeline.
 */

export interface ImportedSet {
  setNumber: number;
  weight: number | null; // kg
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  setType: string | null; // "WARMUP" | "WORKING" | "FAILURE" | null (unmapped provider set type)
}

export interface ImportedExercise {
  exerciseTitle: string;
  order: number;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  title: string;
  date: string; // YYYY-MM-DD, the calendar day this workout happened on
  notes: string | null;
  exercises: ImportedExercise[];
  sourceHash: string; // deterministic identity for idempotent re-import detection
}

export interface RowError {
  rowIndex: number; // 1-based, header row is row 0
  message: string;
}

export interface ProviderParseResult {
  workouts: ImportedWorkout[];
  rowErrors: RowError[];
}
