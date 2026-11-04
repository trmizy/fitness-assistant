#!/usr/bin/env bash
# Seeds the running stack (idempotent): 5 accounts, a PAID PT contract with a DISPUTED and a PT_NO_SHOW_REPORTED session, a gym membership complaint.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
exec node "$HERE/seed.mjs" "$@"   # --new-dispute: add one more DISPUTED session (for re-running smoke.mjs)
