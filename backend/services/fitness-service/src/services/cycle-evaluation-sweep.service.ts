import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import { maybeAutoTriggerInBodyReassessment, type ReassessmentTriggerResult } from "./inbody-reassessment.service";

/**
 * Adaptive Cycle Evaluation — scheduled/automatic re-evaluation (2026-09-07,
 * docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md, phase E). Structurally
 * mirrors workout-reminder.service.ts's own sweep-job pattern (plain
 * `setInterval`, a module-level `running` overlap guard, per-user error
 * isolation, an injectable `deps` object for testability) — not a new
 * pattern in this codebase, the third service to need one.
 *
 * Deliberately adds NO new decision or gating logic of its own. This is
 * only a new TRIGGER for the existing inbody-reassessment.service.ts
 * pipeline (cooldown gate, notify-only-if-actionable, atomic notify-once
 * claim — all already built and tested for the "new InBody entry" trigger)
 * — called here with trigger="SCHEDULED" so the two paths share every gate
 * and every notification-claim guarantee, and only the notification TEXT
 * differs (never claims "based on your latest InBody" for a periodic run
 * that wasn't actually InBody-driven).
 *
 * Sweep interval is deliberately coarse (default 24h) — the real "don't
 * spam" gate is the cooldown inside maybeAutoTriggerInBodyReassessment
 * (plateauWindowWeeks, weeks-scale), not this interval; checking more often
 * than daily would only mean more near-instant no-op DB reads, not earlier
 * evaluations, since nothing becomes due faster than the cooldown allows.
 */

const SWEEP_INTERVAL_MS = Number(process.env.CYCLE_EVALUATION_SWEEP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const BATCH_SIZE = 200;

export interface CycleEvaluationSweepDeps {
  findActiveCycleUserIds: (limit: number) => Promise<string[]>;
  maybeAutoTrigger: (userId: string) => Promise<ReassessmentTriggerResult>;
}

export const defaultCycleEvaluationSweepDeps: CycleEvaluationSweepDeps = {
  findActiveCycleUserIds: async (limit) => {
    const rows = await prisma.trainingCycle.findMany({
      where: { status: "ACTIVE", archivedAt: null },
      select: { userId: true },
      distinct: ["userId"],
      take: limit,
    });
    return rows.map((r) => r.userId);
  },
  maybeAutoTrigger: (userId) => maybeAutoTriggerInBodyReassessment(userId, "SCHEDULED"),
};

let running = false;

export function startCycleEvaluationSweepJob(): void {
  logger.info(`Cycle evaluation sweep job started (interval: ${Math.round(SWEEP_INTERVAL_MS / 3_600_000)} hr)`);
  setInterval(() => {
    void runCycleEvaluationSweep();
  }, SWEEP_INTERVAL_MS);
}

export async function runCycleEvaluationSweep(
  deps: CycleEvaluationSweepDeps = defaultCycleEvaluationSweepDeps,
): Promise<{ scanned: number; triggered: number }> {
  if (running) {
    logger.info("[CycleEvaluationSweep] Previous run still in progress — skipping tick");
    return { scanned: 0, triggered: 0 };
  }
  running = true;
  try {
    const userIds = await deps.findActiveCycleUserIds(BATCH_SIZE);
    let triggered = 0;
    for (const userId of userIds) {
      try {
        const result = await deps.maybeAutoTrigger(userId);
        if (result.triggered) triggered += 1;
      } catch (err) {
        // Isolated per-user — one failure must never stop the rest of the batch.
        logger.warn({ err: (err as Error).message, userId }, "[CycleEvaluationSweep] user failed");
      }
    }
    if (userIds.length > 0) {
      logger.info(`[CycleEvaluationSweep] Scanned ${userIds.length}, triggered ${triggered}`);
    }
    return { scanned: userIds.length, triggered };
  } finally {
    running = false;
  }
}
