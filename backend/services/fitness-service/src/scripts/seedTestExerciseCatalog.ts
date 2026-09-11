/**
 * Test-only catalog seed entrypoint for the isolated docker-compose Postgres.
 *
 * It reuses the real fitness-service seed/import pipeline. No dev DB dump, no
 * internet, no developer-specific data.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { PrismaClient } from "../generated/prisma";

function redactUrl(url: string) {
  return url.replace(/:[^:@/]+@/, ":***@");
}

function assertTestDatabase(url: string) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Refusing to seed test catalog unless NODE_ENV=test");
  }
  if (!/(_test|postgres-test|localhost:55433)/i.test(url)) {
    throw new Error(`Refusing to seed non-test database: ${redactUrl(url)}`);
  }
  if (/gymcoach_fitness(\?|$)/i.test(url) && !/_test/i.test(url)) {
    throw new Error(`Refusing to seed developer/production fitness DB: ${redactUrl(url)}`);
  }
}

async function cleanupKnownTestExerciseResidue(url: string) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const userPrefixes = [
    "duration-schedule-it-",
    "distance-schedule-it-",
    "duration-recomplete-it-",
    "exgroup-",
    "idempotency-",
    "per-set-",
    "reschedule-",
    "undo-",
    "template-",
  ];
  const exercisePrefixes = [
    ...userPrefixes,
    "template-ex-",
    "template-ex2-",
    "template-ex3-",
    "template-ex4-",
  ];
  const userWhere = { OR: userPrefixes.map((prefix) => ({ userId: { startsWith: prefix } })) };
  const exerciseWhere = { OR: exercisePrefixes.map((prefix) => ({ id: { startsWith: prefix } })) };

  try {
    await prisma.workout.deleteMany({ where: userWhere });
    await prisma.workoutSchedule.deleteMany({ where: userWhere });
    await prisma.workoutProgram.deleteMany({ where: userWhere });
    await prisma.workoutProgramTemplate.deleteMany({ where: { OR: userPrefixes.map((prefix) => ({ createdByUserId: { startsWith: prefix } })) } });
    const deletedExercises = await prisma.exercise.deleteMany({ where: exerciseWhere });
    if (deletedExercises.count > 0) {
      console.log(`[catalog-test-seed] removed stale test exercise residue: ${deletedExercises.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
  assertTestDatabase(url);
  process.env.DATABASE_URL = url;

  const serviceRoot = path.resolve(__dirname, "../..");
  const tsxBin = path.join(
    serviceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.CMD" : "tsx",
  );

  console.log(`[catalog-test-seed] target=${redactUrl(url)}`);
  await cleanupKnownTestExerciseResidue(url);
  execFileSync(tsxBin, [path.join("prisma", "seed_all.ts")], {
    cwd: serviceRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
