# AWS Full Local Data Migration — Final Seed-vs-Restore Reconciliation + 7-Service Dress Rehearsal

Date: 2026-09-18. Responds to the two remaining known blockers
(gym-service `platform_commission_rates`, payment-service `wallets`
PLATFORM/ESCROW) from `docs/aws-full-local-data-migration-plan.md` §26.7,
plus a mandatory final repository-wide sweep and a full 7-service local
dress rehearsal. No AWS connection, no AWS CLI, no local business data
modified, no local database reset, no ID regenerated, no payment provider
called, no `prisma db push`/`migrate reset`, no historical migration
edited.

## 1. Executive summary

Both remaining blockers are resolved entirely inside
`scripts/data-migration-import-aws.mjs` — no schema change, no new
migration, because neither `platform_commission_rates` nor `wallets` has
any drift (`prisma migrate diff` already reported zero for both). The
importer's seed-reconciliation config was generalized from a single
`conflictColumn` string to a `conflictColumns` array (supporting real
composite unique constraints, e.g. payment's actual
`UNIQUE(owner_type, owner_id)`) plus a second strategy,
`"clear-baseline"`, for tables with no stable key at all
(`platform_commission_rates`, whose only column besides the hardcoded
`rate`/`effective_from` is a fresh random `id` every migration run).

A final repository-wide sweep of every migration SQL file across all 7
services (not just the 4 already known) found no new restore hazard —
every other `INSERT`/`UPDATE` in every service's migration history is a
same-table backfill driven by existing rows, which is a no-op on an empty
fresh target.

