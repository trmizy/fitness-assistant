import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";

/**
 * Populates the real `ClientJourney` data pipeline — the single highest-
 * value gap found by docs/ai-agent-system-feasibility-audit.md (§2.4):
 * the historical-similarity engine (`journeySimilarity`/`summarizeJourneys`,
 * already wired into `agentic-fitness.service.ts::candidates()`) had a
 * complete schema and algorithm but zero real rows, because nothing wrote
 * to `ClientJourney`. This is that writer.
 *
 * Attribution method and its accepted limitation are documented in
 * docs/adr-client-journey-attribution.md — read that before changing this
 * file's date-range logic.
 *
 * MUST NEVER throw out of `deriveForCompletedContract` in a way that could
 * abort the caller's transaction/flow — every internal step is wrapped so
 * an analytics-derivation failure degrades to "skipped, logged", not a
 * broken contract-completion.
 */

type CompletedContract = {
  id: string;
  ptUserId: string;
  clientUserId: string;
  startDate: Date | null;
  endDate: Date | null;
  completedAt: Date | null;
  totalSessions: number;
  usedSessions: number;
  extraSessions: number;
  compensatedSessions: number;
  sessionDurationMinutes: number | null;
  dataOrigin: string;
};

export type GoalAchievement = "IMPROVED" | "NO_CHANGE" | "REGRESSED" | "UNKNOWN";

/**
 * Conservative, directional-only label — never a "success"/"failure"
 * verdict, and never implies the PT caused the change (see the ADR's
 * "Causal-claim boundary" section). Returns UNKNOWN whenever the goal
 * doesn't map to an unambiguous direction, or baseline/ending data is
 * missing — silence is always preferred over a fabricated verdict.
 */
export function deriveGoalAchievement(
  goal: string | null,
  baselineWeight: number,
  endingWeight: number | null,
  baselineBodyFat: number | null,
  endingBodyFat: number | null,
): GoalAchievement {
  if (endingWeight === null) return "UNKNOWN";
  const weightDelta = endingWeight - baselineWeight;
  const bodyFatDelta = baselineBodyFat !== null && endingBodyFat !== null ? endingBodyFat - baselineBodyFat : null;
  // A tiny fluctuation (<1% of baseline weight) is measurement noise, not
  // a real change in either direction.
  const noiseFloorKg = Math.max(0.3, baselineWeight * 0.01);
  switch (goal) {
    case "WEIGHT_LOSS":
      if (bodyFatDelta !== null) return bodyFatDelta < -0.5 ? "IMPROVED" : bodyFatDelta > 0.5 ? "REGRESSED" : "NO_CHANGE";
      if (Math.abs(weightDelta) < noiseFloorKg) return "NO_CHANGE";
      return weightDelta < 0 ? "IMPROVED" : "REGRESSED";
    case "MUSCLE_GAIN":
      // Weight alone is a weak signal for muscle gain (could be fat) —
      // only claim IMPROVED when body-fat% didn't worsen while weight
      // increased; otherwise UNKNOWN rather than a misleading guess.
      if (bodyFatDelta !== null) {
        if (weightDelta > noiseFloorKg && bodyFatDelta <= 0.5) return "IMPROVED";
        if (weightDelta < -noiseFloorKg) return "REGRESSED";
        return "NO_CHANGE";
      }
      return "UNKNOWN";
    case "MAINTENANCE":
      return Math.abs(weightDelta) < noiseFloorKg * 2 ? "NO_CHANGE" : "UNKNOWN";
    default:
      // ATHLETIC_PERFORMANCE and anything else: body composition alone
      // cannot responsibly summarize performance outcomes.
      return "UNKNOWN";
  }
}

async function findNearestInBodyBefore(userId: string, cutoff: Date) {
  return prisma.inBodyEntry.findFirst({
    where: { userId, date: { lte: cutoff } },
    orderBy: { date: "desc" },
  });
}

/**
 * ADR mitigation: skip derivation entirely (never misattribute) if the
 * client has another contract with a DIFFERENT PT whose active window
 * overlaps this one's. Same-PT overlaps (e.g. a renewed package) are
 * fine — they don't create attribution ambiguity.
 */
async function hasOverlappingDifferentPtContract(contract: CompletedContract): Promise<boolean> {
  const rangeStart = contract.startDate ?? contract.completedAt ?? new Date(0);
  const rangeEnd = contract.completedAt ?? contract.endDate ?? new Date();
  const others = await prisma.contract.findMany({
    where: {
      clientUserId: contract.clientUserId,
      ptUserId: { not: contract.ptUserId },
      id: { not: contract.id },
      status: { in: ["ACTIVE", "COMPLETED", "EXPIRED"] },
    },
    select: { id: true, startDate: true, endDate: true, completedAt: true },
  });
  return others.some((o) => {
    const oStart = o.startDate ?? new Date(0);
    const oEnd = o.completedAt ?? o.endDate ?? new Date();
    return oStart <= rangeEnd && rangeStart <= oEnd;
  });
}

export async function deriveForCompletedContract(contractId: string): Promise<
  { status: "created" | "already_exists" | "skipped"; reason?: string }
