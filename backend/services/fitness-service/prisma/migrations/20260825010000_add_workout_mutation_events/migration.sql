-- Roadmap P1.4 "Active-workout offline resilience"
-- (docs/features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md).
-- Direct structural mirror of payment-service's LedgerOperation
-- (src/services/ledger-idempotency.ts) — the same idempotent-replay
-- pattern, ported for consistency rather than inventing a new one.
CREATE TABLE "workout_mutation_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_mutation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workout_mutation_events_user_id_idx" ON "workout_mutation_events"("user_id");
