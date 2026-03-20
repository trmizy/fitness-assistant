-- Migrate auth role enum from USER/ADMIN to CUSTOMER/PT/ADMIN
CREATE TYPE "Role_new" AS ENUM ('CUSTOMER', 'PT', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

UPDATE "users"
SET "role" = 'CUSTOMER'
WHERE "role"::text = 'USER';

ALTER TABLE "users"
ALTER COLUMN "role" TYPE "Role_new"
USING ("role"::text::"Role_new");

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
