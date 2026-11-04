# sourced by up/down/reset/seed/status. Every docker compose call goes through dc(): fixed project name + fixed file, never the dev stack.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PROJECT="gymini-e2e-dispute"
FILE="$ROOT/infra/compose/docker-compose.e2e-dispute.yml"
unset COMPOSE_PROJECT_NAME COMPOSE_FILE
dc() { docker compose -p "$PROJECT" -f "$FILE" "$@"; }
# the stack built from THIS worktree only
case "$ROOT" in *fa-bc-e2e*|*e2e-dispute*) ;; *) echo "refusing: $ROOT is not the e2e worktree (set E2E_DISPUTE_ALLOW_ROOT=1 to override)" >&2; [ "$E2E_DISPUTE_ALLOW_ROOT" = 1 ] || exit 2;; esac
