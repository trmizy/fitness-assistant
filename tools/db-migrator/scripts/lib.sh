#!/usr/bin/env bash
# Shared helpers for tools/db-migrator scripts. Sourced, never executed directly.

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: required env var $name is not set" >&2
    exit 1
  fi
}

# Ordered "aurora_db|dump_file|service_dir" manifest.
# Order matters at restore time: fitness_assistant (auth/users) must land
# before the services that reference its user ids.
DB_MANIFEST=(
  "fitness_assistant|gymcoach_auth.data.dump|auth-service"
  "fitness_assistant_user|gymcoach_user.data.dump|user-service"
  "fitness_assistant_fitness|gymcoach_fitness.data.dump|fitness-service"
  "fitness_assistant_gym|gymcoach_gym.data.dump|gym-service"
  "fitness_assistant_payment|gymcoach_payment.data.dump|payment-service"
  "fitness_assistant_chat|gymcoach_chat.data.dump|chat-service"
  "fitness_assistant_ai|gymcoach_ai.data.dump|ai-service"
)

# DATABASE_URL (from Secrets Manager) currently points at one specific
# database on the Aurora cluster, as a Prisma connection string — it carries
# `?schema=public`, a Prisma-only query param that libpq/psql does not
# understand ("invalid URI query parameter: schema", confirmed against the
# real secret on ECS). Every target database lives on the same cluster with
# the same credentials, so we derive a shared base URL and swap only the
# dbname. DB_QUERY (the original query string, kept as-is) is only ever safe
# to hand to Prisma; psql/pg_restore must never see it — db_url_for() below
# strips it entirely.
derive_db_base() {
  require_env DATABASE_URL
  local url_no_qs="${DATABASE_URL%%\?*}"
  DB_QUERY=""
  if [[ "$DATABASE_URL" == *"?"* ]]; then
    DB_QUERY="?${DATABASE_URL#*\?}"
  fi
  DB_BASE="${url_no_qs%/*}"
}

# For psql / pg_restore --dbname: no query string, ever.
db_url_for() {
  echo "${DB_BASE}/${1}"
}

# For `prisma migrate diff --from-url` only: Prisma understands (and the
# original secret carries) Prisma-specific params like ?schema=public.
prisma_db_url_for() {
  echo "${DB_BASE}/${1}${DB_QUERY}"
}

# Redacts the password before anything gets logged.
mask_url() {
  echo "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'
}

# Deliberately NOT `psql -lqt` / `\l` — that path failed previously with
# "column d.daticulocale does not exist" when the psql client's catalog
# expectations didn't match the server. Plain SQL against pg_database is
# stable regardless of client/server catalog-version differences.
db_exists() {
  local dbname="$1"
  local count
  count=$(psql "$(db_url_for postgres)" -v ON_ERROR_STOP=1 -Atqc \
    "select count(*) from pg_database where datname = '${dbname}';")
  [ "$count" = "1" ]
}

# Where schema-audit publishes generated/ + reports/, and where later,
# independent ECS tasks (apply-prepatch, restore, verify) fetch them back
# from. Each MODE runs in its own ephemeral Fargate task, so anything one
# stage must hand to a later stage has to round-trip through S3, not the
# local filesystem. Configurable so a future CI/CD pipeline can point it
# elsewhere; defaults to a sibling of DUMP_S3_PREFIX.
migrator_output_prefix() {
  if [ -n "${MIGRATOR_S3_PREFIX:-}" ]; then
    echo "${MIGRATOR_S3_PREFIX%/}"
  else
    require_env DUMP_S3_PREFIX
    echo "${DUMP_S3_PREFIX%/dumps}/db-migrator-output"
  fi
}

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# Downloads all 7 dumps into /work/dumps if not already present. Read-only
# with respect to S3 (GetObject only, never deletes/overwrites the source).
ensure_dumps_downloaded() {
  require_env AWS_REGION
  require_env DUMP_S3_PREFIX
  mkdir -p /work/dumps
  local entry dbname dumpfile svc need_download=0
  for entry in "${DB_MANIFEST[@]}"; do
    IFS='|' read -r dbname dumpfile svc <<< "$entry"
    if [ ! -s "/work/dumps/${dumpfile}" ]; then
      need_download=1
    fi
  done
  if [ "$need_download" -eq 1 ]; then
    log "--- downloading dumps from ${DUMP_S3_PREFIX} ---"
    aws s3 cp "${DUMP_S3_PREFIX}/" /work/dumps/ --recursive --only-show-errors --region "$AWS_REGION"
  fi
}
