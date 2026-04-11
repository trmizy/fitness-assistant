import { httpGet } from '../../utils/httpClient';
import { mapWgerExercise, type WgerExercise, type WgerSearchSuggestion } from './wger.mapper';
import type { ExerciseItem, ExerciseSearchResult } from '../../types';

interface WgerPaginatedResponse<T> {
  count: number;
  next: string | null;
  results: T[];
}

/**
 * wger exercise provider (SUPPLEMENTARY).
 *
 * wger (https://wger.de) is an open-source fitness manager that exposes a
 * REST API with a comprehensive exercise catalog, ingredient database, and
 * nutrition plans.
 *
 * For this integration we use:
 *   - Exercise search and catalog (REST API v2)
 *
 * License: AGPLv3 (server-side use, API consumption is fine).
 */
export const wgerProvider = {
  /**
   * Text search for exercises using wger's search endpoint.
   * Returns exercises matching the term with basic metadata.
   */
  async searchExercises(
    term: string,
    baseUrl: string,
    limit = 20,
  ): Promise<ExerciseSearchResult> {
    // wger's search endpoint returns lightweight suggestion objects.
    // We then fetch base exercise details for each result.
    const searchData = await httpGet<{ suggestions: WgerSearchSuggestion[] }>(
      `${baseUrl}/exercise/search/`,
      { term, language: 'english', format: 'json' },
    );

    const suggestions = (searchData.suggestions ?? []).slice(0, limit);

    // Fetch full details for each suggestion in parallel (capped to avoid flooding)
    const details = await Promise.all(
      suggestions.map(async (s): Promise<ExerciseItem | null> => {
        try {
          const id = s.base_id ?? s.id;
          const data = await httpGet<WgerExercise>(`${baseUrl}/exerciseinfo/${id}/?format=json`);
          return mapWgerExercise(data);
        } catch {
          return null;
        }
      }),
    );

    const items = details.filter((x): x is ExerciseItem => x !== null);
    return { items, total: items.length, sources: ['wger'] };
  },

  /**
   * Fetch a paginated list of exercises from wger.
   * Use this for catalog import / seeding.
   */
  async listExercises(
    baseUrl: string,
    limit = 100,
    offset = 0,
  ): Promise<ExerciseSearchResult> {
    const data = await httpGet<WgerPaginatedResponse<WgerExercise>>(
      `${baseUrl}/exerciseinfo/`,
      { format: 'json', language: 2, limit, offset }, // language 2 = English
    );

    const items = (data.results ?? []).map(mapWgerExercise);
    return { items, total: data.count, sources: ['wger'] };
  },
};
