-- GYM_MANAGEMENT master spec, Phase 5 — Complaints/Violations. One shared table for every
-- source (SELF_DETECTED/MEMBER_REPORT/PT_REPORT/PARTNER_DISCLOSED), distinguished by
-- `source`, not four separate tables — the design decision confirmed with the user.
-- photo_tokens hold opaque tokens issued by the private complaint-photo upload endpoint,
-- never a public URL — evidence photos are never shown publicly (confirmed requirement).

-- CreateEnum
CREATE TYPE "ComplaintSource" AS ENUM ('SELF_DETECTED', 'MEMBER_REPORT', 'PT_REPORT', 'PARTNER_DISCLOSED');

-- CreateEnum
CREATE TYPE "ComplaintIssueType" AS ENUM ('CLEANLINESS', 'STAFF_BEHAVIOR', 'EQUIPMENT_CONDITION', 'FALSE_ADVERTISING', 'BILLING', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "gym_complaints" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "source" "ComplaintSource" NOT NULL,
    "issue_type" "ComplaintIssueType" NOT NULL,
    "reporter_user_id" TEXT,
    "description" TEXT NOT NULL,
    "photo_tokens" TEXT[],
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_admin_id" TEXT,
    "admin_response" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_complaints_gym_id_status_idx" ON "gym_complaints"("gym_id", "status");

-- CreateIndex
CREATE INDEX "gym_complaints_partner_id_created_at_idx" ON "gym_complaints"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_complaints_reporter_user_id_idx" ON "gym_complaints"("reporter_user_id");

-- CreateIndex
CREATE INDEX "gym_complaints_status_idx" ON "gym_complaints"("status");

-- AddForeignKey
ALTER TABLE "gym_complaints" ADD CONSTRAINT "gym_complaints_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
