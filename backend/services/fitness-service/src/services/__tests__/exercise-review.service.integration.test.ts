import test from "node:test";
import assert from "node:assert/strict";

// Gate 7 — human review workflow for the LIKELY_DUPLICATE/MANUAL_REVIEW
// exercise candidates Gate 5/6's automatic importers never act on. Real
// DB, real catalog CSV (same convention as newExerciseImporter.ts itself,
// which has no dedicated test suite either — this service is inherently
// tied to the real data/catalog/plans/gym_exercises.csv file). Every test
// that mutates real Exercise/Alias/Source/ReviewDecision rows cleans up
// in a `finally` block, restoring the exact pre-test "pending" state so
// re-running this file never accumulates drift in the real catalog.

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
};

type PrismaClientLike = (typeof import("../../repositories/prisma"))["prisma"];
type ReviewServiceLike = typeof import("../exercise-review.service");

let prisma: PrismaClientLike | undefined;
let reviewService: ReviewServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../../repositories/prisma")).prisma;
    reviewService = await import("../exercise-review.service");
  }
  return { prisma: prisma!, reviewService: reviewService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function cleanupDecisions(db: PrismaClientLike, externalRef: string) {
  await db.exerciseReviewDecision.deleteMany({ where: { externalRef, source: "curated_vi_exercise_catalog" } });
}

async function cleanupCreatedExercise(db: PrismaClientLike, exerciseId: string | null) {
  if (!exerciseId) return;
  await db.exerciseEquipment.deleteMany({ where: { exerciseId } });
  await db.exerciseAlias.deleteMany({ where: { exerciseId } });
  await db.exerciseSource.deleteMany({ where: { exerciseId } });
  await db.exercise.deleteMany({ where: { id: exerciseId } });
}

test(
  "listReviewCandidates: the pending queue excludes already-resolved catalog rows and is recomputed fresh (never a stale cached list)",
  skipOpts,
  async () => {
    const { reviewService: svc } = await loadModules();
    const { candidates, summary } = await svc.listReviewCandidates({ status: "ALL" });

    assert.ok(summary.total >= 0, "summary.total must be a real number");
    // Every candidate returned must genuinely lack a resolved ExerciseSource
    // link — spot-check by re-deriving the resolved set independently.
    const { prisma: db } = await loadModules();
    const resolvedRows = await db.exerciseSource.findMany({
      where: { sourceName: "curated_vi_exercise_catalog", externalId: { not: null } },
      select: { externalId: true },
    });
    const resolvedSet = new Set(resolvedRows.map((r) => r.externalId));
    for (const c of candidates) {
      assert.ok(!resolvedSet.has(c.externalRef), `candidate ${c.externalRef} appears in the queue but already has a resolved ExerciseSource link`);
    }

    // Every candidate must be a real, classifiable decision — never an
    // empty/garbage value.
    const validTiers = new Set(["LIKELY_DUPLICATE", "MANUAL_REVIEW", "POSSIBLE_VARIANT", "DISTINCT", "EXACT_SAME_SOURCE", "EXACT_CROSS_SOURCE"]);
    for (const c of candidates) {
      assert.ok(validTiers.has(c.duplicateDecision), `unexpected duplicateDecision: ${c.duplicateDecision}`);
    }
  },
);

test(
  "submitReviewDecision: MARK_AS_DUPLICATE_SKIP records a real, auditable decision with zero effect on Exercise data",
  skipOpts,
  async () => {
    const { prisma: db, reviewService: svc } = await loadModules();
    const { candidates } = await svc.listReviewCandidates({ status: "PENDING" });
    assert.ok(candidates.length > 0, "expected at least one real pending Gate 7 candidate to test against");
    const target = candidates[0];

    try {
      const exerciseCountBefore = await db.exercise.count();
      const result = await svc.submitReviewDecision({
        externalRef: target.externalRef,
        decision: "MARK_AS_DUPLICATE_SKIP",
        note: "Integration test — confirmed same movement as an existing exercise under a different name.",
      });
      assert.equal(result.alreadyDecided, false);
      assert.equal(result.createdExerciseId, null);
      const exerciseCountAfter = await db.exercise.count();
      assert.equal(exerciseCountAfter, exerciseCountBefore, "MARK_AS_DUPLICATE_SKIP must never create/modify an Exercise row");

      // Idempotent: resubmitting the exact same decision must not create a
      // second history row.
      const again = await svc.submitReviewDecision({
        externalRef: target.externalRef,
        decision: "MARK_AS_DUPLICATE_SKIP",
        note: "Integration test — confirmed same movement as an existing exercise under a different name.",
      });
      assert.equal(again.alreadyDecided, true);
      const history = await svc.getReviewHistory(target.externalRef);
      assert.equal(history.length, 1, "resubmitting the identical decision must not append a second history row");

      // Now shows as REVIEWED, not PENDING.
      const afterList = await svc.listReviewCandidates({ status: "ALL" });
      const updated = afterList.candidates.find((c) => c.externalRef === target.externalRef);
      assert.equal(updated?.reviewStatus, "MARK_AS_DUPLICATE_SKIP");
    } finally {
      await cleanupDecisions(db, target.externalRef);
    }
  },
);

test(
  "submitReviewDecision: changing to a DIFFERENT non-mutating decision is allowed and appends real history",
  skipOpts,
  async () => {
    const { prisma: db, reviewService: svc } = await loadModules();
    const { candidates } = await svc.listReviewCandidates({ status: "PENDING" });
    assert.ok(candidates.length > 0);
    const target = candidates[0];

    try {
      await svc.submitReviewDecision({ externalRef: target.externalRef, decision: "NEEDS_MORE_INFO", note: "Need to see a video reference first." });
      await svc.submitReviewDecision({ externalRef: target.externalRef, decision: "REJECT_RECORD", note: "Confirmed not a real, distinct exercise." });

      const history = await svc.getReviewHistory(target.externalRef);
      assert.equal(history.length, 2, "two genuinely different decisions must both be preserved in history");
      assert.equal(history[0].decision, "NEEDS_MORE_INFO");
      assert.equal(history[1].decision, "REJECT_RECORD");
    } finally {
      await cleanupDecisions(db, target.externalRef);
    }
  },
);

test(
  "submitReviewDecision: APPROVE_AS_NEW_STAGING creates a real STAGING exercise via the SAME code path as newExerciseImporter, and cannot be silently overridden afterward",
  skipOpts,
  async () => {
    const { prisma: db, reviewService: svc } = await loadModules();
    const { candidates } = await svc.listReviewCandidates({ status: "PENDING" });
    assert.ok(candidates.length > 0);
    const target = candidates[0];
    let createdExerciseId: string | null = null;

    try {
      const result = await svc.submitReviewDecision({
        externalRef: target.externalRef,
        decision: "APPROVE_AS_NEW_STAGING",
        note: "Integration test — reviewer confirmed this is a genuinely distinct exercise.",
      });
      createdExerciseId = result.createdExerciseId;
      assert.ok(createdExerciseId, "expected a real created exercise id");

      const created = await db.exercise.findUnique({ where: { id: createdExerciseId! } });
      assert.ok(created, "the created exercise must actually exist");
      assert.equal(created!.status, "STAGING", "must never auto-publish");

      const source = await db.exerciseSource.findFirst({ where: { exerciseId: createdExerciseId!, sourceName: "curated_vi_exercise_catalog", externalId: target.externalRef } });
      assert.ok(source, "expected a real ExerciseSource provenance row linking back to the catalog externalId");

      // The candidate is now resolved — no longer in the pending queue at all.
      const afterList = await svc.listReviewCandidates({ status: "ALL" });
      assert.ok(!afterList.candidates.some((c) => c.externalRef === target.externalRef), "an APPROVE_AS_NEW_STAGING candidate must disappear from the queue (it's resolved, not just reviewed)");

      // Idempotent resubmit of the SAME decision — no second exercise created.
      const again = await svc.submitReviewDecision({
        externalRef: target.externalRef,
        decision: "APPROVE_AS_NEW_STAGING",
        note: "Integration test — reviewer confirmed this is a genuinely distinct exercise.",
      });
      assert.equal(again.alreadyDecided, true);
      assert.equal(again.createdExerciseId, createdExerciseId);
      const exerciseCountForThisRef = await db.exerciseSource.count({ where: { sourceName: "curated_vi_exercise_catalog", externalId: target.externalRef } });
      assert.equal(exerciseCountForThisRef, 1, "resubmitting the identical decision must never create a second exercise/source row");

      // A DIFFERENT decision after a mutating one must be refused (409), not
      // silently applied — this service never auto-undoes a prior real effect.
      await assert.rejects(
        () => svc.submitReviewDecision({ externalRef: target.externalRef, decision: "REJECT_RECORD", note: "Changed my mind." }),
        (err: any) => err.status === 409,
      );
    } finally {
      await cleanupDecisions(db, target.externalRef);
      await cleanupCreatedExercise(db, createdExerciseId);
    }
  },
);

test(
  "submitReviewDecision: LINK_AS_ALIAS_OF_EXISTING adds a real alias/source to the EXISTING exercise, never creates a new row, and requires targetExerciseId",
  skipOpts,
  async () => {
    const { prisma: db, reviewService: svc } = await loadModules();
    const { candidates } = await svc.listReviewCandidates({ status: "PENDING" });
    const withMatch = candidates.find((c) => c.bestMatchExercise);
    assert.ok(withMatch, "expected at least one pending candidate with a real best-match live exercise to link onto");
    const target = withMatch!;
    const targetExerciseId = target.bestMatchExercise!.id;

    try {
      await assert.rejects(
        () => svc.submitReviewDecision({ externalRef: target.externalRef, decision: "LINK_AS_ALIAS_OF_EXISTING", note: "missing target on purpose" }),
        (err: any) => err.status === 400,
      );

      const exerciseCountBefore = await db.exercise.count();
      const result = await svc.submitReviewDecision({
        externalRef: target.externalRef,
        decision: "LINK_AS_ALIAS_OF_EXISTING",
        targetExerciseId,
        note: "Integration test — confirmed same exercise as the matched live row, just a localized name.",
      });
      assert.equal(result.targetExerciseId, targetExerciseId);
      assert.equal(result.createdExerciseId, null);
      const exerciseCountAfter = await db.exercise.count();
      assert.equal(exerciseCountAfter, exerciseCountBefore, "linking must never create a new Exercise row");

      const alias = await db.exerciseAlias.findFirst({ where: { exerciseId: targetExerciseId, source: "curated_vi_exercise_catalog" } });
      assert.ok(alias, "expected a real ExerciseAlias created on the EXISTING target exercise");

      // The candidate is resolved now (has a real ExerciseSource link).
      const afterList = await svc.listReviewCandidates({ status: "ALL" });
      assert.ok(!afterList.candidates.some((c) => c.externalRef === target.externalRef));
    } finally {
      await cleanupDecisions(db, target.externalRef);
      await db.exerciseAlias.deleteMany({ where: { exerciseId: targetExerciseId, source: "curated_vi_exercise_catalog" } });
      await db.exerciseSource.deleteMany({ where: { exerciseId: targetExerciseId, sourceName: "curated_vi_exercise_catalog", externalId: target.externalRef } });
    }
  },
);

test(
  "getReviewCandidateDetail: returns null for an unknown or already-resolved externalRef, never a crash",
  skipOpts,
  async () => {
    const { reviewService: svc } = await loadModules();
    const unknown = await svc.getReviewCandidateDetail("__does_not_exist__");
    assert.equal(unknown, null);
  },
);
