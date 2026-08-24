-- Money-flow redesign plan 5.1: remove GYM_STAFF from the Role enum. Verified zero accounts
-- hold this role before running this (see docs/money-flow.md's "Quyết định phát sinh").
-- PostgreSQL cannot DROP VALUE from an enum, so this recreates the type — same
-- CREATE TYPE + swap pattern as 20260624000000_add_gym_roles (which added the value this
-- migration removes) and 20260320000100_role_customer_pt.
CREATE TYPE "Role_new" AS ENUM ('CUSTOMER', 'PT', 'GYM_OWNER', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "role" TYPE "Role_new"
USING ("role"::text::"Role_new");

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
