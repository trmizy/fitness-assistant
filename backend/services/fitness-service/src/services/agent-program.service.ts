import { createHash } from "node:crypto";
import { AgentPreferencesSchema } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import { fetchUserProfile } from "../clients/user.client";
import { manualProgramDaySchema, createManualProgramSchema } from "../models/fitness.models";
import { workoutService } from "./workout.service";
import { isExerciseAvailable } from "../utils/equipment-availability.util";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
export const agentProgramDeps = { fetchUserProfile };
export const agentProgramService = {
  async candidates(userId: string, raw: unknown) {
    const preferences = AgentPreferencesSchema.parse(raw);
    if (preferences.demo && (process.env.NODE_ENV === "production" || process.env.ENABLE_AGENTIC_DEMO !== "true")) throw fail("Demo unavailable", 403);
    const profile = await agentProgramDeps.fetchUserProfile(userId);
    if (!profile) throw fail("Profile service unavailable", 503);
    if (profile.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED" || profile.safetyScreeningFlags?.length || profile.injuries?.length) {
      return { programs: [], warnings: ["A PT should review your reported health or injury constraints before applying a generic program."] };
    }
    if (!preferences.days?.length || !preferences.goal || !profile.experienceLevel) throw fail("Provide goal, training days and experience level", 422);
    const templates = await prisma.workoutProgramTemplate.findMany({ where: {
      goal: preferences.goal, daysPerWeek: preferences.days.length,
      dataOrigin: preferences.demo ? "SYNTHETIC" : "REAL",
      OR: [{ isPublic: true }, { createdByUserId: userId }, { sharedWithUserIds: { has: userId } }],
      experienceLevel: profile.experienceLevel,
    }, orderBy: { id: "asc" }, take: 40 });
    const equipment = new Set((await prisma.userEquipment.findMany({ where: { userId } })).map(e => e.equipmentId));
    const programs = [];
    for (const template of templates) {
      const parsed = manualProgramDaySchema.array().min(1).max(7).safeParse(template.daysJson);
      if (!parsed.success || parsed.data.some(d => d.exercises.length > 12)) continue;
      const ids = [...new Set(parsed.data.flatMap(d => d.exercises.map(e => e.exerciseId)))];
      const exercises = await prisma.exercise.findMany({ where: { id: { in: ids }, status: "PUBLISHED", OR: [{ ownerId: null }, { ownerId: userId }] }, include: { equipmentLinks: true } });
      // Equipment eligibility: reuse the single canonical predicate
      // (equipment-availability.util.ts) already shared by exercise
      // substitution and plan-equipment validation, rather than a local
      // reimplementation. The prior inline check here
      // (`equipmentLinks.some(link => !equipment.has(...))`) treated EVERY
      // linked equipment row as REQUIRED regardless of its real
      // `requirementType`, so a program using an ALTERNATIVE-equipment
      // exercise (e.g. "Lat Pulldown Machine" OR "Cable Machine") was
      // rejected unless the user owned BOTH, and an OPTIONAL link (never
      // meant to gate availability at all) also incorrectly blocked
      // eligibility — a real false-negative recall bug (Codex Independent
      // Evaluation #1, MEDIUM finding #1), not a safety issue.
      if (exercises.length !== ids.length || exercises.some(e => e.contraindications.length > 0 ||
        (profile.experienceLevel === "BEGINNER" && e.difficultyLevel !== "beginner") ||
        !isExerciseAvailable(e.equipmentLinks, equipment))) continue;
      // Scheduling estimate from actual prescription, not a physiological promise.
      const estimatedMinutes = Math.ceil(Math.max(...parsed.data.map(d => d.exercises.reduce((sum, e) => sum + e.sets * ((e.reps ?? 10) * 4 + (e.restSeconds ?? 60)), 0))) / 60) + 10;
      if (estimatedMinutes > (preferences.sessionMinutes ?? 60)) continue;
      const fingerprint = createHash("sha256").update(JSON.stringify({ days: template.daysJson, name: template.name, duration: template.durationWeeks })).digest("hex");
      programs.push({ id: template.id, name: template.name, goal: template.goal, daysPerWeek: template.daysPerWeek,
        durationWeeks: template.durationWeeks, estimatedMinutes, experienceLevel: template.experienceLevel,
        focusMuscles: [...new Set(exercises.flatMap(e => e.muscleGroupsActivated))], fingerprint,
        dataOrigin: template.dataOrigin, days: parsed.data.map(d => ({ ...d, exercises: d.exercises.map(e => ({ ...e, name: exercises.find(x => x.id === e.exerciseId)!.exerciseName })) })) });
    }
    return { programs, warnings: programs.length ? [] : ["No eligible program matches your current constraints. Adjust preferences or ask a PT for a reviewed plan."] };
  },
  async apply(userId: string, input: { templateId: string; actionId: string; fingerprint: string; startDate: string; preferences: unknown; confirmed: true }) {
    const existing = await prisma.workoutProgram.findUnique({ where: { agentActionId: input.actionId } });
    if (existing) {
      if (existing.userId !== userId) throw fail("Action not found", 404);
      return { createdProgramId: existing.id, nextUrl: "/client/training" };
    }
    const preferences = AgentPreferencesSchema.parse(input.preferences);
    const { programs } = await this.candidates(userId, preferences);
    const candidate = programs.find(p => p.id === input.templateId);
    if (!candidate || candidate.fingerprint !== input.fingerprint) throw fail("Program or constraints changed. Refresh and confirm again.", 409);
    const dto = createManualProgramSchema.parse({ name: candidate.name, goal: candidate.goal, durationWeeks: candidate.durationWeeks,
      daysPerWeek: candidate.daysPerWeek, days: candidate.days, startDate: input.startDate,
      selectedWeekdays: preferences.days!.map(d => d % 7), replaceExisting: true });
    const result = await workoutService.createManualProgram(userId, dto, { actionId: input.actionId });
    return { createdProgramId: result.createdProgramId, nextUrl: "/client/training" };
  },
};
