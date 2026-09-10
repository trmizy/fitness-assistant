/**
 * Post-seed logging-mode classifier.
 *
 * Migrations can only backfill rows that already exist at migration time.
 * Curated catalog rows created later by seed/importers still need the same
 * deterministic correction for known loaded carries. Do not classify every
 * loaded HOLD as TIME_LOAD; many holds are static/isometric prescriptions.
 */
import { PrismaClient } from "../src/generated/prisma";
import { loadedCarryLoggingModeWhere } from "../src/utils/logging-mode-classifier";

const prisma = new PrismaClient();

export async function main() {
  const result = await prisma.exercise.updateMany({
    where: loadedCarryLoggingModeWhere(),
    data: { loggingMode: "TIME_LOAD" },
  });

  console.log(`Loaded-carry TIME_LOAD correction: ${result.count} row(s) updated.`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
