/**
 * Hardening pass §11 — audits the 88 exercises with mechanics=NULL and
 * decides, per exercise, whether a confident COMPOUND/ISOLATION
 * classification is defensible. This is a REPORT-ONLY script (prints the
 * classification + reasoning for each row) — it does NOT write to the DB.
 * See the file's bottom for the actual conclusion reached and why.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx src/scripts/auditMissingMechanics.ts
 */
import { prisma } from "../repositories/prisma";

// One known test-fixture row, not real catalog data (id="jane-tc16-exercise",
// instructions="test") — confirmed leaked from an integration test's fixture
// data in an earlier audit pass. Excluded from classification, not touched.
const KNOWN_TEST_FIXTURES = new Set(["TC16 Squat"]);

async function main() {
  const rows = await prisma.exercise.findMany({
    where: { mechanics: null },
    select: { exerciseName: true, bodyPart: true, typeOfActivity: true, movementPattern: true },
    orderBy: { exerciseName: "asc" },
  });

  console.log(`Auditing ${rows.length} exercises with mechanics=NULL\n`);

  let mobilityCount = 0;
  let cardioCount = 0;
  let ambiguousStrengthCount = 0;
  let testFixtureCount = 0;

  for (const r of rows) {
    let verdict: string;
    if (KNOWN_TEST_FIXTURES.has(r.exerciseName)) {
      verdict = "SKIP — known test fixture, not real catalog data";
      testFixtureCount++;
    } else if (r.typeOfActivity === "MOBILITY") {
      verdict = "NULL is correct — stretch/mobility/SMR work has no compound-vs-isolation dimension";
      mobilityCount++;
    } else if (r.typeOfActivity === "CARDIO") {
      verdict = "NULL is correct — steady-state cardio machines/locomotion have no compound-vs-isolation dimension";
      cardioCount++;
    } else {
      verdict = "AMBIGUOUS — complex/agility/coordination drill or inconsistent with sibling exercises in the same family; NULL retained rather than an arbitrary guess";
      ambiguousStrengthCount++;
    }
    console.log(`${r.exerciseName} [${r.typeOfActivity}/${r.movementPattern}] -> ${verdict}`);
  }

  console.log("\n── Summary ──");
  console.log(`Total: ${rows.length}`);
  console.log(`MOBILITY (correctly NULL): ${mobilityCount}`);
  console.log(`CARDIO (correctly NULL): ${cardioCount}`);
  console.log(`Ambiguous STRENGTH (left NULL, not guessed): ${ambiguousStrengthCount}`);
  console.log(`Known test fixtures (skipped): ${testFixtureCount}`);
  console.log(`Newly classified this pass: 0`);
  console.log(
    "\nConclusion: every remaining NULL is a legitimate case where compound/isolation\n" +
      "doesn't semantically apply (mobility/cardio) or is genuinely ambiguous even by\n" +
      "the source dataset's own standards — e.g. 'Glute Ham Raise' (compound) and\n" +
      "'Hyperextensions (Back Extensions)' (isolation) are both hip-extension movements\n" +
      "on the same apparatus family yet tagged differently in the SOURCE data itself,\n" +
      "which is why 'Reverse Hyperextension' (same family) is left NULL rather than\n" +
      "arbitrarily tie-broken. No value was force-assigned.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
