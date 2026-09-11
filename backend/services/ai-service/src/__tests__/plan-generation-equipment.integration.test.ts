/**
 * Gym-onboarding project — end-to-end verification that a REAL generated
 * workout plan (real LLM call, real BullMQ job, real fitness-service
 * candidate fetch — the exact path a user hitting "Generate plan" goes
 * through) only ever contains equipment-compatible exercises.
 *
 * Hardening pass §10: kept as SMOKE tests, not a repetition drill —
 * 1-2 generations per persona plus a single commercial-gym run, each
 * checked against the new deterministic
 * /internal/exercises/validate-plan-equipment endpoint (the exact-set,
 * non-sampled final safety net wired into ai.worker.ts's completePlan —
 * see plan-equipment-validator.service.ts in fitness-service). This gives
 * much stronger assurance than more repetitions of the same shallow check
 * would: it exercises the REAL validator+repair path a production plan
 * goes through, not a parallel hand-rolled comparison.
 *
 * Uses pre-seeded test accounts (testuser002/003/004 — real accounts
 * already in the dev DB, avoids the OTP-gated registration flow) and calls
 * conversationService.queuePlanGeneration directly (the same function
 * plan.controller.ts's HTTP handler calls) rather than going through HTTP —
 * skips only the auth-token verification layer, not the actual generation
 * pipeline (queue → ai.worker.ts → fitness-service candidate fetch → LLM →
 * validation/repair → final equipment invariant check).
 *
 * Run with (inside the ai-service container):
 *   npx tsx --test src/__tests__/plan-generation-equipment.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { Client } from "pg";
import axios from "axios";
import { conversationService } from "../services/conversation.service";
import { prisma, PlanStatus } from "../repositories/conversation.repository";
import { closeAiQueue } from "../workers/ai.queue";
import { aiWorker } from "../workers/ai.worker";

const AI_DATABASE_URL = process.env.DATABASE_URL || "";
const FITNESS_DATABASE_URL =
  process.env.FITNESS_DATABASE_URL ||
  "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test?schema=public";
const FITNESS_SERVICE_URL =
  process.env.TEST_FITNESS_SERVICE_URL ||
  process.env.FITNESS_SERVICE_URL ||
  "http://localhost:4302";
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
process.env.FITNESS_SERVICE_URL = FITNESS_SERVICE_URL;

let fitnessServerProcess: ChildProcess | undefined;

test.after(async () => {
  if (fitnessServerProcess && !fitnessServerProcess.killed) {
    fitnessServerProcess.kill();
    await Promise.race([
      once(fitnessServerProcess, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  await cleanupLiveAiUsers();
  await cleanupLiveFitnessUsers();
  await aiWorker.close();
  await closeAiQueue();
  await prisma.$disconnect();
});

function assertSafeTestDatabase(urlValue: string, expectedDatabase: string): void {
  const url = new URL(urlValue);
  assert.equal(process.env.NODE_ENV, "test", "NODE_ENV must be test for live DB-backed suite");
  assert.equal(url.hostname, "localhost", "DB host must be isolated localhost test Postgres");
  assert.equal(url.port, "55433", "DB port must be isolated postgres-test port 55433");
  assert.equal(url.pathname.slice(1), expectedDatabase);
  assert.match(url.pathname, /_test/, "database name must include _test");
}

async function waitForFitnessServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await axios.get(`${FITNESS_SERVICE_URL}/health`, { timeout: 1000 });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for test fitness-service at ${FITNESS_SERVICE_URL}: ${String(lastError)}`);
}

test.before(async () => {
  assertSafeTestDatabase(AI_DATABASE_URL, "gymcoach_ai_test");
  assertSafeTestDatabase(FITNESS_DATABASE_URL, "gymcoach_fitness_test");
  await cleanupLiveAiUsers();
  await cleanupLiveFitnessUsers();

  if (!process.env.TEST_FITNESS_SERVICE_URL) {
    const repoRoot = path.resolve(process.cwd(), "../../..");
    const command = process.execPath;
    const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const fitnessServiceCwd = path.join(repoRoot, "backend", "services", "fitness-service");
    fitnessServerProcess = spawn(
      command,
      [tsxCli, "src/scripts/startTestHttpServer.ts"],
      {
        cwd: fitnessServiceCwd,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: FITNESS_DATABASE_URL,
          FITNESS_DATABASE_URL,
          FITNESS_DISABLE_REDIS: "true",
          INTERNAL_SERVICE_SECRET: INTERNAL_SECRET,
          PORT: new URL(FITNESS_SERVICE_URL).port || "4302",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    fitnessServerProcess.stdout?.on("data", (chunk) => process.stdout.write(String(chunk)));
    fitnessServerProcess.stderr?.on("data", (chunk) => process.stderr.write(String(chunk)));
  }

  await waitForFitnessServer();
});

async function withFitnessDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: FITNESS_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setEquipment(userId: string, slugs: string[]): Promise<void> {
  await withFitnessDb(async (client) => {
    await client.query("DELETE FROM user_equipment WHERE user_id = $1", [userId]);
    if (slugs.length === 0) return;
    const equipment = await client.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM equipment WHERE slug = ANY($1::text[])",
      [slugs],
    );
    assert.deepEqual(
      equipment.rows.map((row) => row.slug).sort(),
      [...slugs].sort(),
      "test equipment slugs must exist in isolated catalog",
    );
    for (const row of equipment.rows) {
      await client.query(
        "INSERT INTO user_equipment (id, user_id, equipment_id, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING",
        [randomUUID(), userId, row.id],
      );
    }
  });
}

async function cleanupLiveFitnessUsers(): Promise<void> {
  await withFitnessDb(async (client) => {
    await client.query(`
      DELETE FROM workout_sets
      WHERE workout_exercise_id IN (
        SELECT we.id
        FROM workout_exercises we
        JOIN workouts w ON w.id = we.workout_id
        WHERE w.user_id LIKE 'live-%'
      )
    `);
    await client.query(`
      DELETE FROM workout_exercises
      WHERE workout_id IN (SELECT id FROM workouts WHERE user_id LIKE 'live-%')
    `);
    await client.query("DELETE FROM workouts WHERE user_id LIKE 'live-%'");
    await client.query("DELETE FROM workout_schedules WHERE user_id LIKE 'live-%'");
    await client.query(`
      DELETE FROM workout_program_exercises
      WHERE program_day_id IN (
        SELECT wpd.id
        FROM workout_program_days wpd
        JOIN workout_programs wp ON wp.id = wpd.program_id
        WHERE wp.user_id LIKE 'live-%'
      )
    `);
    await client.query(`
      DELETE FROM workout_program_days
      WHERE program_id IN (SELECT id FROM workout_programs WHERE user_id LIKE 'live-%')
    `);
    await client.query("DELETE FROM workout_programs WHERE user_id LIKE 'live-%'");
    await client.query("DELETE FROM user_equipment WHERE user_id LIKE 'live-%'");
  });
}

async function cleanupLiveAiUsers(): Promise<void> {
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: "live-" } } });
}

async function setAllActiveEquipment(userId: string): Promise<void> {
  await withFitnessDb(async (client) => {
    await client.query("DELETE FROM user_equipment WHERE user_id = $1", [userId]);
    const equipment = await client.query<{ id: string }>("SELECT id FROM equipment WHERE active = true");
    for (const row of equipment.rows) {
      await client.query(
        "INSERT INTO user_equipment (id, user_id, equipment_id, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING",
        [randomUUID(), userId, row.id],
      );
    }
  });
}

async function generateAndWaitForPlan(userId: string): Promise<{ plan: any; durationMs: number }> {
  const startedAt = Date.now();
  const { planId } = await conversationService.queuePlanGeneration({
    userId,
    goal: "MUSCLE_GAIN",
    durationWeeks: 4,
    daysPerWeek: 2,
    exercisesPerDay: 3,
    trainingLocation: "GYM", // deliberately the OLD coarse default — proves granular UserEquipment overrides it
    equipmentPreference: "MIXED_GYM",
  });

  const deadline = Date.now() + 280_000;
  while (Date.now() < deadline) {
    const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });
    if (plan?.status === PlanStatus.COMPLETED) return { plan, durationMs: Date.now() - startedAt };
    if (plan?.status === PlanStatus.FAILED) throw new Error(`Plan generation FAILED for ${userId}: ${plan.failReason}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Plan generation timed out for ${userId}`);
}

/** Calls the SAME final-invariant endpoint ai.worker.ts's completePlan
 * already ran against this plan before persisting it — re-running it here
 * both (a) proves the plan that actually got saved is genuinely violation-
 * free, and (b) exercises the endpoint itself via a real integration path
 * rather than only via plan-equipment-validator.test.ts's direct unit
 * calls. */
