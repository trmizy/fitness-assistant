# tools/db-migrator

One-shot ECS Fargate tool that migrates the 7 local Postgres databases into
the Aurora PostgreSQL cluster `fitness-assistant-dev-aurora`, safely: it
audits schema drift against the real Prisma migrations before ever touching
data, generates an idempotent SQL patch, and only then restores.

## Why one image, five modes

Each run is a separate ECS `RunTask` with its own ephemeral container
filesystem — nothing persists between modes on local disk. `MODE=<mode>`
selects which script `entrypoint.sh` execs; no long command overrides are
needed in the task definition. Anything one stage must hand to a later stage
(the generated prepatch, the drift report) round-trips through S3
(`MIGRATOR_S3_PREFIX`, defaults to `<DUMP_S3_PREFIX>/../db-migrator-output`)
instead of assuming local files survive — this is what makes the same image
safe to run as separate steps in a future CI/CD pipeline, not just by hand.

| MODE | Reads | Writes | Destructive? |
|---|---|---|---|
| `preflight` | S3 dumps, Aurora (`select` only) | nothing | No |
| `schema-audit` | Aurora (`select` only, via `prisma migrate diff --from-url`) | `generated/`, `reports/` (local + S3) | No — a local shadow Postgres does all the writing |
| `apply-prepatch` | S3 (generated patches) | Aurora — `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` only | Additive only, safe to re-run |
| `restore` | S3 dumps | Aurora — **truncates** every `public` table except `_prisma_migrations`, then reloads from the dump | **Yes** |
| `verify` | S3 dumps (table lists only), Aurora (`select count(*)`) | `reports/restore-row-counts.md` (local + S3) | No |

## Directory layout

```
tools/db-migrator/
  Dockerfile
  entrypoint.sh          # dispatches on $MODE
  scripts/
    lib.sh               # shared helpers: DB manifest, URL derivation, db_exists
    classify-diff.awk     # splits a prisma migrate diff into safe/needs-review
    preflight.sh
    schema-audit.sh
    apply-prepatch.sh
    restore-all.sh
    verify-row-counts.sh
  generated/              # schema-prepatch.sql + per-db patches (git-tracked baseline; overwritten by schema-audit at runtime)
  reports/                # schema-drift-report.md, restore-row-counts.md (same)
```

## How schema-audit actually works (no guessed types)

`schema-audit.sh` never invents a column type. For each of the 7 databases it:

1. Boots a disposable local Postgres inside the container (`initdb` + `pg_ctl`,
   TCP loopback only, never exposed) — this never touches Aurora.
2. Runs `prisma migrate diff --from-url <aurora-db> --to-migrations
   <service>/prisma/migrations --shadow-database-url <local> --script`. Prisma
   replays the service's real, checked-in migrations into the local shadow DB
   and diffs Aurora's actual live schema against that — every type in the
   output comes from the migration that created it, never a guess.
3. `classify-diff.awk` splits the output into blocks and only lets through
   `CreateTable`, `CreateIndex`, `CreateEnum`, and `AlterTable` blocks that are
   **purely** `ADD COLUMN` (rewritten `IF NOT EXISTS`). Anything else — drops,
   renames, type changes, `AddForeignKey`, or any `AlterTable` block it isn't
   fully sure about — goes to `needs-review.<db>.sql` and is **never**
   auto-applied. This fails closed by design.

This mechanism was verified locally end-to-end before being handed off: a
throwaway Postgres stood in for Aurora, seeded with auth-service's schema
missing its two most recent migrations (reproducing the real reported gaps),
and `schema-audit.sh` correctly detected the missing `must_change_password`
column and `password_reset_tokens` table, correctly excluded the new table's
`ADD CONSTRAINT ... FOREIGN KEY` from the auto-patch, and the generated patch
applied cleanly twice in a row (second run: `NOTICE: ... already exists,
skipping` on every statement, exit 0). See `reports/schema-drift-report.md`
for the full trail. **The other 6 databases have not been audited against
the real Aurora cluster yet** — it sits on a private VPC subnet unreachable
from outside it, so that can only happen via `MODE=schema-audit` on ECS.

## Build and push

