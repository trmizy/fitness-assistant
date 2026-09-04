-- Vòng 4 / Phase E2 — tracks whether a NO_SHOW session was the PT's fault, so a contract can
-- count "how many times has this PT no-showed" and give the client the right to terminate for
-- a full refund after the third one.

ALTER TABLE "sessions" ADD COLUMN "pt_at_fault" BOOLEAN NOT NULL DEFAULT false;

-- Best-effort backfill for existing rows: before this column existed, the only signal for
-- "this NO_SHOW was the PT's fault" was the free-text pt_notes value the two PT-fault code
-- paths (markNoShow's self-admit branch, resolveDispute's PT_NO_SHOW_CONFIRMED) always wrote
-- verbatim. A client no-show or a late-cancel tagged NO_SHOW never wrote either exact string.
UPDATE "sessions"
SET "pt_at_fault" = true
WHERE "status" = 'NO_SHOW'
  AND "pt_notes" IN ('PT no-show', 'Quản trị viên xác nhận huấn luyện viên vắng mặt');
