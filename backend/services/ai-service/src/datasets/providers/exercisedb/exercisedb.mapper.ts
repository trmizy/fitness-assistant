import type { ExerciseItem, SourceAttribution } from '../../types';

const EXERCISEDB_SOURCE: SourceAttribution = {
  providerName: 'ExerciseDB',
  sourceUrl: 'https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb',
  authoritative: false,
  level: 'supplementary',
};

// ─── Internal ExerciseDB API shape ────────────────────────────────────────────

export interface ExerciseDbEntry {
  id: string;
  name: string;
  bodyPart: string;
  target: string;
  secondaryMuscles?: string[];
  equipment: string;
  instructions?: string[];
  gifUrl?: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function mapExerciseDbEntry(entry: ExerciseDbEntry): ExerciseItem {
  return {
    id: `exercisedb-${entry.id}`,
    name: entry.name,
    bodyPart: entry.bodyPart,
    targetMuscle: entry.target,
    secondaryMuscles: entry.secondaryMuscles ?? [],
    equipment: entry.equipment,
    instructions: entry.instructions ?? [],
    gifUrl: entry.gifUrl,
    source: EXERCISEDB_SOURCE,
  };
}
