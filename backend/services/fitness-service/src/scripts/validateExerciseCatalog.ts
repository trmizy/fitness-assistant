import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

export interface ExerciseCatalogMetrics {
  exerciseCount: number;
  sourcedExerciseCount: number;
  equipmentCount: number;
  exerciseEquipmentLinkCount: number;
  exerciseSourceCount: number;
  exerciseAliasCount: number;
  exerciseMuscleLinkCount: number;
  timeLoadCount: number;
  missingMovementPatternCount: number;
  missingEquipmentLinkCount: number;
  duplicateEquipmentSlugs: Array<{ slug: string; count: number }>;
  duplicateExerciseSources: Array<{ sourceName: string; externalId: string; count: number }>;
  duplicateExerciseAliases: number;
  duplicateExerciseMuscleLinks: number;
  duplicateExerciseEquipmentLinks: number;
  duplicateNormalizedNames: Array<{ normalizedName: string; count: number }>;
  orphanExerciseEquipmentLinks: number;
  invalidRequirementTypeCount: number;
  invalidMovementPatternCount: number;
}

const VALID_MOVEMENT_PATTERNS = [
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
  "HIP_EXTENSION",
  "HIP_ABDUCTION_ADDUCTION",
  "KNEE_EXTENSION",
  "KNEE_FLEXION",
  "ELBOW_FLEXION",
  "ELBOW_EXTENSION",
  "SHOULDER_ISOLATION",
  "CALF_RAISE",
  "CORE_FLEXION",
  "CORE_ROTATION",
  "CORE_ANTI_EXTENSION",
  "CARRY",
  "LOCOMOTION",
  "CARDIO",
  "MOBILITY",
  "OTHER",
];

