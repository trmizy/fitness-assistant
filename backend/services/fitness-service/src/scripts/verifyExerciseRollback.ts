/**
 * Isolated proof that rollbackImportBatch()'s new "exercises" deletable
 * branch works correctly and its PUBLISHED-status safety guard actually
 * blocks a would-be-unsafe rollback. Creates its own throwaway STAGING
 * exercise (never touching the real 21-exercise import), rolls it back,
 * verifies it's gone; then creates a second one, promotes it to
 * PUBLISHED, and verifies rollback REFUSES to delete it.
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/verifyExerciseRollback.ts
 */
import { prisma } from "../repositories/prisma";
import { startImportBatch, rollbackImportBatch } from "../importers/import-cli.util";

async function main() {
  // Case 1: STAGING exercise -> rollback succeeds.
  const handle1 = await startImportBatch("rollback_exercise_test_staging", { dryRun: false, noMedia: false, report: false, reviewOnly: false });
  const staging = await prisma.exercise.create({
    data: {
      exerciseName: "__rollback_test_staging_exercise__",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "FULL_BODY",
      type: "PUSH",
      muscleGroupsActivated: [],
      instructions: "test",
      status: "STAGING",
    },
  });
  await handle1.record({ externalRef: "test-1", decision: "INSERTED", targetTable: "exercises", targetId: staging.id });
  await handle1.finish("COMPLETED");

  await rollbackImportBatch(handle1.batchId);
  const stillExists1 = await prisma.exercise.findUnique({ where: { id: staging.id } });
  console.log("Case 1 (STAGING): exists after rollback (expect false):", !!stillExists1);

  // Case 2: PUBLISHED exercise -> rollback must REFUSE.
  const handle2 = await startImportBatch("rollback_exercise_test_published", { dryRun: false, noMedia: false, report: false, reviewOnly: false });
  const published = await prisma.exercise.create({
    data: {
      exerciseName: "__rollback_test_published_exercise__",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "FULL_BODY",
      type: "PUSH",
      muscleGroupsActivated: [],
      instructions: "test",
      status: "STAGING",
    },
  });
  await handle2.record({ externalRef: "test-2", decision: "INSERTED", targetTable: "exercises", targetId: published.id });
  await handle2.finish("COMPLETED");
  // Simulate a human promoting it to PUBLISHED after import.
  await prisma.exercise.update({ where: { id: published.id }, data: { status: "PUBLISHED" } });

  let refused = false;
  try {
    await rollbackImportBatch(handle2.batchId);
  } catch (err: any) {
    refused = /Refusing to roll back/.test(err.message);
  }
  const stillExists2 = await prisma.exercise.findUnique({ where: { id: published.id } });
  console.log("Case 2 (PUBLISHED): rollback refused (expect true):", refused, "| still exists (expect true):", !!stillExists2);

  // Cleanup case 2's test row directly (bypassing the safety guard on
  // purpose, since this really is just test debris, not real content).
  await prisma.exercise.delete({ where: { id: published.id } });

  const passed = !stillExists1 && refused && !!stillExists2;
  console.log(JSON.stringify({ passed }));
  if (!passed) {
    console.error("EXERCISE ROLLBACK CHECK FAILED");
    process.exit(1);
  }
  console.log("EXERCISE ROLLBACK CHECK PASSED.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
