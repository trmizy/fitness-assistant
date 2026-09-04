import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { personalizedServiceService } from "./personalized-service.service";

/**
 * P0 cluster C3 — a Personalized Service buyer must not be able to leave a PT uncredited
 * forever by simply never responding to a delivered draft. Mirrors
 * session-autoconfirm.service.ts (user-service) exactly: same interval shape, same overlap
 * guard, same "call the one real function the manual path also uses" discipline
 * (commitAcceptance — see personalized-service.service.ts's own doc comment on why acceptOrder
 * and this sweep must never drift into two separate implementations of "accepted").
 *
 * A second, smaller pass in the same tick retries releaseOrder for any order that reached
 * ACCEPTED/ACTIVE but never actually got its money released (commitAcceptance's release step
 * is deliberately best-effort and does not throw on failure — see its own comment) — the
 * self-healing half of that design, not a separate concern.
 */
const INTERVAL_MS = Number(process.env.PERSONALIZED_SERVICE_AUTOACCEPT_INTERVAL_MS ?? 15 * 60 * 1000);
const BATCH_SIZE = 50;

let running = false;

export function startPersonalizedServiceAutoAcceptJob(): void {
  logger.info(`Personalized-service auto-accept sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runAutoAcceptSweep();
  }, INTERVAL_MS);
}

export async function runAutoAcceptSweep(): Promise<{ autoAccepted: number; releaseRetried: number }> {
  if (running) {
    logger.info("[PersonalizedServiceAutoAccept] Previous run still in progress — skipping tick");
    return { autoAccepted: 0, releaseRetried: 0 };
  }
  running = true;

  let autoAccepted = 0;
  let releaseRetried = 0;
  try {
    const due = await prisma.personalizedServiceOrder.findMany({
      where: { status: "DRAFT_DELIVERED", autoAcceptDeadline: { lte: new Date() } },
      take: BATCH_SIZE,
    });
    if (due.length > 0) {
      logger.info(`[PersonalizedServiceAutoAccept] ${due.length} order(s) past the review window — auto-accepting`);
      for (const order of due) {
        try {
          await personalizedServiceService.commitAcceptance(order);
          autoAccepted++;
        } catch (err) {
          // One bad order (e.g. fitness-service down when commitPersonalizedPlan runs) must
          // not block the rest of the batch — it stays DRAFT_DELIVERED, past its deadline,
          // and is picked up again next tick.
          logger.error({
            error: "[PersonalizedServiceAutoAccept] auto-accept failed for one order",
            orderId: order.id,
            message: (err as Error).message,
          });
        }
      }
    }

    const unreleased = await prisma.personalizedServiceOrder.findMany({
      where: { status: { in: ["ACCEPTED", "ACTIVE"] }, releasedAt: null, paymentTransactionId: { not: null } },
      take: BATCH_SIZE,
    });
    if (unreleased.length > 0) {
      logger.info(`[PersonalizedServiceAutoAccept] ${unreleased.length} accepted order(s) never had their money released — retrying`);
      for (const order of unreleased) {
        try {
          await personalizedServiceService.retryRelease(order);
          releaseRetried++;
        } catch (err) {
          logger.error({
            error: "[PersonalizedServiceAutoAccept] release retry failed for one order",
            orderId: order.id,
            message: (err as Error).message,
          });
        }
      }
    }

    return { autoAccepted, releaseRetried };
  } catch (err) {
    logger.error({ error: "[PersonalizedServiceAutoAccept] sweep failed", message: (err as Error).message });
    return { autoAccepted, releaseRetried };
  } finally {
    running = false;
  }
}
