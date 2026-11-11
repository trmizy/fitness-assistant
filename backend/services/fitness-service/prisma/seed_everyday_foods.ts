/**
 * CLI entry for the curated everyday-food catalog (logic + data: src/services/everyday-foods-seed.service.ts,
 * src/data/everyday_foods.vi.json). On AWS the same function runs as the fitness jobs Lambda job "seed-everyday-foods".
 * Usage (from backend/services/fitness-service): DATABASE_URL=... node node_modules/tsx/dist/cli.mjs prisma/seed_everyday_foods.ts
 * An fdcId missing from the database is reported and the run exits non-zero.
 */
import { PrismaClient } from "../src/generated/prisma";
import { seedEverydayFoods } from "../src/services/everyday-foods-seed.service";

export { EVERYDAY_ALIAS_SOURCE } from "../src/services/everyday-foods-seed.service";

const prisma = new PrismaClient();

seedEverydayFoods(prisma)
  .then((r) => {
    console.log(`[everyday-foods] ${r.found}/${r.total} rows found · created ${r.created} · adopted ${r.adopted} · unchanged ${r.unchanged} · removed stale ${r.removedStale} · portion caps set ${r.portionCapsSet}`);
    if (r.missingFdcIds.length) {
      console.error(`[everyday-foods] fdcId not in this database: ${r.missingFdcIds.join(", ")}`);
      process.exitCode = 1;
    }
  })
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
