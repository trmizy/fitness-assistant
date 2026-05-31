import fs from 'node:fs';
import { mapFreeExercise, type FreeExerciseEntry } from './free-exercise.mapper';
import type { ExerciseItem, ExerciseSearchResult } from '../../types';

let _cache: ExerciseItem[] | null = null;

/**
 * free-exercise-db provider (SUPPLEMENTARY — local seed).
 *
 * Loads exercise data from a local JSON file seeded from
 * https://github.com/yuhonas/free-exercise-db (MIT license).
 *
 * This is the default exercise fallback and requires no network access.
 * Run `npm run seed:exercises` to populate the local data file.
 */
export const freeExerciseDbProvider = {
  /**
   * Load all exercises from the local JSON file.
   * Results are cached in memory after the first load.
   */
  load(localPath: string): ExerciseItem[] {
    if (_cache) return _cache;

    if (!fs.existsSync(localPath)) {
      console.warn(
        `[free-exercise-db] Data file not found at ${localPath}. ` +
          'Run `npm run seed:exercises` to populate it.',
      );
      return [];
    }

    try {
      const raw = fs.readFileSync(localPath, 'utf-8');
      const entries: FreeExerciseEntry[] = JSON.parse(raw);
      _cache = entries.map(mapFreeExercise);
      return _cache;
    } catch (err) {
      console.error('[free-exercise-db] Failed to load exercises:', err);
      return [];
    }
  },

  /**
   * Search exercises by name, body part, muscle, or equipment.
   */
  search(localPath: string, query: string, limit = 20): ExerciseSearchResult {
    const all = this.load(localPath);
    const q = query.toLowerCase();

    const matched = all.filter(
      (ex) =>
        ex.name.toLowerCase().includes(q) ||
        ex.bodyPart.toLowerCase().includes(q) ||
        ex.targetMuscle.toLowerCase().includes(q) ||
        ex.equipment.toLowerCase().includes(q),
    );

    return {
      items: matched.slice(0, limit),
      total: matched.length,
      sources: ['free-exercise-db'],
    };
  },

  /** Clear the in-memory cache (useful in tests). */
  clearCache(): void {
    _cache = null;
  },
};
