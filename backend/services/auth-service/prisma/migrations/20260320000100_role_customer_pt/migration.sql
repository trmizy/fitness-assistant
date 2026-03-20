-- Migrate auth role enum from USER/ADMIN to CUSTOMER/PT/ADMIN
CREATE TYPE "Role_new" AS ENUM ('CUSTOMER', 'PT', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "role" TYPE "Role_new"
USING (
  CASE 
    WHEN "role"::text = 'USER' THEN 'CUSTOMER'::"Role_new"
    ELSE "role"::text::"Role_new"
  END
);

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
