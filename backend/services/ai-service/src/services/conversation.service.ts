import { z } from "zod";
import { logger } from "@gym-coach/shared";
import {
  conversationRepository,
  PlanStatus,
} from "../repositories/conversation.repository";
import { llmService } from "./llm.service";
import { randomUUID, createHash } from "node:crypto";
import { submitGeneration, findActiveRevisionOperation, findRevisionOperationByKey } from "./generation-operations";
import type { GenerateWorkoutRequest } from "../schemas/ai.schemas";
import type { GeneratePlanRequest as PlanGenerateRequest } from "../schemas/plan.schemas";
import { ApiError, LlmGenerationError } from "../errors/api-error";
import { parseWorkoutAdjustment, resolveExercisesPerDay } from "./revision/workout-adjustment-constraints";

// Quick-workout exercise schema, simpler than the full multi-week plan.
const QuickExerciseSchema = z.object({
  name: z.string().min(1).max(200),
  sets: z.number().int().min(1).max(10),
  reps: z.union([z.number().int().min(1), z.string().min(1)]).transform(String),
  duration: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
});
type QuickExercise = z.infer<typeof QuickExerciseSchema>;

function parseExercisesFromLlm(rawAnswer: string): QuickExercise[] {
  const arrayMatch = rawAnswer.match(/\[[\s\S]*?\]/);
  if (!arrayMatch) {
    logger.warn(
      { answerSnippet: rawAnswer.slice(0, 200) },
      "generateWorkout: no JSON array found in LLM answer",
    );
    throw new LlmGenerationError("LLM returned malformed workout output");
  }
  try {
    const parsed: unknown = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) {
      throw new LlmGenerationError(
        "LLM workout output did not include an exercises array",
      );
    }
    const exercises = parsed
      .map((item) => QuickExerciseSchema.safeParse(item))
      .filter((r): r is z.SafeParseSuccess<QuickExercise> => r.success)
      .map((r) => r.data);
    if (exercises.length === 0) {
      throw new LlmGenerationError(
        "LLM workout output did not include valid exercises",
      );
    }
    return exercises;
  } catch (err) {
    if (err instanceof LlmGenerationError) throw err;
    logger.warn({ err }, "generateWorkout: failed to parse exercises JSON");
    throw new LlmGenerationError("LLM returned malformed workout JSON");
  }
}

/**
 * Business identity of ONE adjust request (what an Idempotency-Key is bound to): the authenticated user, the plan, the version the caller saw,
 * the explicit structured parameters, and the CANONICAL meaning of the text (whitespace/case-insensitive text + what the parser extracts from it).
 * It is computed from the REQUEST only — never from the plan content at retry time — so a retry made after the plan moved on still matches.
 */
