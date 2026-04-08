import type { ExerciseItem, SourceAttribution } from '../../types';

const FREE_EXERCISE_SOURCE: SourceAttribution = {
  providerName: 'free-exercise-db',
  sourceUrl: 'https://github.com/yuhonas/free-exercise-db',
  authoritative: false,
  level: 'supplementary',
};

// ─── Internal free-exercise-db JSON shape ─────────────────────────────────────

export interface FreeExerciseEntry {
  id: string;
  name: string;
  force?: string | null;
  level?: string;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
  images?: string[];
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function mapFreeExercise(entry: FreeExerciseEntry): ExerciseItem {
  return {
    id: entry.id,
    name: entry.name,
    bodyPart: entry.category ?? 'Unknown',
    targetMuscle: entry.primaryMuscles?.[0] ?? 'Unknown',
    secondaryMuscles: entry.secondaryMuscles ?? [],
    equipment: entry.equipment ?? 'Body weight',
    level: entry.level,
    force: entry.force ?? undefined,
    mechanic: entry.mechanic ?? undefined,
    category: entry.category,
    instructions: entry.instructions ?? [],
    images: (entry.images ?? []).map((img) =>
      img.startsWith('http')
        ? img
        : `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${img}`,
    ),
    source: FREE_EXERCISE_SOURCE,
  };
}
