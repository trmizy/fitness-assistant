import {
  PROTEIN_QUERIES,
  CARB_QUERIES,
  VEGETARIAN_QUERIES,
  firstUsableFood,
  usableFoodCandidates,
  macrosForQuantity,
  type BudgetLevel,
  type FoodSuggestionItem,
} from "./nutrition-food-suggestion.engine";
import { orderByRegionPriority, REGION_PREP_STYLE_VI, type VietnameseRegion } from "../config/vietnamese-region-food.config";

/**
 * AI Nutrition Cycle Engine (Gymini) — Smart Substitute variants (spec §XIV,
 * Production Hardening report §16 "remaining Smart Substitute variants").
 * `buildFoodSuggestions` (nutrition-food-suggestion.engine.ts) answers "what
 * should I eat"; this answers "I don't want/can't eat THIS specific item —
 * what else works instead". Same deterministic, no-LLM, same Food-catalog-
 * only design (spec §L) — a substitute request must never trigger an AI
 * call just to swap one ingredient.
 *
 * Four modes:
 *   REPLACE        — a different food, same role (protein/carb), same
 *                     budget tier, calorie-equivalent quantity.
 *   CHEAPER        — same role, forced to the LOW-budget pool regardless
 *                     of the user's own budget setting (an explicit "I
 *                     want the cheap option" ask overrides the default).
 *   HIGHER_PROTEIN — same role, but only ever offered for a PROTEIN-role
 *                     item (see inferRole below): a candidate whose
 *                     protein-per-100g is strictly higher than the current
 *                     item's, at the same calorie budget.
 *   VEGETARIAN     — same role, restricted to the vegetarian/vegan pool
 *                     (LACTO_OVO includes trứng, VEGAN excludes it) — only
 *                     offered for a PROTEIN-role item; a CARB-role item
 *                     (cơm, khoai...) is already vegetarian by default.
 *
 * Region (optional) reorders whichever pool applies by the user's regional
 * preference and adds a short, honest cooking-style note — see
 * vietnamese-region-food.config.ts for the research this is grounded in
 * and exactly what it does and doesn't claim about the nutrition numbers.
 */

export type SubstituteMode = "REPLACE" | "CHEAPER" | "HIGHER_PROTEIN" | "VEGETARIAN";
export type FoodRole = "PROTEIN" | "CARB";

export interface SubstituteRequest {
  currentFoodId?: string | null;
  currentFoodName: string;
  currentQuantityG: number;
  currentCalories: number;
  currentProtein: number;
  mode: SubstituteMode;
  budgetLevel: BudgetLevel;
  region?: VietnameseRegion | null;
  vegetarianMode?: "LACTO_OVO" | "VEGAN" | null;
  /** AI-coach agent action (2026-09-07, docs/agentic-fitness/01_NUTRITION_
   * AGENT_TOOLS_PLAN.md) — when set, the caller named a SPECIFIC
   * replacement ("tôi muốn ăn cá hồi thay ức gà" — cá hồi, not "an
   * alternative"), unlike every mode above which picks FOR the user from a
   * curated pool. Skips the pool search entirely and resolves this exact
   * food by name instead — still through the same Vietnamese alias-backed
   * catalog search (foodRepository.searchByName via firstUsableFood) and
   * the same calorie-equivalent quantity math below, so the result is
   * exactly as trustworthy as a pool-picked one; only candidate SELECTION
   * differs. `mode` is still recorded on the result for audit/explanation
   * but no longer drives which pool is searched when this is set. */
  desiredFoodName?: string | null;
}

export interface SubstituteResult {
  role: FoodRole;
  mode: SubstituteMode;
  candidates: FoodSuggestionItem[];
  note: string;
}

const NOT_APPLICABLE_NOTES: Record<string, string> = {
  "CARB.HIGHER_PROTEIN":
    "Món này thuộc nhóm tinh bột (carb) — Gymini không đề xuất \"nhiều đạm hơn\" cho nhóm này, hãy thử đổi món ở phần protein của bữa ăn.",
  "CARB.VEGETARIAN":
    "Món này thuộc nhóm tinh bột (carb), đã là món chay sẵn — không cần đổi.",
};

/** Protein-dominant if protein alone already accounts for a meaningful
 * share of the item's calories — otherwise treated as a carb-role item.
 * No food-category taxonomy exists in this catalog (see food.repository.
 * ts's own note on this), so role is always inferred from the item's own
 * macros, never a stored field.
 *
 * Threshold is 20%, not the more common "30% = high-protein food" rule —
 * found via real E2E verification against the seeded catalog: a plain
 * "Fish, catfish, NFS" entry (255kcal/13.5g protein per 100g, a fattier
 * preparation than e.g. tilapia) sits at 21%, and it's one of this
 * feature's own REGION_PROTEIN_PRIORITY foods (cá basa, the Miền Nam
 * priority protein) — at 30% it would have been misclassified as a CARB-
 * role item, so a real user's "cá basa" would get "no đổi món chay/nhiều
 * đạm hơn cho nhóm tinh bột" instead of a real answer. 20% still cleanly
 * separates every real carb-role food checked (rice ~8%, potato ~6%,
 * sweet potato ~6%) with a wide margin, so it isn't just chasing one
 * catfish row. */
export function inferFoodRole(currentCalories: number, currentProtein: number): FoodRole {
  if (currentCalories <= 0) return currentProtein > 0 ? "PROTEIN" : "CARB";
  const proteinCalorieShare = (currentProtein * 4) / currentCalories;
  return proteinCalorieShare >= 0.2 ? "PROTEIN" : "CARB";
}

