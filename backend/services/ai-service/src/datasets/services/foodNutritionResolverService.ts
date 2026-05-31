import { usdaProvider } from '../providers/usda/usda.provider';
import { openFoodFactsProvider } from '../providers/openfoodfacts/off.provider';
import { mergeFoodDetails } from '../utils/sourceRanker';
import { getDatasetConfig } from '../utils/datasetConfig';
import type { FoodDetail, NutritionFacts } from '../types';

/**
 * Food Nutrition Resolver Service.
 *
 * Guarantees that final macro totals (calories, protein, carbs, fat)
 * always come from USDA when USDA data is available.
 *
 * This is the service the LLM pipeline and meal plan modules should call
 * when they need reliable nutrition numbers for a specific food.
 *
 * Resolution flow:
 *   1. Try USDA by name or fdcId → return immediately if found.
 *   2. If USDA unavailable/not found, try Open Food Facts.
 *   3. If both have data, USDA macros always override OFF macros.
 *   4. If neither has data, return null.
 */
export const foodNutritionResolverService = {
  /**
   * Resolve nutrition facts for a food by name.
   * Always returns USDA-authoritative macros when possible.
   */
  async resolveByName(foodName: string): Promise<FoodDetail | null> {
    const cfg = getDatasetConfig();

    // Step 1: USDA lookup (authoritative)
    if (cfg.usda.enabled) {
      try {
        const results = await usdaProvider.searchFoods(foodName, cfg.usda.apiKey, 1);
        if (results.length > 0) {
          const detail = await usdaProvider.getFoodDetails(results[0].id, cfg.usda.apiKey);
          return detail; // USDA only — guaranteed authoritative
        }
      } catch (err) {
        console.warn('[foodNutritionResolver] USDA lookup failed:', err);
      }
    }

    // Step 2: OFF fallback (supplementary — will NOT be authoritative)
    if (cfg.openFoodFacts.enabled) {
      try {
        const offResults = await openFoodFactsProvider.searchFoodsWithDetail(foodName, 1);
        if (offResults.length > 0) {
          console.info(
            `[foodNutritionResolver] Using Open Food Facts for "${foodName}" — ` +
              'USDA was unavailable. Macros are supplementary, not authoritative.',
          );
          return offResults[0];
        }
      } catch (err) {
        console.warn('[foodNutritionResolver] OFF lookup failed:', err);
      }
    }

    return null;
  },

  /**
   * Resolve nutrition facts by USDA fdcId (fastest path — direct lookup).
   */
  async resolveByFdcId(fdcId: string): Promise<FoodDetail | null> {
    const cfg = getDatasetConfig();
    if (!cfg.usda.enabled) return null;

    try {
      return await usdaProvider.getFoodDetails(fdcId, cfg.usda.apiKey);
    } catch (err) {
      console.warn('[foodNutritionResolver] USDA fdcId lookup failed:', err);
      return null;
    }
  },

  /**
   * Resolve nutrition facts by barcode (EAN-13 / UPC).
   *
   * Primary: Open Food Facts (has strong barcode index).
   * Then: attempt USDA name match to upgrade macros to authoritative.
   */
  async resolveByBarcode(barcode: string): Promise<FoodDetail | null> {
    const cfg = getDatasetConfig();

    let offDetail: FoodDetail | null = null;
    if (cfg.openFoodFacts.enabled) {
      try {
        offDetail = await openFoodFactsProvider.getProductByBarcode(barcode);
      } catch (err) {
        console.warn('[foodNutritionResolver] OFF barcode lookup failed:', err);
      }
    }

    if (!offDetail) return null;

    // Try to upgrade macros to USDA if available.
    if (cfg.usda.enabled) {
      try {
        const usdaResults = await usdaProvider.searchFoods(offDetail.name, cfg.usda.apiKey, 1);
        if (usdaResults.length > 0) {
          const usdaDetail = await usdaProvider.getFoodDetails(usdaResults[0].id, cfg.usda.apiKey);
          return mergeFoodDetails(usdaDetail, offDetail);
        }
      } catch {
        // USDA upgrade failed — return OFF data with supplementary flag
      }
    }

    return offDetail;
  },

  /**
   * Extract a plain NutritionFacts object, asserting it is from USDA.
   * Throws if the detail is not USDA-authoritative and the caller requires it.
   */
  extractNutrition(detail: FoodDetail, requireAuthoritative = false): NutritionFacts {
    if (requireAuthoritative && !detail.source.authoritative) {
      throw new Error(
        `[foodNutritionResolver] Food "${detail.name}" from "${detail.source.providerName}" ` +
          'is not authoritative. USDA data is required for macro totals.',
      );
    }
    return detail.nutrition;
  },
};
