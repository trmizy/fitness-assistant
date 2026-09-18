/**
 * Preflight check for migration
 * `20260730020000_training_cycle_active_unique_constraint`.
 *
 * That migration is ALREADY APPLIED in every environment this migration
 * history has reached (dev, and any environment that has run
 * `prisma migrate deploy` since 2026-07-30) — this script does not run it
 * and does not modify it. It exists purely as a READ-ONLY preflight for any
 * environment where that migration has not yet been deployed (e.g. a fresh
 * production database, or a restored-from-backup environment that predates
 * it): the migration's own Step 1 auto-remediates duplicate ACTIVE
 * `TrainingCycle` rows per user (keeps the latest `start_date`, cancels the
 * rest) *before* creating the `training_cycles_one_active_per_user` partial
 * unique index, so the migration itself cannot fail on duplicates — but
 * that auto-remediation silently changes `status` on real rows the first
 * time it runs against a database that still has duplicates. Anyone
 * deploying migrations to a database for the first time should run this
 * script first and get a human decision on the reported rows BEFORE
 * `prisma migrate deploy`, rather than let the migration silently decide.
 *
 * This script makes NO writes. It only reports.
 *
 * Run (point DATABASE_URL at the target database first):
 *   npx tsx src/scripts/checkDuplicateActiveCycles.ts
 */
import { prisma } from "../repositories/prisma";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{ user_id: string; id: string; start_date: Date; created_at: Date; rn: bigint }>
  >`
    SELECT
      user_id,
      id,
      start_date,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY start_date DESC, created_at DESC
      ) AS rn
    FROM "training_cycles"
    WHERE status = 'ACTIVE' AND archived_at IS NULL
  `;

  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const duplicateUsers = [...byUser.entries()].filter(([, list]) => list.length > 1);

  if (duplicateUsers.length === 0) {
    console.log(
      "[checkDuplicateActiveCycles] OK: no user has more than one ACTIVE, non-archived training cycle. " +
        "Safe to deploy 20260730020000_training_cycle_active_unique_constraint (or already applied cleanly).",
    );
    return;
  }

  console.warn(
    `[checkDuplicateActiveCycles] FOUND ${duplicateUsers.length} user(s) with duplicate ACTIVE training cycles. ` +
      "If migration 20260730020000_training_cycle_active_unique_constraint has not yet been deployed to this " +
      "database, its Step 1 will auto-cancel every row below except the one with the latest start_date " +
      "(ties broken by created_at) for each user. Review before deploying:",
  );
  for (const [userId, list] of duplicateUsers) {
    const sorted = [...list].sort((a, b) => Number(a.rn) - Number(b.rn));
    console.warn(`  userId=${userId} — ${sorted.length} ACTIVE cycles:`);
    for (const row of sorted) {
      const outcome = Number(row.rn) === 1 ? "KEPT (latest)" : "WOULD BE CANCELLED";
      console.warn(
        `    cycleId=${row.id} startDate=${row.start_date.toISOString()} createdAt=${row.created_at.toISOString()} -> ${outcome}`,
      );
    }
  }
  console.warn(
    "[checkDuplicateActiveCycles] No rows were modified by this script. " +
      "Do not run the migration against this data without an explicit, reviewed decision.",
  );
}

main()
  .catch((error) => {
    console.error("[checkDuplicateActiveCycles] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
