/**
 * Everyday-meal eligibility for AI meal-plan foods.
 *
 * Found by test/ai-quality-eval (2026-11-08, REAL HTTP/API, Nova Pro; graded by a cross-family Claude Opus 4.6 judge):
 * plans for "dị ứng hải sản" and "ăn chay trứng sữa" scored correctness 1/5 because the deterministic builder ranks
 * candidates by macro density per kcal — over the ~900-row USDA slice from fitness-service that structurally puts
 * non-meal items first: "Apples, dehydrated", "Puddings, banana, dry mix", "Marmalade, orange", "Soy flour, defatted",
 * "Beef, Wagyu, seam fat, raw", "Margarine-like spread", "Salad dressing, mayonnaise, imitation", "Spinach dip".
 * Every invariant still passed (kcal/macros/exclusions), so only a human-level review could see it.
 *
 * This is a name-based screen applied once, right after the exclusion filter, so the LLM's food list, the role pools
 * and the invariant's allowedFoodIds all see the same set. It never empties the catalog: below MIN_EVERYDAY_FOODS
 * the unscreened set is kept (macro accuracy is a hard invariant; food realism is a preference).
 */
const NOT_A_MEAL_ITEM: RegExp[] = [
  // concentrated / not-ready forms
  /\b(dehydrated|dry mix|mix, dry|dry form|unprepared|not reconstituted|freeze-dried|concentrate)\b/i,
  // dry milk/egg/whey powders ("Milk, dry, nonfat"); "Oats, …, dry" / "Rice, …, raw" are normal weighed-dry staples
  /^(milk|buttermilk|egg|whey|cream)\b.*,\s*dry\b/i,
  /\b(flour|defatted)\b/i,
  // sweets, snacks, toppings and condiments rather than meal components
  /\b(puddings?|marmalade|jams?|jelly|preserves|toppings?|syrups?|frosting|icing|candied|sweetened condensed|pie filling)\b/i,
  /\b(chips|potato sticks|crisps|pies?|cakes?|cookies?|doughnuts?|pastry|pastries|brownies?|muffins?|croissants?|danish|ice cream|snacks?)\b/i,
  /\b(bars?|popcorn|pretzels|crackers|wafers|chocolate|coated|granola|candy|candies|gjetost|puffs|marshmallows?|frosted)\b/i,
  /^cereal, other\b/i,
  /\bflavored\b/i,
  // separated egg parts and processed meats (limit-advice foods, not a plan's default protein)
  /\b(yolk only|white only|egg substitute)\b/i,
  /\b(sausages?|bacon|hot dogs?|frankfurters?|bologna|salami|luncheon|pepperoni|jerky|wieners|franks|variety meats|by-products)\b/i,
  /^egg\b.*\braw\b/i,
  /\b(salad dressing|dressing|mayonnaise|dips?|spreads?|margarine|gravy|sauce|paste)\b/i,
  /\b(cream cheese|cheese, cream|cheese spread|cheese food|cheese product)\b/i,
  // trimmed fat, skin and offal-fat parts sold as such, not as meat
  /\b(seam fat|external fat|separable fat|intermuscular fat|subcutaneous fat|fatback|lard|tallow|suet|cracklings|skin only)\b/i,
  /\bskin \(/i,
  /,\s*skin\b(?!\s*(not|removed))/i,
  // raw meat, poultry and fish as served items
  /^(beef|pork|chicken|turkey|lamb|veal|duck|goose|game meat|fish|mollusks|crustaceans)\b.*\braw\b/i,
  // regional/traditional preparations outside the product's audience
  /\(alaska native\)|\bimported,\s*wagyu\b/i,
];
/** Branded processed products ("Cereals ready-to-eat, MALT-O-MEAL, Crispy Rice", "QUAKER") — a brand in capitals. */
const BRANDED = /\b[A-Z][A-Z'&-]{3,}\b/;

export function isEverydayMealFood(name: string): boolean {
  const n = String(name ?? "");
  if (!n.trim()) return false;
  if (BRANDED.test(n)) return false;
  return !NOT_A_MEAL_ITEM.some((re) => re.test(n));
}

export const MIN_EVERYDAY_FOODS = 40;

/**
 * Catalog tiers for one plan, most realistic first. `curated` = fitness-service's curated everyday foods (real USDA rows with
 * a Vietnamese name, prisma/seed_everyday_foods.ts) — the screen above could only REMOVE odd rows, and the live catalog lacks
 * everyday fat sources (no cooking oil), so in live runs it always fell back (2026-11-08). Each tier is a superset of the
 * previous one, so a template drafted from the first tier's list stays valid on every later tier.
 */
export const MIN_CURATED_FOODS = 25;
export function catalogTiers<T extends { name: string; curated?: boolean }>(foods: T[]): Array<{ label: "curated" | "everyday" | "full"; foods: T[] }> {
  const curated = foods.filter((f) => f.curated);
  const everyday = foods.filter((f) => f.curated || isEverydayMealFood(f.name));
  const tiers: Array<{ label: "curated" | "everyday" | "full"; foods: T[] }> = [];
  if (curated.length >= MIN_CURATED_FOODS) tiers.push({ label: "curated", foods: curated });
  if (everyday.length >= MIN_EVERYDAY_FOODS && everyday.length < foods.length && everyday.length > curated.length) tiers.push({ label: "everyday", foods: everyday });
  tiers.push({ label: "full", foods });
  return tiers;
}

type PlanItemLike = { foodId?: string; name: string; sourceName?: string };
/**
 * Display names: a curated food's Vietnamese name replaces the USDA name AFTER every check has run; the USDA name is kept in
 * `sourceName` (identity stays `foodId`, macros stay the USDA row's, and exclusion checks read both names).
 */
export function withVietnameseDisplayNames<C extends { weeklySchedule: Array<{ meals: Array<{ items: PlanItemLike[] }> }> }>(
  content: C, foods: Array<{ id: string; viName?: string | null }>,
): C {
  const vi = new Map(foods.filter((f) => f.viName).map((f) => [String(f.id), String(f.viName)]));
  if (!vi.size) return content;
  return {
    ...content,
    weeklySchedule: content.weeklySchedule.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        items: meal.items.map((item) => {
          const name = item.foodId ? vi.get(String(item.foodId)) : undefined;
          return name && name !== item.name ? { ...item, sourceName: item.sourceName ?? item.name, name } : item;
        }),
      })),
    })),
  };
}

/** The everyday subset when it is large enough to build a plan from, otherwise the input unchanged. */
export function preferEverydayFoods<T extends { name: string }>(foods: T[]): { foods: T[]; screened: boolean; removed: number } {
  const everyday = foods.filter((f) => isEverydayMealFood(f.name));
  return everyday.length >= MIN_EVERYDAY_FOODS
    ? { foods: everyday, screened: true, removed: foods.length - everyday.length }
    : { foods, screened: false, removed: 0 };
}
