// ─── Authoritativeness levels ────────────────────────────────────────────────

/**
 * authoritative  → USDA only. Macro totals (calories, protein, carbs, fat)
 *                  from this source override all others.
 * supplementary  → Open Food Facts, wger, free-exercise-db, ExerciseDB.
 *                  Used for enrichment (branding, barcodes, exercise metadata).
 * analytics_only → NHANES, Kaggle. Never used in live nutrition responses.
 *                  Restricted to offline analytics / demo / testing.
 */
export type AuthoritativenessLevel =
  | 'authoritative'
  | 'supplementary'
  | 'analytics_only';

export interface SourceAttribution {
  providerName: string;
  sourceUrl?: string;
  authoritative: boolean;
  level: AuthoritativenessLevel;
}

export interface DatasetProviderMetadata {
  name: string;
  version?: string;
  level: AuthoritativenessLevel;
  enabled: boolean;
  baseUrl?: string;
  licenseNote?: string;
}

// ─── Food / Nutrition ────────────────────────────────────────────────────────

/**
 * Canonical nutrition shape used throughout the app.
 * All provider mappers must produce this shape.
 * When USDA data is present, its four core macro fields are the only truth.
 */
export interface NutritionFacts {
  calories: number | null;   // kcal
  proteinG: number | null;   // grams
  carbsG: number | null;     // grams
  fatG: number | null;       // grams
  fiberG?: number | null;    // grams (optional enrichment)
  servingSize?: number | null;
  servingUnit?: string | null;
}

export interface FoodSearchItem {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  dataType?: string;          // e.g. "Branded", "Foundation", "SR Legacy"
  source: SourceAttribution;
}

export interface FoodDetail extends FoodSearchItem {
  nutrition: NutritionFacts;
  barcode?: string;
  ingredients?: string;
  imageUrl?: string;
}

// ─── Exercise ────────────────────────────────────────────────────────────────

export interface ExerciseItem {
  id: string;
  name: string;
  bodyPart: string;
  targetMuscle: string;
  secondaryMuscles?: string[];
  equipment: string;
  level?: string;
  force?: string;
  mechanic?: string;
  category?: string;
  instructions?: string[];
  images?: string[];
  gifUrl?: string;
  source: SourceAttribution;
}

export interface ExerciseSearchResult {
  items: ExerciseItem[];
  total: number;
  sources: string[];
}
