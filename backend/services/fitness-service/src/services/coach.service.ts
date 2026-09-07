/**
 * Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — PT/coach access to
 * a client's fitness data + plan assignment, built on top of the existing
 * `Contract` model (user-service) rather than a new relation table (see the
 * audit doc's "Existing PT infrastructure to REUSE" finding).
 *
 * Every method here re-checks the ACTIVE PT-client relationship fresh, per
 * call, via a real cross-service HTTP call (isActivePtClientRelationship) —
 * never cached, never trusted from a prior request, per the audit doc's own
 * risk note ("new PT cross-service surface must re-validate
 * Contract.status===ACTIVE per-request").
 */
import { prisma } from "../repositories/prisma";
import { logger } from "@gym-coach/shared";
import { isActivePtClientRelationship, fetchUserProfile } from "../clients/user.client";
import { generateClientPlanDraftSafe } from "../clients/ai.client";
import { trainingCycleService, findAssessmentForNutritionReview } from "./training-cycle.service";
import { cycleFeedbackAggregator } from "./cycle-feedback-aggregator";
import { workoutService } from "./workout.service";
import { createPersistentNotification } from "../clients/notification.client";
import { nutritionRepository } from "../repositories/nutrition.repository";
import type { CreateManualProgramDto } from "../models/fitness.models";

/** Indirection point for tests — mutating this object's method (the same
 * pattern ai-service's cycle-assessment.test.ts uses for llmService.callLLM/
 * retriever.retrieveEvidence) is how the cross-service relationship check
 * gets stubbed in coach.service.integration.test.ts. A plain named-import
 * binding can't be reassigned from a test (ESM namespace properties are
 * getter-only) — this plain mutable object exists specifically so it can. */
export const coachDeps = {
  isActivePtClientRelationship,
};

