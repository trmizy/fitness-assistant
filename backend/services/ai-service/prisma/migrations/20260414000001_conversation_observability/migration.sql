-- Migration: add observability fields to conversations table
-- These columns persist trace metadata from the LLM orchestrator so the
-- admin dashboard can show request-level insights without re-running LLM calls.

ALTER TABLE "conversations"
  ADD COLUMN "trace_id"                    TEXT,
  ADD COLUMN "used_fallback"               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "used_deterministic_fallback" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_language"           TEXT,
  ADD COLUMN "route_intent"                TEXT,
  ADD COLUMN "warning_count"               INTEGER NOT NULL DEFAULT 0;

-- Partial index: only rows that actually used the fallback path (usually rare)
CREATE INDEX "conversations_used_fallback_idx"  ON "conversations" ("used_fallback") WHERE "used_fallback" = true;
CREATE INDEX "conversations_route_intent_idx"   ON "conversations" ("route_intent");
CREATE INDEX "conversations_response_time_idx"  ON "conversations" ("response_time");