Build context **must be the repository root** (the image needs every
service's `prisma/migrations`, which live outside `tools/db-migrator/`):

```bash
cd fitness-assistant   # repo root
TAG=dev-$(date +%Y%m%d)-1   # bump the trailing number if that tag already exists

aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin 191798898985.dkr.ecr.ap-southeast-1.amazonaws.com

docker build -f tools/db-migrator/Dockerfile \
  -t 191798898985.dkr.ecr.ap-southeast-1.amazonaws.com/fitness-assistant-dev-db-migrator:$TAG .

docker push 191798898985.dkr.ecr.ap-southeast-1.amazonaws.com/fitness-assistant-dev-db-migrator:$TAG
```

Then point the task definition at the new tag (new revision, same family):

```bash
aws ecs describe-task-definition \
  --task-definition fitness-assistant-dev-db-migrator \
  --region ap-southeast-1 --query taskDefinition > /tmp/taskdef.json
# edit /tmp/taskdef.json: containerDefinitions[0].image -> the :$TAG you just pushed
# strip the fields register-task-definition rejects (taskDefinitionArn, revision,
# status, requiresAttributes, compatibilities, registeredAt, registeredBy)
aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json --region ap-southeast-1
```

## Run order (ECS RunTask)

Network configuration below (`subnet-09e3230f7bca04c8e`, `subnet-02b39d77762465ef8`,
`sg-00726a813b1163459`) is the one this exact task family has already used
successfully to reach Aurora and S3 — reused here rather than guessed. No
dedicated `db-migrator` security group exists yet; this SG belongs to
`fitness-assistant-dev-chat-service` but has already been proven to allow
this task's Aurora + S3 access.

```bash
CLUSTER=fitness-assistant-dev-cluster
TASKDEF=fitness-assistant-dev-db-migrator
NET="awsvpcConfiguration={subnets=[subnet-09e3230f7bca04c8e,subnet-02b39d77762465ef8],securityGroups=[sg-00726a813b1163459],assignPublicIp=DISABLED}"

run_mode() {
  aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$TASKDEF" \
    --launch-type FARGATE \
    --network-configuration "$NET" \
    --overrides "{\"containerOverrides\":[{\"name\":\"db-migrator\",\"environment\":[{\"name\":\"MODE\",\"value\":\"$1\"}]}]}" \
    --region ap-southeast-1
}
```

1. **`run_mode preflight`** — non-destructive. Confirms S3 dumps, Aurora
   connectivity, and all 7 databases exist. Fix anything it reports before
   continuing.
2. **`run_mode schema-audit`** — non-destructive (writes only to a disposable
   local Postgres + S3/`reports`). Read `reports/schema-drift-report.md`
   (pulled from `s3://.../db-migrator-output/reports/`) and stop here if it
   lists anything under "needs manual review" for a database you're about to
   restore.
3. **`run_mode apply-prepatch`** — additive-only DDL against Aurora,
   idempotent. Safe to re-run.
4. **`run_mode restore`** — **destructive**: truncates every `public` table
   except `_prisma_migrations` in all 7 databases, then reloads from the S3
   dumps, in this fixed order (auth first, since other services reference its
   user ids): `fitness_assistant`, `fitness_assistant_user`,
   `fitness_assistant_fitness`, `fitness_assistant_gym`,
   `fitness_assistant_payment`, `fitness_assistant_chat`,
   `fitness_assistant_ai`. **Do not run this until you have explicitly
   confirmed you want to overwrite these 7 Aurora databases.**
5. **`run_mode verify`** — read-only. Writes `reports/restore-row-counts.md`
   (local + S3) with a per-table row count for all 7 databases, explicitly
   distinguishing `EMPTY` (table exists, 0 rows) from `MISSING (in dump, not
   in Aurora)`.

Watch logs at `/ecs/fitness-assistant-dev-db-migrator` in CloudWatch (log
group already configured on the task definition).

## Known wiring note (not changed here)

The task definition's `DATABASE_URL` secret is
`fitness-assistant/dev/chat-database-url` (key `CHAT_DATABASE_URL`) — despite
the name, every script here only uses it to derive the shared
host/port/credentials for the Aurora cluster (`derive_db_base` in `lib.sh`),
then swaps in each target database name. This was already working before
this rewrite (confirmed: Fargate could already reach and list all 7
databases with it) and is out of scope to rename here — flagging it so it
isn't mistaken for a bug.

## Safety guarantees carried over from the request

- No secret is ever written to a file; `DATABASE_URL` and `DUMP_S3_PREFIX`
  only ever come from the environment (Secrets Manager / task-def env).
- `restore` and `apply-prepatch` never touch `_prisma_migrations` — the
  restore list is built via `pg_restore -l` with that entry filtered out
  (`--use-list`, not the unsupported `--exclude-table-data`), and the
  truncate step explicitly excludes it.
- `schema-audit` never guesses a column type — every type comes from a real,
  checked-in migration file, and anything the classifier isn't fully certain
  is a pure additive change is routed to manual review instead of being
  applied.
- All 5 scripts use `set -euo pipefail` and are checked with `bash -n` during
  the Docker build, so a syntax error fails the build, not a live run.
- Database existence/listing uses explicit SQL against `pg_database`, never
  `psql -lqt` / `\l` (the catalog-version mismatch that previously broke as
  `column d.daticulocale does not exist`).
