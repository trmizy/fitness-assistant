/**
 * Gymini V2 (EXPERIMENTAL) — Training Agent tool contracts (P1).
 *
 * Every READ/DRAFT handler is a thin adapter over the EXISTING V1 domain function in services/fitness-agent-tools.ts
 * (same HTTP routes, same identity forwarding, same validation on the fitness-service side). No business logic is
 * duplicated here: the contract only adds argument schemas, a model-safe projection and an output schema.
 *
 * Selection (Training only — no nutrition, PT or roadmap tools):
 *   READ  getUserFitnessContext (training fields only), getCurrentProgram, getTodaySchedule, searchExerciseByName,
 *         listExercises, getExerciseSubstitute, getExerciseMuscleProfiles, validatePlanEquipment (POST, validation only),
 *         getActiveCycle, getLatestAssessment, getScientificEvidence (local corpus).
 *   DRAFT propose_exercise_swap — composes getCurrentProgram + findOccurrencesByName (V1) + substitute/search; persists
 *         nothing and hands over to the existing SUBSTITUTE_SAVED_EXERCISE confirmation flow.
 *   WRITE update_program_exercise, import_ai_plan, skip_workout, cancel_workout, evaluate_cycle — declared for the
 *         long-term design, handler = null: there is no executable path from an agent.
 *   Not included: findTrainingPrograms (POST /workouts/agent/candidates — side effects not verified), roadmap/nutrition/PT.
 */
import { z } from "zod";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { findOccurrencesByName } from "../services/revision/substitute-saved-exercise";
import { createToolRegistry, type ToolRegistryOptions } from "./tool-registry";
import type { AgentToolPolicy, ToolContract } from "./tool-contract";

export type TrainingToolDeps = Pick<typeof fitnessAgentTools,
  | "getUserFitnessContext" | "getCurrentProgram" | "getTodaySchedule" | "searchExerciseByName" | "listExercises"
  | "getExerciseSubstitute" | "getExerciseMuscleProfiles" | "validatePlanEquipment" | "getActiveCycle" | "getLatestAssessment"
  | "getScientificEvidence">;

type C<I, R, O> = ToolContract<I, R, O, TrainingToolDeps>;

// ── shared schemas ───────────────────────────────────────────────────────────────────────────────────────────────────
const text = (max: number) => z.string().trim().min(1).max(max);
const id = text(64);
const empty = z.object({}).strict();
const exerciseRef = z.object({ exerciseId: z.string(), name: z.string() }).strict();
const clip = (s: unknown, max: number) => (typeof s === "string" ? s.slice(0, max) : s);
const GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"] as const;

const programExercise = z.object({
  programExerciseId: z.string(), exerciseId: z.string(), name: z.string(),
  sets: z.number().nullable(), reps: z.union([z.string(), z.number()]).nullable(),
}).strict();
const programOut = z.object({
  programId: z.string(), name: z.string(), daysPerWeek: z.number().nullable(),
  days: z.array(z.object({ dayNumber: z.number(), title: z.string().nullable(), exercises: z.array(programExercise).max(30) }).strict()).max(14),
}).strict().nullable();

function projectProgram(raw: any) {
  if (!raw) return null;
  const days = (Array.isArray(raw.days) ? raw.days : []).slice(0, 14);
  return {
    programId: raw.id, name: clip(raw.name, 120),
    daysPerWeek: typeof raw.daysPerWeek === "number" ? raw.daysPerWeek : days.length,
    days: days.map((d: any) => ({
      dayNumber: Number(d?.dayNumber ?? 0), title: typeof d?.title === "string" ? clip(d.title, 80) : null,
      exercises: (Array.isArray(d?.exercises) ? d.exercises : []).slice(0, 30).map((ex: any) => ({
        programExerciseId: ex?.id, exerciseId: ex?.exerciseId ?? ex?.exercise?.id,
        name: clip(ex?.exercise?.exerciseName ?? ex?.exerciseName, 120),
        sets: typeof ex?.sets === "number" ? ex.sets : null,
        reps: typeof ex?.reps === "string" || typeof ex?.reps === "number" ? ex.reps : null,
      })),
    })),
  };
}

