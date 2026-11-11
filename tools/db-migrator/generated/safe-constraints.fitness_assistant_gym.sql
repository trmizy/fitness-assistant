-- [fitness_assistant_gym] audit-proven safe statements only
-- [fitness_assistant_gym] SAFE_FK: gym_branch_documents(gym_id) -> gyms(id), orphans=0
ALTER TABLE "gym_branch_documents" ADD CONSTRAINT "gym_branch_documents_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_branch_review_issues(gym_id) -> gyms(id), orphans=0
ALTER TABLE "gym_branch_review_issues" ADD CONSTRAINT "gym_branch_review_issues_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_complaints(gym_id) -> gyms(id), orphans=0
ALTER TABLE "gym_complaints" ADD CONSTRAINT "gym_complaints_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_membership_plans(brand_id) -> gym_brands(id), orphans=0
ALTER TABLE "gym_membership_plans" ADD CONSTRAINT "gym_membership_plans_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_operating_hours(gym_id) -> gyms(id), orphans=0
ALTER TABLE "gym_operating_hours" ADD CONSTRAINT "gym_operating_hours_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_partner_accounts(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "gym_partner_accounts" ADD CONSTRAINT "gym_partner_accounts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_partner_contact_logs(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "gym_partner_contact_logs" ADD CONSTRAINT "gym_partner_contact_logs_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_partner_document_files(document_id) -> gym_partner_documents(id), orphans=0
ALTER TABLE "gym_partner_document_files" ADD CONSTRAINT "gym_partner_document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gym_partner_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_partner_documents(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "gym_partner_documents" ADD CONSTRAINT "gym_partner_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_partner_review_issues(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "gym_partner_review_issues" ADD CONSTRAINT "gym_partner_review_issues_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: gym_photos(gym_id) -> gyms(id), orphans=0
ALTER TABLE "gym_photos" ADD CONSTRAINT "gym_photos_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: partner_audit_logs(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "partner_audit_logs" ADD CONSTRAINT "partner_audit_logs_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: partner_internal_notes(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "partner_internal_notes" ADD CONSTRAINT "partner_internal_notes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: partner_invitations(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_gym] SAFE_FK: partner_upload_intents(partner_id) -> gym_partners(id), orphans=0
ALTER TABLE "partner_upload_intents" ADD CONSTRAINT "partner_upload_intents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

