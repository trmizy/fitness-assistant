import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import { trainingCycleService } from "./training-cycle.service";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import { createPersistentNotification } from "../clients/notification.client";

/**
 * AI Nutrition Cycle Engine (Gymini) Phase 3 — InBody Reassessment Signal
 * (spec §X/§XXI, Production Hardening report §10/§16.2 — "the single most
 * product-valuable gap left"). Called (fire-and-forget from the caller's
 * side) after a new InBody entry is recorded, from user-service.
 *
 * Design constraint this file exists to satisfy: "new InBody measurement
 * -> evaluate whether reassessment is warranted -> create a REVIEW signal
 * -> never auto-change calories -> require confirmation" — achieved by
 * reusing the EXISTING evaluateCycle() pipeline verbatim rather than
 * inventing a second decision path: evaluateCycle already only ever
 * PROPOSES (nutrition-decision.engine.ts / cycle-decision.engine.ts are
 * the sole deciders, and every proposal already requires an explicit
 * accept/reject/PT action before anything is applied — see the PT
 * workflow in the Phase 2 report). This file's only job is the TRIGGER
 * and the SPAM gate, never the decision itself.
 *
 * Three-part safety against spamming:
 *   1. Cost/frequency gate (this file): never auto-trigger more often than
 *      `plateauWindowWeeks` (the same window the nutrition engine already
 *      requires before it will even consider proposing a change — reusing
 *      that number rather than inventing a new one) since the cycle
 *      started or the last assessment, whichever is later. A user syncing
 *      InBody daily does NOT get a new LLM-backed evaluation every day.
 *   2. Notify-only-if-actionable (this file): evaluateCycle's own engines
 *      already gate on data sufficiency/quality — if the result is a
 *      plain KEEP/INSUFFICIENT_DATA no-op on both the training and
 *      nutrition sides, no notification is sent at all (spec's "no spam"
 *      rule) — the assessment is still recorded (it's real history/audit),
 *      it just doesn't interrupt the user. A NOT-YET-`COMPLETED` row
 *      (still `PENDING` — either a genuine concurrent race, see #3, or a
 *      manual evaluate() that happened to already be mid-flight) is never
 *      treated as actionable just because its null decision fields don't
 *      match the non-actionable set — an incomplete assessment is not "no
 *      decision", it's "no decision YET".
 *   3. Atomic notify-once claim (this file): two near-simultaneous
 *      InBody writes (e.g. a double-tap submit) can both pass gate #1
 *      before either background evaluation has created its CycleAssessment
 *      row. evaluateCycle's own create()+P2002-catch already dedupes the
 *      ASSESSMENT itself, but without this claim both callers could still
 *      independently decide "actionable" and each send a notification for
 *      the same assessment. The claim is a conditional DB UPDATE, not an
 *      in-memory lock — this service can run as multiple stateless
 *      instances (Lambda) with no shared memory.
 */

const NON_ACTIONABLE_TRAINING_DECISIONS = new Set(["KEEP", "INSUFFICIENT_DATA"]);
const NON_ACTIONABLE_NUTRITION_DECISIONS = new Set(["KEEP_PLAN", "REQUEST_MORE_DATA", null, undefined]);

// Mutable stub seam (same pattern as nutritionBootstrapDeps in
// nutrition-onboarding-bootstrap.service.ts — ESM named imports can't be
// reassigned, so tests swap methods on this object instead). Only the
// slow/cross-service-touching calls are seamed: evaluateCycle can invoke
// ai-service's LLM-backed /ai/assess-cycle, and createPersistentNotification
// is a real cross-service HTTP write into user-service. Plain same-service
// DB reads (getActiveCycle, prisma.cycleAssessment.findFirst) are left as
// direct calls, matching the existing convention.
export const inbodyReassessmentDeps = {
  evaluateCycle: (cycleId: string, userId: string) => trainingCycleService.evaluateCycle(cycleId, userId),
  createPersistentNotification,
  // Atomic notify-once claim (raw SQL: this column predates the
  // Windows-EPERM-stalled `prisma generate` run for this schema change,
  // same established workaround as nutrition.repository.ts). Returns true
  // only for the ONE caller whose UPDATE actually affected a row.
  claimNotification: async (assessmentId: string): Promise<boolean> => {
    const affected = await prisma.$executeRaw`
      UPDATE cycle_assessments
      SET notified_for_reassessment_at = NOW()
      WHERE id = ${assessmentId} AND notified_for_reassessment_at IS NULL
    `;
    return affected === 1;
  },
};

export type ReassessmentTriggerResult =
  | { triggered: false; reason: "NO_ACTIVE_CYCLE" | "ASSESSMENT_ALREADY_PENDING" | "TOO_SOON_SINCE_LAST_REVIEW" }
  | { triggered: true; cycleId: string };

// Phase E (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md,
// "scheduled/automatic cycle evaluation") — this file's cooldown/actionable-
// only/atomic-claim gating is exactly what a periodic sweep needs too, so
// cycle-evaluation-sweep.service.ts calls the SAME functions below with
// trigger="SCHEDULED" rather than duplicating the gating logic. The only
// thing that differs by trigger is the notification's own wording — it
// must never claim "based on your latest InBody" when a scheduled sweep,
// not a new InBody entry, is what actually caused this evaluation.
export type ReassessmentTrigger = "INBODY" | "SCHEDULED";

