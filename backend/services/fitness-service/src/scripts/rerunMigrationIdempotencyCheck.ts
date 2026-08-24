/**
 * Gate 8/13 idempotency proof — re-executes the raw SQL of
 * 20260819020000_add_exercise_muscle_provenance_schema/migration.sql a
 * SECOND time directly (bypassing prisma's "already applied" tracking,
 * which would normally just skip it) to prove the SQL itself is safe to
 * re-run: every CREATE is IF NOT EXISTS, every FK/index add is wrapped in
 * a duplicate_object-tolerant DO block, the muscle seed uses ON CONFLICT
 * DO NOTHING, and the snapshot backfill's WHERE clause only touches
 * still-null rows. Confirms row counts are UNCHANGED after a second run.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/rerunMigrationIdempotencyCheck.ts
 */
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { prisma } from "../repositories/prisma";

async function counts() {
  return {
    muscles: await prisma.muscle.count(),
    exerciseSources: await prisma.exerciseSource.count(),
    exerciseAliases: await prisma.exerciseAlias.count(),
    exerciseMuscles: await prisma.exerciseMuscle.count(),
    foodSources: await prisma.foodSource.count(),
    recipes: await prisma.recipe.count(),
    workoutExercisesWithSnapshot: await prisma.workoutExercise.count({ where: { exerciseNameSnapshot: { not: null } } }),
  };
}

async function main() {
  const before = await counts();

  const sqlPath = path.resolve(
    process.cwd(),
    "prisma/migrations/20260819020000_add_exercise_muscle_provenance_schema/migration.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf-8");
  // Prisma's $executeRawUnsafe rejects multi-statement scripts ("cannot
  // insert multiple commands into a prepared statement") — this migration
  // file has many. A plain pg.Client's simple-query protocol handles a
  // full multi-statement script exactly like psql would, which is what
  // this idempotency proof actually needs.
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  try {
    await pgClient.query(sql);
  } finally {
    await pgClient.end();
  }

  const after = await counts();

  const diffs = Object.keys(before).filter(
    (k) => (before as any)[k] !== (after as any)[k],
  );

  console.log(JSON.stringify({ before, after, diffs }, null, 2));
  if (diffs.length > 0) {
    console.error("IDEMPOTENCY CHECK FAILED — re-running the migration changed row counts:", diffs);
    process.exit(1);
  }
  console.log("IDEMPOTENCY CHECK PASSED — re-running the migration SQL produced zero new/changed rows.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
