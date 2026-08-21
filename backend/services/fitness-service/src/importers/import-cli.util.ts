/**
 * Gate 5 — shared CLI + ImportBatch/ImportRecord bookkeeping for every real
 * importer built on top of the staging pipeline. Every importer in
 * src/importers/ uses this so `--dry-run`/`--limit`/`--resume`/`--report`/
 * `--rollback-batch`/`--review-only` behave identically across all of
 * them, rather than each importer reinventing its own flag parsing.
 */
import { prisma } from "../repositories/prisma";

export interface ImportCliOptions {
  dryRun: boolean;
  sourceVersion?: string;
  limit?: number;
  resume?: string;
  report: boolean;
  rollbackBatch?: string;
  noMedia: boolean;
  reviewOnly: boolean;
}

export function parseImportCliArgs(argv: string[]): ImportCliOptions {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  return {
    dryRun: has("--dry-run"),
    sourceVersion: get("--source-version"),
    limit: get("--limit") ? Number(get("--limit")) : undefined,
    resume: get("--resume"),
    report: has("--report"),
    rollbackBatch: get("--rollback-batch"),
    noMedia: has("--no-media"),
    reviewOnly: has("--review-only"),
  };
}

export type ImportDecisionKind =
  | "INSERTED"
  | "UPDATED"
  | "SKIPPED_DUPLICATE"
  | "REVIEW_QUEUED"
  | "ERROR";

export interface ImportRecordInput {
  externalRef: string;
  decision: ImportDecisionKind;
  targetTable?: string;
  targetId?: string;
  detail?: unknown;
}

export interface ImportRunHandle {
  batchId: string;
  dryRun: boolean;
  record(input: ImportRecordInput): Promise<void>;
  finish(status: "COMPLETED" | "FAILED"): Promise<void>;
}

/**
 * Starts a new ImportBatch and returns a handle for recording per-item
 * decisions as the importer processes its source data. In dry-run mode,
 * the batch and its records ARE still written (so a dry-run produces a
 * real, queryable report — the "impact report" the task requires before
 * any real import) but the importer's OWN target-table writes must be
 * skipped by the caller, not by this helper (this helper has no knowledge
 * of what table a given importer writes to).
 */
export async function startImportBatch(
  source: string,
  options: ImportCliOptions,
  checksum?: string,
): Promise<ImportRunHandle> {
  const batch = await prisma.importBatch.create({
    data: {
      source,
      sourceVersion: options.sourceVersion,
      dryRun: options.dryRun,
      status: "RUNNING",
      checksum,
    },
  });

  const counts = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    duplicate: 0,
    review: 0,
    error: 0,
  };

  return {
    batchId: batch.id,
    dryRun: options.dryRun,
    async record(input: ImportRecordInput) {
      await prisma.importRecord.create({
        data: {
          batchId: batch.id,
          externalRef: input.externalRef,
          decision: input.decision,
          targetTable: input.targetTable,
          targetId: input.targetId,
          detail: input.detail == null ? undefined : (input.detail as any),
        },
      });
      switch (input.decision) {
        case "INSERTED":
          counts.inserted++;
          break;
        case "UPDATED":
          counts.updated++;
          break;
        case "SKIPPED_DUPLICATE":
          counts.skipped++;
          counts.duplicate++;
          break;
        case "REVIEW_QUEUED":
          counts.review++;
          break;
        case "ERROR":
          counts.error++;
          break;
      }
    },
    async finish(status) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status,
          completedAt: new Date(),
          insertedCount: counts.inserted,
          updatedCount: counts.updated,
          skippedCount: counts.skipped,
          duplicateCount: counts.duplicate,
          reviewCount: counts.review,
          errorCount: counts.error,
        },
      });
    },
  };
}

export async function printBatchReport(batchId: string): Promise<void> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    console.error(`No such import batch: ${batchId}`);
    return;
  }
  const byDecision = await prisma.importRecord.groupBy({
    by: ["decision"],
    where: { batchId },
    _count: { _all: true },
  });
  console.log(`\n── Import Batch Report: ${batch.id} ──`);
  console.log(`Source: ${batch.source} (version: ${batch.sourceVersion ?? "n/a"})`);
  console.log(`Status: ${batch.status}${batch.dryRun ? " (DRY RUN — no writes committed)" : ""}`);
  console.log(`Started: ${batch.startedAt.toISOString()}  Completed: ${batch.completedAt?.toISOString() ?? "n/a"}`);
  console.log(
    `Inserted: ${batch.insertedCount}  Updated: ${batch.updatedCount}  Skipped/Duplicate: ${batch.skippedCount}  Review-queued: ${batch.reviewCount}  Errors: ${batch.errorCount}`,
  );
  console.log("By decision:", JSON.stringify(Object.fromEntries(byDecision.map((d) => [d.decision, d._count._all]))));
}

