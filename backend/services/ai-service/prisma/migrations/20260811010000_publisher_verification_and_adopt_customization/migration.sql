ALTER TABLE "published_plans"
  ADD COLUMN IF NOT EXISTS "publisher_is_verified_pt" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "plan_adoptions"
  ADD COLUMN IF NOT EXISTS "was_customized" BOOLEAN NOT NULL DEFAULT false;