// ── READ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const getProfileContext: C<{}, any, unknown> = {
  id: "training.get_profile_context", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Training profile",
  description: "The signed-in user's training goal, experience level, training days (1=Mon … 7=Sun), session length, injuries and available equipment.",
  llmExposure: "Training fields only. Budget, body composition, nutrition and other personal data are dropped.",
  input: empty,
  output: z.object({
    goal: z.string().nullable(), experienceLevel: z.string().nullable(), trainingDays: z.array(z.number().int().min(1).max(7)).max(7),
    sessionMinutes: z.number().nullable(), injuries: z.array(z.string().max(100)).max(20), equipment: z.array(z.string().max(60)).max(60),
  }).strict(),
  handler: (ctx, _i, deps) => deps.getUserFitnessContext(ctx),
  project: (raw) => {
    const p = raw?.profile ?? {};
    return {
      goal: p.goal ?? null, experienceLevel: p.experienceLevel ?? p.experience ?? null, trainingDays: p.days ?? [],
      sessionMinutes: typeof p.sessionMinutes === "number" ? p.sessionMinutes : null,
      injuries: (p.injuries ?? []).slice(0, 20).map((s: unknown) => clip(s, 100)),
      equipment: (p.equipment ?? []).slice(0, 60).map((s: unknown) => clip(s, 60)),
    };
  },
};

const getCurrentProgram: C<{}, any, unknown> = {
  id: "training.get_current_program", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Current workout program",
  description: "The user's active workout program: days and exercises (canonical exerciseId, sets, reps). null when there is none.",
  llmExposure: "Program/day/exercise ids, names, sets and reps. No owner id, schedule internals or notes.",
  input: empty, output: programOut,
  handler: (ctx, _i, deps) => deps.getCurrentProgram(ctx),
  project: projectProgram,
};

const getTodaySchedule: C<{}, any, unknown> = {
  id: "training.get_today_schedule", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Today's scheduled workouts",
  description: "Workout sessions scheduled for today (Asia/Ho_Chi_Minh), with status and number of exercises.",
  llmExposure: "Schedule id, date, status, title, exercise count.",
  input: empty,
  output: z.array(z.object({ scheduleId: z.string(), date: z.string().nullable(), status: z.string().nullable(), title: z.string().nullable(), exerciseCount: z.number() }).strict()).max(10),
  handler: (ctx, _i, deps) => deps.getTodaySchedule(ctx),
  project: (raw) => (Array.isArray(raw) ? raw : []).slice(0, 10).map((s: any) => ({
    scheduleId: s?.id, date: s?.scheduledDate ?? s?.date ?? null, status: s?.status ?? null,
    title: typeof s?.title === "string" ? clip(s.title, 80) : null, exerciseCount: Array.isArray(s?.exercises) ? s.exercises.length : 0,
  })),
};

const searchExercise: C<{ name: string }, any, unknown> = {
  id: "training.search_exercise", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Find an exercise by name",
  description: "Resolves an exercise name to the canonical catalog exercise (exerciseId). null when nothing matches — never invent one.",
  llmExposure: "exerciseId and catalog name.",
  input: z.object({ name: text(120) }).strict(),
  output: exerciseRef.nullable(),
  handler: (ctx, i, deps) => deps.searchExerciseByName(ctx, i.name),
  project: (raw) => (raw ? { exerciseId: raw.id, name: raw.exerciseName } : null),
};

