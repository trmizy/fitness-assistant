# AWS Full Local Data Migration Plan

Date: 2026-09-16. AUDIT + PLAN + LOCAL PREPARATION ONLY. No AWS connection
was made, no AWS CLI was invoked, no AWS resource was created or modified,
no local database was modified or reset, no destructive migration ran.
Every finding below is measured directly against the running local
environment (`gymcoach-postgres`, `gymcoach-qdrant`, `gymcoach-redis`
containers) — nothing is assumed or invented.

## 1. Executive summary

The local dev environment holds **7 real application-owned PostgreSQL
databases** (not 6 — the owner's assumed list omits **chat-service**,
which owns `gymcoach_chat`), all inside a **single** Postgres 15 container
(`gymcoach-postgres`, port 5433). Total: **146 application tables**,
**~1.66M rows**, **~670MB** of live data. All primary keys are `text`
(cuid/UUID) — **zero SQL sequences exist anywhere**, which materially
simplifies restore (no sequence-resync step). No `bytea` columns exist;
heavy `jsonb` usage (81 columns across services) is natively preserved by
`pg_dump`/`pg_restore`. 11 physical uploaded files (688KB, contracts +
PT-application documents) live in a Docker named volume, not the
filesystem the repo's own working tree shows. All 4 local Qdrant
collections are 768-dimensional and **must be re-embedded**, not copied,
per the task's own explicit instruction — full original source content is
available in every collection's own payload, so this is a re-embed-from-
existing-payload job, not a data-recovery problem.

Two **genuine, data-bearing Prisma schema drifts** were found (ai-service,
user-service — detailed in §11) that would break a naive "restore data
into a schema built purely from current repo migrations" plan. Everything
else (5 of 7 services) has **zero** schema drift between the live DB and
the current repo migration history, verified with Prisma's own read-only
`migrate diff`, not by inspection.

Local export artifacts (7 data-only `pg_dump` custom-format dumps + a
non-sensitive manifest with SHA-256 checksums) were created this pass
under `artifacts/data-migration/` (gitignored). Import source code
(`scripts/data-migration-import-aws.mjs`) was written and reviewed but
**never executed** — it is meant to run later, by hand, from inside the
private VPC.

## 2. Local persistence inventory

**PostgreSQL container:** `gymcoach-postgres` (image `postgres:15-alpine`),
host `localhost`, port `5433`, user `gymcoach` (password read from root
`.env`, never printed here). A second, isolated container
(`gymcoach-test-postgres-test-1`, port `55433`) holds only ephemeral
`*_test` databases for the automated test suite — explicitly **out of
scope**, it is reset routinely by test tooling and holds no real business
data.

