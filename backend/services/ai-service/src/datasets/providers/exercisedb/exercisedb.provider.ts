/**
 * ExerciseDB provider (SUPPLEMENTARY — OPTIONAL).
 *
 * ⚠️  LICENSE NOTICE — READ BEFORE ENABLING ⚠️
 *
 * ExerciseDB is hosted on RapidAPI:
 *   https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb
 *
 * Usage is governed by:
 *   1. RapidAPI Terms of Service (https://rapidapi.com/terms/)
 *   2. ExerciseDB's own terms as specified on the RapidAPI listing.
 *
 * Key points:
 *   - Free tier has rate limits (typically 50 req/day on the free plan).
 *   - Commercial or high-volume use requires a paid subscription.
 *   - GIF assets are hosted by ExerciseDB — check their terms before
 *     caching or republishing them.
 *   - Attribution may be required depending on your use case.
 *
 * This provider is DISABLED by default.
 * To enable: set EXERCISEDB_ENABLED=true and EXERCISEDB_API_KEY in .env.
 * See DATASETS.md for the full decision checklist.
 */

import { httpGet } from '../../utils/httpClient';
import { mapExerciseDbEntry, type ExerciseDbEntry } from './exercisedb.mapper';
import type { ExerciseItem, ExerciseSearchResult } from '../../types';

const BASE_URL = 'https://exercisedb.p.rapidapi.com';

export const exerciseDbProvider = {
  /**
   * Fetch exercises by body part.
   * Requires a valid RapidAPI key for ExerciseDB.
   */
  async getByBodyPart(
    bodyPart: string,
    apiKey: string,
    limit = 20,
    offset = 0,
  ): Promise<ExerciseSearchResult> {
    const items = await httpGet<ExerciseDbEntry[]>(
      `${BASE_URL}/exercises/bodyPart/${encodeURIComponent(bodyPart)}`,
      { limit, offset },
      {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
      },
    );

    const mapped = (items ?? []).map(mapExerciseDbEntry);
    return { items: mapped, total: mapped.length, sources: ['ExerciseDB'] };
  },

  /**
   * Fetch exercises by target muscle.
   */
  async getByTarget(
    target: string,
    apiKey: string,
    limit = 20,
    offset = 0,
  ): Promise<ExerciseSearchResult> {
    const items = await httpGet<ExerciseDbEntry[]>(
      `${BASE_URL}/exercises/target/${encodeURIComponent(target)}`,
      { limit, offset },
      {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
      },
    );

    const mapped = (items ?? []).map(mapExerciseDbEntry);
    return { items: mapped, total: mapped.length, sources: ['ExerciseDB'] };
  },

  /**
   * Fetch a single exercise by ID.
   */
  async getById(id: string, apiKey: string): Promise<ExerciseItem | null> {
    try {
      const item = await httpGet<ExerciseDbEntry>(
        `${BASE_URL}/exercises/exercise/${encodeURIComponent(id)}`,
        {},
        {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
        },
      );
      return mapExerciseDbEntry(item);
    } catch {
      return null;
    }
  },
};
