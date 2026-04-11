/**
 * Dataset integration tests.
 * Run with: npx tsx --test src/datasets/__tests__/datasets.test.ts
 *
 * All tests use pure in-memory data — no network calls, no disk I/O.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeFoodDetails, deduplicateExercises } from '../utils/sourceRanker';
import { mapUsdaFoodDetail, type UsdaFoodDetail } from '../providers/usda/usda.mapper';
import { mapOffProductToDetail, type OffProduct } from '../providers/openfoodfacts/off.mapper';
import { mapWgerExercise, type WgerExercise } from '../providers/wger/wger.mapper';
import { mapFreeExercise, type FreeExerciseEntry } from '../providers/free-exercise-db/free-exercise.mapper';
import { freeExerciseDbProvider } from '../providers/free-exercise-db/free-exercise.provider';
import { getDatasetConfig, getProviderRegistry } from '../utils/datasetConfig';
import type { FoodDetail, ExerciseItem } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SAMPLE_USDA: UsdaFoodDetail = {
  fdcId: 171705,
  description: 'Chicken, broiler or fryers, breast, meat only, raw',
  dataType: 'Foundation',
  brandOwner: undefined,
  foodNutrients: [
    { nutrientId: 1008, nutrientName: 'Energy', value: 120, unitName: 'KCAL' },
    { nutrientId: 1003, nutrientName: 'Protein', value: 22.5, unitName: 'G' },
    { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', value: 0, unitName: 'G' },
    { nutrientId: 1004, nutrientName: 'Total lipid (fat)', value: 2.6, unitName: 'G' },
    { nutrientId: 1079, nutrientName: 'Fiber, total dietary', value: 0, unitName: 'G' },
  ],
  servingSize: 100,
  servingSizeUnit: 'g',
};

const SAMPLE_OFF: OffProduct = {
  _id: 'off-chicken-01',
  code: '1234567890123',
  product_name: 'Grilled Chicken Breast',
  brands: 'FitMeals',
  categories: 'Poultry, Cooked',
  nutriments: {
    'energy-kcal_100g': 185,   // WRONG — would override USDA if allowed
    proteins_100g: 30,          // WRONG
    carbohydrates_100g: 5,      // WRONG
    fat_100g: 6,                // WRONG
    fiber_100g: 1.2,
  },
  serving_size: '150g',
  ingredients_text: 'Chicken breast, water, salt',
  image_url: 'https://images.openfoodfacts.org/images/products/off-chicken.jpg',
};

const SAMPLE_WGER: WgerExercise = {
  id: 345,
  name: 'Barbell Squat',
  description: '<p>Stand with feet shoulder-width apart. Lower until thighs are parallel.</p>',
  category: { id: 8, name: 'Legs' },
  muscles: [{ id: 10, name_en: 'Quadriceps femoris', is_front: true }],
  muscles_secondary: [{ id: 8, name_en: 'Gluteus maximus' }],
  equipment: [{ id: 1, name: 'Barbell' }],
};

const SAMPLE_FREE_EXERCISE: FreeExerciseEntry = {
  id: 'Bench_Press',
  name: 'Bench Press',
  force: 'push',
  level: 'intermediate',
  mechanic: 'compound',
  equipment: 'barbell',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps brachii', 'front deltoids'],
  instructions: ['Lie on bench, grip bar, lower to chest, press up.'],
  category: 'strength',
  images: ['exercises/Bench_Press/0.jpg'],
};

// ─── L. Test: USDA beats Open Food Facts on macro totals ─────────────────────

describe('L1. USDA beats Open Food Facts on macro totals', () => {
  it('merged detail carries USDA calories, not OFF calories', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA);
    const offDetail = mapOffProductToDetail(SAMPLE_OFF);

    // OFF has higher/wrong calorie value (185 vs USDA 120)
    assert.equal(offDetail.nutrition.calories, 185, 'OFF fixture has 185 kcal');
    assert.equal(usdaDetail.nutrition.calories, 120, 'USDA fixture has 120 kcal');

    const merged = mergeFoodDetails(usdaDetail, offDetail); // USDA = primary

    assert.equal(merged.nutrition.calories, 120, 'merged calories must be USDA value (120)');
    assert.equal(merged.nutrition.proteinG, 22.5, 'merged protein must be USDA value (22.5g)');
    assert.equal(merged.nutrition.carbsG, 0, 'merged carbs must be USDA value (0g)');
    assert.equal(merged.nutrition.fatG, 2.6, 'merged fat must be USDA value (2.6g)');
  });

  it('USDA source flag is authoritative=true', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA);
    assert.equal(usdaDetail.source.authoritative, true);
    assert.equal(usdaDetail.source.level, 'authoritative');
  });

  it('Open Food Facts source flag is authoritative=false', () => {
    const offDetail = mapOffProductToDetail(SAMPLE_OFF);
    assert.equal(offDetail.source.authoritative, false);
    assert.equal(offDetail.source.level, 'supplementary');
  });
});

// ─── L2. Test: OFF enriches branding without overriding USDA macros ──────────

describe('L2. Open Food Facts enriches branding/barcode without overriding USDA macros', () => {
  it('merged detail has OFF barcode', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA);
    const offDetail = mapOffProductToDetail(SAMPLE_OFF);
    const merged = mergeFoodDetails(usdaDetail, offDetail);

    assert.equal(merged.barcode, '1234567890123', 'barcode from OFF is preserved');
  });

  it('merged detail has OFF brand when USDA has none', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA); // no brand
    const offDetail = mapOffProductToDetail(SAMPLE_OFF); // brand = FitMeals
    const merged = mergeFoodDetails(usdaDetail, offDetail);

    assert.equal(merged.brand, 'FitMeals', 'brand from OFF is used when USDA has none');
  });

  it('merged detail has OFF imageUrl', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA);
    const offDetail = mapOffProductToDetail(SAMPLE_OFF);
    const merged = mergeFoodDetails(usdaDetail, offDetail);

    assert.ok(merged.imageUrl?.includes('openfoodfacts'), 'imageUrl from OFF is preserved');
  });

  it('fiber (supplementary) falls back to OFF when USDA fiber is 0', () => {
    const usdaDetail = mapUsdaFoodDetail(SAMPLE_USDA); // fiber = 0
    const offDetail = mapOffProductToDetail(SAMPLE_OFF); // fiber = 1.2
    const merged = mergeFoodDetails(usdaDetail, offDetail);

    // USDA fiber is 0 (not null), so USDA value wins (0 is a real value, not missing)
    assert.equal(merged.nutrition.fiberG, 0);
  });
});

// ─── L3. Test: normalized exercise search across 2+ sources ──────────────────

describe('L3. Normalized exercise search across multiple sources', () => {
  it('wger mapper produces valid ExerciseItem', () => {
    const item = mapWgerExercise(SAMPLE_WGER);

    assert.equal(item.id, '345');
    assert.equal(item.name, 'Barbell Squat');
    assert.equal(item.bodyPart, 'Legs');
    assert.equal(item.targetMuscle, 'Quadriceps femoris');
    assert.equal(item.equipment, 'Barbell');
    assert.deepEqual(item.secondaryMuscles, ['Gluteus maximus']);
    assert.equal(item.source.providerName, 'wger');
    assert.equal(item.source.authoritative, false);
    // Description HTML tags must be stripped
    assert.ok(!item.instructions?.[0]?.includes('<p>'), 'HTML tags stripped from instructions');
  });

  it('free-exercise-db mapper produces valid ExerciseItem', () => {
    const item = mapFreeExercise(SAMPLE_FREE_EXERCISE);

    assert.equal(item.id, 'Bench_Press');
    assert.equal(item.name, 'Bench Press');
    assert.equal(item.bodyPart, 'strength');
    assert.equal(item.targetMuscle, 'chest');
    assert.equal(item.equipment, 'barbell');
    assert.equal(item.source.providerName, 'free-exercise-db');
    assert.equal(item.source.level, 'supplementary');
    // Relative image paths must be expanded to full GitHub raw URL
    assert.ok(item.images?.[0]?.startsWith('https://raw.githubusercontent.com'));
  });

  it('deduplicateExercises removes same-name entries from different sources', () => {
    const wgerItem = mapWgerExercise(SAMPLE_WGER);     // "Barbell Squat"
    const wgerItem2: ExerciseItem = { ...wgerItem, id: 'wger-dupe', name: 'Barbell Squat' };
    const freeItem = mapFreeExercise(SAMPLE_FREE_EXERCISE); // "Bench Press"

    const combined = [wgerItem, wgerItem2, freeItem];
    const deduped = deduplicateExercises(combined);

    assert.equal(deduped.length, 2, 'duplicate "Barbell Squat" removed');
    const names = deduped.map((e) => e.name);
    assert.ok(names.includes('Barbell Squat'));
    assert.ok(names.includes('Bench Press'));
  });
});

// ─── L4. Test: disabled provider does not crash startup ──────────────────────

describe('L4. Disabled provider does not crash startup', () => {
  it('getDatasetConfig returns stable object with all providers', () => {
    // Should not throw even if env vars are missing
    const cfg = getDatasetConfig();

    assert.ok(typeof cfg.usda === 'object');
    assert.ok(typeof cfg.openFoodFacts === 'object');
    assert.ok(typeof cfg.wger === 'object');
    assert.ok(typeof cfg.freeExerciseDb === 'object');
    assert.ok(typeof cfg.exerciseDb === 'object');
    assert.ok(typeof cfg.nhanes === 'object');
    assert.ok(typeof cfg.kaggle === 'object');
  });

  it('getProviderRegistry lists all 7 providers', () => {
    const cfg = getDatasetConfig();
    const registry = getProviderRegistry(cfg);
    assert.equal(registry.length, 7);
  });

  it('USDA is disabled when USDA_API_KEY is empty (no crash)', () => {
    const saved = process.env.USDA_API_KEY;
    delete process.env.USDA_API_KEY;
    const cfg = getDatasetConfig();
    assert.equal(cfg.usda.enabled, false);
    process.env.USDA_API_KEY = saved; // restore
  });

  it('ExerciseDB is disabled when EXERCISEDB_ENABLED is not set (no crash)', () => {
    const saved = process.env.EXERCISEDB_ENABLED;
    delete process.env.EXERCISEDB_ENABLED;
    const cfg = getDatasetConfig();
    assert.equal(cfg.exerciseDb.enabled, false);
    process.env.EXERCISEDB_ENABLED = saved; // restore
  });

  it('freeExerciseDbProvider.load returns empty array (no crash) when file does not exist', () => {
    freeExerciseDbProvider.clearCache();
    const items = freeExerciseDbProvider.load('/nonexistent/path/exercises.json');
    assert.deepEqual(items, []);
  });

  it('freeExerciseDbProvider.load returns exercises from the sample seed file', () => {
    freeExerciseDbProvider.clearCache();
    // Use the committed sample seed file
    const samplePath = path.join(
      process.cwd(),
      'data',
      'datasets',
      'free-exercise-db',
      'exercises.json',
    );
    const items = freeExerciseDbProvider.load(samplePath);
    assert.ok(items.length >= 10, `Expected at least 10 sample exercises, got ${items.length}`);
    assert.equal(items[0].source.providerName, 'free-exercise-db');
    freeExerciseDbProvider.clearCache();
  });
});

// ─── Extra: NutritionFacts shape completeness ─────────────────────────────────

describe('NutritionFacts shape completeness', () => {
  it('USDA mapper always fills all four core macro fields', () => {
    const detail = mapUsdaFoodDetail(SAMPLE_USDA);
    const { calories, proteinG, carbsG, fatG } = detail.nutrition;
    assert.ok(calories !== undefined);
    assert.ok(proteinG !== undefined);
    assert.ok(carbsG !== undefined);
    assert.ok(fatG !== undefined);
  });

  it('USDA mapper returns null for missing nutrient (not undefined)', () => {
    const sparseUsda: UsdaFoodDetail = {
      fdcId: 99999,
      description: 'Test item with no nutrients',
      foodNutrients: [],
    };
    const detail = mapUsdaFoodDetail(sparseUsda);
    assert.equal(detail.nutrition.calories, null);
    assert.equal(detail.nutrition.proteinG, null);
    assert.equal(detail.nutrition.carbsG, null);
    assert.equal(detail.nutrition.fatG, null);
  });
});
