import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agentProgramService, agentProgramDeps } from "../services/agent-program.service";
import { prisma } from "../repositories/prisma";

/**
 * DB-backed equipment eligibility semantics — Codex Independent Evaluation #1
 * (docs/codex-training-program-recommendation-evaluation-1.md, MEDIUM
 * finding #1): the prior inline predicate in
 * `agent-program.service.ts::candidates()` treated every linked equipment
 * row as REQUIRED regardless of its real `requirementType`, so OPTIONAL
 * links (never meant to gate availability) and ALTERNATIVE links (meant to
 * form an OR-group — owning ANY one satisfies the exercise) both
 * incorrectly rejected an otherwise-eligible program. Fixed by reusing the
 * existing canonical `isExerciseAvailable()` (equipment-availability.util.ts)
 * — the same predicate exercise-substitution and plan-equipment-validator
 * already use — rather than inventing new semantics here.
 *
 * Real DB (own isolated Exercise/Equipment/ExerciseEquipment/
 * WorkoutProgramTemplate rows, created and torn down by this file).
 */

const originalFetchUserProfile = agentProgramDeps.fetchUserProfile;
test.afterEach(() => {
  agentProgramDeps.fetchUserProfile = originalFetchUserProfile;
});
test.after(async () => {
  await prisma.$disconnect();
});

function stubProfile() {
  agentProgramDeps.fetchUserProfile = async () => ({
    goal: "WEIGHT_LOSS", targetWeight: null, currentWeight: 75, experienceLevel: "BEGINNER",
    competesInSport: false, injuries: [], age: 30, gender: "MALE", heightCm: 175,
    activityLevel: "MODERATELY_ACTIVE", startingWeight: null,
  } as any);
}

async function seedEquipment(slug: string) {
  return prisma.equipment.create({ data: { slug, name: slug, category: "OTHER" } });
}

async function seedExerciseWithLinks(id: string, links: Array<{ equipmentId: string; requirementType: string }>) {
  await prisma.exercise.create({
    data: {
      id, exerciseName: `Equipment-semantics test exercise ${id}`, typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL", bodyPart: "UPPER_BODY", type: "PUSH",
      muscleGroupsActivated: ["chest"], instructions: "Test exercise for equipment-semantics suite.",
      difficultyLevel: "beginner", status: "PUBLISHED", contraindications: [],
    },
  });
  for (const link of links) {
    await prisma.exerciseEquipment.create({ data: { exerciseId: id, equipmentId: link.equipmentId, requirementType: link.requirementType } });
  }
}

async function seedTemplate(id: string, exerciseId: string, userId: string) {
  return prisma.workoutProgramTemplate.create({
    data: {
      id, createdByUserId: userId, name: `Equipment-semantics test template ${id}`,
      goal: "WEIGHT_LOSS", durationWeeks: 4, daysPerWeek: 1, experienceLevel: "BEGINNER",
      isPublic: true, dataOrigin: "REAL",
      daysJson: [{ dayNumber: 1, title: "Day 1", exercises: [{ exerciseId, sets: 3, reps: 10, restSeconds: 60 }] }],
    },
  });
}

async function candidateIsEligible(userId: string, templateId: string): Promise<boolean> {
  const result = await agentProgramService.candidates(userId, { goal: "WEIGHT_LOSS", days: [1], sessionMinutes: 60, demo: false });
  return result.programs.some((p) => p.id === templateId);
}

async function cleanup(userId: string, templateId: string, exerciseId: string, equipmentIds: string[]) {
  await prisma.workoutProgramTemplate.deleteMany({ where: { id: templateId } }).catch(() => {});
  await prisma.exerciseEquipment.deleteMany({ where: { exerciseId } }).catch(() => {});
  await prisma.exercise.deleteMany({ where: { id: exerciseId } }).catch(() => {});
  await prisma.userEquipment.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.equipment.deleteMany({ where: { id: { in: equipmentIds } } }).catch(() => {});
}

test("agentProgramService.candidates: REQUIRED equipment present -> eligible", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const barbell = await seedEquipment(`barbell-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [{ equipmentId: barbell.id, requirementType: "REQUIRED" }]);
  await seedTemplate(templateId, exerciseId, userId);
  await prisma.userEquipment.create({ data: { userId, equipmentId: barbell.id } });
  try {
    assert.equal(await candidateIsEligible(userId, templateId), true);
  } finally {
    await cleanup(userId, templateId, exerciseId, [barbell.id]);
  }
});

test("agentProgramService.candidates: REQUIRED equipment absent -> ineligible", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const barbell = await seedEquipment(`barbell-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [{ equipmentId: barbell.id, requirementType: "REQUIRED" }]);
  await seedTemplate(templateId, exerciseId, userId);
  // user owns nothing
  try {
    assert.equal(await candidateIsEligible(userId, templateId), false);
  } finally {
    await cleanup(userId, templateId, exerciseId, [barbell.id]);
  }
});

