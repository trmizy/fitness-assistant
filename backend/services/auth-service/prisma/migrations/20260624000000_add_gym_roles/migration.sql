-- Add GYM_OWNER and GYM_STAFF to Role enum
-- Uses CREATE TYPE + RENAME pattern (same as 20260320000100_role_customer_pt) to stay transaction-safe.
CREATE TYPE "Role_new" AS ENUM ('CUSTOMER', 'PT', 'GYM_OWNER', 'GYM_STAFF', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "role" TYPE "Role_new"
USING ("role"::text::"Role_new");

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
