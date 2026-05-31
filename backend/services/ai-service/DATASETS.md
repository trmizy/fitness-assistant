# Dataset Integration — AI Service

This document describes all external datasets integrated into the AI service,
their purpose, authoritative status, configuration, and usage.

---

## 1. Dataset Summary

| Dataset | Type | Authoritative | Used For | Requires Key |
|---------|------|:---:|----------|:---:|
| USDA FoodData Central | REST API | **YES** | Calories, protein, carbs, fats | ✅ |
| Open Food Facts | REST API | No | Branded foods, barcodes, images | No |
| wger | REST API | No | Exercise catalog, metadata | No |
| free-exercise-db | Local JSON | No | Exercise seed / fallback | No |
| ExerciseDB | REST API (RapidAPI) | No | Large exercise catalog (optional) | ✅ |
| NHANES (CDC) | Local CSV | No | Analytics / demo only | No |
| Kaggle Datasets | Local CSV | No | Analytics / demo only | No |

---

## 2. Source of Truth Rule

**USDA FoodData Central is the single source of truth for all macro totals:**
- Calories (kcal)
- Protein (g)
- Carbohydrates (g)
- Fat (g)

When USDA data exists for a food, no other source may override these four values.
Open Food Facts may enrich non-macro fields (barcode, brand, image, ingredients).

This rule is enforced in `src/datasets/utils/sourceRanker.ts → mergeFoodDetails()`.

---

## 3. Provider Details

### USDA FoodData Central
- **URL:** https://fdc.nal.usda.gov
- **API docs:** https://fdc.nal.usda.gov/api-guide.html
- **License:** Public domain (U.S. government data)
- **Env var:** `USDA_API_KEY` (required — free registration)
- **Provider:** `src/datasets/providers/usda/usda.provider.ts`

### Open Food Facts
- **URL:** https://world.openfoodfacts.org
- **License:** Open Database License (ODbL)
  - You must attribute Open Food Facts if you republish or redistribute data.
  - Improvements must be shared back.
- **Env var:** `OPEN_FOOD_FACTS_ENABLED` (default: `true`)
- **Provider:** `src/datasets/providers/openfoodfacts/off.provider.ts`

### wger
- **URL:** https://wger.de
- **License:** AGPLv3
  - Server-side API consumption is fine for development and internal use.
  - If you distribute a modified version of wger itself, you must open-source it.
- **Env vars:** `WGER_ENABLED` (default: `true`), `WGER_BASE_URL`
- **Provider:** `src/datasets/providers/wger/wger.provider.ts`

### free-exercise-db
- **URL:** https://github.com/yuhonas/free-exercise-db
- **License:** MIT — commercial use allowed, no attribution required.
- **Env var:** `FREE_EXERCISE_DB_ENABLED` (default: `true`)
- **Data path:** `data/datasets/free-exercise-db/exercises.json`
- **Provider:** `src/datasets/providers/free-exercise-db/free-exercise.provider.ts`

### ExerciseDB ⚠️ OPTIONAL — LICENSE REVIEW REQUIRED
- **URL:** https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb
- **License:** RapidAPI Terms of Service + ExerciseDB terms
  - Free tier: ~50 requests/day — development only.
  - Commercial or production use requires a paid subscription.
  - GIF assets are hosted by ExerciseDB — check their terms before caching.
  - Attribution may be required.
- **Decision checklist before enabling:**
  - [ ] Review RapidAPI ToS: https://rapidapi.com/terms/
  - [ ] Review ExerciseDB listing terms on RapidAPI
  - [ ] Confirm your use case (personal/commercial/SaaS)
  - [ ] Confirm acceptable request volume
  - [ ] Decide whether to cache GIF URLs
- **Env vars:** `EXERCISEDB_ENABLED=true`, `EXERCISEDB_API_KEY=<rapidapi_key>`
- **Provider:** `src/datasets/providers/exercisedb/exercisedb.provider.ts`
- **Default:** Disabled.

### NHANES (CDC) — Analytics/Demo Only
- **URL:** https://www.cdc.gov/nchs/nhanes/
- **License:** U.S. public domain
- **⚠️ Restriction:** Must NOT be used as live nutrition truth. Analytics/demo/offline only.
- **Env var:** `NHANES_ENABLED=true` (default: `false`)
- **Data path:** `data/datasets/nhanes/`
- **Provider:** `src/datasets/providers/nhanes/nhanes.provider.ts`

### Kaggle Fitness Datasets — Analytics/Demo Only
- **URL:** https://www.kaggle.com/datasets
- **License:** Varies per dataset — check individual listings before use.
- **⚠️ Restriction:** Must NOT be used as live nutrition truth. Analytics/demo/offline only.
- **Env var:** `KAGGLE_DATASETS_ENABLED=true` (default: `false`)
- **Data path:** `data/datasets/kaggle/`
- **Provider:** `src/datasets/providers/kaggle/kaggle.provider.ts`