test("agentProgramService.candidates: OPTIONAL equipment absent -> STILL eligible (this is the real bug fixed this pass)", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const band = await seedEquipment(`band-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [{ equipmentId: band.id, requirementType: "OPTIONAL" }]);
  await seedTemplate(templateId, exerciseId, userId);
  // user owns nothing — OPTIONAL must never gate eligibility
  try {
    assert.equal(await candidateIsEligible(userId, templateId), true);
  } finally {
    await cleanup(userId, templateId, exerciseId, [band.id]);
  }
});

test("agentProgramService.candidates: one of two ALTERNATIVE equipment present -> eligible (OR-group, this is the real bug fixed this pass)", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const latPulldown = await seedEquipment(`lat-pulldown-${randomUUID()}`);
  const cable = await seedEquipment(`cable-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [
    { equipmentId: latPulldown.id, requirementType: "ALTERNATIVE" },
    { equipmentId: cable.id, requirementType: "ALTERNATIVE" },
  ]);
  await seedTemplate(templateId, exerciseId, userId);
  await prisma.userEquipment.create({ data: { userId, equipmentId: cable.id } }); // owns only ONE of the two alternatives
  try {
    assert.equal(await candidateIsEligible(userId, templateId), true);
  } finally {
    await cleanup(userId, templateId, exerciseId, [latPulldown.id, cable.id]);
  }
});

test("agentProgramService.candidates: ALL ALTERNATIVE equipment absent -> ineligible", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const latPulldown = await seedEquipment(`lat-pulldown-${randomUUID()}`);
  const cable = await seedEquipment(`cable-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [
    { equipmentId: latPulldown.id, requirementType: "ALTERNATIVE" },
    { equipmentId: cable.id, requirementType: "ALTERNATIVE" },
  ]);
  await seedTemplate(templateId, exerciseId, userId);
  try {
    assert.equal(await candidateIsEligible(userId, templateId), false);
  } finally {
    await cleanup(userId, templateId, exerciseId, [latPulldown.id, cable.id]);
  }
});

test("agentProgramService.candidates: bodyweight/no equipment links -> eligible", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  await seedExerciseWithLinks(exerciseId, []);
  await seedTemplate(templateId, exerciseId, userId);
  try {
    assert.equal(await candidateIsEligible(userId, templateId), true);
  } finally {
    await cleanup(userId, templateId, exerciseId, []);
  }
});

test("agentProgramService.candidates: mixed REQUIRED (present) + OPTIONAL (absent) -> eligible", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const bench = await seedEquipment(`bench-${randomUUID()}`);
  const band = await seedEquipment(`band-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [
    { equipmentId: bench.id, requirementType: "REQUIRED" },
    { equipmentId: band.id, requirementType: "OPTIONAL" },
  ]);
  await seedTemplate(templateId, exerciseId, userId);
  await prisma.userEquipment.create({ data: { userId, equipmentId: bench.id } }); // owns REQUIRED, not the OPTIONAL one
  try {
    assert.equal(await candidateIsEligible(userId, templateId), true);
  } finally {
    await cleanup(userId, templateId, exerciseId, [bench.id, band.id]);
  }
});

test("agentProgramService.candidates: mixed REQUIRED (absent) + ALTERNATIVE (present) -> ineligible (REQUIRED still gates regardless of ALTERNATIVE satisfaction)", async () => {
  const userId = `equip-${randomUUID()}`;
  const exerciseId = randomUUID();
  const templateId = randomUUID();
  stubProfile();
  const bench = await seedEquipment(`bench-${randomUUID()}`);
  const cable = await seedEquipment(`cable-${randomUUID()}`);
  await seedExerciseWithLinks(exerciseId, [
    { equipmentId: bench.id, requirementType: "REQUIRED" },
    { equipmentId: cable.id, requirementType: "ALTERNATIVE" },
  ]);
  await seedTemplate(templateId, exerciseId, userId);
  await prisma.userEquipment.create({ data: { userId, equipmentId: cable.id } }); // owns the ALTERNATIVE, not the REQUIRED bench
  try {
    assert.equal(await candidateIsEligible(userId, templateId), false);
  } finally {
    await cleanup(userId, templateId, exerciseId, [bench.id, cable.id]);
  }
});
