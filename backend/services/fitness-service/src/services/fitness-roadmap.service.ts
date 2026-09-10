import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/prisma";
import { trainingCycleService } from "./training-cycle.service";
import { generateRoadmapDraftSafe } from "../clients/ai.client";
import { fetchLatestInBodyOnOrBefore, fetchUserProfile } from "../clients/user.client";
import { RoadmapPhaseTypeSchema } from "../models/fitness-roadmap.models";
import { nutritionBootstrapScreening } from "./nutrition-bootstrap-screening";
import {
  computeEnergyBreakdown,
  computeFfmi,
  assessTargetRealism,
  buildDiagnosisReasoning,
} from "./fitness-diagnosis.engine";
import { deriveStrategyGroups, forecastPhaseSequence } from "./fitness-roadmap-forecast.engine";
import { reconcilePhase, buildForecastChangeExplanation, type ForecastChangeReasonCode } from "./fitness-roadmap-reconciliation.engine";
import type { Gender, ActivityLevel, Goal } from "./nutrition-bootstrap.engine";
import type {
  AcceptAiRoadmapDraftInput,
  ActivatePhaseInput,
  ApplyRoadmapRebuildInput,
  CreateFitnessRoadmapInput,
  CreateRoadmapPhaseInput,
  FitnessDiagnosisInput,
  GenerateAiRoadmapDraftInput,
  RoadmapPhaseForecastInput,
  RoadmapPhaseObjective,
  RoadmapPhaseTransitionRules,
} from "../models/fitness-roadmap.models";

type Db = typeof prisma | Prisma.TransactionClient;

const ROADMAP_ENGINE_VERSION = "fitness-roadmap-v1";

function parseDate(value: string, field: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw { status: 400, message: `${field} must be a valid date` };
  }
  return date;
}

function assertDateRange(start: Date, end?: Date | null) {
  if (end && end.getTime() <= start.getTime()) {
    throw { status: 400, message: "plannedEndAt must be after plannedStartAt" };
  }
}

function isUniqueConstraintError(err: unknown) {
  return typeof err === "object" && err != null && (err as { code?: string }).code === "P2002";
}

interface EffectiveDiagnosisContext {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  gender: Gender | null;
  activityLevel: ActivityLevel | null;
  experienceLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  measuredBmr: number | null;
  bodyFatPct: number | null;
  bodyFatMethod: string | null;
  profileGoal: Goal | null;
  safety: ReturnType<typeof nutritionBootstrapScreening>;
}

// Shared by getDiagnosis and getPhaseForecast (Roadmap Projection
// Hardening phase) — resolves the caller's real stored profile/InBody,
// with any wizard-supplied override taking precedence field-by-field.
// Never duplicated logic between the two callers, so they can never
// silently drift on which value wins (design doc §13).
async function resolveEffectiveDiagnosisContext(
  userId: string,
  input: {
    weightKg?: number;
    heightCm?: number;
    age?: number;
    gender?: string;
    activityLevel?: string;
    bodyFatPct?: number;
    bodyFatMethod?: string;
  },
): Promise<EffectiveDiagnosisContext> {
  const now = new Date();
  const [profile, inbody] = await Promise.all([
    fetchUserProfile(userId).catch(() => null),
    fetchLatestInBodyOnOrBefore(userId, now).catch(() => null),
  ]);

  const weightKg = input.weightKg ?? inbody?.weight ?? profile?.currentWeight ?? null;
  const heightCm = input.heightCm ?? profile?.heightCm ?? null;
  const age = input.age ?? profile?.age ?? null;
  const gender = (input.gender ?? profile?.gender ?? null) as Gender | null;
  const activityLevel = (input.activityLevel ?? profile?.activityLevel ?? null) as ActivityLevel | null;
  const experienceLevel = profile?.experienceLevel ?? null;
  const measuredBmr = inbody?.bmr ?? null;

  // Body-fat %: a real InBody measurement always outranks a manual/visual
  // wizard estimate — same "real measurement beats estimate" priority
  // generateAiRoadmapDraft's own bodyComposition context already applies.
  let bodyFatPct: number | null = null;
  let bodyFatMethod: string | null = null;
  if (inbody?.bodyFatPct != null) {
    bodyFatPct = inbody.bodyFatPct;
    bodyFatMethod = "inbody";
  } else if (input.bodyFatPct != null) {
    bodyFatPct = input.bodyFatPct;
    bodyFatMethod = input.bodyFatMethod ?? "manual";
  }

  return {
    weightKg,
    heightCm,
    age,
    gender,
    activityLevel,
    experienceLevel,
    measuredBmr,
    bodyFatPct,
    bodyFatMethod,
    profileGoal: (profile?.goal as Goal | undefined) ?? null,
    safety: nutritionBootstrapScreening(profile),
  };
}

