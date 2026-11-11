/**
 * Curated everyday-food catalog for AI meal plans (src/data/everyday_foods.vi.json).
 *
 * Why: test/ai-quality-eval (2026-11-08, graded by a cross-family judge) found AI plans built from the raw USDA slice
 * ("Apples, dehydrated", "Wagyu seam fat, raw", "Puddings, dry mix") — every macro invariant passed, the food was not
 * something people eat. Each entry pins ONE existing USDA `Food` row by fdcId and only adds its Vietnamese display name
 * as a `FoodAlias` (language "vi", source "everyday_curated") plus a realistic per-meal portion cap. No nutrition number
 * is written: macros stay the USDA row's. `/internal/foods/for-ai-nutrition` returns these rows and ai-service prefers them.
 *
 * Idempotent: re-running creates nothing new; curated aliases no longer in the file are removed (other alias sources are
 * never touched). fdcIds missing from the database are reported, never invented.
 *
 * One implementation, two entry points: prisma/seed_everyday_foods.ts (CLI, local DBs) and the fitness jobs Lambda
 * (`{ "job": "seed-everyday-foods" }`, the only path into Aurora inside the VPC). The data lives under src/ so the build
 * puts it into dist/ — the Lambda artifact carries no prisma/ folder.
 */
import type { PrismaClient } from "../generated/prisma";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import catalog from "../data/everyday_foods.vi.json";

export const EVERYDAY_ALIAS_SOURCE = "everyday_curated";

export interface EverydayFood { vi: string; fdcId: number; group: string; maxG?: number }

export interface EverydayFoodsSeedResult {
  total: number;
  found: number;
  created: number;
  unchanged: number;
  /** existing same-meaning aliases (other importers) taken over as the curated display name */
  adopted: number;
  removedStale: number;
  portionCapsSet: number;
  missingFdcIds: number[];
}

export function everydayFoodsCatalog(): EverydayFood[] {
  return (catalog as { foods: EverydayFood[] }).foods;
}

export async function seedEverydayFoods(prisma: PrismaClient, foods: EverydayFood[] = everydayFoodsCatalog()): Promise<EverydayFoodsSeedResult> {
  const byFdc = new Map(foods.map((f) => [f.fdcId, f]));
  if (byFdc.size !== foods.length) throw new Error("duplicate fdcId in everyday_foods.vi.json");
  const rows = await prisma.food.findMany({ where: { fdcId: { in: [...byFdc.keys()] } }, select: { id: true, fdcId: true, realisticServingMaxG: true } });
  const missingFdcIds = [...byFdc.keys()].filter((id) => !rows.some((r) => r.fdcId === id));

  let created = 0, unchanged = 0, adopted = 0, portionCapsSet = 0;
  const keep = new Set<string>();
  for (const food of rows) {
    const entry = byFdc.get(food.fdcId!)!;
    // Realistic per-meal portion (grams) for these curated rows only — the Food column the AI meal builder already reads
    // (realisticServingCapG); without it rice/noodles were capped at the generic 250 g and a 2370 kcal day could not be met
    // from everyday foods, and the fat role filled up with 150 g of avocado per meal.
    if (entry.maxG && food.realisticServingMaxG !== entry.maxG) {
      await prisma.food.update({ where: { id: food.id }, data: { realisticServingMaxG: entry.maxG } });
      portionCapsSet++;
    }
    keep.add(`${food.id}|${entry.vi}`);
    const aliasNormalized = normalizeVietnamese(entry.vi);
    // An alias for the same food that is equal after normalization may already exist from another importer (the AWS DB had
    // food_aliases.vi.json rows; 2026-11-09 the first AWS run died on the (food_id, alias_normalized, language) unique key).
    // Adopt that row as the curated display name instead of inserting a duplicate; an exact alias from another source is
    // adopted too, otherwise the food would never be marked curated.
    const existing = await prisma.foodAlias.findFirst({ where: { foodId: food.id, language: "vi", OR: [{ alias: entry.vi }, { aliasNormalized }] } });
    if (existing) {
      if (existing.source === EVERYDAY_ALIAS_SOURCE && existing.alias === entry.vi) { unchanged++; continue; }
      await prisma.foodAlias.update({ where: { id: existing.id }, data: { alias: entry.vi, aliasNormalized, source: EVERYDAY_ALIAS_SOURCE } });
      adopted++;
      continue;
    }
    await prisma.foodAlias.create({ data: { foodId: food.id, alias: entry.vi, aliasNormalized, language: "vi", source: EVERYDAY_ALIAS_SOURCE } });
    created++;
  }
  const stale = (await prisma.foodAlias.findMany({ where: { source: EVERYDAY_ALIAS_SOURCE }, select: { id: true, foodId: true, alias: true } }))
    .filter((a) => !keep.has(`${a.foodId}|${a.alias}`));
  if (stale.length) await prisma.foodAlias.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  return { total: foods.length, found: rows.length, created, unchanged, adopted, removedStale: stale.length, portionCapsSet, missingFdcIds };
}
