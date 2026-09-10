/**
 * Gymini Adaptive Cycle Transition Continuity — §24: one integration
 * proof that the EXISTING exercise-substitution engine (owned by the
 * parallel AI Workout Grounding workstream, not touched here) is
 * reachable and produces a real, canonical, equipment-compatible
 * replacement when a planned exercise's required equipment becomes
 * unavailable. No second substitution implementation — this only calls
 * exerciseSubstitutionService.findSubstitute, the same real function the
 * product's own "Swap exercise" UI calls.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DISABLE_REDIS=true DATABASE_URL=postgresql://gymcoach_test:***@localhost:55433/gymcoach_fitness_test \
 *     npx tsx --test src/__tests__/cross-system-substitution-integration.test.ts
 *
 * Requires the real seeded catalog (pnpm run test:catalog:setup) — same
 * precondition as exercise-substitution.test.ts and this repo's other
 * catalog-dependent suites.
 */
import test from "node:test";
import assert from "node:assert/strict";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database with the real catalog seeded.",
};

test(
  "Cross-System Journey — a real planned exercise with an unavailable REQUIRED equipment resolves to a real, canonical, equipment-compatible substitute via the existing substitution engine",
  skipOpts,
  async () => {
    const { prisma } = await import("../repositories/prisma");
    const { exerciseSubstitutionService } = await import("../services/exercise-substitution.service");

    // Pick a REAL catalog exercise with exactly one REQUIRED equipment
    // link — real data, not a synthetic fixture, so the real scoring/
    // matching logic is exercised the same way the product itself uses it.
    const candidateLink = await prisma.exerciseEquipment.findFirst({
      where: {
        requirementType: "REQUIRED",
        exercise: { status: "PUBLISHED", movementPattern: { not: null } },
      },
      include: { exercise: true, equipment: true },
    });
    assert.ok(candidateLink, "the seeded catalog must contain at least one PUBLISHED exercise with a REQUIRED equipment link — run test:catalog:setup first");

    const targetExercise = candidateLink!.exercise;
    const requiredEquipmentId = candidateLink!.equipmentId;

    // Legitimate test context (§24: "make required equipment unavailable
    // using legitimate test context") — an owned-equipment set that
    // simply does NOT include the target's required equipment. This
    // mirrors exactly what a real user's UserEquipment selection looks
    // like from the substitution service's own point of view; no raw
    // mutation of the catalog or the target exercise itself.
    const allEquipment = await prisma.equipment.findMany({ where: { active: true }, select: { id: true } });
    const ownedEquipmentIds = new Set(allEquipment.map((e) => e.id).filter((id) => id !== requiredEquipmentId));

    const ranked = await exerciseSubstitutionService.rankSubstitutes(targetExercise.id, ownedEquipmentIds, { limit: 1 });
    const substitute = ranked[0] ?? null;
    assert.ok(substitute, `expected a real substitute for "${targetExercise.exerciseName}" (missing equipment ${candidateLink!.equipment.name}) — got null`);

    // ── Assertions: exists, visible, equipment-compatible, preserves
    // intended movement/muscle semantics — per §24's own checklist. ──
    const substituteRow = await prisma.exercise.findUnique({
      where: { id: substitute!.id },
      include: { equipmentLinks: { include: { equipment: true } } },
    });
    assert.ok(substituteRow, "substitute id must resolve to a real Exercise row");
    assert.equal(substituteRow!.status, "PUBLISHED", "a substitute must be a real, visible/usable catalog exercise");
    assert.notEqual(substituteRow!.id, targetExercise.id, "a substitute must not be the same exercise being replaced");

    const requiredLinks = substituteRow!.equipmentLinks.filter((l) => l.requirementType === "REQUIRED");
    const substituteIsCompatible = requiredLinks.every((l) => ownedEquipmentIds.has(l.equipmentId));
    assert.ok(substituteIsCompatible, `substitute "${substituteRow!.exerciseName}" must not require the unavailable equipment (or any other equipment the user doesn't own)`);

    // Movement/muscle semantics preserved "according to the existing
    // engine" — findSubstitute already only returns candidates with
    // score > 0 (movement pattern and/or muscle overlap, per
    // exercise-substitution.service.ts's own scoreCandidate); re-confirm
    // here rather than assuming.
    assert.ok(substitute!.score > 0, "the existing engine's own score must be positive — this proof must not accept an unrelated fallback");
    assert.ok(typeof substitute!.reason === "string" && substitute!.reason.length > 0, "the existing engine's human-readable match reason must be present");

    console.log(
      `[XSYS §24 EVIDENCE] target="${targetExercise.exerciseName}" (missing ${candidateLink!.equipment.name}) -> ` +
      `substitute="${substituteRow!.exerciseName}" score=${substitute!.score} reason="${substitute!.reason}"`,
    );

    await prisma.$disconnect();
  },
);