> {
  try {
    const existing = await prisma.clientJourney.findFirst({ where: { contractId } });
    if (existing) return { status: "already_exists" };

    const contract = (await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true, ptUserId: true, clientUserId: true, startDate: true, endDate: true, completedAt: true,
        totalSessions: true, usedSessions: true, extraSessions: true, compensatedSessions: true,
        sessionDurationMinutes: true, dataOrigin: true,
      },
    })) as CompletedContract | null;
    if (!contract) return { status: "skipped", reason: "contract_not_found" };
    if (!contract.completedAt) return { status: "skipped", reason: "contract_not_completed" };
    // Demo/synthetic contracts never derive a REAL journey — real
    // journeys must come from real coaching relationships only.
    if (contract.dataOrigin !== "REAL") return { status: "skipped", reason: "non_real_contract_data_origin" };

    if (await hasOverlappingDifferentPtContract(contract)) {
      logger.info({ contractId }, "[client-journey-derivation] skipped: overlapping contract with a different PT — attribution would be ambiguous");
      return { status: "skipped", reason: "overlapping_different_pt_contract" };
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId: contract.clientUserId },
      select: { goal: true, experienceLevel: true, preferredTrainingDays: true, injuries: true },
    });
    if (!profile) return { status: "skipped", reason: "client_profile_not_found" };

    const startCutoff = contract.startDate ?? contract.completedAt;
    const baselineEntry = await findNearestInBodyBefore(contract.clientUserId, startCutoff);
    const endingEntry = await findNearestInBodyBefore(contract.clientUserId, contract.completedAt);
    if (!baselineEntry) {
      return { status: "skipped", reason: "no_baseline_inbody_entry" };
    }
    // A baseline InBody entry measured AFTER the contract's own end is not
    // a real baseline — guards against a degenerate case where the client
    // has no InBody history before the contract at all and
    // findNearestInBodyBefore's <= cutoff still matched something later
    // due to a data anomaly (defensive, should not normally trigger).
    if (baselineEntry.date > contract.completedAt) {
      return { status: "skipped", reason: "baseline_inbody_after_contract_end" };
    }
    // Ending entry is optional — a completed contract with no InBody taken
    // near the end still gets a journey row (useful for adherence/
    // completion-rate cohort stats even without a body-composition
    // outcome), just with null ending* fields, which summarizeJourneys()
    // already excludes from its eligibility filter.
    const sameEntryAsBaseline = endingEntry && baselineEntry && endingEntry.id === baselineEntry.id;
    const ending = sameEntryAsBaseline ? null : endingEntry;

    const durationWeeks = Math.max(
      1,
      Math.round(((contract.completedAt.getTime() - (contract.startDate ?? contract.completedAt).getTime())) / (7 * 86_400_000)),
    );
    const sessionsPrescribed = contract.totalSessions + contract.extraSessions;
    const sessionsCompleted = Math.min(sessionsPrescribed, contract.usedSessions + contract.compensatedSessions);

    const goalAchievement = deriveGoalAchievement(
      profile.goal, baselineEntry.weight, ending?.weight ?? null, baselineEntry.bodyFatPct ?? null, ending?.bodyFatPct ?? null,
    );

    // ADV-006 hardening (docs/ai-agent-adversarial-findings.md): upsert
    // keyed on the now-DB-enforced-unique `contractId`
    // (@@unique([contractId]), migration
    // 20260914120000_client_journey_contract_id_unique) rather than a
    // plain create — the earlier findFirst-then-create above is a fast
    // path for the common case, but only this upsert is actually
    // race-safe: two concurrent derivations for the same contract now
    // resolve to exactly one INSERT and one no-op UPDATE at the database
    // level, never two rows, regardless of timing.
    await prisma.clientJourney.upsert({
      where: { contractId: contract.id },
      update: {},
      create: {
        userId: contract.clientUserId,
        ptId: contract.ptUserId,
        contractId: contract.id,
        goal: profile.goal ?? "UNKNOWN",
        experience: profile.experienceLevel ?? "UNKNOWN",
        baselineWeight: baselineEntry.weight,
        baselineBodyFat: baselineEntry.bodyFatPct ?? null,
        baselineLeanMass: baselineEntry.muscleMass ?? null,
        trainingDays: profile.preferredTrainingDays.length || 0,
        sessionMinutes: contract.sessionDurationMinutes ?? 60,
        constraints: profile.injuries,
        durationWeeks,
        sessionsPrescribed,
        sessionsCompleted,
        nutritionAdherence: null, // see ADR: no reliable cross-service signal available at derivation time
        endingWeight: ending?.weight ?? null,
        endingBodyFat: ending?.bodyFatPct ?? null,
        endingLeanMass: ending?.muscleMass ?? null,
        strengthChangePercent: null, // no strength-test data source exists to derive this from — left unset rather than guessed
        goalAchievement,
        verificationStatus: "SYSTEM_DERIVED",
        dataOrigin: "REAL",
        status: "COMPLETED",
        startedAt: contract.startDate ?? contract.completedAt,
        endedAt: contract.completedAt,
        baselineSnapshot: { baselineInBodyEntryId: baselineEntry.id, endingInBodyEntryId: ending?.id ?? null },
      },
    });
    return { status: "created" };
  } catch (err) {
    // Analytics derivation must never surface as a caller-visible failure
    // — see module doc comment.
    logger.error({ contractId, error: (err as Error)?.message }, "[client-journey-derivation] failed; contract completion itself is unaffected");
    return { status: "skipped", reason: "derivation_error" };
  }
}
