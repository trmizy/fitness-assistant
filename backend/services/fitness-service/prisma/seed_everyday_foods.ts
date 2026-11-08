/**
 * Seeds the curated everyday-food catalog for AI meal plans (prisma/data/everyday_foods.vi.json).
 *
 * Why: test/ai-quality-eval (2026-11-08, graded by a cross-family judge) found AI plans built from the raw USDA slice
 * ("Apples, dehydrated", "Wagyu seam fat, raw", "Puddings, dry mix") — every macro invariant passed, the food was not
 * something people eat. Each entry here pins ONE existing USDA `Food` row by fdcId and only adds its Vietnamese display
 * name as a `FoodAlias` (language "vi", source "everyday_curated"). No nutrition number is written: macros stay the
 * USDA row's. `/internal/foods/for-ai-nutrition` returns these rows (with the name) and ai-service prefers them.
 *
 * Idempotent: re-running creates nothing new; curated aliases no longer in the file are removed (other alias sources
 * are never touched). An fdcId missing from this database is reported and the run exits non-zero.
 * Usage (from backend/services/fitness-service): DATABASE_URL=... node node_modules/tsx/dist/cli.mjs prisma/seed_everyday_foods.ts
 */
import path from "path";
import fs from "fs";
import { PrismaClient } from "../src/generated/prisma";
import { normalizeVietnamese } from "../src/utils/normalizeVietnamese";

export const EVERYDAY_ALIAS_SOURCE = "everyday_curated";
const prisma = new PrismaClient();

interface EverydayFood { vi: string; fdcId: number; group: string; maxG?: number }

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "everyday_foods.vi.json"), "utf8")) as { foods: EverydayFood[] };
  const byFdc = new Map(spec.foods.map((f) => [f.fdcId, f]));
  if (byFdc.size !== spec.foods.length) throw new Error("duplicate fdcId in everyday_foods.vi.json");
  const rows = await prisma.food.findMany({ where: { fdcId: { in: [...byFdc.keys()] } }, select: { id: true, fdcId: true, name: true, realisticServingMaxG: true } });
  const missing = [...byFdc.keys()].filter((id) => !rows.some((r) => r.fdcId === id));

  let created = 0, unchanged = 0, capsSet = 0;
  const keep = new Set<string>();
  for (const food of rows) {
    const entry = byFdc.get(food.fdcId)!;
    // Realistic per-meal portion (grams) for these curated rows only — the Food column the AI meal builder already reads
    // (realisticServingCapG); without it rice/noodles were capped at the generic 250 g and a 2370 kcal day could not be met
    // from everyday foods, and the fat role filled up with 150 g of avocado per meal.
    if (entry.maxG && food.realisticServingMaxG !== entry.maxG) {
      await prisma.food.update({ where: { id: food.id }, data: { realisticServingMaxG: entry.maxG } });
      capsSet++;
    }
    keep.add(`${food.id}|${entry.vi}`);
    const existing = await prisma.foodAlias.findUnique({ where: { foodId_alias_language: { foodId: food.id, alias: entry.vi, language: "vi" } } });
    if (existing) { unchanged++; continue; }
    await prisma.foodAlias.create({ data: { foodId: food.id, alias: entry.vi, aliasNormalized: normalizeVietnamese(entry.vi), language: "vi", source: EVERYDAY_ALIAS_SOURCE } });
    created++;
  }
  const stale = (await prisma.foodAlias.findMany({ where: { source: EVERYDAY_ALIAS_SOURCE }, select: { id: true, foodId: true, alias: true } }))
    .filter((a) => !keep.has(`${a.foodId}|${a.alias}`));
  if (stale.length) await prisma.foodAlias.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  console.log(`[everyday-foods] ${rows.length}/${spec.foods.length} rows found · created ${created} · unchanged ${unchanged} · removed stale ${stale.length} · portion caps set ${capsSet}`);
  if (missing.length) {
    console.error(`[everyday-foods] fdcId not in this database: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
