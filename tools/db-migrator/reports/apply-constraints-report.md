# Apply Constraints Report

Generated (UTC): 2026-09-29T07:45:22Z

Applies ONLY `ADD CONSTRAINT ... FOREIGN KEY` statements already present in
`generated/safe-constraints.<db>.sql` (produced by a prior live constraint-audit
run — every one already proven zero-orphan). Immediately before executing, each
statement is re-verified against LIVE Aurora (table/column existence, constraint
not already present, orphan count recomputed to still be zero) — this catches any
data change between audit time and apply time instead of trusting a stale report.
All FKs for one database run inside a single transaction (`ON_ERROR_STOP=1`); if
any statement in that transaction fails, the whole batch for that database rolls
back automatically (Postgres rolls back any uncommitted transaction on error/exit)
— no partial set of constraints is ever left for one database.

The MANUAL item (`gym_membership_plans.brand_id SET NOT NULL`) is not a
`FOREIGN KEY` statement and never appears in `safe-constraints.*.sql` in the
first place — this mode has no code path that could execute it.

## Summary

| Metric | Count |
|---|---|
| Attempted (from safe-constraints files) | 23 |
| Applied | 23 |
| Applied + confirmed VALIDATED | 23 |
| Skipped (re-verification failed, not executed) | 0 |
| Database batches rolled back (transaction failure) | 0 |

## Detail

| Database | Constraint | Child -> Parent | Result | Detail |
|---|---|---|---|---|
| fitness_assistant | `password_reset_tokens_user_id_fkey` | password_reset_tokens(user_id) -> users(id) | APPLIED + VALIDATED | FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_user | `agent_contract_drafts_user_id_fkey` | agent_contract_drafts(user_id) -> user_profiles(userId) | APPLIED + VALIDATED | FOREIGN KEY (user_id) REFERENCES user_profiles("userId") ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_user | `client_journeys_contract_id_fkey` | client_journeys(contract_id) -> contracts(id) | APPLIED + VALIDATED | FOREIGN KEY (contract_id) REFERENCES contracts(id) ON UPDATE CASCADE ON DELETE SET NULL |
| fitness_assistant_user | `client_journeys_user_id_fkey` | client_journeys(user_id) -> user_profiles(userId) | APPLIED + VALIDATED | FOREIGN KEY (user_id) REFERENCES user_profiles("userId") ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_user | `client_reviews_contract_id_fkey` | client_reviews(contract_id) -> contracts(id) | APPLIED + VALIDATED | FOREIGN KEY (contract_id) REFERENCES contracts(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_user | `client_reviews_session_id_fkey` | client_reviews(session_id) -> sessions(id) | APPLIED + VALIDATED | FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_fitness | `roadmap_phases_roadmap_id_fkey` | roadmap_phases(roadmap_id) -> fitness_roadmaps(id) | APPLIED + VALIDATED | FOREIGN KEY (roadmap_id) REFERENCES fitness_roadmaps(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_fitness | `training_cycles_roadmap_phase_id_fkey` | training_cycles(roadmap_phase_id) -> roadmap_phases(id) | APPLIED + VALIDATED | FOREIGN KEY (roadmap_phase_id) REFERENCES roadmap_phases(id) ON UPDATE CASCADE ON DELETE SET NULL |
| fitness_assistant_gym | `gym_branch_documents_gym_id_fkey` | gym_branch_documents(gym_id) -> gyms(id) | APPLIED + VALIDATED | FOREIGN KEY (gym_id) REFERENCES gyms(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_branch_review_issues_gym_id_fkey` | gym_branch_review_issues(gym_id) -> gyms(id) | APPLIED + VALIDATED | FOREIGN KEY (gym_id) REFERENCES gyms(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_complaints_gym_id_fkey` | gym_complaints(gym_id) -> gyms(id) | APPLIED + VALIDATED | FOREIGN KEY (gym_id) REFERENCES gyms(id) ON UPDATE CASCADE ON DELETE RESTRICT |
| fitness_assistant_gym | `gym_membership_plans_brand_id_fkey` | gym_membership_plans(brand_id) -> gym_brands(id) | APPLIED + VALIDATED | FOREIGN KEY (brand_id) REFERENCES gym_brands(id) ON UPDATE CASCADE ON DELETE RESTRICT |
| fitness_assistant_gym | `gym_operating_hours_gym_id_fkey` | gym_operating_hours(gym_id) -> gyms(id) | APPLIED + VALIDATED | FOREIGN KEY (gym_id) REFERENCES gyms(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_partner_accounts_partner_id_fkey` | gym_partner_accounts(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_partner_contact_logs_partner_id_fkey` | gym_partner_contact_logs(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_partner_document_files_document_id_fkey` | gym_partner_document_files(document_id) -> gym_partner_documents(id) | APPLIED + VALIDATED | FOREIGN KEY (document_id) REFERENCES gym_partner_documents(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_partner_documents_partner_id_fkey` | gym_partner_documents(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_partner_review_issues_partner_id_fkey` | gym_partner_review_issues(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `gym_photos_gym_id_fkey` | gym_photos(gym_id) -> gyms(id) | APPLIED + VALIDATED | FOREIGN KEY (gym_id) REFERENCES gyms(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `partner_audit_logs_partner_id_fkey` | partner_audit_logs(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `partner_internal_notes_partner_id_fkey` | partner_internal_notes(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `partner_invitations_partner_id_fkey` | partner_invitations(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
| fitness_assistant_gym | `partner_upload_intents_partner_id_fkey` | partner_upload_intents(partner_id) -> gym_partners(id) | APPLIED + VALIDATED | FOREIGN KEY (partner_id) REFERENCES gym_partners(id) ON UPDATE CASCADE ON DELETE CASCADE |
