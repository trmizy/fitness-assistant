import path from 'path';
import fs from 'fs/promises';
import { PrismaClient } from '../src/generated/prisma';
import { normalizeVietnamese } from '../src/utils/normalizeVietnamese';

const prisma = new PrismaClient();

interface AliasSeedItem {
  alias: string;
  englishQuery: string;
}

async function main() {
  const raw = await fs.readFile(
    path.join(__dirname, 'data', 'food_aliases.vi.json'),
    'utf-8',
  );
  const items = JSON.parse(raw) as AliasSeedItem[];

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const alias = item.alias.trim();
    const englishQuery = item.englishQuery.trim();
    if (!alias || !englishQuery) continue;

    const foods = await prisma.food.findMany({
      where: { name: { contains: englishQuery, mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    });

    console.log(`[seed] "${alias}" -> "${englishQuery}": ${foods.length} foods`);
    if (foods.length > 30) {
      console.warn(`[seed] WARNING: "${alias}" matched ${foods.length} foods — consider a more specific englishQuery`);
    }

    for (const food of foods) {
      try {
        await prisma.foodAlias.create({
          data: {
            foodId: food.id,
            alias,
            aliasNormalized: normalizeVietnamese(alias),
            language: 'vi',
            source: 'manual_seed',
          },
        });
        created++;
      } catch (err: any) {
        if (err.code === 'P2002') {
          skipped++;
          continue;
        }
        throw err;
      }
    }
  }

  console.log(`\n[seed] Done. Created: ${created}, skipped duplicate: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
