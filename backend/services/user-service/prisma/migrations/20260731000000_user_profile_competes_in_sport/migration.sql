-- Adds a boolean flag distinguishing a competing/professional athlete from
-- an ADVANCED recreational lifter. Additive, defaults to false for all
-- existing rows (never guessed as true).
ALTER TABLE "user_profiles" ADD COLUMN "competes_in_sport" BOOLEAN NOT NULL DEFAULT false;
