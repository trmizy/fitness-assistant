import { httpGet } from '../../utils/httpClient';
import { mapOffProductToDetail, mapOffProductToSearchItem, type OffProduct } from './off.mapper';
import type { FoodDetail, FoodSearchItem } from '../../types';

interface OffSearchResponse {
  products: OffProduct[];
  count: number;
  page: number;
}

interface OffProductResponse {
  product: OffProduct;
  status: number;   // 1 = found, 0 = not found
  status_verbose: string;
}

const BASE_URL = 'https://world.openfoodfacts.org';

/**
 * Open Food Facts provider (SUPPLEMENTARY).
 *
 * This provider is used for:
 *   - Branded food lookups and barcode scanning
 *   - Ingredient text enrichment
 *   - Food images
 *
 * It is NOT authoritative for macro totals. When USDA data exists for the
 * same food, USDA calories/protein/carbs/fat always win.
 *
 * API: https://wiki.openfoodfacts.org/API
 * License: ODbL — attribution required if republishing data.
 */
export const openFoodFactsProvider = {
  /**
   * Text search via Open Food Facts.
   * Returns lightweight search items (no full nutrition breakdown).
   */
  async searchFoods(query: string, pageSize = 10): Promise<FoodSearchItem[]> {
    const data = await httpGet<OffSearchResponse>(
      `${BASE_URL}/cgi/search.pl`,
      {
        search_terms: query,
        json: true,
        page_size: pageSize,
        fields: '_id,code,product_name,brands,categories',
      },
    );

    return (data.products ?? []).map(mapOffProductToSearchItem);
  },

  /**
   * Fetch full product details including nutrition and barcode.
   * Use barcode (EAN-13 / UPC) as identifier.
   */
  async getProductByBarcode(barcode: string): Promise<FoodDetail | null> {
    const data = await httpGet<OffProductResponse>(
      `${BASE_URL}/api/v0/product/${barcode}.json`,
    );

    if (data.status !== 1 || !data.product) return null;
    return mapOffProductToDetail(data.product);
  },

  /**
   * Search and return full detail objects (slower — one detail call per item).
   * For most use cases, prefer searchFoods + getProductByBarcode instead.
   */
  async searchFoodsWithDetail(query: string, pageSize = 5): Promise<FoodDetail[]> {
    const data = await httpGet<OffSearchResponse>(
      `${BASE_URL}/cgi/search.pl`,
      {
        search_terms: query,
        json: true,
        page_size: pageSize,
        fields:
          '_id,code,product_name,brands,categories,nutriments,serving_size,ingredients_text,image_url',
      },
    );

    return (data.products ?? []).map(mapOffProductToDetail);
  },
};
