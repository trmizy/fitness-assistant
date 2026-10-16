#!/usr/bin/env bash
set -euo pipefail

: "${MODE:?MODE is required: one of preflight | schema-audit | apply-prepatch | constraint-audit | apply-constraints | restore | verify}"

SCRIPTS=/work/scripts

case "$MODE" in
  preflight)      exec "$SCRIPTS/preflight.sh" ;;
  schema-audit)   exec "$SCRIPTS/schema-audit.sh" ;;
  apply-prepatch) exec "$SCRIPTS/apply-prepatch.sh" ;;
  constraint-audit) exec "$SCRIPTS/constraint-audit.sh" ;;
  apply-constraints) exec "$SCRIPTS/apply-constraints.sh" ;;
  restore)        exec "$SCRIPTS/restore-all.sh" ;;
  verify)         exec "$SCRIPTS/verify-row-counts.sh" ;;
  *)
    echo "ERROR: unknown MODE '${MODE}'. Expected one of: preflight, schema-audit, apply-prepatch, constraint-audit, apply-constraints, restore, verify" >&2
    exit 1
    ;;
esac