---

## 4. Environment Variables

```bash
# USDA (required for authoritative nutrition)
USDA_API_KEY=your_free_api_key

# Open Food Facts (public API, enabled by default)
OPEN_FOOD_FACTS_ENABLED=true

# wger (public API, enabled by default)
WGER_ENABLED=true
WGER_BASE_URL=https://wger.de/api/v2

# free-exercise-db (local seed, enabled by default)
FREE_EXERCISE_DB_ENABLED=true

# ExerciseDB (disabled by default — license review required)
EXERCISEDB_ENABLED=false
EXERCISEDB_API_KEY=

# Analytics/demo only (disabled by default)
NHANES_ENABLED=false
KAGGLE_DATASETS_ENABLED=false
```

---

## 5. Setup & Seed Scripts

```bash
# Populate local exercise data (free-exercise-db, ~870 exercises, MIT)
npm run seed:exercises

# Seed everything (currently runs seed:exercises)
npm run seed:datasets

# Import wger exercise catalog to local JSON cache
npm run import:wger

# Validate NHANES files are present (files must be downloaded manually)
npm run import:nhanes

# Scan Kaggle datasets directory
npm run import:kaggle
```

---

## 6. Architecture

```
src/datasets/
├── types/
│   └── index.ts              — FoodSearchItem, FoodDetail, NutritionFacts,
│                               ExerciseItem, SourceAttribution, etc.
├── utils/
│   ├── datasetConfig.ts      — Read env vars, provider registry
│   ├── httpClient.ts         — Axios wrapper with timeout/error handling
│   └── sourceRanker.ts       — USDA-wins merge logic, exercise deduplication
├── providers/
│   ├── usda/                 — USDA FoodData Central (authoritative)
│   ├── openfoodfacts/        — Open Food Facts (supplementary)
│   ├── wger/                 — wger exercise catalog (supplementary)
│   ├── free-exercise-db/     — Local exercise seed (supplementary)
│   ├── exercisedb/           — ExerciseDB (optional, disabled by default)
│   ├── nhanes/               — NHANES analytics loader (analytics_only)
│   └── kaggle/               — Kaggle dataset loaders (analytics_only)
├── services/
│   ├── foodSearchService.ts          — Unified food search (USDA first)
│   ├── foodNutritionResolverService.ts — Guaranteed USDA-authoritative macros
│   └── exerciseCatalogService.ts     — Unified exercise search
└── seed/
    ├── seedExercises.ts      — Download free-exercise-db to local cache
    ├── importWger.ts         — Import wger catalog to local cache
    ├── importNhanes.ts       — Validate NHANES files
    └── importKaggle.ts       — Scan Kaggle datasets
```

---

## 7. Usage Examples

### Resolve food nutrition (USDA authoritative)
```typescript
import { foodNutritionResolverService } from './src/datasets/services/foodNutritionResolverService';

const detail = await foodNutritionResolverService.resolveByName('chicken breast');
if (detail) {
  const { calories, proteinG, carbsG, fatG } = detail.nutrition;
  console.log(`${detail.name}: ${calories}kcal, ${proteinG}g protein`);
  console.log(`Authoritative: ${detail.source.authoritative}`); // true if USDA
}
```

### Search foods (USDA first, OFF fallback)
```typescript
import { foodSearchService } from './src/datasets/services/foodSearchService';

const results = await foodSearchService.search('salmon', 5);
// Returns USDA results when USDA_API_KEY is set
```

### Barcode lookup (OFF → upgrade with USDA)
```typescript
const detail = await foodNutritionResolverService.resolveByBarcode('5000112637922');
// Returns OFF branding/barcode + USDA macros merged in
```

### Search exercises
```typescript
import { exerciseCatalogService } from './src/datasets/services/exerciseCatalogService';

const result = await exerciseCatalogService.search('bicep curl', 10);
// Checks free-exercise-db first, then wger, then ExerciseDB if enabled
```

---

## 8. Testing

```bash
# Run dataset integration tests
npx tsx --test src/datasets/__tests__/datasets.test.ts
```

Tests cover:
- USDA beats Open Food Facts on macro totals
- Open Food Facts enriches branding without overriding USDA macros
- Normalized exercise search across multiple sources
- Disabled provider does not crash startup

---

## 9. Graceful Degradation

If a provider is disabled or unavailable:
- The app starts normally — no crash.
- Disabled USDA → food search falls back to Open Food Facts (macros are supplementary).
- Disabled wger → exercise search uses only the local seed.
- Disabled free-exercise-db (missing file) → a console warning is emitted; search returns empty.
- All providers log warnings to console, never throw unhandled rejections to the user.
