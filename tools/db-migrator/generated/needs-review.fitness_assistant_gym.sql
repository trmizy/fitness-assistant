-- [fitness_assistant_gym] AlterTable  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_membership_plans" ALTER COLUMN "brand_id" SET NOT NULL;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_branch_documents" ADD CONSTRAINT "gym_branch_documents_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_branch_review_issues" ADD CONSTRAINT "gym_branch_review_issues_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_complaints" ADD CONSTRAINT "gym_complaints_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_membership_plans" ADD CONSTRAINT "gym_membership_plans_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_operating_hours" ADD CONSTRAINT "gym_operating_hours_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_partner_accounts" ADD CONSTRAINT "gym_partner_accounts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_partner_contact_logs" ADD CONSTRAINT "gym_partner_contact_logs_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_partner_document_files" ADD CONSTRAINT "gym_partner_document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gym_partner_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_partner_documents" ADD CONSTRAINT "gym_partner_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_partner_review_issues" ADD CONSTRAINT "gym_partner_review_issues_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "gym_photos" ADD CONSTRAINT "gym_photos_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "partner_audit_logs" ADD CONSTRAINT "partner_audit_logs_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "partner_internal_notes" ADD CONSTRAINT "partner_internal_notes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "partner_upload_intents" ADD CONSTRAINT "partner_upload_intents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