/**
 * Fast, synchronous-only gating — safe to await directly from an HTTP
 * handler (no LLM call happens in this function). The actual (potentially
 * slow, LLM-backed) evaluation is kicked off detached, never awaited here.
 */
export async function maybeAutoTriggerInBodyReassessment(
  userId: string,
  trigger: ReassessmentTrigger = "INBODY",
): Promise<ReassessmentTriggerResult> {
  let activeCycle: Awaited<ReturnType<typeof trainingCycleService.getActiveCycle>> | null = null;
  try {
    activeCycle = await trainingCycleService.getActiveCycle(userId);
  } catch (err: any) {
    if (err?.status === 404) return { triggered: false, reason: "NO_ACTIVE_CYCLE" };
    throw err;
  }
  const cycle = activeCycle.cycle;

  const lastAssessment = await prisma.cycleAssessment.findFirst({
    where: { cycleId: cycle.id },
    orderBy: { assessmentVersion: "desc" },
  });
  if (lastAssessment?.status === "PENDING") {
    return { triggered: false, reason: "ASSESSMENT_ALREADY_PENDING" };
  }

  const referenceDate = lastAssessment?.createdAt ?? cycle.startDate;
  const cooldownDays = cycleThresholds.assessment.plateauWindowWeeks * 7;
  const daysSinceReference = Math.floor((Date.now() - referenceDate.getTime()) / 86_400_000);
  if (daysSinceReference < cooldownDays) {
    return { triggered: false, reason: "TOO_SOON_SINCE_LAST_REVIEW" };
  }

  // Detached on purpose — evaluateCycle can call an LLM (up to ~90s
  // configured timeout) and this function must return immediately so the
  // InBody-creation request (or scheduled-sweep tick) that triggered it is
  // never slowed down.
  void runReassessmentAndNotify(cycle.id, userId, trigger).catch((err) => {
    logger.warn({ err: (err as Error).message, userId, cycleId: cycle.id }, "[inbody-reassessment] background evaluation failed");
  });

  return { triggered: true, cycleId: cycle.id };
}

// Exported (not called externally in production code — maybeAutoTrigger...
// above is the only real caller, always detached) purely so tests can
// `await` the actionable/non-actionable notify decision directly instead
// of racing a fire-and-forget background promise.
export async function runReassessmentAndNotify(cycleId: string, userId: string, trigger: ReassessmentTrigger = "INBODY"): Promise<void> {
  const assessment = await inbodyReassessmentDeps.evaluateCycle(cycleId, userId);

  // Gate #2, part one: an assessment that hasn't finished being computed
  // yet (still PENDING — either evaluateCycle's own "already pending,
  // return the existing row" short-circuit, or the losing side of a
  // concurrent create()+P2002-catch race, see runVersionedAssessment) has
  // null decision fields. Null must never read as "actionable" just
  // because it isn't literally KEEP/KEEP_PLAN.
  if ((assessment as any).status !== "COMPLETED") {
    logger.info(
      { userId, cycleId, status: (assessment as any).status, assessmentId: (assessment as any).id },
      "[inbody-reassessment] evaluation not yet COMPLETED (concurrent race or already in flight) — not notifying",
    );
    return;
  }

  const trainingActionable = !NON_ACTIONABLE_TRAINING_DECISIONS.has((assessment as any).decision ?? "");
  const nutritionActionable = !NON_ACTIONABLE_NUTRITION_DECISIONS.has((assessment as any).nutritionDecision ?? null);
  if (!trainingActionable && !nutritionActionable) {
    logger.info(
      { userId, cycleId, decision: (assessment as any).decision, nutritionDecision: (assessment as any).nutritionDecision },
      "[inbody-reassessment] auto-triggered evaluation produced no actionable result — not notifying (no spam)",
    );
    return;
  }

  // Gate #3: atomic notify-once claim. Only the caller that actually wins
  // this conditional UPDATE sends the notification — a concurrent second
  // caller that reached this same COMPLETED+actionable assessment (e.g.
  // its own evaluateCycle call resolved to the same P2002-deduped row)
  // gets `false` back and silently no-ops.
  const claimed = await inbodyReassessmentDeps.claimNotification((assessment as any).id);
  if (!claimed) {
    logger.info(
      { userId, cycleId, assessmentId: (assessment as any).id },
      "[inbody-reassessment] notification already claimed by a concurrent caller — not sending a duplicate",
    );
    return;
  }

  await inbodyReassessmentDeps.createPersistentNotification({
    userId,
    text: trigger === "SCHEDULED"
      ? "Gymini vừa đánh giá định kỳ chu kỳ tập của bạn. Xem đề xuất ngay."
      : "Gymini vừa đánh giá lại kế hoạch của bạn dựa trên chỉ số InBody mới nhất. Xem đề xuất ngay.",
    eventType: "CYCLE_REASSESSMENT_READY",
    entityId: cycleId,
    link: "/client/workout",
  });
}
