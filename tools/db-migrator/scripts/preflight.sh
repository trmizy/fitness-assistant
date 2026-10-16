#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

log "=== PREFLIGHT (non-destructive: no writes to Aurora) ==="

require_env AWS_REGION
require_env DUMP_S3_PREFIX
derive_db_base

log "--- environment ---"
echo "AWS_REGION      = ${AWS_REGION}"
echo "DUMP_S3_PREFIX  = ${DUMP_S3_PREFIX}"
echo "DATABASE_URL    = $(mask_url "$DATABASE_URL")"
echo "Derived DB_BASE = $(mask_url "${DB_BASE}${DB_QUERY}")"

FAIL=0
mkdir -p /work/dumps

log "--- listing dumps in S3 ---"
aws s3 ls "${DUMP_S3_PREFIX}/" --region "$AWS_REGION" || { echo "FAIL: cannot list ${DUMP_S3_PREFIX}"; FAIL=1; }

log "--- downloading + verifying each of the 7 dumps (pg_restore -l) ---"
for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  local_path="/work/dumps/${dumpfile}"
  s3_path="${DUMP_S3_PREFIX}/${dumpfile}"

  if aws s3 cp "$s3_path" "$local_path" --region "$AWS_REGION" --only-show-errors; then
    size=$(stat -c%s "$local_path" 2>/dev/null || echo "?")
    if pg_restore -l "$local_path" > /dev/null 2>&1; then
      echo "OK   ${dbname}  <- ${dumpfile}  (${size} bytes, pg_restore -l readable)"
    else
      echo "FAIL ${dbname}  <- ${dumpfile}  (downloaded but pg_restore -l could not read it)"
      FAIL=1
    fi
  else
    echo "FAIL ${dbname}  <- ${dumpfile}  (download failed)"
    FAIL=1
  fi
done

log "--- Aurora connectivity ---"
if psql "$(db_url_for postgres)" -v ON_ERROR_STOP=1 -Atqc "select version();"; then
  echo "OK   Aurora connection"
else
  echo "FAIL Aurora connection"
  FAIL=1
fi

log "--- verifying all 7 target databases exist (explicit SQL against pg_database) ---"
for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  if db_exists "$dbname"; then
    echo "OK   database exists: ${dbname}"
  else
    echo "FAIL database missing: ${dbname}"
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  log "=== PREFLIGHT: ONE OR MORE CHECKS FAILED ==="
  exit 1
fi

log "=== PREFLIGHT OK ==="