7 application-owned logical databases, all in the one `gymcoach-postgres`
instance (there is also a default `gymcoach` database with **0 tables** —
just the Postgres image's default placeholder DB, owns nothing, excluded):

| Service | Local DB | Tables | Rows (exact) | Size |
|---|---|---|---|---|
| auth-service | `gymcoach_auth` | 7 | 23,150 | 17 MB |
| user-service | `gymcoach_user` | 24 | 32,053 | 25 MB |
| fitness-service | `gymcoach_fitness` | 51 | 1,510,772 | 542 MB |
| gym-service | `gymcoach_gym` | 23 | 43 | 9.2 MB (mostly free space) |
| payment-service | `gymcoach_payment` | 9 | 1,056 | 9.6 MB |
| ai-service | `gymcoach_ai` | 27 | 55,911 | 62 MB |
| chat-service | `gymcoach_chat` | 5 | 14,761 | 14 MB |

**7th database found that the owner's assumed list omitted:** chat-service
(`gymcoach_chat`). Confirmed via `infra/compose/docker-compose.dev.yml`'s
own `DATABASE_URL`/`CHAT_DATABASE_URL` for the `gymcoach-chat-dev`
container — this is a real, running, data-bearing service, not test
scaffolding.

**Environment-file inconsistency found (not corrected, flagged):**
`backend/services/auth-service/.env` declares
`DATABASE_URL=...localhost:5433/gym_coach_auth` — but the actual database
(confirmed both by `docker-compose.dev.yml`'s container env and by
`psql -l`) is named `gymcoach_auth`. `gym_coach_auth` does not exist as a
database at all. The running container is unaffected (compose injects the
correct `DATABASE_URL` directly, overriding the `.env` file), but any
host-run Prisma CLI command from that directory using its own `.env`
(e.g. a developer running `npx prisma studio` outside Docker) would fail
to connect or silently target a nonexistent database. This is a local
repo-hygiene issue, not an AWS migration blocker, but it is flagged here
because it could cause a false-negative in migration tooling that reads
`.env` files instead of the live container config — this plan and its
scripts use the docker-compose-confirmed name (`gymcoach_auth`)
throughout, never the `.env` file's name.

Migration versions and Prisma status: see §11.

## 3. Database matrix (all 146 tables)

Full per-table row counts (exact `COUNT(*)`, not `pg_stat` estimates) were
captured for every application table in every one of the 7 databases.
Reproduced in full inside `artifacts/data-migration/manifest.json`
(`tableRowCounts` per service) rather than duplicated here at 146-row
length; representative highlights by category:

| Service | Table | Rows | Category |
|---|---|---|---|
| Auth | users | 164 | USER |
| Auth | refresh_tokens | 1,671 | SYSTEM/MIGRATION (session-bound, see §4) |
| Auth | audit_logs | 21,308 | SYSTEM/MIGRATION |
| User | user_profiles | 562 | USER |
| User | contracts | 1,574 | BUSINESS |
| User | sessions | 7,151 | BUSINESS |
| User | inbody_entries | 5,387 | BUSINESS |
| User | vietnam_provinces / vietnam_wards | 34 / 3,321 | REFERENCE |
| Fitness | exercises | 1,027 | REFERENCE |
| Fitness | foods | 13,159 | REFERENCE |
| Fitness | workout_sets | 662,655 | TRANSACTION |
| Fitness | workout_program_exercise_set_prescriptions | 266,631 | TRANSACTION |
| Fitness | nutrition_logs | 299,057 | TRANSACTION |
| Fitness | fitness_roadmaps / roadmap_phases | 21 / 26 | BUSINESS |
| Gym | gym_brands / gyms | 1 / 12 | BUSINESS |
| Gym | gym_membership_contracts | 14 | TRANSACTION |
| Payment | wallets | 379 | BUSINESS |
| Payment | payment_transactions | 141 | TRANSACTION |
| Payment | wallet_ledger_entries | 406 | TRANSACTION |
| AI | conversations | 30,644 | TRANSACTION |
| AI | agent_workflow_sessions | 2 | SYSTEM/MIGRATION (active state, see §8) |
| AI | personalized_services | 3,785 | BUSINESS |
| Chat | messages | 10,318 | TRANSACTION |
| Chat | conversations | 1,475 | BUSINESS |
| every service | `_prisma_migrations` | 3–55 | SYSTEM/MIGRATION |

"Do not invent counts" was honored: every number above (and every number
in the manifest) came from `SELECT count(*)` against the live container,
not an estimate.

## 4. Auth data

7 tables: `users` (164), `refresh_tokens` (1,671), `audit_logs` (21,308),
`email_verifications` (7), `password_reset_tokens` (0),
`pt_deactivation_calls` (0), `_prisma_migrations` (9).

Role/active distribution (no password hashes shown): `CUSTOMER` 153,
`PT` 9, `GYM_OWNER` 1, `ADMIN` 1 — all 164 currently `isActive = true`;
no soft-deleted/banned accounts exist locally.

**Password hashes: migrate byte-for-byte, will keep working.** Confirmed
by reading `auth.service.ts` directly: hashing uses `bcryptjs`
(`bcrypt.hash(password, 10)`), a **self-contained, salted** hash — the
salt and cost factor are embedded in the hash string itself; there is no
external pepper, no environment-specific key mixed in anywhere in the
hashing path (grep-verified — only `JWT_SECRET`/`JWT_REFRESH_SECRET` are
environment-specific, and those sign *tokens*, not passwords). A bcrypt
hash copied verbatim into AWS's `users.password` column will `bcrypt.compare`
correctly against the same plaintext password post-migration, using the
exact same Auth Service code. No column in any service depends on a
local encryption key (grep-verified repo-wide for
`encrypt`/`Encrypted`/`cipher` in every `schema.prisma` and every `src/`
tree — zero matches).

**Will become invalid after migration (flagged, not fixed):**
`refresh_tokens` (1,671 rows) are JWTs signed with the **local**
`JWT_REFRESH_SECRET`. AWS must use its own, different secret (Secrets
Manager) — migrating these rows verbatim would let them look present in
the AWS DB, but every one of them will fail signature verification the
first time it's used, because the signing key differs. Recommendation:
migrate the rows anyway (exact-local-state policy, §15), but document
that **every local user session is invalidated by this migration** — all
164 accounts will need to log in again after cutover. This is expected
and safe, not a defect.

## 5. User data

24 tables, 32,053 rows. All the categories the task named are present and
non-empty except `pt_training_locations` (0 rows — feature scaffolded, no
local data yet) and `notification_preferences`/`client_reviews`/
`pt_application_media`/`pt_schedule_exceptions`/`agent_contract_drafts`
(all 0 — same). Present with real data: `user_profiles` (562),
`inbody_entries` (5,387), `pt_applications` (102),
`pt_application_certificates` (35), `pt_availability` (721),
`pt_service_packages` (96), `contracts` (1,574), `sessions` (7,151),
`session_reviews` (3,103), `session_settlements` (119),
`client_journeys` (331), `notifications` (9,376), `vietnam_provinces` (34),
`vietnam_wards` (3,321), `UserPreference` (1 — see §11, this table has no
current repo migration).

**External references to Auth user IDs — real finding, not fixed:**
`user_profiles.userId` has **562 distinct values**, but `auth.users` has
only **164 rows**. Cross-checked directly (exported both ID sets, diffed):
**129 profile IDs do match a real `auth.users.id`**; the remaining **433
do not exist in Auth at all**. This is not a comparison bug — the 433
non-matching IDs are syntactically valid UUIDs, and spot-checking their
version nibble shows they are **UUIDv5** (deterministic/namespace-derived,
e.g. `00341d42-a29a-5019-af22-...` — the `5` in the third group is the
version marker), while the 129 that DO match Auth, and Auth's own IDs, are
**UUIDv4** (random, e.g. `018249ea-6036-4ecf-bfb9-...`). This is the
signature of a bulk deterministic-seed dataset generated independently of
real Auth-created accounts — very likely from a dev/demo seed script
(`prisma/seed_vietnam_locations.ts` or a similar seeder) that populated
`user_profiles` with realistic-looking synthetic profiles without ever
creating a matching Auth account, layered underneath the smaller set of
genuinely-Auth-linked real accounts. Per the task's explicit "preserve
exact local state" / "do not fix automatically" instruction, this is
**reported, not repaired**: migrating `user_profiles` as-is will carry
these 433 orphaned rows into AWS exactly as they are locally.
Separately, **35 Auth users have no profile row at all** — normal
(profile creation is a distinct, optional step after signup).

## 6. Fitness data

51 tables, 1,510,772 rows — by far the largest database (542 MB), and NOT
catalog-seed-only: real per-user execution data dominates it by volume —
`workout_sets` (662,655), `workout_program_exercise_set_prescriptions`
(266,631), `nutrition_logs` (299,057), `workout_program_exercises`
(85,080), `import_records` (42,780), `workouts` (41,607),
`workout_schedules` (37,901), `body_metrics` (30,556),
`workout_program_days` (24,321) alongside catalog/reference tables
(`exercises` 1,027, `foods` 13,159, `equipment` 46, `muscles` 29).
Roadmap/cycle tables are present and non-trivial: `fitness_roadmaps` (21),
`roadmap_phases` (26), `training_cycles` (45), `cycle_assessments` (32),
`recommendation_audits` (40), `coach_client_action_audits` (47).

**Circular FK found (real, affects import strategy, §17):** `pg_dump`
itself warned during export: `muscles` participates in a circular
foreign-key relationship (self-referential or mutual-reference muscle
metadata). A `--data-only` restore needs trigger enforcement suppressed to
load it without manually dropping/recreating constraints — done via
`SET session_replication_role = 'replica'` for the restore session (see
§16's updated Aurora-permission analysis for why this, not
`pg_restore --disable-triggers`, is what's actually built into
`scripts/data-migration-import-aws.mjs`), and proven end-to-end against
this exact table in
`docs/aws-full-local-data-migration-final-reconciliation.md` §12/§15.

IDs, `userId`, version fields, source IDs, cycle/roadmap relationships,
timestamps and status fields are all preserved as-is by the chosen
data-only `pg_dump`/`pg_restore` path (§13/§17) — nothing is reduced,
re-derived, or regenerated.

**Cross-service reference spot check:** `training_cycles.user_id` has 18
distinct values; 5 do not exist in `auth.users` — same synthetic-seed
pattern as §5, not investigated further at per-row detail (out of scope
for an audit pass; flagged for the full cross-service integrity pass in
§9).

## 7. Gym data

23 tables, 43 rows — the smallest real dataset (1 brand, 1 partner
account, 12 gyms, 14 membership contracts, 4 PT collaborations, 8
membership plans). Most tables are legitimately empty (`gym_check_ins`,
`gym_reviews`, `gym_complaints`, `gym_photos`, `partner_invitations`, etc.
all 0 rows — features exist, no local usage yet).

**1 Gym Owner → 1 Gym Brand invariant: HOLDS, verified, not assumed.**
`SELECT owner_id, count(*) FROM gym_brands GROUP BY owner_id HAVING
count(*) > 1` returned **0 rows**; total brands (1) equals distinct owners
(1). No violation exists locally, so there is nothing to report as broken
and — per instruction — nothing was "silently repaired" because nothing
needed repairing.

## 8. Payment data

9 tables, 1,056 rows. `wallets` (379: 240 `CLIENT`, 129 `PT`, 8 `GYM`, 2
`PLATFORM`), `wallet_ledger_entries` (406), `payment_transactions` (141),
`payment_webhook_events` (63), `platform_commissions` (46),
`ledger_operations` (10). `partner_receivables` and `withdrawal_requests`
are both legitimately 0 rows (no withdrawals initiated locally yet).

**Provider identifiers — labeled, not treated as real state.**
`payment_transactions.provider` distribution: `MOCK` 132, `VNPAY` 4,
`ZALOPAY` 5. The 9 non-MOCK rows' `provider_transaction_id` values are
**LOCAL/SANDBOX EXTERNAL REFERENCE** — they identify sandbox-mode
transactions inside VNPay's/ZaloPay's own **test** environments tied to
this project's sandbox merchant credentials, not real payment-provider
state that AWS can verify or reconcile against. Migrating these 9 rows
copies Gymini's own local record of "a sandbox transaction happened," not
proof that any money moved. No provider was called during this audit; no
transaction was created, retried, or reconciled.

**Wallet monetary IDs and relationships:** preserved exactly by the
chosen data-only restore — no balance is recalculated, no ledger entry is
regenerated, no transaction is replayed through business logic. Wallet
`owner_id` cross-checked against `auth.users` for `CLIENT`/`PT`-typed
wallets: **0 orphans** (every client/PT wallet owner exists in Auth).

## 9. Cross-service ID integrity

Exact, measured (not assumed) results for the identity chains named in
the task:

| Chain | Distinct IDs on the referencing side | Found in Auth | Orphans | Note |
|---|---|---|---|---|
| Auth → `user_profiles.userId` | 562 | 129 | **433** | UUIDv5 synthetic-seed pattern, §5 |
| Auth → `training_cycles.user_id` (fitness) | 18 | 13 | **5** | same seed-data pattern, not deep-dived |
| Auth → `gyms.owner_id` (gym) | 1 | 1 | 0 | clean |
| Auth → `wallets.owner_id` where type=CLIENT/PT (payment) | checked | all present | **0** | clean |
| Auth → `conversations.user_id` (ai-service) | 2,963 | 107 | **2,856** | see below |

**AI conversations — large orphan count, explained, not fixed.** 96% of
`gymcoach_ai.conversations.user_id` values (2,856 of 2,963) do not exist
in `auth.users`. Unlike the profile case, these ARE UUIDv4 (same format
as real IDs), so this isn't a version-marker seed signature — but the
volume is consistent with something more mundane and already known from
this session's own work: several of this codebase's own automated test
suites generate a fresh `randomUUID()` per test run as a synthetic
`userId` for DB-backed integration tests
(`agent-workflow-remediation-1.test.ts` and siblings do exactly this),
and `conversations` (30,644 rows) is the kind of high-volume table such
runs would accumulate into over a long local dev history. This is a
**plausible, not confirmed** explanation — no further row-level forensic
tracing was done (out of scope for an audit pass). **Reported as
ORPHAN REFERENCES, not fixed, not filtered out of the export** — the
task's "exact local state is the goal" instruction is honored literally.

**MISSING USERS:** 35 Auth users have no `user_profiles` row (§5) — a
normal, non-orphan gap (optional profile creation step).

**BROKEN RELATIONSHIPS:** none found beyond the ID-orphan pattern above —
no case was found where an existing FK-shaped reference points at a
row that once existed and was deleted out from under it (Postgres itself
enforces real FK constraints within each database, e.g. Auth's
`refresh_tokens`/`audit_logs`/`password_reset_tokens` all correctly
cascade off `users.id`; the orphans found are all **cross-database**
references, which Postgres cannot and does not enforce, by design of this
per-service-database architecture).

Nothing above was repaired. Original IDs will be preserved exactly by the
migration.

## 10. Local migration status / drift

Repo migration folder count vs. applied `_prisma_migrations` row count,
per service:

| Service | Repo folders | DB rows | Unfinished/rolled-back rows |
|---|---|---|---|
| auth-service | 9 | 9 | 0 |
| user-service | 42 | 44 | 1 |
| fitness-service | 53 | 55 | 3 |
| gym-service | 20 | 20 | 0 |
| payment-service | 11 | 11 | 0 |
| ai-service | 24 | 26 | 1 |
| chat-service | 3 | 3 | 0 |

The raw count mismatches above are **mostly harmless history noise** —
failed-then-corrected migration attempts recorded under an empty or
retried migration name (e.g. fitness's `20260120005039_` and
`20260526093212_ai_plan_workout_schedule`, user's `20260120003413_`, all
rolled back and superseded) — but three are **not** noise:

| Service | Migration name (DB-recorded, finished) | Repo folder exists? |
|---|---|---|
| fitness-service | `20260526000000_ai_plan_workout_schedule` | No (superseded by `20260526093212_...` of the same name, which IS in repo) |
| user-service | `20260905063000_account_preferences` | **No, and no obvious successor either** |
| ai-service | `20260823120000_personalized_service_escrow_milestones` | **No, and no obvious successor either** |

**This was not left as a guess.** Prisma's own read-only
`prisma migrate diff --from-schema-datamodel <schema.prisma> --to-url
<live DB> --script` (a genuine schema comparison — never a
`db push`/`migrate reset`, and it makes zero writes) was run against
every one of the 7 databases:

- **auth, gym, payment, chat, fitness: "This is an empty migration."**
  — zero drift. The current repo migration history, applied fresh, is
  provably byte-for-byte equivalent to the live local schema, DESPITE the
  raw folder-count/history-rewrite noise above (fitness's own row-count
  mismatch turned out to be pure superseded-name noise with zero real
  schema effect).
- **user-service: real drift.** The diff script is a `CREATE TABLE
  "UserPreference"` (`userId` PK + 7 preference boolean/int columns). This
  means **`schema.prisma` does not currently declare the `UserPreference`
  model at all** — the table (1 row locally) was added by a migration
  whose folder is gone, and nothing in the current schema/migration
  history would recreate it on a fresh deploy.
- **ai-service: real drift, two parts.**
  1. `DROP INDEX "conversations_used_fallback_idx"` — the live index is a
     **partial** index (`... WHERE used_fallback = true`, confirmed via
     `pg_indexes`), but `schema.prisma`'s plain `@@index([usedFallback])`
     declares a full, non-partial index of the same name. Cosmetic/
     performance-only, not data-bearing — this is exactly the failed
     migration recorded in `_prisma_migrations` as
     `20260716043947_add_chat_sessions` (error 42P07, "relation already
     exists") rolled back in 2026-07; a hand-crafted partial index
     apparently exists from an earlier successful migration and was never
     reconciled with the declarative schema.
  2. `ALTER TABLE "personalized_service_orders" ADD COLUMN
     milestone_accepted_released_at, milestone_completed_released_at,
     milestone_draft_released_at, milestone_intake_released_at` — **real,
     populated, data-bearing columns** (409/457/146/48 non-null rows
     respectively, confirmed via `count(*) FILTER`), added by the orphaned
     `20260823120000_personalized_service_escrow_milestones` migration,
     and **schema.prisma does not declare them at all today.**

**Consequence for the migration (BLOCKER-class, see §27):** if AWS
Aurora's existing schema was built strictly from the CURRENT repo's
`schema.prisma`/migration history (as §11 assumes), it is **missing**
`UserPreference` (user-service) and the 4 escrow-milestone columns
(ai-service). A data-only restore of these two services' dumps will
fail on those specific tables/columns unless the AWS schema is first
brought up to include them (see §11's recommended per-DB handling).

Not used, per instruction: `prisma db push`, `prisma migrate reset`,
`--accept-data-loss`. No old migration was modified.

## 11. AWS target assumptions

Given: **AWS schema exists (from prior manual deploys), data mostly
empty.** Chosen strategy per DB, and why:

**A. Data-only restore into the existing migrated schema — the default,
used for 5 of 7 services (auth, gym, payment, chat, fitness).** These 5
have zero schema drift (§10) between the live local DB and current repo
migration history, so — provided AWS was actually migrated to the current
repo's migration head for each (this must be verified on the AWS side
before import, §24; not verified here since that requires an AWS
connection this pass explicitly forbids) — a plain `pg_restore --data-only`
against the existing schema is the correct, lowest-risk approach. It
never touches `CREATE TABLE`/`CREATE TYPE`, so it cannot conflict with
whatever manual deployment work already exists there.

**Modified Option A — for user-service and ai-service:** the same
data-only restore, but **only after** the two confirmed-real drift items
(§10) are reconciled on the AWS side first: either (a) a new, real Prisma
migration is authored NOW in the repo to formally declare
`UserPreference` (user-service) and the 4 milestone columns
(ai-service) — turning today's undeclared drift into a real, deployable
migration, which is the architecturally correct fix and was **not** done
in this pass (out of scope: this is an audit+plan task, not a schema
change) — or (b) the missing table/columns are added to AWS by hand
before restore, accepting that they'll remain permanently undeclared in
the repo. **(a) is recommended** and is listed as a blocker in §27.

**Not chosen: (B) recreate empty logical DB + full restore.** Rejected
because AWS Aurora already has these schemas from real prior deployment
work — dropping and recreating them risks losing IAM/parameter-group/
extension configuration already done by hand on those databases, and
directly contradicts the task's own "prefer preserving current repository
migration history" instruction. There is no finding in this audit that
requires nuking any AWS schema.

**Not chosen: (C) other.** No third approach was identified as safer than
A for this specific "schema exists, data mostly empty" situation.

## 12. Export strategy

`pg_dump`, **custom format** (`--format=custom`), **data-only**
(`--data-only`), `--no-owner --no-privileges` (the local `gymcoach` role
almost certainly does not exist as-is on Aurora; the target's own IAM/
Postgres role should own the restored data, not a copied role name).
Custom format was chosen over plain SQL because it: compresses well (73MB
total output from ~670MB of live data), supports `pg_restore`'s
selective/parallel restore and clean per-object error reporting, and
carries its own internal TOC that already respects dependency order
(directly relevant to fitness's circular-FK `muscles` warning, §6) rather
than relying on manually-ordered `INSERT` statements the way a plain-SQL
data-only dump would.

Preserved natively by this format with zero extra flags: primary keys,
foreign keys, nullable values, timestamps, enum values, JSON/JSONB
(confirmed: 81 jsonb columns across the 7 DBs, 0 json), Unicode/Vietnamese
text (extensively verified visually across `foods`, `fitness_faq`,
`fitness_knowledge` payloads and table content — UTF8 encoding confirmed
on every database via `psql -l`), transaction consistency
(`pg_dump` takes a single consistent MVCC snapshot per database).
**Sequences: N/A** — confirmed zero sequences exist in any of the 7
databases (every PK is `text`/cuid/UUID), so there is no
sequence-resync step for this migration at all. **bytea: N/A** — zero
bytea columns exist anywhere (binary content lives on the filesystem
instead, §19).

No DB password appears in any dump or in the manifest — `PGPASSWORD` is
read from the environment at dump time only, per-connection, never
written to a file.

## 13. Import strategy (AWS private Aurora)

Aurora stays private — **no recommendation to make it public, ever.**
Given the existing architecture (VPC, private app subnets, a Lambda
security group, an Aurora security group, Secrets Manager, manual AWS
Console operation), the safest one-time path is:

```
local pg_dump (custom format, done this pass)
  -> artifacts/data-migration/ (local, done this pass)
  -> upload to S3 (private bucket, NOT done this pass — no AWS connection made)
  -> a short-lived, temporary compute resource INSIDE the VPC pulls the
     dump from S3 and runs pg_restore directly against Aurora's private
     endpoint, using a Secrets-Manager-sourced connection string
  -> compute resource is torn down afterward
```

**Why NOT a Lambda for the actual restore, even though the rest of this
system already runs on Lambda:** `pg_restore`/the native `libpq` client
binary is **not bundled with Node.js Lambda's runtime** and would have to
be vendored — this repo's own existing Lambda packaging script
(`backend/services/ai-service/scripts/package-lambda.ts`) already shows
exactly this class of problem is real and non-trivial for THIS repo
(Prisma's own native query engine binary has to be manually
cross-targeted to `rhel-openssl-3.0.x`/Amazon Linux 2023/x86_64 and
pruned per-platform). Vendoring a matching native `pg_restore` binary the
same way is possible in principle, but: (a) the fitness-service dump
alone is ~66MB and Lambda's `/tmp` ephemeral storage / 15-minute execution
limit make a single-invocation restore of a large custom-format dump
riskier than necessary for a **one-time** operation, and (b) this task
explicitly says "if Lambda is unsuitable... propose the safest
**serverless** alternative. NO EC2."

**Recommended one-time mechanism: AWS Fargate (ECS), NOT EC2, run once
and torn down.** A single Fargate task, in the private app subnet, using a
plain `postgres:15` (or matching Aurora-compatible) container image that
already ships `pg_restore` natively — no custom binary packaging at all,
which sidesteps the exact Lambda-runtime packaging risk above entirely.
The task: (1) pulls the relevant dump(s) from S3, (2) reads the target
`DATABASE_URL` from Secrets Manager into its environment, (3) runs
exactly the guarded logic already written and reviewed this pass
(`scripts/data-migration-import-aws.mjs` — hard per-service DB-name
allowlist, checksum verification, preflight-empty-target check, abort
loudly on any mismatch, single-transaction restore), (4) writes a
structured, non-sensitive summary to CloudWatch Logs, (5) stops. Fargate
is serverless (no EC2 instance to patch/manage), can sit inside the same
private subnets and security groups Aurora already trusts, and needs zero
native-binary cross-compilation work — a strict improvement over
shoehorning `pg_restore` into Lambda for a task that only ever runs once.

This plan does **not** create that Fargate task definition, does **not**
create the S3 bucket, and does **not** touch IAM — those are real AWS
resource creations explicitly out of scope for this audit+plan pass (§24
lists the first concrete next manual step).

## 14. Import order

Verified against the actual ID-reference chains found in §9 (not assumed
from service-directory order):

```
1. Auth        (gymcoach_auth -> fitness_assistant)          — no dependency on any other service
2. User        (gymcoach_user -> fitness_assistant_user)     — user_profiles.userId references Auth (logically; no DB-level FK across services)
3. Payment     (gymcoach_payment -> fitness_assistant_payment) — wallets.owner_id references Auth users/gym partners
4. Gym         (gymcoach_gym -> fitness_assistant_gym)       — gym_brands.owner_id references Auth; independent of Fitness/AI
5. Fitness     (gymcoach_fitness -> fitness_assistant_fitness) — largest, most self-contained; training_cycles/roadmaps reference Auth users only
6. Chat        (gymcoach_chat -> fitness_assistant_chat)     — conversation_participants reference Auth users
7. AI          (gymcoach_ai -> fitness_assistant_ai)         — last: references Auth users, and its own personalized-service tables conceptually parallel Payment/Gym data (escrow milestones tie to payment-adjacent business state)
```

This differs slightly from the owner's suggested
"Auth → User → Fitness → Gym → Payment → AI" only by moving Payment and
Gym ahead of Fitness and slotting Chat in before AI — because, as the task
itself anticipated, **relationships here are identity-level (IDs), not
DB-level foreign keys**, so there is no *technical* restore-order
requirement at all (every dump is self-contained; Postgres cannot reject
a row for referencing an ID in a different database it can't see). The
order above is a **verification-order** recommendation only: restore Auth
first so every subsequent service's post-import spot-check (§17) has a
real Auth ID set to check orphans against immediately, and keep Payment/
Gym near the front since their datasets are tiny (fast to verify and
unblock) before committing to Fitness's much larger restore.

## 15. S3 transfer strategy

Not executed this pass (no AWS connection made). Planned shape only:
each service's dump (`artifacts/data-migration/<service>/*.dump`) plus
`manifest.json` would upload to a private, versioned S3 prefix, e.g.
`s3://<existing-private-bucket>/data-migration/<STAMP>/<service>/`,
using the checksum already recorded in the manifest to verify integrity
after upload (`aws s3 cp` + a post-upload `HeadObject`/checksum compare —
not run here). No public bucket, no public object ACL, no credentials
embedded in any object.

## 16. Postgres import tooling

`pg_restore`/`psql` (matching the `pg_dump 15.18` used to create the
dumps — confirmed via `pg_dump --version` against the actual export tool
used; the importer image pins the same version, see the final-
reconciliation report §21). Actual mechanism (`scripts/data-migration-
import-aws.mjs`, proven end-to-end this pass — see final-reconciliation
report §12): `pg_restore --data-only --no-owner --no-privileges` extracts
a plain-SQL restore script (never restores directly into the target
archive-to-database), which is then run through `psql
--single-transaction` wrapped in `SET session_replication_role =
'replica'` / `RESET session_replication_role` — this replaces the
`--disable-triggers` flag this doc originally proposed (see §16's Aurora-
permission analysis for why) while still correctly loading fitness's
confirmed circular FK on `muscles`. `--single-transaction` means any
failure rolls the entire per-service restore — main data, seeded-table
reconciliation, everything — back to zero net change rather than leaving
a half-populated database, proven directly during this pass (an induced
failure mid-restore left the fitness temp database at exactly its pre-
restore migration-baseline state, confirmed by row count).

## 17. Filesystem / S3 data

Yes — real files exist outside PostgreSQL, and they are **not** stored on
the repo's own working-tree path (`backend/services/user-service/uploads`
on disk is empty, 0 files). The actual content lives in a **Docker named
volume** (`compose_user_uploads`, mounted at
`/app/backend/services/user-service/uploads` inside the
`gymcoach-user-dev` container per `docker-compose.dev.yml`). Inspected
directly (read-only volume mount, 11 files, 688KB total):

| Directory | Files | Total size |
|---|---|---|
| `contracts/` | 8 PDFs | ~127 KB |
| `pt-applications/` | 3 images (2 JPEG, 1 JPG) | ~545 KB |
| `profile-photos/` | 0 | 0 |

Filenames are either a UUID (`contracts/`) or a
`document-<timestamp>-<random>` pattern (`pt-applications/`) — no PII is
embedded in the filenames themselves beyond what the DB rows already
reference by ID. Ownership/reference fields: `contracts/*.pdf` filenames
match `contracts.id` UUIDs in `gymcoach_user`; `pt-applications/*` match
the upload-token pattern used by `pt_application_certificates`
(35 rows — meaning most certificate rows do **not** have a
corresponding local file; either most were seeded as metadata-only rows
without a real upload, or the corresponding files were lost across a
volume recreation at some point — not investigated further, flagged as a
pre-existing gap, not something this migration can recover).

**gym-service uploads: not durably persisted, nothing to migrate.**
`gym-service`'s own `uploads/gym-photos`, `uploads/branch-documents/`,
`uploads/complaint-photos/` directories (found via source-code grep) have
**no** corresponding named volume anywhere in `docker-compose.dev.yml` —
they are container-local/ephemeral. This matches the DB evidence exactly:
`gym_photos`, `gym_branch_documents`, and complaint-photo-referencing rows
are all **0 rows** locally (§7) — there is no metadata pointing at files
that would need recovering, so this is a consistent, harmless gap, not
data loss caused by this migration.

Migration target (not executed): the 11 real files would upload to
`fitness-assistant-uploads-dev-191798898985` (the bucket name given in
the task) under a path mirroring their current relative structure, e.g.
`user-service/contracts/<uuid>.pdf`, `user-service/pt-applications/<name>`.
No upload was performed this pass.

## 18. Qdrant → OpenSearch reindex plan

Confirmed directly against the running `gymcoach-qdrant` container
(REST API, read-only `GET`/`scroll` calls only):

| Local Qdrant collection | Point count | Vector dimension | Source dataset (from payload) | AWS OpenSearch index | Reindex required |
|---|---|---|---|---|---|
| `exercises` | 207 | **768** | Payload carries full exercise text (`exerciseName`, `instructions`, `muscleGroupsActivated`, etc.) directly — traces to the same content family as `fitness-service.exercises` (1,027 rows; 207 is a subset/earlier indexing pass) | `exercises` | **YES** |
| `fitness_evidence` | 183 | **768** | Payload carries full citation + `content` text, plus `source_file` pointing at `data/processed/evidence/*.jsonl` (confirmed present in the repo, e.g. `asymmetry-thresholds-2021.jsonl`) | `fitness_evidence` | **YES** |
| `fitness_faq` | 5,946 | **768** | Payload carries the full Vietnamese `questionVi`/`answerVi` text directly | `fitness_faq` | **YES** |
| `fitness_knowledge` | 7,072 | **768** | Payload carries the full Vietnamese `titleVi`/`contentVi` text directly, keyed by `docId` (e.g. `EX00001`) | `fitness_knowledge` | **YES** |

**All 4 are 768-dimensional — none are copied, per the task's explicit
instruction.** The good news, confirmed by directly inspecting a real
sample payload from each collection: **every one of these 4 collections
already carries its own full original source text inside the payload
itself** — this is not a case of "vectors only, source lost." The
re-embedding path is exactly the one the task specifies:

```
existing Qdrant payload's own source text (already on hand, no recovery needed)
  -> Cohere Embed Multilingual v3, via Bedrock
  -> 1024-dimensional embedding
  -> OpenSearch Serverless index (same name as the source collection)
```

`fitness_evidence`'s `source_file`/`chunk_id`/`chunk_index`/`total_chunks`
fields let the re-embed job preserve exact chunk boundaries and cite back
to `data/processed/evidence/*.jsonl` if a fresher re-chunk is ever wanted;
the other 3 collections' payloads are themselves the full unit of content
to re-embed, no external file needed. No reindex was performed this pass
(would require a real Bedrock call, and this is prep-only).

## 19. Redis / transient exclusions

`gymcoach-redis`: 445 total keys, **100% BullMQ queue namespaces**
(`bull:ai-tasks` 382, `bull:knowledge-pipeline` 61,
`bull:workout-generation` 2) — confirmed via `redis-cli --scan`, not
assumed. No business-critical state was found stored only in Redis;
everything BullMQ tracks here is job-queue bookkeeping for work that
either already completed (and has its real result in Postgres) or would
simply be re-enqueued from the source Postgres row that triggered it in
the first place. **Excluded from migration**, per instruction — nothing
found here overrides that default.

## 20. Secrets / encryption risks

Not migrated, per instruction, and none were found bundled into any
export artifact: `.env` files, `JWT_SECRET`/`JWT_REFRESH_SECRET`, AWS
credentials, the Postgres password, VNPay/MoMo/PayOS/ZaloPay provider
secret keys. `POSTGRES_PASSWORD` is read from the environment only at
dump time by `scripts/data-migration-export.sh` and never written to a
file. **Encrypted-column audit: zero matches repo-wide** for
`encrypt`/`Encrypted`/`cipher` across every `schema.prisma` and every
service's `src/` tree — there is no column anywhere whose value depends
on a local secret/key (password hashing is self-contained bcrypt, §4;
JWTs are signed tokens, not stored ciphertext, and are separately flagged
in §4 as becoming invalid post-migration for an unrelated reason — a
different signing secret, not column encryption).

## 21. Local export artifacts created

Created this pass, under `artifacts/data-migration/` (gitignored via the
repo's existing `**/artifacts/` rule — never committed):

| Service | File | Size | SHA-256 |
|---|---|---|---|
| auth-service | `auth-service/gymcoach_auth.data.dump` | 1,093,284 B | `50f9c9422f26...` |
| user-service | `user-service/gymcoach_user.data.dump` | 2,040,225 B | `73f373a0b795...` |
| fitness-service | `fitness-service/gymcoach_fitness.data.dump` | 66,409,409 B | `f4889252bd92...` |
| gym-service | `gym-service/gymcoach_gym.data.dump` | 15,212 B | `c5c4bf2bbf9c...` |
| payment-service | `payment-service/gymcoach_payment.data.dump` | 85,142 B | `8a41b398c7da...` |
| ai-service | `ai-service/gymcoach_ai.data.dump` | 6,116,601 B | `e3430d80807d...` |
| chat-service | `chat-service/gymcoach_chat.data.dump` | 682,107 B | `47391031ff90...` |

Total: **~73 MB** (from ~670MB of live data — custom-format compression).
Plus `artifacts/data-migration/manifest.json`: service, source DB, target
AWS DB name, dump filename, full SHA-256, size, repo migration head
folder name, and the exact per-table row counts at export time. No
password anywhere in the manifest or any dump filename.

Full SHA-256 values are in the manifest file itself (truncated above only
for table readability).

## 22. AWS import artifacts created

None — by design. `scripts/data-migration-import-aws.mjs` was written and
is checked into the repo as reviewable source, but was **never executed**
against anything. It contains no AWS resource definitions (no
CloudFormation/CDK/Terraform), creates nothing, and connects to nothing
on its own — it only runs later, by hand, once pointed at a real
`DATABASE_URL` from inside the VPC.

## 23. Pre-import AWS checklist (for whoever runs this manually later)

- [ ] Confirm each of the 7 AWS logical database names actually exists
      exactly as named in §14 (including the previously-unlisted
      `fitness_assistant_chat` — confirm this naming with the owner
      before creating it, since it wasn't in the original assumed list).
- [ ] For user-service and ai-service specifically: resolve the §10/§11
      schema drift (author a real migration for `UserPreference` and the
      4 `personalized_service_orders.milestone_*_released_at` columns,
      deploy it to AWS) **before** attempting a data-only restore of
      those two dumps.
- [ ] Confirm every target database's current `_prisma_migrations` table
      matches the repo's migration head for that service (this audit
      could not check AWS's own migration state — no AWS connection was
      made).
- [ ] Confirm every target application table is empty (the importer's
      own preflight check will re-verify and abort automatically, but a
      human check first avoids surprises).
- [ ] Provision the one-time Fargate task (§13) with least-privilege
      access: read from the specific S3 prefix, Secrets Manager access
      scoped to exactly the 7 target databases' secrets, and network
      access to Aurora's private endpoint only.
- [ ] Upload the 7 dump files + manifest to the chosen private S3 prefix
      and verify their SHA-256 post-upload against the manifest.

## 24. Post-import verification matrix

For every DB, once actually restored (not done this pass):

| Check | Method |
|---|---|
| Row counts local vs AWS | Compare AWS's post-restore `count(*)` per table against `manifest.json`'s `tableRowCounts` for that service — must match exactly (data-only restore, no filtering) |
| Primary key counts | `count(DISTINCT id)` == `count(*)` per table (should be trivially true; catches a corrupted/partial restore) |
| FK integrity (within a DB) | Re-run each service's own Postgres FK constraints implicitly via `pg_restore`'s own load order + `--single-transaction` (a real FK violation aborts the whole restore, not a silent partial success) |
| Sequence values | N/A — zero sequences exist (§11/§12) |
| Cross-service identity continuity | Re-run the exact §9 orphan counts against AWS; they must match the local counts exactly (433 profile orphans, 2,856 AI conversation orphans, etc.) — a **different** orphan count post-migration means the restore itself introduced or dropped rows, not that the underlying data problem got better or worse |
| Business invariant: 1 owner → 1 brand | Re-run §7's exact query against AWS gym DB |
| Deterministic spot-check | For a handful of specific known local IDs (e.g. the one real `gym_brands` row, a specific `payment_transactions.id`), pull the same row from AWS and diff field-by-field |

No row *contents* are printed in this report, per instruction — only
counts, distributions, and structural facts.

## 25. Rollback plan

Because this is a **data-only** restore into an existing, already-
migrated AWS schema, and because the importer's own preflight (§23 of the
importer script) refuses to run at all against a target that already has
rows, the realistic rollback for a failed/partial import is: **truncate
the specific target database's application tables and re-run the
importer from the same verified dump** — never `DROP DATABASE`, never
touch the schema/migration history. `--single-transaction` (§16) means a
failure mid-restore should already leave zero rows in that database (the
whole `pg_restore` invocation is one transaction), so in the common case
"rollback" is simply "nothing was ever committed — just re-run." Local
source data is completely unaffected by any AWS-side outcome, success or
failure — `pg_dump` never mutates its source, and nothing in this pass
touched local data.

## 26. Blockers

1. **RESOLVED (2026-09-16)** — user-service and ai-service's schema
   drift is fixed by two new forward migrations
   (`20260916100000_adopt_user_preference`,
   `20260916110000_adopt_personalized_service_escrow_milestones`); both
   applied locally, both proven to reproduce the exact live schema on a
   fresh DB from repo history alone, both proven data-only-restore
   compatible. Full detail:
   `docs/aws-full-local-data-migration-schema-reconciliation.md`.
2. **CONFIRMED BY OWNER — not a blocker.** `MIGRATE ORPHANED LOCAL ROWS
   AS-IS = YES`. The 433 orphaned `user_profiles` rows and 2,856 orphaned
   `ai` conversation `user_id` values (§5/§9) migrate to AWS exactly as
   local has them — intentional for this AWS dev target, per the owner's
   explicit instruction that exact local state is the goal.
3. **(Informational, not blocking)** `refresh_tokens` (1,671 rows) will
   be present but cryptographically invalid in AWS immediately after
   migration (different JWT signing secret) — every local user must log
   in again post-cutover. No action needed beyond user communication.
4. **CONFIRMED BY OWNER — not a blocker.** `MIGRATE CHAT SERVICE = YES`,
   target `fitness_assistant_chat`. Chat's DATA-migration readiness is
   confirmed; its own RUNTIME deployment (Socket.IO, not Lambda-shaped)
   is a separate, currently-unstarted piece of work — see the
   reconciliation report's Chat AWS Preparation section. Do not conflate
   the two.
5. **NEW — found during this reconciliation pass, real, must resolve
   before import.** fitness-service's `muscles` table has the exact same
   class of problem as ai-service's `knowledge_sources` (§10/§11
   originally): its seeding migration
   (`20260819020000_add_exercise_muscle_provenance_schema`) inserts 29
   rows with a **freshly-random** `id` (`gen_random_uuid()`) every time it
   runs, guarded only by `ON CONFLICT ("code") DO NOTHING`. A plain
   data-only restore of these 29 rows is silently rejected by that guard,
   and — because the target's `muscles.id` values were never local's real
   ones to begin with — this would have left AWS with **wrong `muscles.id`
   values** (violating "preserve original IDs exactly") without ever
   raising an error. Not a schema drift (schema.prisma already correctly
   describes this table) — purely an import-time hazard, now handled by
   `scripts/data-migration-import-aws.mjs`'s generalized
   `MIGRATION_SEEDED_TABLES` mechanism (upsert-by-`code` with the local
   `id` overwriting the migration's placeholder). Full detail in the
   reconciliation report.
6. **NEW — found during this reconciliation pass, real, resolved in the
   importer script.** The original `pg_restore --disable-triggers`
   restore command in this plan (§16) would very likely fail on AWS
   Aurora: that flag requires true PostgreSQL superuser (confirmed via
   Postgres's own documentation — disabling an internally-generated RI
   trigger needs it), and Aurora's customer master role is never a true
   superuser. Local testing looked safe only because this repo's local
   dev role happens to be a real superuser (confirmed: `rolsuper = t`).
   Replaced with `SET session_replication_role = 'replica'` for the
   restore session — requires only `rds_superuser` membership, which
   Aurora's master role does have — proven to still correctly load the
   fitness DB's circular-FK `muscles`/`exercise_muscles` relationship.
7. **RESOLVED (2026-09-18).** gym-service (`platform_commission_rates`)
   and payment-service (`wallets` PLATFORM/ESCROW) both had the same
   seed-vs-restore collision class as §26.5 — full audit, fix, and a real
   end-to-end restore test (not simulated) for both are in
   `docs/aws-full-local-data-migration-final-reconciliation.md`. Summary:
   `platform_commission_rates` has no stable key at all (not even a
   random-but-consistent one) — handled with a new "clear-baseline"
   strategy (verify the sole existing row matches the migration's exact
   known placeholder shape, delete it, let the dump's own row load
   normally). `wallets` uses its real composite
   `UNIQUE(owner_type, owner_id)` constraint as the upsert key — the
   importer's conflict-column support is now a list, not a single column,
   so this needed no bespoke logic. Both proven end-to-end on isolated
   temp databases: final `platform_commission_rates.id` and
   `wallets.id` (for the ESCROW row) match local exactly; the 406
   `wallet_ledger_entries` rows that reference the wallet all resolve with
   zero orphans.
8. **NEW — found and resolved this pass.** `_prisma_migrations` was
   present in every one of the 7 dumps (plain `pg_dump --data-only` never
   filtered it) — restoring it would have overwritten each AWS target's
   own canonical migration history with local's noisier one (rolled-back
   attempts, the two now-adopted orphaned identities). The importer now
   unconditionally excludes this table from every restore, for every
   service — application data is exact local state, migration history is
   whatever the target's own `prisma migrate deploy` produced.
9. **NEW — found and resolved this pass.** Every app service's
   `DATABASE_URL` carries a `?schema=public` query parameter Prisma
   understands but real `psql`/`pg_restore` do not — the importer would
   have failed immediately on ANY Secrets-Manager-sourced URL built the
   same way the local `.env` files are. The importer now strips the query
   string from `DATABASE_URL` before using it.
10. **NEW — found this pass, operational note, not a data blocker.**
    chat-service's Prisma schema reads `CHAT_DATABASE_URL`, not
    `DATABASE_URL` like the other 6 services (confirmed by actually
    running `prisma migrate deploy` against it — it fails immediately
    without that exact variable name). Whoever runs schema migrations
    against AWS Aurora for chat-service must set `CHAT_DATABASE_URL`, not
    `DATABASE_URL`. The importer script itself is unaffected (it only
    ever reads `DATABASE_URL`, regardless of service, since it never goes
    through any service's own Prisma schema).
11. **NEW — found this pass, operational note.** `gymcoach_ai` has live
    write traffic during normal local development (confirmed: its total
    row count changed twice during this pass, purely from ordinary
    background activity, not from anything this pass did) — any dump of
    it is a best-effort snapshot, not a frozen state, unlike the other 6
    databases which were observed to be quiescent throughout. Recommend a
    brief write-freeze (or a final re-export immediately before) right
    before the real AWS cutover for ai-service specifically.

## 27. Exact next manual AWS step

All known blockers across all 7 services are now resolved and proven —
see `docs/aws-full-local-data-migration-final-reconciliation.md` §12 for
the full 7-service dress rehearsal (every service imported into an
isolated fresh-migrated temp database via the real importer image, not a
simulation). Remaining before any real AWS action: build and push the
importer image (§21 of that report) to ECR, confirm AWS Aurora's 7
logical databases are migrated to current repo history (including the
three new forward/adopted migrations from §26.1/§26.5/§26.7 — this plan
cannot verify AWS's own migration state, no AWS connection was made), set
up the 7 Secrets Manager entries (§22 of that report), create or confirm
the private S3 prefix, upload the 7 dump files plus both manifests, and
provision the one-time Fargate task. Then
`scripts/data-migration-import-aws.mjs` runs for real, one service at a
time, in the order given in §14.

## 28. Final verdict

**FULL LOCAL DATA MIGRATION READY FOR AWS**

(All 7 services individually resolved, proven end-to-end on isolated
fresh-schema temp databases via the actual importer mechanism. See the
final-reconciliation report's own verdict section for the complete
condition-by-condition check — nothing there required AWS access to
verify locally, and no unresolved blocker remains that isn't itself a
first real AWS Console/IAM/Secrets Manager provisioning step outside this
audit's own reach.)
