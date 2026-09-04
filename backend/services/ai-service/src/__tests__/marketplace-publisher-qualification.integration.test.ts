/**
 * Coverage for the "phần 1 2 4" marketplace follow-up:
 *   - publishPlan/republishVersion now require the publisher to have
 *     actually completed a training cycle on the plan themselves
 *     (marketplaceDeps.hasCompletedCycleForPlan) before it can be listed.
 *   - publishedPlan.publisherIsVerifiedPt is set from the caller's role
 *     (forwarded from the gateway's x-user-role header).
 *   - adoptPlan accepts an optional customizedWeeklySchedule (trim/adjust
 *     only, no invented exercises, same day-count) and records
 *     planAdoption.wasCustomized accordingly.
 *
 * Real DB (ai-service has no separate *_test database — same accepted
 * constraint as every other integration test in this file's neighborhood).
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/__tests__/marketplace-publisher-qualification.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { marketplaceService, marketplaceDeps } from "../services/marketplace.service";
import { PlanStatus } from "../generated/prisma";

const originalHasCompletedCycleForPlan = marketplaceDeps.hasCompletedCycleForPlan;
const originalFetchPtMarketplaceEligibility = marketplaceDeps.fetchPtMarketplaceEligibility;

test.after(async () => {
  marketplaceDeps.hasCompletedCycleForPlan = originalHasCompletedCycleForPlan;
  marketplaceDeps.fetchPtMarketplaceEligibility = originalFetchPtMarketplaceEligibility;
  await prisma.$disconnect();
});

function simplePlanData(userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId,
    name: "Test Plan",
    goal: "MUSCLE_GAIN",
    duration: 4,
    daysPerWeek: 3,
    plan: {
      goal: "MUSCLE_GAIN",
      durationWeeks: 4,
      daysPerWeek: 3,
      weeklySchedule: [
        { day: "Day 1", exercises: [{ exerciseId: "a", order: 1, name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }] },
        { day: "Day 2", exercises: [{ exerciseId: "b", order: 1, name: "Squat", sets: 3, reps: "8-10", restSeconds: 90 }] },
        { day: "Day 3", exercises: [{ exerciseId: "c", order: 1, name: "Deadlift", sets: 3, reps: "6-8", restSeconds: 120 }] },
      ],
      progressionNotes: ["note"],
      recoveryNotes: ["note"],
    },
    status: PlanStatus.COMPLETED,
    ...overrides,
  };
}

// ── publishPlan: publisher-qualification gate ────────────────────────────────

test("publishPlan: rejects (403) a publisher who has never completed a cycle on this plan", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => false;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });

  await assert.rejects(
    () => marketplaceService.publishPlan(userId, plan.id, "Never trained it"),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("publishPlan: succeeds and sets publisherIsVerifiedPt=true when the caller's role is PT", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });

  const listing = await marketplaceService.publishPlan(userId, plan.id, "PT-published plan", "test", "PT");
  assert.equal(listing.publisherIsVerifiedPt, true);
});

test("publishPlan: sets publisherIsVerifiedPt=false for a non-PT role (or when role omitted)", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });

  const listing = await marketplaceService.publishPlan(userId, plan.id, "User-published plan", "test", "USER");
  assert.equal(listing.publisherIsVerifiedPt, false);
});

// ── republishVersion: same gate, but only re-checked on a plan swap ─────────

test("republishVersion: does NOT re-check the gate when the underlying plan is unchanged", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });
  const v1 = await marketplaceService.publishPlan(userId, plan.id, "V1", "test");

  // Flip the stub to false — if republishVersion incorrectly re-checked the
  // gate for an unchanged sourcePlanId, this would now (wrongly) 403.
  marketplaceDeps.hasCompletedCycleForPlan = async () => false;
  const v2 = await marketplaceService.republishVersion(userId, v1.id, { changelog: "tweak" });
  assert.equal(v2.sourcePlanId, v1.sourcePlanId);
});

test("republishVersion: DOES re-check the gate when pointed at a different plan the publisher never trained", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });
  const v1 = await marketplaceService.publishPlan(userId, plan.id, "V1", "test");

  const otherPlan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });
  marketplaceDeps.hasCompletedCycleForPlan = async () => false;

  await assert.rejects(
    () => marketplaceService.republishVersion(userId, v1.id, { sourcePlanId: otherPlan.id, changelog: "swap plan" }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("republishVersion: sets publisherIsVerifiedPt on the new version from the caller's role", { timeout: 120_000 }, async () => {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const userId = `pub-${randomUUID()}`;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(userId) });
  const v1 = await marketplaceService.publishPlan(userId, plan.id, "V1", "test", "USER");
  assert.equal(v1.publisherIsVerifiedPt, false);

  const v2 = await marketplaceService.republishVersion(userId, v1.id, { changelog: "now PT" }, "PT");
  assert.equal(v2.publisherIsVerifiedPt, true);
});

// ── adoptPlan: customizedWeeklySchedule validation ───────────────────────────

async function seedApprovedListingFor(publisherId: string) {
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;
  const plan = await prisma.workoutPlan.create({ data: simplePlanData(publisherId) });
  const listing = await prisma.publishedPlan.create({
    data: {
      sourcePlanId: plan.id,
      publisherId,
      title: `Listing ${randomUUID()}`,
      goal: "MUSCLE_GAIN",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
    },
  });
  return { plan, listing };
}

test("adoptPlan: rejects a customizedWeeklySchedule with the wrong number of days", { timeout: 60_000 }, async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListingFor(publisherId);

  await assert.rejects(
    () =>
      marketplaceService.adoptPlan(`adopter-${randomUUID()}`, listing.id, {
        startDate: "2026-09-01",
        selectedWeekdays: [1, 3, 5],
        customizedWeeklySchedule: [{ day: "Day 1", exercises: [{ exerciseId: "a", name: "Bench Press", sets: 3, reps: "8-10" }] }],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 400);
      return true;
    },
  );
});

test("adoptPlan: rejects a customizedWeeklySchedule that invents an exercise not in the original plan", { timeout: 60_000 }, async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListingFor(publisherId);

  await assert.rejects(
    () =>
      marketplaceService.adoptPlan(`adopter-${randomUUID()}`, listing.id, {
        startDate: "2026-09-01",
        selectedWeekdays: [1, 3, 5],
        customizedWeeklySchedule: [
          { day: "Day 1", exercises: [{ exerciseId: "not-in-original", name: "Invented", sets: 3, reps: "8-10" }] },
          { day: "Day 2", exercises: [{ exerciseId: "b", name: "Squat", sets: 3, reps: "8-10" }] },
          { day: "Day 3", exercises: [{ exerciseId: "c", name: "Deadlift", sets: 3, reps: "6-8" }] },
        ],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 400);
      return true;
    },
  );
});

test("adoptPlan: rejects a customizedWeeklySchedule that leaves a day with zero exercises", { timeout: 60_000 }, async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListingFor(publisherId);

  await assert.rejects(
    () =>
      marketplaceService.adoptPlan(`adopter-${randomUUID()}`, listing.id, {
        startDate: "2026-09-01",
        selectedWeekdays: [1, 3, 5],
        customizedWeeklySchedule: [
          { day: "Day 1", exercises: [] },
          { day: "Day 2", exercises: [{ exerciseId: "b", name: "Squat", sets: 3, reps: "8-10" }] },
          { day: "Day 3", exercises: [{ exerciseId: "c", name: "Deadlift", sets: 3, reps: "6-8" }] },
        ],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 400);
      return true;
    },
  );
});

test("createPackage: rejects a paid package from a non-approved PT seller", { timeout: 60_000 }, async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListingFor(publisherId);
  marketplaceDeps.fetchPtMarketplaceEligibility = async () => ({
    userId: publisherId,
    isApprovedPt: false,
    isPT: false,
    ptApplicationStatus: null,
  });

  await assert.rejects(
    () => marketplaceService.createPackage(publisherId, listing.id, "Paid package", 100000),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("createPackage: allows a paid package from an approved PT seller", { timeout: 60_000 }, async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListingFor(publisherId);
  marketplaceDeps.fetchPtMarketplaceEligibility = async () => ({
    userId: publisherId,
    isApprovedPt: true,
    isPT: true,
    ptApplicationStatus: "APPROVED",
  });

  const pkg = await marketplaceService.createPackage(publisherId, listing.id, "PT package", 100000);
  assert.equal(pkg.sellerId, publisherId);
  assert.equal(pkg.publishedPlanId, listing.id);
});
