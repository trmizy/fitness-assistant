import { usdaProvider } from '../providers/usda/usda.provider';
import { openFoodFactsProvider } from '../providers/openfoodfacts/off.provider';
import { mergeFoodDetails } from '../utils/sourceRanker';
import { getDatasetConfig } from '../utils/datasetConfig';
import type { FoodDetail, FoodSearchItem } from '../types';

/**
 * Food Search Service — unified entry point for food queries.
 *
 * Search precedence:
 *   1. USDA FoodData Central (authoritative for macro totals)
 *   2. Open Food Facts (supplementary — enriches branding, barcode, images)
 *
 * USDA macro totals always win when both sources are present.
 */
export const foodSearchService = {
  /**
   * Search for foods by text query.
   *
   * Returns USDA results if the USDA key is configured.
   * Falls back to Open Food Facts when USDA is unavailable.
   * If both are available, returns USDA results only (prefer authoritative).
   */
  async search(query: string, limit = 10): Promise<FoodSearchItem[]> {
    const cfg = getDatasetConfig();

    if (cfg.usda.enabled) {
      try {
        return await usdaProvider.searchFoods(query, cfg.usda.apiKey, limit);
      } catch (err) {
        console.warn('[foodSearchService] USDA search failed, falling back to OFF:', err);
      }
    }

    if (cfg.openFoodFacts.enabled) {
      try {
        return await openFoodFactsProvider.searchFoods(query, limit);
      } catch (err) {
        console.warn('[foodSearchService] Open Food Facts search failed:', err);
      }
    }

    return [];
  },

  /**
   * Get detailed nutrition for a food.
   * Supports both USDA fdcId and Open Food Facts barcode as identifiers.
   *
   * @param id      USDA fdcId (preferred) or product identifier
   * @param source  'usda' | 'openfoodfacts' (default: 'usda')
   */
  async getDetails(id: string, source: 'usda' | 'openfoodfacts' = 'usda'): Promise<FoodDetail | null> {
    const cfg = getDatasetConfig();

    if (source === 'usda' && cfg.usda.enabled) {
      try {
        return await usdaProvider.getFoodDetails(id, cfg.usda.apiKey);
      } catch (err) {
        console.warn('[foodSearchService] USDA detail fetch failed:', err);
        return null;
      }
    }

    if (source === 'openfoodfacts' && cfg.openFoodFacts.enabled) {
      try {
        return await openFoodFactsProvider.getProductByBarcode(id);
      } catch (err) {
        console.warn('[foodSearchService] OFF detail fetch failed:', err);
        return null;
      }
    }

    return null;
  },

  /**
   * Enrich an Open Food Facts product with USDA nutrition data.
   *
   * If the same food is found in USDA by name, USDA macros are merged in,
   * overriding the OFF macro totals. OFF branding/barcode data is preserved.
   *
   * This is the canonical way to combine both sources.
   */
  async enrichWithUsda(offDetail: FoodDetail): Promise<FoodDetail> {
    const cfg = getDatasetConfig();
    if (!cfg.usda.enabled) return offDetail;

    try {
      const usdaResults = await usdaProvider.searchFoods(offDetail.name, cfg.usda.apiKey, 1);
      if (usdaResults.length === 0) return offDetail;

      const usdaDetail = await usdaProvider.getFoodDetails(usdaResults[0].id, cfg.usda.apiKey);
      // USDA is primary — it wins on all macro totals.
      return mergeFoodDetails(usdaDetail, offDetail);
    } catch (err) {
      console.warn('[foodSearchService] USDA enrichment failed, returning OFF data:', err);
      return offDetail;
    }
  },
};