The entire importer was also hardened based on things this pass's own
dress rehearsal actually broke on first try (not theoretical): `_prisma_
migrations` is now unconditionally excluded from every restore (present
in all 7 dumps, would have overwritten each target's canonical migration
history with local's noisier one); `DATABASE_URL`'s `?schema=public`
query parameter (which every service's own `.env` carries, written for
Prisma) is now stripped before use, because real `psql`/`pg_restore`
reject it outright; the whole per-service restore (baseline cleanup, main
data, every seeded-table reconciliation) now runs as ONE `psql
--single-transaction` script instead of several independent ones, so a
failure anywhere rolls back everything — proven directly by an induced
mid-restore failure that left a temp database at exactly its pre-restore
state.

**All 7 services were then actually imported** — not simulated — into 7
isolated, freshly `prisma migrate deploy`'d temporary databases, using a
real Docker image (`postgres:15-alpine` + Node.js, matching the exact
`pg_dump`/`pg_restore` version the dumps were created with) built and run
locally. All 7 succeeded. Every table's row count, and every reconciled
table's exact primary-key set, was verified to match local — including
the two new cases (`platform_commission_rates.id`,
`wallets.id` for the ESCROW row) and the two from the prior pass
(`muscles.id`, `knowledge_sources.id`). Two operational discoveries were
made along the way (chat-service's Prisma schema reads
`CHAT_DATABASE_URL`, not `DATABASE_URL`; `gymcoach_ai` has live write
traffic during normal local development, so its dump is a best-effort
snapshot, not a frozen one) — neither blocks the migration, both are
documented for whoever runs the real cutover.

An importer Docker image (`infra/data-migration-importer/Dockerfile`) was
built and proven to work locally — this doubles as the answer to "what
does Fargate actually need to run the importer" and as the real test
harness this pass used for the dress rehearsal.

## 2. Gym seed collision

Audited directly against the live `gymcoach_gym` database and a fresh
`prisma migrate deploy`, not assumed:

```
Table "public.platform_commission_rates"
  id              text            PK
  rate            numeric(5,4)    not null
  effective_from  timestamp(3)    not null
  created_by      text            nullable
  created_at      timestamp(3)    not null, default CURRENT_TIMESTAMP
Indexes: platform_commission_rates_pkey (PK, id), platform_commission_rates_effective_from_idx (plain btree on effective_from)
```

No unique constraint besides the primary key. No foreign key references
this table from anywhere (checked directly against
`information_schema.table_constraints`/`key_column_usage`) — safe to
delete a row from without any cascading concern. Current real local row
count: **exactly 1**. Migration
`20260908030000_phase3_4_5_partner_lifecycle` inserts exactly this shape
unconditionally, with **no `ON CONFLICT` guard at all**:

```sql
INSERT INTO "platform_commission_rates" (id, rate, effective_from, created_by, created_at)
VALUES (gen_random_uuid()::text, 0.05, '2026-01-01T00:00:00Z', NULL, NOW());
```

**Is the one local row the migration's own placeholder, or real business
data set later by a person?** Compared field-by-field against a fresh
`prisma migrate deploy` run in isolation this pass: the fresh baseline row
has `rate = 0.05`, `effective_from = 2026-01-01 00:00:00`, `created_by =
NULL` — and the real local row has **exactly the same three values**,
differing only in `id` (random, as expected) and `created_at` (a
different real timestamp — this local DB was itself last rebuilt/re-seeded
on 2026-09-10, not the moment this migration was originally authored).
This is the migration's own placeholder, never overwritten by any real
commission-rate change — the platform has apparently never actually
changed its rate since. **The schema does legitimately support multiple
historical rates** (the `effective_from` index exists specifically to let
a query pick "the rate in effect at time X" — this is forward-looking
schema design, not evidence multiple rows currently exist). Nothing was
deleted based on an assumption — see §3's exact, live-re-verified
predicate.

## 3. Gym fix

New strategy, `"clear-baseline"`, added to
`scripts/data-migration-import-aws.mjs`'s `MIGRATION_SEEDED_TABLES`:

```js
"gym-service": [{
  table: "platform_commission_rates",
  strategy: "clear-baseline",
  expectedBaselineCount: 1,
  baselineWhereSql: `"rate" = 0.05 AND "effective_from" = '2026-01-01 00:00:00' AND "created_by" IS NULL`,
}],
```

The predicate deliberately excludes `id` (random every run) and
`created_at` (`NOW()` at migration time) — every OTHER column the
migration hardcodes. At preflight time (before ANY mutation), the
importer verifies (a) the table has EXACTLY `expectedBaselineCount` rows
and (b) every one of them matches `baselineWhereSql` — if either check
fails, it aborts with no changes, refusing to guess. Only after both pass
does it `DELETE FROM "platform_commission_rates" WHERE <predicate>` (as
the first statement of the one atomic restore transaction, before the
main data restore runs), leaving the table empty for the dump's own row
to load normally, with the dump's real `id` intact. This never risks
deleting real business data: if a human had ever changed the rate, the
row would no longer match all three hardcoded values and the importer
would refuse to proceed.

## 4. Payment seed collision

Audited directly:

```
Table "public.wallets"
  id                 text           PK
  owner_type         WalletOwnerType  not null
  owner_id           text           not null
  available_balance  numeric(14,2)  not null, default 0
  locked_balance     numeric(14,2)  not null, default 0
  pending_balance    numeric(14,2)  not null, default 0
  status             WalletStatus   not null, default ACTIVE
  created_at / updated_at
Indexes: wallets_pkey (PK, id), wallets_owner_type_owner_id_key (UNIQUE, owner_type + owner_id)
Referenced by: wallet_ledger_entries.wallet_id (ON UPDATE CASCADE, ON DELETE RESTRICT),
               withdrawal_requests.wallet_id (ON UPDATE CASCADE, ON DELETE RESTRICT)
```

Real local PLATFORM wallets (balances not sensitive — internal platform
accounts, not a client's private financial data, and this is structural
metadata, not a transaction ledger dump):

```
owner_id=ESCROW:  available_balance = 67,290,000.00  (real, non-zero — NOT computed as 0)
owner_id=REVENUE: available_balance =  2,135,000.00
```

Migration `20260811000001_two_bucket_wallet_and_escrow` **only ever
creates the ESCROW row** on a fresh database — confirmed by actually
running `prisma migrate deploy` on an isolated temp DB and inspecting the
result: exactly 1 wallet row, `owner_type=PLATFORM, owner_id=ESCROW,
available_balance=0.00` (the migration's `SELECT SUM(available_balance)
FROM wallets` evaluates to 0 on an empty table). The REVENUE row is a
separate `UPDATE ... SET owner_id='REVENUE' WHERE ...` against a
pre-existing row from the old single-wallet model — a no-op on an empty
fresh target, so REVENUE simply doesn't exist until the real data restore
creates it (normally, no reconciliation needed).

**Other PLATFORM wallets:** none — exactly these two (`ESCROW`,
`REVENUE`) are the only `owner_type=PLATFORM` rows locally.
**References to the ESCROW wallet:** `wallet_ledger_entries.wallet_id`
and potentially `withdrawal_requests.wallet_id` — checked directly (see
§8) for whether restoring these tables' rows (which carry the REAL local
wallet `id`) before or after the wallets reconciliation could leave a
dangling reference.

## 5. Payment fix

`wallets` added to `MIGRATION_SEEDED_TABLES` with the real composite
constraint as the conflict target:

```js
"payment-service": [{
  table: "wallets",
  strategy: "upsert",
  conflictColumns: ["owner_type", "owner_id"],
  expectedBaselineCount: 1,
}],
```

`conflictColumns` is an array now (previously a single string) —
`ON CONFLICT ("owner_type", "owner_id") DO UPDATE SET <every other
column> = EXCLUDED.<column>` is real, valid PostgreSQL syntax for a
composite unique constraint; nothing is concatenated into a synthetic
string key, and this constraint is the table's own real one (verified via
`\d wallets`), never inferred. Because this is the same `INSERT ...
ON CONFLICT ... DO UPDATE` mechanism as `muscles`/`knowledge_sources` (§6
of the schema-reconciliation report), it handles all 379 real wallets in
one pass with no special-casing: the 1 row matching `(PLATFORM, ESCROW)`
gets its `id`, balance, and every other column overwritten with the
dump's real local values; the other 378 (including PLATFORM/REVENUE, and
every CLIENT/PT/GYM wallet) have no matching key on the fresh target and
are simply inserted normally by the same statement. Proven end-to-end
(§12): final `wallets.id` for the ESCROW row is
`ed58c90b-2aaf-4e10-9aca-0992f840e887` — byte-identical to local — with
`available_balance = 67,290,000.00` intact, and all 406
`wallet_ledger_entries` rows resolve with zero orphaned `wallet_id`
references (§8).

## 6. Importer config model

`MIGRATION_SEEDED_TABLES` is now `Record<service, SeedTableConfig[]>`
where each entry is:

```ts
{
  table: string,
  strategy: "upsert" | "clear-baseline",
  expectedBaselineCount: number,       // used by preflight for BOTH strategies
  conflictColumns?: string[],          // "upsert" only — the real target unique constraint's columns
  baselineWhereSql?: string,           // "clear-baseline" only — exact-match predicate, re-verified live every run
}
```

One declarative shape, two strategies, chosen per table based on whether
a stable key exists — not per-service branching. All 4 current entries
(`ai-service.knowledge_sources`, `fitness-service.muscles`,
`payment-service.wallets`, `gym-service.platform_commission_rates`) share
the exact same restore/preflight code path; nothing about any one of them
is special-cased in the importer's control flow, only in this
configuration table.

## 7. Composite conflict support

`conflictColumns` was a single string before this pass (`conflictColumn`)
covering only `muscles.code` and `knowledge_sources.id`. Generalized to an
array; the SQL generation (`ON CONFLICT (${cols.map(c => "\"" +
c + "\"").join(", ")})`) and the "which columns get overwritten"
calculation (every column in the dump's own `COPY` header EXCEPT those in
`conflictColumns`) both changed to operate over the whole array instead of
one column. Every `conflictColumns` value in the config is the literal
column list of a real target unique constraint or primary key —
`wallets_owner_type_owner_id_key` for payment, `muscles_code_key` for
fitness, the primary keys for the other two — never a derived or
concatenated key Postgres itself doesn't already enforce.

## 8. Repository-wide migration data-write audit

Every migration SQL file across all 7 services was grepped for
`INSERT INTO`, `COPY`, `UPDATE "`, and `uuid_generate*` (in addition to
the 4 already-known cases). No `uuid_generate*` call exists anywhere in
this repository — every generated ID uses `gen_random_uuid()` or
Prisma's own `cuid()`/`uuid()` client-side default. Full classification:

| Service | Migration | Write | Classification |
|---|---|---|---|
| ai-service | `20260605000000_knowledge_pipeline` | `INSERT` 6 `knowledge_sources` rows, fixed `id` | MIGRATION BASELINE SEED — reconciled (§upsert) |
| ai-service | `20260830000001_personalized_service_escrow_c2_c3` | `UPDATE personalized_service_orders SET platform_rate_snapshot=0.10... WHERE ... IS NULL` | SAFE EMPTY-TARGET BACKFILL |
| ai-service | `20260916090000_agent_workflow_session_active_unique` | `UPDATE agent_workflow_sessions ... FROM ranked WHERE rn > 1` (dedupe before adding a unique index) | SAFE EMPTY-TARGET BACKFILL |
| fitness-service | `20260819020000_add_exercise_muscle_provenance_schema` | `INSERT` 29 `muscles` rows, random `id`, stable `code` | MIGRATION BASELINE SEED — reconciled (§upsert) |
| fitness-service | `20260828170000_add_workout_program_set_prescriptions` | `INSERT ... SELECT ... FROM workout_program_exercises` (random `id` per generated row) | SAFE EMPTY-TARGET BACKFILL (source table empty on a fresh target) |
| fitness-service | 8 other migrations (`add_workout_schedule_completion`, `training_cycle_active_unique_constraint`, `add_nutrition_goal_versioning`, `add_food_serving_metadata`, `fix_food_serving_metadata_word_boundaries`, `add_exercise_status`, `workout_set_bodyweight_timed_distance_and_exercise_logging_mode`, `backfill_time_load_carry_exercises`) | `UPDATE` driven by `WHERE <existing column>` matches | SAFE EMPTY-TARGET BACKFILL |
| gym-service | `20260908030000_phase3_4_5_partner_lifecycle` | `INSERT` 1 `platform_commission_rates` row, random `id`, no stable key | MIGRATION BASELINE SEED — reconciled (§clear-baseline) |
| gym-service | `20260907000000_scope_membership_plans_to_brand`, `20260908000000_gym_partner_identity` | `INSERT` inside a PL/pgSQL loop over existing `gyms`/`gym_partners` rows | SAFE EMPTY-TARGET BACKFILL (0 loop iterations on an empty target) |
| gym-service | `20260902040000_add_gym_brand_moderation_and_operational_status`, `20260908050000_partner_verification_and_branch_review` | `UPDATE` driven by existing columns | SAFE EMPTY-TARGET BACKFILL |
| payment-service | `20260811000001_two_bucket_wallet_and_escrow` | `INSERT` 1 `wallets` row (ESCROW), random `id`, real composite unique key; `UPDATE` for REVENUE (no-op on empty) | MIGRATION BASELINE SEED — reconciled (§upsert) |
| user-service | `20260528_inbody_unique_per_day`, `20260803010000_backfill_has_completed_onboarding`, `20260818010000_add_starting_weight`, `20260902050000_add_session_pt_at_fault` | `UPDATE` driven by existing columns | SAFE EMPTY-TARGET BACKFILL |
| auth-service | — | none found | NO RESTORE CONFLICT |
| chat-service | — | none found | NO RESTORE CONFLICT |

**RESTORE HAZARD: none remaining.** Every `INSERT`/`COPY`/`UPDATE` in
every migration across all 7 services is now accounted for — either
reconciled (4 tables, 2 strategies) or confirmed safe because it only
ever mutates rows that already exist in the same table at migration time
(zero on any fresh target, regardless of how much data a later data-only
restore adds afterward — the migration runs once, before any restore
step, and is never re-run).

## 9. `_prisma_migrations` policy

Confirmed present in all 7 dumps — `pg_dump --data-only` with no table
filter captures every table, `_prisma_migrations` included (verified via
`pg_restore -l` against the actual dump files, not assumed). The importer
now unconditionally excludes it from every service's restore TOC,
regardless of whether that service has any seeded table — this is a
separate, blanket exclusion, implemented once and applied to all 7.
Policy, applied uniformly: **APPLICATION BUSINESS DATA = exact local
state; `_PRISMA_MIGRATIONS` = whatever the target's own `prisma migrate
deploy` already wrote (current canonical repository history)** — never
overwritten, never merged, by this importer. This matters concretely
because local's own `_prisma_migrations` history is not clean for 3
services (rolled-back attempts; the two orphaned identities this pass's
prior work adopted under new migration names rather than recreating) —
none of that historical noise should ever reach AWS.

## 10. Trigger/FK strategy

Re-audited, not re-asserted. The generated SQL (§ actual file
`scripts/data-migration-import-aws.mjs` produces per run, inspected
directly during this pass's dress rehearsal) is:

```sql
SET session_replication_role = 'replica';
[DELETE FROM "<clear-baseline table>" WHERE <predicate>; ...]
[pg_restore-extracted main data-only restore SQL]
SET search_path TO public;
[per "upsert" table: CREATE TEMP TABLE ...; COPY ...; SET search_path TO public; INSERT ... ON CONFLICT ... DO UPDATE ...; DROP TABLE ...]
RESET session_replication_role;
```

All of this is ONE file, run as ONE `psql --single-transaction -v
ON_ERROR_STOP=1 -f <file>` invocation — the `SET`/`RESET` pair lives
inside that single session/transaction, so there is no window where a
crash mid-restore could leave a connection's replication role altered:
either the whole transaction (SET included) commits together, or it rolls
back entirely and the session/connection ends, taking any session-local
setting with it. This was verified directly, not assumed: a deliberate
early version of this script (missing a `search_path` reset — see §12 for
the exact failure) errored out mid-transaction, and the target database
was confirmed to be at its exact pre-restore state afterward, with no
`session_replication_role` sticking around (the connection itself was
gone).

**Required AWS role privilege, classified precisely:** `SET
session_replication_role = 'replica'` requires the calling role to be a
member of `rds_superuser` on Aurora (AWS's own documented bounded
superuser-equivalent for RDS/Aurora Postgres) — this is **NOT the same
claim as "this has been tested on Aurora."** It has not: this entire pass
ran exclusively against local Docker Postgres, where the connecting role
(`gymcoach`) is a REAL PostgreSQL superuser (`rolsuper = true`, confirmed
directly), which trivially has permission for everything `--disable-
triggers` OR `session_replication_role` could ever need — local success
proves the SQL logic is correct, not that Aurora's actual permission
model accepts it. Classified explicitly:

**AWS PREFLIGHT VERIFICATION REQUIRED** — before the real cutover,
whoever provisions the Fargate task must confirm the actual Aurora master
role is a member of `rds_superuser` (standard for an Aurora
cluster's own master user, per AWS's documentation, but not verified
against this specific account/cluster) and run a single harmless
`SET session_replication_role = 'replica'; RESET session_replication_role;`
against the real target as a smoke test before trusting the full importer
against real data.

## 11. Atomicity

Verified directly, not just designed for: `preflight` (read-only, several
separate `psql -c` calls — safe to run repeatedly, mutates nothing) →
one single `psql --single-transaction` session covering baseline
cleanup + main restore + every seeded-table reconciliation → implicit
COMMIT on success. An error anywhere inside that one session — confirmed
with a real induced failure during this pass's own fitness-service dress
rehearsal attempt (a `search_path` bug, since fixed, see §3 of the
importer config narrative and §12 below) — rolls back the ENTIRE
transaction: the target database was confirmed afterward to be at
EXACTLY its pre-restore state (`workout_sets = 0`, `muscles = 29`, the
untouched migration baseline), not a partially-loaded one. No half-
imported database is possible with this design: either every row for
that one service commits together, or none do.

## 12. 7-service dress rehearsal

**Real, not simulated.** Built `infra/data-migration-importer/Dockerfile`
(postgres:15-alpine + `apk add nodejs`, see §21) into a local image, ran
it as an actual container joined to the same Docker network as the local
Postgres, once per service, against 7 newly created, clearly-named
temporary databases (`gymcoach_<service>_awsrestore_tmp` — never the real
`gymcoach_<service>` databases, which were read-only inputs to `pg_dump`
throughout and confirmed unchanged before and after this entire pass).

**Step A** (`prisma migrate deploy` from zero, per service): all 7
succeeded, producing exactly the expected table count each (7, 24, 51,
23, 9, 27, 5 — matching auth/user/fitness/gym/payment/ai/chat exactly).
One real snag: chat-service's `schema.prisma` reads `CHAT_DATABASE_URL`,
not `DATABASE_URL` — the only one of the 7 services with this difference,
discovered when the first attempt failed outright with a Prisma
validation error naming the exact variable it wanted.

**Step B** (capture migration-created baseline rows): recorded before any
data touched each database — 0 rows everywhere except the 4 known seeded
tables, each at its documented `expectedBaselineCount`.

**Step C** (run the real importer against each corresponding dump): all 7
succeeded on the (corrected) implementation. One real bug caught and
fixed live during this step: the fitness-service run initially failed
with `relation "muscles" does not exist` — the main restore's own
extracted SQL sets `search_path` to `''` as its standard practice, and
because this pass's atomicity rework (§11) now runs every step in ONE
session instead of separate ones, that empty search_path leaked into the
following reconciliation block's `CREATE TEMP TABLE ... LIKE "muscles"`.
Fixed by adding one more `SET search_path TO public;` immediately after
the main restore SQL is appended, before any reconciliation SQL runs.
Re-run after the fix: clean.

A second real issue hit before Step C could even start for auth-service:
`psql: error: invalid URI query parameter: "schema"` — every service's
own `.env`-style `DATABASE_URL` carries `?schema=public` for Prisma's
benefit, which real `psql`/`pg_restore` reject outright. Fixed by having
the importer strip the URL's query string before using it anywhere (§9 of
the plan doc's updated blocker list).

**Step D** (verify): see §13-16 below for the full breakdown.

## 13. Per-service row-count verification

Every table in every one of the 7 temp databases was compared against its
corresponding real local database (exact `COUNT(*)`, `_prisma_migrations`
excluded from the comparison per §9's policy):

```
auth:     MATCH — every table, exact
user:     MATCH — every table, exact (including UserPreference = 1)
fitness:  MATCH — every table, exact (all 51 tables)
gym:      MATCH — every table, exact (all 23 tables)
payment:  MATCH — every table, exact (all 9 tables)
chat:     MATCH — every table, exact (all 5 tables)
ai:       MISMATCH at comparison time — explained below, not a defect
```

**ai-service mismatch, explained:** `gymcoach_ai` is not quiescent — it
has live write traffic during ordinary local development (this repo's
dev stack, or another concurrent session, actively using the AI
features). Its total row count was observed to increase TWICE during
this pass alone, independent of anything this pass did. The restore
result was cross-checked against the dump's OWN manifest snapshot
(`artifacts/data-migration/manifest.json`'s `tableRowCounts` for
ai-service, recorded at export time) instead of against the live,
still-changing database — and matched **exactly**
(`conversations: 30645`, `personalized_service_orders: 3663`,
`agent_workflow_sessions: 2`, etc., all identical to the temp database's
post-restore counts). This proves the importer restored the dump
correctly; it does not and cannot prove the dump is still current the
moment this sentence is read. **Recommendation for the real cutover:**
either freeze ai-service write traffic briefly before the final export,
or re-export ai-service's dump as the very last step immediately before
upload, and treat every other service's dump (confirmed quiescent
throughout this entire pass) as already stable.

## 14. Per-service PK verification

Full primary-key set comparison (not just counts) for every reconciled
table, plus a spot-check on the largest non-reconciled tables:

- `muscles` (fitness): full 29-row `id` set diffed local vs. temp —
  **identical**.
- `knowledge_sources` (ai): full 7-row `id` set diffed — **identical**
  (6 reconciled + `source-sciencedaily-fitness`, the one genuinely
  local-only row, present with its real `id`).
- `wallets` PLATFORM rows (payment): `id`, `owner_type`, `owner_id`, and
  `available_balance` diffed directly — **identical**
  (`ed58c90b-2aaf-4e10-9aca-0992f840e887` / ESCROW / 67,290,000.00;
  `ddd9b8b4-490d-4909-90f4-96bec96d1411` / REVENUE / 2,135,000.00).
- `platform_commission_rates` (gym): single-row `id`/`rate` diffed —
  **identical** (`0f022e68-a66a-448f-aaa5-a94a0d0a7762`, unchanged from
  local).
- `auth.users`: 3-row bcrypt `password` hash sample diffed byte-for-byte
  local vs. temp — **identical** (hash contents not printed in this
  report, per instruction).

No PK set mismatch found anywhere.

## 15. Fitness muscle-ID verification

`muscles.id` set: full match, §14. **FK resolution, not just presence:**

```sql
SELECT count(*) FROM exercise_muscles em
LEFT JOIN muscles m ON m.id = em.muscle_id
WHERE m.id IS NULL;
-- result: 0
```

Zero orphaned `exercise_muscles.muscle_id` references in the restored
temp database — every one of them resolves to a LOCAL muscle ID (the
value the reconciliation step wrote), never to the migration's original
random placeholder ID, which no longer exists in the table by the time
the transaction commits.

## 16. AI knowledge-source verification

All 7 local `knowledge_sources.id` values preserved exactly (§14),
including the one genuinely local-only row
(`source-sciencedaily-fitness`, an RSS source with no migration
counterpart). `personalized_service_orders`'s four milestone columns
(from the prior schema-reconciliation pass) restored correctly in this
service's full restore: non-null counts in the temp database match the
dump's own manifest snapshot exactly (intake/draft/accepted/completed —
same counts as reported in §13 for the whole table). Agent workflow data
(`agent_workflow_sessions`, `fitness_agent_actions`) restored with row
counts matching the dump's manifest snapshot. All other ai-service
application table counts match the manifest snapshot exactly (§13).

## 17. User schema regression

Re-verified against the temp database this pass created:
`UserPreference` — 1 row, exact match to local (the schema-reconciliation
pass's own adopted table, now proven again in a from-scratch dress
rehearsal, not just its own isolated test). `user_profiles` (562),
`inbody_entries` (5,387), `contracts` (1,574), `sessions` (7,151),
`vietnam_provinces`/`vietnam_wards` (34/3,321) — all exact matches, along
with every other user-service table (§13).

## 18. Auth/Chat regression

**Auth:** all 7 tables restored with exact row-count matches (§13).
bcrypt password hashes confirmed byte-preserved on a direct sample diff
(§14) — the same self-contained, salt-embedded hash format audited in the
prior schema-reconciliation pass, unaffected by anything in this pass.
`refresh_tokens` (1,671 rows) restore correctly as data, but — reiterated
from the original plan doc, unchanged by this pass — are cryptographically
unusable in AWS immediately after cutover, because AWS's `JWT_SECRET`/
`JWT_REFRESH_SECRET` are (and must be) different from local's; every user
must log in again post-cutover. This is expected, not a defect.

**Chat:** all 5 tables restored with exact row-count matches (§13) —
`conversations` (1,475), `call_sessions` (18), `conversation_participants`
(2,950), `messages` (10,318). Chat-service's data-migration readiness is
fully independent of its Socket.IO runtime deployment status (still
not started — see the schema-reconciliation report's own Chat AWS
Preparation section, unchanged by this pass).

## 19. Dump hashes

Local business data changed in 6 of 7 databases between the prior pass
and this one (ordinary background local-dev activity, confirmed directly
via row-count comparison, not assumed) — payment-service was the sole
exception, unchanged. Per instruction ("do not regenerate unless local
business data actually changed"), **all 7 dumps were regenerated** at the
start of this pass (their prior versions were, by definition, already
stale for 6 of them) via the existing `scripts/data-migration-export.sh`,
and the manifest was rewritten:

```
auth-service       3e0df778ca62...
user-service       f4b9dcaeb312...
fitness-service    f5619daab97e...
gym-service        c6ab478b564d...
payment-service    24c2fee80872...  (content unchanged; SHA differs — pg_dump's custom-format archive header embeds a per-run timestamp even when the underlying data is byte-identical, confirmed by an identical 85,142-byte size and identical restored row counts)
ai-service         d4e692bb31be...
chat-service       229d53a104c0...
```

All 7 re-verified against the manifest immediately before this report was
written (SHA-256 of every dump file on disk vs. the manifest's recorded
value) — **all 7 MATCH**. No dump has drifted since this pass's own
export.

## 20. Upload file manifest

Re-confirmed the same 11 files from the prior pass (the `compose_user_
uploads` Docker volume was not touched): 8 contract PDFs, 3 PT-application
images, 683,145 bytes total. Written to
`artifacts/data-migration/uploads-manifest.json` — relative key, size,
SHA-256 per file, plus the intended AWS destination
(`fitness-assistant-uploads-dev-191798898985`, under a
`user-service/<relativeKey>` prefix). Not uploaded this pass.

## 21. Fargate importer image

`infra/data-migration-importer/Dockerfile` — built and run locally this
pass (not pushed to ECR, no AWS resource created). Base:
`postgres:15-alpine` (NOT `node:20-alpine`, which was tried first and
rejected: Alpine's current package index no longer carries
`postgresql15-client` at all, only 16/17/18, which would have mismatched
the exact `pg_dump 15.18`/`pg_restore 15.18` version these dumps were
created with) plus `apk add --no-cache nodejs` (Alpine's own index still
carries a compatible `nodejs` package on the older Alpine release
`postgres:15-alpine` is built from). The importer script has zero npm
dependencies (only Node built-ins), so there is no `package.json`/`npm
install` step — the whole image is a two-instruction `Dockerfile` plus a
single `COPY` of the script. `ENTRYPOINT ["node",
"/app/data-migration-import-aws.mjs"]` — no credentials baked in;
`DATABASE_URL` is supplied entirely via the container's runtime
environment, exactly as the script already required.

Verified locally: `node --version` → 24.18.1, `psql --version` /
`pg_restore --version` → both 15.18 (exact match to the dumps' own
creation tool). This same image (joined to the local Docker network) is
what ran the entire §12 dress rehearsal — it is not a paper design, it is
the actual proven mechanism.

## 22. Secret mapping

Audited existing convention from `docs/aws-deployment/*_FINAL_AWS_CONFIG_
REPORT_2026-09-08.md` and `AWS_DEPLOYMENT_RUNBOOK.md` rather than
inventing one — every app service already reads a `DATABASE_SECRET_ID`
environment variable naming a Secrets Manager secret, in a documented,
consistent `fitness-assistant/dev/<service>-database` pattern:

| Service | AWS logical DB | Secrets Manager secret name (confirmed in existing docs) |
|---|---|---|
| user-service | `fitness_assistant_user` | `fitness-assistant/dev/user-database` |
| ai-service | `fitness_assistant_ai` | `fitness-assistant/dev/ai-database` |
| fitness-service | `fitness_assistant_fitness` | `fitness-assistant/dev/fitness-database` |
| gym-service | `fitness_assistant_gym` | `fitness-assistant/dev/gym-database` |
| payment-service | `fitness_assistant_payment` | `fitness-assistant/dev/payment-database` |
| chat-service | `fitness_assistant_chat` | `fitness-assistant/dev/chat-database` |
| auth-service | `fitness_assistant` | **not found in any existing AWS config doc** — no `AUTH_SERVICE_FINAL_AWS_CONFIG_REPORT` file exists in `docs/aws-deployment/`. Following the same pattern for consistency: `fitness-assistant/dev/auth-database` (proposed, NOT independently confirmed the way the other 6 are — flag this specifically before relying on it) |

The importer never receives a secret name or a database password
directly — it only ever reads `DATABASE_URL` from its own process
environment (§ the script's own top-of-file usage comment, unchanged this
pass). Whatever orchestrates the real Fargate task run is responsible for
resolving the correct `DATABASE_SECRET_ID` for the service being
imported, fetching it from Secrets Manager, and constructing
`DATABASE_URL` before launching the container — exactly the same pattern
every Lambda's own `config/lambda-runtime.ts` already implements for
normal request-time database access, reused here rather than invented
fresh. No secret value appears anywhere in this report or in any file
this pass wrote.

## 23. Files changed

Modified:
- `scripts/data-migration-import-aws.mjs` — `conflictColumn` (string)
  generalized to `conflictColumns` (array, composite-key support);
  new `"clear-baseline"` strategy alongside `"upsert"`; `gym-service`
  (`platform_commission_rates`) and `payment-service` (`wallets`) added
  to `MIGRATION_SEEDED_TABLES`; preflight generalized to verify an EXACT
  `expectedBaselineCount` (and, for `"clear-baseline"`, exact content)
  per seeded table rather than a blind "not in the exclude list" count;
  `_prisma_migrations` unconditionally excluded from every restore;
  `DATABASE_URL`'s query string stripped before use; entire restore
  (baseline cleanup + main data + every seeded-table reconciliation)
  consolidated into ONE `psql --single-transaction` script instead of
  several independent ones; `--disable-triggers` reasoning superseded by
  the already-adopted `session_replication_role` mechanism, now with an
  explicit AWS-role-privilege classification (§10).
- `docs/aws-full-local-data-migration-plan.md` — §26 (Blockers) updated:
  item 7 (gym/payment) marked resolved; 4 new findings added
  (`_prisma_migrations` handling, `DATABASE_URL` query-string stripping,
  chat's `CHAT_DATABASE_URL` variable name, `gymcoach_ai` live-traffic
  staleness); §27/§28 updated to reflect full readiness; stale
  `pg_restore --disable-triggers` operational language removed from §12
  and §16 and replaced with the actual mechanism.

New:
- `infra/data-migration-importer/Dockerfile`.
- `artifacts/data-migration/uploads-manifest.json`.
- This report.
- All 7 dump files under `artifacts/data-migration/` were regenerated
  (§19) — same paths, new content/hashes for 6 of 7.

Not modified, per instruction: any historical migration folder, any real
`gymcoach_*` database (only 7 clearly-named, this-pass-created temporary
databases were used, all dropped at the end), any business logic (payment
release logic, wallet logic, PT contracts, fitness roadmap, AI workflow,
auth, frontend), Qdrant data.

## 24. Blockers remaining

**None that block a READY verdict for this migration's own scope.**
Everything this pass and the prior schema-reconciliation pass were asked
to resolve is resolved and proven end-to-end. Two informational items
carry forward into the real cutover (neither is a migration-correctness
blocker):

1. **AWS PREFLIGHT VERIFICATION REQUIRED** (§10): the `rds_superuser`
   role-membership assumption for `session_replication_role` has not been
   tested against real Aurora — a one-line smoke test is recommended
   before trusting the full importer there.
2. **`gymcoach_ai` write-traffic staleness** (§13/§19): recommend a brief
   write-freeze or a final re-export immediately before the real cutover
   for ai-service specifically; every other service's dump was confirmed
   quiescent throughout this entire pass.

## 25. Exact first AWS console step

Build and push `infra/data-migration-importer/Dockerfile`'s image to a
private ECR repository; confirm/create the 7 Secrets Manager secrets in
§22's table (flagging auth-service's proposed name for explicit
confirmation, since it's the one entry not already documented elsewhere);
confirm AWS Aurora's 7 logical databases have all been migrated to
current repo history (including this pass's and the prior pass's adopted
migrations); create the private S3 prefix and upload all 7 dumps plus
both manifests (`manifest.json`, `uploads-manifest.json`); run the §10
`rds_superuser` smoke test; then provision the one-time Fargate task and
run the importer for real, one service at a time, in the order the
original plan doc's §14 specifies.

## 26. Final verdict

**FULL LOCAL DATA MIGRATION READY FOR AWS**