export const coachService = {
  async assertActivePtClientRelationship(ptUserId: string, clientUserId: string): Promise<void> {
    const active = await coachDeps.isActivePtClientRelationship(ptUserId, clientUserId);
    if (!active) {
      throw { status: 403, message: "No active PT-client relationship with this client" };
    }
  },

  /** Everything a PT needs to make a plan decision for a client: current
   * active cycle (if any), its rolling summary, the deterministic feedback
   * summary, and the last two prior-cycle decisions — the same inputs the
   * Decision Engine itself uses (see cycle-decision.engine.ts), so a PT
   * reviewing this sees exactly what informed the client's own AI
   * recommendations, not a separate ad-hoc view. */
  async getClientSummary(ptUserId: string, clientUserId: string) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);

    let activeCycle: Awaited<ReturnType<typeof trainingCycleService.getActiveCycle>> | null = null;
    try {
      activeCycle = await trainingCycleService.getActiveCycle(clientUserId);
    } catch (err: any) {
      if (err?.status !== 404) throw err; // 404 ("no active cycle") is an expected, normal state here
    }

    let feedbackSummary = null;
    let priorDecisions: string[] = [];
    if (activeCycle) {
      feedbackSummary = await cycleFeedbackAggregator.computeAndPersist(activeCycle.cycle.id);
      priorDecisions = await trainingCycleService.getPriorCycleDecisions(clientUserId, activeCycle.cycle.id);
    }

    // AI Nutrition Cycle Engine (Gymini) — spec §XXIII: a PT must be able to
    // see a client's current nutrition target and the AI's latest nutrition
    // recommendation from the SAME summary call, not a separate page/round
    // trip. Never blocks the rest of this summary if either lookup fails.
    let nutrition: {
      activeGoal: Awaited<ReturnType<typeof nutritionRepository.findGoalByUserId>>;
      latestNutritionDecision: {
        assessmentId: string | null;
        decision: string | null;
        confidence: string | null;
        headline: string | null;
        explanation: string | null;
        userDecision: string;
        reviewedAt: Date | null;
        reviewedByRole: string | null;
        ptNote: string | null;
        // Phase 2 PT workflow — true only when there's a real, still-
        // actionable proposal (PENDING + proposedChanges present) for this
        // PT to Approve/Modify/Reject; false for KEEP_PLAN-type decisions
        // (nothing to act on) or an already-reviewed one.
        canPtAct: boolean;
      } | null;
    } = { activeGoal: null, latestNutritionDecision: null };
    try {
      nutrition.activeGoal = await nutritionRepository.findGoalByUserId(clientUserId);
    } catch (err) {
      logger.warn({ err: (err as Error).message, clientUserId }, "[coach] client nutrition goal lookup failed");
    }
    if (activeCycle) {
      try {
        const assessment = await findAssessmentForNutritionReview(activeCycle.cycle.id);
        if (assessment?.nutritionDecision) {
          nutrition.latestNutritionDecision = {
            assessmentId: assessment.id,
            decision: assessment.nutritionDecision,
            confidence: assessment.nutritionConfidence,
            headline: assessment.nutritionAiHeadline,
            explanation: assessment.nutritionAiExplanation,
            userDecision: assessment.nutritionUserDecision,
            reviewedAt: assessment.nutritionReviewedAt,
            reviewedByRole: assessment.nutritionReviewedByRole,
            ptNote: assessment.nutritionPtNote,
            canPtAct:
              assessment.nutritionUserDecision === "PENDING" &&
              assessment.nutritionProposedChanges != null,
          };
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, clientUserId }, "[coach] client latest assessment lookup failed");
      }
    }

    try {
      await prisma.coachClientActionAudit.create({
        data: {
          ptUserId,
          clientUserId,
          action: "VIEW_CLIENT_SUMMARY",
          metadata: { hasActiveCycle: !!activeCycle } as any,
        },
      });
    } catch (err) {
      // Audit-write failure must never block a PT from viewing real client
      // data they're already authorized for (same tolerance as
      // recommendationAudit's write in training-cycle.service.ts).
      logger.warn({ err: (err as Error).message, ptUserId, clientUserId }, "[coach] client-summary audit write failed");
    }

    return {
      activeCycle: activeCycle?.cycle ?? null,
      cycleSummary: activeCycle?.summary ?? null,
      feedbackSummary,
      priorDecisions,
      nutrition,
    };
  },

  // ── Phase 2 — PT Approve/Modify/Reject on a client's AI nutrition
  // recommendation (spec §XXIII / PT workflow §IV). All three re-verify
  // the active PT-client relationship AND that the cycle actually belongs
  // to this client (trainingCycleService.ptReviewNutritionRecommendation's
  // own ownership check) — a PT can never act on a client they don't
  // manage, and never on someone else's cycle by guessing an id. ──

  async approveNutritionRecommendation(ptUserId: string, clientUserId: string, cycleId: string, assessmentId?: string) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);
    const result = await trainingCycleService.ptReviewNutritionRecommendation(
      ptUserId,
      clientUserId,
      cycleId,
      "ACCEPTED",
      { assessmentId },
    );
    await this.recordPtNutritionAction(ptUserId, clientUserId, "APPROVE_NUTRITION_RECOMMENDATION", cycleId);
    return result;
  },

  async rejectNutritionRecommendation(
    ptUserId: string,
    clientUserId: string,
    cycleId: string,
    assessmentId?: string,
    note?: string,
  ) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);
    const result = await trainingCycleService.ptReviewNutritionRecommendation(
      ptUserId,
      clientUserId,
      cycleId,
      "REJECTED",
      { assessmentId, ptNote: note },
    );
    await this.recordPtNutritionAction(ptUserId, clientUserId, "REJECT_NUTRITION_RECOMMENDATION", cycleId);
    await createPersistentNotification({
      userId: clientUserId,
      text: "PT của bạn đã từ chối đề xuất dinh dưỡng của AI. Mục tiêu hiện tại được giữ nguyên.",
      eventType: "NUTRITION_PLAN_READY",
      entityId: cycleId,
      link: "/client/nutrition",
    });
    return result;
  },

  /** MODIFY creates a NEW NutritionGoal version from the PT's own patch —
   * never a straight application of the AI's proposedChanges (spec
   * example: AI proposes 1900 kcal, PT modifies to 1950 kcal — the PT's
   * number is what gets applied, `triggeredBy: "PT"`, `createdByUserId`
   * set to this PT). */
  async modifyNutritionRecommendation(
    ptUserId: string,
    clientUserId: string,
    cycleId: string,
    modifiedGoal: { calories: number; protein: number; carbs: number; fat: number },
    assessmentId?: string,
    note?: string,
  ) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);
    const result = await trainingCycleService.ptReviewNutritionRecommendation(
      ptUserId,
      clientUserId,
      cycleId,
      "MODIFIED_BY_PT",
      { assessmentId, modifiedGoal, ptNote: note },
    );
    await this.recordPtNutritionAction(ptUserId, clientUserId, "MODIFY_NUTRITION_RECOMMENDATION", cycleId);
    await createPersistentNotification({
      userId: clientUserId,
      text: `PT của bạn đã điều chỉnh mục tiêu dinh dưỡng: ${modifiedGoal.calories} kcal, ${Math.round(modifiedGoal.protein)}g protein.`,
      eventType: "NUTRITION_PLAN_READY",
      entityId: cycleId,
      link: "/client/nutrition",
    });
    return result;
  },

  /** Diet break / maintenance-phase modeling — PT-initiated trigger
   * (2026-09-07). See trainingCycleService.triggerDietBreakRecommendation's
   * own doc comment for why this is a real new PENDING assessment (still
   * client-confirmable, not a unilateral PT overwrite) rather than a
   * Modify-action shortcut. */
  async triggerDietBreakRecommendation(ptUserId: string, clientUserId: string, cycleId: string, note?: string) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);
    const result = await trainingCycleService.triggerDietBreakRecommendation(ptUserId, clientUserId, cycleId, note);
    await this.recordPtNutritionAction(ptUserId, clientUserId, "TRIGGER_DIET_BREAK_RECOMMENDATION", cycleId);
    await createPersistentNotification({
      userId: clientUserId,
      text: "PT của bạn vừa đề xuất một khoảng nghỉ diet break. Xem chi tiết và xác nhận.",
      eventType: "NUTRITION_PLAN_READY",
      entityId: cycleId,
      link: "/client/workout",
    });
    return result;
  },

  async recordPtNutritionAction(ptUserId: string, clientUserId: string, action: string, cycleId: string) {
    try {
      await prisma.coachClientActionAudit.create({
        data: { ptUserId, clientUserId, action, metadata: { cycleId } as any },
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, ptUserId, clientUserId }, "[coach] PT nutrition action audit write failed");
    }
  },

  /** Creates a manual workout program directly for the client (reuses
   * workoutService.createManualProgram unchanged — same validation, same
   * schedule-generation from startDate/selectedWeekdays/repeatWeeks — the
   * only difference from the client's own self-service flow is the
   * authorization gate and the audit row). This single call already covers
   * "assign with start date/cycle length/days/notes" from the spec, since
   * createManualProgram both creates the program AND generates the
   * WorkoutSchedule rows for it. */
  async createAndAssignPlan(ptUserId: string, clientUserId: string, input: CreateManualProgramDto) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);

    // createManualProgram's return shape (workout.service.ts) is
    // {success, message, createdProgramId, program: <the record>, ...} —
    // NOT the bare program record itself.
    const result = await workoutService.createManualProgram(clientUserId, input);

    try {
      await prisma.coachClientActionAudit.create({
        data: {
          ptUserId,
          clientUserId,
          action: "CREATE_AND_ASSIGN_PLAN",
          metadata: { programId: result.createdProgramId, planName: input.name } as any,
        },
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, ptUserId, clientUserId }, "[coach] plan-assignment audit write failed");
    }

    // Roadmap P4.1 "Notifications/reminders" (§27) — "plan update".
    // Best-effort (see createPersistentNotification's own doc comment) —
    // never blocks the real plan assignment above, which has already
    // succeeded by this point.
    void createPersistentNotification({
      userId: clientUserId,
      text: `PT của bạn vừa gán chương trình tập luyện mới: ${input.name}`,
      eventType: "TRAINING_PLAN_UPDATED",
      entityId: result.createdProgramId,
      link: "/client/workout",
    });

    return result;
  },

  /** Phase 7 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — an AI DRAFT
   * only. Never creates a WorkoutProgram/WorkoutSchedule, never touches
   * assignment — the PT must still call createAndAssignPlan above (or edit
   * the draft first) to actually assign anything. Persists a
   * PlanGenerationAudit row regardless of whether the AI call succeeded, so
   * "what was suggested" is always inspectable even after a fallback. */
  async generatePlanDraft(
    ptUserId: string,
    clientUserId: string,
    input: { ptNotes?: string; daysPerWeek: number; durationWeeks: number },
  ) {
    await this.assertActivePtClientRelationship(ptUserId, clientUserId);

    const profile = await fetchUserProfile(clientUserId);
    const experienceLevel = (profile?.experienceLevel ?? "UNKNOWN") as
      | "BEGINNER"
      | "INTERMEDIATE"
      | "ADVANCED"
      | "UNKNOWN";
    const injuries = profile?.injuries ?? [];

    let activeCycle: Awaited<ReturnType<typeof trainingCycleService.getActiveCycle>> | null = null;
    try {
      activeCycle = await trainingCycleService.getActiveCycle(clientUserId);
    } catch (err: any) {
      if (err?.status !== 404) throw err;
    }
    let cycleFeedbackSummary: Record<string, unknown> | undefined;
    let priorDecisions: string[] = [];
    if (activeCycle) {
      cycleFeedbackSummary = (await cycleFeedbackAggregator.computeAndPersist(activeCycle.cycle.id)) as any;
      priorDecisions = await trainingCycleService.getPriorCycleDecisions(clientUserId, activeCycle.cycle.id);
    }

    // Direct DB read (this service already lives in fitness-service — no
    // need to round-trip through the /internal/exercises/for-ai-plans HTTP
    // endpoint that exists specifically for OTHER services to call).
    // Capped + shuffled for prompt-size and variety, same rationale as that
    // endpoint's own shuffleInPlace step (internal.controller.ts).
    const catalogSample = await prisma.exercise.findMany({
      take: 300,
      select: { id: true, exerciseName: true, bodyPart: true, typeOfActivity: true, typeOfEquipment: true, muscleGroupsActivated: true },
    });
    for (let i = catalogSample.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [catalogSample[i], catalogSample[j]] = [catalogSample[j], catalogSample[i]];
    }
    const allowedExercises = catalogSample.slice(0, 200);

    const requestPayload = {
      userId: ptUserId,
      client: { experienceLevel, competesInSport: profile?.competesInSport === true, goal: profile?.goal ?? null, injuries },
      cycleFeedbackSummary,
      priorDecisions,
      ptNotes: input.ptNotes,
      durationWeeks: input.durationWeeks,
      daysPerWeek: input.daysPerWeek,
      allowedExercises,
    };

    const aiResult = await generateClientPlanDraftSafe(ptUserId, requestPayload);
    const draft = aiResult ?? {
      days: [],
      dataGaps: ["Không thể kết nối tới dịch vụ AI lúc này."],
      warnings: injuries.length > 0 ? [`Khách hàng có báo cáo chấn thương: ${injuries.join(", ")} — cân nhắc kỹ khi tự chọn bài tập.`] : [],
      summaryForPt: "Không thể tạo bản nháp tự động lúc này. Vui lòng tạo kế hoạch thủ công bên dưới.",
    };

    try {
      await prisma.planGenerationAudit.create({
        data: {
          ptUserId,
          clientUserId,
          ptNotes: input.ptNotes ?? null,
          requestSnapshot: requestPayload as any,
          draftDays: draft.days as any,
          dataGaps: draft.dataGaps as any,
          warnings: draft.warnings as any,
        },
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, ptUserId, clientUserId }, "[coach] plan-generation audit write failed");
    }

    // Map exercise ids -> display names for the frontend's editable draft
    // form (the AI output only carries ids, matching the grounding rule).
    const nameById = new Map(allowedExercises.map((e) => [e.id, e.exerciseName]));
    const daysWithNames = draft.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((ex) => ({ ...ex, exerciseName: nameById.get(ex.exerciseId) ?? ex.exerciseId })),
    }));

    return { ...draft, days: daysWithNames };
  },
};
