# AWS Full Local Data Migration — Schema Drift Reconciliation

Date: 2026-09-16. Responds to `docs/aws-full-local-data-migration-plan.md`'s
two confirmed, data-bearing schema-drift blockers. SCHEMA DRIFT
RECONCILIATION ONLY: no AWS connection, no AWS CLI, no local business data
modified, no database reset, no `prisma db push`/`migrate reset`/
`--accept-data-loss`, no historical migration edited.

## 1. Executive summary

Both assigned blockers are resolved with new, forward-only migrations that
adopt each service's already-existing real local structure rather than
recreating it: `20260916100000_adopt_user_preference` (user-service) and
`20260916110000_adopt_personalized_service_escrow_milestones`
(ai-service). Both use idempotent DDL (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`) so they are simultaneously safe to apply to
the existing local database (no-op — the structures already exist) and to
a fresh database built from repo history alone (creates them). Applied
locally via `prisma migrate deploy`; local data verified byte-identical
before and after (1 `UserPreference` row, 1,060 combined non-null
milestone-column values, same primary keys). Proven end-to-end on
isolated temporary databases: a full `prisma migrate deploy` from zero
reproduces the live schema exactly, and the existing local dumps
(`artifacts/data-migration/{user,ai}-service/*.dump`) restore into that
fresh schema without error. `prisma migrate diff` now reports zero drift
for user-service and exactly the one, pre-existing, Prisma-DSL-
unrepresentable partial-index difference for ai-service (unchanged,
correctly not "fixed").

While proving the Aurora `--disable-triggers` permission concern (task
§16) against fitness-service's own dump (the service the task itself
names as having the relevant circular FK), a **new**, real import-time
hazard was found and fixed in the importer script: fitness's `muscles`
table has the exact same seed-vs-restore collision class as ai-service's
`knowledge_sources`, except worse — its seed uses a **freshly-random**
id per migration run, so a naive fix would have silently produced wrong
`muscles.id` values in AWS. Auditing every remaining service's migration
history for the same problem class then surfaced two **more** instances,
in gym-service and payment-service — genuinely outside this pass's
assigned scope (User+AI only), reported here and in the plan doc, not
fixed.

## 2. User drift — before

Live `gymcoach_user` database (audited directly via `\d`, not inferred):

```
Table "public.UserPreference"
       Column       |              Type              | Nullable |      Default
--------------------+--------------------------------+----------+-------------------
 userId             | text                            | not null |
 showRpeRir         | boolean                         | not null | true
 defaultRestSeconds | integer                         | not null | 90
 keepScreenAwake    | boolean                         | not null | true
 restTimerSound     | boolean                         | not null | true
 restTimerVibration | boolean                         | not null | true
 smartPrefill       | boolean                         | not null | true
 showMacros         | boolean                         | not null | true
 updatedAt          | timestamp(3) without time zone  | not null | CURRENT_TIMESTAMP
Indexes: "UserPreference_pkey" PRIMARY KEY, btree ("userId")
Check constraints: "UserPreference_rest_range" CHECK (defaultRestSeconds
  BETWEEN 15 AND 300 AND defaultRestSeconds % 15 = 0)
```

1 row locally. No `@@map`/`@map` anywhere (table/columns are Postgres's
implicit PascalCase/camelCase identifiers, unlike the rest of this
schema's later snake_case convention) — this is preserved exactly, not
retrofitted. Recorded as applied by `_prisma_migrations` under migration
name `20260905063000_account_preferences`, whose folder does not exist
anywhere in this repository. `schema.prisma` had zero mention of
`UserPreference` before this pass. Code reference audit (grep, case-
insensitive, across `backend/services/user-service/src`,
`backend/services/ai-service/src`, `frontend/web/src`,
`backend/shared/src`): **zero matches** — this table is a pure schema
orphan with no business logic depending on it.

## 3. User drift — fix

`backend/services/user-service/prisma/schema.prisma`: added a
`UserPreference` model declaring the exact live shape above field-for-
field (no renames). The check constraint has no representation in this
Prisma version (5.22, no `checkConstraints` preview feature enabled
anywhere in the file) — documented in the model's own doc comment rather
than silently omitted; it does not appear as a `migrate diff` delta at
all (confirmed empirically — Prisma's diff engine does not currently
model check constraints), so it isn't even a visible drift item, just an
acknowledged schema.prisma fidelity gap. One iteration was needed:
`updatedAt DateTime @updatedAt` initially produced a real (if harmless)
`migrate diff` delta, because `@updatedAt` sets its value client-side on
Prisma Client `.update()` calls and emits no DB-level `DEFAULT` — changed
to `@default(now())`, which matches the live column's actual
`DEFAULT CURRENT_TIMESTAMP` exactly and eliminated the delta.

## 4. User forward migration

`backend/services/user-service/prisma/migrations/20260916100000_adopt_user_preference/migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS "UserPreference" (
    "userId" TEXT NOT NULL,
    "showRpeRir" BOOLEAN NOT NULL DEFAULT true,
    "defaultRestSeconds" INTEGER NOT NULL DEFAULT 90,
    "keepScreenAwake" BOOLEAN NOT NULL DEFAULT true,
    "restTimerSound" BOOLEAN NOT NULL DEFAULT true,
    "restTimerVibration" BOOLEAN NOT NULL DEFAULT true,
    "smartPrefill" BOOLEAN NOT NULL DEFAULT true,
    "showMacros" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPreference_rest_range') THEN
    ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_rest_range"
      CHECK ("defaultRestSeconds" >= 15 AND "defaultRestSeconds" <= 300 AND ("defaultRestSeconds" % 15) = 0);
  END IF;
END $$;
```

`IF NOT EXISTS`/existence-checked `DO` block make this a no-op on the
existing local table (verified: applying it left the row count at 1 and
the constraint unchanged — same `pg_constraint` OID before and after) and
a real create on a fresh target. Does not recreate or reference the
historical `20260905063000_account_preferences` identity, per instruction.

## 5. AI drift — before

Live `gymcoach_ai` database, `personalized_service_orders` table:

```
milestone_intake_released_at    | timestamp(3) without time zone | nullable, no default
milestone_draft_released_at     | timestamp(3) without time zone | nullable, no default
milestone_accepted_released_at  | timestamp(3) without time zone | nullable, no default
milestone_completed_released_at | timestamp(3) without time zone | nullable, no default
```

No index, no constraint references any of them. Non-null counts at audit
time (out of 3,614 total rows): intake 457, draft 409, accepted 146,
completed 48. Recorded as applied under migration name
`20260823120000_personalized_service_escrow_milestones`, folder absent
from the repo. `schema.prisma`'s `PersonalizedServiceOrder` model had zero
mention of any of the four before this pass. Code reference audit (same
scope as §2): **zero matches** for any of the four column names in any
form (camelCase or snake_case) — these columns are read and written by no
code path today. This does **not** contradict the model's own existing
comment ("No escrow/held-funds model exists anywhere in payment-service")
— that statement is about payment-service's real transfer behavior, which
this pass leaves untouched; these four columns are dormant schema-only
remnants of an apparently-paused escrow-milestone feature.

## 6. AI drift — fix

`backend/services/ai-service/prisma/schema.prisma`: added the four fields
to the existing `PersonalizedServiceOrder` model, `@map`'d to their real
snake_case column names (consistent with this file's own convention,
unlike user-service's orphan table). A doc comment explicitly
distinguishes "these columns exist in the schema" from "escrow business
logic is implemented" to avoid contradicting the pre-existing comment
immediately above it. No other field, index, or relation on this model
was touched.

## 7. AI forward migration

`backend/services/ai-service/prisma/migrations/20260916110000_adopt_personalized_service_escrow_milestones/migration.sql`:

```sql
ALTER TABLE "personalized_service_orders"
  ADD COLUMN IF NOT EXISTS "milestone_intake_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_draft_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_accepted_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_completed_released_at" TIMESTAMP(3);
```

No default invented for any column (all stay nullable, matching live
exactly) — a restored row's real value comes from the data-only restore,
never a fabricated default. `IF NOT EXISTS` per column makes this a
no-op locally and a real add on a fresh target. Does not recreate or
reference the historical `20260823120000_personalized_service_escrow_milestones`
identity.

## 8. AI partial index decision

`conversations_used_fallback_idx` (flagged in the original plan doc,
§10): the live index is `CREATE INDEX ... ON conversations (used_fallback)
WHERE used_fallback = true` — a genuine, deliberate, hand-written partial
index, traced to its origin migration
(`20260414000001_conversation_observability`, still present in the repo,
still correctly applied). `schema.prisma`'s `@@index([usedFallback])`
can only ever describe a plain (non-partial) index — Prisma 5.22 has no
`WHERE` clause support for `@@index` in the stable schema DSL (confirmed:
no `previewFeatures` block exists in this schema at all, and no such
preview feature has shipped). **Decision: keep the partial index exactly
as-is. No new migration.** Trading it for a plain index merely to make
`prisma migrate diff` report clean would make every future
`used_fallback = true` query scan a larger index for no functional gain —
explicitly the outcome the task said not to accept. The one-line
`DROP INDEX "conversations_used_fallback_idx"` that `migrate diff`
prints is the sole remaining, permanent, and now explicitly documented
exception to "zero schema drift" for ai-service.

(A second historical artifact, `20260716043947_add_chat_sessions`, is
recorded in `_prisma_migrations` as failed-and-rolled-back — it tried to
recreate this exact index via the declarative path and hit "relation
already exists" against the real hand-written one. It made zero committed
change; not touched by this pass.)

## 9. Local data preservation

Verified before AND after applying both new migrations (exact counts,
not estimates):

| Check | Before | After |
|---|---|---|
| `UserPreference` row count | 1 | 1 |
| `UserPreference` PK value / check constraint OID | unchanged | unchanged (same `pg_constraint` row) |
| `personalized_service_orders` total rows | 3,614 | 3,614 |
| `milestone_intake_released_at` non-null | 457 | 457 |
| `milestone_draft_released_at` non-null | 409 | 409 |
| `milestone_accepted_released_at` non-null | 146 | 146 |
| `milestone_completed_released_at` non-null | 48 | 48 |

No row was inserted, updated, or deleted by either migration on the local
databases — confirmed by the counts matching exactly, not merely by
reading the (idempotent) SQL.

## 10. Fresh database migration test

Two throwaway databases (`gymcoach_user_schemacheck_tmp`,
`gymcoach_ai_schemacheck_tmp` — never `gymcoach_user`/`gymcoach_ai`
themselves), created and dropped by this pass only, on the same local
Postgres instance:

```
DATABASE_URL=...gymcoach_user_schemacheck_tmp npx prisma migrate deploy
  -> 43 migrations applied, "All migrations have been successfully applied."
DATABASE_URL=...gymcoach_ai_schemacheck_tmp npx prisma migrate deploy
  -> 25 migrations applied, "All migrations have been successfully applied."
```

Never used `db push`. Post-migration structure verified identical to live
local (`\d "UserPreference"`, `\d personalized_service_orders` grep for
milestone columns) — exact match, including the check constraint and
column types. This proves AWS Aurora's currently-empty-but-migrated
target can reach the same schema using repository history alone, once it
runs these two new migrations.

## 11. Data-only restore test

Restored the existing dumps into the fresh schemas from §10 (never
connecting to AWS; `pg_restore` run against the local Postgres container):

- **user-service**: `pg_restore --data-only ... gymcoach_user.data.dump`
  into `gymcoach_user_schemacheck_tmp` — **clean, no errors**.
  `UserPreference` count 1, `user_profiles` count 562, both matching
  local exactly.
- **ai-service**: same restore attempt **failed** on the first try —
  `duplicate key value violates unique constraint "knowledge_sources_pkey"`
  — an issue orthogonal to this pass's schema fix (see §17). Root cause:
  `20260605000000_knowledge_pipeline` seeds 6 `knowledge_sources` rows by
  fixed `id`, guarded only by `ON CONFLICT ("base_url") DO NOTHING` (does
  not protect the primary key). Resolved via a general mechanism added to
  `scripts/data-migration-import-aws.mjs` (`MIGRATION_SEEDED_TABLES`):
  exclude the seeded table from the main restore, then reconcile it
  separately with a data-driven `INSERT ... ON CONFLICT (...) DO UPDATE`.
  Re-run **clean**: `conversations` 30,644, `personalized_service_orders`
  3,614 with all four milestone non-null counts matching (457/409/146/48),
  `knowledge_sources` 7 (6 migration-seeded + the 1 genuinely-local-only
  `source-sciencedaily-fitness` row, both correctly present with their
  real local `id`s).

**Neither failure was caused by anything in the assigned schema fix** —
`UserPreference` and the four milestone columns restored without a single
issue in every attempt; the only failure was the pre-existing,
independently-discovered `knowledge_sources` seed collision.

USER DUMP RESTORE TEST: **PASS**. AI DUMP RESTORE TEST: **PASS** (after
the orthogonal `knowledge_sources` fix above — the schema itself was never
the problem).

## 12. Prisma diff after

```
$ npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url <local user db> --script
-- This is an empty migration.

$ npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url <local ai db> --script
-- DropIndex
DROP INDEX "conversations_used_fallback_idx";
```

USER SERVICE: LOCAL SCHEMA == FRESH MIGRATED SCHEMA? **YES — zero drift.**
AI SERVICE: LOCAL SCHEMA == FRESH MIGRATED SCHEMA? **YES, except the one
pre-existing, intentionally-kept partial index (§8) — no other drift.**
`prisma migrate status` for both: `Database schema is up to date!`
(re-confirmed after every change in this pass). Neither historical
migration folder was modified; neither failed migration was marked
applied.

## 13. Dump/manifest validity

No local business data changed (§9), so the existing dumps remain valid
by construction — re-verified rather than assumed, by re-hashing all 7
dump files against `artifacts/data-migration/manifest.json`:

```
auth-service      MATCH  50f9c9422f26...
user-service      MATCH  73f373a0b795...
fitness-service   MATCH  f4889252bd92...
gym-service       MATCH  c5c4bf2bbf9c...
payment-service   MATCH  8a41b398c7da...
ai-service        MATCH  e3430d80807d...
chat-service      MATCH  47391031ff90...
```

All 7 SHA-256 values match the manifest exactly. **No dump was
regenerated** — none needed to be.

## 14. Chat AWS preparation

Audited `backend/services/chat-service/` directly (not assumed):

- **Migration Lambda: EXISTS.** `src/migrate-lambda.ts` (uses
  `@aws-sdk/client-secrets-manager`'s `SecretsManagerClient`/
  `GetSecretValueCommand`, the same convention every other service's
  migrate-lambda uses), packaged via `scripts/build-migrate-lambda-artifact.js`
  into `artifacts/chat-migrate-lambda.zip` (72,660,196 bytes, already
  built as of 2026-09-08). **This part of Chat's AWS data-migration
  readiness already exists.**
- **Runtime deployment: NOT started, and Lambda-shaped for the wrong
  reason if attempted.** Chat-service is built on `socket.io` (real-time,
  long-lived WebSocket connections) — fundamentally incompatible with
  Lambda's stateless request/response model, unlike ai-service's HTTP-only
  `lambda.ts`. There is no `lambda.ts`/`worker-lambda.ts` equivalent for
  Chat's own runtime, and `infra/compose/docker-compose.prod.yml` says so
  explicitly in its own comments: "chat-service is intentionally NOT
  included" in the production compose service list.
- **What Chat's real AWS runtime will eventually need** (not built, not
  started this pass): a long-lived compute target — ECS/Fargate service
  (consistent with this plan's own no-EC2 preference) running the
  existing `Dockerfile` image, NOT a Lambda; its own Aurora logical
  database `fitness_assistant_chat` (does not exist yet); Secrets Manager
  entries for its `DATABASE_URL` (convention already established by every
  other service); and a load balancer or API Gateway WebSocket
  integration in front of it.
- **Do not conflate the two**, per instruction: Chat's DATA is
  migration-ready (§13 — its dump is valid, its schema has zero drift,
  confirmed in the original plan doc) and its migration-Lambda artifact
  already exists; Chat's own application RUNTIME on AWS is a distinct,
  larger, not-yet-started piece of infrastructure work.

## 15. Aurora pg_restore permission review

Audited before any AWS action, per instruction. The original plan's draft
restore command used `pg_restore --disable-triggers`. PostgreSQL's own
documentation is explicit: `--disable-triggers` emits
`ALTER TABLE ... DISABLE/ENABLE TRIGGER ALL`, and disabling an
internally-generated trigger (exactly what a foreign key's own RI
enforcement trigger is — directly relevant here because of
fitness-service's own circular FK on `muscles`) **requires true PostgreSQL
superuser**, not merely table ownership. AWS Aurora **never** grants a
customer role true superuser — `rds_superuser` membership is a bounded,
AWS-defined privilege set, explicitly not equivalent to `rolsuper = true`.

This was confirmed as a real local-testing blind spot, not a hypothetical:
`SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'gymcoach'` on
this repo's own local dev Postgres returns `rolsuper = t` — a real
superuser — which is exactly why a local test of `--disable-triggers`
would look completely safe and only fail once actually run against
Aurora.

**Non-destructive alternative adopted, and proven working**: extract the
restore as a plain SQL script and wrap it with
`SET session_replication_role = 'replica';` / `RESET session_replication_role;`
for that one session. This suppresses all trigger firing (including RI
triggers) without ever altering any table's trigger definition, and
setting `session_replication_role` only requires `rds_superuser`
membership — which Aurora's customer master role does have. Proven
end-to-end against fitness-service's real dump (the service with the
documented circular FK): all 1,510,772+ rows across every table —
including `exercise_muscles`'s FK into `muscles` — loaded without a single
error, using zero elevated privilege beyond what Aurora actually grants.
`scripts/data-migration-import-aws.mjs` was rewritten to use this
mechanism instead of `--disable-triggers`.

## 16. Files changed

New:
- `backend/services/user-service/prisma/migrations/20260916100000_adopt_user_preference/migration.sql`
- `backend/services/ai-service/prisma/migrations/20260916110000_adopt_personalized_service_escrow_milestones/migration.sql`
- This report; `docs/aws-full-local-data-migration-plan.md` updated
  (§26-28: Blocker 1 marked resolved, new §26.5-7 findings added, final
  verdict section revised).

Modified:
- `backend/services/user-service/prisma/schema.prisma` (`UserPreference`
  model added).
- `backend/services/ai-service/prisma/schema.prisma` (four milestone
  fields added to `PersonalizedServiceOrder`).
- `scripts/data-migration-import-aws.mjs` (rewritten: `MIGRATION_SEEDED_TABLES`
  generalized to `{table, conflictColumn}` pairs covering both
  `knowledge_sources` and fitness's `muscles`; upsert changed from
  `DO NOTHING` to `DO UPDATE SET <every other column> = EXCLUDED.<column>`,
  data-driven from the dump's own `COPY` column list — required because
  `muscles`' seed uses a random `id`, so `DO NOTHING` would have silently
  kept the wrong `id` values; `--disable-triggers` replaced by
  `SET session_replication_role = 'replica'` per §15).

Not modified, per instruction: any historical migration folder, any
`_prisma_migrations` row, any other service's `schema.prisma`, any
business logic (payment release logic, milestone settlement behavior,
personalized-service state machine, wallet logic, PT contracts, fitness
roadmap, AI workflow, auth, frontend).

Local Postgres note: `gymcoach-postgres` was found stopped (Docker
Desktop appears to have restarted independently mid-session) and was
restarted via `docker start` — an existing-container restart, not a
recreate; all volumes and data were confirmed intact before and after
(exact `gymcoach_user`/`gymcoach_ai` row counts unchanged).

## 17. Blockers remaining

**Both originally assigned blockers (user-service, ai-service) are fully
resolved** — schema declared, forward migration written and applied,
fresh-DB reproduction proven, data-only restore proven, zero drift proven,
local data proven unchanged.

Two **new**, genuinely out-of-scope blockers were found while completing
the Aurora permission review (§15) and its natural follow-up (checking
whether any other service has the same seed-collision class found in
`muscles`):

1. **gym-service**: `platform_commission_rates` gets one unconditional,
   unguarded seed row (`rate = 0.05`) from
   `20260908030000_phase3_4_5_partner_lifecycle` on every fresh migration.
   No stable business key exists to upsert on, so a plain data-only
   restore wouldn't fail — it would silently leave a duplicate row. This
   pass's own importer preflight (abort if target has any existing
   rows) would catch it before duplication happens, but the real fix
   (most likely: delete the migration's placeholder row by structural
   identity before restoring) needs a dedicated pass.
2. **payment-service**: `wallets` gets one unconditional seed row
   (`owner_type='PLATFORM', owner_id='ESCROW'`, balance computed from
   other wallets — `0` on an empty fresh target) from
   `20260811000001_two_bucket_wallet_and_escrow`, protected by the real
   `wallets_owner_type_owner_id_key` unique constraint — a plain restore
   of the local ESCROW row would fail outright. The
   `MIGRATION_SEEDED_TABLES` mechanism built this pass could be extended
   to cover it, but needs a composite-column conflict target
   (`(owner_type, owner_id)`), which the current implementation doesn't
   yet support — a small, real extension, not done this pass since it's
   outside the assigned scope.

Neither of these two is a schema drift (both services show zero
`migrate diff` output) — both are import-time seed-vs-restore hazards,
the same class of problem as `muscles`/`knowledge_sources` but in
services this pass was not asked to touch.

## 18. Exact next AWS step

For the assigned scope specifically: once AWS Aurora's
`fitness_assistant_user` and `fitness_assistant_ai` schemas are confirmed
migrated to include
`20260916100000_adopt_user_preference`/`20260916110000_adopt_personalized_service_escrow_milestones`
(via `prisma migrate deploy` run against them — not done this pass, no
AWS connection made), those two services' existing dumps
(`artifacts/data-migration/{user,ai}-service/*.dump`) can be restored
using `scripts/data-migration-import-aws.mjs` exactly as-is (the
ai-service path already includes its `knowledge_sources` reconciliation).
Before treating the FULL 7-service migration as ready, run a follow-up
reconciliation pass scoped to gym-service and payment-service (§17) —
mirroring this one.

## 19. Final verdict

**NOT READY — DATA MIGRATION BLOCKERS REMAIN**

(user-service and ai-service — this pass's actual assignment — are
individually fully resolved and ready; the blocking items are the newly
discovered, explicitly out-of-scope gym-service and payment-service
seed-collision risks in §17, which stand between here and a full-
confidence "all 7 services" verdict.)
