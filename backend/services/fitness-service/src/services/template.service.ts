/**
 * Roadmap P2.6 "Workout template sharing/import"
 * (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md).
 *
 * Reuses existing, already-proven infrastructure rather than inventing
 * parallel versions: `workoutService.createManualProgram` for the
 * actual program-creation write path (import), and
 * `isActivePtClientRelationship` for authorization (share) — the exact
 * same primitive `coach.service.ts` already uses, re-checked fresh per
 * call, never cached.
 */
import { prisma } from "../repositories/prisma";
import { workoutService } from "./workout.service";
import { isActivePtClientRelationship } from "../clients/user.client";
import type { CreateManualProgramDto } from "../models/fitness.models";

/** Indirection point for tests — same pattern coach.service.ts's
 * coachDeps already uses (a plain named-import binding can't be
 * reassigned from a test; this mutable object can). */
export const templateServiceDeps = {
  isActivePtClientRelationship,
};

export type TemplateDaySnapshot = {
  dayNumber: number;
  title: string;
  description?: string | null;
  exercises: Array<{ exerciseId: string; order?: number; sets: number; reps: number; restSeconds: number }>;
};

/** Either direction of the PT<->client relationship counts — a PT can
 * share a template to their client, and a client can share one of their
 * own programs back to their PT, using the SAME real, active Contract. */
async function hasSharingRelationship(userA: string, userB: string): Promise<boolean> {
  const [aIsPtOfB, bIsPtOfA] = await Promise.all([
    templateServiceDeps.isActivePtClientRelationship(userA, userB),
    templateServiceDeps.isActivePtClientRelationship(userB, userA),
  ]);
  return aIsPtOfB || bIsPtOfA;
}

export const templateService = {
  /** Snapshots an EXISTING program's structure (ownership-checked) into a
   * new, detached template. Deliberately strips `notes` and exercise-group
   * structure — see the impact analysis's privacy audit / scope decisions. */
  async createTemplateFromProgram(
    userId: string,
    input: { programId: string; name?: string; description?: string },
  ) {
    const program = await prisma.workoutProgram.findFirst({
      where: { id: input.programId, userId },
      include: { days: { orderBy: { dayNumber: "asc" }, include: { exercises: { orderBy: { order: "asc" } } } } },
    });
    if (!program) throw { status: 404, message: "Program not found" };

    const days: TemplateDaySnapshot[] = program.days.map((day) => ({
      dayNumber: day.dayNumber,
      title: day.title,
      description: day.description,
      exercises: day.exercises.map((ex, index) => ({
        exerciseId: ex.exerciseId,
        order: ex.order || index + 1,
        sets: ex.sets ?? 3,
        reps: ex.reps ?? 10,
        restSeconds: ex.restSeconds ?? 90,
      })),
    }));

    return prisma.workoutProgramTemplate.create({
      data: {
        createdByUserId: userId,
        name: input.name || program.name,
        description: input.description ?? program.description,
        goal: program.goal,
        durationWeeks: program.durationWeeks ?? 4,
        daysPerWeek: program.daysPerWeek ?? days.length,
        daysJson: days as any,
        sharedWithUserIds: [],
      },
    });
  },

  async shareTemplate(userId: string, templateId: string, recipientUserId: string) {
    const template = await prisma.workoutProgramTemplate.findFirst({ where: { id: templateId, createdByUserId: userId } });
    if (!template) throw { status: 404, message: "Template not found" };
    if (recipientUserId === userId) throw { status: 400, message: "Cannot share a template with yourself" };

    const allowed = await hasSharingRelationship(userId, recipientUserId);
    if (!allowed) throw { status: 403, message: "No active PT-client relationship with this person" };

    if (template.sharedWithUserIds.includes(recipientUserId)) return template; // already shared — idempotent no-op
    return prisma.workoutProgramTemplate.update({
      where: { id: templateId },
      data: { sharedWithUserIds: { push: recipientUserId } },
    });
  },

  async listMyTemplates(userId: string) {
    return prisma.workoutProgramTemplate.findMany({ where: { createdByUserId: userId }, orderBy: { createdAt: "desc" } });
  },

  async listTemplatesSharedWithMe(userId: string) {
    return prisma.workoutProgramTemplate.findMany({
      where: { sharedWithUserIds: { has: userId } },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Imports a template into the CALLER's own account as a real new
   * WorkoutProgram (+ generated WorkoutSchedule rows), via the exact same
   * createManualProgram path createAndAssignPlan already relies on. The
   * caller must be either the template's creator (self-import) or someone
   * it was explicitly shared with. */
  async importTemplate(
    userId: string,
    templateId: string,
    placement: { startDate: string; selectedWeekdays: number[]; repeatWeeks?: number; replaceExisting?: boolean },
  ) {
    const template = await prisma.workoutProgramTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw { status: 404, message: "Template not found" };
    if (template.createdByUserId !== userId && !template.sharedWithUserIds.includes(userId)) {
      throw { status: 403, message: "This template was not shared with you" };
    }

    const days = template.daysJson as unknown as TemplateDaySnapshot[];
    const input: CreateManualProgramDto = {
      name: template.name,
      goal: template.goal ?? undefined,
      durationWeeks: template.durationWeeks,
      daysPerWeek: template.daysPerWeek,
      startDate: placement.startDate,
      selectedWeekdays: placement.selectedWeekdays,
      repeatWeeks: placement.repeatWeeks,
      replaceExisting: placement.replaceExisting ?? true,
      days: days.map((d) => ({
        dayNumber: d.dayNumber,
        title: d.title,
        description: d.description ?? undefined,
        exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, order: e.order, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds })),
      })),
    };

    return workoutService.createManualProgram(userId, input);
  },
};
