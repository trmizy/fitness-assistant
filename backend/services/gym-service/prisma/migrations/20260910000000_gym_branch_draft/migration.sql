-- GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell. A DRAFT branch can exist
-- before any validation runs; wizard_step is the server-trusted resume point.

-- AlterEnum
ALTER TYPE "GymStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "wizard_step" INTEGER;
