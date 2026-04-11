import { freeExerciseDbProvider } from '../providers/free-exercise-db/free-exercise.provider';
import { wgerProvider } from '../providers/wger/wger.provider';
import { exerciseDbProvider } from '../providers/exercisedb/exercisedb.provider';
import { deduplicateExercises } from '../utils/sourceRanker';
import { getDatasetConfig } from '../utils/datasetConfig';
import type { ExerciseItem, ExerciseSearchResult } from '../types';

/**
 * Exercise Catalog Service — unified entry point for exercise queries.
 *
 * Source priority (highest to lowest):
 *   1. free-exercise-db (local, always available after seeding)
 *   2. wger (remote API, enabled by default)
 *   3. ExerciseDB (optional, requires EXERCISEDB_ENABLED=true + API key)
 *
 * Results are deduplicated by exercise name (first occurrence wins).
 */
export const exerciseCatalogService = {
  /**
   * Search exercises across all enabled providers.
   * Results are merged and deduplicated — local seed is checked first.
   */
  async search(query: string, limit = 20): Promise<ExerciseSearchResult> {
    const cfg = getDatasetConfig();
    const allItems: ExerciseItem[] = [];
    const usedSources: string[] = [];

    // 1. Local free-exercise-db (synchronous, fastest)
    if (cfg.freeExerciseDb.enabled) {
      const result = freeExerciseDbProvider.search(cfg.freeExerciseDb.localPath, query, limit);
      allItems.push(...result.items);
      if (result.items.length > 0) usedSources.push('free-exercise-db');
    }

    // 2. wger (async, remote)
    if (cfg.wger.enabled && allItems.length < limit) {
      try {
        const result = await wgerProvider.searchExercises(query, cfg.wger.baseUrl, limit);
        allItems.push(...result.items);
        if (result.items.length > 0) usedSources.push('wger');
      } catch (err) {
        console.warn('[exerciseCatalogService] wger search failed:', err);
      }
    }

    // 3. ExerciseDB (optional, async, remote)
    if (cfg.exerciseDb.enabled && allItems.length < limit) {
      try {
        const result = await exerciseDbProvider.getByTarget(query, cfg.exerciseDb.apiKey, limit);
        allItems.push(...result.items);
        if (result.items.length > 0) usedSources.push('ExerciseDB');
      } catch (err) {
        console.warn('[exerciseCatalogService] ExerciseDB search failed:', err);
      }
    }

    const deduped = deduplicateExercises(allItems).slice(0, limit);
    return { items: deduped, total: deduped.length, sources: usedSources };
  },

  /**
   * Get exercises filtered by body part.
   * Primarily served from local seed; remote sources fill in gaps.
   */
  async getByBodyPart(bodyPart: string, limit = 20): Promise<ExerciseSearchResult> {
    const cfg = getDatasetConfig();
    const allItems: ExerciseItem[] = [];
    const usedSources: string[] = [];

    if (cfg.freeExerciseDb.enabled) {
      const result = freeExerciseDbProvider.search(
        cfg.freeExerciseDb.localPath,
        bodyPart,
        limit,
      );
      allItems.push(...result.items.filter((e) =>
        e.bodyPart.toLowerCase().includes(bodyPart.toLowerCase()),
      ));
      if (allItems.length > 0) usedSources.push('free-exercise-db');
    }

    if (cfg.exerciseDb.enabled && allItems.length < limit) {
      try {
        const result = await exerciseDbProvider.getByBodyPart(
          bodyPart,
          cfg.exerciseDb.apiKey,
          limit,
        );
        allItems.push(...result.items);
        if (result.items.length > 0) usedSources.push('ExerciseDB');
      } catch (err) {
        console.warn('[exerciseCatalogService] ExerciseDB bodyPart lookup failed:', err);
      }
    }

    const deduped = deduplicateExercises(allItems).slice(0, limit);
    return { items: deduped, total: deduped.length, sources: usedSources };
  },

  /**
   * List all locally available exercises (from seeded data).
   * This is the fastest path and requires no network access.
   */
  listLocal(limit = 100): ExerciseSearchResult {
    const cfg = getDatasetConfig();
    if (!cfg.freeExerciseDb.enabled) {
      return { items: [], total: 0, sources: [] };
    }

    const all = freeExerciseDbProvider.load(cfg.freeExerciseDb.localPath);
    return {
      items: all.slice(0, limit),
      total: all.length,
      sources: ['free-exercise-db'],
    };
  },
};
