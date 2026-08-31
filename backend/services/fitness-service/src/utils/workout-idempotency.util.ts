/**
 * Roadmap P1.4 "Active-workout offline resilience"
 * (docs/features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md).
 *
 * Direct structural port of payment-service's `withIdempotentLedgerOp`
 * (ledger-idempotency.ts) — same pattern, same reasoning: a caller (the
 * offline queue's drain, or a plain network retry) can legitimately
 * re-submit the exact same mutation after a crash/timeout that happened
 * *after* the server committed it but *before* the caller learned that.
 * Without a business-level key, that retry would re-execute the mutation
 * a second time.
 *
 * `eventId` is optional and MUST stay that way: every pre-existing caller
 * of updateSet/completeScheduleExercise/undoCompleteScheduleExercise that
 * never sends one keeps today's exact behavior (`run()` executes every
 * time, no ledger row ever written for it) — this is purely additive.
 *
 * Must be called with the SAME transaction (`tx`) the mutation itself
 * runs in, so "the ledger row exists" and "the mutation committed" can
 * never disagree: either both commit together, or a crash mid-transaction
 * rolls back both and a retry starts clean.
 */
export async function withIdempotentEvent<T>(
  tx: any,
  eventId: string | undefined | null,
  userId: string,
  type: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!eventId) return run();

  const existing = await tx.workoutMutationEvent.findUnique({ where: { id: eventId } });
  if (existing) {
    if (existing.userId !== userId) {
      // A UUID collision across users is astronomically unlikely, but
      // never silently hand back another user's result if it somehow
      // happened — fail loudly instead of leaking cross-user data.
      throw { status: 409, message: "This event id was already used by a different session" };
    }
    return existing.result as T;
  }

  const result = await run();
  await tx.workoutMutationEvent.create({
    data: { id: eventId, userId, type, result: result as any },
  });
  return result;
}
