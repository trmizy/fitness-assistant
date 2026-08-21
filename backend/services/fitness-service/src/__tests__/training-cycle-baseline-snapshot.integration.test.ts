/**
 * Integration tests for the TrainingCycle.baselineMetrics/targetMetrics
 * snapshot wiring — these columns already existed in the schema
 * (20260721000000_adaptive_cycle_evaluation, comment: "deterministic
 * snapshot computed at cycle start") but nothing ever populated them before
 * this change. See cycle-baseline-snapshot.util.ts and
 * docs/body-state-and-adaptive-planning.md.
 *
 * Seeds real InBodyEntry/UserProfile rows directly into the actual
 * user-service dev database (via psql, cleaned up in test.after) for a
 * synthetic random userId — the live user-service process is queried over
 * real HTTP exactly as production code does, but no real user's data is
 * ever touched, and the TrainingCycle rows this test writes go to the
 * isolated *_test database, never gymcoach_fitness.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *   USER_SERVICE_URL="http://localhost:3004" \
 *   INTERNAL_SERVICE_SECRET="dev_internal_service_secret_change_in_production" \
 *     npx tsx --test src/__tests__/training-cycle-baseline-snapshot.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb =
  /(_test|postgres-test)/i.test(fitnessDatabaseUrl) &&
  !!process.env.USER_SERVICE_URL &&
  !!process.env.INTERNAL_SERVICE_SECRET;
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Set FITNESS_DATABASE_URL (to a *_test db), USER_SERVICE_URL and INTERNAL_SERVICE_SECRET to run this integration test",
};

// Same connection convention as docker-compose.dev.yml's user-service DATABASE_URL,
// just pointed at localhost since this runs from the host, not inside a container.
const USER_DB_URL =
  process.env.USER_DATABASE_URL ||
  "postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_user";

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/training-cycle.service");
    prisma = prismaModule.prisma;
    trainingCycleService = serviceModule.trainingCycleService;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService! };
}

// Direct seed/cleanup helpers against user-service's real DB — this is setup/teardown
// data, not a substitute for the UI/API action under test (that's still the real
// trainingCycleService.startCycle call, which makes real HTTP calls to the live
// user-service, exactly as production code does).
async function withUserDb<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({ connectionString: USER_DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedProfile(client: PgClient, userId: string, currentWeight: number | null, targetWeight: number | null) {
  await client.query(
    `INSERT INTO user_profiles (id, "userId", "currentWeight", "targetWeight", "updatedAt")
     VALUES ($1, $2, $3, $4, now())`,
    [randomUUID(), userId, currentWeight, targetWeight],
  );
}

async function seedInBody(client: PgClient, userId: string, weight: number, dateOnly: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO inbody_entries (id, user_id, date, date_only, weight, body_fat, muscle_mass, status, updated_at)
     VALUES ($1, $2, $3::date, $3::date, $4, 20, 30, 'manual', now())`,
    [id, userId, dateOnly, weight],
  );
  return id;
}

async function cleanupUser(userId: string) {
  await withUserDb(async (client) => {
    await client.query(`DELETE FROM inbody_entries WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_profiles WHERE "userId" = $1`, [userId]);
  });
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "startCycle: baselineMetrics snapshots the real InBody reading (not just profile.currentWeight), targetMetrics snapshots the goal",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();
    let cycleId: string | undefined;
    try {
      await withUserDb(async (client) => {
        // profile.currentWeight (80) is deliberately stale/different from the InBody
        // reading (78.2) — baselineMetrics must prefer the InBody reading.
        await seedProfile(client, userId, 80, 72);
        await seedInBody(client, userId, 78.2, "2026-08-17");
      });

      const cycle = await trainingCycleService.startCycle(userId, null, "2026-08-18", 28);
      cycleId = cycle.id;

      const baseline = cycle.baselineMetrics as any;
      assert.equal(baseline?.source, "INBODY");
      assert.equal(baseline?.weight, 78.2);

      const target = cycle.targetMetrics as any;
      assert.equal(target?.source, "GOAL_AT_CYCLE_START");
      assert.equal(target?.targetWeight, 72);
    } finally {
      if (cycleId) await prisma.trainingCycle.delete({ where: { id: cycleId } }).catch(() => {});
      await cleanupUser(userId);
    }
  },
);

test(
  "startCycle: no InBody history at all falls back to profile.currentWeight for baselineMetrics",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();
    let cycleId: string | undefined;
    try {
      await withUserDb(async (client) => {
        await seedProfile(client, userId, 65, 60);
      });

      const cycle = await trainingCycleService.startCycle(userId, null, "2026-08-18", 28);
      cycleId = cycle.id;

      assert.deepEqual(cycle.baselineMetrics, { source: "PROFILE_FALLBACK", weight: 65 });
      assert.deepEqual(cycle.targetMetrics, { source: "GOAL_AT_CYCLE_START", targetWeight: 60 });
    } finally {
      if (cycleId) await prisma.trainingCycle.delete({ where: { id: cycleId } }).catch(() => {});
      await cleanupUser(userId);
    }
  },
);

test(
  "startCycle: no profile and no InBody at all leaves baselineMetrics/targetMetrics null rather than crashing or fabricating data",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID(); // never seeded anywhere
    let cycleId: string | undefined;
    try {
      const cycle = await trainingCycleService.startCycle(userId, null, "2026-08-18", 28);
      cycleId = cycle.id;
      assert.equal(cycle.baselineMetrics, null);
      assert.equal(cycle.targetMetrics, null);
    } finally {
      if (cycleId) await prisma.trainingCycle.delete({ where: { id: cycleId } }).catch(() => {});
    }
  },
);

// Spec §46 equivalent: cycle 2's baseline is cycle 1's END weight, not the
// original journey start — the two cycles' baselineMetrics must genuinely
// differ, each capturing "what was true when THIS cycle began".
test(
  "cycle transition: a second cycle's baseline reflects the newer InBody reading at ITS start, not the first cycle's baseline",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();
    let cycle1Id: string | undefined;
    let cycle2Id: string | undefined;
    try {
      await withUserDb(async (client) => {
        await seedProfile(client, userId, 80, 72);
        await seedInBody(client, userId, 80, "2026-06-01"); // journey start
      });

      const cycle1 = await trainingCycleService.startCycle(userId, null, "2026-06-02", 28);
      cycle1Id = cycle1.id;
      assert.equal((cycle1.baselineMetrics as any)?.weight, 80);

      // Cycle 1 ends at 76.8 — a new InBody reading recorded after cycle 1's start.
      await withUserDb(async (client) => {
        await seedInBody(client, userId, 76.8, "2026-06-29");
      });
      await prisma.trainingCycle.update({
        where: { id: cycle1.id },
        data: { status: "COMPLETED", archivedAt: new Date() },
      });

      const cycle2 = await trainingCycleService.startCycle(userId, null, "2026-06-30", 28);
      cycle2Id = cycle2.id;

      assert.equal((cycle2.baselineMetrics as any)?.weight, 76.8);
      // The two cycles' baselines are genuinely distinct snapshots, not the same value re-read.
      assert.notEqual(
        (cycle1.baselineMetrics as any)?.weight,
        (cycle2.baselineMetrics as any)?.weight,
      );
    } finally {
      if (cycle2Id) await prisma.trainingCycle.delete({ where: { id: cycle2Id } }).catch(() => {});
      if (cycle1Id) await prisma.trainingCycle.delete({ where: { id: cycle1Id } }).catch(() => {});
      await cleanupUser(userId);
    }
  },
);