async function lockRoadmapUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"fitness-roadmap:" + userId}, 0))`;
}

async function assertPhaseDatesDoNotOverlap(
  db: Db,
  roadmapId: string,
  start: Date,
  end: Date,
  excludePhaseId?: string,
) {
  const overlap = await db.roadmapPhase.findFirst({
    where: {
      roadmapId,
      ...(excludePhaseId ? { id: { not: excludePhaseId } } : {}),
      plannedStartAt: { lt: end },
      plannedEndAt: { gt: start },
    },
    select: { id: true },
  });
  if (overlap) {
    throw { status: 409, message: "Roadmap phase dates must not overlap" };
  }
}

async function getNextSequenceInPhase(db: Db, phaseId: string) {
  const latest = await db.trainingCycle.findFirst({
    where: { roadmapPhaseId: phaseId },
    orderBy: { sequenceInPhase: "desc" },
    select: { sequenceInPhase: true },
  });
  return (latest?.sequenceInPhase ?? 0) + 1;
}

async function activatePhaseInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  roadmapId: string,
  phaseId: string,
  input: ActivatePhaseInput = {},
) {
  const roadmap = await tx.fitnessRoadmap.findFirst({
    where: { id: roadmapId, userId, archivedAt: null },
  });
  if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };

  // Containment (does phaseId actually belong to roadmapId) must be checked
  // before any business-state validation, so a mismatched roadmapId/phaseId
  // pair always resolves as 404 regardless of the target roadmap's status.
  const phase = await tx.roadmapPhase.findFirst({ where: { id: phaseId, roadmapId } });
  if (!phase) throw { status: 404, message: "Roadmap phase not found" };

  if (roadmap.status !== "ACTIVE") {
    throw { status: 409, message: "Roadmap must be ACTIVE before a phase can be activated" };
  }
  if (["COMPLETED", "CANCELLED", "SKIPPED"].includes(phase.status)) {
    throw { status: 409, message: "Cannot activate a closed roadmap phase" };
  }

  const activeOther = await tx.roadmapPhase.findFirst({
    where: { roadmapId, status: "ACTIVE", id: { not: phaseId } },
    select: { id: true },
  });
  if (activeOther) throw { status: 409, message: "Another phase is already ACTIVE" };

  const now = new Date();
  const activatedPhase =
    phase.status === "ACTIVE"
      ? phase
      : await tx.roadmapPhase.update({
          where: { id: phaseId },
          data: { status: "ACTIVE", actualStartAt: phase.actualStartAt ?? now },
        });

  const activeCycle = await tx.trainingCycle.findFirst({
    where: { userId, status: "ACTIVE", archivedAt: null },
    orderBy: { startDate: "desc" },
  });

  if (activeCycle) {
    if (activeCycle.roadmapPhaseId && activeCycle.roadmapPhaseId !== phaseId) {
      throw { status: 409, message: "Active cycle already belongs to another roadmap phase" };
    }
    if (!activeCycle.roadmapPhaseId) {
      throw {
        status: 409,
        message: "An active legacy cycle already exists; close it before activating a roadmap phase",
      };
    }
    if (activeCycle.roadmapPhaseId === phaseId && activeCycle.sequenceInPhase) {
      return { phase: activatedPhase, cycle: activeCycle, reusedExistingCycle: true };
    }
  }

  const phaseDurationDays = Math.max(
    1,
    Math.ceil((phase.plannedEndAt.getTime() - phase.plannedStartAt.getTime()) / 86_400_000),
  );
  const durationDays = input.durationDays ?? Math.min(30, phaseDurationDays);
  const sequenceInPhase = await getNextSequenceInPhase(tx, phaseId);
  const cycle = await trainingCycleService.startCycle(
    userId,
    null,
    input.startDate ?? phase.plannedStartAt.toISOString().slice(0, 10),
    durationDays,
    {
      name: input.name ?? phase.name,
      status: "ACTIVE",
      targetMetrics: input.targetMetrics,
      configuration: input.configuration ?? {
        roadmapPhaseType: phase.phaseType,
        roadmapPhaseId: phase.id,
      },
    },
    undefined,
    tx,
  );
  const linked = await tx.trainingCycle.update({
    where: { id: cycle.id },
    data: { roadmapPhaseId: phaseId, sequenceInPhase },
  });

  await tx.recommendationAudit.create({
    data: {
      userId,
      cycleId: linked.id,
      engineVersion: ROADMAP_ENGINE_VERSION,
      decision: "ACTIVATE_PHASE",
      reasonCodes: ["ROADMAP_PHASE_ACTIVATED"],
      metricsSnapshot: {
        roadmapId,
        phaseId,
        phaseType: phase.phaseType,
        sequenceInPhase,
      },
    },
  });

  return { phase: activatedPhase, cycle: linked, reusedExistingCycle: false };
}

function assessmentRequiresReview(assessment: any) {
  if (!assessment) return true;
  if (assessment.decision === "INSUFFICIENT_DATA") return true;
  if (assessment.userDecision === "PENDING") return true;
  if (assessment.userDecision === "REJECTED") return true;
  if (assessment.nutritionRequiresConfirmation && assessment.nutritionUserDecision === "PENDING") return true;
  return false;
}

function objectiveReached(phase: any, cycleCount: number, now: Date) {
  const objective = (phase.objective ?? {}) as RoadmapPhaseObjective;
  const transitionRules = (phase.transitionRules ?? {}) as RoadmapPhaseTransitionRules;
  if (objective.completed === true) return true;
  if (typeof objective.maxCycles === "number" && cycleCount >= objective.maxCycles) return true;
  return transitionRules.completeOnPlannedEndDate === true && phase.plannedEndAt.getTime() <= now.getTime();
}

// Goal-aware deterministic fallback mapping (mirrors ai-service's own
// mapGoalTypeToFallbackPhaseType — the two are kept independently in sync
// deliberately, same decoupling reasoning as RoadmapPhaseTypeSchema being
// redeclared on each side). A user whose goal is MUSCLE_GAIN/MAINTENANCE/
// ATHLETIC_PERFORMANCE must never silently receive a FAT_LOSS fallback.
// Unrecognized goal values map to MAINTENANCE (safe/neutral), never FAT_LOSS.
function mapGoalTypeToFallbackPhaseType(goalType: string): string {
  switch (goalType) {
    case "WEIGHT_LOSS":
      return "FAT_LOSS";
    case "MUSCLE_GAIN":
      return "LEAN_GAIN";
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "ATHLETIC_PERFORMANCE":
      return "PERFORMANCE";
    default:
      return "MAINTENANCE";
  }
}

type PhaseProposal = {
  name: string;
  phaseType: string;
  plannedStartAt: Date;
  plannedEndAt: Date;
  objective?: unknown;
  constraints?: unknown;
  transitionRules?: unknown;
};

const REBUILD_RECOVERY_DURATION_DAYS = 14;

// Default deterministic rebuild proposal (no AI, no PT needed): insert one
// RECOVERY phase starting now, then re-chain every remaining PLANNED phase
// after it, unchanged, keeping each phase's original duration but shifted
// onto the new timeline. See docs/FITNESS_ROADMAP_REBUILD_DESIGN.md §3.
function buildDefaultRebuildProposal(remainingPlannedPhases: any[], now: Date): PhaseProposal[] {
  const proposals: PhaseProposal[] = [];
  let cursor = now;

  const recoveryEnd = new Date(cursor.getTime() + REBUILD_RECOVERY_DURATION_DAYS * 86_400_000);
  proposals.push({
    name: "Recovery",
    phaseType: "RECOVERY",
    plannedStartAt: cursor,
    plannedEndAt: recoveryEnd,
    objective: { maxCycles: 1 },
  });
  cursor = recoveryEnd;

  for (const phase of remainingPlannedPhases) {
    const durationMs = Math.max(
      phase.plannedEndAt.getTime() - phase.plannedStartAt.getTime(),
      86_400_000,
    );
    const start = cursor;
    const end = new Date(start.getTime() + durationMs);
    proposals.push({
      name: phase.name,
      phaseType: phase.phaseType,
      plannedStartAt: start,
      plannedEndAt: end,
      objective: phase.objective ?? undefined,
      constraints: phase.constraints ?? undefined,
      transitionRules: phase.transitionRules ?? undefined,
    });
    cursor = end;
  }
  return proposals;
}

// Shared read context for both prepareRoadmapRebuild (preview) and
// applyRoadmapRebuild (apply). Throws the same 409s advanceRoadmap's own
// REBUILD path implies must already hold (pending/rejected review blocks
// it) before a rebuild can be considered.
async function findRebuildContext(db: Db, userId: string, roadmapId: string) {
  const roadmap = await db.fitnessRoadmap.findFirst({ where: { id: roadmapId, userId, archivedAt: null } });
  if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };
  if (roadmap.status !== "ACTIVE") throw { status: 409, message: "Roadmap must be ACTIVE to rebuild" };

  const phase = await db.roadmapPhase.findFirst({ where: { roadmapId, status: "ACTIVE" }, orderBy: { phaseIndex: "asc" } });
  if (!phase) throw { status: 409, message: "Roadmap has no active phase to rebuild" };

  const cycles = await db.trainingCycle.findMany({
    where: { roadmapPhaseId: phase.id },
    orderBy: { sequenceInPhase: "asc" },
  });
  if (cycles.some((c) => c.status === "ACTIVE")) {
    throw {
      status: 409,
      message: "Current phase still has an ACTIVE training cycle; complete/evaluate it before rebuilding",
    };
  }
  const cycle = [...cycles].reverse().find((c) => ["COMPLETED", "ANALYZED"].includes(c.status));
  if (!cycle) throw { status: 409, message: "No completed cycle is ready for rebuild" };

  const assessment = await db.cycleAssessment.findFirst({
    where: { cycleId: cycle.id, status: "COMPLETED" },
    orderBy: { assessmentVersion: "desc" },
  });
  if (!assessment) throw { status: 409, message: "No completed assessment is ready for rebuild" };
  if (assessmentRequiresReview(assessment)) {
    throw { status: 409, message: "Assessment still requires review before rebuild can be applied" };
  }
  if (assessment.decision !== "REBUILD") {
    throw { status: 409, message: "Latest assessment decision is not REBUILD" };
  }

  const remainingPlannedPhases = await db.roadmapPhase.findMany({
    where: { roadmapId, status: "PLANNED", phaseIndex: { gt: phase.phaseIndex } },
    orderBy: { phaseIndex: "asc" },
  });

  return { roadmap, phase, cycle, assessment, remainingPlannedPhases };
}

export const fitnessRoadmapService = {
  // createdByRole defaults to "CLIENT" (the only value the public
  // POST /fitness-roadmaps route ever passes) and is never taken from the
  // HTTP request body/schema — only trusted server code (today:
  // acceptAiRoadmapDraft) may pass "AI"/"PT"/"SYSTEM" here directly.
  async createDraftRoadmap(
    userId: string,
    input: CreateFitnessRoadmapInput,
    createdByRole: "CLIENT" | "PT" | "AI" | "SYSTEM" = "CLIENT",
  ) {
    const plannedStartAt = parseDate(input.plannedStartAt, "plannedStartAt");
    const plannedEndAt = input.plannedEndAt ? parseDate(input.plannedEndAt, "plannedEndAt") : null;
    assertDateRange(plannedStartAt, plannedEndAt);

    if (input.idempotencyKey) {
      const existing = await prisma.fitnessRoadmap.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return this.getRoadmapProjection(existing.id, userId);
    }

    // Single pending-draft policy: a user may have at most one non-archived
    // DRAFT roadmap at a time — one consistent rule shared by every
    // creation path (client self-service POST /fitness-roadmaps, AI-accept
    // POST /fitness-roadmaps/ai-draft/accept, and PT-created
    // POST /coach/clients/:id/roadmap/draft all call this same method), not
    // special-cased per caller. Returns the existing draft instead of
    // creating a duplicate — same idempotent-return shape as the
    // idempotencyKey branch above, so a PT (or the client, or a retried
    // AI-accept) always gets useful information back rather than a bare
    // error. Does not touch ACTIVE/COMPLETED/ARCHIVED/CANCELLED roadmaps —
    // those are unaffected by this rule (matches the existing architecture:
    // "one ACTIVE per user" is already enforced separately, at activation
    // time, not creation time).
    const existingDraft = await prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "DRAFT", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existingDraft) return this.getRoadmapProjection(existingDraft.id, userId);

    const phases = input.phases ?? [];
    const seenIndexes = new Set<number>();
    const parsedPhases = phases.map((phase) => {
      if (seenIndexes.has(phase.phaseIndex)) {
        throw { status: 400, message: "phaseIndex must be unique within a roadmap" };
      }
      seenIndexes.add(phase.phaseIndex);
      const start = parseDate(phase.plannedStartAt, "phase.plannedStartAt");
      const end = parseDate(phase.plannedEndAt, "phase.plannedEndAt");
      assertDateRange(start, end);
      return { phase, start, end };
    });
    for (let i = 0; i < parsedPhases.length; i += 1) {
      for (let j = i + 1; j < parsedPhases.length; j += 1) {
        if (parsedPhases[i].start < parsedPhases[j].end && parsedPhases[i].end > parsedPhases[j].start) {
          throw { status: 409, message: "Roadmap phase dates must not overlap" };
        }
      }
    }

    const roadmap = await prisma.fitnessRoadmap.create({
      data: {
        userId,
        name: input.name,
        goalType: input.goalType,
        plannedStartAt,
        plannedEndAt,
        createdByUserId: userId,
        createdByRole,
        sourceAssessmentId: input.sourceAssessmentId,
        targetMetrics: input.targetMetrics as any,
        configuration: input.configuration as any,
        idempotencyKey: input.idempotencyKey,
        phases: {
          create: parsedPhases.map(({ phase, start, end }) => ({
            phaseIndex: phase.phaseIndex,
            name: phase.name,
            phaseType: phase.phaseType,
            plannedStartAt: start,
            plannedEndAt: end,
            objective: phase.objective as any,
            constraints: phase.constraints as any,
            transitionRules: phase.transitionRules as any,
          })),
        },
      },
    });
    return this.getRoadmapProjection(roadmap.id, userId);
  },

  // FitnessRoadmap AI Draft generation (Phase B). Read-only: never persists
  // anything. Gathers real, already-existing context (user-service profile
  // + latest real InBody, fitness-service's own cycle/assessment/nutrition
  // history) — no fabricated profile attributes. See
  // docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md.
  async generateAiRoadmapDraft(userId: string, input: GenerateAiRoadmapDraftInput) {
    const now = new Date();
    const [profile, inbody, completedCycleCount, lastAssessment, nutritionGoalVersionCount] = await Promise.all([
      fetchUserProfile(userId).catch(() => null),
      fetchLatestInBodyOnOrBefore(userId, now).catch(() => null),
      prisma.trainingCycle.count({ where: { userId, status: { in: ["COMPLETED", "ANALYZED"] } } }),
      prisma.cycleAssessment.findFirst({ where: { cycle: { userId } }, orderBy: { createdAt: "desc" } }),
      prisma.nutritionGoal.count({ where: { userId } }),
    ]);

    const payload = {
      userId,
      goalType: input.goalType,
      timeframeWeeks: input.timeframeWeeks,
      profile: {
        age: profile?.age ?? null,
        gender: profile?.gender ?? null,
        heightCm: profile?.heightCm ?? null,
        currentWeightKg: profile?.currentWeight ?? null,
        // Guided-wizard override (design doc §15) always outranks the
        // stored profile's targetWeight when supplied — a user actively
        // setting a target this session is a stronger signal than a
        // possibly-stale stored value.
        targetWeightKg: input.targetWeightKg ?? profile?.targetWeight ?? null,
        targetBodyFatPercent: input.targetBodyFatPercent ?? null,
        experienceLevel: profile?.experienceLevel ?? "UNKNOWN",
        trainingDaysPerWeek: input.trainingDaysPerWeek ?? null,
        injuries: profile?.injuries ?? [],
        // Real measurements/history always outrank this — see priority
        // ordering documented in docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md §Safety.
        safetyScreeningStatus: profile?.safetyScreeningStatus ?? "UNKNOWN",
      },
      bodyComposition: inbody
        ? { bodyFatPercent: inbody.bodyFatPct ?? null, muscleMassKg: inbody.muscleMass ?? null, measuredAt: inbody.date }
        : null,
      // Optional visual-style signal only — never a body-composition source
      // of truth (see fitness-goal-vision.service.ts's own explicit
      // disclaimer, reused verbatim in the ai-service prompt for this).
      goalVisualAttributes: input.goalVisualAttributes ?? null,
      history: {
        completedCycleCount,
        lastCycleDecision: lastAssessment?.decision ?? null,
        nutritionGoalVersionCount,
      },
      constraints: input.constraints ?? [],
    };

    const aiResult = await generateRoadmapDraftSafe(userId, payload);
    // fitness-service's OWN fallback for when the HTTP call itself fails
    // (network/timeout/5xx) — ai-service's internal fallback (never
    // reached here in that case) covers LLM-level failures instead. Either
    // way, never half-empty, never throws, never fabricates a specific plan.
    const draft = aiResult ?? {
      summary: "Không thể tạo bản nháp roadmap tự động lúc này (AI service không khả dụng).",
      reasoningSummary:
        "Không kết nối được AI service — trả về một phase khởi đầu mặc định, an toàn, chưa cá nhân hóa.",
      confidence: 0,
      phases: [
        {
          phaseType: mapGoalTypeToFallbackPhaseType(input.goalType),
          name: "Giai đoạn khởi đầu",
          plannedDurationWeeks: Math.min(input.timeframeWeeks ?? 6, 6),
          reason: "Bản nháp dự phòng khi AI service không khả dụng.",
        },
      ],
      warnings: ["AI service không khả dụng — đây là bản nháp dự phòng, cần chỉnh sửa thủ công."],
      assumptions: [] as string[],
    };

    // Independent re-validation — never trust ai-service's own Zod pass
    // alone, same "never trust the model's own claim" discipline
    // client-plan-draft.service.ts already applies to exerciseId.
    const validPhaseTypes = new Set<string>(RoadmapPhaseTypeSchema.options as readonly string[]);
    const droppedPhaseTypes: string[] = [];
    let sanitizedPhases = draft.phases.filter((phase) => {
      const ok = validPhaseTypes.has(phase.phaseType);
      if (!ok) droppedPhaseTypes.push(phase.phaseType);
      return ok;
    });
    if (droppedPhaseTypes.length > 0) {
      logger.warn(
        { userId, droppedPhaseTypes },
        "[fitness-roadmap] AI draft referenced unknown phaseType(s) — dropped",
      );
    }
    if (sanitizedPhases.length === 0) {
      sanitizedPhases = [
        {
          phaseType: mapGoalTypeToFallbackPhaseType(input.goalType),
          name: "Giai đoạn khởi đầu",
          plannedDurationWeeks: 6,
          reason: "Không còn phase hợp lệ sau kiểm tra an toàn.",
        },
      ];
    }

    // Clamp each phase's duration and the roadmap's total duration — never
    // trust the model's numbers unclamped even though ai-service's own
    // schema already bounds them per-field.
    const MAX_TOTAL_WEEKS = 104;
    let totalWeeks = 0;
    const clampedPhases: typeof sanitizedPhases = [];
    const warnings = [...draft.warnings];
    for (const phase of sanitizedPhases) {
      const duration = Math.min(Math.max(1, Math.round(phase.plannedDurationWeeks)), 26);
      if (totalWeeks + duration > MAX_TOTAL_WEEKS) {
        warnings.push(
          "Đã cắt bớt một số phase cuối vì tổng thời gian roadmap vượt quá giới hạn cho phép (104 tuần).",
        );
        break;
      }
      totalWeeks += duration;
      clampedPhases.push({ ...phase, plannedDurationWeeks: duration });
    }

    const startAt = input.plannedStartAt ? parseDate(input.plannedStartAt, "plannedStartAt") : now;
    let cursor = startAt;
    const phases = clampedPhases.map((phase, index) => {
      const start = cursor;
      const end = new Date(start.getTime() + phase.plannedDurationWeeks * 7 * 86_400_000);
      cursor = end;
      return {
        phaseIndex: index + 1,
        name: phase.name,
        phaseType: phase.phaseType,
        plannedStartAt: start.toISOString(),
        plannedEndAt: end.toISOString(),
        objective: phase.objectiveMaxCycles ? { maxCycles: phase.objectiveMaxCycles } : undefined,
      };
    });

    return {
      goalType: input.goalType,
      plannedStartAt: startAt.toISOString(),
      summary: draft.summary,
      reasoningSummary: draft.reasoningSummary,
      confidence: draft.confidence,
      warnings,
      assumptions: draft.assumptions,
      phases,
    };
  },

  // Gymini Guided Roadmap Creation — read-only fitness diagnosis for the
  // wizard's Step 2 (energy breakdown) and Step 4 (Fitness Diagnosis +
  // Roadmap Report) screens. See docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md
  // §15. Zero database write, zero AI call — mirrors generateAiRoadmapDraft's
  // own "gather real context, never fabricate" discipline but stays fully
  // local (no ai-service round-trip), so the diagnosis screen works even if
  // ai-service is down. Every wizard-supplied field is an OPTIONAL override
  // of the caller's stored user-service profile/InBody — never required.
  async getDiagnosis(userId: string, input: FitnessDiagnosisInput) {
    const {
      weightKg, heightCm, age, gender, activityLevel, experienceLevel,
      measuredBmr, bodyFatPct, bodyFatMethod, profileGoal, safety,
    } = await resolveEffectiveDiagnosisContext(userId, input);

    const goal = (input.goal ?? profileGoal ?? "MAINTENANCE") as Goal;

    // The energy breakdown needs the same minimum inputs
    // computeInitialNutritionPrescription itself requires — if any are
    // missing (neither wizard override nor stored profile has them), this
    // stays null rather than guessing a value, and the wizard must render
    // "Không đủ dữ liệu" for that screen (design doc §15/§DoD).
    const hasEnergyInputs = weightKg != null && heightCm != null && age != null && gender != null && activityLevel != null;
    const energyBreakdown = hasEnergyInputs
      ? computeEnergyBreakdown({
          weightKg: weightKg as number,
          heightCm: heightCm as number,
          age: age as number,
          gender: gender as Gender,
          activityLevel: activityLevel as ActivityLevel,
          experienceLevel,
          measuredBmr,
          trainingDaysPerWeek: input.trainingDaysPerWeek,
          dailyGoalSteps: input.dailyGoalSteps,
        })
      : null;

    const currentFfmi =
      weightKg != null && heightCm != null && bodyFatPct != null
        ? computeFfmi(weightKg, heightCm, bodyFatPct)
        : null;

    const targetBodyFatPercent = input.targetBodyFatPercent ?? null;
    const targetFfmi =
      heightCm != null && targetBodyFatPercent != null
        ? computeFfmi(input.targetWeightKg ?? weightKg ?? 0, heightCm, targetBodyFatPercent)
        : null;

    const targetRealism =
      weightKg != null
        ? assessTargetRealism({
            currentWeightKg: weightKg,
            targetWeightKg: input.targetWeightKg ?? null,
            timeframeWeeks: input.timeframeWeeks ?? null,
            goal,
          })
        : { warnings: [], suggestedMinTimeframeWeeks: null };

    const reasoning = buildDiagnosisReasoning({
      goal,
      currentBodyFatPct: bodyFatPct,
      targetBodyFatPct: targetBodyFatPercent,
      currentFfmi: currentFfmi?.normalizedFfmi ?? null,
      targetRealismWarnings: targetRealism.warnings,
      safetyReviewRequired: safety.professionalReviewRequired,
    });

    return {
      current: {
        weightKg,
        heightCm,
        age,
        gender,
        activityLevel,
        experienceLevel,
        bodyFatPct,
        bodyFatMethod,
        ffmi: currentFfmi,
      },
      target: {
        weightKg: input.targetWeightKg ?? null,
        bodyFatPct: targetBodyFatPercent,
        timeframeWeeks: input.timeframeWeeks ?? null,
        ffmi: targetFfmi,
      },
      energyBreakdown,
      dataCompleteness: {
        weight: weightKg != null,
        height: heightCm != null,
        age: age != null,
        gender: gender != null,
        activityLevel: activityLevel != null,
        bodyFatPct: bodyFatPct != null,
      },
      safety,
      targetRealism,
      reasoning,
    };
  },

  // Gymini Roadmap Projection & Strategy Report Hardening — read-only
  // phase-by-phase forecast for Step 4's Roadmap Report. See
  // docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md §13. Zero database
  // write, zero AI call — the AI draft already decided WHICH phaseTypes/
  // durations to propose; this endpoint only turns that already-decided
  // sequence into deterministic NUMBERS (deriveStrategyGroups +
  // forecastPhaseSequence, both pure, both reused from
  // fitness-roadmap-forecast.engine.ts). Accepts either the AI draft's
  // pre-Save phases or a persisted RoadmapPhase[] (draft reopen/ACTIVE
  // view), since both carry the same phaseType/plannedStartAt/plannedEndAt
  // shape this needs.
  async getPhaseForecast(userId: string, input: RoadmapPhaseForecastInput) {
    const { weightKg, heightCm, age, gender, activityLevel, experienceLevel, measuredBmr, bodyFatPct } =
      await resolveEffectiveDiagnosisContext(userId, input);

    const strategyGroups = deriveStrategyGroups(input.phases as any);

    // Same minimum-inputs gate getDiagnosis's energyBreakdown uses — a
    // forecast needs a full current-state baseline to chain from at all.
    const hasMinimumInputs = weightKg != null && heightCm != null && age != null && gender != null && activityLevel != null;
    const phaseForecasts = hasMinimumInputs
      ? forecastPhaseSequence(
          {
            heightCm: heightCm as number,
            age: age as number,
            gender: gender as Gender,
            activityLevel: activityLevel as ActivityLevel,
            experienceLevel,
            startWeightKg: weightKg as number,
            startBodyFatPct: bodyFatPct,
            measuredBmr,
          },
          input.phases as any,
        )
      : [];

    return {
      strategyGroups: strategyGroups.map((g) => ({
        key: g.key,
        bucket: g.bucket,
        phaseIndexes: g.phases.map((p: any) => p.phaseIndex),
      })),
      phaseForecasts,
      dataCompleteness: {
        baseline: hasMinimumInputs,
        bodyComposition: bodyFatPct != null,
      },
    };
  },

  // Gymini Adaptive Forecast Reconciliation — read-only. See
  // docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md §15. Returns
  // the immutable Original Forecast (the roadmap.configuration snapshot,
  // untouched, verbatim), a freshly-computed Current Forecast (chained
  // from TODAY's real actual state through the roadmap's own remaining
  // (ACTIVE + PLANNED) phases — never persisted, always recomputed, so a
  // REBUILD's new remainder or a fresh InBody entry is picked up
  // automatically with zero special-casing), and one Reconciliation
  // entry per COMPLETED phase that has a matching original forecast
  // entry (temporal correctness: the actual state used is always the
  // latest InBody on/before that SPECIFIC phase's own actualEndAt, never
  // today's current measurement — design doc §16). Zero writes.
  async getCurrentForecast(userId: string) {
    const roadmap = await prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { actualStartAt: "desc" },
      include: {
        phases: {
          orderBy: { phaseIndex: "asc" },
          include: {
            trainingCycles: {
              orderBy: { sequenceInPhase: "asc" },
              include: { assessments: { orderBy: { assessmentVersion: "desc" }, take: 1 } },
            },
          },
        },
      },
    });
    if (!roadmap) throw { status: 404, message: "No active fitness roadmap" };

    const originalForecast = (roadmap.configuration as any)?.roadmapProjectionSnapshot ?? null;
    const originalPhaseForecasts: any[] = originalForecast?.phaseForecasts ?? [];

    const now = new Date();
    const [profile, inbody] = await Promise.all([
      fetchUserProfile(userId).catch(() => null),
      fetchLatestInBodyOnOrBefore(userId, now).catch(() => null),
    ]);
    const weightKg = inbody?.weight ?? profile?.currentWeight ?? null;
    const heightCm = profile?.heightCm ?? null;
    const age = profile?.age ?? null;
    const gender = (profile?.gender ?? null) as Gender | null;
    const activityLevel = (profile?.activityLevel ?? null) as ActivityLevel | null;
    const experienceLevel = profile?.experienceLevel ?? null;
    const bodyFatPct = inbody?.bodyFatPct ?? null;
    const bodyFatMethod: "inbody" | null = bodyFatPct != null ? "inbody" : null;

    const completedCycleCount = await prisma.trainingCycle.count({
      where: { userId, status: { in: ["COMPLETED", "ANALYZED"] } },
    });
    const latestCompletedAssessment = roadmap.phases
      .flatMap((p) => p.trainingCycles)
      .flatMap((c) => c.assessments)
      .filter((a) => a.status === "COMPLETED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const remainingPhases = roadmap.phases.filter((p) => p.status === "ACTIVE" || p.status === "PLANNED");
    const hasMinimumInputs = weightKg != null && heightCm != null && age != null && gender != null && activityLevel != null;

    const currentForecast =
      hasMinimumInputs && remainingPhases.length > 0
        ? (() => {
            const phaseInputs = remainingPhases.map((p) => ({
              phaseIndex: p.phaseIndex,
              phaseType: p.phaseType as any,
              name: p.name,
              plannedStartAt: p.plannedStartAt.toISOString(),
              plannedEndAt: p.plannedEndAt.toISOString(),
            }));
            return {
              strategyGroups: deriveStrategyGroups(phaseInputs).map((g) => ({
                key: g.key,
                bucket: g.bucket,
                phaseIndexes: g.phases.map((p) => p.phaseIndex),
              })),
              phaseForecasts: forecastPhaseSequence(
                {
                  heightCm: heightCm as number,
                  age: age as number,
                  gender: gender as Gender,
                  activityLevel: activityLevel as ActivityLevel,
                  experienceLevel,
                  startWeightKg: weightKg as number,
                  startBodyFatPct: bodyFatPct,
                  measuredBmr: inbody?.bmr ?? null,
                  bodyFatMethod,
                  bodyFatMeasuredAt: inbody?.date ?? null,
                  completedCycleCount,
                  latestCycleDataQualityScore: latestCompletedAssessment?.dataQualityScore ?? null,
                  asOf: now,
                },
                phaseInputs,
              ),
            };
          })()
        : null;

    // Reconciliation — one entry per COMPLETED phase with a matching
    // original forecast entry. Sequential (not Promise.all) since each
    // fetchLatestInBodyOnOrBefore call is a full history fetch — fine at
    // the scale a single roadmap's phase count ever reaches.
    const completedPhases = roadmap.phases.filter((p) => p.status === "COMPLETED");
    const reconciliations = [];
    for (const phase of completedPhases) {
      const originalPhaseForecast = originalPhaseForecasts.find((f) => f.phaseIndex === phase.phaseIndex);
      if (!originalPhaseForecast) continue;
      const cutoff = phase.actualEndAt ?? phase.plannedEndAt;
      const actualInBody = await fetchLatestInBodyOnOrBefore(userId, cutoff).catch(() => null);
      const lastCycle = [...phase.trainingCycles].reverse()[0];
      const metrics = lastCycle?.assessments[0]?.computedMetrics as any;
      reconciliations.push(
        reconcilePhase(originalPhaseForecast, {
          weightKg: actualInBody?.weight ?? null,
          bodyFatPct: actualInBody?.bodyFatPct ?? null,
          measuredAt: actualInBody?.date ?? null,
          adherenceRate: metrics?.adherenceRate ?? null,
          strengthProgressScore: metrics?.strengthProgressScore ?? null,
        }),
      );
    }

    // Why the forecast changed (design doc §23 of the master task) —
    // deterministic reason codes, never raw AI reasoning. Compares the
    // current baseline (the remaining phases' own start state) against
    // the matching original forecast entry, plus the reconciliation/
    // recency signals already computed above.
    const changeReasonCodes: ForecastChangeReasonCode[] = [];
    const firstRemainingForecast = currentForecast?.phaseForecasts[0];
    const matchingOriginal = firstRemainingForecast
      ? originalPhaseForecasts.find((f) => f.phaseIndex === firstRemainingForecast.phaseIndex)
      : null;
    if (firstRemainingForecast && matchingOriginal) {
      if (Math.abs(firstRemainingForecast.projectedStartWeightKg - matchingOriginal.projectedStartWeightKg) >= 0.2) {
        changeReasonCodes.push("FORECAST_UPDATED_FROM_NEW_WEIGHT");
      }
      if (
        firstRemainingForecast.projectedStartBodyFatPct != null &&
        matchingOriginal.projectedStartBodyFatPct != null &&
        Math.abs(firstRemainingForecast.projectedStartBodyFatPct - matchingOriginal.projectedStartBodyFatPct) >= 0.5
      ) {
        changeReasonCodes.push("BODY_FAT_MEASUREMENT_UPDATED");
      }
    }
    if (reconciliations.some((r) => r.adherenceRate != null && r.adherenceRate < 0.7)) {
      changeReasonCodes.push("ADHERENCE_BELOW_EXPECTED");
    }
    if (inbody?.date) {
      const measurementAgeDays = (now.getTime() - new Date(inbody.date).getTime()) / 86_400_000;
      if (measurementAgeDays > 90) changeReasonCodes.push("MEASUREMENT_STALE");
    }
    const uniqueChangeReasonCodes = Array.from(new Set(changeReasonCodes));

    return {
      roadmapId: roadmap.id,
      originalForecast,
      currentForecast,
      reconciliations,
      changeReasonCodes: uniqueChangeReasonCodes,
      changeExplanation: buildForecastChangeExplanation(uniqueChangeReasonCodes),
    };
  },

  // The only way an AI-originated draft ever becomes a real (DRAFT-status)
  // FitnessRoadmap row — explicit user/PT acceptance, never automatic.
  // createdByRole=AI is stamped server-side, never caller-supplied.
  async acceptAiRoadmapDraft(userId: string, input: AcceptAiRoadmapDraftInput) {
    const { sourceAssessmentId, ...roadmapInput } = input;
    return this.createDraftRoadmap(userId, { ...roadmapInput, sourceAssessmentId }, "AI");
  },

  async addPlannedPhase(userId: string, roadmapId: string, input: CreateRoadmapPhaseInput) {
    const roadmap = await prisma.fitnessRoadmap.findFirst({
      where: { id: roadmapId, userId, archivedAt: null },
    });
    if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };
    if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(roadmap.status)) {
      throw { status: 409, message: "Cannot add a phase to a closed roadmap" };
    }
    const start = parseDate(input.plannedStartAt, "plannedStartAt");
    const end = parseDate(input.plannedEndAt, "plannedEndAt");
    assertDateRange(start, end);
    await assertPhaseDatesDoNotOverlap(prisma, roadmapId, start, end);
    try {
      return await prisma.roadmapPhase.create({
        data: {
          roadmapId,
          phaseIndex: input.phaseIndex,
          name: input.name,
          phaseType: input.phaseType,
          plannedStartAt: start,
          plannedEndAt: end,
          objective: input.objective as any,
          constraints: input.constraints as any,
          transitionRules: input.transitionRules as any,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw { status: 409, message: "phaseIndex must be unique within a roadmap" };
      }
      throw err;
    }
  },

  async activateRoadmap(userId: string, roadmapId: string, input: ActivatePhaseInput = {}) {
    const result = await prisma.$transaction(async (tx) => {
      await lockRoadmapUser(tx, userId);
      const roadmap = await tx.fitnessRoadmap.findFirst({
        where: { id: roadmapId, userId, archivedAt: null },
      });
      if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };
      if (roadmap.status === "ARCHIVED") throw { status: 409, message: "Roadmap is archived" };

      const activeRoadmap = await tx.fitnessRoadmap.findFirst({
        where: { userId, status: "ACTIVE", archivedAt: null, id: { not: roadmapId } },
        select: { id: true },
      });
      if (activeRoadmap) throw { status: 409, message: "Another roadmap is already ACTIVE" };

      const active = roadmap.status === "ACTIVE"
        ? roadmap
        : await tx.fitnessRoadmap.update({
            where: { id: roadmapId },
            data: { status: "ACTIVE", actualStartAt: roadmap.actualStartAt ?? new Date() },
          });

      const phase =
        (await tx.roadmapPhase.findFirst({
          where: { roadmapId, status: "ACTIVE" },
          orderBy: { phaseIndex: "asc" },
        })) ??
        (await tx.roadmapPhase.findFirst({
          where: { roadmapId, status: "PLANNED" },
          orderBy: { phaseIndex: "asc" },
        }));
      if (!phase) throw { status: 409, message: "Roadmap has no phase to activate" };
      const activation = await activatePhaseInTransaction(tx, userId, roadmapId, phase.id, input);
      return { roadmap: active, ...activation };
    });
    return this.getRoadmapProjection(result.roadmap.id, userId);
  },

  async activatePhase(userId: string, roadmapId: string, phaseId: string, input: ActivatePhaseInput = {}) {
    await prisma.$transaction(async (tx) => {
      await lockRoadmapUser(tx, userId);
      await activatePhaseInTransaction(tx, userId, roadmapId, phaseId, input);
    });
    return this.getRoadmapProjection(roadmapId, userId);
  },

  async getCurrentRoadmap(userId: string) {
    const roadmap = await prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "ACTIVE", archivedAt: null },
      orderBy: { actualStartAt: "desc" },
      select: { id: true },
    });
    if (!roadmap) throw { status: 404, message: "No active fitness roadmap" };
    return this.getRoadmapProjection(roadmap.id, userId);
  },

  // Self-service retrieval of the user's own pending DRAFT roadmap.
  // getCurrentRoadmap (above) is deliberately ACTIVE-only — that contract
  // is intentional and unchanged (matches every other "current X" endpoint
  // in this service). Without this sibling, a PT-created DRAFT
  // (createRoadmapDraftForClient, Phase E) would be genuinely invisible to
  // the client who owns it: GET /fitness-roadmaps/current 404s (not
  // ACTIVE yet) and there is no other client-facing way to discover a
  // roadmap's id. This is the smallest correct fix — a second, explicitly
  // DRAFT-scoped read endpoint, not an overload of the ACTIVE one. See
  // docs/FITNESS_ROADMAP_HARDENING_IMPLEMENTATION_REPORT.md §Phase C.
  async getCurrentDraftRoadmap(userId: string) {
    const roadmap = await prisma.fitnessRoadmap.findFirst({
      where: { userId, status: "DRAFT", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!roadmap) throw { status: 404, message: "No draft fitness roadmap" };
    return this.getRoadmapProjection(roadmap.id, userId);
  },

  async getRoadmapById(userId: string, roadmapId: string) {
    return this.getRoadmapProjection(roadmapId, userId);
  },

  async getRoadmapProjection(roadmapId: string, userId: string) {
    const roadmap = await prisma.fitnessRoadmap.findFirst({
      where: { id: roadmapId, userId, archivedAt: null },
      include: {
        phases: {
          orderBy: { phaseIndex: "asc" },
          include: {
            trainingCycles: {
              orderBy: { sequenceInPhase: "asc" },
              include: {
                assessments: { orderBy: { assessmentVersion: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    });
    if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };

    const cycles = roadmap.phases.flatMap((phase) => phase.trainingCycles);
    const cycleIds = cycles.map((cycle) => cycle.id);
    const schedules = cycleIds.length
      ? await prisma.workoutSchedule.findMany({
          where: { userId, trainingCycleId: { in: cycleIds } },
          select: {
            id: true,
            trainingCycleId: true,
            status: true,
            date: true,
            programDay: {
              select: {
                id: true,
                title: true,
                program: {
                  select: { id: true, name: true, status: true, sourcePlanId: true, sourceType: true },
                },
              },
            },
          },
          orderBy: { date: "asc" },
        })
      : [];
    const nutritionGoals = cycleIds.length
      ? await prisma.nutritionGoal.findMany({
          where: { userId, trainingCycleId: { in: cycleIds } },
          orderBy: { validFrom: "desc" },
        })
      : [];
    const goalIds = nutritionGoals.map((goal) => goal.id);
    const nutritionPrograms = goalIds.length
      ? await prisma.nutritionProgram.findMany({
          where: { userId, sourceGoalId: { in: goalIds } },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, status: true, sourceGoalId: true, startDate: true, endDate: true },
        })
      : [];

    const schedulesByCycle = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const key = schedule.trainingCycleId ?? "";
      schedulesByCycle.set(key, [...(schedulesByCycle.get(key) ?? []), schedule]);
    }
    const goalsByCycle = new Map<string, typeof nutritionGoals>();
    for (const goal of nutritionGoals) {
      const key = goal.trainingCycleId ?? "";
      goalsByCycle.set(key, [...(goalsByCycle.get(key) ?? []), goal]);
    }

    const phases = roadmap.phases.map((phase) => {
      const trainingCycles = phase.trainingCycles.map((cycle) => {
        const cycleGoals = goalsByCycle.get(cycle.id) ?? [];
        return {
          ...cycle,
          latestAssessment: cycle.assessments[0] ?? null,
          schedules: schedulesByCycle.get(cycle.id) ?? [],
          nutritionGoals: cycleGoals,
          nutritionPrograms: nutritionPrograms.filter((program) =>
            cycleGoals.some((goal) => goal.id === program.sourceGoalId),
          ),
        };
      });
      return {
        ...phase,
        trainingCycles,
        progress: {
          plannedCycleCount: Math.max(1, Math.ceil((phase.plannedEndAt.getTime() - phase.plannedStartAt.getTime()) / (28 * 86_400_000))),
          cycleCount: trainingCycles.length,
          completedCycleCount: trainingCycles.filter((cycle) => ["COMPLETED", "ANALYZED"].includes(cycle.status)).length,
        },
      };
    });
    const activePhase = phases.find((phase) => phase.status === "ACTIVE") ?? null;
    const activeCycle = cycles.find((cycle) => cycle.status === "ACTIVE") ?? null;

    // Computed, not stored: true once the active phase's latest completed
    // cycle has a COMPLETED, non-review-blocked assessment whose decision is
    // REBUILD, and no cycle is currently ACTIVE in that phase. Reuses data
    // already fetched above — no extra query.
    let pendingRebuild: { assessmentId: string; cycleId: string; phaseId: string } | null = null;
    if (activePhase && !activePhase.trainingCycles.some((cycle) => cycle.status === "ACTIVE")) {
      const latestCycle = [...activePhase.trainingCycles]
        .reverse()
        .find((cycle) => ["COMPLETED", "ANALYZED"].includes(cycle.status));
      const latestAssessment = latestCycle?.latestAssessment;
      if (
        latestCycle &&
        latestAssessment &&
        latestAssessment.status === "COMPLETED" &&
        latestAssessment.decision === "REBUILD" &&
        !assessmentRequiresReview(latestAssessment)
      ) {
        pendingRebuild = { assessmentId: latestAssessment.id, cycleId: latestCycle.id, phaseId: activePhase.id };
      }
    }

    // Gymini Adaptive Roadmap Production Closure (Gap C, design doc §8/§9/
    // §10) — Completed Roadmap terminal summary. Deliberately computed
    // here, inside the ALREADY-EXISTING getRoadmapProjection (called by
    // getById/getCurrentDraft/every lifecycle mutation's own return value)
    // rather than a new endpoint — GET /fitness-roadmaps/current/forecast
    // is ACTIVE-only by contract and must stay that way (design doc §11);
    // this is the "existing roadmap-by-id projection already includes
    // enough data" option the master task itself names as preferred.
    // Only computed for COMPLETED roadmaps — zero extra work/calls on the
    // far more common ACTIVE/DRAFT paths this same method serves.
    let finalSummary: {
      startWeightKg: number | null;
      startBodyFatPct: number | null;
      originalProjectedEndWeightKg: number | null;
      originalProjectedEndBodyFatPct: number | null;
      actualFinalWeightKg: number | null;
      actualFinalBodyFatPct: number | null;
      actualMeasuredAt: string | null;
      totalWeeks: number | null;
      completedPhaseCount: number;
      totalPhaseCount: number;
      cycleCount: number;
      rebuildCount: number;
    } | null = null;
    if (roadmap.status === "COMPLETED") {
      const originalPhaseForecasts: any[] = (roadmap.configuration as any)?.roadmapProjectionSnapshot?.phaseForecasts ?? [];
      const firstForecast = originalPhaseForecasts[0] ?? null;
      const lastForecast = originalPhaseForecasts[originalPhaseForecasts.length - 1] ?? null;
      const completionCutoff = roadmap.actualEndAt ?? roadmap.plannedEndAt ?? new Date();
      // Actual final state: the latest real measurement at/before the
      // roadmap's own actualEndAt — never a later, post-completion
      // reading (same temporal rule reconciliation already follows).
      const actualFinal = await fetchLatestInBodyOnOrBefore(userId, completionCutoff).catch(() => null);
      const rebuildAudits = await prisma.recommendationAudit.findMany({
        where: { userId, decision: "ROADMAP_REBUILD_APPLIED" },
        select: { metricsSnapshot: true },
      });
      const rebuildCount = rebuildAudits.filter((a) => (a.metricsSnapshot as any)?.roadmapId === roadmapId).length;
      finalSummary = {
        startWeightKg: firstForecast?.projectedStartWeightKg ?? null,
        startBodyFatPct: firstForecast?.projectedStartBodyFatPct ?? null,
        originalProjectedEndWeightKg: lastForecast?.projectedEndWeightKg ?? null,
        originalProjectedEndBodyFatPct: lastForecast?.projectedEndBodyFatPct ?? null,
        actualFinalWeightKg: actualFinal?.weight ?? null,
        actualFinalBodyFatPct: actualFinal?.bodyFatPct ?? null,
        actualMeasuredAt: actualFinal?.date ?? null,
        totalWeeks: roadmap.actualStartAt
          ? Math.round((completionCutoff.getTime() - roadmap.actualStartAt.getTime()) / (7 * 86_400_000))
          : null,
        completedPhaseCount: phases.filter((p) => p.status === "COMPLETED").length,
        totalPhaseCount: phases.length,
        cycleCount: phases.reduce((sum, p) => sum + p.trainingCycles.length, 0),
        rebuildCount,
      };
    }

    // Gymini Adaptive Cycle Transition Continuity (design doc §"Chosen
    // continuity policy") — a Roadmap-driven TrainingCycle never
    // automatically receives a WorkoutProgram/WorkoutSchedule (confirmed
    // by design-doc §1/§4/§5: activatePhaseInTransaction/startCycle both
    // always create planId:null, and the only real program<->cycle link
    // is the per-row WorkoutSchedule.trainingCycleId). Fully derived from
    // data already loaded above by this same method — zero extra
    // queries, zero schema change. Only computed when there's a real
    // ACTIVE cycle to report on.
    let trainingReadiness: {
      status: "READY" | "NEEDS_GENERATION";
      lastAssessmentDecision: string | null;
      canReuseLastProgram: boolean;
    } | null = null;
    let nutritionReadiness: { status: "READY" | "NEEDS_GENERATION" } | null = null;
    const allTrainingCycles = phases.flatMap((p) => p.trainingCycles);
    const activeTrainingCycle = activePhase?.trainingCycles.find((cycle) => cycle.status === "ACTIVE") ?? null;
    if (activeTrainingCycle) {
      const hasSchedule = activeTrainingCycle.schedules.length > 0;
      // "What decision led here" — the most recently COMPLETED assessment
      // across the whole roadmap (this brand-new active cycle has no
      // assessment of its own yet). Same data already fetched above via
      // `allTrainingCycles`/`.latestAssessment` — no new query.
      const lastCompletedAssessment = [...allTrainingCycles]
        .filter((c) => c.id !== activeTrainingCycle.id)
        .reverse()
        .map((c) => c.latestAssessment)
        .find((a) => a && a.status === "COMPLETED") ?? null;
      const lastAssessmentDecision = lastCompletedAssessment?.decision ?? null;
      // A prior real, COMPLETED (validated, reviewed) AI/manual program
      // exists at all — the "reuse" fast path is only ever surfaced for
      // KEEP, never for PROGRESS/ADJUST/DELOAD/REBUILD (design doc: never
      // blindly copy across those decisions).
      const canReuseLastProgram =
        lastAssessmentDecision === "KEEP" &&
        allTrainingCycles.some((c) => c.schedules.some((s) => s.programDay?.program?.status === "ACTIVE"));
      trainingReadiness = {
        status: hasSchedule ? "READY" : "NEEDS_GENERATION",
        lastAssessmentDecision,
        canReuseLastProgram,
      };
      // NutritionGoal is a standing, per-user resource (design doc §9) —
      // never cycle-scoped, so "ready" simply means a real ACTIVE goal
      // exists for this user at all (onboarding already guarantees this
      // for any user who completed it; a legacy/edge-case user without
      // one gets an honest NEEDS_GENERATION rather than a false READY).
      const hasActiveNutritionGoal = await prisma.nutritionGoal.findFirst({
        where: { userId, status: "ACTIVE" },
        select: { id: true },
      });
      nutritionReadiness = { status: hasActiveNutritionGoal ? "READY" : "NEEDS_GENERATION" };
    }

    return {
      roadmap: { ...roadmap, phases: undefined },
      phases,
      activePhase,
      activeCycle,
      pendingRebuild,
      finalSummary,
      trainingReadiness,
      nutritionReadiness,
    };
  },

  evaluateRoadmapTransition(args: {
    roadmap: any;
    currentPhase: any;
    completedCycle: any;
    assessment: any;
    phaseCycleCount: number;
    now?: Date;
  }) {
    const { currentPhase, assessment, phaseCycleCount } = args;
    const now = args.now ?? new Date();
    if (!assessment || assessment.status !== "COMPLETED") return { decision: "BLOCKED_PENDING_REVIEW", reasonCodes: ["NO_COMPLETED_ASSESSMENT"] };
    if (assessment.decision === "INSUFFICIENT_DATA") return { decision: "INSUFFICIENT_DATA", reasonCodes: ["ASSESSMENT_INSUFFICIENT_DATA"] };
    if (assessmentRequiresReview(assessment)) return { decision: "BLOCKED_PENDING_REVIEW", reasonCodes: ["RECOMMENDATION_REVIEW_REQUIRED"] };
    if (assessment.decision === "REBUILD") return { decision: "REBUILD_REMAINING_ROADMAP", reasonCodes: ["ASSESSMENT_REBUILD"] };
    if (assessment.decision === "DELOAD") return { decision: "INSERT_RECOVERY_CYCLE", reasonCodes: ["ASSESSMENT_DELOAD"] };
    if (objectiveReached(currentPhase, phaseCycleCount, now)) {
      return { decision: "COMPLETE_AND_ACTIVATE_NEXT_PHASE", reasonCodes: ["PHASE_OBJECTIVE_OR_RANGE_COMPLETE"] };
    }
    return { decision: "CONTINUE_CURRENT_PHASE", reasonCodes: [`ASSESSMENT_${assessment.decision}`] };
  },

  async advanceRoadmap(userId: string, roadmapId: string) {
    await prisma.$transaction(async (tx) => {
      await lockRoadmapUser(tx, userId);
      const roadmap = await tx.fitnessRoadmap.findFirst({ where: { id: roadmapId, userId, status: "ACTIVE", archivedAt: null } });
      if (!roadmap) throw { status: 404, message: "Active fitness roadmap not found" };
      const phase = await tx.roadmapPhase.findFirst({ where: { roadmapId, status: "ACTIVE" }, orderBy: { phaseIndex: "asc" } });
      if (!phase) throw { status: 409, message: "Roadmap has no active phase" };
      const cycles = await tx.trainingCycle.findMany({ where: { roadmapPhaseId: phase.id }, orderBy: { sequenceInPhase: "asc" } });
      const existingActiveCycle = cycles.find((item) => item.status === "ACTIVE");
      if (existingActiveCycle) return;
      const cycle = [...cycles].reverse().find((item) => ["COMPLETED", "ANALYZED"].includes(item.status));
      if (!cycle) throw { status: 409, message: "No completed cycle is ready for roadmap advancement" };
      const assessment = await tx.cycleAssessment.findFirst({
        where: { cycleId: cycle.id, status: "COMPLETED" },
        orderBy: { assessmentVersion: "desc" },
      });
      const transition = this.evaluateRoadmapTransition({
        roadmap,
        currentPhase: phase,
        completedCycle: cycle,
        assessment,
        phaseCycleCount: cycles.length,
      });

      await tx.recommendationAudit.create({
        data: {
          userId,
          cycleId: cycle.id,
          assessmentId: assessment?.id ?? null,
          engineVersion: ROADMAP_ENGINE_VERSION,
          decision: transition.decision,
          reasonCodes: transition.reasonCodes as any,
          metricsSnapshot: { roadmapId, phaseId: phase.id, cycleId: cycle.id },
        },
      });

      if (["BLOCKED_PENDING_REVIEW", "INSUFFICIENT_DATA", "REBUILD_REMAINING_ROADMAP"].includes(transition.decision)) {
        return;
      }

      if (transition.decision === "COMPLETE_AND_ACTIVATE_NEXT_PHASE") {
        const phaseCompletedAt = new Date();
        await tx.roadmapPhase.update({
          where: { id: phase.id },
          data: { status: "COMPLETED", actualEndAt: phaseCompletedAt },
        });

        // Adaptive Forecast Reconciliation (design doc §13) — persist a
        // second, distinct RecommendationAudit row (engineVersion=
        // "forecast-reconciliation-v1", never mixed into the transition-
        // decision row above) comparing this phase's ORIGINAL forecast to
        // what actually happened. Uses the exact same real actual-state/
        // cycle-metrics signals already available in this scope — never a
        // second decision, never influences transition.decision (already
        // computed above). Best-effort: originalPhaseForecast may be
        // absent for a roadmap created before this phase existed, or for
        // an expert-mode roadmap with no forecast snapshot at all — never
        // blocks phase completion either way.
        const originalPhaseForecast = (
          (roadmap.configuration as any)?.roadmapProjectionSnapshot?.phaseForecasts as any[] | undefined
        )?.find((f) => f.phaseIndex === phase.phaseIndex);
        if (originalPhaseForecast) {
          // Idempotency guard (Gymini Adaptive Roadmap Production Closure,
          // design doc §5/§6) — the SAME logical reconciliation event
          // (this exact completed cycle, this exact engine version) must
          // never produce two audit rows. In the normal state machine this
          // is already unreachable twice (advanceRoadmap's own advisory
          // lock — lockRoadmapUser, acquired before any read this
          // transaction makes — serializes concurrent calls, and once
          // this phase becomes COMPLETED there is no code path that
          // re-enters this branch for the same phase), but this explicit
          // existence check makes the guarantee robust in-depth rather
          // than resting solely on that state-machine side effect, at
          // zero migration cost (reuses the existing table, no new unique
          // constraint needed since the check + create are both inside
          // this same serialized transaction).
          const existingReconciliation = await tx.recommendationAudit.findFirst({
            where: { cycleId: cycle.id, engineVersion: "forecast-reconciliation-v1" },
            select: { id: true },
          });
          if (!existingReconciliation) {
            const actualInBody = await fetchLatestInBodyOnOrBefore(userId, phaseCompletedAt).catch(() => null);
            const metrics = assessment?.computedMetrics as any;
            const reconciliation = reconcilePhase(originalPhaseForecast, {
              weightKg: actualInBody?.weight ?? null,
              bodyFatPct: actualInBody?.bodyFatPct ?? null,
              measuredAt: actualInBody?.date ?? null,
              adherenceRate: metrics?.adherenceRate ?? null,
              strengthProgressScore: metrics?.strengthProgressScore ?? null,
            });
            await tx.recommendationAudit.create({
              data: {
                userId,
                cycleId: cycle.id,
                assessmentId: assessment?.id ?? null,
                engineVersion: "forecast-reconciliation-v1",
                decision: reconciliation.status,
                reasonCodes: reconciliation.reasonCodes as any,
                metricsSnapshot: reconciliation as any,
              },
            });
          }
        }

        const nextPhase = await tx.roadmapPhase.findFirst({
          where: { roadmapId, status: "PLANNED", phaseIndex: { gt: phase.phaseIndex } },
          orderBy: { phaseIndex: "asc" },
        });
        if (!nextPhase) {
          await tx.fitnessRoadmap.update({
            where: { id: roadmapId },
            data: { status: "COMPLETED", actualEndAt: new Date() },
          });
          return;
        }
        await activatePhaseInTransaction(tx, userId, roadmapId, nextPhase.id, {});
        return;
      }

      const sequenceInPhase = await getNextSequenceInPhase(tx, phase.id);
      const startDate = new Date(cycle.endDate);
      const created = await trainingCycleService.startCycle(
        userId,
        cycle.planId,
        startDate.toISOString().slice(0, 10),
        cycle.durationDays,
        {
          name: `${phase.name} Cycle ${sequenceInPhase}`,
          status: "ACTIVE",
          configuration:
            transition.decision === "INSERT_RECOVERY_CYCLE"
              ? { roadmapPhaseType: phase.phaseType, roadmapPhaseId: phase.id, periodizationRole: "DELOAD" }
              : { roadmapPhaseType: phase.phaseType, roadmapPhaseId: phase.id },
        },
        undefined,
        tx,
      );
      await tx.trainingCycle.update({
        where: { id: created.id },
        data: { roadmapPhaseId: phase.id, sequenceInPhase },
      });
    });
    return this.getRoadmapProjection(roadmapId, userId);
  },

  // Read-only preview of the default deterministic rebuild proposal. See
  // docs/FITNESS_ROADMAP_REBUILD_DESIGN.md §3. Throws a 409 with an
  // explanatory message when no rebuild is currently pending (no active
  // phase, still-active cycle, missing/pending assessment, or the latest
  // decision is not REBUILD) — same style as every other guard in this file.
  async prepareRoadmapRebuild(userId: string, roadmapId: string) {
    const ctx = await findRebuildContext(prisma, userId, roadmapId);
    const now = new Date();
    const proposedPhases = buildDefaultRebuildProposal(ctx.remainingPlannedPhases, now);
    return {
      assessmentId: ctx.assessment.id,
      cycleId: ctx.cycle.id,
      currentPhaseId: ctx.phase.id,
      proposedPhases: proposedPhases.map((phase) => ({
        ...phase,
        plannedStartAt: phase.plannedStartAt.toISOString(),
        plannedEndAt: phase.plannedEndAt.toISOString(),
      })),
    };
  },

  // Applies a rebuild: completes the current phase, skips the remaining
  // PLANNED phases, creates+activates the proposal (caller-supplied or the
  // same default preview computes), and records one ROADMAP_REBUILD_APPLIED
  // audit. Transactional + per-user advisory-locked + idempotent by
  // assessmentId. See docs/FITNESS_ROADMAP_REBUILD_DESIGN.md §3, §7.
  async applyRoadmapRebuild(userId: string, roadmapId: string, input: ApplyRoadmapRebuildInput) {
    await prisma.$transaction(async (tx) => {
      await lockRoadmapUser(tx, userId);

      const roadmap = await tx.fitnessRoadmap.findFirst({ where: { id: roadmapId, userId, archivedAt: null } });
      if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };

      // Idempotency check by assessmentId FIRST, before requiring any phase
      // to still be ACTIVE: once a rebuild has been applied, the phase that
      // produced this assessment is already COMPLETED, so re-deriving
      // "current active phase" would no longer find it. A second call with
      // the same assessmentId is a no-op, not an error.
      const alreadyApplied = await tx.recommendationAudit.findFirst({
        where: { assessmentId: input.assessmentId, decision: "ROADMAP_REBUILD_APPLIED" },
      });
      if (alreadyApplied) return;

      const ctx = await findRebuildContext(tx, userId, roadmapId);

      // Containment: the caller's assessmentId must be the one actually
      // driving this roadmap's pending rebuild right now — checked before
      // any mutation, so a mismatched assessmentId (their own stale one, or
      // another user's/roadmap's) always resolves as 404, never partially
      // applies.
      if (ctx.assessment.id !== input.assessmentId) {
        throw { status: 404, message: "assessmentId does not match the roadmap's pending rebuild assessment" };
      }

      const now = new Date();

      await tx.roadmapPhase.update({
        where: { id: ctx.phase.id },
        data: { status: "COMPLETED", actualEndAt: now },
      });

      // "Remaining future roadmap" being replaced: PLANNED -> SKIPPED is
      // already a legal transition (docs/fitness-roadmap-phase-integration-plan.md
      // §5) — nothing is deleted, every skipped phase keeps its id/dates.
      const skipped = await tx.roadmapPhase.updateMany({
        where: { roadmapId, status: "PLANNED", phaseIndex: { gt: ctx.phase.phaseIndex } },
        data: { status: "SKIPPED" },
      });

      const maxIndexRow = await tx.roadmapPhase.aggregate({ where: { roadmapId }, _max: { phaseIndex: true } });
      let nextIndex = (maxIndexRow._max.phaseIndex ?? ctx.phase.phaseIndex) + 1;

      const proposals: PhaseProposal[] = input.phases
        ? input.phases.map((phase) => {
            const start = parseDate(phase.plannedStartAt, "phase.plannedStartAt");
            const end = parseDate(phase.plannedEndAt, "phase.plannedEndAt");
            assertDateRange(start, end);
            return {
              name: phase.name,
              phaseType: phase.phaseType,
              plannedStartAt: start,
              plannedEndAt: end,
              objective: phase.objective,
              constraints: phase.constraints,
              transitionRules: phase.transitionRules,
            };
          })
        : buildDefaultRebuildProposal(ctx.remainingPlannedPhases, now);

      if (proposals.length === 0) {
        throw { status: 400, message: "Rebuild proposal must contain at least one phase" };
      }
      for (let i = 0; i < proposals.length; i += 1) {
        for (let j = i + 1; j < proposals.length; j += 1) {
          if (
            proposals[i].plannedStartAt < proposals[j].plannedEndAt &&
            proposals[i].plannedEndAt > proposals[j].plannedStartAt
          ) {
            throw { status: 409, message: "Rebuild proposal phases must not overlap each other" };
          }
        }
      }

      const createdPhaseIds: string[] = [];
      for (const proposal of proposals) {
        const created = await tx.roadmapPhase.create({
          data: {
            roadmapId,
            phaseIndex: nextIndex,
            name: proposal.name,
            phaseType: proposal.phaseType as any,
            plannedStartAt: proposal.plannedStartAt,
            plannedEndAt: proposal.plannedEndAt,
            objective: proposal.objective as any,
            constraints: proposal.constraints as any,
            transitionRules: proposal.transitionRules as any,
          },
        });
        createdPhaseIds.push(created.id);
        nextIndex += 1;
      }

      const newActivePhaseId = createdPhaseIds[0];
      await activatePhaseInTransaction(tx, userId, roadmapId, newActivePhaseId, {});

      await tx.recommendationAudit.create({
        data: {
          userId,
          cycleId: ctx.cycle.id,
          assessmentId: ctx.assessment.id,
          engineVersion: ROADMAP_ENGINE_VERSION,
          decision: "ROADMAP_REBUILD_APPLIED",
          reasonCodes: ["ASSESSMENT_REBUILD_APPLIED"],
          metricsSnapshot: {
            roadmapId,
            completedPhaseId: ctx.phase.id,
            skippedPhaseCount: skipped.count,
            createdPhaseIds,
            newActivePhaseId,
          },
        },
      });
    });
    return this.getRoadmapProjection(roadmapId, userId);
  },

  async archiveRoadmap(userId: string, roadmapId: string) {
    await prisma.$transaction(async (tx) => {
      await lockRoadmapUser(tx, userId);
      const roadmap = await tx.fitnessRoadmap.findFirst({
        where: { id: roadmapId, userId, archivedAt: null },
        include: { phases: { select: { id: true, status: true } } },
      });
      if (!roadmap) throw { status: 404, message: "Fitness roadmap not found" };
      if (roadmap.phases.some((phase) => phase.status === "ACTIVE")) {
        throw { status: 409, message: "Cannot archive a roadmap while a phase is ACTIVE" };
      }
      // Scoped to THIS roadmap's own phases only — found via real E2E
      // testing: an unscoped `where: { userId, status: "ACTIVE" }` query
      // blocked archiving a never-activated DRAFT roadmap (zero phases ever
      // activated, so zero cycles could possibly be linked to it) just
      // because the user happened to have an unrelated ACTIVE legacy
      // TrainingCycle from a completely different flow. A cycle can only
      // ever become ACTIVE while linked to one of THIS roadmap's phases if
      // that phase was itself ACTIVE (activatePhaseInTransaction is the only
      // path that creates a roadmap-linked ACTIVE cycle, and it requires the
      // phase to be ACTIVE) — so with the phase check above already having
      // passed, this is a defense-in-depth invariant check, not the primary
      // guard.
      const activeCycle = await tx.trainingCycle.findFirst({
        where: { roadmapPhaseId: { in: roadmap.phases.map((phase) => phase.id) }, status: "ACTIVE", archivedAt: null },
        select: { id: true },
      });
      if (activeCycle) {
        throw { status: 409, message: "Cannot archive a roadmap while a training cycle is ACTIVE" };
      }
      await tx.fitnessRoadmap.update({
        where: { id: roadmap.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
    });
    return { roadmapId, archived: true };
  },
};
