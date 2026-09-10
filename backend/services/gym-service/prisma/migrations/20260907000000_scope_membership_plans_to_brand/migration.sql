-- One owner, one brand: a membership plan is sold by the brand, not any one branch, so a
-- client who buys it can check in (and draw down the shared visit_limit) at any of the
-- brand's branches. GymMembershipContract keeps its own gym_id unchanged (which branch the
-- client actually checked out at, for revenue/collaboration/referral attribution) — only the
-- plan definition itself moves to brand-level.

-- Step 1: every gym that currently has a membership plan needs a brand before plans.brand_id
-- can be backfilled from it. Reuse the owner's existing brand if they have one (one owner, one
-- brand); create one named after the gym if they don't — this is the same "auto-brand" rule
-- applied retroactively, only for gyms a real plan actually depends on.
DO $$
DECLARE
  r RECORD;
  resolved_brand_id TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT g.id AS gym_id, g.owner_id, g.name AS gym_name
    FROM gyms g
    WHERE g.id IN (SELECT DISTINCT gym_id FROM gym_membership_plans)
      AND g.brand_id IS NULL
  LOOP
    SELECT id INTO resolved_brand_id FROM gym_brands WHERE owner_id = r.owner_id ORDER BY created_at ASC LIMIT 1;
    IF resolved_brand_id IS NULL THEN
      resolved_brand_id := gen_random_uuid();
      INSERT INTO gym_brands (id, owner_id, name, pending_name, created_at, updated_at)
      VALUES (resolved_brand_id, r.owner_id, r.gym_name, r.gym_name, now(), now());
    END IF;
    UPDATE gyms SET brand_id = resolved_brand_id WHERE id = r.gym_id;
  END LOOP;
END $$;

-- Step 2: add brand_id, backfilled from each plan's (now guaranteed to have one) gym.
ALTER TABLE "gym_membership_plans" ADD COLUMN "brand_id" TEXT;
UPDATE "gym_membership_plans" p SET brand_id = g.brand_id FROM gyms g WHERE g.id = p.gym_id;
ALTER TABLE "gym_membership_plans" ALTER COLUMN "brand_id" SET NOT NULL;

-- Step 3: swap the FK/index from gym_id to brand_id, drop gym_id.
ALTER TABLE "gym_membership_plans" DROP CONSTRAINT "gym_membership_plans_gym_id_fkey";
DROP INDEX "gym_membership_plans_gym_id_status_idx";
ALTER TABLE "gym_membership_plans" ADD CONSTRAINT "gym_membership_plans_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "gym_membership_plans_brand_id_status_idx" ON "gym_membership_plans"("brand_id", "status");
ALTER TABLE "gym_membership_plans" DROP COLUMN "gym_id";
