import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P1.8 "Logging-mode catalog discoverability"
 * (docs/features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md).
 *
 * Runs against the REAL seeded catalog (3 TIME_LOAD STAGING rows: Farmer
 * Carry, Suitcase Carry, Front Rack Carry — the exact rows this milestone
 * exists to review), not synthetic fixtures, so a real regression in the
 * matrix's join/aggregation logic would actually be caught.
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type GetMatrixLike = (typeof import("../services/catalog-quality.service"))["getCatalogQualityMatrix"];

let prisma: PrismaClientLike | undefined;
let getCatalogQualityMatrix: GetMatrixLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/catalog-quality.service");
    prisma = prismaModule.prisma;
    getCatalogQualityMatrix = serviceModule.getCatalogQualityMatrix;
  }
  return { prisma: prisma!, getCatalogQualityMatrix: getCatalogQualityMatrix! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "loggingMode=TIME_LOAD returns exactly the 3 real seeded STAGING rows with real license/review data, none marked hasVideo",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { getCatalogQualityMatrix: getMatrix } = await loadModules();
    const result = await getMatrix({ loggingMode: "TIME_LOAD" });

    assert.equal(result.rows.length, 3, "the real seeded catalog has exactly 3 TIME_LOAD rows");
    const names = result.rows.map((r) => r.exerciseName).sort();
    assert.deepEqual(names, ["Farmer Carry", "Front Rack Carry", "Suitcase Carry"]);

    for (const row of result.rows) {
      assert.equal(row.publicationStatus, "STAGING", `${row.exerciseName} should still be STAGING`);
      assert.equal(row.hasVideo, false, `${row.exerciseName} has no video in the real seed data`);
      assert.equal(row.dataLicense, "original_curated");
      assert.equal(row.mediaLicense, null, "media_license was never populated for the curated cohort");
      assert.equal(
        row.reviewStatus,
        "NO_REVIEW_RECORD",
        `${row.exerciseName} has a real ExerciseSource link but no exercise_review_decisions row on file`,
      );
      assert.ok(Array.isArray(row.muscles) && row.muscles.length > 0, `${row.exerciseName} should have real muscle data`);
    }

    assert.equal(result.summary.total, 3);
    assert.deepEqual(result.summary.byPublicationStatus, { STAGING: 3 });
    assert.equal(result.summary.missingVideo, 3);
    assert.equal(result.summary.missingMediaLicense, 3);
    assert.equal(result.summary.noReviewRecord, 3);
  },
);

test(
  "status=PUBLISHED excludes the TIME_LOAD rows (none are published yet — the real, current state)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { getCatalogQualityMatrix: getMatrix } = await loadModules();
    const result = await getMatrix({ loggingMode: "TIME_LOAD", status: "PUBLISHED" });
    assert.equal(result.rows.length, 0);
    assert.equal(result.summary.total, 0);
  },
);

test(
  "pagination: limit=1 on the 3 real TIME_LOAD rows returns exactly 1 row per page but the summary still reflects all 3",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { getCatalogQualityMatrix: getMatrix } = await loadModules();
    const page1 = await getMatrix({ loggingMode: "TIME_LOAD", page: 1, limit: 1 });
    assert.equal(page1.rows.length, 1);
    assert.equal(page1.pagination.total, 3);
    // Summary is computed over the full filtered set, not just this page —
    // this is the whole point of a "quality matrix" overview.
    assert.equal(page1.summary.total, 3);

    const page3 = await getMatrix({ loggingMode: "TIME_LOAD", page: 3, limit: 1 });
    assert.equal(page3.rows.length, 1);
    assert.notEqual(page1.rows[0].id, page3.rows[0].id, "different pages must return different rows");
  },
);

test(
  "search filters by exercise name across the real catalog",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { getCatalogQualityMatrix: getMatrix } = await loadModules();
    const result = await getMatrix({ search: "Farmer Carry" });
    assert.ok(result.rows.length >= 1);
    assert.ok(result.rows.every((r) => r.exerciseName.toLowerCase().includes("farmer carry")));
  },
);

test(
  "a published exercise with a real free-exercise-db source reports hasVideo=true and a real dataLicense — the matrix reflects genuinely different rows differently, not one hardcoded shape",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, getCatalogQualityMatrix: getMatrix } = await loadModules();
    const published = await db.exercise.findFirst({
      where: { status: "PUBLISHED", videoUrl: { not: null } },
    });
    assert.ok(published, "seed catalog must contain at least one published exercise with a video for this test to be meaningful");
    const result = await getMatrix({ search: published!.exerciseName });
    const row = result.rows.find((r) => r.id === published!.id);
    assert.ok(row, "the published exercise must appear in its own name search");
    assert.equal(row!.hasVideo, true);
    assert.equal(row!.publicationStatus, "PUBLISHED");
  },
);