/**
 * Rolls back a REAL (non-dry-run) batch: deletes every row this batch
 * INSERTED (identified by targetTable/targetId — the rollback manifest
 * recorded at import time). Does NOT attempt to revert UPDATED rows
 * (would need a before/after snapshot this lean design doesn't keep) —
 * if an importer ever performs updates, it must implement its own
 * rollback path rather than relying on this generic one.
 */
export async function rollbackImportBatch(batchId: string): Promise<void> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    throw new Error(`No such import batch: ${batchId}`);
  }
  if (batch.dryRun) {
    console.log(`Batch ${batchId} was a dry run — nothing was actually written, nothing to roll back.`);
    return;
  }
  if (batch.status === "ROLLED_BACK") {
    console.log(`Batch ${batchId} was already rolled back.`);
    return;
  }

  const insertedRecords = await prisma.importRecord.findMany({
    where: { batchId, decision: "INSERTED", targetTable: { not: null }, targetId: { not: null } },
  });

  const deletable: Record<string, (id: string) => Promise<unknown>> = {
    exercise_aliases: (id) => prisma.exerciseAlias.delete({ where: { id } }),
    exercise_sources: (id) => prisma.exerciseSource.delete({ where: { id } }),
    exercise_equipment: (id) => prisma.exerciseEquipment.delete({ where: { id } }),
    exercise_muscles: (id) => prisma.exerciseMuscle.delete({ where: { id } }),
    food_aliases: (id) => prisma.foodAlias.delete({ where: { id } }),
    food_sources: (id) => prisma.foodSource.delete({ where: { id } }),
    // A whole Exercise row is only ever rollback-deletable when it is
    // STILL in STAGING/REVIEW_REQUIRED — never PUBLISHED (a promoted
    // exercise may already be referenced by real workout history, and
    // even if not, deleting a live-visible row is a materially different,
    // much more consequential action than undoing an unreviewed import).
    // The DB's own FK (RESTRICT on WorkoutExercise.exerciseId) is a
    // second, independent backstop against deleting anything actually in
    // use — this check exists so that failure is reported clearly by
    // this rollback rather than surfacing as a raw FK-violation error.
    exercises: async (id) => {
      const exercise = await prisma.exercise.findUnique({ where: { id }, select: { status: true } });
      if (!exercise) return; // already gone — fine, rollback is idempotent
      if (exercise.status === "PUBLISHED") {
        throw new Error(
          `Refusing to roll back exercise ${id}: it has been PUBLISHED since import — this is no longer a safe, purely-additive undo. Resolve manually (e.g. re-deprecate first).`,
        );
      }
      return prisma.exercise.delete({ where: { id } });
    },
    // Same PUBLISHED-guard reasoning as exercises above. RecipeIngredient
    // rows cascade-delete with their parent Recipe (onDelete: Cascade in
    // schema.prisma) — no separate rollback entry needed for them.
    recipes: async (id) => {
      const recipe = await prisma.recipe.findUnique({ where: { id }, select: { status: true } });
      if (!recipe) return;
      if (recipe.status === "PUBLISHED") {
        throw new Error(
          `Refusing to roll back recipe ${id}: it has been PUBLISHED since import — this is no longer a safe, purely-additive undo. Resolve manually.`,
        );
      }
      return prisma.recipe.delete({ where: { id } });
    },
  };

  let deleted = 0;
  let alreadyGone = 0;
  for (const rec of insertedRecords) {
    const deleteFn = rec.targetTable ? deletable[rec.targetTable] : undefined;
    if (!deleteFn || !rec.targetId) continue;
    try {
      await deleteFn(rec.targetId);
      deleted++;
    } catch (err: any) {
      if (err.code === "P2025") {
        alreadyGone++; // row already gone — fine, rollback is idempotent
        continue;
      }
      throw err;
    }
  }

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "ROLLED_BACK" } });
  console.log(`Rolled back batch ${batchId}: deleted ${deleted} rows (${alreadyGone} were already gone).`);
}
