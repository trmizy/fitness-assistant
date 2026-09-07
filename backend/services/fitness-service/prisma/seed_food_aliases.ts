import path from "path";
import fs from "fs/promises";
import { PrismaClient } from "../src/generated/prisma";
import { normalizeVietnamese } from "../src/utils/normalizeVietnamese";

const prisma = new PrismaClient();

interface AliasSeedItem {
  alias: string;
  englishQuery: string;
}

const MAX_ALIASES_PER_TERM = 50;

// Found 2026-09-07, the first time this ran against a fully USDA-seeded
// database: a plain `take: 50` on an unordered query silently linked
// whichever 50 rows Postgres happened to return first for a broad term
// like "shrimp" (68 real matches) or "potato" (484) — often composite
// dishes ("Fast foods, shrimp, breaded and fried") or, worse, branded/
// infant-food rows, while the actual plain generic entry ("Shrimp, NFS",
// "Potato, NFS") never made the cut at all. Rank candidates the same way
// nutrition-food-suggestion.engine.ts's firstUsableFood does at query
// time — NFS (USDA's own "generic representative of this category"
// marker) first, branded/infant-food excluded, then shortest name — so
// the BEST rows are the ones that get linked when a term has more
// real matches than MAX_ALIASES_PER_TERM.
function isBrandedOrInfantFood(name: string): boolean {
  if (/^baby/i.test(name)) return true;
  const firstSegment = (name.split(",")[0] ?? name).trim();
  const hasLowercase = /[a-z]/.test(firstSegment);
  const upperCount = firstSegment.match(/[A-Z]/g)?.length ?? 0;
  return !hasLowercase && upperCount >= 2;
}

function rankCandidates<T extends { name: string }>(foods: T[]): T[] {
  const usable = foods.filter((f) => !isBrandedOrInfantFood(f.name));
  const pool = usable.length > 0 ? usable : foods;
  return [...pool].sort((a, b) => {
    const aNfs = /,\s*NFS$/i.test(a.name) ? 0 : 1;
    const bNfs = /,\s*NFS$/i.test(b.name) ? 0 : 1;
    if (aNfs !== bNfs) return aNfs - bNfs;
    return a.name.length - b.name.length;
  });
}

async function main() {
  const raw = await fs.readFile(
    path.join(__dirname, "data", "food_aliases.vi.json"),
    "utf-8",
  );
  const items = JSON.parse(raw) as AliasSeedItem[];

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const alias = item.alias.trim();
    const englishQuery = item.englishQuery.trim();
    if (!alias || !englishQuery) continue;

    // Fetch a much larger candidate pool than we'll actually link, purely
    // to rank from — MAX_ALIASES_PER_TERM real matches still means only
    // the best MAX_ALIASES_PER_TERM ever become aliases.
    const allMatches = await prisma.food.findMany({
      where: { name: { contains: englishQuery, mode: "insensitive" } },
      select: { id: true, name: true },
      take: 500,
    });
    const foods = rankCandidates(allMatches).slice(0, MAX_ALIASES_PER_TERM);

    console.log(
      `[seed] "${alias}" -> "${englishQuery}": ${foods.length}/${allMatches.length} foods`,
    );
    if (allMatches.length > 30) {
      console.warn(
        `[seed] WARNING: "${alias}" matched ${allMatches.length} foods — consider a more specific englishQuery`,
      );
    }

    for (const food of foods) {
      try {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias,
            aliasNormalized: normalizeVietnamese(alias),
            language: "vi",
            source: "manual_seed",
          },
        });
        created++;
      } catch (err: any) {
        if (err.code === "P2002") {
          skipped++;
          continue;
        }
        throw err;
      }
    }
  }

  console.log(
    `\n[seed] Done. Created: ${created}, skipped duplicate: ${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
