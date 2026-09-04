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
import axios from "axios";
import { conversationService } from "../services/conversation.service";
import { prisma, PlanStatus } from "../repositories/conversation.repository";
import { closeAiQueue } from "../workers/ai.queue";

const AUTH_SERVICE_URL =
  process.env.TEST_AUTH_SERVICE_URL ||
  (process.platform === "win32"
    ? "http://localhost:3001"
    : "http://auth-service:3001");
const FITNESS_SERVICE_URL =
  process.env.TEST_FITNESS_SERVICE_URL ||
  (process.platform === "win32"
    ? "http://localhost:3002"
    : process.env.FITNESS_SERVICE_URL || "http://fitness-service:3002");
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
const TEST_PASSWORD = "Test@123456";

test.after(async () => {
  await closeAiQueue();
  await prisma.$disconnect();
});

async function loginAndGetToken(email: string): Promise<{ userId: string; token: string }> {
  const res = await axios.post(`${AUTH_SERVICE_URL}/auth/login`, { email, password: TEST_PASSWORD });
  return { userId: res.data.user.id, token: res.data.accessToken };
}

async function setEquipment(token: string, slugs: string[]): Promise<void> {
  const catalogRes = await axios.get(`${FITNESS_SERVICE_URL}/equipment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const catalog: Array<{ id: string; slug: string }> = catalogRes.data.equipment;
  const ids = catalog.filter((e) => slugs.includes(e.slug)).map((e) => e.id);
  await axios.put(
    `${FITNESS_SERVICE_URL}/equipment/me`,
    { equipmentIds: ids },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

async function setAllActiveEquipment(token: string): Promise<void> {
  const catalogRes = await axios.get(`${FITNESS_SERVICE_URL}/equipment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const catalog: Array<{ id: string }> = catalogRes.data.equipment;
  await axios.put(
    `${FITNESS_SERVICE_URL}/equipment/me`,
    { equipmentIds: catalog.map((e) => e.id) },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

async function generateAndWaitForPlan(userId: string): Promise<any> {
  const { planId } = await conversationService.queuePlanGeneration({
    userId,
    goal: "MUSCLE_GAIN",
    durationWeeks: 4,
    daysPerWeek: 3,
    exercisesPerDay: 4,
    trainingLocation: "GYM", // deliberately the OLD coarse default — proves granular UserEquipment overrides it
    equipmentPreference: "MIXED_GYM",
  });

  const deadline = Date.now() + 170_000;
  while (Date.now() < deadline) {
    const plan = await prisma.workoutPlan.findUnique({ where: { id: planId } });
    if (plan?.status === PlanStatus.COMPLETED) return plan;
    if (plan?.status === PlanStatus.FAILED) throw new Error(`Plan generation FAILED for ${userId}`);
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

function exerciseCountIn(planContent: any): number {
  const schedule = planContent?.weeklySchedule ?? [];
  return schedule.flatMap((day: any) => day.exercises ?? []).length;
}

test(
  "Bodyweight persona (bodyweight + pull-up-bar only): 2 real generated plans pass the final equipment invariant validator",
  { timeout: 350_000 },
  async () => {
    const { userId, token } = await loginAndGetToken("testuser002@example.com");
    await setEquipment(token, ["bodyweight", "pull-up-bar"]);

    for (let i = 0; i < 2; i++) {
      const plan = await generateAndWaitForPlan(userId);
      assert.ok(exerciseCountIn(plan.plan) > 0, `run ${i}: expected a non-empty generated plan`);
      await assertPlanEquipmentValid(userId, plan);
    }

    await setEquipment(token, []); // leave the shared dev account as found
  },
);

test(
  "Home-gym persona (dumbbell/barbell/bench/rack/pull-up-bar/bands): 2 real generated plans pass the final equipment invariant validator",
  { timeout: 350_000 },
  async () => {
    const { userId, token } = await loginAndGetToken("testuser003@example.com");
    await setEquipment(token, ["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "resistance-band", "bodyweight"]);

    for (let i = 0; i < 2; i++) {
      const plan = await generateAndWaitForPlan(userId);
      assert.ok(exerciseCountIn(plan.plan) > 0, `run ${i}: expected a non-empty generated plan`);
      await assertPlanEquipmentValid(userId, plan);
    }

    await setEquipment(token, []); // leave the shared dev account as found
  },
);

test(
  "Commercial-gym persona (owns every active equipment item): 1 real generated plan passes the final equipment invariant validator",
  { timeout: 200_000 },
  async () => {
    const { userId, token } = await loginAndGetToken("testuser004@example.com");
    await setAllActiveEquipment(token);

    const plan = await generateAndWaitForPlan(userId);
    assert.ok(exerciseCountIn(plan.plan) > 0, "expected a non-empty generated plan");
    await assertPlanEquipmentValid(userId, plan);

    await setEquipment(token, []); // leave the shared dev account as found
  },
);