async function assertPlanEquipmentValid(userId: string, plan: any): Promise<void> {
  const res = await axios.post(
    `${FITNESS_SERVICE_URL}/internal/exercises/validate-plan-equipment`,
    { weeklySchedule: plan.plan?.weeklySchedule ?? [] },
    { headers: { "x-internal-token": INTERNAL_SECRET, "x-user-id": userId } },
  );
  const { valid, violations, skippedNoUserEquipment } = res.data.data;
  assert.equal(skippedNoUserEquipment, false, "expected this test's persona to have real UserEquipment set");
  assert.equal(valid, true, `final-plan validator found violations: ${JSON.stringify(violations)}`);
}

function exerciseIdsIn(planContent: any): string[] {
  const schedule = planContent?.weeklySchedule ?? [];
  return schedule.flatMap((day: any) => (day.exercises ?? []).map((exercise: any) => String(exercise.exerciseId)));
}

function assertGeneratedSubsetOfTelemetryAllowlist(plan: any): void {
  const generatedIds = exerciseIdsIn(plan.plan);
  const telemetry = plan.plan?._metadata?.generationTelemetry ?? {};
  const allowedIds = new Set<string>(telemetry.candidateExerciseIds ?? []);
  assert.ok(allowedIds.size > 0, "DEBUG_AI_PLAN telemetry must include candidateExerciseIds for allowlist proof");
  for (const id of generatedIds) {
    assert.ok(allowedIds.has(id), `generated exerciseId ${id} must be in worker candidate allowlist`);
  }
}