function poolForProteinMode(req: SubstituteRequest): string[] {
  if (req.mode === "CHEAPER") return PROTEIN_QUERIES.LOW;
  if (req.mode === "VEGETARIAN") return [...VEGETARIAN_QUERIES[req.vegetarianMode ?? "LACTO_OVO"]];
  return PROTEIN_QUERIES[req.budgetLevel] ?? PROTEIN_QUERIES.NORMAL;
}

function poolForCarbMode(req: SubstituteRequest): string[] {
  if (req.mode === "CHEAPER") return CARB_QUERIES.LOW;
  return CARB_QUERIES[req.budgetLevel] ?? CARB_QUERIES.NORMAL;
}

function buildNote(region: VietnameseRegion | null | undefined): string {
  const base = "Lượng gợi ý đã quy đổi để giữ nguyên tổng calo của món cũ.";
  return region ? `${base} Gợi ý ${REGION_PREP_STYLE_VI[region]}.` : base;
}

/** Resolves up to `limit` distinct, usable candidates from a query pool,
 * excluding the current food (by id, falling back to name when no id is
 * known — e.g. a free-text NutritionLog item never had a real Food match). */
async function resolveDistinctCandidates(
  queries: string[],
  excludeFoodId: string | null | undefined,
  excludeFoodName: string,
  limit: number,
): Promise<any[]> {
  const excludeIds = new Set<string>(excludeFoodId ? [excludeFoodId] : []);
  const results: any[] = [];
  for (const query of queries) {
    if (results.length >= limit) break;
    const food = await firstUsableFood(query, excludeIds);
    if (!food) continue;
    if (food.name?.toLowerCase() === excludeFoodName.toLowerCase()) continue;
    excludeIds.add(food.id);
    results.push(food);
  }
  return results;
}

async function findHigherProteinCandidates(
  req: SubstituteRequest,
  queries: string[],
  limit: number,
): Promise<any[]> {
  const currentProteinPer100g =
    req.currentQuantityG > 0 ? (req.currentProtein / req.currentQuantityG) * 100 : req.currentProtein;
  const excludeIds = new Set<string>(req.currentFoodId ? [req.currentFoodId] : []);
  const pool: any[] = [];
  for (const query of queries) {
    const candidates = await usableFoodCandidates(query);
    for (const food of candidates) {
      if (excludeIds.has(food.id)) continue;
      if (food.name?.toLowerCase() === req.currentFoodName.toLowerCase()) continue;
      if ((food.protein ?? 0) <= currentProteinPer100g) continue; // must be a genuine improvement
      pool.push(food);
      excludeIds.add(food.id);
    }
  }
  pool.sort((a, b) => (b.protein ?? 0) - (a.protein ?? 0));
  return pool.slice(0, limit);
}

const MAX_CANDIDATES = 3;

export async function findFoodSubstitute(req: SubstituteRequest): Promise<SubstituteResult> {
  const role = inferFoodRole(req.currentCalories, req.currentProtein);

  if (req.desiredFoodName) {
    const excludeIds = new Set<string>(req.currentFoodId ? [req.currentFoodId] : []);
    const food = await firstUsableFood(req.desiredFoodName, excludeIds);
    if (!food) {
      return {
        role,
        mode: req.mode,
        candidates: [],
        note: `Không tìm thấy "${req.desiredFoodName}" trong danh mục món ăn hiện có.`,
      };
    }
    const rawQtyG = food.calories > 0 ? (req.currentCalories / food.calories) * 100 : req.currentQuantityG;
    const maxQtyG = food.realisticServingMaxG ?? 300;
    const quantityG = Math.max(20, Math.min(Math.round(rawQtyG / 10) * 10, maxQtyG));
    return {
      role,
      mode: req.mode,
      candidates: [{ foodId: food.id, foodName: food.name, quantityG, ...macrosForQuantity(food, quantityG) }],
      note: buildNote(req.region),
    };
  }

  if (role === "CARB" && (req.mode === "HIGHER_PROTEIN" || req.mode === "VEGETARIAN")) {
    return { role, mode: req.mode, candidates: [], note: NOT_APPLICABLE_NOTES[`CARB.${req.mode}`] };
  }

  let foods: any[];
  if (req.mode === "HIGHER_PROTEIN") {
    const basePool = PROTEIN_QUERIES[req.budgetLevel] ?? PROTEIN_QUERIES.NORMAL;
    foods = await findHigherProteinCandidates(req, orderByRegionPriority(basePool, req.region), MAX_CANDIDATES);
    if (foods.length === 0) {
      return {
        role,
        mode: req.mode,
        candidates: [],
        note: "Không tìm được món nào giàu đạm hơn trong danh mục hiện có — món hiện tại đã ở mức đạm khá tốt.",
      };
    }
  } else {
    const rawPool = role === "PROTEIN" ? poolForProteinMode(req) : poolForCarbMode(req);
    const pool = orderByRegionPriority(rawPool, req.region);
    foods = await resolveDistinctCandidates(pool, req.currentFoodId, req.currentFoodName, MAX_CANDIDATES);
  }

  const candidates: FoodSuggestionItem[] = foods.map((food) => {
    // Calorie-equivalent swap: keep the meal's calorie total roughly
    // stable when replacing one item, same principle buildFoodSuggestions
    // uses for its own items — never a fixed 100g default that would
    // silently change the meal's total.
    const rawQtyG = food.calories > 0 ? (req.currentCalories / food.calories) * 100 : req.currentQuantityG;
    const maxQtyG = food.realisticServingMaxG ?? 300;
    const quantityG = Math.max(20, Math.min(Math.round(rawQtyG / 10) * 10, maxQtyG));
    return {
      foodId: food.id,
      foodName: food.name,
      quantityG,
      ...macrosForQuantity(food, quantityG),
    };
  });

  return { role, mode: req.mode, candidates, note: buildNote(req.region) };
}