export function adjustmentActionFingerprint(p: { userId: string; planId: string; adjustments: string; expectedVersion?: number; daysPerWeek?: number; exercisesPerDay?: number }): string {
  const text = String(p.adjustments ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const c = parseWorkoutAdjustment(text);
  const intent = { perDay: c.exercisesPerDay ?? null, perDayDelta: c.exercisesDelta ?? null, days: c.daysPerWeek ?? null, daysDelta: c.daysDelta ?? null, keep: c.keepExisting ?? false, ordinal: c.replaceOrdinal ?? null, exclude: c.excludeLabels, focus: c.addFocus };
  return createHash("sha256").update(JSON.stringify({ u: p.userId, p: p.planId, v: p.expectedVersion ?? null, d: p.daysPerWeek ?? null, e: p.exercisesPerDay ?? null, t: text, i: intent })).digest("hex");
}

export const conversationService = {
  async getConversations(userId: string, limit = 10) {
    const conversations = await conversationRepository.findMany(
      { userId },
      limit,
    );
    return { conversations };
  },

  async submitFeedback(conversationId: string, feedback: number) {
    await conversationRepository.updateFeedback(conversationId, feedback);
    return { success: true, message: "Feedback recorded" };
  },

  async getFeedbackStats() {
    const [total, thumbsUp, thumbsDown] = await Promise.all([
      conversationRepository.count(),
      conversationRepository.count({ feedback: 1 }),
      conversationRepository.count({ feedback: -1 }),
    ]);
    return {
      totalConversations: total,
      thumbsUp,
      thumbsDown,
      satisfactionRate:
        total > 0 ? Number(((thumbsUp / total) * 100).toFixed(1)) : 0,
    };
  },

  async generateWorkout(params: GenerateWorkoutRequest) {
    const { goal, duration, equipment, bodyParts } = params;
    const prompt = `Generate a single workout session with these requirements:
- Goal: ${goal}
- Session duration: ${duration} minutes
- Available equipment: ${equipment.length ? equipment.join(", ") : "bodyweight only"}
- Target body parts: ${bodyParts.length ? bodyParts.join(", ") : "full body"}

Return ONLY a JSON array of exercises. No markdown, no explanation.
[
  { "name": "Exercise Name", "sets": 3, "reps": "10", "duration": null, "weight": null }
]`.trim();

    const llmResponse = await llmService.callLLM(prompt);
    const exercises = parseExercisesFromLlm(llmResponse.answer);

    return {
      name: `${goal} Workout`,
      description: `AI-generated workout for ${goal}`,
      duration,
      exercises,
    };
  },

  async queuePlanGeneration(
    params: PlanGenerateRequest & {
      userId: string;
      ptUserId?: string | null;
      clientName?: string | null;
      exercisesPerDay?: number;
      trainingLocation?: string;
      equipmentPreference?: string;
      /** Stable identity of the logical request (retries reuse it). Omit for a one-off operation. */
      idempotencyKey?: string;
    },
  ) {
    const {
      userId,
      goal,
      durationWeeks,
      daysPerWeek,
      exercisesPerDay,
      ptUserId = null,
      clientName = null,
      trainingLocation,
      equipmentPreference,
    } = params;

    const op = await submitGeneration({
      actorUserId: userId,
      subjectUserId: ptUserId,
      kind: "WORKOUT_PLAN",
      idempotencyKey: params.idempotencyKey ?? `auto:${randomUUID()}`,
      planCreate: {
        userId,
        name: `${goal} Plan`,
        description: `${durationWeeks}-week ${goal} program, ${daysPerWeek} days/week`,
        goal,
        duration: durationWeeks,
        daysPerWeek,
        ptUserId,
        clientName,
      },
      job: {
        userId,
        goal,
        durationWeeks,
        daysPerWeek,
        exercisesPerDay,
        trainingLocation: trainingLocation ?? "GYM",
        equipmentPreference: equipmentPreference ?? "MIXED_GYM",
      },
    });

    logger.info(
      { planId: op.planId, jobId: op.jobId, operationId: op.operationId, reused: op.reused, userId, ptUserId },
      "Plan generation queued",
    );
    return { planId: op.planId, jobId: op.jobId ?? op.operationId, status: PlanStatus.QUEUED };
  },

  /**
   * Idempotent replay of an adjust request. A key is bound to ONE business action (see adjustmentActionFingerprint):
   *  - same key + same action  -> the ORIGINAL operation is returned with its REAL status — a FAILED one stays FAILED (it is never silently
   *    restarted; a new attempt needs a new key), a finished one stays finished even though the plan has since moved to a newer version;
   *  - same key + different action (user, plan, expectedVersion, parameters or meaning of the text) -> 409 IDEMPOTENCY_KEY_CONFLICT;
   *  - an operation still IN FLIGHT on an unchanged plan is not answered here: the normal path re-publishes it if its message was lost.
   * Returns null when there is nothing to replay. Runs BEFORE any plan-content judgement, swap resolution or LLM health probe: those look at the
   * CURRENT plan, which a successful first request has already changed.
   */
  async findAdjustmentReplay(params: {
    userId: string; planId: string; currentVersion: number; idempotencyKey?: string;
    adjustments: string; expectedVersion?: number; daysPerWeek?: number; exercisesPerDay?: number;
  }) {
    if (!params.idempotencyKey) return null;
    const prior = await findRevisionOperationByKey(params.userId, params.idempotencyKey);
    if (!prior) return null;
    const conflict = () => new ApiError("IDEMPOTENCY_KEY_CONFLICT", "This idempotency key was already used with different input.", 409);
    // Still RESERVING (a double tap whose first request has not been admitted yet): no target and no payload to compare — the generic path answers it
    // (the operation fingerprint rejects a different payload; the same one is "already being processed").
    if (!prior.targetId) return null;
    if (prior.targetId !== params.planId) throw conflict();
    const pc = (prior.payload as any)?.planCreate ?? {};
    const mine = adjustmentActionFingerprint({ userId: params.userId, planId: params.planId, adjustments: params.adjustments, expectedVersion: params.expectedVersion, daysPerWeek: params.daysPerWeek, exercisesPerDay: params.exercisesPerDay });
    // Operations created before the fingerprint existed only carry the text.
    const same = pc.actionFingerprint ? pc.actionFingerprint === mine : String(pc.adjustments ?? "") === String(params.adjustments ?? "");
    if (!same) throw conflict();
    const base = Number(pc.baseVersion);
    const terminal = prior.status === "COMPLETED" || prior.status === "FAILED";
    if (!terminal && base === params.currentVersion) return null;
    let status: PlanStatus;
    if (prior.status === "COMPLETED") status = (await conversationRepository.findRevisionByOperation(prior.id)) ? PlanStatus.COMPLETED : PlanStatus.FAILED; // COMPLETED without a committed revision = an old worker
    else if (prior.status === "FAILED") status = PlanStatus.FAILED;
    else status = prior.status === "RUNNING" ? PlanStatus.PROCESSING : PlanStatus.QUEUED;
    return { planId: params.planId, jobId: prior.id, revisionJobId: prior.id, version: base + 1, expectedVersion: base, status, revision: true as const, replayed: true as const };
  },

  async queuePlanAdjustment(params: {
    originalPlanId: string;
    userId: string;
    adjustments: string;
    daysPerWeek?: number;
    exercisesPerDay?: number;
    idempotencyKey?: string;
    /** Resolved "đổi X thành Y" (plan.controller resolveExerciseSwap). */
    swap?: { fromNames: string[]; toExerciseId?: string; toName?: string };
    /** Optimistic concurrency token: the version the caller saw. */
    expectedVersion?: number;
  }) {
    const original = await conversationRepository.findPlanById(
      params.originalPlanId,
    );
    if (!original) {
      throw new ApiError(
        "PLAN_NOT_FOUND",
        `Plan ${params.originalPlanId} not found`,
        404,
      );
    }
    if (original.userId !== params.userId) {
      throw new ApiError(
        "FORBIDDEN",
        "You do not have access to this plan",
        403,
      );
    }
    if (original.status !== PlanStatus.COMPLETED) {
      throw new ApiError(
        "PLAN_NOT_COMPLETED",
        "Only COMPLETED plans can be adjusted. Wait for the current plan to finish generating.",
        409,
      );
    }

    if ((original as any).archivedAt) {
      throw new ApiError("VALIDATION_ERROR", "Kế hoạch này đã được ẩn và không thể điều chỉnh", 409);
    }
    // RETRY of a request that already reached the server (client timed out / gateway cut the response): answered from the operation it created.
    const replay = await this.findAdjustmentReplay({
      userId: params.userId, planId: original.id, currentVersion: original.version, idempotencyKey: params.idempotencyKey,
      adjustments: params.adjustments, expectedVersion: params.expectedVersion, daysPerWeek: params.daysPerWeek, exercisesPerDay: params.exercisesPerDay,
    });
    if (replay) return replay;
    // A plan that is listed on the marketplace is a moderated product whose buyers read this very row: it is never edited in place.
    const listed = await conversationRepository.countActiveListings(original.id);
    if (listed > 0) {
      throw new ApiError("VALIDATION_ERROR", "Kế hoạch này đang được đăng trên chợ nên không thể điều chỉnh tại chỗ. Hãy gỡ bản đăng hoặc tạo bản sao rồi điều chỉnh.", 409);
    }
    // Optimistic concurrency: the caller adjusted the version it SAW. A newer one means someone/something already revised the plan.
    if (params.expectedVersion !== undefined && params.expectedVersion !== original.version) {
      throw new ApiError("VERSION_CONFLICT", `Kế hoạch đã được cập nhật (phiên bản ${original.version}, bạn đang xem ${params.expectedVersion}). Hãy tải lại rồi điều chỉnh bản mới nhất.`, 409);
    }
    const idempotencyKey = params.idempotencyKey ?? `auto:${randomUUID()}`;
    // One revision at a time per plan: a second request while one is still running would only race the first to the same base version
    // (the commit would reject it anyway, after a paid model call). The SAME request retried (same key) is not "another" revision.
    const inFlight = await findActiveRevisionOperation(original.id);
    if (inFlight && inFlight.idempotencyKey !== idempotencyKey) {
      throw new ApiError("REVISION_IN_PROGRESS", "Kế hoạch này đang được AI điều chỉnh. Hãy đợi bản điều chỉnh hiện tại hoàn tất rồi thử lại.", 409);
    }

    const newVersion = original.version + 1;
    const originalPlanContent = original.plan as {
      exercisesPerDay?: number;
      weeklySchedule?: Array<{ day?: string; goal?: string; cardio?: string; exercises?: Array<{ exerciseId?: string; name?: string; sets?: number; reps?: string }> }>;
    } | null;
    const schedule = originalPlanContent?.weeklySchedule ?? [];
    // Structured constraints. The user's NEW numbers always win over the stored ones ("lên 7 bài" must never keep the old 4).
    const parsedText = parseWorkoutAdjustment(params.adjustments ?? "");
    const relativeDays =
      parsedText.daysDelta !== undefined
        ? Math.min(7, Math.max(1, original.daysPerWeek + parsedText.daysDelta))
        : undefined;
    const daysPerWeek = params.daysPerWeek ?? parsedText.daysPerWeek ?? relativeDays ?? original.daysPerWeek;
    const currentPerDay = schedule.length ? Math.max(...schedule.map((d) => d.exercises?.length ?? 0)) : (originalPlanContent?.exercisesPerDay ?? 4);
    const resolved = resolveExercisesPerDay({ explicit: params.exercisesPerDay, parsed: parsedText, current: currentPerDay || 4 });
    if (!resolved.ok) throw new ApiError(resolved.code === "AMBIGUOUS" ? "NEEDS_CLARIFICATION" : "VALIDATION_ERROR", resolved.message, 422);
    const exercisesPerDay = resolved.target;
    // The plan being adjusted, so the model EDITS it instead of generating an unrelated new one (adjust eval 2026-11-11).
    const previousPlan = schedule.slice(0, 7).map((d) => ({
      goal: String(d.goal ?? "").slice(0, 80),
      cardio: d.cardio ? String(d.cardio).slice(0, 120) : undefined,
      exercises: (d.exercises ?? []).slice(0, 10).map((e) => ({
        exerciseId: String(e.exerciseId ?? ""), name: String(e.name ?? "").slice(0, 100), sets: Number(e.sets) || undefined, reps: e.reps ? String(e.reps).slice(0, 20) : undefined,
      })),
    }));

    // The operation row IS the revision job; its target is the EXISTING plan (stable id) — no WorkoutPlan row is created, the plan stays
    // COMPLETED and usable while the revision runs, and a failure leaves it exactly as it was.
    const op = await submitGeneration({
      actorUserId: params.userId,
      kind: "PLAN_ADJUSTMENT",
      idempotencyKey,
      planCreate: {
        userId: params.userId,
        originalPlanId: params.originalPlanId,
        baseVersion: original.version,
        adjustments: params.adjustments,
        // The business identity of this request (bound to the Idempotency-Key). baseVersion above is the RECORD of what it was applied to.
        actionFingerprint: adjustmentActionFingerprint({ userId: params.userId, planId: original.id, adjustments: params.adjustments, expectedVersion: params.expectedVersion, daysPerWeek: params.daysPerWeek, exercisesPerDay: params.exercisesPerDay }),
      },
      job: {
        userId: params.userId,
        goal: original.goal,
        durationWeeks: original.duration,
        daysPerWeek,
        exercisesPerDay,
        adjustmentContext: params.adjustments,
        previousPlan,
        baseVersion: original.version,
        exercisesPerDaySource: resolved.source,
        ...(params.swap ? { swap: params.swap } : {}),
      },
    });

    logger.info(
      { planId: op.planId, baseVersion: original.version, targetVersion: newVersion, exercisesPerDay, source: resolved.source, operationId: op.operationId, reused: op.reused },
      "Plan revision queued (in place)",
    );
    // Backward compatible: jobId/planId/version/status are what existing pollers read; planId is now the SAME id as the request's.
    return {
      planId: op.planId,
      jobId: op.jobId ?? op.operationId,
      revisionJobId: op.operationId,
      version: newVersion,
      expectedVersion: original.version,
      status: PlanStatus.QUEUED,
      revision: true,
    };
  },

  // Nutrition plan queueing.

  async queueNutritionPlanGeneration(params: {
    userId: string;
    goal: string;
    durationWeeks: number;
    mealsPerDay: number;
    dailyCaloriesTarget?: number;
    dietPreference?: string;
    budgetLevel?: string;
    cuisineCountry?: string;
    vietnameseRegion?: "BAC" | "TRUNG" | "NAM";
    restrictions?: string[];
    excludedFoodKeys?: string[];
    notes?: string;
    // Extended
    weightKg?: number;
    heightCm?: number;
    age?: number;
    gender?: string;
    bodyFatPct?: number;
    activityLevel?: string;
    trainingDaysPerWeek?: number;
    trainingDurationMin?: number;
    trainingType?: string;
    trainingPhase?: string;
    experienceLevel?: string;
    primaryPriority?: string;
    weightChangeRateKgPerWeek?: number;
    proteinTargetG?: number;
    carbTargetG?: number;
    fatTargetG?: number;
    carbsAroundWorkout?: boolean;
    preworkoutMeal?: boolean;
    postworkoutMeal?: boolean;
    autoSaveOnComplete?: boolean;
    idempotencyKey?: string;
  }) {
    const { userId, goal, durationWeeks, mealsPerDay } = params;

    const { idempotencyKey, ...jobParams } = params;
    const op = await submitGeneration({
      actorUserId: userId,
      kind: "NUTRITION_PLAN",
      idempotencyKey: idempotencyKey ?? `auto:${randomUUID()}`,
      planCreate: { userId, name: `Ke hoach dinh duong - ${goal}`, goal, durationWeeks, mealsPerDay },
      job: {
        ...jobParams,
        restrictions: params.restrictions ?? [],
        excludedFoodKeys: params.excludedFoodKeys ?? [],
      },
    });

    logger.info(
      { planId: op.planId, jobId: op.jobId, operationId: op.operationId, reused: op.reused, userId },
      "Nutrition plan generation queued",
    );
    return { planId: op.planId, jobId: op.jobId ?? op.operationId, status: PlanStatus.QUEUED };
  },
};
