import type { ExerciseItem, SourceAttribution } from '../../types';

const WGER_SOURCE: SourceAttribution = {
  providerName: 'wger',
  sourceUrl: 'https://wger.de',
  authoritative: false,
  level: 'supplementary',
};

// ─── Internal wger API shapes ─────────────────────────────────────────────────

export interface WgerCategory {
  id: number;
  name: string;
}

export interface WgerMuscle {
  id: number;
  name_en: string;
  name?: string;
  is_front?: boolean;
}

export interface WgerEquipment {
  id: number;
  name: string;
}

export interface WgerExercise {
  id: number;
  uuid?: string;
  name?: string;
  description?: string;
  category?: WgerCategory;
  muscles?: WgerMuscle[];
  muscles_secondary?: WgerMuscle[];
  equipment?: WgerEquipment[];
  language?: { id: number; short_name: string };
}

/** wger exercise search endpoint returns a different shape */
export interface WgerSearchSuggestion {
  id: number;
  name: string;
  category: string;
  base_id?: number;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function mapWgerExercise(ex: WgerExercise): ExerciseItem {
  const primaryMuscle = ex.muscles?.[0]?.name_en ?? 'Unknown';
  const secondaryMuscles = (ex.muscles_secondary ?? []).map((m) => m.name_en);
  const equipment = ex.equipment?.[0]?.name ?? 'Body weight';
  const bodyPart = ex.category?.name ?? 'Unknown';

  return {
    id: String(ex.id),
    name: ex.name ?? 'Unnamed exercise',
    bodyPart,
    targetMuscle: primaryMuscle,
    secondaryMuscles,
    equipment,
    instructions: ex.description ? [stripHtml(ex.description)] : [],
    source: WGER_SOURCE,
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
