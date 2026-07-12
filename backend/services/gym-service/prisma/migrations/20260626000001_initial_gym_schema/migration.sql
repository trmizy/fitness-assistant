-- CreateEnum
CREATE TYPE "GymStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "GymMembershipPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GymMembershipContractStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AffiliationEmployment" AS ENUM ('IN_HOUSE', 'FREELANCE', 'PARTNER');

-- CreateEnum
CREATE TYPE "GymTrainerVisibility" AS ENUM ('PUBLIC', 'INTERNAL_ONLY');

-- CreateTable
CREATE TABLE "gyms" (
    "id"          TEXT NOT NULL,
    "owner_id"    TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "address"     TEXT NOT NULL,
    "city"        TEXT,
    "phone"       TEXT,
    "email"       TEXT,
    "status"      "GymStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_membership_plans" (
    "id"            TEXT NOT NULL,
    "gym_id"        TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "price"         DECIMAL(12, 2) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "visit_limit"   INTEGER,
    "status"        "GymMembershipPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_membership_contracts" (
    "id"                      TEXT NOT NULL,
    "gym_id"                  TEXT NOT NULL,
    "plan_id"                 TEXT NOT NULL,
    "client_id"               TEXT NOT NULL,
    "status"                  "GymMembershipContractStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_txn_id"          TEXT,
    "start_date"              TIMESTAMP(3),
    "end_date"                TIMESTAMP(3),
    "price_at_purchase"       DECIMAL(12, 2) NOT NULL,
    "duration_days_snapshot"  INTEGER NOT NULL,
    "total_visits"            INTEGER,
    "used_visits"             INTEGER NOT NULL DEFAULT 0,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_membership_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_trainer_affiliations" (
    "id"              TEXT NOT NULL,
    "gym_id"          TEXT NOT NULL,
    "pt_id"           TEXT NOT NULL,
    "status"          "AffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "employment_type" "AffiliationEmployment" NOT NULL DEFAULT 'FREELANCE',
    "visibility"      "GymTrainerVisibility" NOT NULL DEFAULT 'PUBLIC',
    "commission_rate" DECIMAL(5, 4),
    "invited_by"      TEXT,
    "joined_at"       TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_trainer_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gyms_status_idx" ON "gyms"("status");

-- CreateIndex
CREATE INDEX "gyms_owner_id_idx" ON "gyms"("owner_id");

-- CreateIndex
CREATE INDEX "gym_membership_plans_gym_id_status_idx" ON "gym_membership_plans"("gym_id", "status");

-- CreateIndex
CREATE INDEX "gym_membership_contracts_client_id_status_idx" ON "gym_membership_contracts"("client_id", "status");

-- CreateIndex
CREATE INDEX "gym_membership_contracts_gym_id_status_idx" ON "gym_membership_contracts"("gym_id", "status");

-- CreateIndex: open-membership guard — a client may hold at most one
-- PENDING_PAYMENT or ACTIVE membership per gym at any time (see plan §2.1).
CREATE UNIQUE INDEX "unique_open_membership_per_gym"
ON "gym_membership_contracts" ("client_id", "gym_id")
WHERE "status" IN ('PENDING_PAYMENT', 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "gym_trainer_affiliations_gym_id_pt_id_key" ON "gym_trainer_affiliations"("gym_id", "pt_id");

-- CreateIndex
CREATE INDEX "gym_trainer_affiliations_pt_id_status_idx" ON "gym_trainer_affiliations"("pt_id", "status");

-- CreateIndex
CREATE INDEX "gym_trainer_affiliations_gym_id_status_idx" ON "gym_trainer_affiliations"("gym_id", "status");

-- AddForeignKey
ALTER TABLE "gym_membership_plans" ADD CONSTRAINT "gym_membership_plans_gym_id_fkey"
    FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_membership_contracts" ADD CONSTRAINT "gym_membership_contracts_gym_id_fkey"
    FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_membership_contracts" ADD CONSTRAINT "gym_membership_contracts_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "gym_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_trainer_affiliations" ADD CONSTRAINT "gym_trainer_affiliations_gym_id_fkey"
    FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
