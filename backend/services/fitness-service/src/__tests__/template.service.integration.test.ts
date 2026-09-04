/**
 * Roadmap P2.6 "Workout template sharing/import"
 * (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
 *
 * Real DB, but the cross-service ACTIVE-relationship check is stubbed
 * via templateServiceDeps (same convention coach.service.ts's own
 * coachDeps already uses — a bare named-import binding can't be
 * reassigned from a test).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test?schema=public" \
 *     npx tsx --test src/__tests__/template.service.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
  timeout: 60_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TemplateServiceModule = typeof import("../services/template.service");

let prisma: PrismaClientLike | undefined;
let templateModule: TemplateServiceModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    templateModule = await import("../services/template.service");
  }
  return { prisma: prisma!, templateService: templateModule!.templateService, templateServiceDeps: templateModule!.templateServiceDeps };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  // Same open-handle cleanup coach.service.integration.test.ts's own
  // test.after already documents in full — template.service.ts imports
  // workout.service.ts too, which opens the same module-level BullMQ/
  // Redis connections.
  const { redisClient } = await import("../repositories/redis");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // not connected / already closed
  }
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {
    // already closed
  }
});

async function seedExercise(db: PrismaClientLike, id: string) {
  return db.exercise.upsert({
    where: { id },
    create: {
      id,
      exerciseName: `Template Test Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
    update: {},
  });
}

async function seedProgramWithNotes(db: PrismaClientLike, userId: string, exerciseId: string) {
  return db.workoutProgram.create({
    data: {
      userId,
      name: "Real Push Program",
      description: "A real program",
      goal: "Muscle Gain",
      durationWeeks: 4,
      daysPerWeek: 1,
      days: {
        create: [
          {
            dayNumber: 1,
            title: "Push Day",
            exercises: {
              create: [
                {
                  exerciseId,
                  order: 1,
                  sets: 4,
                  reps: 8,
                  restSeconds: 120,
                  notes: "Private coaching note about a shoulder issue — must never leak into a template",
                },
              ],
            },
          },
        ],
      },
    },
  });
}

async function cleanup(db: PrismaClientLike, ...userIds: string[]) {
  for (const userId of userIds) {
    await db.workoutSchedule.deleteMany({ where: { userId } });
    await db.workoutProgramExercise.deleteMany({ where: { programDay: { program: { userId } } } });
    await db.workoutProgramDay.deleteMany({ where: { program: { userId } } });
    await db.workoutProgram.deleteMany({ where: { userId } });
    await db.workoutProgramTemplate.deleteMany({ where: { createdByUserId: userId } });
  }
}

test(
  "createTemplateFromProgram: snapshots the real structure, strips notes, is ownership-checked",
  skipOpts,
  async () => {
    const { prisma: db, templateService: svc } = await loadModules();
    const userId = `template-owner-it-${randomUUID()}`;
    const otherUserId = `template-other-it-${randomUUID()}`;
    const exerciseId = `template-ex-${randomUUID()}`;
    try {
      await seedExercise(db, exerciseId);
      const program = await seedProgramWithNotes(db, userId, exerciseId);

      // Another user cannot snapshot someone else's program.
      await assert.rejects(
        () => svc.createTemplateFromProgram(otherUserId, { programId: program.id }),
        (err: any) => err?.status === 404,
      );

      const template = await svc.createTemplateFromProgram(userId, { programId: program.id });
      assert.equal(template.createdByUserId, userId);
      assert.equal(template.name, "Real Push Program");
      assert.equal(template.durationWeeks, 4);
      assert.deepEqual(template.sharedWithUserIds, []);

      const days = template.daysJson as any[];
      assert.equal(days.length, 1);
      assert.equal(days[0].title, "Push Day");
      assert.equal(days[0].exercises[0].sets, 4);
      assert.equal(days[0].exercises[0].reps, 8);
      assert.equal(days[0].exercises[0].restSeconds, 120);
      assert.equal(
        JSON.stringify(days[0].exercises[0]).includes("shoulder"),
        false,
        "the private coaching note must never appear in the template snapshot",
      );

      // Editing the source program afterward must never affect the template.
      await db.workoutProgram.update({ where: { id: program.id }, data: { name: "Renamed" } });
      const reread = await db.workoutProgramTemplate.findUnique({ where: { id: template.id } });
      assert.equal(reread!.name, "Real Push Program", "a template is a detached snapshot, never a live reference");
    } finally {
      await cleanup(db, userId, otherUserId);
    }
  },
);

test(
  "shareTemplate: requires a real active PT-client relationship (either direction), is idempotent on re-share",
  skipOpts,
  async () => {
    const { prisma: db, templateService: svc, templateServiceDeps } = await loadModules();
    const userId = `template-sharer-it-${randomUUID()}`;
    const recipientId = `template-recipient-it-${randomUUID()}`;
    const exerciseId = `template-ex2-${randomUUID()}`;
    const original = templateServiceDeps.isActivePtClientRelationship;
    try {
      await seedExercise(db, exerciseId);
      const program = await seedProgramWithNotes(db, userId, exerciseId);
      const template = await svc.createTemplateFromProgram(userId, { programId: program.id });

      templateServiceDeps.isActivePtClientRelationship = async () => false;
      await assert.rejects(
        () => svc.shareTemplate(userId, template.id, recipientId),
        (err: any) => err?.status === 403,
      );

      templateServiceDeps.isActivePtClientRelationship = async (pt: string, client: string) => pt === userId && client === recipientId;
      const shared = await svc.shareTemplate(userId, template.id, recipientId);
      assert.deepEqual(shared.sharedWithUserIds, [recipientId]);

      // Re-sharing with the same recipient is a no-op, not a duplicate entry.
      const sharedAgain = await svc.shareTemplate(userId, template.id, recipientId);
      assert.deepEqual(sharedAgain.sharedWithUserIds, [recipientId]);
    } finally {
      templateServiceDeps.isActivePtClientRelationship = original;
      await cleanup(db, userId, recipientId);
    }
  },
);

test(
  "listTemplatesSharedWithMe: only shows templates actually shared with that specific user",
  skipOpts,
  async () => {
    const { prisma: db, templateService: svc, templateServiceDeps } = await loadModules();
    const userId = `template-list-owner-it-${randomUUID()}`;
    const recipientId = `template-list-recipient-it-${randomUUID()}`;
    const strangerId = `template-list-stranger-it-${randomUUID()}`;
    const exerciseId = `template-ex3-${randomUUID()}`;
    const original = templateServiceDeps.isActivePtClientRelationship;
    try {
      await seedExercise(db, exerciseId);
      const program = await seedProgramWithNotes(db, userId, exerciseId);
      const template = await svc.createTemplateFromProgram(userId, { programId: program.id });

      templateServiceDeps.isActivePtClientRelationship = async () => true;
      await svc.shareTemplate(userId, template.id, recipientId);

      const recipientList = await svc.listTemplatesSharedWithMe(recipientId);
      assert.equal(recipientList.length, 1);
      assert.equal(recipientList[0].id, template.id);

      const strangerList = await svc.listTemplatesSharedWithMe(strangerId);
      assert.equal(strangerList.length, 0, "a template must never appear for someone it wasn't shared with");
    } finally {
      templateServiceDeps.isActivePtClientRelationship = original;
      await cleanup(db, userId, recipientId, strangerId);
    }
  },
);

test(
  "importTemplate: creates a real new WorkoutProgram+WorkoutSchedule for the recipient via createManualProgram; unauthorized recipient is rejected",
  skipOpts,
  async () => {
    const { prisma: db, templateService: svc, templateServiceDeps } = await loadModules();
    const userId = `template-import-owner-it-${randomUUID()}`;
    const recipientId = `template-import-recipient-it-${randomUUID()}`;
    const strangerId = `template-import-stranger-it-${randomUUID()}`;
    const exerciseId = `template-ex4-${randomUUID()}`;
    const original = templateServiceDeps.isActivePtClientRelationship;
    try {
      await seedExercise(db, exerciseId);
      const program = await seedProgramWithNotes(db, userId, exerciseId);
      const template = await svc.createTemplateFromProgram(userId, { programId: program.id });

      templateServiceDeps.isActivePtClientRelationship = async () => true;
      await svc.shareTemplate(userId, template.id, recipientId);

      // A stranger it was never shared with cannot import it.
      await assert.rejects(
        () => svc.importTemplate(strangerId, template.id, { startDate: "2026-02-02", selectedWeekdays: [1] }),
        (err: any) => err?.status === 403,
      );

      const result: any = await svc.importTemplate(recipientId, template.id, {
        startDate: "2026-02-02",
        selectedWeekdays: [1],
        replaceExisting: true,
      });
      const newProgramId = result.createdProgramId ?? result.program?.id;
      assert.ok(newProgramId);

      const newProgram = await db.workoutProgram.findFirst({
        where: { id: newProgramId, userId: recipientId },
        include: { days: { include: { exercises: true } } },
      });
      assert.ok(newProgram, "a real new WorkoutProgram must be created for the recipient");
      assert.equal(newProgram!.name, "Real Push Program");
      assert.equal(newProgram!.days[0].exercises[0].sets, 4);
      assert.equal(newProgram!.days[0].exercises[0].restSeconds, 120);

      const schedules = await db.workoutSchedule.findMany({ where: { userId: recipientId } });
      assert.ok(schedules.length > 0, "createManualProgram must have generated real schedule rows too");

      // The template creator's own original program must be completely
      // untouched by the recipient's import.
      const ownerProgramStillIntact = await db.workoutProgram.findUnique({ where: { id: program.id } });
      assert.ok(ownerProgramStillIntact);
    } finally {
      templateServiceDeps.isActivePtClientRelationship = original;
      await cleanup(db, userId, recipientId, strangerId);
    }
  },
);
