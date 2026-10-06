# Constraint Audit Report

Generated (UTC): 2026-09-29T07:46:53Z

**Read-only audit.** No constraint was added, no data was changed, nothing in
`generated/safe-constraints*.sql` has been executed. Every count comes from a
live query against Aurora. FK orphan check uses PostgreSQL's default `MATCH SIMPLE`
semantics: a row is only checked when **all** key columns are non-null.

## Summary

| Status | Count |
|---|---|
| SAFE_FK | 0 |
| BLOCKED_ORPHANS | 0 |
| SAFE_ENUM_ADD | 0 |
| ALREADY_APPLIED | 23 |
| MANUAL | 1 |
| INVALID_REFERENCE | 0 |

## Findings

| Database | Statement type | Constraint / enum | Child → Parent | Total rows | Non-null rows | Orphan count | Status | Recommendation |
|---|---|---|---|---|---|---|---|---|
| fitness_assistant | AddForeignKey | `password_reset_tokens_user_id_fkey` | password_reset_tokens(user_id) → users(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_user | AddForeignKey | `agent_contract_drafts_user_id_fkey` | agent_contract_drafts(user_id) → user_profiles(userId) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_user | AddForeignKey | `client_journeys_contract_id_fkey` | client_journeys(contract_id) → contracts(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_user | AddForeignKey | `client_journeys_user_id_fkey` | client_journeys(user_id) → user_profiles(userId) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_user | AddForeignKey | `client_reviews_contract_id_fkey` | client_reviews(contract_id) → contracts(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_user | AddForeignKey | `client_reviews_session_id_fkey` | client_reviews(session_id) → sessions(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_fitness | AddForeignKey | `roadmap_phases_roadmap_id_fkey` | roadmap_phases(roadmap_id) → fitness_roadmaps(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_fitness | AddForeignKey | `training_cycles_roadmap_phase_id_fkey` | training_cycles(roadmap_phase_id) → roadmap_phases(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AlterTable(SET NOT NULL) | `gym_membership_plans.brand_id` | — | 8 | 8 | 0 | MANUAL | 0 NULL rows out of 8 — SET NOT NULL would succeed today, but still MANUAL by design (narrows a column, not additive) |
| fitness_assistant_gym | AddForeignKey | `gym_branch_documents_gym_id_fkey` | gym_branch_documents(gym_id) → gyms(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_branch_review_issues_gym_id_fkey` | gym_branch_review_issues(gym_id) → gyms(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_complaints_gym_id_fkey` | gym_complaints(gym_id) → gyms(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_membership_plans_brand_id_fkey` | gym_membership_plans(brand_id) → gym_brands(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_operating_hours_gym_id_fkey` | gym_operating_hours(gym_id) → gyms(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_partner_accounts_partner_id_fkey` | gym_partner_accounts(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_partner_contact_logs_partner_id_fkey` | gym_partner_contact_logs(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_partner_document_files_document_id_fkey` | gym_partner_document_files(document_id) → gym_partner_documents(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_partner_documents_partner_id_fkey` | gym_partner_documents(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_partner_review_issues_partner_id_fkey` | gym_partner_review_issues(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `gym_photos_gym_id_fkey` | gym_photos(gym_id) → gyms(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `partner_audit_logs_partner_id_fkey` | partner_audit_logs(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `partner_internal_notes_partner_id_fkey` | partner_internal_notes(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `partner_invitations_partner_id_fkey` | partner_invitations(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |
| fitness_assistant_gym | AddForeignKey | `partner_upload_intents_partner_id_fkey` | partner_upload_intents(partner_id) → gym_partners(id) | 0 | 0 | 0 | ALREADY_APPLIED | constraint already exists on Aurora |

## Orphan foreign keys

_None. Every audited foreign key has zero orphan rows._

## Outputs

- `generated/safe-constraints.sql` (+ `safe-constraints.<db>.sql`): only SAFE_FK and SAFE_ENUM_ADD.
- `generated/blocked-constraints.sql` (+ per-db): BLOCKED_ORPHANS, INVALID_REFERENCE, MANUAL, with reasons.
