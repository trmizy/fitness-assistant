-- PT-lock slice 1: a durable order for lock/unlock commands, and a way to retire a superseded one.
--
-- seq   — allocated by the database when the command row is created (same shape as a BIGSERIAL
--         column). Existing rows are numbered by created_at so history keeps its order.
-- SUPERSEDED — a later command exists for the same PT, so this one is never (re)sent. The relay
--         sweep used to re-send an old FAILED DEACTIVATE every 5 minutes even after the admin had
--         unlocked the PT.
-- Additive only: no column or value is removed or changed.
ALTER TYPE "PtDeactivationCallStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

CREATE SEQUENCE "pt_deactivation_calls_seq_seq";

ALTER TABLE "pt_deactivation_calls" ADD COLUMN "seq" BIGINT;

UPDATE "pt_deactivation_calls" AS t
SET "seq" = n.rn
FROM (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn
    FROM "pt_deactivation_calls"
) AS n
WHERE t."id" = n."id";

SELECT setval('pt_deactivation_calls_seq_seq', COALESCE((SELECT MAX("seq") FROM "pt_deactivation_calls"), 0) + 1, false);

ALTER TABLE "pt_deactivation_calls" ALTER COLUMN "seq" SET DEFAULT nextval('pt_deactivation_calls_seq_seq');
ALTER TABLE "pt_deactivation_calls" ALTER COLUMN "seq" SET NOT NULL;
ALTER SEQUENCE "pt_deactivation_calls_seq_seq" OWNED BY "pt_deactivation_calls"."seq";

CREATE UNIQUE INDEX "pt_deactivation_calls_seq_key" ON "pt_deactivation_calls"("seq");
CREATE INDEX "pt_deactivation_calls_pt_user_id_seq_idx" ON "pt_deactivation_calls"("pt_user_id", "seq");
