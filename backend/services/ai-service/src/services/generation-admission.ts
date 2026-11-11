import { consumeRateLimit } from "../middleware/rate-limit.middleware";
import { expensiveBudget } from "../middleware/ai-rate-limiters";

/**
 * Admission for BILLABLE QUEUED GENERATION, enforced at the domain command (the queue*Generation
 * functions in conversation.service.ts) rather than at an HTTP route, so every entry point — the
 * REST /plans/* routes and the AI-chat nutrition propose/revise flow — draws on the SAME per-user
 * "ai-expensive" allowance exactly once per generation. Call it AFTER ownership/validation checks
 * and BEFORE any plan row is created or any job is published: a refused request leaves no
 * orphan plan and enqueues nothing.
 *
 * `verifiedUserId` must be the authenticated actor (req.context.userId / the agent identity),
 * never a request-body value. Throws RateLimitedError (429, retryAfterSeconds) or
 * RateLimitUnavailableError (503, fail-closed); resolves when admitted.
 *
 * This is a quota charge, NOT an idempotency key: two identical calls are two generations (see
 * V-T012_1_IMPLEMENTATION_REPORT.md for the durable operation-ID design that needs approval).
 */
export async function admitBillableGeneration(verifiedUserId: string): Promise<void> {
  await consumeRateLimit(expensiveBudget, verifiedUserId);
}
