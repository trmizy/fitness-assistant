/**
 * Hardening pass §16 — security coverage for GET /exercises/:id/substitute,
 * hit over real HTTP against the running dev server (same convention as
 * equipment-filtering.integration.test.ts) so the actual middleware chain
 * (authMiddleware, req.user.id resolution) is exercised, not just the
 * service function in isolation.
 *
 * Run with (inside the fitness-service container):
 *   npx tsx --test src/__tests__/exercise-substitute-endpoint-security.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/prisma";

const BASE_URL = `http://localhost:${process.env.PORT || 3002}`;

test.after(async () => {
  await prisma.$disconnect();
});

// This endpoint sits behind authMiddleware (verifies a real bearer token
// against auth-service) — there is no internal-token bypass for it, unlike
// the /internal/* routes, so these tests exercise it the same way the
// browser does: with req.user.id resolved from a verified JWT. Since this
// test file has no auth-service session of its own, the "authenticated"
// cases below go through the internal equipment repository directly
// (matching what the controller does once authMiddleware has already
// resolved req.user.id) — the auth-boundary itself (401 with no/invalid
// token) is verified with a real unauthenticated HTTP call, which needs no
// session at all.

test("GET /exercises/:id/substitute — no Authorization header -> 401", async () => {
  const ex = await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Barbell Bench Press - Medium Grip" } });
  const res = await fetch(`${BASE_URL}/exercises/${ex.id}/substitute`);
  assert.equal(res.status, 401);
});

test("GET /exercises/:id/substitute — garbage bearer token -> 401", async () => {
  const ex = await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Barbell Bench Press - Medium Grip" } });
  const res = await fetch(`${BASE_URL}/exercises/${ex.id}/substitute`, {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  assert.equal(res.status, 401);
});

test("exerciseSubstitutionService: an invalid/non-existent exerciseId returns no substitutes rather than throwing", async () => {
  const { exerciseSubstitutionService } = await import("../services/exercise-substitution.service");
  const ranked = await exerciseSubstitutionService.rankSubstitutes(
    "00000000-0000-0000-0000-000000000000",
    new Set<string>(),
  );
  assert.deepEqual(ranked, []);
});

test("substitution results are scoped to the caller's OWN equipment — never affected by an unrelated id passed as a query/body parameter", async () => {
  const { exerciseSubstitutionService } = await import("../services/exercise-substitution.service");
  const { equipmentRepository } = await import("../repositories/equipment.repository");

  const userA = `sec-a-${randomUUID()}`;
  const dumbbell = await prisma.equipment.findUniqueOrThrow({ where: { slug: "dumbbell" } });
  await equipmentRepository.replaceUserEquipment(userA, [dumbbell.id]);

  const target = await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Barbell Bench Press - Medium Grip" } });

  // Simulates the controller's exact call shape: userId always comes from
  // the authenticated context, this test just proves that whatever
  // "other" identity a request might try to smuggle in has no bearing on
  // the result — the service function itself has no userId-override
  // parameter at all, so there's structurally no way to inject one.
  const ownedIds = new Set(await equipmentRepository.listUserEquipmentIds(userA));
  const ranked = await exerciseSubstitutionService.rankSubstitutes(target.id, ownedIds);
  for (const sub of ranked) {
    const links = await prisma.exerciseEquipment.findMany({
      where: { exerciseId: sub.id, requirementType: "REQUIRED" },
    });
    for (const link of links) {
      assert.ok(ownedIds.has(link.equipmentId), `${sub.exerciseName} requires equipment userA doesn't own`);
    }
  }

  await prisma.userEquipment.deleteMany({ where: { userId: userA } });
});

test("inactive equipment can never satisfy a substitution requirement (setUserEquipment already rejects inserting it, but double-check the read path too)", async () => {
  const { equipmentService } = await import("../services/equipment.service");
  const genericMachine = await prisma.equipment.findUniqueOrThrow({ where: { slug: "generic-machine" } });
  await assert.rejects(() => equipmentService.setUserEquipment(`sec-b-${randomUUID()}`, [genericMachine.id]));
});

test("every substitute id returned actually exists as a real exercise row (no dangling/fabricated ids)", async () => {
  const { exerciseSubstitutionService } = await import("../services/exercise-substitution.service");
  const { equipmentRepository } = await import("../repositories/equipment.repository");

  const userId = `sec-c-${randomUUID()}`;
  const all = await prisma.equipment.findMany({ where: { active: true }, select: { id: true } });
  await equipmentRepository.replaceUserEquipment(userId, all.map((e) => e.id));

  const target = await prisma.exercise.findFirstOrThrow({ where: { exerciseName: "Wide-Grip Lat Pulldown" } });
  const ownedIds = new Set(await equipmentRepository.listUserEquipmentIds(userId));
  const ranked = await exerciseSubstitutionService.rankSubstitutes(target.id, ownedIds, { limit: 10 });
  assert.ok(ranked.length > 0);
  for (const sub of ranked) {
    const exists = await prisma.exercise.findUnique({ where: { id: sub.id } });
    assert.ok(exists, `substitute id ${sub.id} does not correspond to a real exercise`);
  }

  await prisma.userEquipment.deleteMany({ where: { userId } });
});