const listExercises: C<{ bodyPart?: string; typeOfEquipment?: string; limit?: number }, any, unknown> = {
  id: "training.list_exercises", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Browse the exercise catalog",
  description: "Catalog exercises filtered by body part and/or equipment type.",
  llmExposure: "exerciseId and name only (instructions are not sent).",
  input: z.object({ bodyPart: text(40).optional(), typeOfEquipment: text(40).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  output: z.array(exerciseRef).max(50),
  handler: (ctx, i, deps) => deps.listExercises(ctx, { bodyPart: i.bodyPart, typeOfEquipment: i.typeOfEquipment, limit: i.limit ?? 20 }),
  project: (raw) => (Array.isArray(raw) ? raw : []).slice(0, 50).map((e: any) => ({ exerciseId: e?.id, name: e?.exerciseName })),
};

const getExerciseSubstitute: C<{ exerciseId: string; excludeExerciseIds?: string[] }, any, unknown> = {
  id: "training.get_exercise_substitute", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Best substitute for an exercise",
  description: "The deterministic substitution engine's best alternative for an exercise, given the user's equipment. null when there is none.",
  llmExposure: "exerciseId and catalog name.",
  input: z.object({ exerciseId: id, excludeExerciseIds: z.array(id).max(20).optional() }).strict(),
  output: exerciseRef.nullable(),
  handler: (ctx, i, deps) => deps.getExerciseSubstitute(ctx, i.exerciseId, i.excludeExerciseIds ?? []),
  project: (raw) => (raw ? { exerciseId: raw.id, name: raw.exerciseName } : null),
};

const getExerciseMuscleProfiles: C<{ exerciseIds: string[] }, any, unknown> = {
  id: "training.get_exercise_muscle_profiles", domain: "training", kind: "READ", timeoutMs: 25_000,
  title: "Muscles worked by exercises",
  description: "Canonical body part and muscle groups for catalog exercise ids. Ids the catalog does not return are unknown.",
  llmExposure: "exerciseId, name, bodyPart, muscleGroups.",
  input: z.object({ exerciseIds: z.array(id).min(1).max(50) }).strict(),
  output: z.array(z.object({ exerciseId: z.string(), name: z.string().nullable(), bodyPart: z.string().nullable(), muscleGroups: z.array(z.string()) }).strict()).max(50),
  handler: (ctx, i, deps) => deps.getExerciseMuscleProfiles(ctx, i.exerciseIds),
  project: (raw) => (Array.isArray(raw) ? raw : []).slice(0, 50).map((e: any) => ({
    exerciseId: e?.id, name: e?.name ?? null, bodyPart: e?.bodyPart ?? null, muscleGroups: Array.isArray(e?.muscleGroups) ? e.muscleGroups : [],
  })),
};

const validatePlanEquipment: C<{ weeklySchedule: Array<{ day: string; exercises: Array<{ exerciseId: string; name?: string }> }> }, any, unknown> = {
  id: "training.validate_plan_equipment", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Check a plan against the user's equipment",
  description: "Runs the same equipment validator fitness-service applies at confirm time. Validation only — nothing is saved.",
  llmExposure: "valid flag, violations (exercise, day, required/available equipment, alternatives).",
  input: z.object({
    weeklySchedule: z.array(z.object({ day: text(20), exercises: z.array(z.object({ exerciseId: id, name: text(120).optional() }).strict()).min(1).max(30) }).strict()).min(1).max(7),
  }).strict(),
  output: z.object({
    valid: z.boolean(), skippedNoUserEquipment: z.boolean(),
    violations: z.array(z.object({ exerciseId: z.string(), exerciseName: z.string().nullable(), day: z.string().nullable(), required: z.array(z.string()), alternatives: z.array(z.string()) }).strict()).max(50),
  }).strict(),
  handler: (ctx, i, deps) => deps.validatePlanEquipment(ctx, i.weeklySchedule),
  project: (raw) => ({
    valid: raw?.valid, skippedNoUserEquipment: raw?.skippedNoUserEquipment,
    violations: (raw?.violations ?? []).slice(0, 50).map((v: any) => ({
      exerciseId: v?.exerciseId, exerciseName: v?.exerciseName ?? null, day: v?.day ?? null, required: v?.required ?? [], alternatives: v?.alternatives ?? [],
    })),
  }),
};

const getActiveCycle: C<{}, any, unknown> = {
  id: "training.get_active_cycle", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Active training cycle",
  description: "The user's active training cycle (id, status, dates). Fails with a domain error when there is none.",
  llmExposure: "cycleId, status, start/end dates, week number.",
  input: empty,
  output: z.object({ cycleId: z.string(), status: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable(), weekNumber: z.number().nullable() }).strict(),
  handler: (ctx, _i, deps) => deps.getActiveCycle(ctx),
  project: (raw) => {
    const c = raw?.cycle ?? {};
    return { cycleId: c.id, status: c.status ?? null, startDate: c.startDate ?? null, endDate: c.endDate ?? null, weekNumber: typeof c.weekNumber === "number" ? c.weekNumber : null };
  },
};

const getLatestAssessment: C<{ cycleId: string }, any, unknown> = {
  id: "training.get_latest_assessment", domain: "training", kind: "READ", timeoutMs: 20_000,
  title: "Latest cycle assessment (training)",
  description: "The latest CycleAssessment of a cycle: the training decision (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) and the user's response.",
  llmExposure: "Training decision fields only; nutrition decision fields are not exposed to the Training Agent.",
  input: z.object({ cycleId: z.string().uuid() }).strict(),
  output: z.object({ assessmentId: z.string(), cycleId: z.string(), decision: z.string().nullable(), userDecision: z.string() }).strict(),
  handler: (ctx, i, deps) => deps.getLatestAssessment(ctx, i.cycleId),
  project: (raw) => ({ assessmentId: raw?.id, cycleId: raw?.cycleId, decision: raw?.decision ?? null, userDecision: raw?.userDecision }),
};

const getScientificEvidence: C<{ goal: (typeof GOALS)[number] }, any, unknown> = {
  id: "training.get_scientific_evidence", domain: "training", kind: "READ", timeoutMs: 2_000,
  title: "Curated training evidence",
  description: "Short excerpts from the curated local evidence corpus relevant to a goal. Not user data.",
  llmExposure: "Document id, title, source URL, evidence level, an excerpt of at most 300 characters.",
  input: z.object({ goal: z.enum(GOALS) }).strict(),
  output: z.array(z.object({ id: z.string(), title: z.string(), sourceUrl: z.string().nullable(), evidenceLevel: z.string(), finding: z.string().max(300) }).strict()).max(4),
  handler: async (_ctx, i, deps) => deps.getScientificEvidence(i.goal),
  project: (raw) => (Array.isArray(raw) ? raw : []).slice(0, 4).map((d: any) => ({
    id: d?.id, title: clip(d?.title, 200), sourceUrl: d?.sourceUrl ?? null, evidenceLevel: d?.evidenceLevel ?? "UNSPECIFIED", finding: clip(d?.finding ?? "", 300),
  })),
};

// ── DRAFT ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const proposeExerciseSwap: C<{ currentExerciseName: string; desiredExerciseName?: string }, any, unknown> = {
  id: "training.propose_exercise_swap", domain: "training", kind: "DRAFT", timeoutMs: 25_000,
  title: "Propose swapping an exercise in the saved program",
  description: "Builds a swap PROPOSAL for the active program. Saves nothing: the user must confirm through the existing confirmation flow.",
  llmExposure: "Proposal status, from/to exercise (id, name), the affected program slots.",
  input: z.object({ currentExerciseName: text(120), desiredExerciseName: text(120).optional() }).strict(),
  output: z.union([
    z.object({
      status: z.literal("PROPOSED"), requiresConfirmation: z.literal(true), confirmationWorkflow: z.literal("SUBSTITUTE_SAVED_EXERCISE"),
      from: exerciseRef, to: exerciseRef,
      occurrences: z.array(z.object({ programExerciseId: z.string(), dayNumber: z.number(), dayTitle: z.string().nullable() }).strict()).max(30),
    }).strict(),
    z.object({ status: z.enum(["NO_ACTIVE_PROGRAM", "NOT_IN_PROGRAM", "NO_CANDIDATE"]) }).strict(),
    z.object({ status: z.literal("AMBIGUOUS"), names: z.array(z.string()).max(10) }).strict(),
  ]),
  handler: async (ctx, i, deps) => {
    const program = await deps.getCurrentProgram(ctx);
    if (!program) return { status: "NO_ACTIVE_PROGRAM" };
    const found = findOccurrencesByName(program, i.currentExerciseName);
    if (found.kind === "none") return { status: "NOT_IN_PROGRAM" };
    if (found.kind === "ambiguous") return { status: "AMBIGUOUS", names: found.names.slice(0, 10) };
    const first = found.occurrences[0];
    const fromId = String(first.exerciseId);
    const target = i.desiredExerciseName
      ? await deps.searchExerciseByName(ctx, i.desiredExerciseName)
      : await deps.getExerciseSubstitute(ctx, fromId, [fromId]);
    if (!target || target.id === fromId) return { status: "NO_CANDIDATE" };
    return {
      status: "PROPOSED", requiresConfirmation: true, confirmationWorkflow: "SUBSTITUTE_SAVED_EXERCISE",
      from: { exerciseId: fromId, name: first.exerciseName }, to: { exerciseId: target.id, name: target.exerciseName },
      occurrences: found.occurrences.slice(0, 30).map((o) => ({ programExerciseId: o.programExerciseId, dayNumber: o.dayNumber, dayTitle: o.dayTitle ?? null })),
    };
  },
  project: (raw) => raw,
};

// ── WRITE (declared, never executable by an agent) ───────────────────────────────────────────────────────────────────
const write = (toolId: string, title: string, input: z.ZodTypeAny): C<any, unknown, unknown> => ({
  id: toolId, domain: "training", kind: "WRITE", timeoutMs: 20_000, title,
  description: `${title}. WRITE: only reachable through the user's explicit confirmation flow in V1, never as an agent tool call.`,
  llmExposure: "Not exposed: no agent may call this tool.",
  input, output: z.unknown(), handler: null, project: (r) => r,
});
const writeContracts = [
  write("training.update_program_exercise", "Replace an exercise in the saved program", z.object({ programExerciseId: id, exerciseId: id }).strict()),
  write("training.import_ai_plan", "Save a generated plan as the active program", z.object({ planId: id }).strict()),
  write("training.skip_workout", "Skip a scheduled workout", z.object({ scheduleId: id }).strict()),
  write("training.cancel_workout", "Cancel a scheduled workout", z.object({ scheduleId: id }).strict()),
  write("training.evaluate_cycle", "Run a cycle evaluation (creates a CycleAssessment)", z.object({ cycleId: z.string().uuid() }).strict()),
];

export const TRAINING_TOOL_CONTRACTS: ReadonlyArray<C<any, any, unknown>> = [
  getProfileContext, getCurrentProgram, getTodaySchedule, searchExercise, listExercises, getExerciseSubstitute,
  getExerciseMuscleProfiles, validatePlanEquipment, getActiveCycle, getLatestAssessment, getScientificEvidence,
  proposeExerciseSwap, ...writeContracts,
];
export const TRAINING_READ_TOOL_IDS = TRAINING_TOOL_CONTRACTS.filter((c) => c.kind === "READ").map((c) => c.id);
export const TRAINING_DRAFT_TOOL_IDS = TRAINING_TOOL_CONTRACTS.filter((c) => c.kind === "DRAFT").map((c) => c.id);
export const TRAINING_WRITE_TOOL_IDS = TRAINING_TOOL_CONTRACTS.filter((c) => c.kind === "WRITE").map((c) => c.id);

/** P2 pilot: READ only. DRAFT needs a separate decision; WRITE is never grantable. */
export const TRAINING_AGENT_PILOT_POLICY: AgentToolPolicy = Object.freeze({
  agentId: "training-agent-pilot",
  allowedTools: Object.freeze([...TRAINING_READ_TOOL_IDS]),
  allowDraft: false,
});

/** Registry with every training contract. deps default to the V1 domain tools; flag default = AI_AGENT_V2 (OFF). */
export function createTrainingToolRegistry(options: Omit<ToolRegistryOptions<TrainingToolDeps>, "deps"> & { deps?: TrainingToolDeps } = {}) {
  const registry = createToolRegistry<TrainingToolDeps>({ ...options, deps: options.deps ?? fitnessAgentTools });
  for (const c of TRAINING_TOOL_CONTRACTS) registry.register(c);
  return registry;
}
