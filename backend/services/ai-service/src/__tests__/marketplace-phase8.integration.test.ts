/**
 * Phase 8 (docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) integration coverage
 * for marketplace.service.ts's versioning/adopt/quality-score/improvement-
 * suggestion additions — real DB (ai-service has no separate *_test
 * database, matching the same constraint already accepted for
 * user-service's Phase 6 endpoint — verified live against gymcoach_ai
 * instead, with randomUUID-based test-data isolation).
 *
 * Run with (from backend/services/ai-service):
 *   npx tsx --test src/__tests__/marketplace-phase8.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { marketplaceService, marketplaceDeps } from "../services/marketplace.service";
import { PlanStatus } from "../generated/prisma";

test.after(async () => {
  await prisma.$disconnect();
});

async function seedCompletedPlan(userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return prisma.workoutPlan.create({
    data: {
      userId,
      name: "Test Plan",
      goal: "MUSCLE_GAIN",
      duration: 4,
      daysPerWeek: 3,
      plan: {
        daysPerWeek: 3,
        weeklySchedule: [1, 2, 3].map((day) => ({
          day: `Day ${day}`,
          goal: "Full body",
          exercises: [
            {
              exerciseId: `fixture-exercise-${day}`,
              order: 1,
              name: `Fixture Exercise ${day}`,
              sets: 3,
              reps: "8-12",
              restSeconds: 90,
            },
          ],
        })),
        progressionNotes: [],
        recoveryNotes: [],
      },
      status: PlanStatus.COMPLETED,
      ...overrides,
    },
  });
}

async function seedApprovedListing(userId: string) {
  const plan = await seedCompletedPlan(userId);
  const listing = await prisma.publishedPlan.create({
    data: {
      sourcePlanId: plan.id,
      publisherId: userId,
      title: `Listing ${randomUUID()}`,
      goal: "MUSCLE_GAIN",
      moderationStatus: "APPROVED",
      publishedAt: new Date(),
    },
  });
  return { plan, listing };
}

// ── Versioning — never a destructive overwrite ───────────────────────────────

test("republishVersion: creates a NEW row, never mutates the old one, and resets moderation to SUBMITTED", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { plan, listing } = await seedApprovedListing(publisherId);

  const newVersion = await marketplaceService.republishVersion(publisherId, listing.id, {
    sourcePlanId: plan.id,
    changelog: "Added a deload week",
    improvementReason: "Reviewers said it was too intense",
  });

  assert.notEqual(newVersion.id, listing.id);
  assert.equal(newVersion.version, listing.version + 1);
  assert.equal(newVersion.previousVersionId, listing.id);
  assert.equal(newVersion.moderationStatus, "SUBMITTED"); // never inherits APPROVED

  // Old version is completely untouched — anything referencing listing.id
  // (a purchase, an adoption) stays valid.
  const oldStillApproved = await prisma.publishedPlan.findUnique({ where: { id: listing.id } });
  assert.equal(oldStillApproved?.moderationStatus, "APPROVED");
  assert.equal(oldStillApproved?.version, 1);
});

test("republishVersion: rejects (403) a publisher who doesn't own the listing", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListing(publisherId);
  await assert.rejects(
    () => marketplaceService.republishVersion(`stranger-${randomUUID()}`, listing.id, { changelog: "x" }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("listVersionHistory: returns the full lineage in version order", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { plan, listing: v1 } = await seedApprovedListing(publisherId);
  const v2 = await marketplaceService.republishVersion(publisherId, v1.id, { sourcePlanId: plan.id, changelog: "v2" });

  const history = await marketplaceService.listVersionHistory(v1.id);
  const versions = history.map((h: any) => h.version).sort((a: number, b: number) => a - b);
  assert.deepEqual(versions, [1, 2]);
  assert.ok(history.some((h: any) => h.id === v2.id));
});

// ── Adopt — access control ───────────────────────────────────────────────────

test("adoptPlan: rejects (404) a listing that is not APPROVED", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const plan = await seedCompletedPlan(publisherId);
  const listing = await prisma.publishedPlan.create({
    data: { sourcePlanId: plan.id, publisherId, title: "Draft listing", goal: "MUSCLE_GAIN", moderationStatus: "SUBMITTED" },
  });

  await assert.rejects(
    () =>
      marketplaceService.adoptPlan(`adopter-${randomUUID()}`, listing.id, {
        startDate: "2026-09-01",
        selectedWeekdays: [1, 3, 5],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 404);
      return true;
    },
  );
});

test("adoptPlan: rejects (409) because paid fixed plans cannot use the free-adoption path", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListing(publisherId);
  await prisma.trainingPackage.create({
    data: { sellerId: publisherId, publishedPlanId: listing.id, name: "Paid package", price: 100000, status: "ACTIVE" },
  });

  await assert.rejects(
    () =>
      marketplaceService.adoptPlan(`adopter-${randomUUID()}`, listing.id, {
        startDate: "2026-09-01",
        selectedWeekdays: [1, 3, 5],
      }),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 409);
      return true;
    },
  );
});

// ── Quality score recompute on review submission ─────────────────────────────

test("submitReview: recomputes and persists a deterministic qualityScore on the listing", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListing(publisherId);
  const reviewerId = `reviewer-${randomUUID()}`;
  await prisma.planAdoption.create({
    data: {
      publishedPlanId: listing.id,
      adopterId: reviewerId,
      accessBasis: "free",
    },
  });
  // hasCompletedCycleForPlan is called by submitReview — stub it to avoid a
  // real cross-service dependency for this DB-focused test.
  const original = marketplaceDeps.hasCompletedCycleForPlan;
  marketplaceDeps.hasCompletedCycleForPlan = async () => true;

  try {
    await marketplaceService.submitReview(listing.id, reviewerId, 5, "Great plan", {
      goalFit: 5,
      enjoyment: 5,
      wouldUseAgain: true,
    });
  } finally {
    marketplaceDeps.hasCompletedCycleForPlan = original;
  }

  const updated = await prisma.publishedPlan.findUnique({ where: { id: listing.id } });
  assert.ok(updated?.qualityScore != null);
  assert.ok(updated!.qualityScore! > 0.8, `expected a high score for a 5-star/wouldUseAgain review, got ${updated?.qualityScore}`);
  assert.ok(updated?.qualityScoreComputedAt != null);
});

// ── AI improvement suggestions — advisory only, never auto-publishes ────────

test("generateImprovementSuggestions: rejects (403) a non-owner", async () => {
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListing(publisherId);
  await assert.rejects(
    () => marketplaceService.generateImprovementSuggestions(`stranger-${randomUUID()}`, listing.id),
    (err: any) => {
      assert.equal(err.statusCode ?? err.status, 403);
      return true;
    },
  );
});

test("generateImprovementSuggestions: persists a suggestion row and never changes moderationStatus (no auto-publish)", async (t) => {
  t.after(() => {});
  const publisherId = `pub-${randomUUID()}`;
  const { listing } = await seedApprovedListing(publisherId);

  const suggestion = await marketplaceService.generateImprovementSuggestions(publisherId, listing.id);
  assert.ok(suggestion.id);
  assert.ok(Array.isArray(suggestion.suggestions));
  assert.equal(typeof suggestion.summary, "string");

  const stillApproved = await prisma.publishedPlan.findUnique({ where: { id: listing.id } });
  assert.equal(stillApproved?.moderationStatus, "APPROVED"); // AI never flips this

  const history = await marketplaceService.listImprovementSuggestions(publisherId, listing.id);
  assert.ok(history.some((h: any) => h.id === suggestion.id));
});
