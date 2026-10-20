/**
 * FH-8 read-only backlog inventory: counts and amounts only (no ids, names, free text or secrets).
 *
 *   DATABASE_URL=... npx tsx scripts/fh8-inventory.ts [--stale-minutes=30]
 *
 * It only SELECTs, inside a READ ONLY transaction, so it is safe against any database; it prints the database NAME
 * (never the connection string) so the report says what it looked at.
 */
import { buildInventory, formatInventory } from '../src/services/obligations-inventory';

const arg = process.argv.slice(2).find((a) => a.startsWith('--stale-minutes='));
const staleMinutes = arg ? Math.max(1, Number.parseInt(arg.split('=')[1], 10) || 30) : 30;

buildInventory({ staleMinutes })
  .then(async (inv) => {
    for (const line of formatInventory(inv)) console.log(line);
    const { prisma } = await import('../src/repositories/prisma');
    await prisma.$disconnect();
  })
  .catch((e) => {
    console.error('FATAL', (e as Error).message);
    process.exit(3);
  });
