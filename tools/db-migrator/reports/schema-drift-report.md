# Schema Drift Report

Generated (UTC): 2026-09-23T14:16:31Z

Method: `prisma migrate diff` from the live Aurora schema (`--from-url`) to the
repo's checked-in Prisma migrations (`--to-migrations`), computed via a disposable
local shadow Postgres that only ever replays repo migration.sql files. No column
type is ever guessed — every type comes straight from the migration that created it.

| Database | Service | Audit status | Safe (auto-patched) | Needs manual review |
|---|---|---|---|---|
| fitness_assistant | auth-service | OK | 0 | 1 |
| fitness_assistant_user | user-service | OK | 6 | 5 |
| fitness_assistant_fitness | fitness-service | OK | 0 | 2 |
| fitness_assistant_gym | gym-service | OK | 0 | 16 |
| fitness_assistant_payment | payment-service | OK | 0 | 0 |
| fitness_assistant_chat | chat-service | OK | 0 | 0 |
| fitness_assistant_ai | ai-service | OK | 0 | 0 |

## Enum data drift (from actual dump content, not just schema diffing)

Method: for every enum-typed column the real migrations define (read from
the shadow Postgres, so this covers brand-new tables too), the matching
table's literal `COPY` data is extracted directly from that database's
`.dump` file with `pg_restore -t <table> -f -` (no database touched, no
value ever guessed) and every distinct value found is compared against
Aurora's live `pg_enum`. This catches values used in old row data that
aren't in any current migration — schema-only diffing can't see those,
and it is exactly what broke `fitness_assistant_user` restore before
(`WORKOUT_UPCOMING`). All statements below are already included in
`generated/schema-prepatch.<db>.sql` as `ADD VALUE IF NOT EXISTS`.

| Database | Enum type | Missing value(s) | Evidence (table.column) |
|---|---|---|---|
| fitness_assistant_user | NotificationEntityType | NUTRITION_PROGRAM,TRAINING_CYCLE,TRAINING_PROGRAM,WORKOUT_SCHEDULE | notifications.entity_type |
| fitness_assistant_user | NotificationEventType | CYCLE_REASSESSMENT_READY,NUTRITION_PLAN_READY,PT_FEEDBACK_RECEIVED,TRAINING_PLAN_UPDATED,WORKOUT_RESCHEDULED,WORKOUT_UNFINISHED,WORKOUT_UPCOMING | notifications.event_type |

## Needs-manual-review detail

### fitness_assistant

```sql
-- [fitness_assistant] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

```

### fitness_assistant_user

```sql
-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "agent_contract_drafts" ADD CONSTRAINT "agent_contract_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

```

### fitness_assistant_fitness

```sql
-- [fitness_assistant_fitness] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "fitness_roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_fitness] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_roadmap_phase_id_fkey" FOREIGN KEY ("roadmap_phase_id") REFERENCES "roadmap_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

```

### fitness_assistant_gym

```sql
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

```

## How to apply

1. Review this report and `generated/schema-prepatch.sql`.
2. If any database is listed above under "Needs-manual-review detail", resolve it
   manually first (confirm the real source-of-truth column/table shape) — the
   prepatch intentionally excludes those statements.
3. Run `MODE=apply-prepatch` to apply the safe, idempotent patch to Aurora.
