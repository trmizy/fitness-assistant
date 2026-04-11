import { httpGet } from '../../utils/httpClient';
import { mapUsdaFoodDetail, mapUsdaSearchFood, type UsdaFoodDetail, type UsdaSearchFood } from './usda.mapper';
import type { FoodDetail, FoodSearchItem } from '../../types';

interface UsdaSearchResponse {
  totalHits: number;
  foods: UsdaSearchFood[];
}

/**
 * USDA FoodData Central provider.
 *
 * This is the AUTHORITATIVE source for all macro totals (calories, protein,
 * carbs, fats). Results from this provider must never be overridden by
 * supplementary sources.
 *
 * Docs: https://fdc.nal.usda.gov/api-guide.html
 */
export const usdaProvider = {
  /**
   * Search for foods by text query.
   * Returns normalized FoodSearchItem list sorted by USDA relevance score.
   *
   * Throws if the USDA API key is missing or the request fails.
   * Callers should handle errors gracefully (e.g., fall back to cached data).
   */
  async searchFoods(
    query: string,
    apiKey: string,
    pageSize = 10,
  ): Promise<FoodSearchItem[]> {
    if (!apiKey) throw new Error('[USDA] API key is required.');

    const data = await httpGet<UsdaSearchResponse>(
      'https://api.nal.usda.gov/fdc/v1/foods/search',
      { query, pageSize, api_key: apiKey },
    );

    return (data.foods ?? []).map(mapUsdaSearchFood);
  },

  /**
   * Fetch detailed nutrition facts for a specific food by FDC ID.
   * Use this after searchFoods to get the full macro breakdown.
   */
  async getFoodDetails(fdcId: string, apiKey: string): Promise<FoodDetail> {
    if (!apiKey) throw new Error('[USDA] API key is required.');

    const data = await httpGet<UsdaFoodDetail>(
      `https://api.nal.usda.gov/fdc/v1/food/${fdcId}`,
      { api_key: apiKey },
    );

    return mapUsdaFoodDetail(data);
  },
};
