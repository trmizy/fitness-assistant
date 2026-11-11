# 05 — Database Integrity

## Question

Does the database structurally prevent impossible states, or does correctness rely only on application code?

## Method

- Read every Prisma schema (7 services) for relations, `@unique`, `@@unique`, `@@index`, and `onDelete`.
- Grepped all migration folders for `CREATE UNIQUE INDEX` and partial indexes not expressible in Prisma.
- Read destructive statements in migrations (`DROP`, `DELETE`, `UPDATE`) and rollback files.
- Did not connect to any production database (none available or used).

## Counts (from the schemas)

| Service | Relations | `onDelete` | `@unique` / `@@unique` |
|---|---|---|---|
| ai-service | 14 | 13 | 7 |
| auth-service | 3 | 3 | 6 |
| chat-service | 3 | 3 | 1 |
| fitness-service | 43 | 39 | 31 |
| gym-service | 23 | 13 | 13 |
| payment-service | 4 | 0 | 4 |
| user-service | 17 | 16 | 9 |

Counts are grep-based and approximate (they count annotation lines).

## Structural invariants enforced by the database (VERIFIED_OK from migrations)

| Invariant | Mechanism | Migration |
|---|---|---|
| One active training cycle per user | Partial unique index `training_cycles_one_active_per_user` | `20260730020000_training_cycle_active_unique_constraint` |
| One active fitness roadmap per user | Partial unique index `fitness_roadmaps_one_active_per_user` | `20260909090000_fitness_roadmap_phase` |
| One active roadmap phase per roadmap | `roadmap_phases_one_active_per_roadmap` | `20260909090000_fitness_roadmap_phase` |
| One active nutrition goal per user | Partial unique index `nutrition_goals_user_id_active_unique` | `20260818020000_add_nutrition_goal_versioning` |
| One workout program per AI action | `workout_programs_agent_action_id_key` (unique) | `20260907030000_agentic_fitness` |
| Idempotent plan import per user and source plan | `workout_programs_user_id_source_plan_id_key`; `WorkoutProgramDay @@unique([userId, sourcePlanId])` | `20260526093212_ai_plan_workout_schedule` |
| Nutrition program per source plan | `nutrition_programs_user_id_source_plan_id_key` | `20260816000000_catch_up_db_push_drift` (fitness) |
| Meal completion per user, meal and date | `nutrition_meal_completions_user_id_meal_id_log_date_key` | same |
| At most one InBody entry per user per day | Unique index `inbody_entries_user_id_date_only_key` | `user-service/…/20260528_inbody_unique_per_day` (**with a DELETE**, see G-04) |
| One active agent workflow per (user, session) | Partial unique index `agent_workflow_sessions_one_active_per_session` | `20260916090000_agent_workflow_session_active_unique` (ai) |

Partial indexes exist only in SQL and are not declared in Prisma (G-27). Dropping them through `prisma migrate` would silently remove the
invariant.

## Gaps

### Destructive or data-changing migrations (G-04, P0)
Across all services, `migration.sql` files contain 2 `DROP TABLE`, 3 `DROP COLUMN`, and 3 `DELETE FROM` statements. Notable:
- `user-service/.../20260528_inbody_unique_per_day`: deletes older InBody rows per user and day. These are measured body values, owned by the
  measurements source of truth. The comment calls them test data; the migration cannot tell test data from real data.
- `ai-service/.../20260606001000_dedupe_pending_review_items`: deletes duplicate pending review rows.
- `fitness-service/.../20260730020000_training_cycle_active_unique_constraint`: updates training cycles before adding the unique index.

Rollback files: 5, all in fitness-service. No rollback for the user-service or ai-service destructive migrations.

### Drift and history (G-20, P1)
Catch-up migrations (`*_catch_up_db_push_drift`) record that tables were created with `prisma db push` outside migration history. From-zero replay
and schema-diff checks are not in CI for all services.

### Soft cross-service references (G-28, P2)
`user_id` columns are values, not foreign keys, across service databases. No cross-service orphan check exists.

### Timezone handling
Timestamps use `DateTime` (UTC in Prisma). Calendar-day logic (InBody per day, meal log date) uses `date_only` columns. Local-day semantics for
Vietnam (UTC+7) were not traced; NEEDS_RUNTIME_VERIFICATION for boundary tests (23:30 local).

### Soft deletion
No general soft-delete convention was found. Deletion behaviour is per model (`onDelete` set on 34 relations in fitness, mostly cascade or
restrict). Acceptable if documented; NOT documented in this repository.

### Nullable invariants
Not audited field by field (`NOT_VERIFIED`). Spot checks: `WorkoutProgram.agentActionId` is nullable with a unique index (correct for
self-service programs); `AgentWorkflowSession.pendingProfileUpdate` nullable with `Prisma.DbNull` semantics (documented).

### Indexes
Lookups by `userId` are indexed on the main tables (for example `@@index([userId, status])`). Hot-path query plans were not measured (P4-T02).

## Transactions and race conditions

- Confirmation uses a conditional `updateMany` as a claim (atomic at the row level). Covered in [06-workflow-concurrency-idempotency.md](06-workflow-concurrency-idempotency.md).
- Multi-table writes (for example plan import creating program and days) rely on Prisma transactions; not every call site was traced
  (NOT_VERIFIED).

## Migration strategy

- Production compose has no migration step. Test CI runs `prisma migrate deploy` for test databases (`scripts/prisma-test.mjs`), and a
  comment there says `db push` is never used for the test flow. Production procedure is undocumented (G-04, G-20).

## Required before release

1. Migration policy and destructive-statement review (P0-T05).
2. From-zero replay and schema-diff job (P1-T07).
3. Document partial indexes in Prisma schema comments (G-27).
4. Local-day boundary tests for InBody and meal logs (P1 test addition).
