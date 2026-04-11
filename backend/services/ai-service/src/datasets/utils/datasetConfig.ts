import path from 'node:path';
import type { DatasetProviderMetadata } from '../types';

export interface DatasetConfig {
  usda: {
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
  };
  openFoodFacts: {
    baseUrl: string;
    enabled: boolean;
  };
  wger: {
    baseUrl: string;
    enabled: boolean;
  };
  freeExerciseDb: {
    localPath: string;
    enabled: boolean;
  };
  exerciseDb: {
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
  };
  nhanes: {
    localPath: string;
    enabled: boolean;
  };
  kaggle: {
    localPath: string;
    enabled: boolean;
  };
}

/**
 * Build dataset configuration from environment variables.
 * All providers default to safe/enabled states except those requiring API keys.
 * If a provider is disabled or its key is missing, it will be skipped at runtime
 * without crashing the server.
 */
export function getDatasetConfig(): DatasetConfig {
  const root = process.cwd();
  const dataDir = path.join(root, 'data');

  return {
    usda: {
      apiKey: process.env.USDA_API_KEY ?? '',
      baseUrl: 'https://api.nal.usda.gov/fdc/v1',
      // USDA is enabled only when an API key is present.
      enabled: Boolean(process.env.USDA_API_KEY),
    },
    openFoodFacts: {
      baseUrl: 'https://world.openfoodfacts.org',
      // Enabled by default (public API, no key required).
      // Set OPEN_FOOD_FACTS_ENABLED=false to disable.
      enabled: process.env.OPEN_FOOD_FACTS_ENABLED !== 'false',
    },
    wger: {
      baseUrl: process.env.WGER_BASE_URL ?? 'https://wger.de/api/v2',
      // Enabled by default (public instance available).
      enabled: process.env.WGER_ENABLED !== 'false',
    },
    freeExerciseDb: {
      localPath: path.join(dataDir, 'datasets', 'free-exercise-db', 'exercises.json'),
      // Enabled by default — data file must exist locally after seeding.
      enabled: process.env.FREE_EXERCISE_DB_ENABLED !== 'false',
    },
    exerciseDb: {
      apiKey: process.env.EXERCISEDB_API_KEY ?? '',
      baseUrl: 'https://exercisedb.p.rapidapi.com',
      // Disabled by default — requires explicit opt-in AND a valid API key.
      // See DATASETS.md for license notes before enabling.
      enabled:
        process.env.EXERCISEDB_ENABLED === 'true' &&
        Boolean(process.env.EXERCISEDB_API_KEY),
    },
    nhanes: {
      localPath: path.join(dataDir, 'datasets', 'nhanes'),
      // Analytics/demo only. Disabled by default.
      enabled: process.env.NHANES_ENABLED === 'true',
    },
    kaggle: {
      localPath: path.join(dataDir, 'datasets', 'kaggle'),
      // Analytics/demo only. Disabled by default.
      enabled: process.env.KAGGLE_DATASETS_ENABLED === 'true',
    },
  };
}

/** Registry of all providers for observability / startup logging. */
export function getProviderRegistry(cfg: DatasetConfig): DatasetProviderMetadata[] {
  return [
    {
      name: 'USDA FoodData Central',
      level: 'authoritative',
      enabled: cfg.usda.enabled,
      baseUrl: cfg.usda.baseUrl,
      licenseNote: 'Public domain. API key required.',
    },
    {
      name: 'Open Food Facts',
      level: 'supplementary',
      enabled: cfg.openFoodFacts.enabled,
      baseUrl: cfg.openFoodFacts.baseUrl,
      licenseNote: 'ODbL. Supplementary enrichment only — do not override USDA macros.',
    },
    {
      name: 'wger',
      level: 'supplementary',
      enabled: cfg.wger.enabled,
      baseUrl: cfg.wger.baseUrl,
      licenseNote: 'AGPLv3. Exercise metadata and catalog.',
    },
    {
      name: 'free-exercise-db',
      level: 'supplementary',
      enabled: cfg.freeExerciseDb.enabled,
      licenseNote: 'MIT. Local seed dataset.',
    },
    {
      name: 'ExerciseDB',
      level: 'supplementary',
      enabled: cfg.exerciseDb.enabled,
      baseUrl: cfg.exerciseDb.baseUrl,
      licenseNote:
        'RapidAPI/ExerciseDB terms apply. Commercial use requires review. ' +
        'Disabled by default — see DATASETS.md before enabling.',
    },
    {
      name: 'NHANES',
      level: 'analytics_only',
      enabled: cfg.nhanes.enabled,
      licenseNote: 'CDC public data. Analytics/demo use only — never live nutrition truth.',
    },
    {
      name: 'Kaggle Fitness Datasets',
      level: 'analytics_only',
      enabled: cfg.kaggle.enabled,
      licenseNote:
        'License varies per dataset. Analytics/demo use only — never live nutrition truth.',
    },
  ];
}