async function persistPlanToFitness(userId: string, plan: any): Promise<{ persistedIds: string[]; durationMs: number }> {
  const startedAt = Date.now();
  const response = await axios.post(
    `${FITNESS_SERVICE_URL}/workouts/from-ai-plan`,
    {
      sourcePlanId: plan.id,
      sourcePlanVersion: plan.version,
      sourcePlanName: plan.name,
      goal: plan.goal,
      durationWeeks: plan.duration,
      daysPerWeek: plan.daysPerWeek,
      startDate: "2026-09-14",
      repeatWeeks: 1,
      selectedWeekdays: [1, 3],
      weeklySchedule: plan.plan.weeklySchedule,
      replaceExisting: true,
    },
    {
      headers: {
        "x-internal-token": INTERNAL_SECRET,
        "x-user-id": userId,
        "x-user-role": "CUSTOMER",
      },
      timeout: 30_000,
    },
  );
  assert.ok(
    response.status === 201 || response.status === 200,
    `unexpected fitness import status ${response.status}: ${JSON.stringify(response.data)}`,
  );

  const persistedIds = await withFitnessDb(async (client) => {
    const rows = await client.query<{ exercise_id: string }>(
      `SELECT wpe.exercise_id
       FROM workout_programs wp
       JOIN workout_program_days wpd ON wpd.program_id = wp.id
       JOIN workout_program_exercises wpe ON wpe.program_day_id = wpd.id
       WHERE wp.user_id = $1 AND wp.source_plan_id = $2
       ORDER BY wpd.day_number ASC, wpe."order" ASC`,
      [userId, plan.id],
    );
    return rows.rows.map((row) => row.exercise_id);
  });
  assert.deepEqual(persistedIds, exerciseIdsIn(plan.plan), "persisted WorkoutProgramExercise.exerciseId values must match generated canonical IDs");
  return { persistedIds, durationMs: Date.now() - startedAt };
}

function exerciseCountIn(planContent: any): number {
  const schedule = planContent?.weeklySchedule ?? [];
  return schedule.flatMap((day: any) => day.exercises ?? []).length;
}

test(
  "Bodyweight persona (bodyweight + pull-up-bar only): real generated plan passes the final equipment invariant validator",
  { timeout: 300_000 },
  async () => {
    const userId = `live-bodyweight-${Date.now()}`;
    try {
      await setEquipment(userId, ["bodyweight", "pull-up-bar"]);

      const { plan } = await generateAndWaitForPlan(userId);
      assert.ok(exerciseCountIn(plan.plan) > 0, "expected a non-empty generated plan");
      assertGeneratedSubsetOfTelemetryAllowlist(plan);
      await assertPlanEquipmentValid(userId, plan);
    } finally {
      await setEquipment(userId, []);
    }
  },
);

test(
  "Home-gym persona (dumbbell/barbell/bench/rack/pull-up-bar/bands): real generated plan passes the final equipment invariant validator",
  { timeout: 300_000 },
  async () => {
    const userId = `live-homegym-${Date.now()}`;
    try {
      await setEquipment(userId, ["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "resistance-band", "bodyweight"]);

      const { plan } = await generateAndWaitForPlan(userId);
      assert.ok(exerciseCountIn(plan.plan) > 0, "expected a non-empty generated plan");
      assertGeneratedSubsetOfTelemetryAllowlist(plan);
      await assertPlanEquipmentValid(userId, plan);
    } finally {
      await setEquipment(userId, []);
    }
  },
);

test(
  "Commercial-gym persona (owns every active equipment item): 1 real generated plan passes the final equipment invariant validator",
  { timeout: 300_000 },
  async () => {
    const userId = `live-fullgym-${Date.now()}`;
    try {
      await setAllActiveEquipment(userId);

      const { plan, durationMs } = await generateAndWaitForPlan(userId);
      assert.ok(exerciseCountIn(plan.plan) > 0, "expected a non-empty generated plan");
      assertGeneratedSubsetOfTelemetryAllowlist(plan);
      await assertPlanEquipmentValid(userId, plan);
      const persisted = await persistPlanToFitness(userId, plan);
      assert.ok(persisted.persistedIds.length > 0, "expected persisted canonical WorkoutProgramExercise ids");
      console.log(
        JSON.stringify({
          livePlanEvidence: {
            provider: process.env.LLM_PROVIDER,
            model: process.env.LLM_MODEL,
            planId: plan.id,
            generationDurationMs: durationMs,
            persistenceDurationMs: persisted.durationMs,
            generatedExerciseIds: exerciseIdsIn(plan.plan),
            persistedExerciseIds: persisted.persistedIds,
            candidateCount: plan.plan?._metadata?.generationTelemetry?.candidateCount,
            promptCandidateCount: plan.plan?._metadata?.generationTelemetry?.promptCandidateExerciseIds?.length,
          },
        }),
      );
    } finally {
      await setEquipment(userId, []);
    }
  },
);