export async function collectExerciseCatalogMetrics(): Promise<ExerciseCatalogMetrics> {
  const [
    exerciseCount,
    sourcedExerciseCount,
    equipmentCount,
    exerciseEquipmentLinkCount,
    exerciseSourceCount,
    exerciseAliasCount,
    exerciseMuscleLinkCount,
    timeLoadCount,
    missingMovementPatternCount,
    missingEquipmentLinkCount,
    duplicateEquipmentSlugs,
    duplicateExerciseSources,
    duplicateExerciseAliases,
    duplicateExerciseMuscleLinks,
    duplicateExerciseEquipmentLinks,
    duplicateNormalizedNames,
    orphanExerciseEquipmentLinks,
    invalidRequirementTypeCount,
    invalidMovementPatternCount,
  ] = await Promise.all([
    prisma.exercise.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(DISTINCT exercise_id)::bigint AS count
      FROM exercise_sources
    `,
    prisma.equipment.count(),
    prisma.exerciseEquipment.count(),
    prisma.exerciseSource.count(),
    prisma.exerciseAlias.count(),
    prisma.exerciseMuscle.count(),
    prisma.exercise.count({ where: { loggingMode: "TIME_LOAD" } }),
    prisma.exercise.count({ where: { sources: { some: {} }, movementPattern: null } }),
    prisma.exercise.count({ where: { sources: { some: {} }, equipmentLinks: { none: {} } } }),
    prisma.$queryRaw<Array<{ slug: string; count: bigint }>>`
      SELECT slug, count(*)::bigint AS count
      FROM equipment
      GROUP BY slug
      HAVING count(*) > 1
    `,
    prisma.$queryRaw<Array<{ source_name: string; external_id: string; count: bigint }>>`
      SELECT source_name, external_id, count(*)::bigint AS count
      FROM exercise_sources
      WHERE external_id IS NOT NULL
      GROUP BY source_name, external_id
      HAVING count(*) > 1
      ORDER BY count DESC, source_name ASC, external_id ASC
      LIMIT 25
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM (
        SELECT exercise_id, language, alias_normalized
        FROM exercise_aliases
        GROUP BY exercise_id, language, alias_normalized
        HAVING count(*) > 1
      ) dupes
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM (
        SELECT exercise_id, muscle_id, role
        FROM exercise_muscles
        GROUP BY exercise_id, muscle_id, role
        HAVING count(*) > 1
      ) dupes
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM (
        SELECT exercise_id, equipment_id
        FROM exercise_equipment
        GROUP BY exercise_id, equipment_id
        HAVING count(*) > 1
      ) dupes
    `,
    prisma.$queryRaw<Array<{ normalized_name: string; count: bigint }>>`
      SELECT lower(trim(regexp_replace(exercise_name, '[^a-zA-Z0-9]+', ' ', 'g'))) AS normalized_name,
             count(*)::bigint AS count
      FROM exercises
      WHERE EXISTS (
        SELECT 1 FROM exercise_sources es WHERE es.exercise_id = exercises.id
      )
      GROUP BY normalized_name
      HAVING count(*) > 1
      ORDER BY count DESC, normalized_name ASC
      LIMIT 25
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM exercise_equipment ee
      LEFT JOIN exercises e ON e.id = ee.exercise_id
      LEFT JOIN equipment eq ON eq.id = ee.equipment_id
      WHERE e.id IS NULL OR eq.id IS NULL
    `,
    prisma.exerciseEquipment.count({
      where: { requirementType: { notIn: ["REQUIRED", "ALTERNATIVE", "OPTIONAL"] } },
    }),
    prisma.exercise.count({
      where: {
        movementPattern: { not: null, notIn: VALID_MOVEMENT_PATTERNS },
      },
    }),
  ]);

  return {
    exerciseCount,
    sourcedExerciseCount: Number(sourcedExerciseCount[0]?.count ?? 0),
    equipmentCount,
    exerciseEquipmentLinkCount,
    exerciseSourceCount,
    exerciseAliasCount,
    exerciseMuscleLinkCount,
    timeLoadCount,
    missingMovementPatternCount,
    missingEquipmentLinkCount,
    duplicateEquipmentSlugs: duplicateEquipmentSlugs.map((r) => ({
      slug: r.slug,
      count: Number(r.count),
    })),
    duplicateExerciseSources: duplicateExerciseSources.map((r) => ({
      sourceName: r.source_name,
      externalId: r.external_id,
      count: Number(r.count),
    })),
    duplicateExerciseAliases: Number(duplicateExerciseAliases[0]?.count ?? 0),
    duplicateExerciseMuscleLinks: Number(duplicateExerciseMuscleLinks[0]?.count ?? 0),
    duplicateExerciseEquipmentLinks: Number(duplicateExerciseEquipmentLinks[0]?.count ?? 0),
    duplicateNormalizedNames: duplicateNormalizedNames.map((r) => ({
      normalizedName: r.normalized_name,
      count: Number(r.count),
    })),
    orphanExerciseEquipmentLinks: Number(orphanExerciseEquipmentLinks[0]?.count ?? 0),
    invalidRequirementTypeCount,
    invalidMovementPatternCount,
  };
}

export async function disconnectExerciseCatalogValidator() {
  await prisma.$disconnect();
}

function invalidReasons(metrics: ExerciseCatalogMetrics): string[] {
  const reasons: string[] = [];
  if (metrics.exerciseCount === 0) reasons.push("exerciseCount is 0");
  if (metrics.equipmentCount === 0) reasons.push("equipmentCount is 0");
  if (metrics.exerciseEquipmentLinkCount === 0) reasons.push("exerciseEquipmentLinkCount is 0");
  if (metrics.timeLoadCount < 3) reasons.push(`timeLoadCount is ${metrics.timeLoadCount}, expected at least 3`);
  if (metrics.missingMovementPatternCount > 0) reasons.push(`${metrics.missingMovementPatternCount} exercises miss movementPattern`);
  if (metrics.missingEquipmentLinkCount > 0) reasons.push(`${metrics.missingEquipmentLinkCount} exercises miss equipment links`);
  if (metrics.duplicateEquipmentSlugs.length > 0) reasons.push("duplicate equipment slugs exist");
  if (metrics.duplicateExerciseSources.length > 0) reasons.push("duplicate exercise source external ids exist");
  if (metrics.duplicateExerciseAliases > 0) reasons.push("duplicate exercise aliases exist");
  if (metrics.duplicateExerciseMuscleLinks > 0) reasons.push("duplicate exercise-muscle links exist");
  if (metrics.duplicateExerciseEquipmentLinks > 0) reasons.push("duplicate exercise-equipment links exist");
  if (metrics.orphanExerciseEquipmentLinks > 0) reasons.push("orphan exercise-equipment links exist");
  if (metrics.invalidRequirementTypeCount > 0) reasons.push("invalid requirementType values exist");
  if (metrics.invalidMovementPatternCount > 0) reasons.push("invalid movementPattern values exist");
  return reasons;
}

async function main() {
  const metrics = await collectExerciseCatalogMetrics();
  console.log(JSON.stringify(metrics, null, 2));
  const reasons = invalidReasons(metrics);
  if (process.argv.includes("--fail-on-invalid") && reasons.length > 0) {
    console.error("Exercise catalog validation failed:");
    for (const reason of reasons) console.error(`- ${reason}`);
    process.exit(1);
  }
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
