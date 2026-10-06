#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

log "=== APPLY PREPATCH (idempotent — safe to re-run) ==="

require_env AWS_REGION
derive_db_base

GEN_DIR=/work/generated
mkdir -p "$GEN_DIR"

OUT_PREFIX="$(migrator_output_prefix)"
log "--- fetching generated prepatch files from ${OUT_PREFIX}/generated/ ---"
if ! aws s3 cp "${OUT_PREFIX}/generated/" "$GEN_DIR/" --recursive --only-show-errors --region "$AWS_REGION"; then
  echo "ERROR: could not fetch generated prepatch files from ${OUT_PREFIX}/generated/." >&2
  echo "       Run MODE=schema-audit first." >&2
  exit 1
fi

MISSING=0
for entry in "${DB_MANIFEST[@]}"; do
  IFS='|' read -r dbname dumpfile svc <<< "$entry"
  patch="$GEN_DIR/schema-prepatch.${dbname}.sql"

  if [ ! -f "$patch" ]; then
    echo "SKIP ${dbname}: no per-database patch found at ${patch} (run MODE=schema-audit first)"
    MISSING=1
    continue
  fi

  if ! grep -qv '^--\|^[[:space:]]*$' "$patch"; then
    log "--- ${dbname}: patch has no SQL statements (no drift detected) — skipping ---"
    continue
  fi

  log "--- applying patch to ${dbname} ---"
  psql "$(db_url_for "$dbname")" -v ON_ERROR_STOP=1 -f "$patch"
  log "--- ${dbname} OK ---"
done

if [ "$MISSING" -ne 0 ]; then
  echo "WARNING: one or more databases had no generated patch file — run MODE=schema-audit first." >&2
fi

log "=== APPLY PREPATCH DONE ==="
